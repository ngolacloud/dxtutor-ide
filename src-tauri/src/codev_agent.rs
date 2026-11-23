//! Caso de uso «agente Co-Dev v2» — **independente de Tauri** (ADR-0003, F1).
//!
//! Gere as sessões do loop de agente do crate `tutor-agent`: cada sessão tem o seu
//! histórico (append-only), a sua flag de cancelamento e as aprovações pendentes. O
//! adaptador IPC (`commands::codev_agent`) só põe isto numa thread e traduz os eventos
//! para o Tauri; a regra de aprovação vive aqui.
//!
//! Estado da F1: sem ferramentas registadas (chegam em F2) e aprovação mínima — leituras
//! passam, tudo o resto pergunta à UI. A política por modo (Manual/Assistido/Auto) e o
//! classificador de comandos entram em F3.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tutor_agent::anthropic::{self, Anthropic, Config};
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
}

struct Session {
    agent: Agent,
    transcript: Mutex<Transcript>,
    busy: AtomicBool,
    /// tool_use_id → canal onde a UI responde à aprovação
    pending: Mutex<HashMap<String, mpsc::Sender<Decision>>>,
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

/// System prompt mínimo da F1 (o completo, com AGENTS.md/CLAUDE.md e cache, é F5).
fn system_prompt(root: &Path) -> Vec<SystemBlock> {
    vec![SystemBlock {
        text: format!(
            "És o Co-Dev do dxtutor IDE: um co-programador sénior que trabalha orientado por um \
             programador humano, no projecto em {}. Responde em português (ortografia pré-AO90), \
             de forma curta e concreta. Antes de declarar uma tarefa feita, verifica-a.",
            root.display()
        ),
        cache: true,
    }]
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

    let mut acfg = AgentConfig::new(
        spec.model
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| anthropic::DEFAULT_MODEL.to_string()),
    );
    acfg.effort = parse_effort(spec.effort.as_deref());
    acfg.system = system_prompt(&root);
    let ctx = ToolCtx {
        root,
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let agent = Agent::new(provider, vec![], acfg, ctx);

    let id = new_id();
    let s = Session {
        agent,
        transcript: Mutex::new(Transcript::new()),
        busy: AtomicBool::new(false),
        pending: Mutex::new(HashMap::new()),
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
    on_approval: &mut dyn FnMut(&PendingCall),
) -> Result<TurnOutcome, String> {
    let s = get(id)?;
    if s.busy.swap(true, Ordering::SeqCst) {
        return Err("a sessão já está a correr um turno".into());
    }
    s.agent.ctx.cancel.store(false, Ordering::Relaxed);
    let session = s.clone();
    let mut approve = |call: &PendingCall| -> Decision {
        // F1: leituras passam; o resto pergunta (F3 traz a política por modo)
        if call.read_only {
            return Decision::Allow;
        }
        let (tx, rx) = mpsc::channel();
        session.pending.lock().unwrap().insert(call.id.clone(), tx);
        on_approval(call);
        let d = wait_decision(&rx, &session.agent.ctx.cancel);
        session.pending.lock().unwrap().remove(&call.id);
        d
    };
    let mut t = s.transcript.lock().unwrap();
    let r = s
        .agent
        .run_turn(&mut t, text.map(Message::user_text), on_event, &mut approve);
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

/// A UI responde a um pedido de aprovação. `false` se não havia nada pendente.
pub fn approve(id: &str, tool_use_id: &str, allow: bool, reason: Option<String>) -> bool {
    let Ok(s) = get(id) else { return false };
    let tx = s.pending.lock().unwrap().remove(tool_use_id);
    match tx {
        Some(tx) => {
            let d = if allow {
                Decision::Allow
            } else {
                Decision::Deny(reason.unwrap_or_else(|| "recusado".into()))
            };
            tx.send(d).is_ok()
        }
        None => false,
    }
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
        assert!(!approve(&id, "nada", true, None), "sem aprovação pendente");
        assert!(close(&id));
        assert!(!close(&id));
        assert!(!cancel(&id));
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
        let r = send("cda-nada", Some("olá".into()), &mut |_| {}, &mut |_| {});
        assert!(r.unwrap_err().contains("desconhecida"));
    }
}
