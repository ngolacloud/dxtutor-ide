//! Comandos Tauri do Project (docs/v2/UI-AUDIT.md, item 5) — adaptadores finos sobre o
//! store SQLite [`tutor_board::project`]. Um projecto por *workspace* (a raiz aberta). A base
//! vive no directório de dados local da app (`app_local_data_dir/board.sqlite3`); a
//! migração 1 importa o Board antigo (`board_load`/`board_save`, que esta fase substitui).
//!
//! As regras (um passo de cada vez, WIP, DoR, DoD, bloqueio) são verificadas no store, numa
//! transacção por operação; aqui só se abre a base, se identifica quem age e se devolve o
//! projecto (ou o erro com o código da regra, para a UI oferecer a excepção com motivo).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};
use tutor_board::project::{
    reports::Reports, IssueDetail, Op, Project, ProjectError, ProjectStore,
};

/// Caminho do ficheiro SQLite do projecto, criando o directório se preciso.
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("sem directório de dados: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("não consegui criar {dir:?}: {e}"))?;
    Ok(dir.join("board.sqlite3"))
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn db_err(e: String) -> ProjectError {
    ProjectError {
        code: "db".into(),
        message: e,
        overridable: false,
    }
}

fn open(app: &AppHandle) -> Result<ProjectStore, ProjectError> {
    ProjectStore::open(&db_path(app).map_err(db_err)?).map_err(db_err)
}

fn root_of(root: &str) -> Result<String, ProjectError> {
    let r = root.trim();
    if r.is_empty() {
        return Err(ProjectError {
            code: "invalid".into(),
            message: "o Project precisa de uma pasta aberta".into(),
            overridable: false,
        });
    }
    Ok(r.to_string())
}

/// Quem age: o `user.name` do git do projecto (em cache por raiz), ou o utilizador do SO.
pub fn actor(root: &str) -> String {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(a) = cache.lock().unwrap().get(root) {
        return a.clone();
    }
    let git = std::process::Command::new("git")
        .args(["config", "user.name"])
        .current_dir(Path::new(root))
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    let a = git
        .or_else(|| std::env::var("USER").ok())
        .or_else(|| std::env::var("USERNAME").ok())
        .unwrap_or_else(|| "eu".into());
    cache.lock().unwrap().insert(root.to_string(), a.clone());
    a
}

/// O projecto da pasta `root` (criado vazio no primeiro uso).
#[tauri::command]
pub fn project_load(app: AppHandle, root: String) -> Result<Project, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.load(&root, now_ms())
}

/// Aplica uma operação (`{op: "move", key, to, reason?}`, `{op: "create_issue", …}`, …) de
/// forma atómica e devolve o projecto depois dela. Uma regra violada devolve o erro com o
/// `code` da regra e `overridable`.
#[tauri::command]
pub fn project_apply(
    app: AppHandle,
    root: String,
    op: serde_json::Value,
) -> Result<Project, ProjectError> {
    let root = root_of(&root)?;
    let op: Op = serde_json::from_value(op).map_err(|e| ProjectError {
        code: "invalid".into(),
        message: format!("operação inválida: {e}"),
        overridable: false,
    })?;
    open(&app)?.apply(&root, &actor(&root), now_ms(), op)
}

/// A actividade e os change sets do Co-Dev de uma issue (o painel da issue).
#[tauri::command]
pub fn project_issue(
    app: AppHandle,
    root: String,
    key: String,
) -> Result<IssueDetail, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.detail(&root, &key)
}

/// Os relatórios calculados do histórico (vazios sem histórico).
#[tauri::command]
pub fn project_reports(app: AppHandle, root: String) -> Result<Reports, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.reports(&root, now_ms())
}
