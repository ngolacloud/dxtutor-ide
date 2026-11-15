//! dxtutor IDE desktop backend. The commands are thin; the logic lives in the modules,
//! each with its own tests (`cargo test`).

mod keys;
mod llm;
mod pair;
mod procs;
mod vsix;
mod workspace;

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_config_dir().map_err(|e| e.to_string())
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.to_string_lossy().to_string())
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
async fn load_workspace(root: String) -> Result<workspace::Loaded, String> {
    tauri::async_runtime::spawn_blocking(move || workspace::load(std::path::Path::new(&root), 4000, 768 * 1024).map_err(|e| format!("{root}: {e}")))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn write_file(root: String, rel: String, content: String) -> Result<(), String> {
    workspace::write(std::path::Path::new(&root), &rel, &content)
}

#[tauri::command]
fn delete_file(root: String, rel: String) -> Result<(), String> {
    workspace::delete(std::path::Path::new(&root), &rel)
}

#[tauri::command]
fn expand_path(path: String) -> String {
    workspace::expand_home(&path)
}

#[tauri::command]
async fn exec(program: String, args: Vec<String>, cwd: Option<String>, env: Option<HashMap<String, String>>, stdin: Option<String>, timeout_ms: Option<u64>) -> Result<procs::ExecOut, String> {
    tauri::async_runtime::spawn_blocking(move || {
        procs::exec(&program, &args, cwd.as_deref(), &env.unwrap_or_default(), stdin.as_deref(), Duration::from_millis(timeout_ms.unwrap_or(120_000)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn run_shell(app: AppHandle, procs_state: State<'_, procs::Procs>, id: String, line: String, cwd: Option<String>, env: Option<HashMap<String, String>>) -> Result<(), String> {
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
fn kill_shell(procs_state: State<'_, procs::Procs>, id: String) -> bool {
    procs::kill(&procs_state, &id)
}

#[tauri::command]
fn keys_status(app: AppHandle) -> Result<HashMap<String, bool>, String> {
    let dir = config_dir(&app)?;
    Ok(["claude", "codex", "gemini", "ollama"].iter().map(|p| (p.to_string(), keys::resolve(&dir, p).is_some())).collect())
}

#[tauri::command]
fn save_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    keys::save(&config_dir(&app)?, &provider, &key)
}

#[tauri::command]
async fn llm_chat(app: AppHandle, req: llm::ChatReq) -> Result<llm::ChatResp, String> {
    let key = keys::resolve(&config_dir(&app)?, &req.provider);
    llm::chat(req, key).await
}

#[tauri::command]
fn vsix_manifest(b64: String) -> Result<serde_json::Value, String> {
    vsix::manifest_b64(&b64)
}

#[tauri::command]
fn app_info(app: AppHandle) -> serde_json::Value {
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
fn selftest_report(app: AppHandle, report: serde_json::Value) {
    if let Ok(path) = std::env::var("DXTUTOR_SELFTEST") {
        let _ = std::fs::write(path, serde_json::to_string_pretty(&report).unwrap_or_default());
        app.exit(0);
    }
}

fn pair_events(app: &AppHandle) -> pair::Events {
    let (a, b) = (app.clone(), app.clone());
    pair::Events {
        status: std::sync::Arc::new(move |v| {
            let _ = a.emit("pair-status", v);
        }),
        msg: std::sync::Arc::new(move |m| {
            let _ = b.emit("pair-msg", m);
        }),
    }
}

/// PairCode: start hosting and return the token for the other developer.
#[tauri::command]
async fn pair_host(app: AppHandle, state: State<'_, pair::Pair>, name: String, port: Option<u16>) -> Result<String, String> {
    let p = state.inner().clone();
    p.host(&name, port, pair_events(&app)).await
}

/// PairCode: join with a token; `via` ("host:port") overrides the addresses inside it.
#[tauri::command]
async fn pair_join(app: AppHandle, state: State<'_, pair::Pair>, token: String, via: Option<String>) -> Result<String, String> {
    let p = state.inner().clone();
    p.join(&token, via, pair_events(&app)).await
}

#[tauri::command]
fn pair_send(state: State<'_, pair::Pair>, msg: String) -> Result<(), String> {
    state.send(&msg)
}

#[tauri::command]
fn pair_stop(app: AppHandle, state: State<'_, pair::Pair>) {
    state.stop();
    let _ = app.emit("pair-status", serde_json::json!({"state": "idle"}));
}

/// Camera and microphone for the PairCode call: WebKitGTK has them off by default.
#[cfg(target_os = "linux")]
fn enable_media(app: &tauri::App) {
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.with_webview(|wv| {
            let v = wv.inner();
            if let Some(s) = WebViewExt::settings(&v) {
                s.set_enable_media_stream(true);
                s.set_enable_webrtc(true);
                s.set_enable_mediasource(true);
                // the call starts when the pair joins, not on a click of ours
                s.set_media_playback_requires_user_gesture(false);
            }
            v.connect_permission_request(|_, req| {
                if req.is::<UserMediaPermissionRequest>() {
                    req.allow();
                    true
                } else {
                    false
                }
            });
        });
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(procs::Procs::default())
        .manage(pair::Pair::default())
        .setup(|_app| {
            #[cfg(target_os = "linux")]
            enable_media(_app);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            load_workspace,
            write_file,
            delete_file,
            expand_path,
            exec,
            run_shell,
            kill_shell,
            keys_status,
            save_key,
            llm_chat,
            vsix_manifest,
            app_info,
            selftest_report,
            pair_host,
            pair_join,
            pair_send,
            pair_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running dxtutor IDE");
}
