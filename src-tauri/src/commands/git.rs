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

/// What `git_clone` will run (r23 F6): the exact command, the folder it creates and whether that
/// folder exists — for the approval dialog. The same validation guards `git_clone`.
#[tauri::command]
pub fn git_clone_plan(
    url: String,
    parent_dir: String,
) -> Result<tutor_eval::git::ClonePlan, String> {
    gitops::clone_plan(&url, Path::new(&parent_dir)).map_err(|e| e.to_string())
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

// ───── A4 (docs/v2/UI-AUDIT.md item 9): blame, histórico, comparar, stash, worktrees, rebase, amend ─────
// Passagens directas para `tutor_eval::gitx` (que valida os argumentos e lê a saída de máquina
// do git), num worker bloqueante; o erro do git chega à UI tal-e-qual.

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

/// The Commit Graph's sidebar in one read (r23 F3): branches with upstream and ahead/behind,
/// remotes and their branches, tags (peeled), stashes, worktrees and contributors.
#[tauri::command]
pub async fn git_refs(root: String) -> Result<tutor_eval::gitwork::Refs, String> {
    blocking(move || tutor_eval::gitwork::refs(Path::new(&root))).await
}

/// The hunks of one file (r23 F3, UI-SCM-10): the working tree's, or the index's with `staged`.
#[tauri::command]
pub async fn git_hunks(
    root: String,
    path: String,
    staged: bool,
) -> Result<tutor_eval::gitwork::FileHunks, String> {
    blocking(move || tutor_eval::gitwork::hunks(Path::new(&root), &path, staged)).await
}

/// Stages the hunks `ids` of `path` (`git apply --cached` of a patch of just those), or takes
/// them back out of the index with `unstage`. Returns that side's hunks afterwards.
#[tauri::command]
pub async fn git_stage_hunks(
    root: String,
    path: String,
    ids: Vec<String>,
    unstage: bool,
) -> Result<tutor_eval::gitwork::FileHunks, String> {
    blocking(move || tutor_eval::gitwork::stage_hunks(Path::new(&root), &path, &ids, unstage)).await
}

/// Records the repository's state before an operation (r23 F3, UI-SCM-12): HEAD, branches and
/// tags, the index tree and a stash of the working tree, under `refs/dxtutor/undo/<n>`.
#[tauri::command]
pub async fn git_undo_snapshot(
    root: String,
    label: String,
) -> Result<tutor_eval::gitwork::UndoEntry, String> {
    blocking(move || tutor_eval::gitwork::undo_snapshot(Path::new(&root), &label)).await
}

/// The undo snapshots, newest first.
#[tauri::command]
pub async fn git_undo_list(root: String) -> Result<Vec<tutor_eval::gitwork::UndoEntry>, String> {
    blocking(move || tutor_eval::gitwork::undo_list(Path::new(&root))).await
}

/// The exact git commands restoring snapshot `id` runs (for the approval dialog).
#[tauri::command]
pub async fn git_undo_plan(root: String, id: u32) -> Result<tutor_eval::gitwork::UndoPlan, String> {
    blocking(move || tutor_eval::gitwork::undo_plan(Path::new(&root), id)).await
}

/// Restores snapshot `id` after snapshotting the present; returns that new snapshot.
#[tauri::command]
pub async fn git_undo_restore(
    root: String,
    id: u32,
) -> Result<tutor_eval::gitwork::UndoEntry, String> {
    blocking(move || tutor_eval::gitwork::undo_restore(Path::new(&root), id)).await
}

/// For each branch, whether merging it into HEAD would conflict, and in which files (r23 F3,
/// UI-SCM-13; `git merge-tree --write-tree`, nothing touched).
#[tauri::command]
pub async fn git_predict_conflicts(
    root: String,
    branches: Vec<String>,
) -> Result<Vec<tutor_eval::gitwork::Prediction>, String> {
    blocking(move || tutor_eval::gitwork::predict_conflicts(Path::new(&root), &branches)).await
}

/// The merge in progress (r23 F3, UI-SCM-13): status, resolve a file (write + stage), commit
/// (refused while a file is unmerged) or abort.
#[tauri::command]
pub async fn git_merge(
    root: String,
    op: tutor_eval::gitwork::MergeOp,
) -> Result<tutor_eval::gitwork::MergeState, String> {
    blocking(move || tutor_eval::gitwork::merge(Path::new(&root), &op)).await
}

/// The three versions of a conflicted file (base, ours, theirs) and the working copy.
#[tauri::command]
pub async fn git_conflict_stages(
    root: String,
    path: String,
) -> Result<tutor_eval::gitwork::ConflictStages, String> {
    blocking(move || tutor_eval::gitwork::conflict_stages(Path::new(&root), &path)).await
}

/// Blame of `path` (por linha: commit, autor, data, assunto) + quem conhece o código (SCM-01/06).
#[tauri::command]
pub async fn git_blame(root: String, path: String) -> Result<tutor_eval::gitx::Blame, String> {
    blocking(move || tutor_eval::gitx::blame(Path::new(&root), &path)).await
}

/// Os commits que tocaram `path` (segue renomeações); com `start`/`end`, só os que mudaram
/// essas linhas (`git log -L`) — SCM-04.
#[tauri::command]
pub async fn git_history(
    root: String,
    path: String,
    start: Option<u32>,
    end: Option<u32>,
    max: Option<usize>,
) -> Result<Vec<tutor_eval::gitx::HistCommit>, String> {
    blocking(move || {
        let lines = start.map(|s| (s, end.unwrap_or(s)));
        tutor_eval::gitx::history(Path::new(&root), &path, lines, max.unwrap_or(100))
    })
    .await
}

/// O que um commit fez a um ficheiro (mensagem completa + diff só desse ficheiro).
#[tauri::command]
pub async fn git_show_path(root: String, hash: String, path: String) -> Result<String, String> {
    blocking(move || tutor_eval::gitx::show_path(Path::new(&root), &hash, &path)).await
}

/// Compara duas refs: commits à frente/atrás e os ficheiros que `target` mudou (SCM-05).
#[tauri::command]
pub async fn git_compare(
    root: String,
    base: String,
    target: String,
) -> Result<tutor_eval::gitx::Compare, String> {
    blocking(move || tutor_eval::gitx::compare(Path::new(&root), &base, &target)).await
}

/// Stashes: `{op:"list"|"push"|"apply"|"drop"|"show", …}` → a lista e a mensagem do git.
#[tauri::command]
pub async fn git_stash(
    root: String,
    op: tutor_eval::gitx::StashOp,
) -> Result<tutor_eval::gitx::StashResult, String> {
    blocking(move || tutor_eval::gitx::stash(Path::new(&root), &op)).await
}

/// Worktrees: `{op:"list"|"add"|"remove", …}` → a lista (nunca remove a aberta nem a principal).
#[tauri::command]
pub async fn git_worktree(
    root: String,
    op: tutor_eval::gitx::WorktreeOp,
) -> Result<Vec<tutor_eval::gitx::Worktree>, String> {
    blocking(move || tutor_eval::gitx::worktree(Path::new(&root), &op)).await
}

/// Rebase interactivo: `{op:"plan", onto}` dá os commits; `{op:"run", onto, steps}` corre o
/// plano que o humano aprovou (e desfaz-se se parar).
#[tauri::command]
pub async fn git_rebase(
    root: String,
    op: tutor_eval::gitx::RebaseOp,
) -> Result<tutor_eval::gitx::RebasePlan, String> {
    blocking(move || tutor_eval::gitx::rebase(Path::new(&root), &op)).await
}

/// Emenda o último commit (o que está staged e, se vier, a mensagem nova). Um commit já num
/// ramo remoto é recusado (`published: …`) a não ser com `allowPublished`.
#[tauri::command]
pub async fn git_amend(
    root: String,
    message: Option<String>,
    allow_published: Option<bool>,
) -> Result<String, String> {
    blocking(move || {
        tutor_eval::gitx::amend(
            Path::new(&root),
            message.as_deref(),
            allow_published.unwrap_or(false),
        )
    })
    .await
}

/// O diff de `base...target` (o que `target` mudou desde a base comum), de um ficheiro ou de tudo —
/// para rever um ramo (A10).
#[tauri::command]
pub async fn git_diff_range(
    root: String,
    base: String,
    target: String,
    path: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        tutor_eval::gitx::range_diff(Path::new(&root), &base, &target, path.as_deref())
    })
    .await
}
