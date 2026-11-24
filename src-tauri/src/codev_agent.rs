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

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tutor_agent::anthropic::{self, Anthropic, Config};
use tutor_agent::checkpoint::{Checkpoint, Checkpoints};
use tutor_agent::extensions::{self, Command as ProjectCommand, Skill};
use tutor_agent::hooks::{Hooks, HOOKS_FILE};
use tutor_agent::mcp::{self, McpTool};
use tutor_agent::openai::{self, OpenAiCompat};
use tutor_agent::permissions::{Mode, Policy, Rules, Verdict};
use tutor_agent::session::{self, HistoryItem, SessionLog, SessionMeta, SessionSummary};
use tutor_agent::tools::flow::SubagentSpec;
use tutor_agent::tools::{agent_tools, FlowState, ToolsetOptions, TOOLSET_VERSION};
use tutor_agent::{trust, Tool};
use tutor_agent::{
    Agent, AgentConfig, AgentError, AgentEvent, Decision, Effort, Message, PendingCall, Provider,
    SystemBlock, ToolCtx, Transcript, TurnOutcome,
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
    /// uma sessão gravada antes retoma sem elas (o prefixo do pedido não pode mudar).
    pub host_tools_v4: Vec<Arc<dyn Tool>>,
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
            let meta = SessionMeta {
                id: new_id(),
                root: root_s.clone(),
                model: resolve_model(&provider, spec.model.as_deref()),
                effort: parse_effort(spec.effort.as_deref()).as_str().to_string(),
                system: tutor_agent::context::system_prompt(&root)
                    .into_iter()
                    .map(|b| (b.text, b.cache))
                    .collect(),
                test_cmd: spec.test_cmd.clone().filter(|c| !c.trim().is_empty()),
                lint_cmd: spec.lint_cmd.clone().filter(|c| !c.trim().is_empty()),
                compaction: provider_features(&provider).compaction,
                created: session::now(),
                toolset: TOOLSET_VERSION,
                mcp_tools: vec![], // preenchido abaixo, depois de ligar os servidores
                provider,
            };
            (meta, Transcript::new(), None)
        }
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
        let (tools, mut n) = mcp::connect_all(&mcp_servers(&root, &spec, &mut notes), &root);
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
        root.clone(),
    );
    policy.plan = flow.plan_mode.clone();
    let checkpoints = Checkpoints::new(&root, &meta.id).map(Arc::new);
    let ctx = ToolCtx {
        root,
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let subagent = SubagentSpec {
        provider: provider.clone(),
        model: meta.model.clone(),
        effort: acfg.effort,
    };
    let tools = agent_tools(
        &ToolsetOptions {
            test_cmd: meta.test_cmd.clone(),
            lint_cmd: meta.lint_cmd.clone(),
            ..Default::default()
        },
        meta.toolset,
        &flow,
        Some(subagent),
        session_host_tools(&spec, meta.toolset)
            .into_iter()
            .chain(mcp_tools)
            .collect(),
    );
    let mut agent = Agent::new(provider, tools, acfg, ctx);
    agent.checkpoints = checkpoints;
    // hooks do projecto: só se o humano confiou neste ficheiro, tal como está
    let root_ref = agent.ctx.root.clone();
    if root_ref.join(HOOKS_FILE).exists() {
        let store = spec.trust_store.clone();
        if store
            .as_deref()
            .is_some_and(|st| trust::is_trusted(st, &root_ref, HOOKS_FILE))
        {
            match Hooks::load(&root_ref) {
                Ok(h) => agent.hooks = h.map(Arc::new),
                Err(e) => notes.push(e),
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
    };
    sessions().lock().unwrap().insert(id.clone(), Arc::new(s));
    Ok(id)
}

/// As ferramentas do anfitrião de uma sessão com o conjunto `toolset`: as da versão 3
/// sempre, as da versão 4 só a partir dela (uma sessão antiga retoma sem elas — o prefixo
/// do pedido não pode mudar). Ordem fixa.
fn session_host_tools(spec: &StartSpec, toolset: u32) -> Vec<Arc<dyn Tool>> {
    let v4 = spec.host_tools_v4.iter().filter(|_| toolset >= 4);
    spec.host_tools.iter().chain(v4).cloned().collect()
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
    on_event: &mut dyn FnMut(AgentEvent),
    on_approval: &mut dyn FnMut(&ApprovalRequest),
) -> Result<TurnOutcome, String> {
    let s = get(id)?;
    if s.busy.swap(true, Ordering::SeqCst) {
        return Err("a sessão já está a correr um turno".into());
    }
    s.agent.ctx.cancel.store(false, Ordering::Relaxed);
    let session = s.clone();
    let mut approve = |call: &PendingCall| -> Decision {
        let verdict = session.policy.lock().unwrap().decide(call);
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
        let d = wait_decision(&rx, &session.agent.ctx.cancel);
        session.pending.lock().unwrap().remove(&call.id);
        d
    };
    let mut t = s.transcript.lock().unwrap();
    let r = match text {
        Some(q) => {
            // slash commands do projecto (.dxtutor/commands): o modelo recebe o prompt expandido
            let q = match extensions::expand(&s.agent.ctx.root, &q) {
                Some((_, prompt)) => prompt,
                None => q,
            };
            if t.is_empty() {
                for text in &s.startup_notices {
                    on_event(AgentEvent::Notice { text: text.clone() });
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
            s.agent.run_turn(&mut t, None, on_event, &mut approve)
        }
        // «tentar de novo»: continua do histórico, sem nota nova
        None => s.agent.run_turn(&mut t, None, on_event, &mut approve),
    };
    if let Some(log) = s.log.lock().unwrap().as_mut() {
        let _ = log.sync(&t); // append-only: só as mensagens novas
    }
    drop(t);
    s.busy.store(false, Ordering::SeqCst);
    r.map_err(|e: AgentError| match &e {
        AgentError::Provider(p) if openai::is_tools_unsupported(p) => format!("{NO_TOOLS_MARK}{e}"),
        _ => e.to_string(),
    })
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

/// Muda o modo da sessão (a modebar). Vale a partir da próxima decisão.
pub fn set_mode(id: &str, mode: &str) -> bool {
    match get(id) {
        Ok(s) => {
            s.policy.lock().unwrap().mode = Mode::parse(mode);
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
pub fn checkpoints(id: &str) -> Result<Vec<Checkpoint>, String> {
    let s = get(id)?;
    Ok(s.agent
        .checkpoints
        .as_ref()
        .map(|c| c.list())
        .unwrap_or_default())
}

/// Repõe os ficheiros como estavam no checkpoint `cp` (antes do turno que o criou). A
/// conversa não é editada: o modelo é avisado na próxima mensagem.
pub fn rewind(id: &str, cp: u32) -> Result<String, String> {
    let s = get(id)?;
    if s.busy.load(Ordering::SeqCst) {
        return Err("espera que o turno em curso termine (ou pára-o) antes de voltar atrás".into());
    }
    let cps = s
        .agent
        .checkpoints
        .as_ref()
        .ok_or("checkpoints só existem em repositórios git")?;
    let msg = cps.restore(cp)?;
    s.notes.lock().unwrap().push(format!(
        "O humano reverteu os ficheiros do projecto: {msg}. O que fizeste depois desse ponto \
         já não está no disco — volta a ler os ficheiros antes de continuar."
    ));
    Ok(msg)
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

/// Fecha a sessão (cancela o que estiver a correr e esquece o histórico em memória).
pub fn close(id: &str) -> bool {
    cancel(id);
    sessions().lock().unwrap().remove(id).is_some()
}

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
        let bash = |cmd: &str| PendingCall {
            id: "x".into(),
            name: "bash".into(),
            input: serde_json::json!({ "command": cmd }),
            read_only: false,
            command: Some(cmd.into()),
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
        let names = |v: u32| -> Vec<String> {
            session_host_tools(&spec, v)
                .iter()
                .map(|t| t.name().to_string())
                .collect()
        };
        assert_eq!(names(3), ["lsp_diagnostics"]);
        assert_eq!(names(4), ["lsp_diagnostics", "arch_propose"]);

        // uma sessão nova grava o conjunto 4
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
            head.lines().next().unwrap().contains("\"toolset\":4"),
            "{head}"
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
        let edit = PendingCall {
            id: "e".into(),
            name: "edit".into(),
            input: serde_json::json!({"path": "a.rs"}),
            read_only: false,
            command: None,
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
        assert!(rewind(&id, 1).unwrap_err().contains("git"));
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
    fn send_on_unknown_session_fails() {
        let r = send(
            "cda-nada",
            Some("olá".into()),
            &mut |_| {},
            &mut |_: &ApprovalRequest| {},
        );
        assert!(r.unwrap_err().contains("desconhecida"));
    }
}
