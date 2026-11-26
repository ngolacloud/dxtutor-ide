//! Caso de uso «agente Co-Dev v2» — **independente de Tauri** (ADR-0003, F1).
//!
//! Gere as sessões do loop de agente do crate `tutor-agent`: cada sessão tem o seu
//! histórico (append-only), a sua flag de cancelamento e as aprovações pendentes. O
//! adaptador IPC (`commands::codev_agent`) só põe isto numa thread e traduz os eventos
//! para o Tauri; a regra de aprovação vive aqui.
//!
//! Estado: ferramentas reais (F2) e permissões decididas aqui, no backend (F3): a
//! `tutor_agent::permissions::Policy` (modo da modebar + regras do projecto/utilizador +
//! piso de segurança) decide cada chamada; só o que ela manda perguntar chega à UI, com a
//! razão e a regra que «permitir sempre» gravaria.

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tutor_agent::anthropic::{self, Anthropic, Config};
use tutor_agent::checkpoint::{Checkpoint, Checkpoints};
use tutor_agent::context::ReplyLang;
use tutor_agent::extensions::{self, Command as ProjectCommand, Skill};
use tutor_agent::hooks::{Hooks, HOOKS_FILE};
use tutor_agent::hunks::{self, Check, RejectedBy, ValidationStatus};
use tutor_agent::mcp::{self, McpTool};
use tutor_agent::openai::{self, OpenAiCompat};
use tutor_agent::permissions::{Gates, Mode, Origin, Policy, Rules, Verdict, NO_REQUEST};
use tutor_agent::redact::Redactor;
use tutor_agent::session::{self, HistoryItem, SessionLog, SessionMeta, SessionSummary};
use tutor_agent::tools::flow::SubagentSpec;
use tutor_agent::tools::{agent_tools, FileState, FlowState, ToolsetOptions, TOOLSET_VERSION};
use tutor_agent::{trust, Tool};
use tutor_agent::{
    Agent, AgentConfig, AgentError, AgentEvent, CacheTtl, Decision, Effort, Message, PendingCall,
    Provider, SystemBlock, ToolCtx, Transcript, TurnOutcome,
};

/// Um pedido de aprovação à espera: o canal onde a UI responde e a regra sugerida.
type Pending = (mpsc::Sender<Decision>, Option<String>);

/// Com que configuração abrir uma sessão (args do `codev_agent_start`).
#[derive(Clone, Default)]
pub struct StartSpec {
    pub root: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// Comandos de verificação detectados pela UI (`features/codev/domain/project-commands`).
    pub test_cmd: Option<String>,
    pub lint_cmd: Option<String>,
    /// Modo da modebar (`manual`/`assist`/`auto`; desconhecido → Manual, falha fechada).
    pub mode: Option<String>,
    /// Retomar a sessão gravada com este id (o prefixo do pedido vem do ficheiro, tal como
    /// foi gravado; `model`/`effort`/`test_cmd`/`lint_cmd` são ignorados).
    pub resume: Option<String>,
    /// Pasta das sessões (por omissão `~/.config/dxtutor/sessions`) — os testes usam outra.
    pub sessions_base: Option<PathBuf>,
    /// Ferramentas do anfitrião (ex.: `lsp_diagnostics`, que vive no Tauri). Entram no
    /// conjunto versão ≥ 3, sempre pela mesma ordem.
    pub host_tools: Vec<Arc<dyn Tool>>,
    /// Ferramentas do anfitrião que só entram no conjunto versão ≥ 4 (ex.: `arch_propose`):
    /// uma sessão gravada antes retoma sem elas (o prefixo do pedido não pode mudar). Desde o
    /// conjunto 9 são as ferramentas de arquitectura: só nas sessões com `architecture`.
    pub host_tools_v4: Vec<Arc<dyn Tool>>,
    /// Ferramentas do anfitrião do conjunto versão ≥ 8 (ex.: `outline`, RF-E04).
    pub host_tools_v8: Vec<Arc<dyn Tool>>,
    /// Ficheiro de confiança (hooks/MCP do projecto). `None` = nada é confiado (o adaptador
    /// passa `~/.config/dxtutor/trusted.json`).
    pub trust_store: Option<PathBuf>,
    /// Configuração MCP do utilizador (o adaptador passa `~/.config/dxtutor/mcp.json`).
    pub user_mcp: Option<PathBuf>,
    /// Provedor da conversa (`claude`/`codex`/`gemini`/`ollama`, F8). `None` → `claude`.
    /// Numa retoma é ignorado: vale o gravado na sessão.
    pub provider: Option<String>,
    /// Endereço do Ollama (o adaptador passa o das definições/`OLLAMA_HOST`).
    pub ollama_host: Option<String>,
    /// Live hunks (docs/v2/RF-CODEV-STREAM.md, D1): `edit`/`write` stream hunks into the
    /// editor and only accepted hunks are written. Manual and Assist review every hunk;
    /// Auto applies provisionally and validates. Off: the old direct writes.
    pub review_edits: bool,
    /// The Project issue this conversation works on (e.g. opened from the board): accepted
    /// hunks are recorded as its change sets.
    pub issue_key: Option<String>,
    /// The project database where accepted hunks are recorded (`None`: not recorded).
    pub change_log: Option<PathBuf>,
    /// The interface language (`en`, `ptAO`): Co-Dev answers in it. Saved with the session,
    /// so a resume keeps the language it started with. `None` → Portuguese (older UIs).
    pub lang: Option<String>,
    /// Toolset 9: an architecture session (the UI says so when the Architecture Studio is open
    /// or the first request is about architecture): it gets `arch_propose`. The others do not
    /// pay for its ~5 KB definition on every request. Saved with the session (`scopes`).
    pub architecture: bool,
    /// Multi Co-Dev (phase 3): the folder the session works in — the project folder inside a linked
    /// git worktree of `root` on the issue's branch. The adapter resolves it from the app's Co-Dev
    /// worktrees (`tutor_eval::gitwork::codev::find`), never from a path the UI typed; only with
    /// `issue_key`. Ignored on a resume (the saved one counts). `None`: `root` itself, as always.
    pub worktree: Option<PathBuf>,
}

/// Prefixo do erro de um modelo sem tool calling nativo: a UI reconhece-o e recua para o
/// protocolo de texto (blocos) do harness antigo.
pub const NO_TOOLS_MARK: &str = "[sem-ferramentas] ";

/// Os provedores que o agente v2 conhece.
pub const PROVIDERS: [&str; 4] = ["claude", "codex", "gemini", "ollama"];

/// O que cada provedor suporta no agente v2 (a matriz da F8). As ferramentas, permissões,
/// checkpoints, hooks, MCP, skills e sessões são do harness — iguais para todos; o resto
/// depende da API.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub struct ProviderFeatures {
    pub tools: bool,
    pub thinking: bool,
    pub prompt_cache: bool,
    pub compaction: bool,
    pub server_fallbacks: bool,
    pub effort: bool,
}

pub fn provider_features(provider: &str) -> ProviderFeatures {
    let claude = provider == "claude";
    ProviderFeatures {
        tools: true,
        thinking: claude,
        prompt_cache: claude || provider == "codex" || provider == "gemini", // automática nestes
        compaction: claude,
        server_fallbacks: claude,
        effort: claude,
    }
}

/// O aviso mostrado no primeiro turno de uma sessão que não é Claude.
pub fn features_notice(provider: &str, model: &str) -> Option<String> {
    if provider == "claude" {
        return None;
    }
    let f = provider_features(provider);
    let mut missing = vec![];
    if !f.thinking {
        missing.push("raciocínio visível");
    }
    if !f.compaction {
        missing.push("compactação automática do contexto");
    }
    if !f.server_fallbacks {
        missing.push("fallback do servidor");
    }
    if !f.effort {
        missing.push("nível de esforço");
    }
    if !f.prompt_cache {
        missing.push("cache de prompt");
    }
    Some(format!(
        "{} ({model}): ferramentas, permissões, checkpoints, hooks, MCP e sessões funcionam \
         como com o Claude; sem {} (só Claude). Conversas muito longas: começa uma nova.",
        provider_label(provider),
        missing.join(", ")
    ))
}

fn provider_label(p: &str) -> &str {
    match p {
        "codex" => "Codex/OpenAI",
        "gemini" => "Gemini",
        "ollama" => "Ollama (local)",
        _ => "Claude",
    }
}

/// O modelo por omissão de cada provedor (quando a UI não manda um utilizável) — os mesmos
/// que o `bridge.ts` do desktop põe no lugar dos nomes de exemplo.
pub fn default_model(provider: &str) -> &'static str {
    match provider {
        "codex" => "gpt-4.1",
        "gemini" => "gemini-2.5-flash",
        "ollama" => "qwen2.5-coder:14b",
        _ => anthropic::DEFAULT_MODEL,
    }
}

/// O modelo a usar: o da UI, excepto os nomes de exemplo do protótipo (`gpt-codex`,
/// `gemini-pro`) que nenhuma API aceita.
pub fn resolve_model(provider: &str, model: Option<&str>) -> String {
    match model.map(str::trim).filter(|m| !m.is_empty()) {
        Some("gpt-codex") | Some("gemini-pro") | None => default_model(provider).to_string(),
        Some(m) => m.to_string(),
    }
}

/// Constrói o provedor. `key` é a chave desse provedor (o Ollama não precisa).
pub fn make_provider(
    provider: &str,
    key: Option<String>,
    ollama_host: Option<&str>,
    workspace_id: Option<String>,
) -> Result<Arc<dyn Provider>, String> {
    let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    let need = |what: &str, env: &str| {
        format!(
            "sem chave da {what}: guarda-a em Definições → Modelos e provedores, ou define {env}"
        )
    };
    Ok(match provider {
        "claude" => {
            let mut cfg = Config::new(key.ok_or_else(|| need("Anthropic", "ANTHROPIC_API_KEY"))?);
            cfg.workspace_id = workspace_id;
            Arc::new(Anthropic::new(cfg))
        }
        "codex" => Arc::new(OpenAiCompat::new(openai::Config::openai(
            key.ok_or_else(|| need("OpenAI", "OPENAI_API_KEY"))?,
        ))),
        "gemini" => Arc::new(OpenAiCompat::new(openai::Config::gemini(
            key.ok_or_else(|| need("Google (Gemini)", "GEMINI_API_KEY"))?,
        ))),
        "ollama" => Arc::new(OpenAiCompat::new(openai::Config::ollama(
            ollama_host.unwrap_or(""),
        ))),
        other => return Err(format!("provedor desconhecido para o agente: {other}")),
    })
}

/// Os servidores MCP desta sessão: os do utilizador e os do projecto, se confiado.
fn mcp_servers(
    root: &Path,
    spec: &StartSpec,
    notes: &mut Vec<String>,
) -> std::collections::BTreeMap<String, mcp::ServerConfig> {
    let mut servers = std::collections::BTreeMap::new();
    let user = spec.user_mcp.clone();
    if let Some(u) = user {
        match mcp::load_config(&u) {
            Ok(m) => servers.extend(m),
            Err(e) => notes.push(e),
        }
    }
    if root.join(mcp::PROJECT_FILE).exists() {
        let store = spec.trust_store.clone();
        if store
            .as_deref()
            .is_some_and(|st| trust::is_trusted(st, root, mcp::PROJECT_FILE))
        {
            match mcp::load_config(&root.join(mcp::PROJECT_FILE)) {
                Ok(m) => servers.extend(m),
                Err(e) => notes.push(e),
            }
        } else {
            notes.push(format!(
                "o projecto define servidores MCP ({}) que ainda não confiaste — vê /comandos",
                mcp::PROJECT_FILE
            ));
        }
    }
    servers
}

/// O que a UI recebe quando uma chamada precisa de decisão humana.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub call: PendingCall,
    /// Porque é que se pergunta (modo, comando desconhecido, perigoso, ficheiro protegido).
    pub reason: String,
    /// Piso de segurança: a UI não oferece «permitir sempre».
    pub dangerous: bool,
    /// A regra que «permitir sempre» gravaria em `.dxtutor/permissions.json`.
    pub suggested_rule: Option<String>,
}

struct Session {
    /// The session's id (claims and the Agent map name it).
    id: String,
    /// The project folder: the Project database, the audit log, roles, permissions and the claims
    /// are keyed by it. The tools work in `agent.ctx.root` — the same folder, or the session's
    /// worktree (Multi Co-Dev, phase 3).
    project_root: PathBuf,
    /// The worktree's project folder when the session works in one (= `agent.ctx.root`).
    worktree: Option<PathBuf>,
    agent: Agent,
    transcript: Mutex<Transcript>,
    busy: AtomicBool,
    policy: Mutex<Policy>,
    /// tool_use_id → (canal onde a UI responde, regra sugerida para «permitir sempre»)
    pending: Mutex<HashMap<String, Pending>>,
    /// O registo em disco (`None` se não foi possível criá-lo — a sessão funciona na mesma).
    log: Mutex<Option<SessionLog>>,
    /// O último modo anunciado ao modelo (mensagem `system` a meio da conversa).
    announced: Mutex<Option<Mode>>,
    /// Modo plano e lista de tarefas (partilhados com as ferramentas e a política).
    flow: FlowState,
    /// Avisos para o modelo na próxima mensagem (rewind, modo plano) — a conversa nunca é
    /// editada, por isso o que muda entre turnos vai como mensagem `system`.
    notes: Mutex<Vec<String>>,
    /// Avisos do arranque para o humano (MCP que falhou, hooks por confiar…).
    startup_notices: Vec<String>,
    /// Live hunks on ([`StartSpec::review_edits`]).
    review_edits: bool,
    /// The project's test/lint commands: Auto mode validates provisional hunks with them.
    checks: Vec<String>,
    /// tool_use_id → the hunks of a call waiting in `hunk_review`.
    review: Mutex<HashMap<String, Vec<String>>>,
    /// Where accepted hunks are recorded, and for which issue (A5, RF-CODEV-STREAM §9).
    change_log: Option<PathBuf>,
    issue_key: Mutex<Option<String>>,
    /// checkpoint id → how many messages the conversation had when that turn started, so
    /// "Rewind to here" can take the conversation back too (A3, HARNESS-03). Only for the
    /// turns of this run of the app: a resumed session rewinds the files only.
    cp_marks: Mutex<HashMap<u32, usize>>,
    /// The human request of the current turn (RF-G01); «try again» keeps the last one.
    origin: Mutex<Option<Origin>>,
    /// Masks secrets in what is written to disk: session log and audit log (RF-T05).
    redactor: Redactor,
    /// The budget of the current issue request (RF-T03): the tightest of the issue's and the
    /// sprint's, with what was spent before this turn.
    budget: Mutex<Option<Budget>>,
    /// Who drove the PairCode session at the last human decision (RF-P04; `None` outside one).
    driver: Mutex<Option<String>>,
    /// RF-A03/A04: tool_use_id → the architect's rules a call under review breaks …
    violating: Mutex<HashMap<String, Vec<tutor_agent::conformance::Violation>>>,
    /// … and → the accepted ADR the architect overrode them with.
    overrides: Mutex<HashMap<String, String>>,
    /// RF-G03: tool_use_id of a running `bash` → the working tree's dirty files before it.
    bash_snaps: Mutex<HashMap<String, DirtyState>>,
    /// Board B (XP test-first): what this session changed for its issue, in order, until the first
    /// failing `run_tests` — the proof the Project checks before Review.
    tdd: Mutex<TddTrace>,
    /// When the session was opened in this run of the app (ms since the epoch; the Agent map).
    opened: u64,
}

/// A session open in this run of the app, as the Agent map lists it (`codev_agent_live`): the
/// map shows each one — today the chat's, later one per issue of a sprint — with its sub-agents.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub id: String,
    pub root: String,
    pub model: String,
    pub issue: Option<String>,
    pub busy: bool,
    pub opened: u64,
    /// Multi Co-Dev (phase 3): the worktree folder the session works in, and its branch.
    pub worktree: Option<String>,
    pub branch: Option<String>,
}

/// The open sessions, oldest first (read-only: nothing changes).
pub fn live_sessions() -> Vec<LiveSession> {
    let mut v: Vec<LiveSession> = sessions()
        .lock()
        .unwrap()
        .iter()
        .map(|(id, s)| LiveSession {
            id: id.clone(),
            root: s.project_root.display().to_string(),
            model: s.agent.cfg.model.clone(),
            issue: s.issue_key.lock().unwrap().clone(),
            busy: s.busy.load(Ordering::Relaxed),
            opened: s.opened,
            worktree: s.worktree.as_ref().map(|w| w.display().to_string()),
            branch: s
                .worktree
                .as_deref()
                .and_then(tutor_eval::git::current_branch),
        })
        .collect();
    v.sort_by(|a, b| a.opened.cmp(&b.opened).then_with(|| a.id.cmp(&b.id)));
    v
}

/// RF-P04: the UI says who drives a PairCode session when the human decides; the audit log
/// keeps it with every decision from then on (`None`: no session).
pub fn set_driver(id: &str, driver: Option<String>) {
    if let Ok(s) = get(id) {
        *s.driver.lock().unwrap() = driver.filter(|d| d == "host" || d == "guest");
    }
}

/// A Co-Dev budget in dollars (RF-T03, docs/v2/RF-DELONIX-PLANO.md F6.1).
#[derive(Debug, Clone, PartialEq)]
pub struct Budget {
    pub label: String,
    pub limit: f64,
    /// Spent before the current turn (real cost of the earlier turns, audit log).
    pub spent: f64,
    pub warned: bool,
}

impl Budget {
    fn left(&self) -> f64 {
        self.limit - self.spent
    }
}

/// What a request on the issue may still spend: the tightest of the issue's and its
/// sprint's budget (`None`: neither has one).
fn budget_for(s: &Session, key: &str) -> Option<Budget> {
    let db = s.change_log.as_ref()?;
    let st = tutor_board::project::ProjectStore::open(db).ok()?;
    let p = st
        .load(&s.project_root.display().to_string(), now_ms())
        .ok()?;
    let i = p.issues.iter().find(|i| i.key == key)?;
    let mut options = vec![];
    if let Some(limit) = i.budget_usd {
        options.push(Budget {
            label: key.to_string(),
            limit,
            spent: i.spent_usd,
            warned: false,
        });
    }
    if let Some(sp) = i
        .sprint
        .as_ref()
        .and_then(|id| p.sprints.iter().find(|x| &x.id == id))
    {
        if let Some(limit) = sp.budget_usd {
            options.push(Budget {
                label: sp.name.clone(),
                limit,
                spent: sp.spent_usd,
                warned: false,
            });
        }
    }
    options
        .into_iter()
        .min_by(|a, b| a.left().total_cmp(&b.left()))
}

/// RF-T03 after each request: at 80% the human is told; when the next request (as costly as
/// the last) would pass the limit, Co-Dev stops before it. Returns the notice, and whether to stop.
pub fn budget_check(b: &mut Budget, turn_cost: f64, last_request: f64) -> (Option<String>, bool) {
    let total = b.spent + turn_cost;
    if total + last_request > b.limit {
        return (
            Some(format!(
                "Orçamento de {} atingido (${total:.2} de ${:.2}): o Co-Dev parou antes de o ultrapassar. Para continuar, aumenta o orçamento e pede de novo.",
                b.label, b.limit
            )),
            true,
        );
    }
    if !b.warned && total >= 0.8 * b.limit {
        b.warned = true;
        return (
            Some(format!(
                "80% do orçamento de {}: ${total:.2} de ${:.2}.",
                b.label, b.limit
            )),
            false,
        );
    }
    (None, false)
}

/// A checkpoint as the UI lists it: whether the conversation can go back with the files.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointView {
    #[serde(flatten)]
    pub checkpoint: Checkpoint,
    pub conversation: bool,
}

/// What the host keeps of a hunk to record it once accepted.
#[derive(Clone, Default)]
struct HunkMeta {
    /// The new text of the hunk (for the architect's rules, RF-A03).
    text: String,
    call: String,
    path: String,
    start: u32,
    end: u32,
    added: u32,
    removed: u32,
}

/// Records accepted hunks in the project database (a failure is a notice, never fatal).
fn record_change_sets(
    s: &Session,
    metas: &[(String, HunkMeta)],
    decided_by: &str,
    emit: &dyn Fn(AgentEvent),
) {
    let Some(db) = &s.change_log else { return };
    if metas.is_empty() {
        return;
    }
    let issue = s.issue_key.lock().unwrap().clone();
    let root = s.project_root.display().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let r = tutor_board::project::ProjectStore::open(db).and_then(|mut st| {
        for (hunk, m) in metas {
            let cs = tutor_board::project::NewChangeSet {
                session: String::new(),
                call: m.call.clone(),
                hunk: hunk.clone(),
                path: m.path.clone(),
                start: m.start,
                end: m.end,
                added: m.added,
                removed: m.removed,
                decided_by: decided_by.to_string(),
                issue_key: issue.clone(),
            };
            st.record_change_set(&root, &cs, now)
                .map_err(|e| e.message)?;
        }
        Ok(())
    });
    if let Err(e) = r {
        emit(AgentEvent::Notice {
            text: format!("não foi possível registar as alterações no Project: {e}"),
        });
    }
}

/// How the host treats a call that carries hunks (RF-CODEV-STREAM §5; D1, D2).
#[derive(Debug, Clone, PartialEq)]
pub enum HunkGate {
    Deny(String),
    /// Auto: write now, validate at the end of the turn.
    Provisional,
    /// The human decides each hunk. `degraded`: Auto without a way to validate.
    Review {
        reason: String,
        degraded: bool,
    },
}

/// The policy's verdict, applied to a call with hunks. Rules that allow `edit` always do
/// not skip the review in Manual/Assist; protected files are reviewed even in Auto (the
/// policy asks for them); Auto applies provisionally only when it can validate and undo.
pub fn hunk_gate(verdict: Verdict, mode: Mode, can_validate: bool) -> HunkGate {
    let review = |r: &str, degraded| HunkGate::Review {
        reason: r.to_string(),
        degraded,
    };
    match verdict {
        Verdict::Deny { reason } => HunkGate::Deny(reason),
        Verdict::Ask { reason, .. } => HunkGate::Review {
            reason,
            degraded: false,
        },
        Verdict::Allow => match mode {
            Mode::Auto if can_validate => HunkGate::Provisional,
            Mode::Auto => review(
                "modo Auto sem validação automática (comando de testes ou lint e repositório \
                 git): revês cada alteração neste turno",
                true,
            ),
            Mode::Assist => review("modo Assistido: aceitas cada alteração no editor", false),
            Mode::Manual => review("modo Manual: aceitas cada alteração no editor", false),
        },
    }
}

/// What the host tracks during one turn for Auto mode's validation.
#[derive(Default)]
struct AutoTurn {
    /// The checks run before the first provisional change.
    baseline: Option<Vec<Check>>,
    /// Hunks written provisionally this turn.
    provisional: Vec<String>,
    /// The turn's checkpoint (rollback target).
    checkpoint: Option<u32>,
    /// The "Auto degrades to review" notice was shown this turn.
    degraded: bool,
    /// Provisional hunks, recorded as change sets only if validation passes.
    provisional_meta: Vec<(String, HunkMeta)>,
}

