//! Compatibility bridge for the v7 desktop UI (`ui-app/src/bridge.ts`).
//!
//! The new single-file UI talks to the backend through 14 thin, generic commands
//! (folders, autosave, a real shell, LLM providers, VSIX). They are ported verbatim
//! from the standalone `dxtutor-ide` prototype and registered ALONGSIDE the rich
//! specialised commands already in `main.rs` — the backend is a superset. The richer
//! surfaces (git_*, lsp, assistant_*, debug…) stay available to deepen the prototype
//! wiring in later milestones.

use crate::{keys, llm, procs, vsix, workspace};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

// `pick_folder` is NOT defined here: the existing `fsops::pick_folder` has the same
// signature (`AppHandle -> Option<String>`) and a non-blocking implementation that avoids
// freezing the window on Linux. It is registered in the handler instead.

// Adaptador IPC fino: delega ao caso de uso `workspace::open_workspace` (independente de Tauri,
// dono da política de limites e do erro tipado) e só mapeia `OpenError` → `String` na fronteira.
// A política e os limites deixam de viver aqui; o comando só traduz entre o mundo Tauri e o caso
// de uso. O `spawn_blocking` mantém o walk de disco fora da thread de UI.
#[tauri::command]
pub async fn load_workspace(root: String) -> Result<workspace::Loaded, String> {
    tauri::async_runtime::spawn_blocking(move || {
        workspace::open_workspace(std::path::Path::new(&root), workspace::LoadPolicy::default())
            .map_err(|e| format!("{root}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn write_file(root: String, rel: String, content: String) -> Result<(), String> {
    workspace::write(std::path::Path::new(&root), &rel, &content)
}

#[tauri::command]
pub fn delete_file(root: String, rel: String) -> Result<(), String> {
    workspace::delete(std::path::Path::new(&root), &rel)
}

#[tauri::command]
pub fn expand_path(path: String) -> String {
    workspace::expand_home(&path)
}

#[tauri::command]
pub async fn exec(
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    stdin: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<procs::ExecOut, String> {
    tauri::async_runtime::spawn_blocking(move || {
        procs::exec(
            &program,
            &args,
            cwd.as_deref(),
            &env.unwrap_or_default(),
            stdin.as_deref(),
            Duration::from_millis(timeout_ms.unwrap_or(120_000)),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn run_shell(
    app: AppHandle,
    procs_state: State<'_, procs::Procs>,
    id: String,
    line: String,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let a1 = app.clone();
    procs::spawn_shell(
        &procs_state,
        id,
        &line,
        cwd.as_deref(),
        &env.unwrap_or_default(),
        move |l| {
            let _ = a1.emit("proc-line", l);
        },
        move |e| {
            let _ = app.emit("proc-exit", e);
        },
    )
}

#[tauri::command]
pub fn kill_shell(procs_state: State<'_, procs::Procs>, id: String) -> bool {
    procs::kill(&procs_state, &id)
}

#[tauri::command]
pub fn keys_status(app: AppHandle) -> Result<HashMap<String, bool>, String> {
    let dir = config_dir(&app)?;
    Ok(["claude", "codex", "gemini", "ollama"]
        .iter()
        .map(|p| (p.to_string(), keys::resolve(&dir, p).is_some()))
        .collect())
}

#[tauri::command]
pub fn save_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    keys::save(&config_dir(&app)?, &provider, &key)
}

/// A Co-Dev chat turn. Routed through the tutor brain: `mode` ("study" | "project",
/// unknown ⇒ project here, since the v7 shim is a workspace pair-programmer) selects the
/// governance in `tutor_llm::policy`, so this command is the governed assistant rather
/// than the old generic `llm::chat`. The reply carries `origin:"tutor-llm"`.
#[tauri::command]
pub async fn llm_chat(
    app: AppHandle,
    req: llm::ChatReq,
    mode: Option<String>,
) -> Result<llm::ChatResp, String> {
    let key = keys::resolve(&config_dir(&app)?, &req.provider);
    // Anthropic org-scoped keys carry a workspace id (from the legacy providers.json or
    // ANTHROPIC_WORKSPACE_ID); other providers ignore it.
    let workspace_id = if llm::is_anthropic(&req.provider) {
        keys::anthropic_workspace_id()
    } else {
        None
    };
    let mode = tutor_llm::policy::Mode::parse(mode.as_deref().unwrap_or("project"));
    llm::chat_governed(req, key, mode, workspace_id).await
}

/// The governance the tutor brain would apply to a chat turn, computed WITHOUT calling any
/// model. Lets the headless selftest confirm the Co-Dev turn routes through tutor-llm
/// (origin) and that study mode imposes the tutor contract — sharing `govern_chat` with the
/// live `llm_chat`, so the probe reflects the real path rather than a reimplementation.
#[tauri::command]
pub fn llm_plan(req: llm::ChatReq, mode: Option<String>) -> serde_json::Value {
    let mode = tutor_llm::policy::Mode::parse(mode.as_deref().unwrap_or("project"));
    let g = tutor_llm::policy::govern_chat(mode, req.system.as_deref());
    let directive = tutor_llm::policy::tutor_directive();
    serde_json::json!({
        "origin": "tutor-llm",
        "tutored": g.tutored,
        "systemLeadsWithDirective": g.system.as_deref().is_some_and(|s| s.starts_with(directive)),
    })
}

#[tauri::command]
pub fn vsix_manifest(b64: String) -> Result<serde_json::Value, String> {
    vsix::manifest_b64(&b64)
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "home": workspace::expand_home("~"),
        "configDir": config_dir(&app).map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "selftest": std::env::var("DXTUTOR_SELFTEST").ok(),
        "openAtStart": std::env::args().nth(1),
        "pairtest": std::env::var("DXTUTOR_PAIRTEST").ok(),
    })
}

/// Used by the smoke test: the UI reports what it saw, the app writes it to a file and quits.
#[tauri::command]
pub fn selftest_report(app: AppHandle, report: serde_json::Value) {
    if let Ok(path) = std::env::var("DXTUTOR_SELFTEST") {
        let _ = std::fs::write(
            path,
            serde_json::to_string_pretty(&report).unwrap_or_default(),
        );
        app.exit(0);
    }
}
