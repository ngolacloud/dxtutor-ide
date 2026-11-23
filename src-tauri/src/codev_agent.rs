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
use tutor_agent::permissions::{Mode, Policy, Rules, Verdict};
use tutor_agent::session::{self, HistoryItem, SessionLog, SessionMeta, SessionSummary};
use tutor_agent::tools::flow::SubagentSpec;
use tutor_agent::tools::{agent_tools, FlowState, ToolsetOptions, TOOLSET_VERSION};
use tutor_agent::{
    Agent, AgentConfig, AgentError, AgentEvent, Decision, Effort, Message, PendingCall,
    SystemBlock, ToolCtx, Transcript, TurnOutcome,
};

/// Com que configuração abrir uma sessão (args do `codev_agent_start`).
#[derive(Debug, Clone, Default)]
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
    pending: Mutex<HashMap<String, (mpsc::Sender<Decision>, Option<String>)>>,
    /// O registo em disco (`None` se não foi possível criá-lo — a sessão funciona na mesma).
    log: Mutex<Option<SessionLog>>,
    /// O último modo anunciado ao modelo (mensagem `system` a meio da conversa).
    announced: Mutex<Option<Mode>>,
    /// Modo plano e lista de tarefas (partilhados com as ferramentas e a política).
    flow: FlowState,
    /// Avisos para o modelo na próxima mensagem (rewind, modo plano) — a conversa nunca é
    /// editada, por isso o que muda entre turnos vai como mensagem `system`.
    notes: Mutex<Vec<String>>,
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

/// Abre uma sessão. `api_key` vem de `keys::resolve` (feito pelo adaptador, que conhece
/// a pasta de configuração da app).
pub fn start(
    spec: StartSpec,
    api_key: Option<String>,
    workspace_id: Option<String>,
) -> Result<String, String> {
    let key = api_key.filter(|k| !k.trim().is_empty()).ok_or_else(|| {
        "sem chave da Anthropic: guarda-a em Definições → Modelos e provedores, ou define ANTHROPIC_API_KEY".to_string()
    })?;
    let root = PathBuf::from(spec.root.trim());
    if !root.is_dir() {
        return Err(format!(
            "a pasta do projecto não existe: {}",
            root.display()
        ));
    }
    let mut cfg = Config::new(key.trim());
    cfg.workspace_id = workspace_id;
    let provider = Arc::new(Anthropic::new(cfg));

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
            if PathBuf::from(&meta.root) != root {
                return Err(format!(
                    "a sessão {rid} pertence a outro projecto ({})",
                    meta.root
                ));
            }
            (meta, t, Some(log))
        }
        None => {
            let meta = SessionMeta {
                id: new_id(),
                root: root_s.clone(),
                model: spec
                    .model
                    .filter(|m| !m.trim().is_empty())
                    .unwrap_or_else(|| anthropic::DEFAULT_MODEL.to_string()),
                effort: parse_effort(spec.effort.as_deref()).as_str().to_string(),
                system: tutor_agent::context::system_prompt(&root)
                    .into_iter()
                    .map(|b| (b.text, b.cache))
                    .collect(),
                test_cmd: spec.test_cmd.filter(|c| !c.trim().is_empty()),
                lint_cmd: spec.lint_cmd.filter(|c| !c.trim().is_empty()),
                compaction: true,
                created: session::now(),
                toolset: TOOLSET_VERSION,
            };
            // sem registo em disco a sessão funciona na mesma (só não se retoma)
            let log = dir.as_ref().and_then(|d| SessionLog::create(d, &meta).ok());
            (meta, Transcript::new(), log)
        }
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
    );
    let mut agent = Agent::new(provider, tools, acfg, ctx);
    agent.checkpoints = checkpoints;

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
    };
    sessions().lock().unwrap().insert(id.clone(), Arc::new(s));
    Ok(id)
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
    r.map_err(|e: AgentError| e.to_string())
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

    #[test]
    fn start_requires_a_key_and_an_existing_folder() {
        let dir = std::env::temp_dir();
        let spec = StartSpec {
            root: dir.display().to_string(),
            sessions_base: Some(tempfile::tempdir().unwrap().keep()),
            ..Default::default()
        };
        assert!(start(spec.clone(), None, None)
            .unwrap_err()
            .contains("sem chave"));
        assert!(start(spec.clone(), Some("  ".into()), None).is_err());
        let bad = StartSpec {
            root: "/nao/existe/mesmo".into(),
            ..Default::default()
        };
        assert!(start(bad, Some("sk".into()), None)
            .unwrap_err()
            .contains("não existe"));

        let id = start(spec, Some("sk-test".into()), None).unwrap();
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
        let id = start(spec, Some("sk-test".into()), None).unwrap();
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
        let id = start(spec(None, "claude-opus-5-5"), Some("sk".into()), None).unwrap();
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
        let rid = start(
            spec(Some(id.clone()), "claude-haiku-5-5"),
            Some("sk".into()),
            None,
        )
        .unwrap();
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
        assert!(start(bad, Some("sk".into()), None).is_err());
        assert!(start(spec(Some("../fora".into()), "x"), Some("sk".into()), None).is_err());
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
        let id = start(spec, Some("sk".into()), None).unwrap();
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
