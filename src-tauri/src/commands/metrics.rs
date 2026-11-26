//! The metrics source (r23, NOTAS-r23 point 3): thin adapters over `tutor_platform::metrics` — what Ops shows
//! (the source, each SLO's error budget, the cluster's capacity), the read token in the keychain (never returned)
//! and the incidents' metrics check. Prometheus is only read.

use std::path::PathBuf;

use tauri::AppHandle;
use tutor_platform::keychain::OsStore;
use tutor_platform::metrics;

pub(crate) fn store() -> &'static OsStore {
    static S: std::sync::OnceLock<OsStore> = std::sync::OnceLock::new();
    S.get_or_init(OsStore::new)
}

fn audited(app: &AppHandle, root: &str, action: &str, label: &str) -> Result<(), String> {
    crate::board::audit_backend(app, root, "metrics", action, label, None).map_err(|e| {
        format!(
            "not done: the audit log could not record it ({})",
            e.message
        )
    })
}

/// The source, the budgets and the capacity, as measured now (Ops › Data sources).
#[tauri::command]
pub async fn metrics_status(root: String) -> Result<metrics::Overview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        metrics::overview(store(), &PathBuf::from(root.trim()))
    })
    .await
    .map_err(|e| format!("metrics task failed: {e}"))
}

/// Keeps the Prometheus read token in the keychain (`auth: keychain`); audited first, never returned.
#[tauri::command]
pub fn metrics_token_set(
    app: AppHandle,
    root: String,
    url: String,
    token: String,
) -> Result<(), String> {
    audited(
        &app,
        &root,
        "token.set",
        &format!("keychain {}", metrics::token_account(&url)),
    )?;
    metrics::set_token(store(), &url, &token)
}

#[tauri::command]
pub fn metrics_token_clear(app: AppHandle, root: String, url: String) -> Result<(), String> {
    audited(
        &app,
        &root,
        "token.clear",
        &format!("keychain {}", metrics::token_account(&url)),
    )?;
    metrics::clear_token(store(), &url)
}

/// Runs the metrics check of an incident (each SLO's error ratio in the hour before it opened and since) and
/// records each line on its timeline as a check run.
#[tauri::command]
pub async fn incident_metrics_check(
    app: AppHandle,
    root: String,
    id: i64,
) -> Result<Vec<String>, String> {
    use tutor_board::project::incidents;
    let inc = crate::board::with_store(&app, &root, |s, r| incidents::get(s.conn(), r, id))
        .map_err(|e| e.message)?
        .ok_or("no such incident")?
        .0;
    let (_, now) = crate::board::who_and_when(&root);
    let r2 = root.clone();
    let lines = tauri::async_runtime::spawn_blocking(move || {
        let l = metrics::live(store(), &PathBuf::from(r2.trim()))
            .map_err(|u| format!("no metrics source: {}", u.notes))?;
        if l.slos.is_empty() {
            return Err(format!(
                "no SLOs in {}: nothing to check",
                metrics::SLO_FILE
            ));
        }
        Ok(metrics::incident_lines(&l, inc.opened_at, now))
    })
    .await
    .map_err(|e| format!("metrics task failed: {e}"))??;
    let (actor, at) = crate::board::who_and_when(&root);
    crate::board::with_store(&app, &root, |s, r| {
        for l in &lines {
            incidents::add(s.conn(), r, id, "checked", l, None, &actor, at)?;
        }
        Ok(())
    })
    .map_err(|e| e.message)?;
    Ok(lines)
}
