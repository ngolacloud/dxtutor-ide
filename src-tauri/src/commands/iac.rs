//! The IaC pipeline, the reviewed plan's apply command and the state (r23 F4b, docs/v2/AUDIT-r23.md
//! §4.4 — P01/P02/P05): thin adapters over `tutor_eval::iac`, in a blocking worker, with the tools
//! resolved in the login shell's environment. The rules (a failed stage blocks the apply, the apply
//! applies the reviewed file) live in that module; the accepted risks come from the project base.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Emitter, Manager};

fn plans_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|d| d.join("iac-plans"))
        .map_err(|e| format!("no data folder: {e}"))
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StageEvent {
    root: String,
    dir: String,
    stage: tutor_eval::iac::Stage,
}

/// Runs the pipeline in a folder of the project (`target`: a targeted plan, to revert a drift),
/// emitting `iac://stage` as each stage starts and ends. The plan is kept for `iac_apply_command`.
#[tauri::command]
pub async fn iac_pipeline_run(
    app: AppHandle,
    root: String,
    dir: String,
    target: Option<String>,
) -> Result<tutor_eval::iac::PipelineRun, String> {
    let plans = plans_dir(&app)?;
    let accepted = crate::board::accepted_keys(&app, &root);
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = PathBuf::from(root.trim());
        let ctx = tutor_eval::iac::Ctx {
            root: &root_path,
            dir: &dir,
            target: target.as_deref().map(str::trim).filter(|t| !t.is_empty()),
            plans: &plans,
            accepted: &accepted,
            cmd: &crate::shellenv::command,
            has: &crate::shellenv::has,
        };
        tutor_eval::iac::run(&ctx, &mut |s| {
            let _ = app.emit(
                "iac://stage",
                StageEvent {
                    root: root.clone(),
                    dir: dir.clone(),
                    stage: s.clone(),
                },
            );
        })
    })
    .await
    .map_err(|e| format!("iac task failed: {e}"))
}

/// The exact command that applies a reviewed plan — refused (here, not in the UI) when its run
/// was blocked, the file is not the reviewed one, or the configuration changed since.
#[tauri::command]
pub async fn iac_apply_command(
    app: AppHandle,
    root: String,
    dir: String,
    plan_id: String,
) -> Result<tutor_eval::iac::ApplyInfo, String> {
    tutor_eval::iac::apply_command(Path::new(root.trim()), &dir, &plan_id, &plans_dir(&app)?)
}

/// The state of a folder: addresses and ids, backend, serial, lock and backup. No values.
#[tauri::command]
pub async fn iac_state(root: String, dir: String) -> Result<tutor_eval::iac::IacState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = PathBuf::from(root.trim());
        let none = std::collections::HashSet::new();
        let plans = std::env::temp_dir();
        tutor_eval::iac::state(&tutor_eval::iac::Ctx {
            root: &root_path,
            dir: &dir,
            target: None,
            plans: &plans,
            accepted: &none,
            cmd: &crate::shellenv::command,
            has: &crate::shellenv::has,
        })
    })
    .await
    .map_err(|e| format!("iac task failed: {e}"))
}
