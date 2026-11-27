//! Multi Co-Dev, phase 5 — delegated autonomy (the use case, independent of Tauri;
//! `commands::codev_autonomy` is the thin adapter, and the app installs the [`Runtime`] at start).
//!
//! **The owner's rules, enforced here.** The reviewer never acts on its own unless a human delegated
//! it ([`tutor_board::project::autonomy`]: an issue or a sprint, bounded actions, an expiry of at most
//! 7 days, revocable; who may delegate is [`crate::roles::delegation_check`], asked when it is granted
//! AND again, for the person who granted it, before every use). Autonomy never skips the integration
//! gate: it integrates (or opens the pull request) only when [`crate::codev_review`]'s gate holds for
//! the tips of that moment — the mandatory checks on the exact candidate, the reviewer's `met` with
//! evidence, the functional approval for the criteria of now — and the functional approval is a human
//! act it cannot perform.
//!
//! **The loop.** Four triggers, each acted on at most once (a failure never retries):
//! - `session_finished` — the issue's Co-Dev session finished it (`finish_issue`, the issue is in
//!   Review): with `review` delegated, the backend requests the review with the same plan a human
//!   would approve, and runs it;
//! - `committed` — the human committed the session's work in its worktree, after the autonomy stopped
//!   only because there was nothing committed to review;
//! - `review_done` — a review ended with every criterion met;
//! - `functional_approved` — the human recorded the functional approval;
//!
//! the last two, with `integrate` (or `pr`) delegated, integrate by the human's path
//! ([`crate::codev_review::integrate_as`]: undo snapshot, the strict secret scan — a finding stops it and
//! the human integrates by hand —, audit before and with the result, the Project's move rules without
//! overrides) or open the pull request ([`crate::codev_pr::open_as`]). Before every action the backend
//! reads the kill switch, checks the grantor's role and the rate limit
//! ([`au::MAX_ACTIONS_PER_HOUR`]). Every step, taken or refused, is an event with the audit rows it
//! wrote, and the interface is told (`codev-autonomy://event`). No delegation: nothing happens and
//! nothing is recorded — exactly phase 4.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use serde_json::{json, Value};
use tutor_agent::context::ReplyLang;
use tutor_board::project::autonomy::{self as au, Delegation, Event, Grant, Mode, Switch};
use tutor_board::project::integration::Gate;
use tutor_board::project::{AuditEntry, ProjectStore};

use crate::board::{actor, ide_audit_entry, now_ms, IdeAudit};
use crate::codev_review::{self as rv, By, Emit, MakeReviewer};

fn store(db: &Path) -> Result<ProjectStore, String> {
    ProjectStore::open(db)
}

/* ───── the runtime the app installs ───── */

/// Builds the reviewer of an autonomous review: the delegation's provider and model.
pub type ReviewerFor = Arc<dyn Fn(&str, Option<&str>) -> MakeReviewer + Send + Sync>;

/// What the backend needs to act on its own (installed once by the app; the tests build their own).
#[derive(Clone)]
pub struct Runtime {
    pub db: PathBuf,
    /// the temporary integration worktrees (phase 4)
    pub ibase: PathBuf,
    /// the Co-Dev worktrees (phase 3)
    pub wbase: PathBuf,
    /// the `gh` program
    pub gh: String,
    /// the environment the checks run with
    pub env: Option<HashMap<String, String>>,
    pub reviewer: ReviewerFor,
    /// a review's steps (`codev-review://event`)
    pub review_emit: Emit,
    /// the autonomy's steps (`codev-autonomy://event`)
    pub notify: Arc<dyn Fn(Value) + Send + Sync>,
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Installs the app's runtime (once; later calls are ignored).
pub fn install(rt: Runtime) {
    let _ = RUNTIME.set(rt);
}

fn runtime() -> Option<&'static Runtime> {
    RUNTIME.get()
}

