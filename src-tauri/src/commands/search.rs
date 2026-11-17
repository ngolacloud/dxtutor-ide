//! Comandos IPC de pesquisa / projecto — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::search`.
//!
//! Nenhuma regra de negócio vive aqui. Os quatro comandos correm o caso de uso num
//! worker bloqueante (varrer disco nunca trava a janela) e só vestem o prefixo
//! histórico `"… task failed: …"` na fronteira — o grupo é infalível ao nível do caso
//! de uso (o walk engole E/S), por isso o único erro que resta é o *join* da tarefa.
//! Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3 (mesmos contratos
//! serde, mesmas mensagens, mesmos defaults de página).

use crate::search::{self, FolderSource, ProjectInfo};
use std::path::Path;

/// Section 5 (daily work): global literal search across the project at `root`. Returns up
/// to `max` hits (file-relative). Offline, bounded; runs off the UI thread.
#[tauri::command]
pub async fn search_project(
    root: String,
    query: String,
    max: Option<usize>,
    ignore_case: Option<bool>,
) -> Result<Vec<tutor_eval::search::SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || search::search(Path::new(&root), &query, max, ignore_case))
        .await
        .map_err(|e| format!("search task failed: {e}"))
}

/// Section 5 (daily work): list the project's files (relative, sorted) for quick-open.
/// Offline, bounded; runs off the UI thread.
#[tauri::command]
pub async fn list_files(root: String, max: Option<usize>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || search::list_files(Path::new(&root), max))
        .await
        .map_err(|e| format!("list_files task failed: {e}"))
}

/// Detect projects at the root and one level down (skipping hidden / build dirs), so the
/// Agent can pin its focus to a specific project in a multi-project workspace.
#[tauri::command]
pub async fn detect_projects(root: String) -> Result<Vec<ProjectInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || search::detect_projects(Path::new(&root)))
        .await
        .map_err(|e| format!("detect_projects task failed: {e}"))
}

/// Collect source files under `dir` (recursive, skipping hidden / build dirs), bounded by
/// `max_files` and `max_bytes` total, for a module-level Explain. Honest truncation: stops
/// adding once a cap is hit.
#[tauri::command]
pub async fn read_folder_sources(
    dir: String,
    max_files: Option<usize>,
    max_bytes: Option<usize>,
) -> Result<Vec<FolderSource>, String> {
    tauri::async_runtime::spawn_blocking(move || search::read_folder_sources(Path::new(&dir), max_files, max_bytes))
        .await
        .map_err(|e| format!("read_folder_sources task failed: {e}"))
}
