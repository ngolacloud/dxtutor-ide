//! Comandos IPC de Dev Containers (secção 4 / Remote) — adaptadores finos sobre o caso de
//! uso Tauri-free `crate::devcontainer`.
//!
//! Nenhuma regra vive aqui. A descoberta do `devcontainer.json`, o parsing JSONC, a
//! resolução de imagem, o `postCreateCommand`, a guarda de sessão e o erro tipado
//! ([`devcontainer::DevcontainerError`]) estão no caso de uso. Os comandos só correm o
//! trabalho num worker bloqueante — tocar no motor de contentores é I/O de processo, nunca
//! na thread da janela — e mapeiam o erro → `String` só na fronteira: o `join` da tarefa
//! veste o prefixo histórico `"devcontainer task failed: …"`; o erro do caso de uso passa
//! pelo seu `Display` (as mesmas mensagens que `lib.rs` emitia; os erros do próprio motor
//! crus). Comportamento idêntico ao anterior — mesmos nomes, args e contratos serde.
//!
//! Nenhum destes comandos é invocado pela `ui-app` (o pane infra é simulado no browser);
//! preservam-se na mesma por serem contrato público.

use crate::devcontainer::{self, DevcontainerInfo, DevcontainerUp, SessionStatus};
use std::path::Path;

/// Dev Container presence + name for the Remote view (best-effort; never fails on a
/// malformed config). Runs off the UI thread.
#[tauri::command]
pub async fn devcontainer_info(root: String) -> Result<DevcontainerInfo, String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::info(Path::new(&root)))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))
}

/// Bring the Dev Container up (one-shot): resolve/build the image, run `postCreateCommand`.
#[tauri::command]
pub async fn devcontainer_up(root: String) -> Result<DevcontainerUp, String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::up(Path::new(&root)))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Exec an arbitrary shell line inside the devcontainer image with the workspace mounted.
#[tauri::command]
pub async fn devcontainer_exec(root: String, cmd: String) -> Result<DevcontainerUp, String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::exec(Path::new(&root), &cmd))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Start the PERSISTENT devcontainer session (long-lived container; state persists).
#[tauri::command]
pub async fn devcontainer_session_up(root: String) -> Result<DevcontainerUp, String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::session_up(Path::new(&root)))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Exec a command inside the RUNNING persistent session (state preserved between calls).
#[tauri::command]
pub async fn devcontainer_session_exec(
    root: String,
    cmd: String,
) -> Result<DevcontainerUp, String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::session_exec(Path::new(&root), &cmd))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Run the active file INSIDE the persistent session (the container's toolchain).
#[tauri::command]
pub async fn devcontainer_session_run(
    root: String,
    file: String,
) -> Result<DevcontainerUp, String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::session_run(Path::new(&root), &file))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Whether the persistent session is running (best-effort probe). Runs off the UI thread.
#[tauri::command]
pub async fn devcontainer_session_status(root: String) -> Result<SessionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::session_status(Path::new(&root)))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))
}

/// Tear the persistent session down (remove the long-lived container).
#[tauri::command]
pub async fn devcontainer_session_down(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || devcontainer::session_down(Path::new(&root)))
        .await
        .map_err(|e| format!("devcontainer task failed: {e}"))?
        .map_err(|e| e.to_string())
}