/// The reviews the autonomy started and that run now (a pause cancels them).
fn autonomous() -> &'static Mutex<HashSet<(String, String)>> {
    static A: OnceLock<Mutex<HashSet<(String, String)>>> = OnceLock::new();
    A.get_or_init(Mutex::default)
}

/* ───── who acts ───── */

/// The person at the keyboard: the project's git `user.name` (the Project's actor) and `user.email`.
#[derive(Debug, Clone, PartialEq)]
pub struct Identity {
    pub name: String,
    pub email: String,
}

impl Identity {
    pub fn of(root: &str) -> Self {
        let email = std::process::Command::new("git")
            .args(["config", "user.email"])
            .current_dir(root)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default();
        Identity {
            name: actor(root),
            email,
        }
    }
}

/// The roles of a person by the project's `team.json` (`None`: it defines no people).
fn roles_of(root: &str, name: &str, email: &str) -> Option<Vec<String>> {
    let people = crate::roles::people(Path::new(root));
    (!people.is_empty()).then(|| crate::roles::roles_of(&people, email, name))
}

fn audit_row(
    root: &str,
    who: &str,
    action: &str,
    command: &str,
    scope: &str,
    key: Option<&str>,
) -> Result<AuditEntry, String> {
    let redactor = tutor_agent::redact::Redactor::for_root(Path::new(root));
    let mut e = ide_audit_entry(
        &IdeAudit {
            feature: "codev".into(),
            action: action.into(),
            command: command.into(),
            scope: Some(scope.into()),
            approved: true,
            reason: None,
            outcome: Some("ok".into()),
            decided_at: None,
        },
        who,
        now_ms(),
        &redactor,
    )
    .map_err(|e| e.message)?;
    e.issue_key = key.map(str::to_string);
    Ok(e)
}

/* ───── delegations, the kill switch, the overview ───── */

/// Delegates `g` as the person `who` (their role is checked here: an issue's assignee, or a PO / Tech
/// Lead by `team.json`; a sprint, a PO / Tech Lead). Audited in the same transaction.
pub fn grant(db: &Path, root: &str, g: &Grant, who: &Identity) -> Result<Delegation, String> {
    let g = au::validate_grant(g).map_err(|e| e.message)?;
    let st = store(db)?;
    let assignee = if g.scope == "issue" {
        st.issue_assignment(root, &g.target)
            .map_err(|e| e.message)?
            .ok_or_else(|| format!("a issue {} não existe", g.target))?
            .0
    } else {
        String::new()
    };
    crate::roles::delegation_check(
        roles_of(root, &who.name, &who.email).as_deref(),
        &g.scope,
        &assignee,
        &[who.name.as_str(), who.email.as_str()],
    )?;
    let command = format!(
        "delegate {} on {} {} for {} h",
        g.actions.join(", "),
        g.scope,
        g.target,
        g.hours
    );
    let scope = format!("autonomy · {} {}", g.scope, g.target);
    let key = (g.scope == "issue").then_some(g.target.as_str());
    let audit = audit_row(root, &who.name, "autonomy.grant", &command, &scope, key)?;
    let mut st = st;
    st.delegation_grant(root, &g, &who.name, &who.email, now_ms(), audit)
        .map(|(d, _)| d)
        .map_err(|e| e.message)
}

/// Revokes delegation `id`. Anyone may (it only takes power back); audited in the same transaction.
pub fn revoke(
    db: &Path,
    root: &str,
    id: i64,
    reason: &str,
    who: &Identity,
) -> Result<Delegation, String> {
    let mut st = store(db)?;
    let d = st
        .delegation(root, id)
        .map_err(|e| e.message)?
        .ok_or_else(|| format!("a delegação #{id} não existe"))?;
    let scope = format!("autonomy · {} {}", d.scope, d.target);
    let key = (d.scope == "issue").then_some(d.target.as_str());
    let audit = audit_row(
        root,
        &who.name,
        "autonomy.revoke",
        &format!("revoke delegation #{id}"),
        &scope,
        key,
    )?;
    st.delegation_revoke(root, id, &who.name, reason, now_ms(), audit)
        .map(|(d, _)| d)
        .map_err(|e| e.message)
}

