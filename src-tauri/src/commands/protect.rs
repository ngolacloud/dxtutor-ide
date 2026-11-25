//! Data protection (r23 F4a, docs/v2/AUDIT-r23.md §4.4 — X02, X03): thin adapters over
//! `tutor_protect`. The rules live in that crate (Tauri-free, tested); here only the IPC.

/// The open folder's `.env` secret values join what every LLM request is filtered for (X02).
#[tauri::command]
pub fn protect_learn(root: String) -> Result<usize, String> {
    tutor_protect::redact::learn_root(std::path::Path::new(root.trim()));
    Ok(tutor_protect::redact::total())
}

/// The secret scan of what a commit would take (X03): `scope` is `staged` (default), `tracked`
/// (`commit -a`), `working` (every change) or `paths` (with `paths`). Masked previews only.
#[tauri::command]
pub async fn secret_scan(
    root: String,
    scope: Option<String>,
    paths: Option<Vec<String>>,
) -> Result<tutor_protect::scan::ScanReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ps = paths.unwrap_or_default();
        let s = match scope.as_deref().unwrap_or("staged") {
            "tracked" => tutor_protect::scan::Scope::Tracked,
            "working" => tutor_protect::scan::Scope::WorkingTree,
            "paths" => tutor_protect::scan::Scope::Paths(&ps),
            _ => tutor_protect::scan::Scope::Staged,
        };
        tutor_protect::scan::scan(std::path::Path::new(root.trim()), &s)
    })
    .await
    .map_err(|e| format!("secret scan task failed: {e}"))?
}

/// Lets the next commit in `root` go ahead despite the scan (one commit, two minutes). The reason
/// is required; the UI records it in the audit log before calling this.
#[tauri::command]
pub fn secret_scan_allow(root: String, reason: String) -> Result<(), String> {
    tutor_protect::scan::allow_once(std::path::Path::new(root.trim()), &reason)
}
