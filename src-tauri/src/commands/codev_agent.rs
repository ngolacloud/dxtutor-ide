//! Comandos IPC do agente Co-Dev v2 (ADR-0003) — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::codev_agent`.
//!
//! Nenhuma regra vive aqui: resolve-se a chave (`keys::resolve`, que conhece a pasta de
//! configuração da app), corre-se o turno numa thread (o HTTP e as ferramentas nunca
//! travam a janela) e traduzem-se os eventos do loop para o Tauri:
//! - `codev-agent://event` `{session, event}` — eventos do loop (`AgentEvent`, serde);
//! - `codev-agent://approval` `{session, request}` — uma chamada à espera de decisão
//!   (`request`: `call`, `reason`, `dangerous`, `suggestedRule`);
//! - `codev-agent://error` `{session, error}` — o turno falhou (o histórico fica pronto
//!   para `codev_agent_send` com `text: null`, «tentar de novo»).

use tauri::{Emitter, Manager};

use crate::codev_agent::{self, StartSpec};
use crate::keys;

/// Abre uma sessão do agente no projecto `root`, com os comandos de verificação que a UI
/// detectou (`test_cmd`/`lint_cmd`, opcionais), ou retoma uma gravada (`resume`: o id).
/// Liga os servidores MCP (pode demorar): corre fora da thread da janela. Devolve o id.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn codev_agent_start(
    app: tauri::AppHandle,
    root: String,
    model: Option<String>,
    effort: Option<String>,
    test_cmd: Option<String>,
    lint_cmd: Option<String>,
    mode: Option<String>,
    resume: Option<String>,
    provider: Option<String>,
    review_edits: Option<bool>,
    issue: Option<String>,
    language: Option<String>,
    architecture: Option<bool>,
    backlog: Option<bool>,
    worktree: Option<bool>,
) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    // Multi Co-Dev (fase 3): a sessão da issue trabalha na worktree dela — a que a app criou (com
    // aprovação), nunca um caminho vindo da interface
    let worktree = match (worktree.unwrap_or(false), issue.as_deref()) {
        (false, _) => None,
        (true, None) => {
            return Err("uma worktree só serve uma sessão que trabalha numa issue".into())
        }
        (true, Some(key)) => {
            let base = super::codev_worktree::base(&app)?;
            let (r, k) = (root.clone(), key.to_string());
            let found = tauri::async_runtime::spawn_blocking(move || {
                tutor_eval::gitwork::codev::find(std::path::Path::new(r.trim()), &base, &k)
            })
            .await
            .map_err(|e| format!("worktree task failed: {e}"))??;
            match found {
                Some(w) => Some(std::path::PathBuf::from(w.dir)),
                None => {
                    return Err(format!(
                        "a worktree de {key} não existe: começa a issue de novo para a criar"
                    ))
                }
            }
        }
    };
    // `arch_propose` (Studio, F6): a proposta chega à UI pelo evento `arch://proposal`
    let emitter = app.clone();
    let arch_propose = crate::agent::ArchProposeTool {
        emit: std::sync::Arc::new(move |p| {
            let _ = emitter.emit("arch://proposal", p);
        }),
    };
    // `/backlog` and `/project` (toolset 11): the chat shows the proposal of the session that made it
    // (`backlog://proposal`); the session id is known once the session starts
    let session_id: std::sync::Arc<std::sync::OnceLock<String>> = Default::default();
    let (em, sid) = (app.clone(), session_id.clone());
    let emit: crate::backlog::Emit = std::sync::Arc::new(move |p| {
        let _ = em.emit(
            "backlog://proposal",
            serde_json::json!({ "session": sid.get(), "proposal": p }),
        );
    });
    let project_root = std::path::PathBuf::from(root.trim());
    let spec = StartSpec {
        root,
        model,
        effort,
        test_cmd,
        lint_cmd,
        mode,
        resume,
        host_tools: vec![std::sync::Arc::new(crate::lsp::LspDiagnosticsTool)],
        host_tools_v4: vec![std::sync::Arc::new(arch_propose)],
        host_tools_v8: vec![std::sync::Arc::new(crate::codeintel::OutlineTool)],
        host_tools_v11: vec![
            std::sync::Arc::new(crate::backlog::BacklogProposeTool { emit: emit.clone() }),
            std::sync::Arc::new(crate::backlog::ProjectProposeTool { emit }),
        ],
        // H3: `ide` — what the IDE knows, read by action (the Project's folder is `root`)
        host_tools_v13: vec![std::sync::Arc::new(crate::ide_tool::IdeTool {
            root: project_root,
            db: crate::board::db_path(&app).ok(),
        })],
        trust_store: tutor_agent::trust::default_store(),
        user_mcp: tutor_agent::mcp::user_config(),
        provider,
        ollama_host: Some(tutor_llm::chat::ollama_host()),
        review_edits: review_edits.unwrap_or(false),
        issue_key: issue,
        change_log: crate::board::db_path(&app).ok(),
        lang: language,
        architecture: architecture.unwrap_or(false),
        backlog: backlog.unwrap_or(false),
        worktree,
        ..Default::default()
    };
    let id = tauri::async_runtime::spawn_blocking(move || {
        let key_for = |p: &str| keys::resolve(&dir, p);
        codev_agent::start(spec, &key_for, keys::anthropic_workspace_id())
    })
    .await
    .map_err(|e| format!("agent start task failed: {e}"))??;
    let _ = session_id.set(id.clone());
    Ok(id)
}