/// O texto que anuncia o modo ao modelo (vai como mensagem `system` a meio da conversa,
/// para não mexer no system prompt de topo — que invalidaria a cache).
pub fn mode_note(m: Mode) -> String {
    let d = match m {
        Mode::Manual => "Manual — cada edição e comando é aprovado pelo humano antes de correr",
        Mode::Assist => {
            "Assistido — edições e comandos seguros correm sozinhos; o resto pede aprovação"
        }
        Mode::Auto => "Auto — só as acções perigosas pedem aprovação",
    };
    format!("Modo de autonomia: {d}.")
}

fn sessions_dir(base: Option<&Path>, root: &str) -> Option<PathBuf> {
    let base = base.map(Path::to_path_buf).or_else(session::default_base)?;
    Some(session::project_dir(&base, root))
}

fn sessions() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    static S: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

fn new_id() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("cda-{t:x}-{}", N.fetch_add(1, Ordering::Relaxed))
}

/// `effort` da UI → enum (desconhecido → o valor por omissão do harness, `high`).
pub fn parse_effort(s: Option<&str>) -> Effort {
    match s.map(|x| x.trim().to_ascii_lowercase()).as_deref() {
        Some("low") => Effort::Low,
        Some("medium") => Effort::Medium,
        Some("xhigh") => Effort::Xhigh,
        Some("max") => Effort::Max,
        _ => Effort::High,
    }
}

/// Abre uma sessão. `key_for(provedor)` dá a chave desse provedor (o adaptador usa
/// `keys::resolve`, que conhece a pasta de configuração da app) — numa retoma o provedor
/// só se sabe depois de ler a sessão.
pub fn start(
    spec: StartSpec,
    key_for: &dyn Fn(&str) -> Option<String>,
    workspace_id: Option<String>,
) -> Result<String, String> {
    // a session that works in a worktree is checked and opened while no close removes one
    let _guard = (spec.worktree.is_some() || spec.resume.is_some())
        .then(|| worktree_lock().lock().unwrap_or_else(|p| p.into_inner()));
    let root = PathBuf::from(spec.root.trim());
    if !root.is_dir() {
        return Err(format!(
            "a pasta do projecto não existe: {}",
            root.display()
        ));
    }
    let root_s = root.display().to_string();
    let dir = sessions_dir(spec.sessions_base.as_deref(), &root_s);

    // sessão nova: monta o prefixo; retoma: lê-o do ficheiro, tal como foi gravado
    let (meta, transcript, log) = match spec.resume.as_deref().filter(|r| !r.trim().is_empty()) {
        Some(rid) => {
            let dir = dir
                .as_ref()
                .ok_or("sem pasta de sessões (HOME por definir)")?;
            if let Some(live) = sessions().lock().unwrap().get(rid) {
                // já aberta nesta execução: reutiliza (o modo segue a modebar)
                live.policy.lock().unwrap().mode =
                    Mode::parse(spec.mode.as_deref().unwrap_or("manual"));
                return Ok(rid.to_string());
            }
            let (meta, t, log) = SessionLog::open(dir, rid)?;
            if Path::new(&meta.root) != root {
                return Err(format!(
                    "a sessão {rid} pertence a outro projecto ({})",
                    meta.root
                ));
            }
            (meta, t, Some(log))
        }
        None => {
            let provider = spec
                .provider
                .as_deref()
                .map(|p| p.trim().to_ascii_lowercase())
                .filter(|p| !p.is_empty())
                .unwrap_or_else(|| "claude".into());
            if !PROVIDERS.contains(&provider.as_str()) {
                return Err(format!("provedor desconhecido para o agente: {provider}"));
            }
            let worktree = match &spec.worktree {
                Some(w) => Some(worktree_of(&root, w, spec.issue_key.as_deref())?),
                None => None,
            };
            let meta = SessionMeta {
                id: new_id(),
                root: root_s.clone(),
                model: resolve_model(&provider, spec.model.as_deref()),
                effort: parse_effort(spec.effort.as_deref()).as_str().to_string(),
                system: session_system(
                    worktree.as_deref().unwrap_or(&root),
                    spec.review_edits,
                    ReplyLang::from_ui(spec.lang.as_deref()),
                ),
                test_cmd: spec.test_cmd.clone().filter(|c| !c.trim().is_empty()),
                lint_cmd: spec.lint_cmd.clone().filter(|c| !c.trim().is_empty()),
                compaction: provider_features(&provider).compaction,
                created: session::now(),
                toolset: TOOLSET_VERSION,
                mcp_tools: vec![], // preenchido abaixo, depois de ligar os servidores
                provider,
                lang: spec.lang.clone().filter(|l| !l.trim().is_empty()),
                scopes: session_scopes(&spec),
                worktree: worktree.map(|w| w.display().to_string()),
            };
            (meta, Transcript::new(), None)
        }
    };
    // Multi Co-Dev (phase 3): the tools work in the session's worktree, when it has one; the
    // project (database, audit log, roles, permissions, claims) stays `root`
    let work_root = match meta.worktree.as_deref() {
        Some(w) => {
            let p = PathBuf::from(w);
            if !p.is_dir() {
                return Err(format!(
                    "a worktree desta sessão já não existe ({w}): começa a issue de novo para a criar"
                ));
            }
            p
        }
        None => root.clone(),
    };

    let provider = make_provider(
        &meta.provider,
        key_for(&meta.provider),
        spec.ollama_host.as_deref(),
        workspace_id,
    )?;

    // servidores MCP: ligam-se sempre; numa sessão nova as definições anunciadas ficam
    // gravadas, numa retoma usam-se as gravadas (o prefixo do pedido não pode mudar)
    let mut notes = vec![];
    let mut meta = meta;
    let new_session = log.is_none();
    let connected = if meta.toolset >= 3 {
        let (tools, mut n) =
            mcp::connect_all(&mcp_servers(&root, &spec, &mut notes), &work_root);
        notes.append(&mut n);
        tools
    } else {
        vec![]
    };
    if new_session && meta.toolset >= 3 {
        meta.mcp_tools = connected.iter().map(|(d, _)| d.clone()).collect();
    }
    let mcp_tools: Vec<Arc<dyn Tool>> = meta
        .mcp_tools
        .iter()
        .map(|d| {
            let client = connected
                .iter()
                .find(|(c, _)| c.server == d.server && c.tool == d.tool)
                .map(|(_, cl)| cl.clone());
            Arc::new(McpTool {
                def: d.clone(),
                client,
            }) as Arc<dyn Tool>
        })
        .collect();
    // sem registo em disco a sessão funciona na mesma (só não se retoma)
    let log = match log {
        Some(l) => Some(l),
        None => dir.as_ref().and_then(|d| SessionLog::create(d, &meta).ok()),
    };

    let mut acfg = AgentConfig::new(meta.model.clone());
    acfg.effort = parse_effort(Some(&meta.effort));
    acfg.compaction = meta.compaction;
    // the human's review pauses often pass 5 minutes: the prefix (tools + system) lives an hour
    if meta.provider == "claude" {
        acfg.cache_ttl = CacheTtl::OneHour;
    }
    acfg.system = meta
        .system
        .iter()
        .map(|(text, cache)| SystemBlock {
            text: text.clone(),
            cache: *cache,
        })
        .collect();
    let flow = FlowState::default();
    let mode = Mode::parse(spec.mode.as_deref().unwrap_or("manual"));
    let mut policy = Policy::new(
        mode,
        Rules::load(&root, Rules::user_file().as_deref()),
        work_root.clone(),
    );
    policy.plan = flow.plan_mode.clone();
    // RF-G01: in the IDE every action answers a human request (the UI sends its origin)
    policy.require_origin = true;
    // toolset 6: plan before changing files in Manual/Assist, and a question stops changes
    if meta.toolset >= 6 {
        policy.gates = Some(Gates {
            plan_approved: flow.plan_approved.clone(),
            question: flow.question.clone(),
            finished: flow.finished.clone(),
        });
    }
    let redactor = Redactor::for_root(&root);
    let mut log = log;
    if let Some(l) = log.as_mut() {
        l.set_redactor(redactor.clone());
    }
    let checkpoints = Checkpoints::new(&work_root, &meta.id).map(Arc::new);
    // live hunks: the read/edit/write state is shared between the tools and the loop
    let files = spec.review_edits.then(|| Arc::new(FileState::default()));
    let checks: Vec<String> = [meta.test_cmd.clone(), meta.lint_cmd.clone()]
        .into_iter()
        .flatten()
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
        .collect();
    let ctx = ToolCtx {
        root: work_root.clone(),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let subagent = SubagentSpec {
        provider: provider.clone(),
        model: meta.model.clone(),
        effort: acfg.effort,
        lang: meta.lang(),
    };
    let tools = agent_tools(
        &ToolsetOptions {
            test_cmd: meta.test_cmd.clone(),
            lint_cmd: meta.lint_cmd.clone(),
            files: files.clone(),
            issue: meta.has_scope(session::SCOPE_ISSUE),
            ..Default::default()
        },
        meta.toolset,
        &flow,
        Some(subagent),
        session_host_tools(&spec, &meta)
            .into_iter()
            .chain(mcp_tools)
            .collect(),
    );
    let mut agent = Agent::new(provider, tools, acfg, ctx);
    agent.checkpoints = checkpoints;
    agent.hunks = files;
    // hooks do projecto: só se o humano confiou neste ficheiro, tal como está. Numa worktree
    // (fase 3) correm lá, e só se o ficheiro de lá for byte a byte o que foi confiado
    if root.join(HOOKS_FILE).exists() {
        let store = spec.trust_store.clone();
        if store
            .as_deref()
            .is_some_and(|st| trust::is_trusted(st, &root, HOOKS_FILE))
        {
            let same = work_root == root
                || std::fs::read(root.join(HOOKS_FILE)).ok()
                    == std::fs::read(work_root.join(HOOKS_FILE)).ok();
            if same {
                match Hooks::load(&work_root) {
                    Ok(h) => agent.hooks = h.map(Arc::new),
                    Err(e) => notes.push(e),
                }
            } else {
                notes.push(format!(
                    "os hooks ({HOOKS_FILE}) da worktree desta sessão não são os que confiaste: ficam desligados nela"
                ));
            }
        } else {
            notes.push(format!(
                "o projecto define hooks ({HOOKS_FILE}) que ainda não confiaste — vê /comandos"
            ));
        }
    }

    if let Some(n) = features_notice(&meta.provider, &meta.model) {
        notes.insert(0, n);
    }
    let id = meta.id.clone();
    let s = Session {
        id: id.clone(),
        project_root: root.clone(),
        worktree: meta.worktree.as_ref().map(PathBuf::from),
        agent,
        transcript: Mutex::new(transcript),
        busy: AtomicBool::new(false),
        policy: Mutex::new(policy),
        pending: Mutex::new(HashMap::new()),
        log: Mutex::new(log),
        announced: Mutex::new(None),
        flow,
        notes: Mutex::new(vec![]),
        startup_notices: notes,
        review_edits: spec.review_edits,
        checks,
        review: Mutex::new(HashMap::new()),
        change_log: spec.change_log.clone(),
        issue_key: Mutex::new(spec.issue_key.clone().filter(|k| !k.trim().is_empty())),
        cp_marks: Mutex::new(HashMap::new()),
        origin: Mutex::new(None),
        redactor,
        budget: Mutex::new(None),
        driver: Mutex::new(None),
        violating: Mutex::new(HashMap::new()),
        overrides: Mutex::new(HashMap::new()),
        bash_snaps: Mutex::new(HashMap::new()),
        tdd: Mutex::new(TddTrace::default()),
        opened: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    };
    sessions().lock().unwrap().insert(id.clone(), Arc::new(s));
    Ok(id)
}

/// The extra toolsets of a new session (toolset 9): `issue` when it works on a Project issue
/// (the board/Project always open a new session for one), `arch` when the UI marks it as an
/// architecture session.
fn session_scopes(spec: &StartSpec) -> Vec<String> {
    let mut v = vec![];
    if spec
        .issue_key
        .as_deref()
        .is_some_and(|k| !k.trim().is_empty())
    {
        v.push(session::SCOPE_ISSUE.to_string());
    }
    if spec.architecture {
        v.push(session::SCOPE_ARCH.to_string());
    }
    v
}

/// Multi Co-Dev (phase 3): the worktree a new issue session works in must be a linked worktree of the
/// project's own repository (never the project folder itself, never another repository).
fn worktree_of(root: &Path, w: &Path, issue: Option<&str>) -> Result<PathBuf, String> {
    if !issue.is_some_and(|k| !k.trim().is_empty()) {
        return Err("uma worktree só serve uma sessão que trabalha numa issue".into());
    }
    if !w.is_dir() {
        return Err(format!("a worktree não existe: {}", w.display()));
    }
    if !tutor_eval::gitwork::codev::same_repo(root, w) {
        return Err(format!(
            "{} não é uma worktree do repositório de {}",
            w.display(),
            root.display()
        ));
    }
    std::fs::canonicalize(w).map_err(|e| format!("{}: {e}", w.display()))
}

/// As ferramentas do anfitrião de uma sessão com o conjunto `toolset`: as da versão 3
/// sempre, as da versão 4 só a partir dela (uma sessão antiga retoma sem elas — o prefixo
/// do pedido não pode mudar) e, desde a 9, só nas sessões de arquitectura. Ordem fixa.
fn session_host_tools(spec: &StartSpec, meta: &SessionMeta) -> Vec<Arc<dyn Tool>> {
    let toolset = meta.toolset;
    let arch = meta.has_scope(session::SCOPE_ARCH);
    let v4 = spec.host_tools_v4.iter().filter(|_| toolset >= 4 && arch);
    let v8 = spec.host_tools_v8.iter().filter(|_| toolset >= 8);
    spec.host_tools
        .iter()
        .chain(v4)
        .chain(v8)
        .cloned()
        .collect()
}

fn get(id: &str) -> Result<Arc<Session>, String> {
    sessions()
        .lock()
        .unwrap()
        .get(id)
        .cloned()
        .ok_or_else(|| format!("sessão desconhecida: {id}"))
}

/// Corre um turno **de forma bloqueante** (o adaptador chama isto numa thread).
/// `text: None` repete a partir do histórico actual (botão «tentar de novo»).
/// `on_event` recebe os eventos do loop; `on_approval` é chamado quando uma chamada
/// precisa de decisão humana — a resposta chega por [`approve`].
pub fn send(
    id: &str,
    text: Option<String>,
    origin: Option<Origin>,
    on_event: &mut dyn FnMut(AgentEvent),
    on_approval: &mut dyn FnMut(&ApprovalRequest),
) -> Result<TurnOutcome, String> {
    let s = get(id)?;
    if s.busy.swap(true, Ordering::SeqCst) {
        return Err("a sessão já está a correr um turno".into());
    }
    // RF-G01: the turn's human request. A new message brings its own (none → its actions are
    // blocked); «try again» (`text: None`) answers the same request as before.
    if text.is_some() {
        let o = origin.map(|mut o| {
            o.by = crate::board::actor(&s.project_root.display().to_string());
            o.scope.retain(|p| !p.trim().is_empty());
            o
        });
        // a new request needs its own plan, answers the last question and starts a new issue run
        s.flow.plan_approved.store(false, Ordering::SeqCst);
        *s.flow.question.lock().unwrap() = None;
        *s.flow.finished.lock().unwrap() = None;
        s.flow.criteria.lock().unwrap().clear();
        s.flow.dod.lock().unwrap().clear();
        let mut o = o;
        if let Some(k) = o.as_ref().and_then(|o| o.issue.clone()) {
            *s.issue_key.lock().unwrap() = Some(k.clone());
            // RF-B02/G01: an issue request counts only when the issue is Ready
            let project = project_of(&s);
            let issue = project
                .as_ref()
                .and_then(|p| p.issues.iter().find(|i| i.key == k).cloned());
            // Board B: starting work moves a Ready issue to In progress by the normal move (WIP,
            // readiness); refused, the request does nothing until the human moves it
            let started = match &issue {
                Some(i) if i.missing.is_empty() && i.state == "todo" => {
                    start_work(&s, &k, o.as_ref())
                }
                _ => Ok(()),
            };
            match issue {
                Some(i) if !i.missing.is_empty() => {
                    (*on_event)(AgentEvent::Notice {
                        text: format!(
                            "{k} ainda não está Ready (falta: {}): as acções deste pedido ficam bloqueadas.",
                            i.missing.join("; ")
                        ),
                    });
                    o = None;
                }
                Some(_) if started.is_err() => {
                    let why = started.err().unwrap_or_default();
                    (*on_event)(AgentEvent::Notice {
                        text: format!(
                            "{k} não passou a Em curso ({why}): as acções deste pedido ficam bloqueadas. Move-a no quadro — com um motivo, se for uma excepção — e pede de novo."
                        ),
                    });
                    o = None;
                }
                Some(i) => {
                    *s.flow.criteria.lock().unwrap() =
                        i.acceptance.iter().map(|c| c.text.clone()).collect();
                    *s.flow.dod.lock().unwrap() =
                        project.as_ref().map(|p| p.dod.clone()).unwrap_or_default();
                    if let Some(origin) = o.as_mut() {
                        if origin.scope.is_empty() {
                            origin.scope = i.scope.clone();
                        }
                    }
                }
                None => {}
            }
        }
        // RF-T03: the budget of the issue (or its sprint) this request may spend
        let budget = o
            .as_ref()
            .and_then(|o| o.issue.as_deref())
            .and_then(|k| budget_for(&s, k));
        if let Some(b) = &budget {
            if b.left() <= 0.0 {
                s.busy.store(false, Ordering::SeqCst);
                return Err(format!(
                    "O orçamento de {} está esgotado (${:.2} de ${:.2}): aumenta-o para o Co-Dev continuar.",
                    b.label, b.spent, b.limit
                ));
            }
        }
        *s.budget.lock().unwrap() = budget;
        *s.origin.lock().unwrap() = o;
    }
    s.policy.lock().unwrap().origin = s.origin.lock().unwrap().clone();
    s.agent.ctx.cancel.store(false, Ordering::Relaxed);
    let session = s.clone();
    // one sink for the loop's events and the host's own (hunk_review, validation): one
    // channel, in the order things happen (RF-CODEV-STREAM I4)
    let sink = RefCell::new(on_event);
    // the turn's report is built from every event the UI sees (HARNESS-07)
    let turn_log: RefCell<Option<tutor_agent::report::TurnLog>> = RefCell::new(None);
    let turn_start = std::cell::Cell::new(0usize);
    let emit = |e: AgentEvent| {
        if let Some(l) = turn_log.borrow_mut().as_mut() {
            l.observe(&e);
        }
        (**sink.borrow_mut())(e)
    };
    let auto = RefCell::new(AutoTurn::default());
    let held_done: RefCell<Option<AgentEvent>> = RefCell::new(None);
    let metas: RefCell<HashMap<String, HunkMeta>> = RefCell::new(HashMap::new());
    // the turn's tokens and model, for the audit log
    let turn_usage: RefCell<Option<tutor_agent::provider::Usage>> = RefCell::new(None);
    let served_by: RefCell<Option<String>> = RefCell::new(None);
    let mut on_loop_event = |e: AgentEvent| {
        match &e {
            AgentEvent::Usage { turn, request } => {
                *turn_usage.borrow_mut() = Some(*turn);
                // RF-T03: warn at 80%, stop before the limit
                let model = served_by
                    .borrow()
                    .clone()
                    .unwrap_or_else(|| session.agent.cfg.model.clone());
                if let (Some(tc), Some(rc)) = (
                    tutor_agent::cost::cost_usd(&model, turn),
                    tutor_agent::cost::cost_usd(&model, request),
                ) {
                    let check = session
                        .budget
                        .lock()
                        .unwrap()
                        .as_mut()
                        .map(|b| budget_check(b, tc, rc));
                    if let Some((Some(text), stop)) = check {
                        emit(AgentEvent::Notice { text: text.clone() });
                        if stop {
                            session.agent.ctx.cancel.store(true, Ordering::Relaxed);
                            let mut e = audit_entry(&session, "budget");
                            e.reason = Some(text);
                            e.outcome = Some("stopped".into());
                            audit(&session, e);
                        }
                    }
                }
            }
            AgentEvent::ServedBy { model } => *served_by.borrow_mut() = Some(model.clone()),
            AgentEvent::Checkpoint { id, .. } => {
                auto.borrow_mut().checkpoint = Some(*id);
                session
                    .cp_marks
                    .lock()
                    .unwrap()
                    .insert(*id, turn_start.get());
            }
            AgentEvent::HunkStart {
                hunk,
                call,
                path,
                range,
                ..
            } => {
                metas.borrow_mut().insert(
                    hunk.clone(),
                    HunkMeta {
                        call: call.clone(),
                        path: path.clone(),
                        start: range.start as u32,
                        end: range.end as u32,
                        ..Default::default()
                    },
                );
            }
            AgentEvent::HunkEnd { hunk, lines, text } => {
                if let Some(m) = metas.borrow_mut().get_mut(hunk) {
                    m.text = text.clone();
                    m.added = lines.added as u32;
                    m.removed = lines.removed as u32;
                }
            }
            AgentEvent::HunkApplied {
                hunk, provisional, ..
            } => {
                let m = metas.borrow().get(hunk).cloned().unwrap_or_default();
                tdd_observe(&session, &e, Some((&m.path, &m.text)));
                if *provisional {
                    let mut a = auto.borrow_mut();
                    a.provisional.push(hunk.clone());
                    a.provisional_meta.push((hunk.clone(), m));
                } else {
                    record_change_sets(&session, &[(hunk.clone(), m)], "human", &emit);
                }
            }
            // `done` waits for Auto's validation and the turn's report (sent after the turn)
            AgentEvent::Done { .. } => {
                *held_done.borrow_mut() = Some(e);
                return;
            }
            // RF-G03: a `bash` command may write outside the issue's scope without the policy seeing
            // the files — the working tree before and after it says what it changed
            AgentEvent::ToolStart { id, name, .. } if name == "bash" => {
                bash_scope_start(&session, id)
            }
            AgentEvent::ToolResult { id, name, .. } if name == "bash" => {
                bash_scope_end(&session, id, &mut |n| emit(n))
            }
            // Board B: a failing run_tests with only tests changed is the red step of TDD
            AgentEvent::ToolResult { .. } => {
                if let Some(tests) = tdd_observe(&session, &e, None) {
                    let mut a = audit_entry(&session, "tdd");
                    a.tool = Some("run_tests".into());
                    a.path = Some(tests);
                    a.outcome = Some("red".into());
                    audit(&session, a);
                }
            }
            _ => {}
        }
        emit(e);
    };
    // did the last decision wait for the human? (who decided, for the audit log)
    let asked_human = std::cell::Cell::new(false);
    let mut decide_call = |call: &PendingCall, verdict: Verdict| -> Decision {
        if session.review_edits && !call.hunks.is_empty() {
            let mode = session.policy.lock().unwrap().mode;
            let can_validate = !session.checks.is_empty() && session.agent.checkpoints.is_some();
            let reason = match hunk_gate(verdict, mode, can_validate) {
                HunkGate::Deny(reason) => return Decision::Deny(reason),
                HunkGate::Provisional => {
                    // the baseline: the checks before the turn's first change
                    if auto.borrow().baseline.is_none() {
                        emit(AgentEvent::Validation {
                            status: ValidationStatus::Running,
                            checks: vec![],
                            baseline: vec![],
                        });
                        let b = hunks::run_checks(&session.checks, &session.agent.ctx);
                        auto.borrow_mut().baseline = Some(b);
                    }
                    return Decision::Hunks {
                        accepted: call.hunks.clone(),
                        rejected: vec![],
                        provisional: true,
                    };
                }
                HunkGate::Review { reason, degraded } => {
                    if degraded && !std::mem::replace(&mut auto.borrow_mut().degraded, true) {
                        emit(AgentEvent::Notice {
                            text: reason.clone(),
                        });
                    }
                    reason
                }
            };
            let (tx, rx) = mpsc::channel();
            session
                .pending
                .lock()
                .unwrap()
                .insert(call.id.clone(), (tx, None));
            session
                .review
                .lock()
                .unwrap()
                .insert(call.id.clone(), call.hunks.clone());
            let violations = session
                .violating
                .lock()
                .unwrap()
                .get(&call.id)
                .cloned()
                .unwrap_or_default();
            emit(AgentEvent::HunkReview {
                call: call.id.clone(),
                hunks: call.hunks.clone(),
                reason,
                why: None,
                violations,
            });
            asked_human.set(true);
            let d = wait_decision(&rx, &session.agent.ctx.cancel);
            session.pending.lock().unwrap().remove(&call.id);
            session.review.lock().unwrap().remove(&call.id);
            session.violating.lock().unwrap().remove(&call.id);
            session.overrides.lock().unwrap().remove(&call.id);
            return d;
        }
        let (reason, dangerous, suggested_rule) = match verdict {
            Verdict::Allow => return Decision::Allow,
            Verdict::Deny { reason } => return Decision::Deny(reason),
            Verdict::Ask {
                reason,
                dangerous,
                suggested_rule,
            } => (reason, dangerous, suggested_rule),
        };
        let (tx, rx) = mpsc::channel();
        session
            .pending
            .lock()
            .unwrap()
            .insert(call.id.clone(), (tx, suggested_rule.clone()));
        on_approval(&ApprovalRequest {
            call: call.clone(),
            reason,
            dangerous,
            suggested_rule,
        });
        asked_human.set(true);
        let d = wait_decision(&rx, &session.agent.ctx.cancel);
        session.pending.lock().unwrap().remove(&call.id);
        d
    };
    // every decision on an action goes to the audit log (RF-T01)
    let mut approve = |call: &PendingCall| -> Decision {
        let verdict = rewrite_gate(
            session.policy.lock().unwrap().decide(call),
            call,
            &session.agent.ctx.root,
            &metas.borrow(),
        );
        // RF-A03/A04: in the IDE's review a change that breaks the rules reaches the human, in red,
        // and is accepted only with the architect's override; elsewhere (CLI/TUI) it is refused
        let verdict = if session.review_edits && !call.hunks.is_empty() {
            match violations_of(
                call,
                &session.project_root,
                &session.agent.ctx.root,
                &metas.borrow(),
            ) {
                Ok(v) => {
                    let verdict = review_conformance(verdict, &v);
                    if !v.is_empty() && !matches!(verdict, Verdict::Deny { .. }) {
                        session.violating.lock().unwrap().insert(call.id.clone(), v);
                    }
                    verdict
                }
                Err(reason) => Verdict::Deny { reason },
            }
        } else {
            conformance_gate(
                verdict,
                call,
                &session.project_root,
                &session.agent.ctx.root,
                &metas.borrow(),
            )
        };
        let verdict = role_gate(verdict, call, &session.project_root, &session.agent.ctx.root);
        // Multi Co-Dev (phase 3): a file another open session claimed is refused here
        let (verdict, claimed_now) = claim_gate(&session, call, verdict);
        asked_human.set(false);
        let d = decide_call(call, verdict.clone());
        if let Some(path) = &claimed_now {
            // the write did not happen: the claim it took goes back
            let refused = match &d {
                Decision::Deny(_) => true,
                Decision::Hunks { accepted, .. } => accepted.is_empty(),
                _ => false,
            };
            if refused {
                release_claim(&session, path);
            }
        }
        let mut e = audit_entry(&session, "call");
        e.tool = Some(call.name.clone());
        e.call = Some(call.id.clone());
        e.path = call
            .input
            .get("path")
            .and_then(|p| p.as_str())
            .map(str::to_string);
        let ranges: Vec<String> = call
            .hunks
            .iter()
            .filter_map(|h| {
                metas
                    .borrow()
                    .get(h)
                    .map(|m| format!("{}-{}", m.start, m.end))
            })
            .collect();
        e.lines = (!ranges.is_empty()).then(|| ranges.join(","));
        e.command = call.command.clone();
        let (verdict_s, reason) = match &verdict {
            Verdict::Allow => ("allow", None),
            Verdict::Ask { reason, .. } => ("ask", Some(reason.clone())),
            Verdict::Deny { reason } => ("deny", Some(reason.clone())),
        };
        e.verdict = Some(verdict_s.into());
        e.outcome = Some(outcome_of(&d).into());
        e.decided_by = Some(if session.agent.ctx.cancel.load(Ordering::Relaxed) {
            "cancel".to_string()
        } else if asked_human.get() {
            format!("human:{}", e.actor)
        } else {
            "policy".to_string()
        });
        e.decided_at = Some(now_ms());
        e.reason = match &d {
            Decision::Deny(r) => Some(r.clone()),
            _ => reason,
        };
        audit(&session, e);
        d
    };
    let mut t = s.transcript.lock().unwrap();
    turn_start.set(t.len());
    *turn_log.borrow_mut() = Some(tutor_agent::report::TurnLog::new(
        text.as_deref().unwrap_or("(repetição do último pedido)"),
        now_ms() as u64,
    ));
    let r = match text {
        Some(q) => {
            // slash commands do projecto (.dxtutor/commands): o modelo recebe o prompt expandido
            let q = match extensions::expand(&s.project_root, &q) {
                Some((_, prompt)) => prompt,
                None => q,
            };
            if t.is_empty() {
                for text in &s.startup_notices {
                    emit(AgentEvent::Notice { text: text.clone() });
                }
            }
            t.push(Message::user_text(q));
            // anuncia o modo no primeiro turno e quando muda (mensagem system a meio)
            let mode = s.policy.lock().unwrap().mode;
            let mut announced = s.announced.lock().unwrap();
            if *announced != Some(mode) {
                *announced = Some(mode);
                t.push(Message::system(mode_note(mode)));
            }
            drop(announced);
            for n in std::mem::take(&mut *s.notes.lock().unwrap()) {
                t.push(Message::system(n));
            }
            s.agent
                .run_turn(&mut t, None, &mut on_loop_event, &mut approve)
        }
        // «tentar de novo»: continua do histórico, sem nota nova
        None => s
            .agent
            .run_turn(&mut t, None, &mut on_loop_event, &mut approve),
    };
    if let Some(log) = s.log.lock().unwrap().as_mut() {
        let _ = log.sync(&t); // append-only: só as mensagens novas
    }
    drop(t);
    let stopped = matches!(&r, Ok(TurnOutcome::Cancelled));
    // Auto: validate the provisional changes, then tell the UI the turn is done
    let turn = auto.take();
    let turn_checkpoint = turn.checkpoint;
    if !turn.provisional.is_empty() {
        validate(&s, turn, &emit);
    }
    // RF-G07: after Stop, what was already written stays (after Auto's validation, which may have
    // undone it) — the human keeps it or drops it, from the chat
    if stopped {
        stop_review(&s, turn_checkpoint, &emit);
    }
    settle_flow(&s, &emit);
    if let Some(log) = turn_log.take() {
        report_turn(&s, log, &emit);
    }
    let usage = turn_usage.take().unwrap_or_default();
    let model = served_by
        .take()
        .unwrap_or_else(|| s.agent.cfg.model.clone());
    let mut e = audit_entry(&s, "turn");
    e.tokens_in = Some(
        (usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens)
            as i64,
    );
    e.tokens_out = Some(usage.output_tokens as i64);
    // RF-T04: the cost from the provider's real tokens
    e.cost_usd = tutor_agent::cost::cost_usd(&model, &usage);
    e.model = Some(model);
    e.outcome = Some(
        match &r {
            Ok(TurnOutcome::Done { .. }) => "done",
            Ok(TurnOutcome::Cancelled) => "cancelled",
            Ok(TurnOutcome::Refused { .. }) => "refused",
            Ok(TurnOutcome::IterationLimit) => "iteration_limit",
            Err(_) => "error",
        }
        .into(),
    );
    audit(&s, e);
    if let Some(done) = held_done.take() {
        emit(done);
    }
    s.busy.store(false, Ordering::SeqCst);
    r.map_err(|e: AgentError| match &e {
        AgentError::Provider(p) if openai::is_tools_unsupported(p) => format!("{NO_TOOLS_MARK}{e}"),
        _ => e.to_string(),
    })
}

/// Appends one row to the project's audit log (RF-T01), with the secrets masked (RF-T05).
/// Without a project database (tests, no folder) nothing is recorded.
fn audit(s: &Session, mut e: tutor_board::project::AuditEntry) {
    let Some(db) = &s.change_log else { return };
    let mask = |v: &mut Option<String>| {
        if let Some(x) = v.as_mut() {
            *x = s.redactor.mask(x);
        }
    };
    mask(&mut e.command);
    mask(&mut e.path);
    mask(&mut e.reason);
    let root = s.project_root.display().to_string();
    if let Ok(mut st) = tutor_board::project::ProjectStore::open(db) {
        let _ = st.record_audit(&root, &e);
    }
}

/// The project-relative path of a tool's `path` (relative already, or absolute inside the folder
/// the session works in — its worktree — or the project folder).
fn project_rel<'a>(path: &'a str, root: &Path, work: &Path) -> &'a str {
    path.strip_prefix(&format!("{}/", work.display()))
        .or_else(|| path.strip_prefix(&format!("{}/", root.display())))
        .unwrap_or(path)
}

