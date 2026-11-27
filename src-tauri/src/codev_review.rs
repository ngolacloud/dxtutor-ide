//! Multi Co-Dev, phase 4 — the assisted Co-Dev reviewer and the integration gate (the use case,
//! independent of Tauri; `commands::codev_review` is the thin adapter).
//!
//! - **Request review** (a human starts it, with the approval dialog): the issue branch merged onto
//!   the default branch's tip becomes a candidate commit, checked out in a temporary worktree
//!   (`tutor_eval::gitwork::integrate`); a conflict is reported with its files and nothing else
//!   happens. There the project's mandatory checks run (each command, exit code, masked tail, time)
//!   and the architect's rules read the files the candidate changes. Only when every check passed
//!   and no rule broke does the **Co-Dev reviewer** run: an agent with read-only tools (`read`,
//!   `glob`, `grep`) rooted in that worktree and one tool of its own, `review_verdict` — no other
//!   session's tools or prompt change. It gets the diff, the criteria, the DoD and the check results,
//!   not the repository, and answers criterion by criterion with evidence that is checked against
//!   the candidate before it is kept. Everything is stored with the exact tips, commit and tree.
//! - **Integrate** (a human clicks it, with the approval dialog): the gate
//!   (`tutor_board::project::integration::gate`) is asked again with the facts read right then; only
//!   if all three conditions hold does the default branch fast-forward to exactly the reviewed
//!   commit — after an undo snapshot and the secret scan of what it brings, audited before and with
//!   the result; never a push, never forced. Then the issue moves by the Project's rules and the
//!   issue's Co-Dev worktree goes if it is clean (an open session is closed by the interface, which
//!   releases its claims and its worktree by the phase 3 rules).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tutor_agent::context::ReplyLang;
use tutor_agent::tools::{coding_tools, ToolsetOptions};
use tutor_agent::{
    Agent, AgentConfig, AgentEvent, Decision, Effort, Message, Provider, SystemBlock, Tool,
    ToolCtx, ToolOutput, Transcript,
};
use tutor_board::project::integration::{
    self as ig, ArchFinding, CheckRun, Evidence, Gate, GateFacts, Review, Tips, Verdict,
};
use tutor_board::project::{Check, GateData, ProjectStore};
use tutor_eval::gitwork::{codev as wt, integrate as gi};

use crate::board::{actor, ide_audit_entry, now_ms, IdeAudit};

/// How long one mandatory check may run.
const CHECK_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// What the reviewer gets of the diff (the rest it reads with its tools).
const DIFF_MAX_CHARS: usize = 40_000;
/// The end of a check's output that is kept (and masked).
const TAIL_LINES: usize = 60;
const TAIL_CHARS: usize = 6_000;
/// Requests the reviewer may make.
const REVIEWER_ITERATIONS: u32 = 24;
/// The reviewer's only tools besides its own (all read-only).
const READ_TOOLS: [&str; 3] = ["read", "glob", "grep"];

fn store(db: &Path) -> Result<ProjectStore, String> {
    ProjectStore::open(db)
}

/* ───── who decided (Multi Co-Dev, phase 5) ───── */

/// Who the audit log says acted for an autonomous step.
pub const AUTONOMY_ACTOR: &str = "Co-Dev (autonomia)";

/// Who decided an action of the review: a human in the approval dialog, or a delegation (phase 5:
/// the backend acts on what a human delegated; every audit row it writes goes to `audit`, for the
/// autonomy's log).
#[derive(Clone, Debug)]
pub enum By {
    Human {
        /// when the human decided (ms)
        decided_at: Option<i64>,
    },
    Delegation {
        id: i64,
        granted_by: String,
        audit: Arc<Mutex<Vec<i64>>>,
    },
}

impl By {
    pub fn human(decided_at: Option<i64>) -> Self {
        By::Human { decided_at }
    }

    pub fn delegated(&self) -> bool {
        matches!(self, By::Delegation { .. })
    }
}

/// One row of the audit log for a review action (origin `ide`, feature `codev`), as `by` decided
/// it; returns its id. A delegation's row says so: mode `autonomous`, decided by `delegation:<id>:
/// <who granted it>`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn audit_as(
    db: &Path,
    root: &str,
    by: &By,
    key: &str,
    action: &str,
    command: &str,
    scope: &str,
    outcome: &str,
    reason: Option<String>,
) -> Result<i64, String> {
    let redactor = tutor_agent::redact::Redactor::for_root(Path::new(root));
    let (who, decided_at) = match by {
        By::Human { decided_at } => (actor(root), *decided_at),
        By::Delegation { .. } => (AUTONOMY_ACTOR.to_string(), None),
    };
    let mut e = ide_audit_entry(
        &IdeAudit {
            feature: "codev".into(),
            action: action.into(),
            command: command.into(),
            scope: Some(scope.into()),
            approved: true,
            reason,
            outcome: Some(outcome.into()),
            decided_at,
        },
        &who,
        now_ms(),
        &redactor,
    )
    .map_err(|e| e.message)?;
    e.issue_key = Some(key.to_string());
    if let By::Delegation { id, granted_by, .. } = by {
        e.mode = "autonomous".into();
        e.verdict = Some("delegated".into());
        e.decided_by = Some(format!("delegation:{id}:{granted_by}"));
    }
    let id = store(db)?
        .record_audit_id(root, &e)
        .map_err(|e| e.message)?;
    if let By::Delegation { audit, .. } = by {
        audit.lock().unwrap_or_else(|e| e.into_inner()).push(id);
    }
    Ok(id)
}