/// Envia uma mensagem (ou, com `text: null`, repete a partir do histórico). Devolve logo;
/// o turno corre numa thread e responde por eventos. `origin`: o pedido humano a que o turno
/// responde (`{kind: "chat"|"editor"|"issue", issue?, scope?}`, RF-G01); sem ele, as acções
/// do turno são bloqueadas («bloqueada: sem pedido»). Quem pediu vem do git do projecto.
#[tauri::command]
pub fn codev_agent_send(
    app: tauri::AppHandle,
    session_id: String,
    text: Option<String>,
    origin: Option<tutor_agent::permissions::Origin>,
) {
    std::thread::spawn(move || {
        let (a1, a2, sid) = (app.clone(), app.clone(), session_id.clone());
        let r = codev_agent::send(
            &session_id,
            text,
            origin,
            &mut |event| {
                let _ = a1.emit(
                    "codev-agent://event",
                    serde_json::json!({ "session": sid, "event": event }),
                );
            },
            &mut |req| {
                let _ = a2.emit(
                    "codev-agent://approval",
                    serde_json::json!({ "session": sid, "request": req }),
                );
            },
        );
        if let Err(e) = r {
            let _ = app.emit(
                "codev-agent://error",
                serde_json::json!({ "session": session_id, "error": e }),
            );
        }
    });
}

/// Responde a um pedido de aprovação. `false` se não havia nada pendente com esse id.
#[tauri::command]
pub fn codev_agent_approve(
    session_id: String,
    tool_use_id: String,
    allow: bool,
    reason: Option<String>,
    remember: Option<bool>,
    driver: Option<String>,
) -> bool {
    // RF-P04: who drives a PairCode session when the human decides (the audit log records it)
    codev_agent::set_driver(&session_id, driver);
    codev_agent::approve(
        &session_id,
        &tool_use_id,
        allow,
        reason,
        remember.unwrap_or(false),
    )
}

/// Decide os hunks de um `hunk_review` (docs/v2/RF-CODEV-STREAM.md §4): só os aceites são
/// escritos; um hunk sem decisão conta como recusado. Erro se a sessão, a chamada ou um
/// hunk não existirem (a revisão continua à espera).
#[tauri::command]
pub fn codev_agent_review(
    session_id: String,
    call: String,
    decisions: Vec<codev_agent::HunkVerdict>,
    driver: Option<String>,
) -> Result<(), String> {
    codev_agent::set_driver(&session_id, driver);
    codev_agent::review(&session_id, &call, &decisions)
}

/// RF-A03/A04: o override do Arquitecto a uma alteração que viola as regras, com o número de um
/// ADR aceite (fica no registo de auditoria). Depois disso, os hunks da chamada podem ser aceites.
#[tauri::command]
pub fn codev_agent_override(session_id: String, call: String, adr: String) -> Result<(), String> {
    codev_agent::override_violation(&session_id, &call, &adr)
}