/// Pauses (or resumes) every autonomous action of the app — the kill switch the backend reads before
/// each one. Pausing also stops the autonomous reviews running now. Anyone may; audited.
pub fn set_paused(
    db: &Path,
    root: &str,
    paused: bool,
    reason: &str,
    who: &Identity,
) -> Result<Switch, String> {
    let action = if paused {
        "autonomy.pause"
    } else {
        "autonomy.resume"
    };
    let audit = audit_row(
        root,
        &who.name,
        action,
        if paused {
            "pause autonomy"
        } else {
            "resume autonomy"
        },
        "autonomy · every project",
        None,
    )?;
    let (sw, _) = store(db)?
        .set_autonomy_paused(root, paused, &who.name, reason, now_ms(), audit)
        .map_err(|e| e.message)?;
    if paused {
        let running: Vec<(String, String)> = autonomous()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .cloned()
            .collect();
        for (r, k) in running {
            rv::cancel(&r, &k);
        }
    }
    Ok(sw)
}

/// What the autonomy panel shows.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub switch: Switch,
    /// the issue's delegations (its own and its sprint's), or the folder's
    pub delegations: Vec<Delegation>,
    /// the newest steps
    pub events: Vec<Event>,
    /// autonomous actions in the last hour, and the most allowed
    pub used: u32,
    pub limit: u32,
    pub now: i64,
    /// the issue's sprint (to delegate it)
    pub sprint: Option<String>,
    /// how the issue integrates when its gate opens: `manual`, `integrate`, `pr`, `ambiguous`
    pub mode: Option<String>,
}

/// The autonomy of issue `key` (or of the folder): the switch, the delegations, the log. Read-only.
pub fn overview(db: &Path, root: &str, key: Option<&str>) -> Result<Overview, String> {
    let st = store(db)?;
    let now = now_ms();
    let (delegations, sprint) = match key {
        Some(k) => (
            st.delegations_for(root, k).map_err(|e| e.message)?,
            st.issue_assignment(root, k)
                .map_err(|e| e.message)?
                .and_then(|(_, s)| s),
        ),
        None => (st.delegations(root).map_err(|e| e.message)?, None),
    };
    let mode = key.map(|_| {
        match au::mode(&delegations, now) {
            Mode::Manual => "manual",
            Mode::Integrate(_) => "integrate",
            Mode::Pr(_) => "pr",
            Mode::Ambiguous => "ambiguous",
        }
        .to_string()
    });
    Ok(Overview {
        switch: st.autonomy_switch().map_err(|e| e.message)?,
        events: st.autonomy_events(root, key, 50).map_err(|e| e.message)?,
        used: st
            .autonomy_actions_since(root, now - au::HOUR_MS)
            .map_err(|e| e.message)?,
        limit: au::MAX_ACTIONS_PER_HOUR,
        delegations,
        now,
        sprint,
        mode,
    })
}

/* ───── the loop ───── */

/// What started an autonomous step.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trigger {
    SessionFinished,
    Committed,
    ReviewDone,
    FunctionalApproved,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Trigger::SessionFinished => "session_finished",
            Trigger::Committed => "committed",
            Trigger::ReviewDone => "review_done",
            Trigger::FunctionalApproved => "functional_approved",
        }
    }
}

/// The step the autonomy took (`None`: nothing is delegated — nothing happened, nothing recorded).
pub type Step = Option<Event>;

struct Ctx<'a> {
    rt: &'a Runtime,
    root: &'a str,
    key: &'a str,
    action: &'static str,
    trigger: Trigger,
}

