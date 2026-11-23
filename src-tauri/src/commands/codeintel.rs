//! Comandos IPC de inteligência de código — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::codeintel` e sobre utilitários já puros de `tutor_eval`/`crate::fsops`.
//!
//! Nenhuma regra de negócio vive aqui. Os comandos com regra (`symbol_relations`,
//! `file_outline`, `resolve_definition`/`resolve_references`/`resolve_hover`) correm o
//! caso de uso num worker bloqueante (uma análise pesada nunca trava a janela) e mapeiam o
//! erro tipado → `String` na fronteira; `symbol_ranges`/`list_symbols`/`diff_lines`/
//! `propose_entrypoint`/`project_entrypoint` são passagens directas para funções já
//! Tauri-free. Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3 (mesmas
//! mensagens de erro, mesmos contratos serde).

use crate::codeintel::{self, ResolvedDef};

/// CodeMap: the definitions, references and (inferred) callers of `symbol` across
/// the project at `root`. Runs off the UI thread. This slice is Rust + syntactic
/// (`resolution: "inferred"`); a rust-analyzer-backed resolved path lands later.
#[tauri::command]
pub async fn symbol_relations(
    root: String,
    symbol: String,
) -> Result<tutor_eval::codemap::Relations, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codeintel::relations(std::path::Path::new(&root), &symbol)
    })
    .await
    .map_err(|e| format!("codemap task failed: {e}"))?
    .map_err(|e| e.to_string())
}

/// Add-entrypoint: propose the idiomatic `main` for `lang` given `code`, or `None` when one
/// already exists. The UI appends the snippet as a reviewed localized edit. Pure.
#[tauri::command]
pub async fn propose_entrypoint(
    lang: String,
    code: String,
) -> Result<Option<tutor_eval::entrypoint::EntrypointProposal>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tutor_eval::entrypoint::propose_entrypoint(&lang, &code)
    })
    .await
    .map_err(|e| format!("propose_entrypoint task failed: {e}"))
}

/// Localized editing review: a line-level diff of the original block `old` vs the proposed
/// `new`, each line tagged context/add/del — the basis for the "show what changes" highlight
/// and "accept selected lines". Pure; runs off the UI thread.
#[tauri::command]
pub async fn diff_lines(
    old: String,
    new: String,
) -> Result<Vec<tutor_eval::textdiff::DiffLine>, String> {
    tauri::async_runtime::spawn_blocking(move || tutor_eval::textdiff::line_diff(&old, &new))
        .await
        .map_err(|e| format!("diff_lines task failed: {e}"))
}

/// Localized editing: the line span(s) of the Rust function/method named `name` in
/// `code` — the exact target range for a scoped edit, and the candidates to disambiguate
/// homonyms. Pure/syntactic; runs off the UI thread.
#[tauri::command]
pub async fn symbol_ranges(
    code: String,
    name: String,
) -> Result<Vec<tutor_eval::codemap::SymbolRange>, String> {
    tauri::async_runtime::spawn_blocking(move || tutor_eval::codemap::symbol_ranges(&code, &name))
        .await
        .map_err(|e| format!("symbol_ranges task failed: {e}"))
}

/// The symbol outline of a file, for a precise Explain anchored to real lines. Prefers the
/// real language server (textDocument/documentSymbol — rust-analyzer/pyright/gopls/tsserver,
/// on host or in the container) when `root`+`file` are given and a server answers; otherwise
/// the syntactic outline (Rust AST, or the Python/Go/JS/TS heuristic).
#[tauri::command]
pub async fn file_outline(
    code: String,
    lang: String,
    root: Option<String>,
    file: Option<String>,
) -> Result<Vec<tutor_eval::codemap::SymbolRange>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codeintel::outline(&code, &lang, root.as_deref(), file.as_deref())
    })
    .await
    .map_err(|e| format!("file_outline task failed: {e}"))
}

/// Section 5 (daily work): every symbol definition across the project at `root` (Rust via
/// `syn`; Go/Python syntactic), for a "go to symbol" palette. Runs off the UI thread.
#[tauri::command]
pub async fn list_symbols(
    root: String,
    max: Option<usize>,
) -> Result<Vec<tutor_eval::codemap::SymbolRef>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tutor_eval::codemap::all_symbols(std::path::Path::new(&root), max.unwrap_or(5000))
    })
    .await
    .map_err(|e| format!("list_symbols task failed: {e}"))
}

/// Section 5: resolve the definition of the symbol at (`line`, `col`) — both 1-based — in
/// `file` via rust-analyzer (REAL semantic navigation, not name-based). Returns `None` when
/// rust-analyzer is absent or can't resolve, so the UI falls back to the syntactic CodeMap.
/// Runs off the UI thread (spawns + indexes with rust-analyzer).
#[tauri::command]
pub async fn resolve_definition(
    root: String,
    file: String,
    line: u32,
    col: u32,
    text: Option<String>,
) -> Result<Option<ResolvedDef>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codeintel::definition(
            std::path::Path::new(&root),
            std::path::Path::new(&file),
            line,
            col,
            text.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("resolve_definition task failed: {e}"))
}

/// Section 5: hover info (type/docs markdown) for the symbol at (`line`, `col`) — both
/// 1-based — via rust-analyzer. `None` when absent/unresolved. Runs off the UI thread.
#[tauri::command]
pub async fn resolve_hover(
    root: String,
    file: String,
    line: u32,
    col: u32,
    text: Option<String>,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codeintel::hover(
            std::path::Path::new(&root),
            std::path::Path::new(&file),
            line,
            col,
            text.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("resolve_hover task failed: {e}"))
}

/// Section 5: resolve ALL references to the symbol at (`line`, `col`) — both 1-based — via
/// rust-analyzer. Empty when absent/unresolved. Runs off the UI thread.
#[tauri::command]
pub async fn resolve_references(
    root: String,
    file: String,
    line: u32,
    col: u32,
    text: Option<String>,
) -> Result<Vec<ResolvedDef>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        codeintel::references(
            std::path::Path::new(&root),
            std::path::Path::new(&file),
            line,
            col,
            text.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("resolve_references task failed: {e}"))
}

/// The project's runnable entry file under `root`, if one can be identified by its build
/// manifest (Cargo/Go/Python), else `null`. The Explorer's Run button uses this so it runs
/// the PROJECT entry point (e.g. `cargo run`) rather than whichever file is focused.
#[tauri::command]
pub fn project_entrypoint(root: String) -> Option<String> {
    crate::fsops::project_entrypoint(&root)
}