/// RF-A06/A04 (docs/v2/RF-DELONIX-PLANO.md F5.7): a change to the architect's rules or to an
/// ADR is approved only by an architect, and to a prompt template by an architect or the tech
/// lead (`.dxtutor/team.json`). Such a change always asks — in Auto too, so the agent never
/// accepts an ADR on its own — and when the person here lacks the role it is refused.
fn role_gate(verdict: Verdict, call: &PendingCall, root: &Path, work: &Path) -> Verdict {
    if matches!(verdict, Verdict::Deny { .. }) {
        return verdict;
    }
    let Some(path) = call.input.get("path").and_then(|p| p.as_str()) else {
        return verdict;
    };
    let rel = project_rel(path, root, work);
    let Some(need) = crate::roles::approvers_of(rel) else {
        return verdict;
    };
    if let Err(reason) =
        crate::roles::require(root, need, &format!("aprovar uma alteração a {rel}"))
    {
        return Verdict::Deny { reason };
    }
    match verdict {
        Verdict::Allow => Verdict::Ask {
            reason: format!(
                "{rel}: alteração às regras, a um ADR ou ao template — aprovação humana"
            ),
            dangerous: true,
            suggested_rule: None,
        },
        v => v,
    }
}

/// RF-A03/A04 (docs/v2/RF-DELONIX-PLANO.md F5.3): every change of the agent goes through the
/// architect's rules (`.dxtutor/architecture.toml`) before it can be accepted. A forbidden or
/// unapproved library, a layer dependency that is not allowed or a broken naming rule refuses
/// the change — in every mode — unless an accepted ADR excuses that rule in `[[exceptions]]`.
/// Only the lines the change adds are checked (what was already there is the drift, F5.5).
fn conformance_gate(
    verdict: Verdict,
    call: &PendingCall,
    root: &Path,
    work: &Path,
    metas: &HashMap<String, HunkMeta>,
) -> Verdict {
    if matches!(verdict, Verdict::Deny { .. }) {
        return verdict;
    }
    match violations_of(call, root, work, metas) {
        Err(reason) => Verdict::Deny { reason },
        Ok(left) if left.is_empty() => verdict,
        Ok(left) => Verdict::Deny {
            reason: format!(
                "viola as regras do arquitecto (RF-A03): {} — um desvio só com um ADR aceite em [[exceptions]] de {} (pede-o com ask_human; podes redigir o ADR, não o aprovas)",
                left.iter().map(|v| v.message.clone()).collect::<Vec<_>>().join("; "),
                tutor_agent::conformance::RULES_FILE
            ),
        },
    }
}

/// RF-A03/A04 (sessão de fecho, bloco 3): in the IDE's review, a change that breaks the rules is
/// not refused before the human sees it — it asks (in Auto too: `dangerous`), drawn in red, and
/// `review` accepts it only after `override_violation`.
fn review_conformance(
    verdict: Verdict,
    violations: &[tutor_agent::conformance::Violation],
) -> Verdict {
    if violations.is_empty() || matches!(verdict, Verdict::Deny { .. }) {
        return verdict;
    }
    Verdict::Ask {
        reason: format!(
            "viola as regras do arquitecto (RF-A03): {} — só se aceita com o override do Arquitecto e um ADR aceite",
            violation_text(violations)
        ),
        dangerous: true,
        suggested_rule: None,
    }
}

fn violation_text(v: &[tutor_agent::conformance::Violation]) -> String {
    v.iter()
        .map(|x| x.message.clone())
        .collect::<Vec<_>>()
        .join("; ")
}

