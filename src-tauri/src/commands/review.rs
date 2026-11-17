//! Comandos IPC de review de código — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::review` e sobre os utilitários puros de `tutor_eval::review`.
//!
//! Nenhuma regra de negócio vive aqui: `review_code` corre o caso de uso num worker
//! bloqueante (para um analisador de vários segundos nunca travar a janela) e mapeia
//! o erro tipado → `String` na fronteira; `list_review_analyzers`/`verify_review_fix`
//! são passagens directas para funções já Tauri-free. Comportamento idêntico ao que
//! `lib.rs` tinha antes da Etapa 3 (mesmas mensagens de erro, mesmos contratos serde).

use crate::review::run_review;

/// Offline Code Review over a REAL project folder. Runs on a blocking worker (NOT
/// the UI thread), so a multi-second analyzer never stalls the window. `scope` is
/// "file" | "changes" | "project"; `path` names the file for "file" scope. `version`
/// is echoed back untouched so the frontend can discard a result that is stale for
/// the current buffer. Works with the network down and no model configured.
#[tauri::command]
pub async fn review_code(
    root: String,
    scope: String,
    path: Option<String>,
    version: Option<String>,
) -> Result<tutor_eval::review::ReviewReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_review(std::path::Path::new(&root), &scope, path, version)
    })
    .await
    .map_err(|e| format!("review task failed: {e}"))?
    .map_err(|e| e.to_string())
}

/// The local analyzers installed on this host, so the review UI can advertise what
/// it can really do and show which tools are missing.
#[tauri::command]
pub fn list_review_analyzers() -> Vec<tutor_eval::review::AnalyzerInfo> {
    tutor_eval::review::detect_analyzers()
}

/// P0-3: verify a review fix is still safe to apply to the CURRENT buffer. `currentSource`
/// is the live editor content; `analyzedVersion` is the file's `content_version` captured
/// when the review ran (from `ReviewReport.fileVersions`). Refuses — preserving the
/// developer's edits — if the buffer drifted or the target snippet no longer matches.
#[tauri::command]
pub fn verify_review_fix(
    current_source: String,
    analyzed_version: String,
    fix: tutor_eval::review::SuggestedFix,
) -> tutor_eval::review::FixVerification {
    tutor_eval::review::verify_fix(&current_source, &analyzed_version, &fix)
}