impl Ctx<'_> {
    /// Records the step and tells the interface (`extra`: what it produced — the integration, the pull
    /// request).
    #[allow(clippy::too_many_arguments)]
    fn record(
        &self,
        d: Option<&Delegation>,
        outcome: &str,
        code: &str,
        detail: String,
        review: Option<i64>,
        audit: Vec<i64>,
        extra: Value,
    ) -> Step {
        let mut e = Event {
            id: 0,
            key: self.key.to_string(),
            delegation: d.map(|d| d.id),
            action: self.action.to_string(),
            trigger: self.trigger.as_str().to_string(),
            outcome: outcome.to_string(),
            code: code.to_string(),
            detail: tutor_protect::scan::summary(&detail),
            review,
            audit,
            at: now_ms(),
        };
        if let Ok(id) = store(&self.rt.db).and_then(|mut s| {
            s.autonomy_event(self.root, &e).map_err(|e| e.message)
        }) {
            e.id = id;
        }
        let mut v = json!({"root": self.root, "event": e});
        if let (Some(o), Some(x)) = (v.as_object_mut(), extra.as_object()) {
            for (k, val) in x {
                o.insert(k.clone(), val.clone());
            }
        }
        (self.rt.notify)(v);
        Some(e)
    }

    fn stop(&self, d: Option<&Delegation>, code: &str, detail: impl Into<String>) -> Step {
        self.record(d, "stopped", code, detail.into(), None, vec![], Value::Null)
    }

    /// Before every action: the kill switch, the grantor's role (asked again, for the person who
    /// granted it, with the issue as it is now) and the rate limit. `Err`: the step that stopped it.
    fn prelude(&self, st: &ProjectStore, d: &Delegation) -> Result<(), Step> {
        let sw = st
            .autonomy_switch()
            .map_err(|e| self.stop(Some(d), "error", e.message))?;
        if sw.paused {
            return Err(self.stop(
                Some(d),
                "paused",
                format!(
                    "autonomy is paused{}",
                    sw.by.map(|b| format!(" by {b}")).unwrap_or_default()
                ),
            ));
        }
        let assignee = st
            .issue_assignment(self.root, self.key)
            .map_err(|e| self.stop(Some(d), "error", e.message))?
            .map(|(a, _)| a)
            .unwrap_or_default();
        if let Err(e) = crate::roles::delegation_check(
            roles_of(self.root, &d.granted_by, &d.granted_email).as_deref(),
            &d.scope,
            &assignee,
            &[d.granted_by.as_str(), d.granted_email.as_str()],
        ) {
            return Err(self.stop(Some(d), "grantor_role", e));
        }
        let used = st
            .autonomy_actions_since(self.root, now_ms() - au::HOUR_MS)
            .map_err(|e| self.stop(Some(d), "error", e.message))?;
        if used >= au::MAX_ACTIONS_PER_HOUR {
            return Err(self.stop(
                Some(d),
                "rate_limited",
                format!(
                    "{used} autonomous actions in the last hour (at most {})",
                    au::MAX_ACTIONS_PER_HOUR
                ),
            ));
        }
        Ok(())
    }
}

fn by_of(d: &Delegation) -> (By, Arc<Mutex<Vec<i64>>>) {
    let sink = Arc::new(Mutex::new(vec![]));
    (
        By::Delegation {
            id: d.id,
            granted_by: d.granted_by.clone(),
            audit: sink.clone(),
        },
        sink,
    )
}

fn taken(sink: &Arc<Mutex<Vec<i64>>>) -> Vec<i64> {
    sink.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// The code of a closed gate, for the log: what a human has to do next.
fn gate_code(g: &Gate) -> &'static str {
    let stale = |c: &str| c.starts_with("stale") || c == "candidate" || c == "tips";
    if stale(&g.checks.code) || stale(&g.reviewer.code) {
        return "stale";
    }
    if g.checks.code == "conflict" {
        return "conflict";
    }
    if !g.checks.ok {
        return "checks";
    }
    match g.reviewer.code.as_str() {
        "not_met" => return "not_met",
        "unclear" => return "unclear",
        _ => {}
    }
    if !g.reviewer.ok {
        return "reviewer";
    }
    if !g.functional.ok {
        return "awaiting_functional";
    }
    "gate_closed"
}