/// The architect's rules a call breaks and no accepted ADR excuses; `Err` when the rules file
/// cannot be read. Empty when there are no rules or the call writes no file.
fn violations_of(
    call: &PendingCall,
    root: &Path,
    work: &Path,
    metas: &HashMap<String, HunkMeta>,
) -> Result<Vec<tutor_agent::conformance::Violation>, String> {
    let Some(path) = call.input.get("path").and_then(|p| p.as_str()) else {
        return Ok(vec![]);
    };
    let text = if call.hunks.is_empty() {
        ["new_string", "new_text", "content"]
            .iter()
            .find_map(|k| call.input.get(*k).and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_string()
    } else {
        call.hunks
            .iter()
            .filter_map(|h| metas.get(h).map(|m| m.text.clone()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let rules = match tutor_agent::conformance::Rules::load(root) {
        Ok(Some(r)) => r,
        Ok(None) => return Ok(vec![]),
        Err(e) => {
            return Err(format!(
                "as regras do arquitecto não se lêem ({e}): pede ao humano para as corrigir"
            ))
        }
    };
    let rel = project_rel(path, root, work);
    let found = tutor_agent::conformance::check(&rules, rel, &text);
    Ok(tutor_agent::conformance::unexcused(&rules, root, found))
}

/// The working tree's changed files (path relative to the project → size and modification time;
/// a deleted file has none). What `git status` lists, untracked files one by one.
type DirtyState = HashMap<String, Option<(u64, i128)>>;

/// RF-G03 (sessão de fecho dos RF, bloco 5): the dirty files of the working tree now, or `None`
/// without git (then a `bash` command cannot be checked against the scope).
fn dirty_state(root: &Path) -> Option<DirtyState> {
    let out = std::process::Command::new("git")
        .args(["status", "--porcelain=v1", "-z", "-uall"])
        .current_dir(root)
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut parts = text.split('\0');
    let mut state = DirtyState::new();
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let (xy, path) = (&entry[..2], &entry[3..]);
        if xy.starts_with('R') || xy.starts_with('C') {
            parts.next(); // the old path of a rename or copy
        }
        let meta = std::fs::metadata(root.join(path)).ok().map(|m| {
            let t = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_nanos() as i128);
            (m.len(), t)
        });
        state.insert(path.to_string(), meta);
    }
    Some(state)
}

/// The files a command changed: dirty now and not before, dirty before and changed again, or dirty
/// before and clean now (reverting a file is writing it too). Sorted.
fn changed_files(before: &DirtyState, after: &DirtyState) -> Vec<String> {
    let mut out: Vec<String> = after
        .iter()
        .filter(|(p, m)| before.get(*p) != Some(m))
        .map(|(p, _)| p.clone())
        .chain(before.keys().filter(|p| !after.contains_key(*p)).cloned())
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Before a `bash` of a request with a scope, or of a session that claims files (phase 3): the
/// working tree as it is.
fn bash_scope_start(s: &Session, call: &str) {
    let scoped = s
        .origin
        .lock()
        .unwrap()
        .as_ref()
        .is_some_and(|o| !o.scope.is_empty());
    if !scoped && s.change_log.is_none() {
        return;
    }
    if let Some(snap) = dirty_state(&s.agent.ctx.root) {
        s.bash_snaps.lock().unwrap().insert(call.to_string(), snap);
    }
}

/// After it: what it changed outside the scope goes to the chat (a notice), to the model (a note in
/// the next request) and to the audit log. The command already ran — this cannot refuse it; the
/// human keeps or undoes it («Rewind to here»), and the model is told not to do it again.
fn bash_scope_end(s: &Session, call: &str, emit: &mut dyn FnMut(AgentEvent)) {
    let Some(before) = s.bash_snaps.lock().unwrap().remove(call) else {
        return;
    };
    let Some(after) = dirty_state(&s.agent.ctx.root) else {
        return;
    };
    let changed = changed_files(&before, &after);
    bash_claims(s, call, &changed, emit);
    let Some(origin) = s.origin.lock().unwrap().clone() else {
        return;
    };
    if origin.scope.is_empty() {
        return;
    }
    let outside: Vec<String> = changed
        .into_iter()
        .filter(|p| !origin.in_scope(p))
        .collect();
    if outside.is_empty() {
        return;
    }
    let scope = origin.scope.join(", ");
    let files = outside.join(", ");
    emit(AgentEvent::Notice {
        text: format!(
            "O `bash` alterou ficheiros fora do âmbito do pedido ({scope}): {files}. Confirma que ficam, ou desfaz com «Rewind to here»."
        ),
    });
    s.notes.lock().unwrap().push(format!(
        "O teu último comando bash alterou ficheiros fora do âmbito do pedido ({scope}): {files}. Não escrevas fora do âmbito: se for preciso, pede autorização com ask_human ou sugere-o com suggest."
    ));
    let mut e = audit_entry(s, "scope");
    e.tool = Some("bash".into());
    e.call = Some(call.to_string());
    e.path = Some(files);
    e.verdict = Some("warn".into());
    e.outcome = Some("outside_scope".into());
    e.reason = Some(format!("o bash escreveu fora do âmbito ({scope})"));
    audit(s, e);
}

// ───── Multi Co-Dev, phase 3: file claims ─────
// Each session claims the files it writes (the Project database, `tutor_board::project::claims`):
// with a worktree per session nothing collides on disk, but two branches that change one file clash
// when they are integrated. The first writer owns the path until its session closes; another open
// session's write to it is refused here, in the tool layer, naming the owner. Claims of a session
// that is gone (closed, or its app process died) are abandoned and taken over.

/// The tools that write the file named in their `path`.
const WRITERS: [&str; 3] = ["write", "edit", "edit_lines"];

/// Is the process `pid` still running?
fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        // signal 0 only asks; EPERM means it exists under another user
        let r = unsafe { libc::kill(pid as libc::pid_t, 0) };
        r == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        true
    }
}

/// A claim whose holder is gone: a session of this app that is no longer open, or a session of an
/// app process that no longer runs.
pub(crate) fn claim_abandoned(c: &tutor_board::project::claims::Claim) -> bool {
    if c.pid == std::process::id() {
        !sessions().lock().unwrap().contains_key(&c.session)
    } else {
        !pid_alive(c.pid)
    }
}

/// The refusal a write to a claimed file gets (the model reads it; the audit log keeps it).
fn held_text(path: &str, c: &tutor_board::project::claims::Claim) -> String {
    let by = match &c.issue {
        Some(k) => format!("pelo Co-Dev da issue {k} (sessão {})", c.session),
        None => format!("pela sessão Co-Dev {}", c.session),
    };
    format!(
        "{path} está reservado {by}: outro Co-Dev não o muda enquanto essa sessão estiver aberta. Trabalha noutros ficheiros, ou pergunta ao humano (ask_human) se deves esperar que ela feche."
    )
}

/// Claims `path` (project-relative) for the session.
fn claim_path(
    s: &Session,
    path: &str,
) -> Result<tutor_board::project::claims::Outcome, String> {
    let db = s.change_log.as_ref().ok_or("sem base do Project")?;
    let issue = s.issue_key.lock().unwrap().clone();
    let who = tutor_board::project::claims::Claimant {
        session: &s.id,
        issue: issue.as_deref(),
        pid: std::process::id(),
    };
    tutor_board::project::ProjectStore::open(db)?
        .claim(
            &s.project_root.display().to_string(),
            path,
            &who,
            now_ms(),
            &claim_abandoned,
        )
        .map_err(|e| e.message)
}

/// Gives back one path the session claimed for a write that did not happen.
fn release_claim(s: &Session, path: &str) {
    if let Some(db) = &s.change_log {
        if let Ok(mut st) = tutor_board::project::ProjectStore::open(db) {
            let _ = st.release_claim(&s.project_root.display().to_string(), &s.id, path);
        }
    }
}

/// Before a write: the file must not be claimed by another open session; the session claims it.
/// Returns the verdict and the path when this call claimed it now (released if the write is refused).
/// Without a Project database (tests, CLI) nothing is claimed.
fn claim_gate(s: &Session, call: &PendingCall, verdict: Verdict) -> (Verdict, Option<String>) {
    if matches!(verdict, Verdict::Deny { .. })
        || !WRITERS.contains(&call.name.as_str())
        || s.change_log.is_none()
    {
        return (verdict, None);
    }
    let Some(given) = call.input.get("path").and_then(|p| p.as_str()) else {
        return (verdict, None);
    };
    // a path that leaves the folder is the tool's own refusal
    let Ok(abs) = tutor_agent::sandbox::resolve(&s.agent.ctx.root, given) else {
        return (verdict, None);
    };
    let rel = tutor_agent::sandbox::rel(&s.agent.ctx.root, &abs);
    match claim_path(s, &rel) {
        Ok(tutor_board::project::claims::Outcome::Claimed { new }) => (verdict, new.then_some(rel)),
        Ok(tutor_board::project::claims::Outcome::Held(c)) => (
            Verdict::Deny {
                reason: held_text(&rel, &c),
            },
            None,
        ),
        Err(e) => (
            Verdict::Deny {
                reason: format!(
                    "as reservas de ficheiros do Project não se verificam ({e}): a escrita em {rel} fica bloqueada"
                ),
            },
            None,
        ),
    }
}

/// The project folder inside its repository (`sub/`), to make `git status` paths project-relative.
fn repo_prefix(dir: &Path) -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--show-prefix"])
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// After a `bash`: the files it changed become the session's; one another open session holds goes
/// to the chat, to the model and to the audit log (the command already ran — the human keeps or
/// undoes it).
fn bash_claims(s: &Session, call: &str, changed: &[String], emit: &mut dyn FnMut(AgentEvent)) {
    if s.change_log.is_none() || changed.is_empty() {
        return;
    }
    let pre = repo_prefix(&s.agent.ctx.root);
    let mut held: Vec<String> = vec![];
    for p in changed {
        let Some(rel) = p.strip_prefix(pre.as_str()) else {
            continue; // outside the project folder
        };
        match claim_path(s, rel) {
            Ok(tutor_board::project::claims::Outcome::Held(c)) => held.push(match &c.issue {
                Some(k) => format!("{rel} ({k})"),
                None => format!("{rel} ({})", c.session),
            }),
            Ok(_) => {}
            Err(e) => held.push(format!("{rel} (sem verificação: {e})")),
        }
    }
    if held.is_empty() {
        return;
    }
    let files = held.join(", ");
    emit(AgentEvent::Notice {
        text: format!(
            "O `bash` alterou ficheiros reservados por outro Co-Dev: {files}. Confirma que ficam, ou desfaz com «Rewind to here»."
        ),
    });
    s.notes.lock().unwrap().push(format!(
        "O teu último comando bash alterou ficheiros que outro Co-Dev reservou: {files}. Não mexas neles enquanto essa sessão estiver aberta."
    ));
    let mut e = audit_entry(s, "claim");
    e.tool = Some("bash".into());
    e.call = Some(call.to_string());
    e.path = Some(files);
    e.verdict = Some("warn".into());
    e.outcome = Some("held".into());
    e.reason = Some("o bash escreveu ficheiros reservados por outra sessão".into());
    audit(s, e);
}

/// RF-E05 (docs/v2/RF-DELONIX-PLANO.md F2.4): a `write` over an existing file is turned into
/// line hunks (RF-CODEV-STREAM I2); when they replace more than 60% of the file it is a rewrite,
/// which always asks — in Auto too — with the percentage. Otherwise the percentage goes into
/// the reason of an approval that was asked anyway.
fn rewrite_gate(
    verdict: Verdict,
    call: &PendingCall,
    root: &Path,
    metas: &HashMap<String, HunkMeta>,
) -> Verdict {
    if call.name != "write" || call.hunks.is_empty() || matches!(verdict, Verdict::Deny { .. }) {
        return verdict;
    }
    let Some(path) = call.input.get("path").and_then(|p| p.as_str()) else {
        return verdict;
    };
    let Ok(text) = std::fs::read_to_string(root.join(path)) else {
        return verdict; // a new file: writing it whole is what `write` is for
    };
    let total = text.lines().count().max(1);
    let removed: usize = call
        .hunks
        .iter()
        .filter_map(|h| metas.get(h))
        .map(|m| m.removed as usize)
        .sum();
    let pct = (removed * 100 / total).min(100);
    if pct > 60 {
        return Verdict::Ask {
            reason: format!(
                "write reescreve {pct}% de {path} (mais de 60%): só para ficheiros novos, gerados \
                 ou reescritas justificadas — confirma, ou pede alterações por linhas"
            ),
            dangerous: true,
            suggested_rule: None,
        };
    }
    match verdict {
        Verdict::Ask {
            reason,
            dangerous,
            suggested_rule,
        } => Verdict::Ask {
            reason: format!("{reason} (write: {pct}% de {path})"),
            dangerous,
            suggested_rule,
        },
        v => v,
    }
}

/// What the human is told after Stop when the turn already changed files (RF-G07): the
/// changes stay as they are, and the turn's checkpoint takes them back.
fn stop_notice(checkpoint: Option<u32>) -> Option<String> {
    checkpoint.map(|cp| {
        format!(
            "Parado a teu pedido: nada mais é escrito. O que o Co-Dev já alterou neste turno ficou \
             nos ficheiros — revê no Source Control; para descartar tudo, «Rewind to here» no \
             checkpoint {cp} (separador Co-Dev run) ou /reverter."
        )
    })
}

/// RF-G07 (sessão de fecho dos RF, bloco 6): after Stop, the files the turn left changed — the
/// notice says how to drop them, and the `stop_review` event gives the chat its «keep / discard»
/// bar (discard = back to the turn's checkpoint). Nothing changed: nothing to say.
fn stop_review(s: &Session, checkpoint: Option<u32>, emit: &dyn Fn(AgentEvent)) {
    let Some(cp) = checkpoint else {
        return;
    };
    let files = s
        .agent
        .checkpoints
        .as_ref()
        .and_then(|c| c.changed_since(cp).ok())
        .unwrap_or_default();
    if files.is_empty() {
        return;
    }
    if let Some(text) = stop_notice(Some(cp)) {
        emit(AgentEvent::Notice { text });
    }
    emit(AgentEvent::StopReview {
        checkpoint: cp,
        files,
    });
}

/// The project of the session's folder, from the project database.
fn project_of(s: &Session) -> Option<tutor_board::project::Project> {
    let db = s.change_log.as_ref()?;
    let st = tutor_board::project::ProjectStore::open(db).ok()?;
    st.load(&s.project_root.display().to_string(), now_ms())
        .ok()
}

/// Board B: why `key` did not go to Review after `finish_issue` (the store's `held` note), or
/// `None` when it is in Review or past it.
fn held_reason(s: &Session, key: &str) -> Option<String> {
    let p = project_of(s)?;
    let i = p.issues.iter().find(|i| i.key == key)?;
    if matches!(i.state.as_str(), "review" | "accept" | "done") {
        return None;
    }
    let db = s.change_log.as_ref()?;
    let st = tutor_board::project::ProjectStore::open(db).ok()?;
    let d = st.detail(&p.root, key).ok()?;
    Some(
        d.activity
            .iter()
            .find(|a| a.kind == "held")
            .map(|a| a.note.clone())
            .unwrap_or_else(|| format!("fica em «{}»", i.state)),
    )
}

/// Board B: Co-Dev starts work on `key` — the normal move to In progress, by the human who asked
/// (the store checks WIP and readiness; an override is the human's, on the board). `Err`: why not.
fn start_work(s: &Session, key: &str, origin: Option<&Origin>) -> Result<(), String> {
    let Some(db) = s.change_log.as_ref() else {
        return Ok(());
    };
    let root = s.project_root.display().to_string();
    let actor = origin
        .map(|o| o.by.clone())
        .filter(|b| !b.is_empty())
        .unwrap_or_else(|| crate::board::actor(&root));
    let op =
        serde_json::from_value(serde_json::json!({"op": "move", "key": key, "to": "progress"}))
            .map_err(|e| e.to_string())?;
    tutor_board::project::ProjectStore::open(db)
        .and_then(|mut st| st.apply(&root, &actor, now_ms(), op).map_err(|e| e.message))
        .map(|_| ())
}

/// Board B (XP test-first): what a session changed for its issue until the first failing test
/// run. A failing `run_tests` while only tests were changed is the red step of TDD.
#[derive(Default)]
struct TddTrace {
    issue: Option<String>,
    /// the test files changed so far (test hunks: by the file or by the text, `is_test_change`)
    tests: std::collections::BTreeSet<String>,
    /// a non-test hunk was applied
    implementation: bool,
    /// the red step was already recorded
    recorded: bool,
}

/// A `run_tests` result that ran and failed (an exit code other than 0). A refused, cancelled or
/// timed-out call is not a test run.
pub fn is_red_run(name: &str, is_error: bool, content: &str) -> bool {
    name == "run_tests"
        && is_error
        && content.starts_with("$ ")
        && content
            .lines()
            .nth(1)
            .is_some_and(|l| l.starts_with("exit ") && l.trim() != "exit 0")
}

/// Follows the session's hunks and test runs for the test-first proof; returns the test files
/// of the red step the first time a failing `run_tests` comes with only tests changed.
fn tdd_observe(s: &Session, e: &AgentEvent, path_text: Option<(&str, &str)>) -> Option<String> {
    let issue = s.issue_key.lock().unwrap().clone()?;
    let mut t = s.tdd.lock().unwrap();
    if t.issue.as_deref() != Some(issue.as_str()) {
        *t = TddTrace {
            issue: Some(issue),
            ..TddTrace::default()
        };
    }
    match e {
        AgentEvent::HunkApplied { .. } => {
            let (path, text) = path_text?;
            if tutor_board::project::methods::is_test_change(path, text) {
                t.tests.insert(path.to_string());
            } else {
                t.implementation = true;
            }
            None
        }
        AgentEvent::ToolResult {
            name,
            is_error,
            content,
            ..
        } if is_red_run(name, *is_error, content) => {
            if t.recorded || t.implementation || t.tests.is_empty() {
                return None;
            }
            t.recorded = true;
            Some(t.tests.iter().cloned().collect::<Vec<_>>().join("\n"))
        }
        _ => None,
    }
}

/// After a turn: the question the agent asked goes to the human (and blocks the turn's issue,
/// RF-G06); the suggestions go to the Project inbox (RF-G02/B05). Both are in the audit log.
fn settle_flow(s: &Session, emit: &dyn Fn(AgentEvent)) {
    let root = s.project_root.display().to_string();
    let store = || {
        s.change_log
            .as_ref()
            .and_then(|db| tutor_board::project::ProjectStore::open(db).ok())
    };
    let apply = |op: serde_json::Value| -> Result<(), String> {
        let op = serde_json::from_value(op).map_err(|e| e.to_string())?;
        match store() {
            Some(mut st) => st
                .apply(&root, "Co-Dev", now_ms(), op)
                .map(|_| ())
                .map_err(|e| e.message),
            None => Ok(()),
        }
    };
    let question = s.flow.question.lock().unwrap().clone();
    if let Some(q) = question {
        emit(AgentEvent::Question { text: q.clone() });
        let issue = s.issue_key.lock().unwrap().clone();
        if let Some(k) = &issue {
            let blocked = format!("dúvida: {q}");
            if let Err(e) =
                apply(serde_json::json!({"op": "update_issue", "key": k, "blocked": blocked}))
            {
                emit(AgentEvent::Notice {
                    text: format!("não foi possível marcar {k} como bloqueada: {e}"),
                });
            }
        }
        let mut e = audit_entry(s, "question");
        e.reason = Some(q);
        e.outcome = Some(if issue.is_some() { "blocked" } else { "asked" }.into());
        audit(s, e);
    }
    // RF-B06/B07: the criteria table sends the issue to Review; then the project's tests run
    let finished = s.flow.finished.lock().unwrap().clone();
    let issue = s.issue_key.lock().unwrap().clone();
    if let (Some(report), Some(k)) = (finished, &issue) {
        let template = s
            .origin
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|o| o.template.clone());
        let r = apply(
            serde_json::json!({"op": "codev_finished", "key": k, "report": report, "template_version": template}),
        );
        // Board B: the store moved it by the normal move — or kept it, and said why
        let held = r.is_ok().then(|| held_reason(s, k)).flatten();
        let mut e = audit_entry(s, "finish");
        e.outcome = Some(
            match (&r, &held) {
                (Err(_), _) => "failed",
                (Ok(_), Some(_)) => "held",
                _ => "review",
            }
            .into(),
        );
        e.reason = r.err().or_else(|| held.clone());
        audit(s, e);
        let place = match &held {
            Some(why) => format!(
                "a issue não passou a Review ({why}); move-a no quadro, com um motivo se for uma excepção"
            ),
            None => "a issue está em Review".to_string(),
        };
        if !s.checks.is_empty() {
            let checks = hunks::run_checks(&s.checks, &s.agent.ctx);
            let passed = checks.iter().all(|c| c.ok);
            let summary = checks
                .iter()
                .filter(|c| !c.ok)
                .map(|c| format!("`{}`: {}", c.command, c.summary))
                .collect::<Vec<_>>()
                .join("; ");
            let _ = apply(
                serde_json::json!({"op": "tests_run", "key": k, "passed": passed, "summary": summary}),
            );
            emit(AgentEvent::Notice {
                text: if passed {
                    format!("{k}: critérios respondidos e testes verdes — {place}; o Done é teu.")
                } else {
                    format!("{k}: os testes falharam ({summary}) — a issue volta a Em curso, com o erro no próximo pedido.")
                },
            });
            let mut e = audit_entry(s, "tests");
            e.outcome = Some(if passed { "passed" } else { "failed" }.into());
            e.reason = (!passed).then_some(summary);
            audit(s, e);
        } else {
            emit(AgentEvent::Notice {
                text: format!("{k}: critérios respondidos — {place} (sem testes detectados no projecto); o Done é teu."),
            });
        }
    }
    let suggestions = std::mem::take(&mut *s.flow.suggestions.lock().unwrap());
    let n = suggestions.len();
    for (title, why) in suggestions {
        let r = apply(serde_json::json!({
            "op": "propose", "title": title, "kind": "story", "source": "Co-Dev", "detail": why
        }));
        let mut e = audit_entry(s, "suggest");
        e.reason = Some(title);
        e.outcome = Some(if r.is_ok() { "inbox" } else { "failed" }.into());
        audit(s, e);
    }
    if n > 0 && s.change_log.is_some() {
        emit(AgentEvent::Notice {
            text: format!("{n} sugestão(ões) do Co-Dev na caixa de entrada do Project: decides tu"),
        });
    }
}

/// A new audit row with the session, the current request and the mode filled in.
fn audit_entry(s: &Session, event: &str) -> tutor_board::project::AuditEntry {
    let origin = s.origin.lock().unwrap().clone();
    tutor_board::project::AuditEntry {
        at: now_ms(),
        session: s
            .log
            .lock()
            .unwrap()
            .as_ref()
            .map(|l| {
                l.path()
                    .file_stem()
                    .map(|x| x.to_string_lossy().to_string())
                    .unwrap_or_default()
            })
            .unwrap_or_default(),
        event: event.into(),
        origin: origin
            .as_ref()
            .map(|o| o.kind.as_str())
            .unwrap_or("none")
            .into(),
        issue_key: origin
            .as_ref()
            .and_then(|o| o.issue.clone())
            .or_else(|| s.issue_key.lock().unwrap().clone()),
        actor: origin.map(|o| o.by).unwrap_or_default(),
        mode: s.policy.lock().unwrap().mode.as_str().into(),
        driver: s.driver.lock().unwrap().clone(),
        ..Default::default()
    }
}

/// How a decision on a call ended, for the audit log.
fn outcome_of(d: &Decision) -> &'static str {
    match d {
        Decision::Allow => "allowed",
        Decision::Deny(r) if r == NO_REQUEST => "blocked",
        Decision::Deny(_) => "denied",
        Decision::Hunks {
            accepted, rejected, ..
        } => match (accepted.is_empty(), rejected.is_empty()) {
            (true, _) => "denied",
            (false, true) => "allowed",
            (false, false) => "partial",
        },
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// The turn's report (HARNESS-07): sent to the UI and kept in the project database with
/// the turn's issue — only when the turn did something (changed files, ran commands).
fn report_turn(s: &Session, log: tutor_agent::report::TurnLog, emit: &dyn Fn(AgentEvent)) {
    if !log.worth_reporting() {
        return;
    }
    let todos = s.flow.todos.lock().unwrap().clone();
    let markdown = log.markdown(&todos, now_ms() as u64);
    let title = log.title();
    emit(AgentEvent::Report {
        title: title.clone(),
        markdown: markdown.clone(),
    });
    if let Some(db) = &s.change_log {
        let issue = s.issue_key.lock().unwrap().clone();
        let root = s.project_root.display().to_string();
        let r = tutor_board::project::ProjectStore::open(db).and_then(|mut st| {
            let id = s
                .log
                .lock()
                .unwrap()
                .as_ref()
                .map(|l| l.path().display().to_string())
                .unwrap_or_default();
            st.record_artifact(&root, &id, issue.as_deref(), &title, &markdown, now_ms())
                .map_err(|e| e.message)
        });
        if let Err(e) = r {
            emit(AgentEvent::Notice {
                text: format!("não foi possível guardar o relatório do turno: {e}"),
            });
        }
    }
}

/// Auto mode, end of turn: runs the checks again. If a check that passed before the turn
/// now fails, the files go back to the turn's checkpoint and the provisional hunks are
/// rejected (`by: validation`); the model hears about it in its next message.
fn validate(s: &Session, turn: AutoTurn, emit: &dyn Fn(AgentEvent)) {
    let baseline = turn.baseline.unwrap_or_default();
    if s.agent.ctx.cancel.load(Ordering::Relaxed) {
        emit(AgentEvent::Validation {
            status: ValidationStatus::Skipped,
            checks: vec![],
            baseline,
        });
        emit(AgentEvent::Notice {
            text: "Auto: a validação não correu porque paraste o turno; as alterações provisórias \
                   ficam no disco (podes voltar ao checkpoint do turno)."
                .into(),
        });
        return;
    }
    emit(AgentEvent::Validation {
        status: ValidationStatus::Running,
        checks: vec![],
        baseline: baseline.clone(),
    });
    let after = hunks::run_checks(&s.checks, &s.agent.ctx);
    let broken = hunks::broke(&baseline, &after);
    if broken.is_empty() {
        emit(AgentEvent::Validation {
            status: ValidationStatus::Passed,
            checks: after,
            baseline,
        });
        record_change_sets(s, &turn.provisional_meta, "validation", emit);
        return;
    }
    let what = broken
        .iter()
        .map(|c| format!("`{}` ({})", c.command, c.summary))
        .collect::<Vec<_>>()
        .join("; ");
    let restored = match (turn.checkpoint, s.agent.checkpoints.as_ref()) {
        (Some(cp), Some(cps)) => cps.restore(cp),
        _ => Err("este turno não tem checkpoint".to_string()),
    };
    if restored.is_ok() {
        for hunk in &turn.provisional {
            emit(AgentEvent::HunkRejected {
                hunk: hunk.clone(),
                by: RejectedBy::Validation,
                reason: format!("a validação falhou: {what}"),
            });
        }
    }
    emit(AgentEvent::Validation {
        status: ValidationStatus::Failed,
        checks: after,
        baseline,
    });
    let (human, model) = match restored {
        Ok(_) => (
            format!("Auto: a validação falhou ({what}); os ficheiros voltaram ao estado de antes do turno."),
            format!(
                "A validação automática falhou depois das tuas alterações ({what}) e os ficheiros \
                 foram repostos como estavam antes do turno: volta a lê-los antes de continuar."
            ),
        ),
        Err(e) => (
            format!("Auto: a validação falhou ({what}) e não foi possível repor os ficheiros: {e}. Revê as alterações."),
            format!(
                "A validação automática falhou depois das tuas alterações ({what}); as alterações \
                 continuam no disco."
            ),
        ),
    };
    emit(AgentEvent::Notice { text: human });
    s.notes.lock().unwrap().push(model);
}

/// What the model is told when edits stream into the editor (RF-CODEV-STREAM §7, I6).
pub const REVIEW_EDITS_NOTE: &str = "No IDE, as tuas alterações aparecem no editor enquanto as \
     escreves e o humano aceita ou rejeita cada bloco. Nunca ponhas na resposta código que queres \
     aplicar: altera os ficheiros com `edit`/`write`. Referências curtas entre crases na prosa são \
     aceitáveis.";

/// The system prompt of a new session; with live hunks, the core block also carries
/// [`REVIEW_EDITS_NOTE`]. It is saved with the session, so a resume keeps it byte for byte.
fn session_system(root: &Path, review_edits: bool, lang: ReplyLang) -> Vec<(String, bool)> {
    let mut v: Vec<(String, bool)> = tutor_agent::context::system_prompt_in(root, lang)
        .into_iter()
        .map(|b| (b.text, b.cache))
        .collect();
    if review_edits {
        if let Some((core, _)) = v.first_mut() {
            core.push_str("\n\n");
            core.push_str(REVIEW_EDITS_NOTE);
        }
    }
    v
}

/// Espera pela decisão da UI, desistindo se a sessão for cancelada.
fn wait_decision(rx: &mpsc::Receiver<Decision>, cancel: &AtomicBool) -> Decision {
    loop {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(d) => return d,
            Err(mpsc::RecvTimeoutError::Timeout) if !cancel.load(Ordering::Relaxed) => continue,
            Err(_) => return Decision::Deny("cancelado pelo utilizador".into()),
        }
    }
}

/// A UI responde a um pedido de aprovação. Com `remember` (e `allow`), a regra sugerida
/// passa a valer nesta sessão e fica gravada em `.dxtutor/permissions.json`. Pedidos do
/// piso de segurança não trazem regra sugerida, por isso não há «permitir sempre» para
/// eles. `false` se não havia nada pendente com esse id.
pub fn approve(
    id: &str,
    tool_use_id: &str,
    allow: bool,
    reason: Option<String>,
    remember: bool,
) -> bool {
    let Ok(s) = get(id) else { return false };
    let Some((tx, rule)) = s.pending.lock().unwrap().remove(tool_use_id) else {
        return false;
    };
    if allow && remember {
        if let Some(rule) = rule {
            let mut p = s.policy.lock().unwrap();
            if !p.rules.allow.contains(&rule) {
                p.rules.allow.push(rule.clone());
            }
            let _ = Rules::remember(&p.root, &rule);
        }
    }
    let d = if allow {
        Decision::Allow
    } else {
        Decision::Deny(reason.unwrap_or_else(|| "recusado".into()))
    };
    tx.send(d).is_ok()
}

/// One decision of a `hunk_review` (args of `codev_agent_review`).
#[derive(Debug, Clone, serde::Deserialize)]
pub struct HunkVerdict {
    pub hunk: String,
    pub accept: bool,
    #[serde(default)]
    pub reason: Option<String>,
}

/// The UI decides the hunks of a `hunk_review` (RF-CODEV-STREAM §4). Only the accepted
/// hunks are written; a hunk without a decision counts as rejected. An unknown hunk is an
/// error and leaves the review pending.
pub fn review(id: &str, call: &str, decisions: &[HunkVerdict]) -> Result<(), String> {
    let s = get(id)?;
    let hunks = s
        .review
        .lock()
        .unwrap()
        .get(call)
        .cloned()
        .ok_or_else(|| format!("nenhuma alteração à espera de revisão com o id {call}"))?;
    if let Some(d) = decisions.iter().find(|d| !hunks.contains(&d.hunk)) {
        return Err(format!("hunk desconhecido nesta revisão: {}", d.hunk));
    }
    // RF-A03/A04: a change that breaks the rules is accepted only after the architect's override
    let violating = s
        .violating
        .lock()
        .unwrap()
        .get(call)
        .cloned()
        .unwrap_or_default();
    if !violating.is_empty()
        && !s.overrides.lock().unwrap().contains_key(call)
        && decisions.iter().any(|d| d.accept)
    {
        return Err(format!(
            "esta alteração viola as regras do arquitecto ({}): aceitá-la pede o override do Arquitecto com um ADR aceite",
            violation_text(&violating)
        ));
    }
    let broke = (!violating.is_empty()).then(|| violation_text(&violating));
    let mut accepted = vec![];
    let mut rejected = vec![];
    for h in &hunks {
        // the last decision about a hunk wins
        match decisions.iter().rev().find(|d| &d.hunk == h) {
            Some(d) if d.accept => accepted.push(h.clone()),
            Some(d) => {
                let why = d
                    .reason
                    .clone()
                    .filter(|r| !r.trim().is_empty())
                    .unwrap_or_else(|| "recusado".into());
                // the model learns which rule it broke
                let why = match &broke {
                    Some(b) => format!("{why} — viola as regras do arquitecto: {b}"),
                    None => why,
                };
                rejected.push((h.clone(), why))
            }
            None => rejected.push((h.clone(), "sem decisão".into())),
        }
    }
    let Some((tx, _)) = s.pending.lock().unwrap().remove(call) else {
        return Err(format!(
            "nenhuma alteração à espera de revisão com o id {call}"
        ));
    };
    s.review.lock().unwrap().remove(call);
    tx.send(Decision::Hunks {
        accepted,
        rejected,
        provisional: false,
    })
    .map_err(|_| "o turno já não está à espera desta decisão".to_string())
}

