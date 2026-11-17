//! Comandos IPC de git (SCM, secção 5) — adaptadores finos sobre o caso de uso Tauri-free
//! `crate::gitops` e sobre o mecanismo de disco já puro de `tutor_eval::git`.
//!
//! Nenhuma regra de negócio vive aqui. Os comandos com regra (`git_log` tem a página por
//! omissão, `git_diff` o default de `staged`) e as mutações (erro tipado) correm o caso de
//! uso; as leituras sem regra (`git_changes`/`git_show`/`git_branch`/`git_branches`) são
//! passagens directas para `tutor_eval::git`. Todos correm num worker bloqueante — tocar no
//! git é I/O de processo, nunca na thread da janela — e mapeiam o erro → `String` só na
//! fronteira. Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3: mesmos nomes,
//! args e contratos serde (git é consumido pela `ui-app`), e as MESMAS mensagens de erro —
//! o prefixo `"git task failed: …"` numa falha da tarefa, o `stderr` cru do git na falha do
//! git (via `crate::gitops::GitError`).

use crate::gitops;
use std::path::Path;

/// Section 5 (daily work): the working-tree changes in the git repo at `root` (read-only).
#[tauri::command]
pub async fn git_changes(root: String) -> Result<Vec<tutor_eval::git::GitChange>, String> {
    tauri::async_runtime::spawn_blocking(move || tutor_eval::git::changed_files(Path::new(&root)))
        .await
        .map_err(|e| format!("git task failed: {e}"))
}

/// SCM write op: add `path` to the index. Runs off the UI thread; surfaces git's stderr.
#[tauri::command]
pub async fn git_stage(root: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || gitops::stage(Path::new(&root), &path))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// SCM write op: remove `path` from the index. Runs off the UI thread; surfaces git's stderr.
#[tauri::command]
pub async fn git_unstage(root: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || gitops::unstage(Path::new(&root), &path))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// SCM write op: stage all changes. Runs off the UI thread; surfaces git's stderr.
#[tauri::command]
pub async fn git_stage_all(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || gitops::stage_all(Path::new(&root)))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// SCM write op: commit the index with `message`. Runs off the UI thread; surfaces git's stderr.
#[tauri::command]
pub async fn git_commit(root: String, message: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || gitops::commit(Path::new(&root), &message))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Section 5: the recent commit history at `root` (read-only). The default page size lives
/// in the use case (`gitops::DEFAULT_LOG_LIMIT`), no longer a magic number in the command.
#[tauri::command]
pub async fn git_log(
    root: String,
    max: Option<usize>,
) -> Result<Vec<tutor_eval::git::GitCommit>, String> {
    tauri::async_runtime::spawn_blocking(move || gitops::history(Path::new(&root), max))
        .await
        .map_err(|e| format!("git task failed: {e}"))
}

/// Section 5: the full diff/body of commit `hash` at `root` (read-only).
#[tauri::command]
pub async fn git_show(root: String, hash: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || tutor_eval::git::show(Path::new(&root), &hash))
        .await
        .map_err(|e| format!("git task failed: {e}"))
}

/// Section 5: the branches in the repo at `root` (read-only).
#[tauri::command]
pub async fn git_branches(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || tutor_eval::git::branches(Path::new(&root)))
        .await
        .map_err(|e| format!("git task failed: {e}"))
}

/// SCM write op: check out `branch`. Runs off the UI thread; surfaces git's stderr.
#[tauri::command]
pub async fn git_checkout(root: String, branch: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || gitops::checkout(Path::new(&root), &branch))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// SCM write op: create (and switch to) branch `name`. Runs off the UI thread; surfaces git's stderr.
#[tauri::command]
pub async fn git_create_branch(root: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || gitops::create_branch(Path::new(&root), &name))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Section 5 (daily work): the current git branch at `root` (or a short commit when
/// detached), for the status bar. `None` → not a repo.
#[tauri::command]
pub async fn git_branch(root: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || tutor_eval::git::current_branch(Path::new(&root)))
        .await
        .map_err(|e| format!("git task failed: {e}"))
}

/// Section 5 (daily work): a unified diff of the working tree vs HEAD, optionally scoped to
/// `file`. Read-only; empty when there is nothing to show or it is not a repo. The default
/// (`staged == false` → working tree) lives in the use case (`gitops::want_staged`).
#[tauri::command]
pub async fn git_diff(
    root: String,
    file: Option<String>,
    staged: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        gitops::diff(Path::new(&root), file.as_deref(), staged)
    })
    .await
    .map_err(|e| format!("git task failed: {e}"))
}

/// Clone a git repository `url` into `parent_dir`, returning the new repo's path so the
/// workspace can mount it. Runs off the UI thread; errors carry git's stderr.
#[tauri::command]
pub async fn git_clone(url: String, parent_dir: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || gitops::clone(&url, Path::new(&parent_dir)))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
        .map_err(|e| e.to_string())
}