/// With `review` delegated: requests the review of issue `key` (the plan a human would approve) and
/// runs it here; when every criterion is met, the integration step follows. Synchronous.
pub fn review_now(rt: &Runtime, root: &str, key: &str, trigger: Trigger) -> Step {
    let cx = Ctx {
        rt,
        root,
        key,
        action: "review",
        trigger,
    };
    let st = store(&rt.db).ok()?;
    let now = now_ms();
    let ds = st.delegations_for(root, key).ok()?;
    let d = au::effective(&ds, "review", now)?.clone();
    if let Err(step) = cx.prelude(&st, &d) {
        return step;
    }
    let state = match st.load(root, now) {
        Ok(p) => p
            .issues
            .iter()
            .find(|i| i.key == key)
            .map(|i| i.state.clone()),
        Err(e) => return cx.stop(Some(&d), "error", e.message),
    };
    if !matches!(state.as_deref(), Some("review" | "accept")) {
        return cx.stop(
            Some(&d),
            "not_in_review",
            format!(
                "{key} is in «{}», not in Review: the session did not finish it",
                state.unwrap_or_default()
            ),
        );
    }
    let s = match rv::state(&rt.db, &rt.ibase, &rt.wbase, root, key) {
        Ok(s) => s,
        Err(e) => return cx.stop(Some(&d), "error", e),
    };
    if s.running {
        return cx.stop(Some(&d), "running", "a review of this issue is running");
    }
    if !s.uncommitted.is_empty() {
        return cx.stop(
            Some(&d),
            "uncommitted",
            format!(
                "the session's worktree has changes nobody committed ({}): commit them — autonomy never commits",
                s.uncommitted.join(", ")
            ),
        );
    }
    if let (Some(r), Some(t)) = (&s.review, &s.tips) {
        // the same tips give the same answer; only an interrupted, failed or cancelled review goes again
        if &r.tips == t
            && !matches!(
                r.state.as_str(),
                "failed" | "cancelled" | "checking" | "reviewing"
            )
        {
            return cx.stop(
                Some(&d),
                "already_reviewed",
                format!("review {} is about these very tips ({})", r.id, r.state),
            );
        }
    }
    let Some(command) = s.request.clone() else {
        let code = if s.checks.is_empty() {
            "no_checks"
        } else if s.criteria.is_empty() {
            "no_criteria"
        } else if s.tips.is_some() && s.ahead == 0 {
            "nothing_to_review"
        } else {
            "cannot_request"
        };
        return cx.stop(Some(&d), code, s.request_blocked.unwrap_or_default());
    };
    let (by, sink) = by_of(&d);
    let provider = d.provider.clone().unwrap_or_else(|| "claude".into());
    let reviewer = (rt.reviewer)(&provider, d.model.as_deref());
    let lang = ReplyLang::from_ui(d.language.as_deref());
    let started = match rv::request_as(
        &rt.db,
        &rt.ibase,
        root,
        key,
        &command,
        by,
        reviewer,
        lang,
        rt.env.clone(),
    ) {
        Ok(s) => s,
        Err(e) => {
            return cx.record(
                Some(&d),
                "failed",
                "request_failed",
                e,
                None,
                taken(&sink),
                Value::Null,
            )
        }
    };
    let id = started.id;
    cx.record(
        Some(&d),
        "started",
        "requested",
        command,
        Some(id),
        taken(&sink),
        Value::Null,
    );
    if let Some(job) = started.job {
        let me = (root.to_string(), key.to_string());
        autonomous()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(me.clone());
        job.run(rt.review_emit.clone());
        autonomous()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&me);
    }
    let r = match store(&rt.db).and_then(|s| s.review(root, id).map_err(|e| e.message)) {
        Ok(Some(r)) => r,
        Ok(None) => return cx.stop(Some(&d), "error", format!("review {id} is gone")),
        Err(e) => return cx.stop(Some(&d), "error", e),
    };
    let overall = r.verdict.as_ref().map(|v| v.overall.clone());
    let (outcome, code, detail) = match (r.state.as_str(), overall.as_deref()) {
        ("reviewed", Some("met")) => ("ok", "reviewed", "every criterion met".to_string()),
        ("reviewed", Some(o)) => (
            "stopped",
            if o == "not_met" { "not_met" } else { "unclear" },
            r.verdict.as_ref().map(|v| v.summary.clone()).unwrap_or_default(),
        ),
        ("conflict", _) => ("stopped", "conflict", r.conflicts.join(", ")),
        ("checked", _) => (
            "stopped",
            "checks",
            r.checks
                .iter()
                .filter(|c| !c.passed)
                .map(|c| c.name.clone())
                .chain(r.arch.iter().map(|a| format!("{} {}", a.path, a.rule)))
                .collect::<Vec<_>>()
                .join(", "),
        ),
        ("cancelled", _) => ("stopped", "cancelled", "the review was cancelled".into()),
        (st, _) => ("failed", "review_failed", r.error.clone().unwrap_or_else(|| st.to_string())),
    };
    let step = cx.record(
        Some(&d),
        outcome,
        code,
        detail,
        Some(id),
        taken(&sink),
        Value::Null,
    );
    if code == "reviewed" {
        integrate_now(rt, root, key, Trigger::ReviewDone);
    }
    step
}