/// RF-A03/A04 (sessão de fecho, bloco 3): the architect overrides the rules a call under review
/// breaks, naming an accepted ADR. Only the architect (`.dxtutor/team.json`, F5.7), only an ADR
/// that is accepted (`conformance::adr_accepted`); the override goes to the audit log. After it,
/// the human may accept the call's hunks.
pub fn override_violation(id: &str, call: &str, adr: &str) -> Result<(), String> {
    let s = get(id)?;
    let violating = s
        .violating
        .lock()
        .unwrap()
        .get(call)
        .cloned()
        .ok_or_else(|| format!("nenhuma alteração que viole as regras à espera com o id {call}"))?;
    let root = s.project_root.clone();
    crate::roles::require(
        &root,
        &["architect"],
        "aprovar um desvio às regras do arquitecto",
    )?;
    let adr = adr.trim();
    if adr.is_empty() || !tutor_agent::conformance::adr_accepted(&root, adr) {
        return Err(format!(
            "o ADR «{adr}» não está aceite (docs/adr, docs/architecture ou docs/decisions, com Status: accepted / Estado: aceite)"
        ));
    }
    s.overrides
        .lock()
        .unwrap()
        .insert(call.to_string(), adr.to_string());
    let mut e = audit_entry(&s, "override");
    e.actor = crate::board::actor(&root.display().to_string());
    e.call = Some(call.to_string());
    e.verdict = Some("override".into());
    e.outcome = Some("allowed".into());
    e.reason = Some(format!("{adr}: {}", violation_text(&violating)));
    e.decided_by = Some(format!("human:{}", e.actor));
    e.decided_at = Some(e.at);
    audit(&s, e);
    Ok(())
}

/// Muda o modo da sessão (a modebar). Vale a partir da próxima decisão.
pub fn set_mode(id: &str, mode: &str) -> bool {
    match get(id) {
        Ok(s) => {
            let new = Mode::parse(mode);
            let old = std::mem::replace(&mut s.policy.lock().unwrap().mode, new);
            if old != new {
                // RF-G04: the mode change is in the audit log
                let mut e = audit_entry(&s, "mode");
                e.actor = crate::board::actor(&s.project_root.display().to_string());
                e.reason = Some(format!("{} → {}", old.as_str(), new.as_str()));
                e.decided_by = Some(format!("human:{}", e.actor));
                e.decided_at = Some(e.at);
                audit(&s, e);
            }
            true
        }
        Err(_) => false,
    }
}

/// Liga/desliga o modo plano. O modelo é avisado na próxima mensagem.
pub fn set_plan(id: &str, on: bool) -> Result<(), String> {
    let s = get(id)?;
    let was = s.flow.plan_mode.swap(on, Ordering::SeqCst);
    if was != on {
        s.notes.lock().unwrap().push(if on {
            "Modo plano activo: investiga só com leitura e propõe o plano com exit_plan antes \
             de alterar alguma coisa (as alterações são recusadas até o plano ser aprovado)."
                .into()
        } else {
            "Modo plano desligado pelo humano: podes executar.".into()
        });
    }
    Ok(())
}

/// Os checkpoints da sessão (vazio fora de repositórios git).
pub fn checkpoints(id: &str) -> Result<Vec<CheckpointView>, String> {
    let s = get(id)?;
    let marks = s.cp_marks.lock().unwrap().clone();
    Ok(s.agent
        .checkpoints
        .as_ref()
        .map(|c| c.list())
        .unwrap_or_default()
        .into_iter()
        .map(|cp| CheckpointView {
            conversation: marks.contains_key(&cp.id),
            checkpoint: cp,
        })
        .collect())
}

/// Repõe os ficheiros como estavam no checkpoint `cp` (antes do turno que o criou). Com
/// `conversation` («Rewind to here», A3 HARNESS-03), a conversa também volta a esse ponto: o
/// histórico fica com as mensagens de antes desse turno e o ficheiro da sessão é reescrito.
/// Sem isso (ou numa sessão retomada, que não sabe onde cada turno começou), a conversa
/// fica e o modelo é avisado na próxima mensagem.
pub fn rewind(id: &str, cp: u32, conversation: bool) -> Result<String, String> {
    let s = get(id)?;
    if s.busy.load(Ordering::SeqCst) {
        return Err("espera que o turno em curso termine (ou pára-o) antes de voltar atrás".into());
    }
    let cps = s
        .agent
        .checkpoints
        .as_ref()
        .ok_or("checkpoints só existem em repositórios git")?;
    let mark = s.cp_marks.lock().unwrap().get(&cp).copied();
    if conversation && mark.is_none() {
        return Err("a conversa deste checkpoint não pode voltar atrás (a sessão foi retomada): volta só os ficheiros".into());
    }
    let msg = cps.restore(cp)?;
    match (conversation, mark) {
        (true, Some(n)) => {
            let mut t = s.transcript.lock().unwrap();
            let cut = t.truncated(n);
            if let Some(log) = s.log.lock().unwrap().as_mut() {
                log.rewrite(&cut)?;
            }
            *t = cut;
            drop(t);
            // the later turns are gone: their marks too, and the mode is announced again
            s.cp_marks.lock().unwrap().retain(|k, _| *k < cp);
            *s.announced.lock().unwrap() = None;
            s.notes.lock().unwrap().clear();
            Ok(format!("{msg}; a conversa voltou a antes desse pedido"))
        }
        _ => {
            s.notes.lock().unwrap().push(format!(
                "O humano reverteu os ficheiros do projecto: {msg}. O que fizeste depois desse ponto \
                 já não está no disco — volta a ler os ficheiros antes de continuar."
            ));
            Ok(msg)
        }
    }
}

/// The permission rules of a project and of the user (HARNESS-05), as the panel shows them.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionsView {
    pub project: Rules,
    pub user: Rules,
    pub project_file: String,
    pub user_file: Option<String>,
}

/// Reads `.dxtutor/permissions.json` of `root` and the user's rules.
pub fn permissions(root: &str) -> PermissionsView {
    let root = PathBuf::from(root.trim());
    let pf = Rules::project_file(&root);
    let uf = Rules::user_file();
    let read = |p: &Path| -> Rules {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    };
    PermissionsView {
        project: read(&pf),
        user: uf.as_deref().map(read).unwrap_or_default(),
        project_file: pf.display().to_string(),
        user_file: uf.map(|u| u.display().to_string()),
    }
}

/// A rule is a tool name (`edit`, `run_tests`, `mcp__server__tool`) or `bash:<command prefix>`.
fn valid_rule(r: &str) -> bool {
    let r = r.trim();
    if r.is_empty() || r.len() > 200 || r.contains('\n') {
        return false;
    }
    match r.split_once(':') {
        Some(("bash", rest)) => !rest.trim().is_empty(),
        Some(_) => false,
        None => r.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
    }
}

/// Writes the project's rules (the same file "Allow always" writes to) and applies them to
/// the open sessions of that folder at once (project rules + the user's).
pub fn save_permissions(root: &str, rules: Rules) -> Result<(), String> {
    if let Some(bad) = rules
        .allow
        .iter()
        .chain(rules.deny.iter())
        .find(|r| !valid_rule(r))
    {
        return Err(format!("regra inválida: «{bad}» (usa o nome de uma ferramenta, ex. edit, ou bash:<prefixo do comando>)"));
    }
    let clean = |v: &[String]| {
        let mut o: Vec<String> = vec![];
        for r in v.iter().map(|r| r.trim().to_string()) {
            if !o.contains(&r) {
                o.push(r);
            }
        }
        o
    };
    let rules = Rules {
        allow: clean(&rules.allow),
        deny: clean(&rules.deny),
    };
    let root_p = PathBuf::from(root.trim());
    let p = Rules::project_file(&root_p);
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(
        &p,
        serde_json::to_string_pretty(&rules).unwrap_or_default() + "\n",
    )
    .map_err(|e| e.to_string())?;
    let canon = |x: &Path| std::fs::canonicalize(x).unwrap_or_else(|_| x.to_path_buf());
    let target = canon(&root_p);
    for sess in sessions().lock().unwrap().values() {
        if canon(&sess.project_root) == target {
            sess.policy.lock().unwrap().rules = Rules::load(&target, Rules::user_file().as_deref());
        }
    }
    Ok(())
}

/// Um ficheiro que faz a IDE correr comandos: existe? é confiado (com o conteúdo actual)?
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct FileTrust {
    pub present: bool,
    pub trusted: bool,
}

/// O que o projecto (e o utilizador) definem para o agente, para `/comandos`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionsStatus {
    pub commands: Vec<ProjectCommand>,
    pub skills: Vec<Skill>,
    pub hooks: FileTrust,
    pub mcp: FileTrust,
    /// Nomes dos servidores MCP configurados (utilizador + projecto).
    pub mcp_servers: Vec<String>,
}

pub fn extensions_status(
    root: &str,
    store: Option<&Path>,
    user_mcp: Option<&Path>,
) -> ExtensionsStatus {
    let root = PathBuf::from(root.trim());
    let store = store.map(Path::to_path_buf);
    let file = |rel: &str| FileTrust {
        present: root.join(rel).exists(),
        trusted: store
            .as_deref()
            .is_some_and(|st| trust::is_trusted(st, &root, rel)),
    };
    let mut servers: Vec<String> = vec![];
    if let Some(u) = user_mcp {
        servers.extend(mcp::load_config(u).unwrap_or_default().into_keys());
    }
    servers.extend(
        mcp::load_config(&root.join(mcp::PROJECT_FILE))
            .unwrap_or_default()
            .into_keys(),
    );
    servers.sort();
    servers.dedup();
    ExtensionsStatus {
        commands: extensions::commands(&root),
        skills: extensions::skills(&root),
        hooks: file(HOOKS_FILE),
        mcp: file(mcp::PROJECT_FILE),
        mcp_servers: servers,
    }
}

/// Confia nos hooks (`kind = "hooks"`) ou nos servidores MCP (`"mcp"`) do projecto, tal como
/// estão agora. Vale para as sessões novas.
pub fn trust_project_file(root: &str, kind: &str, store: Option<&Path>) -> Result<(), String> {
    let rel = match kind {
        "hooks" => HOOKS_FILE,
        "mcp" => mcp::PROJECT_FILE,
        other => return Err(format!("tipo desconhecido: {other}")),
    };
    let store = store.ok_or("sem HOME para guardar a confiança")?;
    trust::trust(store, Path::new(root.trim()), rel)
}

/// As sessões gravadas do projecto `root`, das mais recentes para as mais antigas.
pub fn list_sessions(root: &str, base: Option<&Path>) -> Vec<SessionSummary> {
    let root = PathBuf::from(root.trim()).display().to_string();
    sessions_dir(base, &root)
        .map(|d| session::list(&d))
        .unwrap_or_default()
}

/// O histórico simplificado de uma sessão aberta, para a UI redesenhar a conversa.
pub fn history(id: &str) -> Result<Vec<HistoryItem>, String> {
    let s = get(id)?;
    let t = s.transcript.lock().unwrap();
    Ok(session::history(&t))
}

/// Cancela o turno em curso (o loop pára no próximo ponto de verificação).
pub fn cancel(id: &str) -> bool {
    match get(id) {
        Ok(s) => {
            tutor_agent::agent::cancel(&s.agent.ctx.cancel);
            true
        }
        Err(_) => false,
    }
}

/// Fecha a sessão (cancela o que estiver a correr e esquece o histórico em memória). Multi Co-Dev
/// (fase 3): as reservas de ficheiros da sessão voltam; a sua worktree sai se não tiver alterações
/// por commitar (o ramo fica) — senão fica, e a faixa lista-a. Quem chama deve correr isto fora da
/// thread da interface: espera (pouco) que um turno cancelado pare antes de tocar na worktree.
pub fn close(id: &str) -> bool {
    close_keeping(id, false)
}

/// [`close`]; with `keep_worktree`, the session's worktree stays whatever it holds (the same issue
/// starts over in it right away — the UI's «start again»).
pub fn close_keeping(id: &str, keep_worktree: bool) -> bool {
    cancel(id);
    let Some(s) = sessions().lock().unwrap().remove(id) else {
        return false;
    };
    if let Some(db) = &s.change_log {
        if let Ok(mut st) = tutor_board::project::ProjectStore::open(db) {
            let _ = st.release_session_claims(&s.project_root.display().to_string(), &s.id);
        }
    }
    if let Some(wt) = s.worktree.as_ref().filter(|_| !keep_worktree) {
        close_worktree(&s, wt);
    }
    true
}

/// Starting a session in a worktree and removing a closing session's worktree never interleave: a
/// worktree another open session works in is never removed.
fn worktree_lock() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(()))
}

/// How long `close` waits for a cancelled turn to stop before it leaves the worktree alone.
const CLOSE_WAIT: Duration = Duration::from_secs(10);

/// The worktree of a closing session: removed when clean (the branch stays), kept otherwise; both
/// go to the audit log. A turn still running after [`CLOSE_WAIT`] keeps it (a write in flight
/// could otherwise recreate files under a removed folder).
fn close_worktree(s: &Session, wt: &Path) {
    let t0 = std::time::Instant::now();
    while s.busy.load(Ordering::SeqCst) && t0.elapsed() < CLOSE_WAIT {
        std::thread::sleep(Duration::from_millis(50));
    }
    let mut e = audit_entry(s, "worktree");
    e.tool = Some("git".into());
    e.path = Some(wt.display().to_string());
    e.decided_by = Some("policy".into());
    e.decided_at = Some(now_ms());
    let _guard = worktree_lock().lock().unwrap_or_else(|p| p.into_inner());
    let shared = sessions()
        .lock()
        .unwrap()
        .values()
        .any(|o| o.worktree.as_deref() == Some(wt));
    if shared {
        e.outcome = Some("kept".into());
        e.reason = Some("outra sessão aberta trabalha nesta worktree".into());
    } else if s.busy.load(Ordering::SeqCst) {
        e.outcome = Some("kept".into());
        e.reason = Some("um turno ainda corria ao fechar".into());
    } else {
        match tutor_eval::gitwork::codev::remove_at(&s.project_root, wt) {
            Ok(r) => {
                e.command = Some(r.command.clone());
                e.outcome = Some(if r.removed { "removed" } else { "kept" }.into());
                if !r.removed {
                    e.reason = Some(format!(
                        "alterações por commitar: {}",
                        r.dirty.join(", ")
                    ));
                }
            }
            Err(err) => {
                e.outcome = Some("failed".into());
                e.reason = Some(err);
            }
        }
    }
    audit(s, e);
}