/* ───── the reviews running in this app (one per issue) ───── */

fn running() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static R: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    R.get_or_init(Mutex::default)
}

fn job_key(root: &str, key: &str) -> String {
    format!("{root}\n{key}")
}

/// A review of this issue runs in this app now.
pub fn is_running(root: &str, key: &str) -> bool {
    running().lock().unwrap().contains_key(&job_key(root, key))
}

/// Asks the running review of the issue to stop (a check is killed, the reviewer stops).
pub fn cancel(root: &str, key: &str) -> bool {
    match running().lock().unwrap().get(&job_key(root, key)) {
        Some(f) => {
            f.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// Requests and integrations of one app never interleave (the tips are read and used in one go).
pub(crate) fn serial() -> &'static Mutex<()> {
    static L: OnceLock<Mutex<()>> = OnceLock::new();
    L.get_or_init(Mutex::default)
}

/* ───── what the review panel shows ───── */

/// The gate of an issue as the panel shows it, with what each button would run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewState {
    pub key: String,
    pub title: String,
    /// the newest review
    pub review: Option<Review>,
    pub running: bool,
    /// the tips now (`None`: `tips_error` says why)
    pub tips: Option<Tips>,
    pub tips_error: Option<String>,
    /// commits the issue branch has that the default branch has not
    pub ahead: u32,
    /// the project's mandatory checks now
    pub checks: Vec<Check>,
    pub criteria: Vec<String>,
    pub gate: Gate,
    /// what «Request review» runs (for the approval dialog); `None`: `request_blocked` says why
    pub request: Option<String>,
    pub request_blocked: Option<String>,
    /// what «Integrate» runs, when the gate holds
    pub integrate: Option<String>,
    /// uncommitted changes in the issue's Co-Dev worktree: they are not part of any review
    pub uncommitted: Vec<String>,
    /// the open Co-Dev session working on the issue
    pub session: Option<String>,
}

pub(crate) fn session_of(root: &str, key: &str) -> Option<String> {
    let here = std::fs::canonicalize(root).unwrap_or_else(|_| PathBuf::from(root));
    crate::codev_agent::live_sessions()
        .into_iter()
        .find(|s| {
            s.issue.as_deref() == Some(key)
                && std::fs::canonicalize(&s.root).unwrap_or_else(|_| PathBuf::from(&s.root)) == here
        })
        .map(|s| s.id)
}

pub(crate) struct Facts {
    pub data: GateData,
    pub review: Option<Review>,
    pub tips: Result<gi::Tips, String>,
    pub candidate_ok: bool,
}

pub(crate) fn board_tips(t: &gi::Tips) -> Tips {
    Tips {
        target: t.target.clone(),
        base: t.base.clone(),
        branch: t.branch.clone(),
        head: t.head.clone(),
    }
}

pub(crate) fn facts(db: &Path, root: &str, key: &str) -> Result<Facts, String> {
    let st = store(db)?;
    let data = st.gate_facts(root, key).map_err(|e| e.message)?;
    let review = st.review_latest(root, key).map_err(|e| e.message)?;
    let branch = data
        .branch
        .clone()
        .or_else(|| review.as_ref().map(|r| r.tips.branch.clone()));
    let tips = match branch {
        Some(b) => gi::tips(Path::new(root), &b),
        None => Err(format!(
            "{key} has no branch yet: start it with Co-Dev, or create its branch"
        )),
    };
    let candidate_ok = review.as_ref().is_some_and(|r| {
        !r.candidate.is_empty()
            && gi::verify(
                Path::new(root),
                &r.candidate,
                &r.tree,
                &r.tips.base,
                &r.tips.head,
            )
    });
    Ok(Facts {
        data,
        review,
        tips,
        candidate_ok,
    })
}

pub(crate) fn gate_of(f: &Facts, running: bool) -> Gate {
    let now = f.tips.as_ref().map(board_tips);
    ig::gate(&GateFacts {
        review: f.review.as_ref(),
        running,
        now: now.as_ref().map_err(|e| e.as_str()),
        candidate_ok: f.candidate_ok,
        checks: &f.data.checks,
        criteria: &f.data.criteria,
        functional: f.data.functional.as_ref(),
        functional_criteria: f.data.functional_criteria.as_deref(),
    })
}

fn pairs(checks: &[Check]) -> Vec<(String, String)> {
    checks
        .iter()
        .map(|c| (c.name.clone(), c.command.clone()))
        .collect()
}

/// Why «Request review» cannot run now, or the exact text of what it runs.
fn request_plan(
    ibase: &Path,
    root: &str,
    key: &str,
    f: &Facts,
    ahead: u32,
) -> Result<String, String> {
    let t = f.tips.as_ref().map_err(|e| e.clone())?;
    if f.data.checks.is_empty() {
        return Err(
            "the project has no mandatory checks: set them in the Project's settings".into(),
        );
    }
    if f.data.criteria.is_empty() {
        return Err(format!(
            "{key} has no acceptance criteria: the reviewer confirms them"
        ));
    }
    if ahead == 0 {
        return Err(format!(
            "{} has no commit that {} does not have: nothing to review",
            t.branch, t.target
        ));
    }
    gi::request_command(Path::new(root), ibase, key, t, &pairs(&f.data.checks))
}

/// What a Co-Dev worktree of the issue leaves after the integration (the line the approval shows,
/// when there is one to remove and no open session works in it).
fn worktree_removal(
    wbase: &Path,
    root: &str,
    key: &str,
    session: &Option<String>,
) -> Option<String> {
    if session.is_some() {
        return None;
    }
    wt::remove_plan(Path::new(root), wbase, key)
        .ok()
        .map(|r| r.command)
}

fn integrate_plan(
    wbase: &Path,
    root: &str,
    key: &str,
    r: &Review,
    session: &Option<String>,
) -> String {
    let mut s = gi::integrate_command(Path::new(root), &r.candidate);
    if let Some(rm) = worktree_removal(wbase, root, key, session) {
        s.push('\n');
        s.push_str(&rm);
        s.push_str("   # the issue's Co-Dev worktree, only if it has no uncommitted changes");
    }
    s
}

/// The issue's review panel: the gate now and what each button would run. Read-only.
pub fn state(
    db: &Path,
    ibase: &Path,
    wbase: &Path,
    root: &str,
    key: &str,
) -> Result<ReviewState, String> {
    let f = facts(db, root, key)?;
    let run = is_running(root, key);
    let gate = gate_of(&f, run);
    let ahead = f
        .tips
        .as_ref()
        .ok()
        .and_then(|t| gi::ahead(Path::new(root), t).ok())
        .unwrap_or(0);
    let (request, request_blocked) = if run {
        (None, Some("a review of this issue is running".to_string()))
    } else {
        match request_plan(ibase, root, key, &f, ahead) {
            Ok(c) => (Some(c), None),
            Err(e) => (None, Some(e)),
        }
    };
    let session = session_of(root, key);
    let integrate = match (&f.review, gate.ok) {
        (Some(r), true) => Some(integrate_plan(wbase, root, key, r, &session)),
        _ => None,
    };
    let uncommitted = wt::find(Path::new(root), wbase, key)
        .ok()
        .flatten()
        .map(|w| w.dirty)
        .unwrap_or_default();
    Ok(ReviewState {
        key: key.to_string(),
        title: f.data.title.clone(),
        review: f.review.clone(),
        running: run,
        tips_error: f.tips.as_ref().err().cloned(),
        tips: f.tips.as_ref().ok().map(board_tips),
        ahead,
        checks: f.data.checks,
        criteria: f.data.criteria,
        gate,
        request,
        request_blocked,
        integrate,
        uncommitted,
        session,
    })
}

/* ───── request review ───── */

/// Builds the reviewer when it is needed (after the checks passed): the model's provider and name.
pub type MakeReviewer = Box<dyn FnOnce() -> Result<(Arc<dyn Provider>, String), String> + Send>;
/// A step of a running review, for the interface (`{stage, …}`).
pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

/// What a request started: the review's id and, when it did not conflict, the work left to do —
/// the checks, the architect's rules and the reviewer — which the caller runs on a thread.
pub struct Started {
    pub id: i64,
    pub job: Option<Job>,
}

/// The rest of a review: the checks, the rules, the scan and the reviewer, in the temporary worktree.
pub struct Job {
    db: PathBuf,
    ibase: PathBuf,
    root: String,
    review: Review,
    dir: PathBuf,
    cancel: Arc<AtomicBool>,
    reviewer: Option<MakeReviewer>,
    lang: ReplyLang,
    dod: Vec<String>,
    title: String,
    env: Option<HashMap<String, String>>,
    by: By,
    command: String,
}

/// A job that ends (or is dropped without running) is no longer running.
impl Drop for Job {
    fn drop(&mut self) {
        self.unmark();
    }
}

/// Starts a review of issue `key` with the approved `command` (as [`ReviewState::request`] showed
/// it): audited first (a request that cannot be recorded does not run), then the candidate is made.
/// A conflict is recorded and ends it. `env`: the environment the checks run with (`None`: this
/// process's).
#[allow(clippy::too_many_arguments)]
pub fn request(
    db: &Path,
    ibase: &Path,
    root: &str,
    key: &str,
    command: &str,
    decided_at: Option<i64>,
    reviewer: MakeReviewer,
    lang: ReplyLang,
    env: Option<HashMap<String, String>>,
) -> Result<Started, String> {
    request_as(
        db,
        ibase,
        root,
        key,
        command,
        By::human(decided_at),
        reviewer,
        lang,
        env,
    )
}

/// [`request`] as `by` decided it (a human, or a delegation of phase 5): the same plan, the same
/// checks, the same audit rows — only who decided differs.
#[allow(clippy::too_many_arguments)]
pub fn request_as(
    db: &Path,
    ibase: &Path,
    root: &str,
    key: &str,
    command: &str,
    by: By,
    reviewer: MakeReviewer,
    lang: ReplyLang,
    env: Option<HashMap<String, String>>,
) -> Result<Started, String> {
    let _serial = serial().lock().unwrap_or_else(|e| e.into_inner());
    if is_running(root, key) {
        return Err("a review of this issue is already running".into());
    }
    let f = facts(db, root, key)?;
    let tips = f.tips.clone()?;
    let ahead = gi::ahead(Path::new(root), &tips)?;
    let plan = request_plan(ibase, root, key, &f, ahead)?;
    if plan != command.trim() {
        // nothing runs, so nothing to record: the human approves the new plan instead
        return Err(format!(
            "the repository or the checks changed since the approval: the request is now\n{plan}"
        ));
    }
    let scope = format!("review {key} · {} onto {}", tips.branch, tips.target);
    audit_as(
        db,
        root,
        &by,
        key,
        "review.request",
        command,
        &scope,
        "sent",
        None,
    )
    .map_err(|e| format!("not done: the audit log did not record it ({e})"))?;
    let message = format!(
        "Merge {} into {} ({key}: {})",
        tips.branch,
        tips.target,
        f.data.title.chars().take(120).collect::<String>()
    );
    let now = now_ms();
    let mut review = Review {
        id: 0,
        key: key.to_string(),
        tips: board_tips(&tips),
        candidate: String::new(),
        tree: String::new(),
        criteria: f.data.criteria.clone(),
        required: f.data.checks.clone(),
        checks: vec![],
        arch_rules: false,
        arch: vec![],
        conflicts: vec![],
        scan: None,
        verdict: None,
        reviewer: None,
        tokens_in: 0,
        tokens_out: 0,
        state: "checking".into(),
        error: None,
        actor: actor(root),
        created: now,
        updated: now,
    };
    let prepared = gi::prepare(Path::new(root), ibase, key, &tips, &message);
    let c = match prepared {
        Err(e) => {
            let _ = audit_as(
        db,
        root,
        &by,
        key,
        "review.request",
        command,
        &scope,
        "failed",
        Some(e.clone()),
    );
            return Err(e);
        }
        Ok(gi::Prepared::Conflict(files)) => {
            review.state = "conflict".into();
            review.conflicts = files.clone();
            let saved =
                store(db).and_then(|mut s| s.review_insert(root, &review).map_err(|e| e.message));
            let id = match saved {
                Ok(id) => id,
                Err(e) => {
                    let _ = audit_as(
        db,
        root,
        &by,
        key,
        "review.request",
        command,
        &scope,
        "failed",
        Some(e.clone()),
    );
                    return Err(e);
                }
            };
            let _ = audit_as(
                db,
                root,
                &by,
                key,
                "review.request",
                command,
                &scope,
                "failed",
                Some(format!("conflict: {}", files.join(", "))),
            );
            return Ok(Started { id, job: None });
        }
        Ok(gi::Prepared::Ready(c)) => c,
    };
    review.candidate = c.commit.clone();
    review.tree = c.tree.clone();
    // running before its row says `checking`: the panel never sees it as interrupted
    let cancel = Arc::new(AtomicBool::new(false));
    running()
        .lock()
        .unwrap()
        .insert(job_key(root, key), cancel.clone());
    let id = match store(db).and_then(|mut s| s.review_insert(root, &review).map_err(|e| e.message))
    {
        Ok(id) => id,
        Err(e) => {
            running().lock().unwrap().remove(&job_key(root, key));
            let _ = gi::discard(Path::new(root), ibase, key);
            let _ = audit_as(
        db,
        root,
        &by,
        key,
        "review.request",
        command,
        &scope,
        "failed",
        Some(e.clone()),
    );
            return Err(e);
        }
    };
    review.id = id;
    Ok(Started {
        id,
        job: Some(Job {
            db: db.to_path_buf(),
            ibase: ibase.to_path_buf(),
            root: root.to_string(),
            review,
            dir: PathBuf::from(&c.dir),
            cancel,
            reviewer: Some(reviewer),
            lang,
            dod: f.data.dod.clone(),
            title: f.data.title.clone(),
            env,
            by,
            command: command.to_string(),
        }),
    })
}

fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let from = lines.len().saturating_sub(TAIL_LINES);
    let t = lines[from..].join("\n");
    let n = t.chars().count();
    if n > TAIL_CHARS {
        t.chars().skip(n - TAIL_CHARS).collect()
    } else {
        t
    }
}