/// With `integrate` (or `pr`) delegated: integrates issue `key` by the human's path (or opens its pull
/// request) — only if the gate holds now, for these tips. Synchronous.
pub fn integrate_now(rt: &Runtime, root: &str, key: &str, trigger: Trigger) -> Step {
    let st = store(&rt.db).ok()?;
    let now = now_ms();
    let ds = st.delegations_for(root, key).ok()?;
    let (action, d) = match au::mode(&ds, now) {
        Mode::Manual => return None,
        Mode::Integrate(d) => ("integrate", d.clone()),
        Mode::Pr(d) => ("pr", d.clone()),
        Mode::Ambiguous => {
            let cx = Ctx {
                rt,
                root,
                key,
                action: "integrate",
                trigger,
            };
            return cx.stop(
                None,
                "ambiguous",
                "both «integrate» and «open a pull request» are delegated for this issue: revoke one",
            );
        }
    };
    let cx = Ctx {
        rt,
        root,
        key,
        action,
        trigger,
    };
    if let Err(step) = cx.prelude(&st, &d) {
        return step;
    }
    let f = match rv::facts(&rt.db, root, key) {
        Ok(f) => f,
        Err(e) => return cx.stop(Some(&d), "error", e),
    };
    let gate = rv::gate_of(&f, rv::is_running(root, key));
    let review = f.review.as_ref().map(|r| r.id);
    if !gate.ok {
        return cx.record(
            Some(&d),
            "stopped",
            gate_code(&gate),
            rv::gate_text(&gate),
            review,
            vec![],
            Value::Null,
        );
    }
    let (by, sink) = by_of(&d);
    if action == "integrate" {
        let s = match rv::state(&rt.db, &rt.ibase, &rt.wbase, root, key) {
            Ok(s) => s,
            Err(e) => return cx.stop(Some(&d), "error", e),
        };
        let Some(command) = s.integrate else {
            return cx.record(
                Some(&d),
                "stopped",
                gate_code(&s.gate),
                rv::gate_text(&s.gate),
                review,
                vec![],
                Value::Null,
            );
        };
        return match rv::integrate_as(&rt.db, &rt.wbase, root, key, &command, by) {
            Ok(i) => {
                let detail = format!("{} is at {} ({})", i.target, i.commit, i.state);
                let extra = json!({"integrated": i});
                cx.record(Some(&d), "ok", "integrated", detail, review, taken(&sink), extra)
            }
            Err(e) if e.starts_with(tutor_protect::scan::BLOCKED) => cx.record(
                Some(&d),
                "stopped",
                "secret_scan",
                e,
                review,
                taken(&sink),
                Value::Null,
            ),
            Err(e) => cx.record(
                Some(&d),
                "failed",
                "integrate_failed",
                e,
                review,
                taken(&sink),
                Value::Null,
            ),
        };
    }
    let p = match crate::codev_pr::state(&rt.db, root, key, &rt.gh) {
        Ok(p) => p,
        Err(e) => return cx.stop(Some(&d), "error", e),
    };
    let Some(command) = p.plan else {
        let code = match &p.gh {
            Some(g) if !g.installed => "gh_missing",
            Some(g) if !g.signed_in => "gh_signed_out",
            _ => "pr_blocked",
        };
        return cx.record(
            Some(&d),
            "stopped",
            code,
            p.blocked.unwrap_or_default(),
            review,
            vec![],
            Value::Null,
        );
    };
    match crate::codev_pr::open_as(&rt.db, root, key, &command, by, &rt.gh) {
        Ok(o) => {
            let detail = format!("#{} {}", o.number, o.url);
            let extra = json!({"pr": o});
            cx.record(Some(&d), "ok", "pr_opened", detail, review, taken(&sink), extra)
        }
        Err(e) if e.starts_with(tutor_protect::scan::BLOCKED) => cx.record(
            Some(&d),
            "stopped",
            "secret_scan",
            e,
            review,
            taken(&sink),
            Value::Null,
        ),
        Err(e) => cx.record(
            Some(&d),
            "failed",
            "pr_failed",
            e,
            review,
            taken(&sink),
            Value::Null,
        ),
    }
}