#[cfg(test)]
mod worktree_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn key(k: &'static str) -> impl Fn(&str) -> Option<String> {
        move |_| Some(k.to_string())
    }

    #[test]
    fn providers_models_and_feature_matrix() {
        assert_eq!(
            resolve_model("codex", Some("gpt-codex")),
            "gpt-4.1",
            "nome de exemplo do protótipo"
        );
        assert_eq!(
            resolve_model("gemini", Some("gemini-pro")),
            "gemini-2.5-flash"
        );
        assert_eq!(
            resolve_model("ollama", Some(" llama3.1:8b ")),
            "llama3.1:8b"
        );
        assert_eq!(resolve_model("claude", None), anthropic::DEFAULT_MODEL);
        assert!(provider_features("claude").compaction && provider_features("claude").thinking);
        let g = provider_features("gemini");
        assert!(g.tools && !g.thinking && !g.compaction && !g.server_fallbacks);
        assert!(features_notice("claude", "x").is_none());
        let n = features_notice("ollama", "qwen").unwrap();
        assert!(n.contains("Ollama") && n.contains("compactação") && n.contains("cache de prompt"));
        // sem chave: Claude/OpenAI/Gemini recusam; o Ollama não precisa
        assert!(make_provider("codex", None, None, None)
            .err()
            .unwrap()
            .contains("OPENAI_API_KEY"));
        assert!(make_provider("gemini", Some(" ".into()), None, None).is_err());
        assert!(make_provider("ollama", None, Some("http://box:11434"), None).is_ok());
        assert!(make_provider("mistral", Some("k".into()), None, None).is_err());
    }

    #[test]
    fn non_claude_sessions_record_the_provider_and_resume_with_it() {
        let proj = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap().keep();
        let asked = std::sync::Mutex::new(vec![]);
        let key_for = |p: &str| {
            asked.lock().unwrap().push(p.to_string());
            Some("sk".to_string())
        };
        let spec = StartSpec {
            root: proj.path().display().to_string(),
            sessions_base: Some(base.clone()),
            provider: Some("Gemini".into()),
            model: Some("gemini-pro".into()),
            ..Default::default()
        };
        let id = start(spec.clone(), &key_for, None).unwrap();
        let s = get(&id).unwrap();
        assert_eq!(s.agent.cfg.model, "gemini-2.5-flash");
        assert!(!s.agent.cfg.compaction, "compactação é só da Anthropic");
        assert!(s.startup_notices[0].starts_with("Gemini (gemini-2.5-flash)"));
        close(&id);
        // a retoma ignora o provedor da UI e pede a chave do gravado
        let resumed = StartSpec {
            provider: Some("claude".into()),
            resume: Some(id.clone()),
            ..spec
        };
        assert_eq!(start(resumed, &key_for, None).unwrap(), id);
        assert_eq!(*asked.lock().unwrap(), ["gemini", "gemini"]);
        assert_eq!(get(&id).unwrap().agent.cfg.model, "gemini-2.5-flash");
        close(&id);
        let bad = StartSpec {
            root: proj.path().display().to_string(),
            provider: Some("mistral".into()),
            ..Default::default()
        };
        assert!(start(bad, &key("sk"), None)
            .unwrap_err()
            .contains("mistral"));
    }

    #[test]
    fn start_requires_a_key_and_an_existing_folder() {
        let dir = std::env::temp_dir();
        let spec = StartSpec {
            root: dir.display().to_string(),
            sessions_base: Some(tempfile::tempdir().unwrap().keep()),
            ..Default::default()
        };
        assert!(start(spec.clone(), &|_: &str| None, None)
            .unwrap_err()
            .contains("sem chave"));
        assert!(start(spec.clone(), &key("  "), None).is_err());
        let bad = StartSpec {
            root: "/nao/existe/mesmo".into(),
            ..Default::default()
        };
        assert!(start(bad, &key("sk"), None)
            .unwrap_err()
            .contains("não existe"));

        let id = start(spec, &key("sk-test"), None).unwrap();
        assert!(id.starts_with("cda-"));
        assert!(cancel(&id));
        assert!(
            !approve(&id, "nada", true, None, false),
            "sem aprovação pendente"
        );
        assert!(set_mode(&id, "auto"));
        assert!(close(&id));
        assert!(!close(&id));
        assert!(!cancel(&id));
    }

    /// The tests that call the policy directly answer a chat request (RF-G01: in the IDE an
    /// action with no request is blocked).
    fn chat_request(s: &Session) {
        s.policy.lock().unwrap().origin = Some(Origin {
            kind: tutor_agent::permissions::OriginKind::Chat,
            issue: None,
            by: "t".into(),
            scope: vec![],
            template: None,
        });
    }

    #[test]
    fn live_sessions_list_the_open_ones_with_their_issue_until_closed() {
        let dir = tempfile::tempdir().unwrap();
        let spec = StartSpec {
            root: dir.path().display().to_string(),
            model: Some("claude-opus-5-5".into()),
            sessions_base: Some(dir.path().join(".sessions")),
            issue_key: Some("DX-7".into()),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        // other tests open sessions in parallel: look only at this one
        let mine = || live_sessions().into_iter().find(|l| l.id == id);
        let l = mine().expect("listed while open");
        assert_eq!(l.issue.as_deref(), Some("DX-7"));
        assert_eq!(l.model, "claude-opus-5-5");
        assert_eq!(l.root, dir.path().display().to_string());
        assert!(!l.busy && l.opened > 0);
        let v = serde_json::to_value(&l).unwrap();
        assert!(v.get("opened").is_some() && v.get("issue").is_some());
        assert!(close(&id));
        assert!(mine().is_none(), "a closed session leaves the map");
    }

    #[test]
    fn remember_persists_the_suggested_rule_and_the_floor_never_remembers() {
        let dir = tempfile::tempdir().unwrap();
        let spec = StartSpec {
            root: dir.path().display().to_string(),
            mode: Some("manual".into()),
            sessions_base: Some(dir.path().join(".sessions")),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        chat_request(&s);
        let bash = |cmd: &str| PendingCall {
            id: "x".into(),
            name: "bash".into(),
            input: serde_json::json!({ "command": cmd }),
            read_only: false,
            command: Some(cmd.into()),
            hunks: vec![],
        };
        assert!(matches!(
            s.policy.lock().unwrap().decide(&bash("cargo build")),
            Verdict::Ask { .. }
        ));

        // «permitir sempre» sobre um pedido normal: grava e passa a valer já
        let (tx, rx) = mpsc::channel();
        s.pending
            .lock()
            .unwrap()
            .insert("t1".into(), (tx, Some("bash:cargo build".into())));
        assert!(approve(&id, "t1", true, None, true));
        assert_eq!(rx.recv().unwrap(), Decision::Allow);
        let saved = std::fs::read_to_string(Rules::project_file(dir.path())).unwrap();
        assert!(saved.contains("bash:cargo build"), "{saved}");
        assert_eq!(
            s.policy
                .lock()
                .unwrap()
                .decide(&bash("cargo build --release")),
            Verdict::Allow
        );

        // pedido do piso (sem regra sugerida): «lembrar» não grava nada
        let (tx, rx) = mpsc::channel();
        s.pending.lock().unwrap().insert("t2".into(), (tx, None));
        assert!(approve(&id, "t2", true, None, true));
        assert_eq!(rx.recv().unwrap(), Decision::Allow);
        assert_eq!(
            Rules::load(dir.path(), None).allow,
            vec!["bash:cargo build"]
        );

        // recusa com razão chega ao loop
        let (tx, rx) = mpsc::channel();
        s.pending
            .lock()
            .unwrap()
            .insert("t3".into(), (tx, Some("edit".into())));
        assert!(approve(&id, "t3", false, Some("não mexas".into()), true));
        assert_eq!(rx.recv().unwrap(), Decision::Deny("não mexas".into()));
        assert!(
            !Rules::load(dir.path(), None)
                .allow
                .contains(&"edit".to_string()),
            "recusar não grava regra"
        );

        assert!(set_mode(&id, "auto"));
        assert_eq!(s.policy.lock().unwrap().mode, Mode::Auto);
        close(&id);
    }

    #[test]
    fn sessions_persist_and_resume_with_the_exact_prefix() {
        let proj = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        std::fs::write(proj.path().join("AGENTS.md"), "Usa cargo nextest.").unwrap();
        let root = proj.path().display().to_string();
        let spec = |resume: Option<String>, model: &str| StartSpec {
            root: root.clone(),
            model: Some(model.into()),
            test_cmd: Some("cargo test".into()),
            resume,
            sessions_base: Some(base.path().to_path_buf()),
            ..Default::default()
        };
        let id = start(spec(None, "claude-opus-5-5"), &key("sk"), None).unwrap();
        {
            // simula um turno já feito (send precisa da rede): histórico + gravação
            let s = get(&id).unwrap();
            let mut t = s.transcript.lock().unwrap();
            t.push(Message::user_text("corrige o lexer"));
            t.push(Message::system(mode_note(Mode::Assist)));
            t.push(Message::assistant(vec![
                serde_json::json!({"type":"thinking","thinking":"…","signature":"EqQB=="}),
                serde_json::json!({"type":"text","text":"Feito."}),
            ]));
            s.log.lock().unwrap().as_mut().unwrap().sync(&t).unwrap();
        }
        let system_before = get(&id).unwrap().agent.cfg.system.clone();
        assert!(system_before
            .iter()
            .any(|b| b.text.contains("Usa cargo nextest.")));
        close(&id);

        let list = list_sessions(&root, Some(base.path()));
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, id);
        assert_eq!(list[0].title, "corrige o lexer");

        // o AGENTS.md muda e a UI pede outro modelo — a retoma usa o prefixo gravado
        std::fs::write(proj.path().join("AGENTS.md"), "OUTRA regra").unwrap();
        let rid = start(spec(Some(id.clone()), "claude-haiku-5-5"), &key("sk"), None).unwrap();
        assert_eq!(rid, id);
        let s = get(&rid).unwrap();
        assert_eq!(
            s.agent.cfg.system, system_before,
            "system prompt reenviado tal como foi gravado"
        );
        assert_eq!(s.agent.cfg.model, "claude-opus-5-5");
        assert_eq!(s.transcript.lock().unwrap().len(), 3);
        let h = history(&rid).unwrap();
        assert_eq!(
            h.iter().map(|x| x.role.as_str()).collect::<Vec<_>>(),
            ["user", "assistant"]
        );

        // outro projecto não pode retomar esta sessão
        let other = tempfile::tempdir().unwrap();
        close(&rid);
        let mut bad = spec(Some(id.clone()), "x");
        bad.root = other.path().display().to_string();
        assert!(start(bad, &key("sk"), None).is_err());
        assert!(start(spec(Some("../fora".into()), "x"), &key("sk"), None).is_err());
    }

    #[test]
    fn arch_propose_enters_only_sessions_of_toolset_4() {
        let tool = |name: &'static str| -> Arc<dyn Tool> {
            struct T(&'static str);
            impl Tool for T {
                fn name(&self) -> &str {
                    self.0
                }
                fn description(&self) -> &str {
                    ""
                }
                fn input_schema(&self) -> serde_json::Value {
                    serde_json::json!({"type": "object"})
                }
                fn read_only(&self) -> bool {
                    true
                }
                fn run(&self, _: &serde_json::Value, _: &ToolCtx) -> tutor_agent::ToolOutput {
                    tutor_agent::ToolOutput::ok("")
                }
            }
            Arc::new(T(name))
        };
        let spec = StartSpec {
            host_tools: vec![tool("lsp_diagnostics")],
            host_tools_v4: vec![tool("arch_propose")],
            ..Default::default()
        };
        let names = |v: u32, scopes: &[&str]| -> Vec<String> {
            let meta: SessionMeta = serde_json::from_value(serde_json::json!({
                "id": "s", "root": "/p", "model": "m", "effort": "high", "system": [],
                "test_cmd": null, "lint_cmd": null, "compaction": true, "created": 1,
                "toolset": v, "scopes": scopes,
            }))
            .unwrap();
            session_host_tools(&spec, &meta)
                .iter()
                .map(|t| t.name().to_string())
                .collect()
        };
        assert_eq!(names(3, &[]), ["lsp_diagnostics"]);
        assert_eq!(names(4, &[]), ["lsp_diagnostics", "arch_propose"]);
        assert_eq!(names(8, &[]), ["lsp_diagnostics", "arch_propose"]);
        // toolset 9: only architecture sessions carry it
        assert_eq!(names(9, &[]), ["lsp_diagnostics"]);
        assert_eq!(names(9, &["issue"]), ["lsp_diagnostics"]);
        assert_eq!(names(9, &["arch"]), ["lsp_diagnostics", "arch_propose"]);

        // uma sessão nova grava o conjunto actual (4 com o arch_propose; 5 desde a A3)
        let proj = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let id = start(
            StartSpec {
                root: proj.path().display().to_string(),
                sessions_base: Some(base.path().to_path_buf()),
                ..Default::default()
            },
            &key("sk"),
            None,
        )
        .unwrap();
        close(&id);
        // o registo vive numa subpasta por projecto: procura-se o <id>.jsonl
        fn find(dir: &std::path::Path, name: &str) -> Option<std::path::PathBuf> {
            for e in std::fs::read_dir(dir).ok()?.flatten() {
                let p = e.path();
                if p.is_dir() {
                    if let Some(f) = find(&p, name) {
                        return Some(f);
                    }
                } else if p.file_name().is_some_and(|n| n == name) {
                    return Some(p);
                }
            }
            None
        }
        let file = find(base.path(), &format!("{id}.jsonl")).expect("a sessão foi gravada");
        let head = std::fs::read_to_string(file).unwrap();
        assert!(
            head.lines()
                .next()
                .unwrap()
                .contains(&format!("\"toolset\":{TOOLSET_VERSION}")),
            "{head}"
        );
        const {
            assert!(
                TOOLSET_VERSION >= 4,
                "the arch_propose tool needs toolset 4 or later"
            )
        };
    }

    #[test]
    fn toolset_9_sessions_get_the_tools_of_their_kind_and_resume_with_them() {
        let tool = |name: &'static str| -> Arc<dyn Tool> {
            struct T(&'static str);
            impl Tool for T {
                fn name(&self) -> &str {
                    self.0
                }
                fn description(&self) -> &str {
                    ""
                }
                fn input_schema(&self) -> serde_json::Value {
                    serde_json::json!({"type": "object"})
                }
                fn read_only(&self) -> bool {
                    true
                }
                fn run(&self, _: &serde_json::Value, _: &ToolCtx) -> tutor_agent::ToolOutput {
                    tutor_agent::ToolOutput::ok("")
                }
            }
            Arc::new(T(name))
        };
        let proj = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let spec = |architecture: bool, issue: Option<&str>, resume: Option<String>| StartSpec {
            root: proj.path().display().to_string(),
            sessions_base: Some(base.path().to_path_buf()),
            host_tools_v4: vec![tool("arch_propose")],
            architecture,
            issue_key: issue.map(String::from),
            resume,
            ..Default::default()
        };
        let names = |id: &str| -> Vec<String> {
            get(id)
                .unwrap()
                .agent
                .tool_defs()
                .into_iter()
                .map(|d| d.name)
                .collect()
        };
        // a plain chat: neither arch_propose nor finish_issue
        let chat = start(spec(false, None, None), &key("sk"), None).unwrap();
        let n = names(&chat);
        assert!(
            !n.iter().any(|t| t == "arch_propose" || t == "finish_issue"),
            "{n:?}"
        );
        assert!(n.iter().any(|t| t == "ask_human") && n.iter().any(|t| t == "suggest"));
        // the Claude prefix lives an hour (the review pauses)
        assert_eq!(get(&chat).unwrap().agent.cfg.cache_ttl, CacheTtl::OneHour);
        // an issue run: finish_issue; an architecture session: arch_propose
        let issue = start(spec(false, Some("DX-1"), None), &key("sk"), None).unwrap();
        assert!(names(&issue).iter().any(|t| t == "finish_issue"));
        assert!(!names(&issue).iter().any(|t| t == "arch_propose"));
        let arch = start(spec(true, None, None), &key("sk"), None).unwrap();
        let before = names(&arch);
        assert!(before.iter().any(|t| t == "arch_propose"));
        assert!(!before.iter().any(|t| t == "finish_issue"));
        // a resume keeps the saved kind, whatever the UI says now
        close(&arch);
        let again = start(spec(false, None, Some(arch.clone())), &key("sk"), None).unwrap();
        assert_eq!(names(&again), before);
        close(&issue);
        let again = start(spec(true, None, Some(issue.clone())), &key("sk"), None).unwrap();
        assert!(names(&again).iter().any(|t| t == "finish_issue"));
        assert!(!names(&again).iter().any(|t| t == "arch_propose"));
        for id in [chat, again, arch] {
            close(&id);
        }
    }

    /// The first request of a Co-Dev chat in THIS repository (system + tool definitions, before
    /// the human types): before phase 1 of the token work (toolset 8 with every tool, the
    /// instruction files cut at 40k characters) and now (toolset 9, a plain chat session).
    /// `cargo test -p dxtutor-ide --lib first_request_size -- --nocapture` prints the numbers.
    #[test]
    fn first_request_size_of_this_repository() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let host: Vec<Arc<dyn Tool>> = vec![Arc::new(crate::lsp::LspDiagnosticsTool)];
        let arch: Arc<dyn Tool> = Arc::new(crate::agent::ArchProposeTool {
            emit: Arc::new(|_| {}),
        });
        let outline: Arc<dyn Tool> = Arc::new(crate::codeintel::OutlineTool);
        let opts = |issue: bool| ToolsetOptions {
            test_cmd: Some("cargo test".into()),
            lint_cmd: Some("cargo clippy".into()),
            issue,
            ..Default::default()
        };
        let subagent = || SubagentSpec {
            provider: Arc::new(tutor_agent::anthropic::Anthropic::new(Config::new("k"))),
            model: "claude-opus-5-5".into(),
            effort: Effort::High,
            lang: ReplyLang::Pt,
        };
        let tools_bytes = |tools: &[Arc<dyn Tool>]| -> usize {
            tools
                .iter()
                .map(|t| {
                    serde_json::json!({"name": t.name(), "description": t.description(), "input_schema": t.input_schema()})
                        .to_string()
                        .len()
                })
                .sum()
        };
        let extras = |with_arch: bool| -> Vec<Arc<dyn Tool>> {
            let mut v = host.clone();
            if with_arch {
                v.push(arch.clone());
            }
            v.push(outline.clone());
            v
        };
        // before: toolset 8, every tool, and the old instruction files (40k chars each, 120 KB in all)
        let before_tools = agent_tools(
            &opts(false),
            8,
            &FlowState::default(),
            Some(subagent()),
            extras(true),
        );
        let mut old = String::new();
        for name in tutor_agent::context::INSTRUCTION_FILES {
            let Ok(text) = std::fs::read_to_string(root.join(name)) else {
                continue;
            };
            let mut body: String = text.chars().take(40 * 1024).collect();
            if body.len() < text.len() {
                body.push_str("\n…[ficheiro cortado]");
            }
            if old.len() + body.len() > 120 * 1024 {
                continue;
            }
            old.push_str(&format!(
                "\n\n<instructions file=\"{name}\">\n{}\n</instructions>",
                body.trim_end()
            ));
        }
        let core_len = session_system(root, true, ReplyLang::Pt)[0].0.len();
        let before_system = core_len + old.len();
        // now: toolset 9, a plain chat (no arch_propose, no finish_issue), condensed instructions
        let after_tools = agent_tools(
            &opts(false),
            9,
            &FlowState::default(),
            Some(subagent()),
            extras(false),
        );
        let after_system: usize = session_system(root, true, ReplyLang::Pt)
            .iter()
            .map(|b| b.0.len())
            .sum();
        let (b_tools, a_tools) = (tools_bytes(&before_tools), tools_bytes(&after_tools));
        let tok = |b: usize| b * 10 / 35; // ~3.5 bytes per token (Portuguese prose, code, JSON)
        println!(
            "first request (bytes ≈ tokens): before system {} ≈ {}, tools {} ({}) ≈ {}, total ≈ {}; \
             after system {} ≈ {}, tools {} ({}) ≈ {}, total ≈ {}; issue run +finish_issue, architecture +arch_propose {} bytes",
            before_system, tok(before_system), b_tools, before_tools.len(), tok(b_tools), tok(before_system + b_tools),
            after_system, tok(after_system), a_tools, after_tools.len(), tok(a_tools), tok(after_system + a_tools),
            tools_bytes(std::slice::from_ref(&arch)),
        );
        assert!(
            after_system + a_tools < (before_system + b_tools) / 2,
            "the first request must at least halve"
        );
    }

    #[test]
    fn plan_mode_is_shared_with_the_policy_and_announced_once() {
        let proj = tempfile::tempdir().unwrap();
        let spec = StartSpec {
            root: proj.path().display().to_string(),
            mode: Some("auto".into()),
            sessions_base: Some(proj.path().join(".s")),
            ..Default::default()
        };
        let id = start(spec, &key("sk"), None).unwrap();
        let s = get(&id).unwrap();
        chat_request(&s);
        let edit = PendingCall {
            id: "e".into(),
            name: "edit".into(),
            input: serde_json::json!({"path": "a.rs"}),
            read_only: false,
            command: None,
            hunks: vec![],
        };
        assert_eq!(s.policy.lock().unwrap().decide(&edit), Verdict::Allow);
        set_plan(&id, true).unwrap();
        set_plan(&id, true).unwrap(); // repetir não duplica o aviso
        assert!(matches!(
            s.policy.lock().unwrap().decide(&edit),
            Verdict::Deny { .. }
        ));
        assert_eq!(s.notes.lock().unwrap().len(), 1);
        set_plan(&id, false).unwrap();
        assert_eq!(s.policy.lock().unwrap().decide(&edit), Verdict::Allow);
        // fora de um repositório git: sem checkpoints, rewind explica porquê
        assert!(checkpoints(&id).unwrap().is_empty());
        assert!(rewind(&id, 1, false).unwrap_err().contains("git"));
        close(&id);
    }

    #[test]
    fn extensions_status_trust_and_slash_commands() {
        let proj = tempfile::tempdir().unwrap();
        let cfg = tempfile::tempdir().unwrap();
        let store = cfg.path().join("trusted.json");
        let root = proj.path();
        std::fs::create_dir_all(root.join(".dxtutor/commands")).unwrap();
        std::fs::write(root.join(".dxtutor/commands/rever.md"), "Revê $ARGUMENTS.").unwrap();
        std::fs::write(root.join(".dxtutor/hooks.json"), r#"{"stop":[]}"#).unwrap();
        std::fs::write(
            root.join(".dxtutor/mcp.json"),
            r#"{"mcpServers":{"local":{"command":"/nao/existe"}}}"#,
        )
        .unwrap();
        let r = root.display().to_string();

        let st = extensions_status(&r, Some(&store), None);
        assert_eq!(st.commands.len(), 1);
        assert_eq!(
            st.hooks,
            FileTrust {
                present: true,
                trusted: false
            }
        );
        assert_eq!(st.mcp_servers, vec!["local"]);
        trust_project_file(&r, "hooks", Some(&store)).unwrap();
        assert!(extensions_status(&r, Some(&store), None).hooks.trusted);
        assert!(trust_project_file(&r, "outra", Some(&store)).is_err());

        // hooks confiados ficam ligados; o MCP do projecto, por confiar, não arranca e avisa
        let spec = StartSpec {
            root: r.clone(),
            sessions_base: Some(cfg.path().join("s")),
            trust_store: Some(store.clone()),
            ..Default::default()
        };
        let id = start(spec, &key("sk"), None).unwrap();
        let s = get(&id).unwrap();
        assert!(s.agent.hooks.is_some());
        assert!(s
            .startup_notices
            .iter()
            .any(|n| n.contains("servidores MCP")));
        close(&id);
    }

    #[test]
    fn mode_notes_name_the_mode() {
        assert!(mode_note(Mode::Manual).contains("Manual"));
        assert!(mode_note(Mode::Auto).contains("perigosas"));
    }

    #[test]
    fn effort_parsing_defaults_to_high() {
        assert_eq!(parse_effort(Some("LOW")), Effort::Low);
        assert_eq!(parse_effort(Some("max")), Effort::Max);
        assert_eq!(parse_effort(Some("qualquer")), Effort::High);
        assert_eq!(parse_effort(None), Effort::High);
    }

    #[test]
    fn approval_waits_for_the_ui_or_gives_up_on_cancel() {
        let (tx, rx) = mpsc::channel();
        let flag = AtomicBool::new(false);
        tx.send(Decision::Allow).unwrap();
        assert_eq!(wait_decision(&rx, &flag), Decision::Allow);
        flag.store(true, Ordering::Relaxed);
        assert!(matches!(wait_decision(&rx, &flag), Decision::Deny(_)));
    }

    #[test]
    fn hunk_gate_reviews_in_manual_and_assist_and_validates_in_auto() {
        let ask = Verdict::Ask {
            reason: "ficheiro protegido".into(),
            dangerous: true,
            suggested_rule: None,
        };
        let review = |g: HunkGate| {
            matches!(
                g,
                HunkGate::Review {
                    degraded: false,
                    ..
                }
            )
        };
        // an "allow always" rule makes the policy say Allow: still reviewed (D1)
        assert!(review(hunk_gate(Verdict::Allow, Mode::Manual, true)));
        assert!(review(hunk_gate(Verdict::Allow, Mode::Assist, true)));
        assert_eq!(
            hunk_gate(Verdict::Allow, Mode::Auto, true),
            HunkGate::Provisional
        );
        // Auto without checks or checkpoints degrades to review (D2)
        assert!(matches!(
            hunk_gate(Verdict::Allow, Mode::Auto, false),
            HunkGate::Review { degraded: true, .. }
        ));
        // protected files: the policy asks, and that is a review even in Auto
        assert_eq!(
            hunk_gate(ask, Mode::Auto, true),
            HunkGate::Review {
                reason: "ficheiro protegido".into(),
                degraded: false
            }
        );
        assert_eq!(
            hunk_gate(
                Verdict::Deny {
                    reason: "plano".into()
                },
                Mode::Auto,
                true
            ),
            HunkGate::Deny("plano".into())
        );
    }

    #[test]
    fn review_decides_each_hunk_and_counts_missing_ones_as_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let spec = StartSpec {
            root: dir.path().display().to_string(),
            sessions_base: Some(dir.path().join(".sessions")),
            review_edits: true,
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        assert!(s.agent.hunks.is_some(), "review_edits turns live hunks on");
        let wait = |call: &str, hunks: &[&str]| {
            let (tx, rx) = mpsc::channel();
            s.pending.lock().unwrap().insert(call.into(), (tx, None));
            s.review
                .lock()
                .unwrap()
                .insert(call.into(), hunks.iter().map(|h| h.to_string()).collect());
            rx
        };
        let v = |hunk: &str, accept: bool, reason: Option<&str>| HunkVerdict {
            hunk: hunk.into(),
            accept,
            reason: reason.map(String::from),
        };

        let rx = wait("c1", &["c1:1", "c1:2", "c1:3"]);
        review(
            &id,
            "c1",
            &[v("c1:1", true, None), v("c1:2", false, Some("não"))],
        )
        .unwrap();
        assert_eq!(
            rx.recv().unwrap(),
            Decision::Hunks {
                accepted: vec!["c1:1".into()],
                rejected: vec![
                    ("c1:2".into(), "não".into()),
                    ("c1:3".into(), "sem decisão".into())
                ],
                provisional: false,
            }
        );
        assert!(s.review.lock().unwrap().is_empty());

        // an unknown hunk is refused and the review keeps waiting
        let rx = wait("c2", &["c2:1"]);
        let e = review(&id, "c2", &[v("c1:1", true, None)]).unwrap_err();
        assert!(e.contains("hunk desconhecido"), "{e}");
        assert!(s.pending.lock().unwrap().contains_key("c2"));
        review(&id, "c2", &[v("c2:1", false, Some(" "))]).unwrap();
        assert_eq!(
            rx.recv().unwrap(),
            Decision::Hunks {
                accepted: vec![],
                rejected: vec![("c2:1".into(), "recusado".into())],
                provisional: false,
            }
        );

        // nothing waiting, wrong call, wrong session
        assert!(review(&id, "c2", &[]).unwrap_err().contains("nenhuma"));
        assert!(review("cda-nada", "c1", &[])
            .unwrap_err()
            .contains("desconhecida"));
    }

    /// A git repo with `a.txt` committed, and an Auto session whose test command checks it.
    fn auto_repo(test_cmd: &str) -> (tempfile::TempDir, String) {
        let d = tempfile::tempdir().unwrap();
        let g = |args: &[&str]| {
            assert!(std::process::Command::new("git")
                .args(args)
                .current_dir(d.path())
                .output()
                .unwrap()
                .status
                .success())
        };
        g(&["init", "-q", "-b", "main"]);
        g(&["config", "user.name", "t"]);
        g(&["config", "user.email", "t@t"]);
        std::fs::write(d.path().join("a.txt"), "ok\n").unwrap();
        g(&["add", "."]);
        g(&["commit", "-qm", "init"]);
        let spec = StartSpec {
            root: d.path().display().to_string(),
            mode: Some("auto".into()),
            test_cmd: Some(test_cmd.into()),
            sessions_base: Some(d.path().join(".git").join("sessions")),
            review_edits: true,
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        (d, id)
    }

    fn kinds(evs: &[AgentEvent]) -> Vec<String> {
        evs.iter()
            .map(|e| {
                serde_json::to_value(e).unwrap()["kind"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn auto_validation_rolls_back_the_turn_when_a_passing_check_breaks() {
        let (d, id) = auto_repo("grep -qx ok a.txt");
        let s = get(&id).unwrap();
        let cps = s
            .agent
            .checkpoints
            .as_ref()
            .expect("a git repo has checkpoints");
        let baseline = hunks::run_checks(&s.checks, &s.agent.ctx);
        assert!(baseline[0].ok);
        let cp = cps.snapshot("turn").unwrap();
        std::fs::write(d.path().join("a.txt"), "bad\n").unwrap(); // the provisional hunk
        let mut evs = vec![];
        let sink = RefCell::new(&mut evs);
        validate(
            &s,
            AutoTurn {
                baseline: Some(baseline),
                provisional: vec!["c:1".into()],
                checkpoint: Some(cp.id),
                degraded: false,
                provisional_meta: vec![],
            },
            &|e| sink.borrow_mut().push(e),
        );
        assert_eq!(
            std::fs::read_to_string(d.path().join("a.txt")).unwrap(),
            "ok\n"
        );
        assert_eq!(
            kinds(&evs),
            ["validation", "hunk_rejected", "validation", "notice"]
        );
        let rejected = serde_json::to_value(&evs[1]).unwrap();
        assert_eq!(rejected["by"], "validation");
        let failed = serde_json::to_value(&evs[2]).unwrap();
        assert_eq!(failed["status"], "failed");
        assert_eq!(failed["baseline"][0]["ok"], true);
        // the model hears about it in its next message
        assert!(s.notes.lock().unwrap()[0].contains("repostos"));
    }

    #[test]
    fn auto_validation_keeps_changes_that_break_nothing() {
        let (d, id) = auto_repo("grep -q ok a.txt");
        let s = get(&id).unwrap();
        let baseline = hunks::run_checks(&s.checks, &s.agent.ctx);
        std::fs::write(d.path().join("a.txt"), "ok, better\n").unwrap();
        let mut evs = vec![];
        let sink = RefCell::new(&mut evs);
        validate(
            &s,
            AutoTurn {
                baseline: Some(baseline),
                provisional: vec!["c:1".into()],
                checkpoint: None,
                degraded: false,
                provisional_meta: vec![],
            },
            &|e| sink.borrow_mut().push(e),
        );
        assert_eq!(kinds(&evs), ["validation", "validation"]);
        assert_eq!(serde_json::to_value(&evs[1]).unwrap()["status"], "passed");
        assert_eq!(
            std::fs::read_to_string(d.path().join("a.txt")).unwrap(),
            "ok, better\n"
        );
    }

    #[test]
    fn review_edits_tells_the_model_to_keep_code_out_of_the_reply() {
        let dir = tempfile::tempdir().unwrap();
        let with = session_system(dir.path(), true, ReplyLang::Pt);
        let without = session_system(dir.path(), false, ReplyLang::Pt);
        assert!(with[0].0.ends_with(REVIEW_EDITS_NOTE));
        assert!(!without[0].0.contains(REVIEW_EDITS_NOTE));
        assert_eq!(with.len(), without.len());
        assert!(
            with.last().unwrap().1,
            "the cache breakpoint stays at the end"
        );
    }

    #[test]
    fn the_session_answers_in_the_interface_language() {
        let dir = tempfile::tempdir().unwrap();
        let en = session_system(dir.path(), true, ReplyLang::from_ui(Some("en")));
        assert!(en[0].0.contains("answer the human in English"));
        assert!(!en[0].0.contains("Respondes em português"));
        assert!(en[0].0.ends_with(REVIEW_EDITS_NOTE));
        let pt = session_system(dir.path(), false, ReplyLang::from_ui(Some("ptAO")));
        assert!(pt[0]
            .0
            .contains("Respondes em português (ortografia pré-AO90)"));
        // a session saved before the language existed reads as Portuguese, as it was
        let old: SessionMeta = serde_json::from_value(serde_json::json!({
            "id": "s", "root": "/p", "model": "m", "effort": "high", "system": [],
            "test_cmd": null, "lint_cmd": null, "compaction": false, "created": 1
        }))
        .unwrap();
        assert_eq!(old.lang(), ReplyLang::Pt);
    }

    #[test]
    fn auto_changes_that_pass_validation_are_recorded_on_the_issue() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("board.sqlite3");
        let spec = StartSpec {
            root: d.path().display().to_string(),
            sessions_base: Some(d.path().join(".sessions")),
            mode: Some("auto".into()),
            test_cmd: Some("true".into()),
            review_edits: true,
            issue_key: Some("DX-7".into()),
            change_log: Some(db.clone()),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        let root = s.agent.ctx.root.display().to_string();
        {
            // the issue exists in the project of this folder
            let mut st = tutor_board::project::ProjectStore::open(&db).unwrap();
            st.apply(
                &root,
                "t",
                1,
                serde_json::from_value(serde_json::json!({"op": "settings", "key_prefix": "DX"}))
                    .unwrap(),
            )
            .unwrap();
            for _ in 0..7 {
                st.apply(
                    &root,
                    "t",
                    1,
                    serde_json::from_value(serde_json::json!({"op": "create_issue", "title": "x"}))
                        .unwrap(),
                )
                .unwrap();
            }
        }
        let meta = HunkMeta {
            call: "toolu_1".into(),
            path: "src/a.rs".into(),
            start: 3,
            end: 3,
            added: 2,
            removed: 1,
            ..Default::default()
        };
        let evs = RefCell::new(vec![]);
        validate(
            &s,
            AutoTurn {
                baseline: Some(vec![]),
                provisional: vec!["toolu_1:1".into()],
                checkpoint: None,
                degraded: false,
                provisional_meta: vec![("toolu_1:1".into(), meta)],
            },
            &|e| evs.borrow_mut().push(e),
        );
        let st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let detail = st.detail(&root, "DX-7").unwrap();
        assert_eq!(detail.change_sets.len(), 1);
        assert_eq!(detail.change_sets[0].decided_by, "validation");
        assert_eq!(
            (detail.change_sets[0].added, detail.change_sets[0].removed),
            (2, 1)
        );
    }

    #[test]
    fn rewind_to_here_takes_files_and_conversation_back() {
        let (d, id) = auto_repo("true");
        let s = get(&id).unwrap();
        let cps = s.agent.checkpoints.as_ref().unwrap();
        {
            let mut t = s.transcript.lock().unwrap();
            t.push(Message::user_text("primeiro"));
            t.push(Message::user_text("segundo"));
        }
        // the turn of checkpoint 1 started with 1 message in the conversation
        let cp = cps.snapshot("segundo").unwrap();
        s.cp_marks.lock().unwrap().insert(cp.id, 1);
        std::fs::write(d.path().join("a.txt"), "changed\n").unwrap();
        s.transcript
            .lock()
            .unwrap()
            .push(Message::user_text("terceiro"));
        if let Some(l) = s.log.lock().unwrap().as_mut() {
            l.sync(&s.transcript.lock().unwrap()).unwrap();
        }
        let views = checkpoints(&id).unwrap();
        assert!(views
            .iter()
            .any(|v| v.checkpoint.id == cp.id && v.conversation));
        let msg = rewind(&id, cp.id, true).unwrap();
        assert!(msg.contains("a conversa voltou"), "{msg}");
        assert_eq!(
            std::fs::read_to_string(d.path().join("a.txt")).unwrap(),
            "ok\n"
        );
        assert_eq!(s.transcript.lock().unwrap().len(), 1);
        assert!(s.notes.lock().unwrap().is_empty());
        // the session file now holds the shorter conversation
        let path = s.log.lock().unwrap().as_ref().unwrap().path().to_path_buf();
        let reopened = tutor_agent::session::SessionLog::open(path.parent().unwrap(), &id).unwrap();
        assert_eq!(reopened.1.len(), 1);
        // without a mark (a resumed session) only the files can go back
        s.cp_marks.lock().unwrap().clear();
        assert!(rewind(&id, cp.id, true).unwrap_err().contains("retomada"));
        assert!(rewind(&id, cp.id, false).is_ok());
    }

    #[test]
    fn permissions_are_validated_saved_and_applied_to_open_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let spec = StartSpec {
            root: dir.path().display().to_string(),
            sessions_base: Some(dir.path().join(".sessions")),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let root = dir.path().display().to_string();
        let bad = Rules {
            allow: vec!["rm -rf /".into()],
            deny: vec![],
        };
        assert!(save_permissions(&root, bad)
            .unwrap_err()
            .contains("regra inválida"));
        let rules = Rules {
            allow: vec!["bash:cargo test".into(), "edit".into(), "edit".into()],
            deny: vec!["bash:git push".into()],
        };
        save_permissions(&root, rules).unwrap();
        let v = permissions(&root);
        assert_eq!(
            v.project.allow,
            vec!["bash:cargo test".to_string(), "edit".to_string()]
        );
        assert_eq!(v.project.deny, vec!["bash:git push".to_string()]);
        assert!(v.project_file.ends_with(".dxtutor/permissions.json"));
        let s = get(&id).unwrap();
        assert!(s
            .policy
            .lock()
            .unwrap()
            .rules
            .allow
            .contains(&"bash:cargo test".to_string()));
    }

    #[test]
    fn sessions_without_review_edits_keep_direct_writes() {
        let dir = tempfile::tempdir().unwrap();
        let spec = StartSpec {
            root: dir.path().display().to_string(),
            sessions_base: Some(dir.path().join(".sessions")),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        assert!(get(&id).unwrap().agent.hunks.is_none());
    }

    #[test]
    fn send_on_unknown_session_fails() {
        let r = send(
            "cda-nada",
            Some("olá".into()),
            None,
            &mut |_| {},
            &mut |_: &ApprovalRequest| {},
        );
        assert!(r.unwrap_err().contains("desconhecida"));
    }

    #[test]
    fn the_ide_requires_a_request_and_logs_turns_and_mode_changes() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("board.sqlite3");
        std::fs::write(d.path().join(".env"), "API_TOKEN=tok_9f8e7d6c5b\n").unwrap();
        let spec = StartSpec {
            root: d.path().display().to_string(),
            sessions_base: Some(d.path().join(".sessions")),
            mode: Some("manual".into()),
            provider: Some("ollama".into()),
            ollama_host: Some("http://127.0.0.1:9".into()),
            change_log: Some(db.clone()),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        assert!(s.policy.lock().unwrap().require_origin);
        let root = s.agent.ctx.root.display().to_string();
        // an issue request: the provider is unreachable, the turn fails, but it is logged
        let o = Origin {
            kind: tutor_agent::permissions::OriginKind::Issue,
            issue: Some("DX-3".into()),
            by: "forged by the UI".into(),
            scope: vec!["src/**".into(), " ".into()],
            template: None,
        };
        let _ = send(
            &id,
            Some("usa tok_9f8e7d6c5b".into()),
            Some(o),
            &mut |_| {},
            &mut |_| {},
        );
        let held = s.origin.lock().unwrap().clone().unwrap();
        assert_eq!(
            held.by,
            crate::board::actor(&root),
            "who asked comes from the host"
        );
        assert_eq!(held.scope, vec!["src/**"]);
        assert_eq!(s.issue_key.lock().unwrap().as_deref(), Some("DX-3"));
        // «try again» keeps the request; a new message without one has none
        let _ = send(&id, None, None, &mut |_| {}, &mut |_| {});
        assert!(s.policy.lock().unwrap().origin.is_some());
        let _ = send(&id, Some("outra".into()), None, &mut |_| {}, &mut |_| {});
        assert!(s.policy.lock().unwrap().origin.is_none());
        assert!(set_mode(&id, "auto"));
        assert!(
            set_mode(&id, "auto"),
            "the same mode again is not logged twice"
        );
        let st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let rows = st.audit(&root, None).unwrap();
        let kinds: Vec<(&str, &str)> = rows
            .iter()
            .map(|e| (e.event.as_str(), e.origin.as_str()))
            .collect();
        assert_eq!(
            kinds,
            [
                ("turn", "issue"),
                ("turn", "issue"),
                ("turn", "none"),
                ("mode", "none")
            ]
        );
        assert_eq!(rows[0].issue_key.as_deref(), Some("DX-3"));
        assert_eq!(rows[0].outcome.as_deref(), Some("error"));
        assert_eq!(rows[3].reason.as_deref(), Some("manual → auto"));
        // the session log masks the project's .env secrets (RF-T05)
        let log = std::fs::read_to_string(s.log.lock().unwrap().as_ref().unwrap().path()).unwrap();
        assert!(
            log.contains("usa ••••") && !log.contains("tok_9f8e7d6c5b"),
            "{log}"
        );
    }

    #[test]
    fn outcomes_for_the_audit_log() {
        assert_eq!(outcome_of(&Decision::Allow), "allowed");
        assert_eq!(outcome_of(&Decision::Deny(NO_REQUEST.into())), "blocked");
        assert_eq!(outcome_of(&Decision::Deny("não".into())), "denied");
        let h = |a: &[&str], r: &[&str]| Decision::Hunks {
            accepted: a.iter().map(|x| x.to_string()).collect(),
            rejected: r.iter().map(|x| (x.to_string(), String::new())).collect(),
            provisional: false,
        };
        assert_eq!(outcome_of(&h(&["1"], &[])), "allowed");
        assert_eq!(outcome_of(&h(&["1"], &["2"])), "partial");
        assert_eq!(outcome_of(&h(&[], &["2"])), "denied");
    }

    #[test]
    fn a_question_blocks_the_issue_and_suggestions_wait_in_the_inbox() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("board.sqlite3");
        let spec = StartSpec {
            root: d.path().display().to_string(),
            sessions_base: Some(d.path().join(".sessions")),
            mode: Some("assist".into()),
            issue_key: Some("DX-1".into()),
            change_log: Some(db.clone()),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        // a new session uses toolset 6: the gates are on
        assert!(s.policy.lock().unwrap().gates.is_some());
        let root = s.agent.ctx.root.display().to_string();
        {
            let mut st = tutor_board::project::ProjectStore::open(&db).unwrap();
            st.apply(
                &root,
                "t",
                1,
                serde_json::from_value(serde_json::json!({"op": "settings", "key_prefix": "DX"}))
                    .unwrap(),
            )
            .unwrap();
            st.apply(
                &root,
                "t",
                1,
                serde_json::from_value(serde_json::json!({"op": "create_issue", "title": "x"}))
                    .unwrap(),
            )
            .unwrap();
        }
        *s.flow.question.lock().unwrap() = Some("Paginação por cursor ou por página?".into());
        s.flow
            .suggestions
            .lock()
            .unwrap()
            .push(("Renomear Parser::go".into(), "src/p.rs 12".into()));
        let evs = RefCell::new(vec![]);
        settle_flow(&s, &|e| evs.borrow_mut().push(e));
        assert!(evs
            .borrow()
            .iter()
            .any(|e| matches!(e, AgentEvent::Question { text } if text.contains("cursor"))));
        let st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let p = st.load(&root, 2).unwrap();
        let issue = p.issues.iter().find(|i| i.key == "DX-1").unwrap();
        assert_eq!(
            issue.blocked.as_deref(),
            Some("dúvida: Paginação por cursor ou por página?")
        );
        assert_eq!(p.inbox.len(), 1);
        assert_eq!(p.inbox[0].title, "Renomear Parser::go");
        assert_eq!(p.inbox[0].source, "Co-Dev");
        let kinds: Vec<String> = st
            .audit(&root, Some("DX-1"))
            .unwrap()
            .into_iter()
            .map(|e| e.event)
            .collect();
        assert_eq!(kinds, ["question", "suggest"]);
        // the suggestions were taken (not offered again next turn)
        assert!(s.flow.suggestions.lock().unwrap().is_empty());
    }

    #[test]
    fn after_stop_the_human_learns_how_to_drop_the_turns_changes() {
        assert_eq!(
            stop_notice(None),
            None,
            "nothing was written: nothing to say"
        );
        let t = stop_notice(Some(4)).unwrap();
        assert!(
            t.contains("checkpoint 4") && t.contains("nada mais é escrito"),
            "{t}"
        );
    }

    /// A session on an issue of a project database, with `check` as the project's test command.
    fn issue_session(check: &str) -> (tempfile::TempDir, String, Arc<Session>, String) {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("board.sqlite3");
        let spec = StartSpec {
            root: d.path().display().to_string(),
            sessions_base: Some(d.path().join(".sessions")),
            mode: Some("auto".into()),
            test_cmd: Some(check.into()),
            provider: Some("ollama".into()),
            ollama_host: Some("http://127.0.0.1:9".into()),
            change_log: Some(db.clone()),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        let root = s.agent.ctx.root.display().to_string();
        let mut st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let op = |v: serde_json::Value| serde_json::from_value(v).unwrap();
        st.apply(
            &root,
            "t",
            1,
            op(serde_json::json!({"op": "settings", "key_prefix": "DX"})),
        )
        .unwrap();
        st.apply(&root, "t", 1, op(serde_json::json!({"op": "create_issue", "title": "Paginar", "acceptance": ["Dado 30, quando peço a página 2, então recebo 11-20"]}))).unwrap();
        (d, id, s, root)
    }

    #[test]
    fn an_issue_that_is_not_ready_gives_no_request_and_a_ready_one_brings_its_criteria_and_scope() {
        let (d, id, s, root) = issue_session("true");
        let issue = |k: &str| Origin {
            kind: tutor_agent::permissions::OriginKind::Issue,
            issue: Some(k.into()),
            by: String::new(),
            scope: vec![],
            template: Some("v1".into()),
        };
        let notes = RefCell::new(vec![]);
        let _ = send(
            &id,
            Some("implementa".into()),
            Some(issue("DX-1")),
            &mut |e| {
                if let AgentEvent::Notice { text } = e {
                    notes.borrow_mut().push(text)
                }
            },
            &mut |_| {},
        );
        assert!(s.origin.lock().unwrap().is_none(), "not Ready: no request");
        assert!(
            notes
                .borrow()
                .iter()
                .any(|n| n.contains("DX-1 ainda não está Ready") && n.contains("âmbito")),
            "{:?}",
            notes.borrow()
        );
        let db = d.path().join("board.sqlite3");
        let mut st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let op = |v: serde_json::Value| serde_json::from_value(v).unwrap();
        st.apply(&root, "ana", 2, op(serde_json::json!({"op": "update_issue", "key": "DX-1", "story_as": "cliente", "story_want": "páginas", "story_so": "menos linhas", "scope": ["src/**"]}))).unwrap();
        st.apply(
            &root,
            "ana",
            2,
            op(serde_json::json!({"op": "update_issue", "key": "DX-1", "ready": true})),
        )
        .unwrap();
        st.apply(
            &root,
            "ana",
            2,
            op(serde_json::json!({"op": "settings", "dod": ["Docs updated"]})),
        )
        .unwrap();
        let _ = send(
            &id,
            Some("implementa".into()),
            Some(issue("DX-1")),
            &mut |_| {},
            &mut |_| {},
        );
        let o = s.origin.lock().unwrap().clone().unwrap();
        assert_eq!(o.scope, vec!["src/**"], "the issue's scope");
        assert_eq!(s.flow.criteria.lock().unwrap().len(), 1);
        // Board B: the DoD goes to finish_issue, and starting work moved the issue to In progress
        assert_eq!(*s.flow.dod.lock().unwrap(), ["Docs updated"]);
        let p = st.load(&root, 3).unwrap();
        assert_eq!(p.issues[0].state, "progress");
        // the prompt «Ver prompt» shows is the one the issue goes with
        let r = crate::board::issue_prompt_from(&st, &root, "DX-1", None).unwrap();
        assert_eq!(r.lang, "pt");
        assert!(
            r.text.contains("# Issue DX-1 — Paginar")
                && r.text.contains("Ficheiros/pastas: src/**.")
        );
    }

    #[test]
    fn the_criteria_table_sends_the_issue_to_review_and_failing_tests_send_it_back() {
        for (check, state, attempts) in [("true", "review", 0), ("false", "progress", 1)] {
            let (d, _id, s, root) = issue_session(check);
            *s.issue_key.lock().unwrap() = Some("DX-1".into());
            // Board B: Co-Dev's work is in progress when it finishes (the start moved it)
            assert!(start_work(&s, "DX-1", None).is_ok());
            *s.flow.finished.lock().unwrap() =
                Some(serde_json::json!({"criteria": [{"index": 1, "met": true, "evidence": "t"}]}));
            let evs = RefCell::new(vec![]);
            settle_flow(&s, &|e| evs.borrow_mut().push(e));
            let st =
                tutor_board::project::ProjectStore::open(&d.path().join("board.sqlite3")).unwrap();
            let i = st
                .load(&root, 3)
                .unwrap()
                .issues
                .into_iter()
                .find(|i| i.key == "DX-1")
                .unwrap();
            assert_eq!(
                (i.state.as_str(), i.attempts),
                (state, attempts),
                "check {check}"
            );
            assert!(i.criteria_report.is_some());
            let kinds: Vec<String> = st
                .audit(&root, Some("DX-1"))
                .unwrap()
                .into_iter()
                .map(|e| e.event)
                .collect();
            assert_eq!(kinds, ["finish", "tests"]);
        }
    }

    #[test]
    fn starting_codev_is_the_normal_move_and_a_refusal_blocks_the_request() {
        let (d, id, s, root) = issue_session("true");
        let db = d.path().join("board.sqlite3");
        let mut st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let op = |v: serde_json::Value| serde_json::from_value(v).unwrap();
        for v in [
            serde_json::json!({"op": "update_issue", "key": "DX-1", "story_as": "cliente", "story_want": "páginas", "story_so": "menos linhas", "scope": ["src/**"]}),
            serde_json::json!({"op": "update_issue", "key": "DX-1", "ready": true}),
            serde_json::json!({"op": "create_issue", "title": "Outra"}),
            serde_json::json!({"op": "move", "key": "DX-2", "to": "progress"}),
            serde_json::json!({"op": "settings", "wip": {"progress": 1}}),
        ] {
            st.apply(&root, "ana", 2, op(v)).unwrap();
        }
        let notes = RefCell::new(vec![]);
        let _ = send(
            &id,
            Some("implementa".into()),
            Some(Origin {
                kind: tutor_agent::permissions::OriginKind::Issue,
                issue: Some("DX-1".into()),
                by: String::new(),
                scope: vec![],
                template: None,
            }),
            &mut |e| {
                if let AgentEvent::Notice { text } = e {
                    notes.borrow_mut().push(text)
                }
            },
            &mut |_| {},
        );
        assert!(s.origin.lock().unwrap().is_none(), "refused: no request");
        assert!(
            notes
                .borrow()
                .iter()
                .any(|n| n.contains("DX-1 não passou a Em curso") && n.contains("limite de WIP")),
            "{:?}",
            notes.borrow()
        );
        assert_eq!(st.load(&root, 3).unwrap().issues[0].state, "todo");
        // the human overrides on the board, with a reason; then the request goes
        st.apply(&root, "ana", 3, op(serde_json::json!({"op": "move", "key": "DX-1", "to": "progress", "reason": "urgente"})))
            .unwrap();
        assert!(
            start_work(&s, "DX-1", None).is_ok(),
            "already in progress: nothing to do"
        );
    }

    #[test]
    fn a_full_review_column_keeps_the_finished_issue_in_progress_and_says_why() {
        let (d, _id, s, root) = issue_session("true");
        let db = d.path().join("board.sqlite3");
        let mut st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let op = |v: serde_json::Value| serde_json::from_value(v).unwrap();
        for v in [
            serde_json::json!({"op": "move", "key": "DX-1", "to": "progress"}),
            serde_json::json!({"op": "settings", "wip": {"review": 0}}),
        ] {
            st.apply(&root, "ana", 2, op(v)).unwrap();
        }
        *s.issue_key.lock().unwrap() = Some("DX-1".into());
        *s.flow.finished.lock().unwrap() =
            Some(serde_json::json!({"criteria": [{"index": 1, "met": true, "evidence": "t"}]}));
        let evs = RefCell::new(vec![]);
        settle_flow(&s, &|e| evs.borrow_mut().push(e));
        assert_eq!(st.load(&root, 3).unwrap().issues[0].state, "progress");
        let finish = st
            .audit(&root, Some("DX-1"))
            .unwrap()
            .into_iter()
            .find(|e| e.event == "finish")
            .unwrap();
        assert_eq!(finish.outcome.as_deref(), Some("held"));
        assert!(finish.reason.unwrap().contains("limite de WIP de «review»"));
        assert!(evs.borrow().iter().any(
            |e| matches!(e, AgentEvent::Notice { text } if text.contains("não passou a Review"))
        ));
    }

    #[test]
    fn a_failing_test_run_with_only_tests_changed_is_the_red_step() {
        assert!(is_red_run(
            "run_tests",
            true,
            "$ cargo test\nexit 101\nfailed"
        ));
        assert!(!is_red_run("run_tests", false, "$ cargo test\nexit 0\nok"));
        assert!(
            !is_red_run("run_tests", true, "recusado pela política"),
            "a refusal did not run"
        );
        assert!(!is_red_run("lint", true, "$ clippy\nexit 1"));
        let (d, _id, s, root) = issue_session("true");
        *s.issue_key.lock().unwrap() = Some("DX-1".into());
        let applied = AgentEvent::HunkApplied {
            hunk: "h".into(),
            provisional: false,
            fingerprint: String::new(),
        };
        let red = AgentEvent::ToolResult {
            id: "t".into(),
            name: "run_tests".into(),
            is_error: true,
            content: "$ cargo test\nexit 101".into(),
        };
        // red before any test: nothing
        assert_eq!(tdd_observe(&s, &red, None), None);
        tdd_observe(
            &s,
            &applied,
            Some(("src/lib.rs", "    #[test]\n    fn pages() {}")),
        );
        tdd_observe(&s, &applied, Some(("tests/api.rs", "fn x() {}")));
        assert_eq!(
            tdd_observe(&s, &red, None).as_deref(),
            Some("src/lib.rs\ntests/api.rs")
        );
        assert_eq!(tdd_observe(&s, &red, None), None, "recorded once");
        // implementation first: no red step for this issue
        *s.issue_key.lock().unwrap() = Some("DX-2".into());
        tdd_observe(&s, &applied, Some(("src/lib.rs", "pub fn pages() {}")));
        tdd_observe(&s, &applied, Some(("tests/api.rs", "#[test] fn p() {}")));
        assert_eq!(tdd_observe(&s, &red, None), None);
        drop((d, root));
    }

    #[test]
    fn a_write_that_rewrites_most_of_a_file_always_asks_with_the_percentage() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.rs"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n").unwrap();
        let call = |hunks: &[&str]| PendingCall {
            id: "w".into(),
            name: "write".into(),
            input: serde_json::json!({"path": "a.rs", "content": "x"}),
            read_only: false,
            command: None,
            hunks: hunks.iter().map(|h| h.to_string()).collect(),
        };
        let meta = |removed: u32| HunkMeta {
            removed,
            ..Default::default()
        };
        let metas: HashMap<String, HunkMeta> =
            [("w:1".to_string(), meta(7)), ("w:2".to_string(), meta(2))].into();
        // 70% in Auto (Allow) → asks, as the safety floor, with the percentage
        match rewrite_gate(Verdict::Allow, &call(&["w:1"]), d.path(), &metas) {
            Verdict::Ask {
                reason, dangerous, ..
            } => {
                assert!(
                    dangerous && reason.contains("70%") && reason.contains("a.rs"),
                    "{reason}"
                )
            }
            v => panic!("{v:?}"),
        }
        // 20%: Auto applies; an approval asked anyway shows the percentage
        assert_eq!(
            rewrite_gate(Verdict::Allow, &call(&["w:2"]), d.path(), &metas),
            Verdict::Allow
        );
        let ask = Verdict::Ask {
            reason: "modo Assistido".into(),
            dangerous: false,
            suggested_rule: None,
        };
        assert!(
            matches!(rewrite_gate(ask, &call(&["w:2"]), d.path(), &metas), Verdict::Ask { reason, .. } if reason.contains("20% de a.rs"))
        );
        // a new file is not a rewrite
        let mut new = call(&["w:1"]);
        new.input = serde_json::json!({"path": "novo.rs", "content": "x"});
        assert_eq!(
            rewrite_gate(Verdict::Allow, &new, d.path(), &metas),
            Verdict::Allow
        );
    }

    #[test]
    fn a_change_that_breaks_the_architects_rules_is_refused_unless_an_accepted_adr_excuses_it() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(
            d.path().join(".dxtutor/architecture.toml"),
            "[libraries]\nforbidden = [\"lodash\"]\n\n[[exceptions]]\nadr = \"ADR-0009\"\nrule = \"library:lodash\"\n",
        )
        .unwrap();
        let call = PendingCall {
            id: "e".into(),
            name: "edit_lines".into(),
            input: serde_json::json!({"path": "src/a.ts"}),
            read_only: false,
            command: None,
            hunks: vec!["e:1".into()],
        };
        let metas: HashMap<String, HunkMeta> = [(
            "e:1".to_string(),
            HunkMeta {
                text: "import _ from 'lodash';\n".into(),
                ..Default::default()
            },
        )]
        .into();
        match conformance_gate(Verdict::Allow, &call, d.path(), d.path(), &metas) {
            Verdict::Deny { reason } => assert!(
                reason.contains("lodash") && reason.contains("ADR"),
                "{reason}"
            ),
            v => panic!("{v:?}"),
        }
        std::fs::create_dir_all(d.path().join("docs/adr")).unwrap();
        std::fs::write(
            d.path().join("docs/adr/ADR-0009-lodash.md"),
            "Status: accepted\n",
        )
        .unwrap();
        assert_eq!(
            conformance_gate(Verdict::Allow, &call, d.path(), d.path(), &metas),
            Verdict::Allow
        );
        // the repository scan (the drift of the rules) sees the same rule
        std::fs::remove_file(d.path().join("docs/adr/ADR-0009-lodash.md")).unwrap();
        std::fs::write(
            d.path().join(".dxtutor/architecture.toml"),
            "[[layers]]\nname = \"web\"\npaths = [\"src/**\"]\n\n[libraries]\nforbidden = [\"lodash\"]\n",
        )
        .unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        std::fs::write(d.path().join("src/a.ts"), "import _ from 'lodash';\n").unwrap();
        let v = tutor_agent::conformance::scan(d.path()).unwrap().unwrap();
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].path, "src/a.ts");
    }

    #[test]
    fn the_budget_warns_at_80_percent_and_stops_before_the_limit() {
        let mut b = Budget {
            label: "DX-1".into(),
            limit: 1.0,
            spent: 0.5,
            warned: false,
        };
        assert_eq!(budget_check(&mut b, 0.1, 0.1), (None, false));
        let (n, stop) = budget_check(&mut b, 0.3, 0.05);
        assert!(!stop && n.unwrap().starts_with("80% do orçamento de DX-1"));
        assert_eq!(
            budget_check(&mut b, 0.32, 0.05),
            (None, false),
            "warned once"
        );
        // the next request (as costly as the last) would pass $1: stop before it
        let (n, stop) = budget_check(&mut b, 0.4, 0.15);
        assert!(stop && n.unwrap().contains("parou antes de o ultrapassar"));
    }

    #[test]
    fn an_issue_request_takes_the_tightest_budget_and_an_exhausted_one_does_not_start() {
        let (d, id, s, root) = issue_session("true");
        let db = d.path().join("board.sqlite3");
        let mut st = tutor_board::project::ProjectStore::open(&db).unwrap();
        let op = |v: serde_json::Value| serde_json::from_value(v).unwrap();
        let p = st
            .apply(
                &root,
                "t",
                1,
                op(serde_json::json!({"op": "create_sprint", "name": "S1", "start": 0, "end": 10})),
            )
            .unwrap();
        let sprint = p.sprints[0].id.clone();
        st.apply(
            &root,
            "t",
            1,
            op(serde_json::json!({"op": "plan_issue", "key": "DX-1", "sprint": sprint})),
        )
        .unwrap();
        st.apply(
            &root,
            "t",
            1,
            op(serde_json::json!({"op": "update_issue", "key": "DX-1", "budget_usd": 2.0})),
        )
        .unwrap();
        st.apply(
            &root,
            "t",
            1,
            op(serde_json::json!({"op": "set_sprint_budget", "id": sprint, "budget_usd": 1.0})),
        )
        .unwrap();
        let b = budget_for(&s, "DX-1").unwrap();
        assert_eq!(
            (b.label.as_str(), b.limit),
            ("S1", 1.0),
            "the sprint leaves less"
        );
        // spend it all: the next request does not start
        st.record_audit(
            &root,
            &tutor_board::project::AuditEntry {
                at: 1,
                session: "x".into(),
                event: "turn".into(),
                origin: "issue".into(),
                issue_key: Some("DX-1".into()),
                cost_usd: Some(1.2),
                ..Default::default()
            },
        )
        .unwrap();
        st.apply(&root, "ana", 2, op(serde_json::json!({"op": "update_issue", "key": "DX-1", "story_as": "a", "story_want": "b", "story_so": "c", "scope": ["src/**"]}))).unwrap();
        st.apply(
            &root,
            "ana",
            2,
            op(serde_json::json!({"op": "update_issue", "key": "DX-1", "ready": true})),
        )
        .unwrap();
        let o = Origin {
            kind: tutor_agent::permissions::OriginKind::Issue,
            issue: Some("DX-1".into()),
            by: String::new(),
            scope: vec![],
            template: None,
        };
        let e = send(
            &id,
            Some("continua".into()),
            Some(o),
            &mut |_| {},
            &mut |_| {},
        )
        .unwrap_err();
        assert!(e.contains("orçamento de S1 está esgotado"), "{e}");
        assert!(!s.busy.load(Ordering::SeqCst), "the session is free again");
    }

    #[test]
    fn the_audit_log_says_who_was_driving_a_paircode_session() {
        let d = tempfile::tempdir().unwrap();
        let spec = StartSpec {
            root: d.path().display().to_string(),
            sessions_base: Some(d.path().join(".sessions")),
            change_log: Some(d.path().join("board.sqlite3")),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        assert_eq!(audit_entry(&s, "call").driver, None, "no session");
        set_driver(&id, Some("guest".into()));
        assert_eq!(audit_entry(&s, "call").driver.as_deref(), Some("guest"));
        set_driver(&id, Some("someone".into()));
        assert_eq!(audit_entry(&s, "call").driver, None, "only host or guest");
    }

    #[test]
    fn rules_and_adrs_need_the_architect_and_never_pass_alone() {
        let d = tempfile::tempdir().unwrap();
        let call = |path: &str| PendingCall {
            id: "c".into(),
            name: "edit_lines".into(),
            input: serde_json::json!({ "path": path }),
            read_only: false,
            command: None,
            hunks: vec![],
        };
        // no people defined: an ADR change still asks (never accepted by Auto alone)
        assert!(matches!(
            role_gate(Verdict::Allow, &call("docs/adr/ADR-0001.md"), d.path(), d.path()),
            Verdict::Ask {
                dangerous: true,
                ..
            }
        ));
        assert_eq!(
            role_gate(Verdict::Allow, &call("src/lib.rs"), d.path(), d.path()),
            Verdict::Allow
        );
        // with people: a developer at the keyboard cannot approve the rules
        std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(d.path())
            .status()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "rui@x.pt"])
            .current_dir(d.path())
            .status()
            .unwrap();
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(
            d.path().join(".dxtutor/team.json"),
            r#"{"people": [{"email": "rui@x.pt", "roles": ["developer"]}, {"email": "ana@x.pt", "roles": ["architect"]}]}"#,
        )
        .unwrap();
        let ask = Verdict::Ask {
            reason: "protegido".into(),
            dangerous: true,
            suggested_rule: None,
        };
        match role_gate(ask.clone(), &call(".dxtutor/architecture.toml"), d.path(), d.path()) {
            Verdict::Deny { reason } => assert!(reason.contains("Arquitecto"), "{reason}"),
            v => panic!("{v:?}"),
        }
        std::process::Command::new("git")
            .args(["config", "user.email", "ana@x.pt"])
            .current_dir(d.path())
            .status()
            .unwrap();
        assert_eq!(
            role_gate(ask.clone(), &call(".dxtutor/architecture.toml"), d.path(), d.path()),
            ask
        );
    }

    #[test]
    fn a_change_that_breaks_the_rules_asks_in_red_and_only_the_architects_override_lets_it_in() {
        use tutor_agent::conformance::Violation;
        let v = vec![Violation {
            rule: "library:moment".into(),
            message: "biblioteca proibida: moment".into(),
            path: "src/a.ts".into(),
            line: Some(1),
        }];
        // in the review a violation asks — dangerous, so in Auto too — and a Deny stays a Deny
        match review_conformance(Verdict::Allow, &v) {
            Verdict::Ask {
                reason,
                dangerous: true,
                ..
            } => assert!(reason.contains("moment") && reason.contains("override")),
            x => panic!("{x:?}"),
        }
        let deny = Verdict::Deny {
            reason: "fora da raiz".into(),
        };
        assert_eq!(review_conformance(deny.clone(), &v), deny);
        assert_eq!(review_conformance(Verdict::Allow, &[]), Verdict::Allow);

        // a session with a call waiting in review that breaks the rules
        let (d, id, s, root) = issue_session("true");
        let git = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .args(args)
                .current_dir(d.path())
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&["init", "-q"]);
        git(&["config", "user.email", "rui@x.pt"]);
        git(&["config", "user.name", "Rui"]);
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(
            d.path().join(".dxtutor/team.json"),
            r#"{"people": [{"email": "rui@x.pt", "roles": ["developer"]}, {"email": "ana@x.pt", "roles": ["architect"]}]}"#,
        )
        .unwrap();
        let (tx, rx) = mpsc::channel();
        s.pending.lock().unwrap().insert("c1".into(), (tx, None));
        s.review
            .lock()
            .unwrap()
            .insert("c1".into(), vec!["c1:1".into()]);
        s.violating.lock().unwrap().insert("c1".into(), v.clone());
        let accept = [HunkVerdict {
            hunk: "c1:1".into(),
            accept: true,
            reason: None,
        }];
        // accepting without the override is refused (the review keeps waiting)
        assert!(review(&id, "c1", &accept).unwrap_err().contains("override"));
        // the override: only the architect, only with an accepted ADR
        assert!(override_violation(&id, "c1", "ADR-0007")
            .unwrap_err()
            .contains("Arquitecto"));
        git(&["config", "user.email", "ana@x.pt"]);
        assert!(override_violation(&id, "c1", "ADR-0007")
            .unwrap_err()
            .contains("não está aceite"));
        std::fs::create_dir_all(d.path().join("docs/adr")).unwrap();
        std::fs::write(
            d.path().join("docs/adr/ADR-0007-moment.md"),
            "# Use moment\n\nStatus: accepted\n",
        )
        .unwrap();
        assert!(override_violation(&id, "nope", "ADR-0007")
            .unwrap_err()
            .contains("nenhuma"));
        override_violation(&id, "c1", "ADR-0007").unwrap();
        // now the hunks can be accepted
        review(&id, "c1", &accept).unwrap();
        match rx.try_recv().unwrap() {
            Decision::Hunks {
                accepted, rejected, ..
            } => assert_eq!((accepted, rejected.len()), (vec!["c1:1".to_string()], 0)),
            x => panic!("{x:?}"),
        }
        // the override is in the audit log, with the ADR and the rule
        let st = tutor_board::project::ProjectStore::open(&d.path().join("board.sqlite3")).unwrap();
        let log = st.audit(&root, None).unwrap();
        let o = log
            .iter()
            .find(|e| e.event == "override")
            .expect("override in the audit log");
        // who: the git user.name (the test keeps «Rui»; only the email became the architect's)
        assert_eq!(o.decided_by.as_deref(), Some("human:Rui"));
        assert!(o
            .reason
            .as_deref()
            .unwrap()
            .starts_with("ADR-0007: biblioteca proibida: moment"));

        // rejecting a violating change tells the model which rule it broke
        let (tx, rx) = mpsc::channel();
        s.pending.lock().unwrap().insert("c2".into(), (tx, None));
        s.review
            .lock()
            .unwrap()
            .insert("c2".into(), vec!["c2:1".into()]);
        s.violating.lock().unwrap().insert("c2".into(), v);
        review(
            &id,
            "c2",
            &[HunkVerdict {
                hunk: "c2:1".into(),
                accept: false,
                reason: None,
            }],
        )
        .unwrap();
        match rx.try_recv().unwrap() {
            Decision::Hunks { rejected, .. } => assert!(rejected[0]
                .1
                .contains("viola as regras do arquitecto: biblioteca proibida: moment")),
            x => panic!("{x:?}"),
        }
    }

    fn git_in(d: &Path, args: &[&str]) {
        let ok = std::process::Command::new("git")
            .args(["-c", "user.name=t", "-c", "user.email=t@x"])
            .args(args)
            .current_dir(d)
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?}");
    }

    #[test]
    fn the_working_tree_before_and_after_a_command_says_which_files_it_changed() {
        let d = tempfile::tempdir().unwrap();
        assert!(
            dirty_state(d.path()).is_none(),
            "no git: nothing to compare"
        );
        git_in(d.path(), &["init", "-q"]);
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        for f in ["src/a.rs", "src/b.rs", "README.md", "old.txt"] {
            std::fs::write(d.path().join(f), "x\n").unwrap();
        }
        git_in(d.path(), &["add", "."]);
        git_in(d.path(), &["commit", "-qm", "init"]);
        std::fs::write(d.path().join("src/b.rs"), "dirty before\n").unwrap();
        let before = dirty_state(d.path()).unwrap();
        assert_eq!(before.keys().cloned().collect::<Vec<_>>(), ["src/b.rs"]);
        // what a command does: a new file, a tracked file changed, the dirty one changed again
        // (another size), a tracked file deleted
        std::thread::sleep(std::time::Duration::from_millis(15));
        std::fs::write(d.path().join("new.txt"), "n\n").unwrap();
        std::fs::write(d.path().join("README.md"), "changed\n").unwrap();
        std::fs::write(d.path().join("src/b.rs"), "dirty before, and again\n").unwrap();
        std::fs::remove_file(d.path().join("old.txt")).unwrap();
        let after = dirty_state(d.path()).unwrap();
        assert_eq!(
            changed_files(&before, &after),
            ["README.md", "new.txt", "old.txt", "src/b.rs"]
        );
        // nothing ran: nothing changed
        assert!(changed_files(&after, &dirty_state(d.path()).unwrap()).is_empty());
        // reverting a dirty file to the commit is a change too
        git_in(d.path(), &["checkout", "--", "src/b.rs"]);
        assert_eq!(
            changed_files(&after, &dirty_state(d.path()).unwrap()),
            ["src/b.rs"]
        );
        // a rename lists the new path
        git_in(d.path(), &["mv", "src/a.rs", "src/c.rs"]);
        assert!(dirty_state(d.path()).unwrap().contains_key("src/c.rs"));
    }

    #[test]
    fn a_bash_command_that_writes_outside_the_scope_is_told_to_the_human_the_model_and_the_audit_log(
    ) {
        let (d, _id, s, root) = issue_session("true");
        git_in(d.path(), &["init", "-q"]);
        let origin = |scope: Vec<String>| Origin {
            kind: tutor_agent::permissions::OriginKind::Issue,
            issue: Some("DX-1".into()),
            by: String::new(),
            scope,
            template: None,
        };
        // without a scope there is nothing to check
        *s.origin.lock().unwrap() = Some(origin(vec![]));
        bash_scope_start(&s, "b0");
        assert!(s.bash_snaps.lock().unwrap().is_empty());
        *s.origin.lock().unwrap() = Some(origin(vec!["src/**".into()]));
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        bash_scope_start(&s, "b1");
        std::fs::write(d.path().join("src/lib.rs"), "in scope\n").unwrap();
        std::fs::write(d.path().join("deploy.sh"), "outside\n").unwrap();
        let events = RefCell::new(vec![]);
        bash_scope_end(&s, "b1", &mut |e| events.borrow_mut().push(e));
        let notices: Vec<String> = events
            .borrow()
            .iter()
            .filter_map(|e| match e {
                AgentEvent::Notice { text } => Some(text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(notices.len(), 1);
        assert!(
            notices[0].contains("fora do âmbito do pedido (src/**): deploy.sh"),
            "{}",
            notices[0]
        );
        assert!(!notices[0].contains("src/lib.rs"));
        assert!(s
            .notes
            .lock()
            .unwrap()
            .iter()
            .any(|n| n.contains("deploy.sh") && n.contains("ask_human")));
        let st = tutor_board::project::ProjectStore::open(&d.path().join("board.sqlite3")).unwrap();
        let e = st
            .audit(&root, None)
            .unwrap()
            .into_iter()
            .find(|e| e.event == "scope")
            .expect("the scope warning in the audit log");
        assert_eq!(
            (e.tool.as_deref(), e.path.as_deref(), e.outcome.as_deref()),
            (Some("bash"), Some("deploy.sh"), Some("outside_scope"))
        );
        // only in scope: nothing to say
        bash_scope_start(&s, "b2");
        std::fs::write(d.path().join("src/lib.rs"), "in scope, again\n").unwrap();
        let quiet = RefCell::new(vec![]);
        bash_scope_end(&s, "b2", &mut |e| quiet.borrow_mut().push(e));
        assert!(quiet.borrow().is_empty());
    }

    #[test]
    fn after_stop_the_files_the_turn_changed_are_offered_to_keep_or_discard() {
        let d = tempfile::tempdir().unwrap();
        let git = |args: &[&str]| {
            let ok = std::process::Command::new("git")
                .args(["-c", "user.name=t", "-c", "user.email=t@x"])
                .args(args)
                .current_dir(d.path())
                .status()
                .unwrap()
                .success();
            assert!(ok, "git {args:?}");
        };
        git(&["init", "-q"]);
        std::fs::write(d.path().join("lib.rs"), "fn a() {}\n").unwrap();
        git(&["add", "."]);
        git(&["commit", "-qm", "init"]);
        let spec = StartSpec {
            root: d.path().display().to_string(),
            sessions_base: Some(d.path().join(".sessions")),
            provider: Some("ollama".into()),
            ollama_host: Some("http://127.0.0.1:9".into()),
            ..Default::default()
        };
        let id = start(spec, &key("sk-test"), None).unwrap();
        let s = get(&id).unwrap();
        let cps = s
            .agent
            .checkpoints
            .as_ref()
            .expect("a git folder has checkpoints");
        let cp = cps.snapshot("turno").unwrap().id;
        let events = RefCell::new(vec![]);
        let collect = |e: AgentEvent| events.borrow_mut().push(e);
        // no checkpoint, or nothing changed since it: nothing to offer
        stop_review(&s, None, &collect);
        stop_review(&s, Some(cp), &collect);
        assert!(events.borrow().is_empty());
        // the stopped turn wrote two files
        std::fs::write(d.path().join("lib.rs"), "fn a() { b() }\n").unwrap();
        std::fs::write(d.path().join("b.rs"), "fn b() {}\n").unwrap();
        stop_review(&s, Some(cp), &collect);
        let evs = events.borrow();
        assert!(
            matches!(&evs[0], AgentEvent::Notice { text } if text.contains(&format!("checkpoint {cp}")))
        );
        match &evs[1] {
            AgentEvent::StopReview { checkpoint, files } => {
                assert_eq!(*checkpoint, cp);
                assert!(
                    files.contains(&"lib.rs".to_string()) && files.contains(&"b.rs".to_string()),
                    "{files:?}"
                );
            }
            e => panic!("{e:?}"),
        }
        // the event as the UI reads it
        let j = serde_json::to_value(&evs[1]).unwrap();
        assert_eq!(j["kind"], "stop_review");
    }
}
