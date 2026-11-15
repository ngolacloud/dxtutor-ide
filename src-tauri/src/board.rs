//! Comandos Tauri do Board — persistência durável do backlog (sprints + user stories) no
//! backend SQLite ([`tutor_board`]). Um backlog por *workspace* (chaveado pela raiz aberta,
//! ou `"default"` sem pasta). A base vive no directório de dados local da app
//! (`app_local_data_dir/board.sqlite3`), sobrevivendo ao reinício.
//!
//! A GERAÇÃO do backlog (problema → stories) é do assistente, no frontend; aqui só se persiste
//! e se lê — o veredicto de valor nunca é fabricado no backend.

use tauri::{AppHandle, Manager};
use tutor_board::{Backlog, BoardStore};

/// Caminho do ficheiro SQLite do board, criando o directório se preciso.
fn db_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("sem directório de dados: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("não consegui criar {dir:?}: {e}"))?;
    Ok(dir.join("board.sqlite3"))
}

/// Chave de workspace: a raiz aberta, ou `"default"` sem pasta.
fn key(root: Option<String>) -> String {
    match root {
        Some(r) if !r.trim().is_empty() => r,
        _ => "default".to_string(),
    }
}

/// Lê o backlog persistido de `root` (ou `null` se ainda não existe).
#[tauri::command]
pub fn board_load(app: AppHandle, root: Option<String>) -> Result<Option<Backlog>, String> {
    let store = BoardStore::open(&db_path(&app)?).map_err(|e| e.to_string())?;
    store.load_board(&key(root)).map_err(|e| e.to_string())
}

/// Grava (substitui atomicamente) o backlog de `root`. Idempotente.
#[tauri::command]
pub fn board_save(app: AppHandle, root: Option<String>, backlog: Backlog) -> Result<(), String> {
    let mut store = BoardStore::open(&db_path(&app)?).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    store
        .save_board(&key(root), &backlog, now)
        .map_err(|e| e.to_string())
}
