//! Runbooks as code and the data sources (r23 F5a, docs/v2/AUDIT-r23.md §4.5 — RF-BK-R01–R03, Q03): thin
//! adapters over `tutor_platform::runbook`/`policy`/`sources`. The rule lives there: a check runs only when
//! read-only; an action only with an approval (audited here, first), with Vault's environment for that
//! step only; a decision is recorded, never run. Every step that runs is kept (project base).

use std::path::PathBuf;
use std::time::Duration;

use tauri::AppHandle;
use tutor_board::project::runbooks::RunbookStepRun;
use tutor_platform::runbook::{self, Kind};

fn kind(k: Kind) -> &'static str {
    match k {
        Kind::Check => "check",
        Kind::Action => "action",
        Kind::Decision => "decision",
    }
}

/// The project's runbooks (`runbooks/*.md`), each with its steps and why a check could not run.
#[tauri::command]
pub fn runbook_list(root: String) -> Vec<runbook::Runbook> {
    runbook::list(&PathBuf::from(root.trim()))
}

/// One runbook (only under `runbooks/`).
#[tauri::command]
pub fn runbook_parse(root: String, path: String) -> Result<runbook::Runbook, String> {
    runbook::load(&PathBuf::from(root.trim()), &path)
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StepApproval {
    pub reason: String,
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StepVault {
    pub addr: String,
    #[serde(default)]
    pub namespace: Option<String>,
}

/// Runs step `n` of a runbook (in run `run_id`): a check only when read-only (`not_read_only` otherwise);
/// an action only with `approval` — audited first — and Vault's environment (`vault`) for this step only.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn runbook_step(
    app: AppHandle,
    root: String,
    path: String,
    n: u32,
    run_id: String,
    approval: Option<StepApproval>,
    vault: Option<StepVault>,
) -> Result<RunbookStepRun, String> {
    let root_path = PathBuf::from(root.trim());
    let rb = runbook::load(&root_path, &path)?;
    let step = rb
        .steps
        .iter()
        .find(|s| s.n == n)
        .cloned()
        .ok_or_else(|| format!("{path} has no step {n}"))?;
    runbook::may_run(&step, approval.is_some())?;
    let mut env: Vec<(String, String)> = vec![];
    if step.kind == Kind::Action {
        let a = approval.as_ref().expect("checked by may_run");
        if a.reason.trim().chars().count() < 3 {
            return Err("an action needs a reason".into());
        }
        crate::board::audit_backend(
            &app,
            &root,
            "runbook",
            "action",
            &format!("{path} step {n} «{}»: {}", step.title, step.command),
            Some(&a.reason),
        )
        .map_err(|e| format!("not run: the audit log could not record it ({})", e.message))?;
        if let Some(v) = &vault {
            let (_, venv) =
                crate::commands::vault::terminal_env(&v.addr, v.namespace.as_deref(), None)?;
            env.extend(venv);
        }
    }
    let s2 = step.clone();
    let rp = root_path.clone();
    let out = tauri::async_runtime::spawn_blocking(move || {
        runbook::run(
            &crate::shellenv::command,
            &rp,
            &s2,
            &env,
            Duration::from_secs(600),
        )
    })
    .await
    .map_err(|e| format!("runbook task failed: {e}"))?;
    let rec = RunbookStepRun {
        run_id: run_id.chars().take(64).collect(),
        path: path.clone(),
        runbook: rb.title.clone(),
        n,
        title: step.title.clone(),
        kind: kind(step.kind).into(),
        command: step.command.clone(),
        exit_code: Some(out.exit_code),
        output: out.output,
        expect: step.expect.clone(),
        matched: out.matched,
        note: approval.map(|a| a.reason),
        ms: out.ms as i64,
        ..Default::default()
    };
    crate::board::record_runbook_step(&app, &root, rec).map_err(|e| e.message)
}

/// Records a decision step: what the person decided and why (nothing runs).
#[tauri::command]
pub fn runbook_decide(
    app: AppHandle,
    root: String,
    path: String,
    n: u32,
    run_id: String,
    note: String,
) -> Result<RunbookStepRun, String> {
    let rb = runbook::load(&PathBuf::from(root.trim()), &path)?;
    let step = rb
        .steps
        .iter()
        .find(|s| s.n == n)
        .cloned()
        .ok_or_else(|| format!("{path} has no step {n}"))?;
    if step.kind != Kind::Decision {
        return Err(format!("step {n} is a {}, not a decision", kind(step.kind)));
    }
    if note.trim().chars().count() < 3 {
        return Err("a decision needs the words of what was decided".into());
    }
    crate::board::audit_backend(
        &app,
        &root,
        "runbook",
        "decision",
        &format!("{path} step {n} «{}»", step.title),
        Some(note.trim()),
    )
    .map_err(|e| e.message)?;
    let rec = RunbookStepRun {
        run_id: run_id.chars().take(64).collect(),
        path,
        runbook: rb.title,
        n,
        title: step.title,
        kind: "decision".into(),
        expect: step.expect,
        note: Some(note.trim().into()),
        ..Default::default()
    };
    crate::board::record_runbook_step(&app, &root, rec).map_err(|e| e.message)
}

/// The data sources (CI/CD, cost, metrics and logs, cloud inventory): «not connected» unless one is.
#[tauri::command]
pub async fn sources_status(root: String) -> Result<Vec<tutor_platform::sources::Source>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tutor_platform::sources::status(
            &crate::shellenv::command,
            &crate::shellenv::has,
            &PathBuf::from(root.trim()),
        )
    })
    .await
    .map_err(|e| format!("sources task failed: {e}"))
}
