//! Comandos IPC Co-Dev — adaptadores finos sobre o caso de uso Tauri-free `crate::codev`.
//!
//! Nenhuma regra de negócio vive aqui. `codev_policy` corre a regra pura `policy_for_mode`
//! (parse da modebar → política de aprovação). As sessões (`codev_session_*`) são passagens
//! ao mecanismo de worktrees git, re-exportado por `crate::codev` — correm num worker
//! bloqueante (tocar no git é I/O de processo, nunca na thread da janela) e vestem o prefixo
//! histórico `"git task failed: …"` numa falha da tarefa; o `stderr`/erro interno do git
//! passa cru pelo `?`. Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3 —
//! mesmos nomes, args, contratos serde e mensagens (co-dev é consumido pela `ui-app`:
//! `features/codev.ts` nas sessões, a modebar na política).

use crate::codev;
use std::path::Path;

/// The active Co-Dev approval policy for the modebar mode (Manual/Assist/Auto). The
/// frontend consults it so the modebar governs whether edits/commands auto-apply or must
/// be approved. Destructive actions and push always ask, in every mode.
#[tauri::command]
pub fn codev_policy(mode: String) -> tutor_llm::policy::CoDevPolicy {
    codev::policy_for_mode(&mode)
}

/// Co-Dev session (Claude-Code style): open an isolated git worktree on a `codev/<slug>`
/// branch from HEAD, where the assistant works without touching the base tree.
#[tauri::command]
pub async fn codev_session_start(root: String, name: String) -> Result<codev::SessionInfo, String> {
    tauri::async_runtime::spawn_blocking(move || codev::session_start(Path::new(&root), &name))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

/// Deliver a Co-Dev session: commit its work, integrate (`merge --no-ff`) into the base branch
/// and tear down the worktree.
#[tauri::command]
pub async fn codev_session_deliver(
    root: String,
    slug: String,
    message: String,
) -> Result<codev::DeliverInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codev::session_deliver(Path::new(&root), &slug, &message)
    })
    .await
    .map_err(|e| format!("git task failed: {e}"))?
}

/// Discard a Co-Dev session without integrating: drop the worktree and its branch.
#[tauri::command]
pub async fn codev_session_discard(root: String, slug: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || codev::session_discard(Path::new(&root), &slug))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

/// List the open Co-Dev sessions (worktrees on `codev/*` branches) for `root`.
#[tauri::command]
pub async fn codev_session_list(root: String) -> Result<Vec<codev::SessionInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || codev::sessions(Path::new(&root)))
        .await
        .map_err(|e| format!("git task failed: {e}"))
}
