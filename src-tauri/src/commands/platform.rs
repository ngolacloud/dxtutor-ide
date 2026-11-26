//! The work-first Platform activity (r23 F5b, docs/v2/AUDIT-r23.md §4.5 — RF-BK-Q01/Q02, UI-PLAT-09/11/12): «My
//! queue» (items from real state, verified done, handed over), the PR infra review (with the reasoned approval) and
//! local incidents. Thin adapters over `tutor_platform::queue`/`review` and `tutor_board::project::incidents`; who and
//! when come from here; what changes something goes to the audit log first.

use std::collections::HashSet;
use std::path::PathBuf;

use tauri::AppHandle;
use tutor_board::project::incidents::{self, Confidence, Incident, IncidentEvent, QueueEvent};
use tutor_board::project::ProjectError;

fn err(e: ProjectError) -> String {
    e.message
}

fn accepted(app: &AppHandle, root: &str) -> HashSet<String> {
    crate::board::accepted_keys(app, root)
}

struct Records {
    runs: Vec<tutor_board::project::runbooks::RunbookStepRun>,
    incidents: Vec<Incident>,
    deploys: Vec<tutor_board::project::deploys::DeployRecord>,
    events: Vec<QueueEvent>,
    precision: (i64, i64),
}

fn records(app: &AppHandle, root: &str) -> Result<Records, String> {
    let (_, now) = crate::board::who_and_when(root);
    crate::board::with_store(app, root, |s, r| {
        Ok(Records {
            runs: s.runbook_runs(r, None, now - 400 * 86_400_000, now + 1)?,
            incidents: incidents::list(s.conn(), r)?,
            deploys: s.deploys(r, None)?,
            events: incidents::queue_events(s.conn(), r)?,
            precision: incidents::precision(s.conn(), r)?,
        })
    })
    .map_err(err)
}

