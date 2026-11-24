//! Comandos Tauri do Project (docs/v2/UI-AUDIT.md, item 5) — adaptadores finos sobre o
//! store SQLite [`tutor_board::project`]. Um projecto por *workspace* (a raiz aberta). A base
//! vive no directório de dados local da app (`app_local_data_dir/board.sqlite3`); a
//! migração 1 importa o Board antigo que lá estava. O quadro Tasks (ADR-0006, R3b) continua com
//! `board_load`/`board_save`, num ficheiro próprio (`tasks.sqlite3`, fim deste módulo).
//!
//! As regras (um passo de cada vez, WIP, DoR, DoD, bloqueio) são verificadas no store, numa
//! transacção por operação; aqui só se abre a base, se identifica quem age e se devolve o
//! projecto (ou o erro com o código da regra, para a UI oferecer a excepção com motivo).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Manager};
use tutor_board::project::{
    reports::Reports, AuditEntry, IssueDetail, Op, Project, ProjectError, ProjectStore,
};
use tutor_board::{Backlog, BoardStore};

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

/// O registo de auditoria do Co-Dev (RF-T01): de uma issue (`issue`) ou da pasta toda, por
/// ordem, com os segredos já mascarados. É o que «Exportar registo» grava em JSON.
#[tauri::command]
pub fn project_audit(
    app: AppHandle,
    root: String,
    issue: Option<String>,
) -> Result<Vec<AuditEntry>, ProjectError> {
    let root = root_of(&root)?;
    open(&app)?.audit(&root, issue.as_deref().filter(|k| !k.trim().is_empty()))
}

// ── O quadro Tasks (ADR-0006, R3b) ─────────────────────────────────────────────────────────
// O quadro da actividade Tasks continua a gravar o backlog inteiro (`tutor_board::Backlog`) por
// pasta. Vive num ficheiro próprio: o `board.sqlite3` é do Project, cuja migração 1 renomeia as
// tabelas do Board antigo para `legacy_*` (e o `sprints` do Project tem outro esquema). Os dois
// quadros coexistem até a Q3 (docs/v2/QUESTIONS.md) decidir se o Tasks passa a ser o Project.

/// Caminho do SQLite do quadro Tasks, criando o directório se preciso.
fn tasks_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(db_path(app)?.with_file_name("tasks.sqlite3"))
}

/// Chave de workspace: a raiz aberta, ou `"default"` sem pasta.
fn tasks_key(root: Option<String>) -> String {
    match root {
        Some(r) if !r.trim().is_empty() => r,
        _ => "default".to_string(),
    }
}

/// Lê o backlog persistido de `root` (ou `null` se ainda não existe).
#[tauri::command]
pub fn board_load(app: AppHandle, root: Option<String>) -> Result<Option<Backlog>, String> {
    let store = BoardStore::open(&tasks_db_path(&app)?).map_err(|e| e.to_string())?;
    store
        .load_board(&tasks_key(root))
        .map_err(|e| e.to_string())
}

/// Grava (substitui atomicamente) o backlog de `root`. Idempotente.
#[tauri::command]
pub fn board_save(app: AppHandle, root: Option<String>, backlog: Backlog) -> Result<(), String> {
    let mut store = BoardStore::open(&tasks_db_path(&app)?).map_err(|e| e.to_string())?;
    store
        .save_board(&tasks_key(root), &backlog, now_ms())
        .map_err(|e| e.to_string())
}
