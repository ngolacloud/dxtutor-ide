//! Comandos IPC do painel inferior (Problems · Services) — adaptadores finos sobre os
//! casos de uso Tauri-free `crate::problems` e `crate::ports`.
//!
//! Nenhuma regra de negócio vive aqui: o scan corre num worker bloqueante (os checkers
//! podem demorar minutos e nunca podem travar a janela) e o progresso de cada checker é
//! traduzido para o evento `problems://check` (`{ phase: "start" | "done", … }`), que o
//! canal «Problems» do Output mostra ao vivo.

use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::{ports, problems};

/// Run the workspace's checkers (cargo check, tsc, go vet, ruff, eslint — whatever the
/// folder has) and return every problem, relative to `root`.
#[tauri::command]
pub async fn problems_scan(app: AppHandle, root: String) -> Result<problems::ScanResult, String> {
    let root = PathBuf::from(root);
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        problems::run(
            &root,
            |c| {
                let _ = app.emit("problems://check", json!({ "phase": "start", "source": c.source, "command": c.command_line(), "cwd": c.cwd.to_string_lossy() }));
            },
            |r| {
                let _ = app.emit("problems://check", json!({ "phase": "done", "report": r }));
            },
        )
    })
    .await
    .map_err(|e| format!("problems task failed: {e}"))
}

/// Listening TCP ports of the user's processes; those whose cwd is inside `root` first.
#[tauri::command]
pub async fn ports_list(root: Option<String>) -> Result<Vec<ports::PortInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || ports::list(root.as_deref().map(Path::new)))
        .await
        .map_err(|e| format!("ports task failed: {e}"))
}
