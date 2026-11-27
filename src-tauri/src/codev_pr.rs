//! Multi Co-Dev, phase 5 — the integration mode «open a pull request» (the use case, independent of
//! Tauri; `commands::codev_autonomy` is the thin adapter).
//!
//! Instead of the local merge of phase 4, the issue branch is pushed (`tutor_eval::gitwork::publish`:
//! never the default branch, never forced, never to a remote branch dxtutor did not create, exactly the
//! reviewed commit) and a pull request is opened with `gh` (`tutor_eval::gh::create_pr_with`), whose body
//! carries the gate's evidence (`tutor_board::project::autonomy::pr_body`). The same gate as the merge: it
//! is asked again with the facts read right then, and nothing happens unless all three conditions hold for
//! the tips of now. Audited before and with the result; a human approves the exact text in the dialog, or a
//! delegation does (`By::Delegation`, the autonomy) — then a secret-scan finding always stops it. `gh`
//! missing or signed out is said before anything is pushed; dxtutor never logs in for the owner and never
//! merges the pull request (that stays with GitHub and its reviewers). The pull request's state is read
//! back read-only (`gh pr view`).

use std::path::Path;

use serde::Serialize;
use tutor_board::project::autonomy::{self as au, PullRequest};
use tutor_board::project::integration::{Gate, Review};
use tutor_board::project::ProjectStore;
use tutor_eval::gh;
use tutor_eval::gitwork::publish::{self, PushPlan};

use crate::board::{actor, now_ms};
use crate::codev_review::{
    audit_as, facts, gate_of, gate_text, is_running, serial, By, Facts, AUTONOMY_ACTOR,
};

fn store(db: &Path) -> Result<ProjectStore, String> {
    ProjectStore::open(db)
}

/// The pull request panel of an issue (read-only).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrState {
    pub key: String,
    /// `gh` here: installed, signed in (asked only when it matters: the gate is open or a pull
    /// request exists; `None` otherwise)
    pub gh: Option<gh::GhStatus>,
    /// what «Open a pull request» runs — the push, then `gh pr create` — when it can run now
    pub plan: Option<String>,
    /// why it cannot (the gate, the push rules, `gh`)
    pub blocked: Option<String>,
    pub push: Option<PushPlan>,
    /// the newest pull request dxtutor opened for the issue
    pub record: Option<PullRequest>,
    /// that pull request on GitHub now (read-only), or why it could not be read
    pub live: Option<gh::PrLive>,
    pub live_error: Option<String>,
}

/// The pull request's title.
pub fn title_of(key: &str, title: &str) -> String {
    let t: String = title.trim().chars().take(200).collect();
    if t.is_empty() {
        key.to_string()
    } else {
        format!("{key}: {t}")
    }
}

/// The plan of «Open a pull request» for the facts read now: the reviewed review, its push and the
/// whole text the approval shows. `Err`: why not (nothing runs).
fn plan_of(
    db: &Path,
    root: &str,
    key: &str,
    f: &Facts,
    gate: &Gate,
    gh_program: &str,
) -> Result<(Review, PushPlan, String), String> {
    let review = match (&f.review, gate.ok) {
        (Some(r), true) => r.clone(),
        _ => return Err(format!("the gate does not hold: {}", gate_text(gate))),
    };
    let st = store(db)?;
    if let Some(p) = st.pr_latest(root, key).map_err(|e| e.message)? {
        if p.review == review.id && p.head == review.tips.head {
            return Err(format!(
                "pull request #{} is already open for exactly this review: {}",
                p.number, p.pr_url
            ));
        }
    }
    let push = publish::plan(
        Path::new(root),
        &review.tips.target,
        &review.tips.branch,
        &review.tips.head,
        &|url, branch| st.remote_branch_is_ours(root, url, branch).unwrap_or(false),
    )?;
    let gh_cmd = gh::create_pr_command(
        gh_program,
        &review.tips.target,
        &review.tips.branch,
        &title_of(key, &f.data.title),
    );
    let text = format!("{}\n{gh_cmd}", push.command);
    Ok((review, push, text))
}

fn gh_ready(s: &gh::GhStatus) -> Result<(), String> {
    if !s.installed {
        return Err(s.notes.clone());
    }
    if !s.signed_in {
        return Err(
            "gh is not signed in: run `gh auth login` yourself (dxtutor never logs in for you)"
                .into(),
        );
    }
    Ok(())
}

/// The issue's pull request panel: what «Open a pull request» would run (or why not), `gh` here, and
/// the pull request already opened, as GitHub has it now. Read-only (it asks the remote which
/// branches it has, and `gh` for the pull request).
pub fn state(db: &Path, root: &str, key: &str, gh_program: &str) -> Result<PrState, String> {
    let f = facts(db, root, key)?;
    let gate = gate_of(&f, is_running(root, key));
    let record = store(db)?.pr_latest(root, key).map_err(|e| e.message)?;
    let status = (gate.ok || record.is_some()).then(|| gh::status_with(gh_program));
    let (plan, blocked, push) = match plan_of(db, root, key, &f, &gate, gh_program) {
        Ok((_, push, text)) => match status.as_ref().map(gh_ready) {
            Some(Err(e)) => (None, Some(e), Some(push)),
            _ => (Some(text), None, Some(push)),
        },
        Err(e) => (None, Some(e), None),
    };
    let (live, live_error) = match (&record, &status) {
        (Some(p), Some(s)) if s.installed && s.signed_in => {
            match gh::pr_view_with(gh_program, Path::new(root), p.number) {
                Ok(l) => (Some(l), None),
                Err(e) => (None, Some(e)),
            }
        }
        (Some(_), Some(s)) => (None, gh_ready(s).err()),
        _ => (None, None),
    };
    Ok(PrState {
        key: key.to_string(),
        gh: status,
        plan,
        blocked,
        push,
        record,
        live,
        live_error,
    })
}