/// Muda o modo da sessão (Manual/Assistido/Auto) — a modebar.
#[tauri::command]
pub fn codev_agent_set_mode(session_id: String, mode: String) -> bool {
    codev_agent::set_mode(&session_id, &mode)
}

/// Cancela o turno em curso (botão Parar).
#[tauri::command]
pub fn codev_agent_cancel(session_id: String) -> bool {
    codev_agent::cancel(&session_id)
}

/// Fecha a sessão. Multi Co-Dev (fase 3): as reservas de ficheiros dela voltam e a worktree sai
/// se não tiver alterações por commitar (com `keep_worktree`, fica: a mesma issue recomeça nela) —
/// fora da thread da interface (espera que o turno pare).
#[tauri::command]
pub async fn codev_agent_close(session_id: String, keep_worktree: Option<bool>) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        codev_agent::close_keeping(&session_id, keep_worktree.unwrap_or(false))
    })
    .await
    .unwrap_or(false)
}

/// As sessões gravadas do projecto `root` (mais recentes primeiro).
#[tauri::command]
pub async fn codev_agent_sessions(root: String) -> Vec<tutor_agent::session::SessionSummary> {
    codev_agent::list_sessions(&root, None)
}

/// As sessões abertas nesta execução da app (o mapa de agentes do Co-Dev): id, pasta, modelo,
/// issue e se há um turno a correr. Só leitura.
#[tauri::command]
pub fn codev_agent_live() -> Vec<codev_agent::LiveSession> {
    codev_agent::live_sessions()
}

/// O histórico simplificado de uma sessão aberta (para redesenhar a conversa retomada).
#[tauri::command]
pub async fn codev_agent_history(
    session_id: String,
) -> Result<Vec<tutor_agent::session::HistoryItem>, String> {
    codev_agent::history(&session_id)
}

/// Liga/desliga o modo plano da sessão (só leitura até o plano ser aprovado).
#[tauri::command]
pub fn codev_agent_set_plan(session_id: String, on: bool) -> Result<(), String> {
    codev_agent::set_plan(&session_id, on)
}

/// Os checkpoints de ficheiros da sessão (um por turno que alterou ficheiros); cada um diz se
/// a conversa também pode voltar a esse ponto (`conversation`).
#[tauri::command]
pub async fn codev_agent_checkpoints(
    session_id: String,
) -> Result<Vec<codev_agent::CheckpointView>, String> {
    codev_agent::checkpoints(&session_id)
}

/// Repõe os ficheiros como estavam no checkpoint (antes do turno que o criou); com
/// `conversation: true` («Rewind to here»), a conversa volta também a esse ponto.
#[tauri::command]
pub async fn codev_agent_rewind(
    session_id: String,
    checkpoint: u32,
    conversation: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codev_agent::rewind(&session_id, checkpoint, conversation.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("rewind task failed: {e}"))?
}

/// As regras de permissões do projecto e do utilizador (painel de permissões, A3 HARNESS-05).
#[tauri::command]
pub async fn codev_agent_permissions(root: String) -> codev_agent::PermissionsView {
    codev_agent::permissions(&root)
}

/// Grava as regras do projecto (`.dxtutor/permissions.json`) e aplica-as às sessões abertas.
#[tauri::command]
pub async fn codev_agent_save_permissions(
    root: String,
    rules: tutor_agent::permissions::Rules,
) -> Result<(), String> {
    codev_agent::save_permissions(&root, rules)
}

/// O que o projecto define para o agente: comandos, skills, hooks e servidores MCP (com o
/// estado de confiança dos que fazem correr comandos).
#[tauri::command]
pub async fn codev_agent_extensions(root: String) -> codev_agent::ExtensionsStatus {
    codev_agent::extensions_status(
        &root,
        tutor_agent::trust::default_store().as_deref(),
        tutor_agent::mcp::user_config().as_deref(),
    )
}

/// Confia nos hooks (`kind: "hooks"`) ou nos servidores MCP (`"mcp"`) do projecto, tal como
/// estão agora (deixa de valer se o ficheiro mudar). Vale para as sessões novas.
#[tauri::command]
pub async fn codev_agent_trust(root: String, kind: String) -> Result<(), String> {
    codev_agent::trust_project_file(&root, &kind, tutor_agent::trust::default_store().as_deref())
}
