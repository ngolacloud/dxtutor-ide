//! The model-call policy ([`crate::llm_policy`]): what the UI shows and the open folder the
//! backend uses for paths that get no project root.

use std::path::PathBuf;

/// The effective model-call policy for `root` — the organisation's file, the person's gateway
/// and the project's `.dxtutor/llm.json` — and remember `root` as the open folder (`None`
/// when the folder closes), so the chat, the streaming assistant and the study helpers apply
/// the project's policy too.
#[tauri::command]
pub async fn llm_policy_status(root: Option<String>) -> Result<tutor_llm::gateway::Policy, String> {
    let root = root
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty())
        .map(PathBuf::from);
    tauri::async_runtime::spawn_blocking(move || {
        crate::llm_policy::set_open_root(root.clone());
        crate::llm_policy::current(root.as_deref())
    })
    .await
    .map_err(|e| format!("policy task failed: {e}"))
}