/// What opening the pull request did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub key: String,
    pub number: u64,
    pub url: String,
    pub remote: String,
    pub branch: String,
    /// the commit pushed
    pub head: String,
    /// the push created the remote branch
    pub created_branch: bool,
}

/// Pushes the issue branch and opens its pull request with the approved `command` (as
/// [`PrState::plan`] showed it), as `by` decided it. The gate is asked again; `gh` must be installed
/// and signed in before anything is pushed; the secret scan of what the branch brings runs first (a
/// delegation never takes a human's override). Audited before (a refusal to record stops it) and
/// with the result.
pub fn open_as(
    db: &Path,
    root: &str,
    key: &str,
    command: &str,
    by: By,
    gh_program: &str,
) -> Result<Opened, String> {
    let _serial = serial().lock().unwrap_or_else(|e| e.into_inner());
    let f = facts(db, root, key)?;
    let gate = gate_of(&f, is_running(root, key));
    let (review, push, text) = plan_of(db, root, key, &f, &gate, gh_program)?;
    if text != command.trim() {
        return Err(format!(
            "the pull request changed since the approval: it is now\n{text}"
        ));
    }
    // before anything leaves the machine: gh must be able to open it
    gh_ready(&gh::status_with(gh_program))?;
    let scope = format!(
        "pull request {key} · {} → {} on {} ({})",
        push.branch, review.tips.target, push.remote, push.head
    );
    audit_as(
        db,
        root,
        &by,
        key,
        "review.pr",
        command,
        &scope,
        "sent",
        None,
    )
    .map_err(|e| format!("not done: the audit log did not record it ({e})"))?;
    let fail = |e: String| {
        let _ = audit_as(
            db,
            root,
            &by,
            key,
            "review.pr",
            command,
            &scope,
            "failed",
            Some(tutor_protect::scan::summary(&e)),
        );
        e
    };
    let dir = Path::new(root);
    let scan_scope = tutor_protect::scan::Scope::Between(&review.tips.base, &review.candidate);
    match &by {
        By::Human { .. } => tutor_protect::scan::guard_commit_as(dir, dir, &scan_scope).map(|_| ()),
        By::Delegation { .. } => tutor_protect::scan::guard_strict(dir, &scan_scope),
    }
    .map_err(fail)?;
    let who = match &by {
        By::Human { .. } => actor(root),
        By::Delegation { id, granted_by, .. } => {
            format!("{AUTONOMY_ACTOR} — delegação #{id} de {granted_by}")
        }
    };
    publish::push(dir, &push, &push.command).map_err(fail)?;
    let mut notes = vec![];
    if !push.exists {
        if let Err(e) = store(db).and_then(|mut s| {
            s.remote_branch_created(root, &push.url, &push.branch, &who, now_ms())
                .map_err(|e| e.message)
        }) {
            // not remembered: a later push to it is refused (safe), and the human is told
            notes.push(format!("the remote branch was not remembered ({e})"));
        }
    }
    let delegation = match &by {
        By::Delegation { id, .. } => store(db)?.delegation(root, *id).map_err(|e| e.message)?,
        By::Human { .. } => None,
    };
    let body = au::pr_body(&au::BodyInput {
        key,
        title: &f.data.title,
        review: &review,
        functional: f.data.functional.as_ref(),
        delegation: delegation.as_ref(),
        opened_by: &who,
    });
    let redactor = tutor_agent::redact::Redactor::for_root(dir);
    let created = gh::create_pr_with(
        gh_program,
        dir,
        &review.tips.target,
        &push.branch,
        &redactor.mask(&title_of(key, &f.data.title)),
        &redactor.mask(&body),
    )
    .map_err(|e| {
        fail(format!(
            "{} was pushed to {}, but the pull request was not opened: {e}",
            push.branch, push.remote
        ))
    })?;
    let rec = PullRequest {
        id: 0,
        key: key.to_string(),
        review: review.id,
        remote: push.remote.clone(),
        url: push.url.clone(),
        branch: push.branch.clone(),
        head: push.head.clone(),
        base: review.tips.base.clone(),
        target: review.tips.target.clone(),
        number: created.number,
        pr_url: created.url.clone(),
        actor: who.clone(),
        delegation: delegation.as_ref().map(|d| d.id),
        at: now_ms(),
    };
    if let Err(e) = store(db).and_then(|mut s| s.pr_record(root, &rec).map_err(|e| e.message)) {
        notes.push(format!("the Project did not record it ({e})"));
    }
    let mut reason = format!("#{} {}", created.number, created.url);
    if !notes.is_empty() {
        reason.push_str(" — ");
        reason.push_str(&notes.join("; "));
    }
    let _ = audit_as(
        db,
        root,
        &by,
        key,
        "review.pr",
        command,
        &scope,
        "ok",
        Some(reason),
    );
    Ok(Opened {
        key: key.to_string(),
        number: created.number,
        url: created.url,
        remote: push.remote,
        branch: push.branch,
        head: push.head,
        created_branch: !push.exists,
    })
}