/* ───── the triggers (the app's runtime, on a thread of their own) ───── */

fn spawn(f: impl FnOnce(&'static Runtime) + Send + 'static) {
    if let Some(rt) = runtime() {
        std::thread::spawn(move || f(rt));
    }
}

/// The issue's Co-Dev session finished it (`finish_issue`).
pub fn session_finished(root: &str, key: &str) {
    let (root, key) = (root.to_string(), key.to_string());
    spawn(move |rt| {
        review_now(rt, &root, &key, Trigger::SessionFinished);
    });
}

/// The decision of [`committed`]: the autonomy's last review step on the issue stopped only because
/// there was nothing committed to review.
pub fn waiting_for_commit(db: &Path, root: &str, key: &str) -> bool {
    store(db)
        .ok()
        .and_then(|s| s.last_autonomy_event(root, key, "review").ok().flatten())
        .is_some_and(|e| {
            e.outcome == "stopped" && matches!(e.code.as_str(), "uncommitted" | "nothing_to_review")
        })
}

/// The human committed in the issue's Co-Dev worktree.
pub fn committed(root: &str, key: &str) {
    let (root, key) = (root.to_string(), key.to_string());
    spawn(move |rt| {
        if waiting_for_commit(&rt.db, &root, &key) {
            review_now(rt, &root, &key, Trigger::Committed);
        }
    });
}

/// A review of the issue ended (a human's or the autonomy's): when every criterion was met, the
/// integration step.
pub fn review_done(root: &str, key: &str) {
    let (root, key) = (root.to_string(), key.to_string());
    spawn(move |rt| {
        let met = store(&rt.db)
            .ok()
            .and_then(|s| s.review_latest(&root, &key).ok().flatten())
            .is_some_and(|r| {
                r.state == "reviewed" && r.verdict.as_ref().is_some_and(|v| v.overall == "met")
            });
        if met {
            integrate_now(rt, &root, &key, Trigger::ReviewDone);
        }
    });
}

/// The human recorded the functional approval of the issue.
pub fn functional_approved(root: &str, key: &str) {
    let (root, key) = (root.to_string(), key.to_string());
    spawn(move |rt| {
        integrate_now(rt, &root, &key, Trigger::FunctionalApproved);
    });
}

#[cfg(test)]
mod tests;