impl Job {
    fn unmark(&self) {
        running()
            .lock()
            .unwrap()
            .remove(&job_key(&self.root, &self.review.key));
    }

    fn save(&mut self) {
        if let Ok(mut st) = store(&self.db) {
            let _ = st.review_update(&self.root, &self.review, now_ms());
        }
    }

    fn emit(&self, emit: &Emit, v: Value) {
        let mut v = v;
        v["root"] = json!(self.root);
        v["key"] = json!(self.review.key);
        v["review"] = json!(self.review.id);
        emit(v);
    }

    /// Runs one mandatory check in the candidate's worktree.
    fn run_check(&self, c: &Check) -> CheckRun {
        let mut cmd = tutor_agent::tools::shell(c.command.trim());
        if let Some(env) = &self.env {
            cmd.env_clear().envs(env.iter());
        }
        for v in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_COMMON_DIR",
        ] {
            cmd.env_remove(v);
        }
        let ctx = ToolCtx {
            root: self.dir.clone(),
            cancel: self.cancel.clone(),
        };
        let t0 = Instant::now();
        let o = tutor_agent::tools::run_process(cmd, &self.dir, CHECK_TIMEOUT, &ctx);
        let mut text = o.stdout.trim_end().to_string();
        if !o.stderr.trim().is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(o.stderr.trim_end());
        }
        let redactor = tutor_agent::redact::Redactor::for_root(Path::new(&self.root));
        CheckRun {
            name: c.name.clone(),
            command: c.command.clone(),
            exit: if o.timed_out || o.cancelled {
                None
            } else {
                o.code
            },
            passed: o.ok(),
            tail: redactor.mask(&tail(&text)),
            ms: t0.elapsed().as_millis() as u64,
            timed_out: o.timed_out,
        }
    }

    /// The architect's rules (the project's `.dxtutor/architecture.toml`) on every file the candidate
    /// changes, as the candidate has it; what no accepted ADR excuses.
    fn arch_rules(&self) -> Result<(bool, Vec<ArchFinding>), String> {
        let root = Path::new(&self.root);
        let Some(rules) = tutor_agent::conformance::Rules::load(root)? else {
            return Ok((false, vec![]));
        };
        let mut found = vec![];
        for rel in gi::changed(root, &self.review.tips.base, &self.review.candidate)? {
            let Ok(text) = std::fs::read_to_string(self.dir.join(&rel)) else {
                continue; // deleted (or not text): nothing to check
            };
            found.extend(tutor_agent::conformance::check(&rules, &rel, &text));
        }
        Ok((
            true,
            tutor_agent::conformance::unexcused(&rules, root, found)
                .into_iter()
                .map(|v| ArchFinding {
                    rule: v.rule,
                    message: v.message,
                    path: v.path,
                    line: v.line,
                })
                .collect(),
        ))
    }

    fn finish(&mut self, emit: &Emit, outcome: &str, reason: Option<String>) {
        self.save();
        let _ = gi::discard(Path::new(&self.root), &self.ibase, &self.review.key);
        let scope = format!(
            "review {} · {} onto {}",
            self.review.key, self.review.tips.branch, self.review.tips.target
        );
        let _ = audit_as(
            &self.db,
            &self.root,
            &self.by,
            &self.review.key,
            "review.request",
            &self.command,
            &scope,
            outcome,
            reason,
        );
        let state = self.review.state.clone();
        // not running any more before the interface hears it is done (it reads the gate then)
        self.unmark();
        self.emit(emit, json!({"stage": "done", "state": state}));
    }

    /// The checks, the rules, the scan and — when they all pass — the reviewer. Always ends with the
    /// review saved, the temporary worktree removed and the request's outcome audited.
    pub fn run(mut self, emit: Emit) {
        let required = self.review.required.clone();
        for (i, c) in required.iter().enumerate() {
            self.emit(&emit, json!({"stage": "check", "index": i, "name": c.name}));
            // every check runs, even after one fails: the panel shows them all
            let r = self.run_check(c);
            self.emit(
                &emit,
                json!({"stage": "checked", "index": i, "name": c.name, "passed": r.passed}),
            );
            self.review.checks.push(r);
            self.save();
            if self.cancel.load(Ordering::SeqCst) {
                self.review.state = "cancelled".into();
                return self.finish(&emit, "failed", Some("cancelled".into()));
            }
        }
        self.emit(&emit, json!({"stage": "rules"}));
        match self.arch_rules() {
            Ok((exists, found)) => {
                self.review.arch_rules = exists;
                self.review.arch = found;
            }
            Err(e) => {
                self.review.state = "failed".into();
                self.review.error = Some(format!("the architect's rules could not be read: {e}"));
                let why = self.review.error.clone();
                return self.finish(&emit, "failed", why);
            }
        }
        // the secret scan of what the candidate brings: shown now, enforced when it is integrated
        self.review.scan = tutor_protect::scan::scan(
            Path::new(&self.root),
            &tutor_protect::scan::Scope::Between(&self.review.tips.base, &self.review.candidate),
        )
        .ok()
        .and_then(|r| serde_json::to_value(r).ok());
        let failed: Vec<String> = self
            .review
            .checks
            .iter()
            .filter(|c| !c.passed)
            .map(|c| c.name.clone())
            .collect();
        if !failed.is_empty() || !self.review.arch.is_empty() {
            self.review.state = "checked".into();
            let why = if failed.is_empty() {
                format!("{} architecture rule(s) broken", self.review.arch.len())
            } else {
                format!("checks failed: {}", failed.join(", "))
            };
            return self.finish(&emit, "failed", Some(why));
        }
        self.review.state = "reviewing".into();
        self.save();
        self.emit(&emit, json!({"stage": "reviewer"}));
        let made = match self.reviewer.take() {
            Some(make) => make(),
            None => Err("no reviewer".into()),
        };
        let outcome = made.and_then(|(provider, model)| {
            self.review.reviewer = Some(model.clone());
            let brief = brief(&self.review, &self.title, &self.dod, &self.root)?;
            let em = emit.clone();
            let (root, key, id) = (self.root.clone(), self.review.key.clone(), self.review.id);
            run_reviewer(
                provider,
                &model,
                self.lang,
                &self.dir,
                &self.root,
                &self.review,
                &brief,
                self.cancel.clone(),
                &move |step| {
                    let mut v = step;
                    v["root"] = json!(root);
                    v["key"] = json!(key);
                    v["review"] = json!(id);
                    em(v)
                },
            )
        });
        match outcome {
            Ok(r) => {
                self.review.tokens_in = r.tokens.0;
                self.review.tokens_out = r.tokens.1;
                let overall = r.verdict.overall.clone();
                self.review.verdict = Some(r.verdict);
                self.review.state = "reviewed".into();
                self.finish(&emit, "ok", Some(format!("reviewer: {overall}")));
            }
            Err(e) => {
                self.review.state = if self.cancel.load(Ordering::SeqCst) {
                    "cancelled".into()
                } else {
                    "failed".into()
                };
                self.review.error = Some(e.clone());
                self.finish(&emit, "failed", Some(e));
            }
        }
    }
}