/// «My queue»: my open items (each with why it is mine, one action, and a verification), what was verified
/// done, what was handed over (Team), and the counts measured in this workspace.
#[tauri::command]
pub async fn queue_items(
    app: AppHandle,
    root: String,
) -> Result<tutor_platform::queue::Queue, String> {
    let rec = records(&app, &root)?;
    let acc = accepted(&app, &root);
    let (_, now) = crate::board::who_and_when(&root);
    tauri::async_runtime::spawn_blocking(move || {
        let rp = PathBuf::from(root.trim());
        let c = tutor_platform::queue::Ctx {
            root: &rp,
            cmd: &crate::shellenv::command,
            has: &crate::shellenv::has,
            runs: &rec.runs,
            incidents: &rec.incidents,
            deploys: &rec.deploys,
            events: &rec.events,
            accepted: &acc,
            precision: rec.precision,
            now,
        };
        tutor_platform::queue::build(&c)
    })
    .await
    .map_err(|e| format!("queue task failed: {e}"))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verified {
    pub done: bool,
    pub proof: Option<String>,
}

/// Checks one item against the real state now; when it holds, the item is recorded done with its proof.
#[tauri::command]
pub async fn queue_verify(
    app: AppHandle,
    root: String,
    id: String,
    title: String,
) -> Result<Verified, String> {
    let rec = records(&app, &root)?;
    let acc = accepted(&app, &root);
    let (_, now) = crate::board::who_and_when(&root);
    let r2 = root.clone();
    let id2 = id.clone();
    let proof = tauri::async_runtime::spawn_blocking(move || {
        let rp = PathBuf::from(r2.trim());
        let c = tutor_platform::queue::Ctx {
            root: &rp,
            cmd: &crate::shellenv::command,
            has: &crate::shellenv::has,
            runs: &rec.runs,
            incidents: &rec.incidents,
            deploys: &rec.deploys,
            events: &rec.events,
            accepted: &acc,
            precision: rec.precision,
            now,
        };
        let me = tutor_platform::queue::me(&c);
        let rbs = tutor_platform::runbook::list(&rp);
        tutor_platform::queue::verify(&c, &me, &rbs, &id2)
    })
    .await
    .map_err(|e| format!("queue task failed: {e}"))?;
    if let Some(p) = &proof {
        let (actor, at) = crate::board::who_and_when(&root);
        crate::board::with_store(&app, &root, |s, r| {
            incidents::queue_event(
                s.conn(),
                r,
                &QueueEvent {
                    item: id.clone(),
                    kind: "done".into(),
                    title: title.clone(),
                    proof: Some(p.clone()),
                    actor,
                    at,
                    ..Default::default()
                },
            )
        })
        .map_err(err)?;
    }
    Ok(Verified {
        done: proof.is_some(),
        proof,
    })
}

/// Hands an item over to someone (recipient and reason required); it shows in Team and leaves my queue.
#[tauri::command]
pub fn queue_handover(
    app: AppHandle,
    root: String,
    id: String,
    title: String,
    recipient: String,
    reason: String,
) -> Result<i64, String> {
    let (actor, at) = crate::board::who_and_when(&root);
    let e = QueueEvent {
        item: id.clone(),
        kind: "handover".into(),
        title: title.clone(),
        recipient: Some(recipient.clone()),
        reason: Some(reason.clone()),
        actor,
        at,
        ..Default::default()
    };
    let n = crate::board::with_store(&app, &root, |s, r| incidents::queue_event(s.conn(), r, &e))
        .map_err(err)?;
    crate::board::audit_backend(
        &app,
        &root,
        "queue",
        "handover",
        &format!("{title} → {}", recipient.trim()),
        Some(&reason),
    )
    .map_err(err)?;
    Ok(n)
}

/// Reviews a pull request: its diff and every «Before you merge» check, each with its source or «not connected».
#[tauri::command]
pub async fn pr_infra_review(
    app: AppHandle,
    root: String,
    pr: u64,
) -> Result<tutor_platform::review::PrReview, String> {
    let rec = records(&app, &root)?;
    let acc = accepted(&app, &root);
    tauri::async_runtime::spawn_blocking(move || {
        let rp = PathBuf::from(root.trim());
        let live = tutor_platform::metrics::live(crate::commands::metrics::store(), &rp);
        let c = tutor_platform::review::Ctx {
            root: &rp,
            cmd: &crate::shellenv::command,
            has: &crate::shellenv::has,
            incidents: &rec.incidents,
            accepted: &acc,
            metrics: live.as_ref().map_err(|u| u.notes.clone()),
        };
        tutor_platform::review::review(&c, pr)
    })
    .await
    .map_err(|e| format!("review task failed: {e}"))?
}

/// Posts the review on the PR (`gh pr review`): approving with a failing check needs a reason (refused here
/// otherwise), which is posted with it; audited first.
#[tauri::command]
pub async fn pr_review_submit(
    app: AppHandle,
    root: String,
    pr: u64,
    decision: String,
    body: String,
    reason: Option<String>,
) -> Result<String, String> {
    let rp = PathBuf::from(root.trim());
    let none = HashSet::new();
    let head = {
        let c = tutor_platform::review::Ctx {
            root: &rp,
            cmd: &crate::shellenv::command,
            has: &crate::shellenv::has,
            incidents: &[],
            accepted: &none,
            metrics: Err("not needed".into()),
        };
        tutor_platform::review::head_now(&c, pr)?
    };
    let args = tutor_platform::review::submit_args(pr, &head, &decision, &body, reason.as_deref())?;
    let shown = format!(
        "gh {}",
        args.iter()
            .map(|a| if a.contains(' ') || a.contains('\n') {
                format!("{a:?}")
            } else {
                a.clone()
            })
            .collect::<Vec<_>>()
            .join(" ")
    );
    crate::board::audit_backend(&app, &root, "review", &decision, &shown, reason.as_deref())
        .map_err(|e| {
            format!(
                "not posted: the audit log could not record it ({})",
                e.message
            )
        })?;
    let out = tauri::async_runtime::spawn_blocking(move || {
        crate::shellenv::command("gh")
            .args(&args)
            .current_dir(&rp)
            .output()
    })
    .await
    .map_err(|e| format!("review task failed: {e}"))?
    .map_err(|e| e.to_string())?;
    let _ = crate::board::audit_backend(
        &app,
        &root,
        "review",
        if out.status.success() {
            "posted"
        } else {
            "post-failed"
        },
        &shown,
        None,
    );
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Opens a local incident (no pager source: a person opens it); I am its commander.
#[tauri::command]
pub fn incident_open(
    app: AppHandle,
    root: String,
    title: String,
    severity: String,
) -> Result<Incident, String> {
    let (actor, at) = crate::board::who_and_when(&root);
    let i = crate::board::with_store(&app, &root, |s, r| {
        incidents::open(s.conn(), r, &title, &severity, &actor, at)
    })
    .map_err(err)?;
    crate::board::audit_backend(
        &app,
        &root,
        "incident",
        "open",
        &format!("{} {} ({})", i.key, i.title, i.severity),
        None,
    )
    .map_err(err)?;
    Ok(i)
}

#[tauri::command]
pub fn incident_list(app: AppHandle, root: String) -> Result<Vec<Incident>, String> {
    crate::board::with_store(&app, &root, |s, r| incidents::list(s.conn(), r)).map_err(err)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentView {
    pub incident: Incident,
    pub events: Vec<IncidentEvent>,
    pub confidence: Confidence,
    /// Co-Dev's precision on the project's incidents: (right, judged)
    pub precision: (i64, i64),
}

/// An incident with its timeline and the confidence its investigation deserves (a metrics source or not).
#[tauri::command]
pub async fn incident_get(app: AppHandle, root: String, id: i64) -> Result<IncidentView, String> {
    let (inc, ev, precision) = crate::board::with_store(&app, &root, |s, r| {
        let (i, e) = incidents::get(s.conn(), r, id)?.ok_or(ProjectError {
            code: "invalid".into(),
            message: "no such incident".into(),
            overridable: false,
        })?;
        Ok((i, e, incidents::precision(s.conn(), r)?))
    })
    .map_err(err)?;
    let r2 = root.clone();
    let has_metrics = tauri::async_runtime::spawn_blocking(move || {
        tutor_platform::metrics::live(crate::commands::metrics::store(), &PathBuf::from(r2.trim()))
            .is_ok()
    })
    .await
    .unwrap_or(false);
    Ok(IncidentView {
        confidence: incidents::confidence(&ev, has_metrics),
        incident: inc,
        events: ev,
        precision,
    })
}

/// Adds evidence, a check run, a check not run (with why), or a note.
#[tauri::command]
pub fn incident_add(
    app: AppHandle,
    root: String,
    id: i64,
    kind: String,
    text: String,
    reason: Option<String>,
) -> Result<(), String> {
    let (actor, at) = crate::board::who_and_when(&root);
    crate::board::with_store(&app, &root, |s, r| {
        incidents::add(s.conn(), r, id, &kind, &text, reason.as_deref(), &actor, at)
    })
    .map_err(err)
}

/// Moves an incident on (mitigated, resolved with a summary), audited.
#[tauri::command]
pub fn incident_status(
    app: AppHandle,
    root: String,
    id: i64,
    status: String,
    note: String,
) -> Result<Incident, String> {
    let (actor, at) = crate::board::who_and_when(&root);
    let i = crate::board::with_store(&app, &root, |s, r| {
        incidents::set_status(s.conn(), r, id, &status, &note, &actor, at)
    })
    .map_err(err)?;
    crate::board::audit_backend(
        &app,
        &root,
        "incident",
        &status,
        &format!("{} {}", i.key, i.title),
        Some(&note),
    )
    .map_err(err)?;
    Ok(i)
}

/// «Was the top cause right?» — measures Co-Dev's precision.
#[tauri::command]
pub fn incident_feedback(app: AppHandle, root: String, id: i64, right: bool) -> Result<(), String> {
    let (actor, at) = crate::board::who_and_when(&root);
    crate::board::with_store(&app, &root, |s, r| {
        incidents::feedback(s.conn(), r, id, right, &actor, at)
    })
    .map_err(err)
}
