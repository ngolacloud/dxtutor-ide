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
/// Devolve o id da sessão.
#[tauri::command]
pub fn codev_agent_start(
    app: tauri::AppHandle,
    root: String,
    model: Option<String>,
    effort: Option<String>,
    test_cmd: Option<String>,
    lint_cmd: Option<String>,
    mode: Option<String>,
    resume: Option<String>,
) -> Result<String, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let key = keys::resolve(&dir, "claude");
    codev_agent::start(
        StartSpec {
            root,
            model,
            effort,
            test_cmd,
            lint_cmd,
            mode,
            resume,
            sessions_base: None,
        },
        key,
        keys::anthropic_workspace_id(),
    )
}

/// Envia uma mensagem (ou, com `text: null`, repete a partir do histórico). Devolve logo;
/// o turno corre numa thread e responde por eventos.
#[tauri::command]
pub fn codev_agent_send(app: tauri::AppHandle, session_id: String, text: Option<String>) {
    std::thread::spawn(move || {
        let (a1, a2, sid) = (app.clone(), app.clone(), session_id.clone());
        let r = codev_agent::send(
            &session_id,
            text,
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
) -> bool {
    codev_agent::approve(
        &session_id,
        &tool_use_id,
        allow,
        reason,
        remember.unwrap_or(false),
    )
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

/// Fecha a sessão.
#[tauri::command]
pub fn codev_agent_close(session_id: String) -> bool {
    codev_agent::close(&session_id)
}

/// As sessões gravadas do projecto `root` (mais recentes primeiro).
#[tauri::command]
pub fn codev_agent_sessions(root: String) -> Vec<tutor_agent::session::SessionSummary> {
    codev_agent::list_sessions(&root, None)
}

/// O histórico simplificado de uma sessão aberta (para redesenhar a conversa retomada).
#[tauri::command]
pub fn codev_agent_history(
    session_id: String,
) -> Result<Vec<tutor_agent::session::HistoryItem>, String> {
    codev_agent::history(&session_id)
}