/* ───── the Co-Dev reviewer ───── */

const REVIEWER_BRIEF: &str = "You are the Co-Dev reviewer of the dxtutor IDE. You review one change \
before it is integrated into the default branch. You are given the issue's acceptance criteria, the \
project's Definition of Done, the results of the mandatory checks (they ran on this exact tree and \
passed) and the diff against the default branch. Decide, criterion by criterion, whether the change \
meets it: met, not_met or unclear, with evidence — files and lines of this tree (`file`), tests that \
exercise it (`test`, by name) and check output (`output`, by the check's name, quoting it). When the \
diff is not enough, read the code with read, grep and glob: you are in a checkout of exactly the tree \
that would land, and you cannot change anything. Never invent evidence: what you cannot show is \
unclear. Judge only the criteria — not style, not other work. When you are done, call review_verdict \
once with every criterion; if it reports problems, fix them and call it again; then end your turn.";

/// The reviewer's first message: the issue, the criteria, the DoD, the checks and the diff — never
/// the whole repository.
fn brief(r: &Review, title: &str, dod: &[String], root: &str) -> Result<String, String> {
    let mut s = format!(
        "Issue {}: {title}\n\nAcceptance criteria (answer each by its number):\n",
        r.key
    );
    for (i, c) in r.criteria.iter().enumerate() {
        s.push_str(&format!("{}. {c}\n", i + 1));
    }
    if !dod.is_empty() {
        s.push_str("\nDefinition of Done (context for your judgement):\n");
        for d in dod {
            s.push_str(&format!("- {d}\n"));
        }
    }
    s.push_str("\nMandatory checks, run on this exact tree:\n");
    for c in &r.checks {
        let last: Vec<&str> = c
            .tail
            .lines()
            .rev()
            .take(15)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        s.push_str(&format!(
            "- {} (`{}`): exit {} in {:.1} s\n{}\n",
            c.name,
            c.command,
            c.exit.map(|e| e.to_string()).unwrap_or_else(|| "?".into()),
            c.ms as f64 / 1000.0,
            last.iter()
                .map(|l| format!("    {l}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
    }
    let files = gi::changed(Path::new(root), &r.tips.base, &r.candidate)?;
    s.push_str(&format!(
        "\nFiles the change touches ({}): {}\n",
        files.len(),
        files.join(", ")
    ));
    let (diff, cut) = gi::diff(Path::new(root), &r.tips.base, &r.candidate, DIFF_MAX_CHARS)?;
    s.push_str(&format!(
        "\nThe diff of {} against {}{}:\n```diff\n{diff}\n```\n",
        r.tips.branch,
        r.tips.target,
        if cut {
            " (cut: read the files for the rest)"
        } else {
            ""
        }
    ));
    Ok(s)
}

/// `review_verdict`: the reviewer's answer. Checked before it is kept: every criterion once, a
/// known status, real evidence (a file and lines of the candidate, a test it contains, a check that
/// ran), and the overall verdict consistent with the criteria.
/// Says whether a piece of evidence is real (`Err`: why not).
type EvidenceCheck = Box<dyn Fn(&Evidence) -> Result<(), String> + Send + Sync>;

pub struct ReviewVerdictTool {
    criteria: Vec<String>,
    evidence_ok: EvidenceCheck,
    pub verdict: Arc<Mutex<Option<Verdict>>>,
}

impl ReviewVerdictTool {
    /// For review `r`, checking evidence against its candidate in `root`'s repository.
    pub fn for_review(root: &str, r: &Review) -> Self {
        let (root, commit) = (PathBuf::from(root), r.candidate.clone());
        let checks: Vec<(String, String)> = r
            .checks
            .iter()
            .map(|c| (c.name.clone(), c.tail.clone()))
            .collect();
        ReviewVerdictTool {
            criteria: r.criteria.clone(),
            verdict: Arc::default(),
            evidence_ok: Box::new(move |e: &Evidence| match e.kind.as_str() {
                "file" => {
                    let n = gi::file_lines(&root, &commit, &e.reference)
                        .ok_or_else(|| format!("{} is not a file of this tree", e.reference))?;
                    if let Some(l) = &e.lines {
                        let end = l
                            .split('-')
                            .next_back()
                            .and_then(|x| x.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if end > n {
                            return Err(format!("{} has {n} lines, not {end}", e.reference));
                        }
                    }
                    Ok(())
                }
                "test" => {
                    let name = e.reference.trim();
                    let last = name
                        .rsplit([':', '.', '/', ' ', '#'])
                        .find(|s| !s.is_empty())
                        .unwrap_or(name);
                    if gi::mentions(&root, &commit, last)
                        || checks.iter().any(|(_, t)| t.contains(last))
                    {
                        Ok(())
                    } else {
                        Err(format!(
                            "no test named {name} in this tree or in the checks' output"
                        ))
                    }
                }
                "output" => {
                    if checks.iter().any(|(n, _)| n == e.reference.trim()) {
                        Ok(())
                    } else {
                        Err(format!(
                            "{} is not one of the checks that ran ({})",
                            e.reference,
                            checks
                                .iter()
                                .map(|(n, _)| n.as_str())
                                .collect::<Vec<_>>()
                                .join(", ")
                        ))
                    }
                }
                k => Err(format!("unknown evidence kind {k}")),
            }),
        }
    }
}

impl Tool for ReviewVerdictTool {
    fn name(&self) -> &str {
        "review_verdict"
    }
    fn description(&self) -> &str {
        "Records your verdict on the change: for every acceptance criterion (by its number) met, \
         not_met or unclear, with evidence — `file` (a path of this tree, `lines` like 12 or 12-30), \
         `test` (a test's name) or `output` (a check's name, quoting it in `detail`) — and a `note` \
         when it is not met or unclear. `overall` is met only when every criterion is met, not_met \
         when one is not, unclear otherwise. The evidence is checked: fix what it reports and call \
         it again."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "overall": {"enum": ["met", "not_met", "unclear"]},
                "summary": {"type": "string", "description": "two or three sentences for the human"},
                "criteria": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer", "minimum": 1},
                            "status": {"enum": ["met", "not_met", "unclear"]},
                            "evidence": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "kind": {"enum": ["file", "test", "output"]},
                                        "ref": {"type": "string"},
                                        "lines": {"type": "string"},
                                        "detail": {"type": "string"}
                                    },
                                    "required": ["kind", "ref"],
                                    "additionalProperties": false
                                }
                            },
                            "note": {"type": "string"}
                        },
                        "required": ["index", "status", "evidence"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["overall", "summary", "criteria"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true // it only records the answer
    }
    fn run(&self, input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        match ig::validate_verdict(input, &self.criteria, &*self.evidence_ok) {
            Ok(v) => {
                *self.verdict.lock().unwrap() = Some(v);
                ToolOutput::ok("Verdict recorded. End your turn now.")
            }
            Err(problems) => ToolOutput::err(format!(
                "The verdict was not recorded:\n- {}\nFix these and call review_verdict again.",
                problems.join("\n- ")
            )),
        }
    }
}

/// What the reviewer gave.
pub struct ReviewerOutcome {
    pub verdict: Verdict,
    /// input (with cache reads) and output tokens
    pub tokens: (u64, u64),
}

/// Runs the Co-Dev reviewer on review `r` (its candidate checked out in `dir`): read-only tools
/// rooted there and `review_verdict`. When it ends its turn without a verdict it is asked once
/// more; still none is an error.
#[allow(clippy::too_many_arguments)]
pub fn run_reviewer(
    provider: Arc<dyn Provider>,
    model: &str,
    lang: ReplyLang,
    dir: &Path,
    root: &str,
    r: &Review,
    brief: &str,
    cancel: Arc<AtomicBool>,
    progress: &dyn Fn(Value),
) -> Result<ReviewerOutcome, String> {
    let verdict_tool = ReviewVerdictTool::for_review(root, r);
    let slot = verdict_tool.verdict.clone();
    let mut tools: Vec<Arc<dyn Tool>> = coding_tools(&ToolsetOptions::default())
        .into_iter()
        .filter(|t| t.read_only() && READ_TOOLS.contains(&t.name()))
        .collect();
    tools.push(Arc::new(verdict_tool));
    let allowed: Vec<String> = tools.iter().map(|t| t.name().to_string()).collect();
    let mut cfg = AgentConfig::new(model.to_string());
    cfg.effort = Effort::Medium;
    cfg.max_iterations = REVIEWER_ITERATIONS;
    cfg.system = vec![SystemBlock {
        text: format!("{REVIEWER_BRIEF} {}", lang.reply_rule()),
        cache: true,
    }];
    let agent = Agent::new(
        provider,
        tools,
        cfg,
        ToolCtx {
            root: dir.to_path_buf(),
            cancel: cancel.clone(),
        },
    );
    let mut t = Transcript::new();
    let mut tokens = (0u64, 0u64);
    let mut first = Some(Message::user_text(brief));
    for _ in 0..2 {
        let msg = match first.take() {
            Some(m) => m,
            None => Message::user_text(
                "You ended without a verdict. Call review_verdict now, with every criterion.",
            ),
        };
        // `turn` is the running total of this run: the last one counts
        let mut used = (0u64, 0u64);
        let res = agent.run_turn(
            &mut t,
            Some(msg),
            &mut |e| match e {
                AgentEvent::Usage { turn, .. } => {
                    used = (
                        turn.input_tokens + turn.cache_read_input_tokens,
                        turn.output_tokens,
                    );
                }
                AgentEvent::ToolStart { name, .. } => {
                    progress(json!({"stage": "reviewer-tool", "tool": name}))
                }
                _ => {}
            },
            // only the read-only tools and the verdict exist; anything else is refused
            &mut |call| {
                if allowed.iter().any(|n| n == &call.name) {
                    Decision::Allow
                } else {
                    Decision::Deny("the reviewer only reads".into())
                }
            },
        );
        tokens = (tokens.0 + used.0, tokens.1 + used.1);
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        match res {
            Err(e) => return Err(format!("the reviewer failed: {e}")),
            Ok(tutor_agent::TurnOutcome::Refused { .. }) => {
                return Err("the model refused to review".into())
            }
            Ok(_) => {}
        }
        if let Some(v) = slot.lock().unwrap().take() {
            return Ok(ReviewerOutcome { verdict: v, tokens });
        }
    }
    Err("the reviewer ended without a verdict".into())
}

/* ───── integrate ───── */

/// What an integration did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Integrated {
    pub key: String,
    pub target: String,
    /// the commit the default branch is at now (the reviewed candidate)
    pub commit: String,
    /// the undo snapshot taken before
    pub snapshot: u32,
    /// where the issue ended (the Project's move rules)
    pub state: String,
    /// the open Co-Dev session of the issue: the interface closes it (phase 3 releases)
    pub session: Option<String>,
    /// the issue's Co-Dev worktree: removed, or kept with these uncommitted files
    pub worktree_removed: bool,
    pub worktree_kept: Vec<String>,
}

pub(crate) fn gate_text(g: &Gate) -> String {
    [
        ("checks", &g.checks),
        ("reviewer", &g.reviewer),
        ("functional", &g.functional),
    ]
    .iter()
    .filter(|(_, c)| !c.ok)
    .map(|(n, c)| {
        if c.items.is_empty() {
            format!("{n}: {}", c.code)
        } else {
            format!("{n}: {} ({})", c.code, c.items.join(", "))
        }
    })
    .collect::<Vec<_>>()
    .join("; ")
}

/// Integrates issue `key` with the approved `command` (as [`ReviewState::integrate`] showed it):
/// the gate is asked again with the facts as they are now, and nothing happens unless all three
/// conditions hold. Audited before (a refusal to record stops it) and with the result.
pub fn integrate(
    db: &Path,
    wbase: &Path,
    root: &str,
    key: &str,
    command: &str,
    decided_at: Option<i64>,
) -> Result<Integrated, String> {
    integrate_as(db, wbase, root, key, command, By::human(decided_at))
}

/// [`integrate`] as `by` decided it. A delegation (phase 5) goes the same way — the gate asked
/// again, the undo snapshot, the audit before and with the result, the Project's move rules without
/// overrides — except the secret scan: a finding always stops it ([`tutor_protect::scan::guard_strict`]:
/// a human's override is never taken), and a human integrates it by hand.
pub fn integrate_as(
    db: &Path,
    wbase: &Path,
    root: &str,
    key: &str,
    command: &str,
    by: By,
) -> Result<Integrated, String> {
    let _serial = serial().lock().unwrap_or_else(|e| e.into_inner());
    let f = facts(db, root, key)?;
    let gate = gate_of(&f, is_running(root, key));
    let review = match (&f.review, gate.ok) {
        (Some(r), true) => r.clone(),
        _ => return Err(format!("the gate does not hold: {}", gate_text(&gate))),
    };
    let tips = f.tips.clone()?;
    let session = session_of(root, key);
    let plan = integrate_plan(wbase, root, key, &review, &session);
    if plan != command.trim() {
        return Err(format!(
            "the integration changed since the approval: it is now\n{plan}"
        ));
    }
    let scope = format!(
        "integrate {key} · {} into {} ({})",
        tips.branch, tips.target, review.candidate
    );
    audit_as(
        db,
        root,
        &by,
        key,
        "review.integrate",
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
        "review.integrate",
        command,
        &scope,
        "failed",
        Some(tutor_protect::scan::summary(&e)),
    );
        e
    };
    let dir = Path::new(root);
    let snap =
        tutor_eval::gitwork::undo_snapshot(dir, &format!("integrate {key} into {}", tips.target))
            .map_err(|e| fail(format!("no undo snapshot, nothing done: {e}")))?;
    let scan_scope = tutor_protect::scan::Scope::Between(&review.tips.base, &review.candidate);
    match &by {
        By::Human { .. } => tutor_protect::scan::guard_commit_as(dir, dir, &scan_scope).map(|_| ()),
        By::Delegation { .. } => tutor_protect::scan::guard_strict(dir, &scan_scope),
    }
    .map_err(fail)?;
    let gtips = gi::Tips {
        target: review.tips.target.clone(),
        base: review.tips.base.clone(),
        branch: review.tips.branch.clone(),
        head: review.tips.head.clone(),
    };
    let commit = gi::integrate(dir, key, &gtips, &review.candidate).map_err(fail)?;
    let _ = audit_as(
        db,
        root,
        &by,
        key,
        "review.integrate",
        command,
        &scope,
        "ok",
        None,
    );
    let who = match &by {
        By::Human { .. } => actor(root),
        By::Delegation { id, granted_by, .. } => {
            format!("{AUTONOMY_ACTOR} — delegação #{id} de {granted_by}")
        }
    };
    let state = store(db)?
        .record_integration(
            root,
            &who,
            now_ms(),
            key,
            review.id,
            &commit,
            &tips.target,
        )
        .map_err(|e| {
            format!(
                "integrated as {commit}, but the Project did not record it: {}",
                e.message
            )
        })?;
    // phase 3: the issue's Co-Dev worktree goes if it is clean (an open session closes it itself)
    let (mut removed, mut kept) = (false, vec![]);
    if session.is_none() {
        if let Ok(rm) = wt::remove_plan(dir, wbase, key) {
            let wscope = format!("worktree of {key}");
            if audit_as(
        db,
        root,
        &by,
        key,
        "worktree.remove",
        &rm.command,
        &wscope,
        "sent",
        None,
    )
            .is_ok()
            {
                let r = wt::remove(dir, wbase, key, Some(&rm.command));
                let (outcome, reason) = match &r {
                    Ok(x) if x.removed => ("ok", None),
                    Ok(x) => (
                        "failed",
                        Some(format!(
                            "kept: uncommitted changes ({})",
                            x.dirty.join(", ")
                        )),
                    ),
                    Err(e) => ("failed", Some(e.clone())),
                };
                let _ = audit_as(
        db,
        root,
        &by,
        key,
        "worktree.remove",
        &rm.command,
        &wscope,
        outcome,
        reason,
    );
                if let Ok(x) = r {
                    removed = x.removed;
                    kept = x.dirty;
                }
            }
        }
    }
    Ok(Integrated {
        key: key.to_string(),
        target: tips.target,
        commit,
        snapshot: snap.id,
        state,
        session,
        worktree_removed: removed,
        worktree_kept: kept,
    })
}

#[cfg(test)]
pub(crate) mod tests;
