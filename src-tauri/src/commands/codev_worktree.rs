//! Comandos Tauri das worktrees e das reservas de ficheiros do Co-Dev (Multi Co-Dev, fase 3) —
//! adaptadores finos sobre `crate::codev_worktree` (sem Tauri). As worktrees vivem na pasta de
//! dados local da app (`app_local_data_dir/worktrees/<repo>/<issue>`): fora da pasta do projecto,
//! nunca no `git status` nem nas ferramentas dele. Criar e limpar correm só o comando aprovado e vão
//! ao registo de auditoria antes e com o resultado (no Rust).

use std::path::PathBuf;

use tauri::Manager;

use crate::codev_worktree as uc;

/// A pasta das worktrees do Co-Dev (criada quando preciso).
pub fn base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("sem directório de dados: {e}"))?
        .join("worktrees"))
}

fn db(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::board::db_path(app)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("worktree task failed: {e}"))?
}

/// O que começar uma sessão Co-Dev na issue `key` faz ao repositório: nada (a worktree existe, ou a
/// pasta não tem git — `available: false`) ou os comandos exactos que a criam. SÓ LEITURA.
#[tauri::command]
pub async fn codev_worktree_plan(
    app: tauri::AppHandle,
    root: String,
    key: String,
) -> Result<tutor_eval::gitwork::codev::WorktreePlan, String> {
    let (db, base) = (db(&app)?, base(&app)?);
    blocking(move || uc::plan(&db, &base, root.trim(), key.trim())).await
}

/// Cria a worktree da issue com o comando aprovado (`command`, tal como o plano o mostrou); auditado
/// antes e com o resultado. O ramo fica registado na issue.
#[tauri::command]
pub async fn codev_worktree_create(
    app: tauri::AppHandle,
    root: String,
    key: String,
    command: String,
    decided_at: Option<i64>,
) -> Result<tutor_eval::gitwork::codev::WorktreeInfo, String> {
    let (db, base) = (db(&app)?, base(&app)?);
    blocking(move || uc::create(&db, &base, root.trim(), key.trim(), &command, decided_at)).await
}

/// As worktrees do Co-Dev do repositório, cada uma com a sessão aberta que lá trabalha (nenhuma:
/// guardada com alterações, ou deixada por um crash). SÓ LEITURA.
#[tauri::command]
pub async fn codev_worktrees(
    app: tauri::AppHandle,
    root: String,
) -> Result<Vec<uc::Listed>, String> {
    let base = base(&app)?;
    blocking(move || uc::list(&base, root.trim())).await
}

/// Limpa a worktree de uma issue sem sessão aberta, com o comando aprovado: sai se não tiver
/// alterações por commitar (o ramo fica), senão fica. Auditado antes e com o resultado.
#[tauri::command]
pub async fn codev_worktree_remove(
    app: tauri::AppHandle,
    root: String,
    key: String,
    command: String,
    decided_at: Option<i64>,
) -> Result<tutor_eval::gitwork::codev::Removal, String> {
    let (db, base) = (db(&app)?, base(&app)?);
    blocking(move || uc::remove(&db, &base, root.trim(), key.trim(), &command, decided_at)).await
}

/// Um ficheiro da worktree de uma issue, só para ler: como estava onde o ramo saiu e como está.
#[tauri::command]
pub async fn codev_worktree_file(
    app: tauri::AppHandle,
    root: String,
    key: String,
    path: String,
) -> Result<tutor_eval::gitwork::codev::FilePair, String> {
    let base = base(&app)?;
    blocking(move || uc::file(&base, root.trim(), key.trim(), &path)).await
}

/// Commita tudo o que a worktree de uma issue tem, no ramo dela (o «Commit» da faixa), depois do
/// secret scan. Auditado.
#[tauri::command]
pub async fn codev_worktree_commit(
    app: tauri::AppHandle,
    root: String,
    key: String,
    message: String,
) -> Result<String, String> {
    let (db, base) = (db(&app)?, base(&app)?);
    let (r, k) = (root.trim().to_string(), key.trim().to_string());
    let sha = blocking(move || uc::commit(&db, &base, root.trim(), key.trim(), &message)).await?;
    // Multi Co-Dev, phase 5: the autonomy that stopped only for uncommitted work asks again (once)
    crate::codev_autonomy::committed(&r, &k);
    Ok(sha)
}

/// As reservas de ficheiros do projecto (as abandonadas saem). SÓ LEITURA para a interface.
#[tauri::command]
pub async fn codev_claims(
    app: tauri::AppHandle,
    root: String,
) -> Result<Vec<tutor_board::project::claims::Claim>, String> {
    let db = db(&app)?;
    blocking(move || uc::claims(&db, root.trim())).await
}
