//! The project store: Kanban, Scrum, XP or Scrum + XP over one SQLite base
//! (docs/v2/UI-AUDIT.md, item 5).
//!
//! - One project per workspace root, with its method, iteration length, WIP limits and
//!   Definition of Ready / Done. Every method uses the same five canonical states
//!   (`todo → progress → review → accept → done`); the UI names them per method.
//! - Every change is an [`Op`] applied atomically by [`ProjectStore::apply`], which
//!   enforces the flow rules here, not only in the UI: one step at a time, WIP limits, the
//!   Definition of Ready to start and of Done to finish, blocked issues stay put. A rule can
//!   be overridden only with a reason, which is recorded in the issue's activity.
//! - The activity log is the history the reports are computed from ([`reports`]); nothing
//!   is invented — with little history, reports come back empty.
//! - Co-Dev change sets (accepted hunks, docs/v2/RF-CODEV-STREAM.md §9) and commits that
//!   cite an issue key are linked to the issue.

pub mod breakpoints;
pub mod reports;
pub mod schema;
pub mod testhist;

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

/// The five canonical states, in flow order.
pub const STATES: [&str; 5] = ["todo", "progress", "review", "accept", "done"];
pub const METHODS: [&str; 4] = ["kanban", "scrum", "xp", "scrumxp"];
const KINDS: [&str; 4] = ["story", "bug", "task", "spike"];
const PRIORITIES: [&str; 3] = ["high", "medium", "low"];
const COS: [&str; 4] = ["expedite", "fixed", "standard", "intangible"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Criterion {
    pub text: String,
    pub done: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub kind: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub title: String,
    pub at: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub key: String,
    pub title: String,
    pub kind: String,
    pub priority: String,
    pub points: Option<u32>,
    pub assignee: String,
    pub pair: String,
    pub epic: String,
    pub cos: String,
    pub blocked: Option<String>,
    pub rank: f64,
    pub state: String,
    pub sprint: Option<String>,
    pub ready: bool,
    pub description: String,
    pub branch: Option<String>,
    pub acceptance: Vec<Criterion>,
    /// One flag per item of the project's Definition of Done.
    pub dod_done: Vec<bool>,
    pub links: Vec<Link>,
    pub change_sets: u32,
    pub created: i64,
    pub updated: i64,
    /// When the issue entered its current state (from the activity log).
    pub since: i64,
    /// The user story (RF-B01): «As {story_as} I want {story_want} so that {story_so}».
    pub story_as: String,
    pub story_want: String,
    pub story_so: String,
    /// Files and folders Co-Dev may change for this issue (RF-G03): `src/**`, `Cargo.toml`.
    pub scope: Vec<String>,
    /// Issues that must be Done first.
    pub deps: Vec<String>,
    /// Who approved the Definition of Ready (`ready`).
    pub ready_by: Option<String>,
    /// Test runs that failed after Co-Dev worked on it (RF-B07; 2 = it stops and asks).
    pub attempts: u32,
    /// The table Co-Dev answered at the end (`finish_issue`, RF-B06): criterion → met → proof.
    pub criteria_report: Option<serde_json::Value>,
    /// The prompt template version the last run used (RF-B04).
    pub template_version: Option<String>,
    /// What the issue still lacks to be Ready (RF-B02); empty: Co-Dev may work on it.
    pub missing: Vec<String>,
    /// The issue's Co-Dev budget in dollars (RF-T03); `None`: no limit.
    pub budget_usd: Option<f64>,
    /// What Co-Dev spent on it (real cost of the turns in the audit log, RF-T04).
    pub spent_usd: f64,
}

/// Does a criterion read as Given/When/Then (or Dado/Quando/Então)?
pub fn is_gwt(text: &str) -> bool {
    let t = text.to_lowercase();
    let has = |a: &[&str]| a.iter().any(|w| t.contains(w));
    has(&["given", "dado"]) && has(&["when", "quando"]) && has(&["then", "então", "entao"])
}

/// What an issue still lacks to be Ready (RF-B02, docs/v2/RF-DELONIX-PLANO.md F4.2): criteria
/// in Given/When/Then, the user story (for stories), a file scope, its dependencies Done, no
/// open question — and, last, a human's approval (`ready`). `states`: every issue's state.
pub fn readiness(i: &Issue, states: &HashMap<String, String>) -> Vec<String> {
    let mut m = vec![];
    if i.acceptance.is_empty() {
        m.push("critérios de aceitação".to_string());
    } else if let Some(c) = i.acceptance.iter().find(|c| !is_gwt(&c.text)) {
        m.push(format!("critério em Dado/Quando/Então: «{}»", c.text));
    }
    if i.kind == "story"
        && (i.story_as.trim().is_empty()
            || i.story_want.trim().is_empty()
            || i.story_so.trim().is_empty())
    {
        m.push("Como / Quero / Para".to_string());
    }
    if i.scope.iter().all(|s| s.trim().is_empty()) {
        m.push("âmbito de ficheiros".to_string());
    }
    for d in &i.deps {
        match states.get(d).map(String::as_str) {
            Some("done") => {}
            Some(_) => m.push(format!("dependência {d} em Done")),
            None => m.push(format!("dependência {d} não existe")),
        }
    }
    if let Some(b) = &i.blocked {
        m.push(format!("bloqueio em aberto: {b}"));
    }
    if !i.ready {
        m.push("aprovação humana (Ready)".to_string());
    }
    m
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Sprint {
    pub id: String,
    pub name: String,
    pub goal: String,
    pub start: i64,
    pub end: i64,
    /// `planned | active | closed`.
    pub state: String,
    pub capacity: Option<u32>,
    /// The sprint's Co-Dev budget in dollars (RF-T03); `None`: no limit.
    pub budget_usd: Option<f64>,
    /// What Co-Dev spent on the sprint's issues (real cost of the turns, audit log).
    pub spent_usd: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub date: i64,
    pub goal: String,
    pub epic: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetroNote {
    pub id: i64,
    pub sprint: Option<String>,
    /// `good | improve | action`.
    pub kind: String,
    pub text: String,
    pub at: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: i64,
    pub title: String,
    pub kind: String,
    pub points: Option<u32>,
    pub source: String,
    pub detail: String,
    pub created: i64,
}

/// Everything the Project views draw, for one workspace.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub root: String,
    pub key_prefix: String,
    pub method: String,
    pub iter_days: u32,
    pub wip: BTreeMap<String, u32>,
    pub dor: Vec<String>,
    pub dod: Vec<String>,
    pub issues: Vec<Issue>,
    pub sprints: Vec<Sprint>,
    pub releases: Vec<Release>,
    pub retro: Vec<RetroNote>,
    pub inbox: Vec<InboxItem>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub at: i64,
    pub actor: String,
    pub kind: String,
    pub from: Option<String>,
    pub to: Option<String>,
    pub note: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSetRow {
    pub session: String,
    pub call: String,
    pub hunk: String,
    pub path: String,
    pub start: u32,
    pub end: u32,
    pub added: u32,
    pub removed: u32,
    pub decided_by: String,
    pub decided_at: i64,
}

/// The issue panel's extra data: its history and the Co-Dev changes linked to it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssueDetail {
    pub activity: Vec<Activity>,
    pub change_sets: Vec<ChangeSetRow>,
    /// Reports of the Co-Dev turns that worked on the issue (HARNESS-07).
    pub reports: Vec<Artifact>,
    /// What Co-Dev used on the issue, summed from the turns in the audit log (RF-B08/T04).
    pub usage: IssueUsage,
}

/// The sum of the Co-Dev turns of one issue (the `turn` rows of the audit log).
#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IssueUsage {
    pub turns: u32,
    pub sessions: u32,
    /// The real model ids the provider reported, in the order they were first used.
    pub models: Vec<String>,
    pub tokens_in: i64,
    pub tokens_out: i64,
    /// The real cost of the priced turns, in dollars.
    pub cost_usd: f64,
    /// Turns with no price (a model not in the table): their cost is not in `cost_usd`.
    pub unpriced: u32,
}

/// The Co-Dev change sets of one issue (`issue_key: None`: of turns that came from the chat
/// or the editor), for the Source Control pane (RF-E08). Newest first.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSetGroup {
    pub issue_key: Option<String>,
    /// The issue's title (empty without an issue, or when the issue was deleted).
    pub title: String,
    pub rows: Vec<ChangeSetRow>,
}

/// The report of a Co-Dev turn.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: i64,
    pub session: String,
    pub at: i64,
    pub title: String,
    pub markdown: String,
}

/// A change set to record (one accepted hunk), from the Co-Dev host.
/// One row of the Co-Dev audit log (RF-T01). `event`: `call` (a decision on a tool call),
/// `mode` (the human changed the mode) or `turn` (a turn ended: model and tokens).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuditEntry {
    #[serde(default)]
    pub id: i64,
    pub at: i64,
    pub session: String,
    pub event: String,
    /// `chat`, `editor`, `issue`, or `none` (an action with no human request: blocked).
    pub origin: String,
    pub issue_key: Option<String>,
    /// Who made the request.
    pub actor: String,
    /// `manual`, `assist` or `auto`.
    pub mode: String,
    pub tool: Option<String>,
    pub call: Option<String>,
    pub path: Option<String>,
    /// `40-52`, or the hunks' ranges.
    pub lines: Option<String>,
    pub command: Option<String>,
    /// What the policy said: `allow`, `ask` or `deny`.
    pub verdict: Option<String>,
    /// What happened: `allowed`, `denied` or `blocked`.
    pub outcome: Option<String>,
    /// `policy` (the mode or a rule decided), `human:<name>`, `validation`, `cancel`.
    pub decided_by: Option<String>,
    pub decided_at: Option<i64>,
    pub reason: Option<String>,
    pub model: Option<String>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    /// Who was driving in a PairCode session (RF-P04; empty outside one).
    pub driver: Option<String>,
    /// The turn's cost in dollars from the provider's real tokens (RF-T04; `None`: model not
    /// priced, or not a turn).
    #[serde(default)]
    pub cost_usd: Option<f64>,
}

/// One test run on a commit (r23 F3, UI-SCM-09).
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub sha: String,
    /// the working tree had uncommitted changes when it ran
    pub dirty: bool,
    pub at: i64,
    pub runner: String,
    pub command: String,
    pub passed: i64,
    pub failed: i64,
    pub ignored: i64,
    pub ok: bool,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewChangeSet {
    pub session: String,
    pub call: String,
    pub hunk: String,
    pub path: String,
    pub start: u32,
    pub end: u32,
    pub added: u32,
    pub removed: u32,
    /// `human` (Manual/Assist) or `validation` (Auto, after the checks passed).
    pub decided_by: String,
    pub issue_key: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub subject: String,
    pub at: i64,
}

/// `None` → leave as is; `Some(None)` → clear; `Some(Some(v))` → set.
fn double<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

/// One change to a project. Applied atomically, with the rules checked in Rust.
#[derive(Deserialize, Clone, Debug)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    Settings {
        #[serde(default)]
        method: Option<String>,
        #[serde(default)]
        iter_days: Option<u32>,
        #[serde(default)]
        wip: Option<BTreeMap<String, u32>>,
        #[serde(default)]
        dor: Option<Vec<String>>,
        #[serde(default)]
        dod: Option<Vec<String>>,
        #[serde(default)]
        key_prefix: Option<String>,
    },
    CreateIssue {
        title: String,
        #[serde(default = "story")]
        kind: String,
        #[serde(default = "medium")]
        priority: String,
        #[serde(default)]
        points: Option<u32>,
        #[serde(default)]
        epic: String,
        #[serde(default)]
        description: String,
        #[serde(default)]
        acceptance: Vec<String>,
        #[serde(default)]
        sprint: Option<String>,
    },
    UpdateIssue {
        key: String,
        #[serde(default)]
        title: Option<String>,
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        priority: Option<String>,
        #[serde(default, deserialize_with = "double")]
        points: Option<Option<u32>>,
        #[serde(default)]
        assignee: Option<String>,
        #[serde(default)]
        pair: Option<String>,
        #[serde(default)]
        epic: Option<String>,
        #[serde(default)]
        cos: Option<String>,
        #[serde(default, deserialize_with = "double")]
        blocked: Option<Option<String>>,
        #[serde(default)]
        ready: Option<bool>,
        #[serde(default)]
        description: Option<String>,
        #[serde(default, deserialize_with = "double")]
        branch: Option<Option<String>>,
        #[serde(default)]
        dod_done: Option<Vec<bool>>,
        #[serde(default)]
        story_as: Option<String>,
        #[serde(default)]
        story_want: Option<String>,
        #[serde(default)]
        story_so: Option<String>,
        #[serde(default)]
        scope: Option<Vec<String>>,
        #[serde(default)]
        deps: Option<Vec<String>>,
        /// RF-T03: the issue's budget in dollars (`null` removes it).
        #[serde(default, deserialize_with = "double")]
        budget_usd: Option<Option<f64>>,
    },
    /// RF-T03: the sprint's Co-Dev budget in dollars (`null` removes it).
    SetSprintBudget {
        id: String,
        #[serde(default)]
        budget_usd: Option<f64>,
    },
    /// Co-Dev answered every acceptance criterion (`finish_issue`, RF-B06): the table and the
    /// template version are kept on the issue, which goes to Review. Done stays human.
    CodevFinished {
        key: String,
        report: serde_json::Value,
        #[serde(default)]
        template_version: Option<String>,
    },
    /// The project's tests after Co-Dev worked on the issue (RF-B07): a failure sends it back
    /// to In progress with the error; the second failure blocks it until a human helps.
    TestsRun {
        key: String,
        passed: bool,
        #[serde(default)]
        summary: String,
    },
    SetAcceptance {
        key: String,
        items: Vec<Criterion>,
    },
    Move {
        key: String,
        to: String,
        /// Overrides a rule (WIP, DoR, DoD, skipping states, blocked); recorded.
        #[serde(default)]
        reason: Option<String>,
    },
    /// Puts `key` just before `before` in the order (at the end when `None`).
    Rank {
        key: String,
        #[serde(default)]
        before: Option<String>,
    },
    DeleteIssue {
        key: String,
    },
    Comment {
        key: String,
        text: String,
    },
    CreateSprint {
        name: String,
        #[serde(default)]
        goal: String,
        start: i64,
        end: i64,
        #[serde(default)]
        capacity: Option<u32>,
    },
    StartSprint {
        id: String,
    },
    /// Closes the sprint; unfinished issues go to `carry_to` (another sprint) or back to
    /// the backlog.
    CloseSprint {
        id: String,
        #[serde(default)]
        carry_to: Option<String>,
    },
    PlanIssue {
        key: String,
        #[serde(default)]
        sprint: Option<String>,
    },
    CreateRelease {
        version: String,
        date: i64,
        #[serde(default)]
        goal: String,
        #[serde(default)]
        epic: String,
    },
    DeleteRelease {
        version: String,
    },
    RetroAdd {
        kind: String,
        text: String,
        #[serde(default)]
        sprint: Option<String>,
    },
    RetroDelete {
        id: i64,
    },
    /// A proposal (from the Architecture Studio, the Learning Track, a retro action…) waits
    /// in the inbox until a human accepts or dismisses it.
    Propose {
        title: String,
        #[serde(default = "story")]
        kind: String,
        #[serde(default)]
        points: Option<u32>,
        source: String,
        #[serde(default)]
        detail: String,
    },
    AcceptProposal {
        id: i64,
    },
    DismissProposal {
        id: i64,
    },
    /// Commits whose subject cites issue keys (read from `git log`) are linked to them.
    LinkCommits {
        commits: Vec<Commit>,
    },
}

fn story() -> String {
    "story".into()
}
fn medium() -> String {
    "medium".into()
}

/// A refused change: `code` says which rule, so the UI can offer an override with reason.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectError {
    /// `not_found | invalid | step | wip | dor | dod | blocked | db`.
    pub code: String,
    pub message: String,
    /// The rule may be overridden with a reason (`Op::Move { reason }`).
    pub overridable: bool,
}

impl std::fmt::Display for ProjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ProjectError {}

fn err(code: &str, message: impl Into<String>) -> ProjectError {
    ProjectError {
        code: code.into(),
        message: message.into(),
        overridable: false,
    }
}
fn rule(code: &str, message: impl Into<String>) -> ProjectError {
    ProjectError {
        code: code.into(),
        message: message.into(),
        overridable: true,
    }
}
impl From<rusqlite::Error> for ProjectError {
    fn from(e: rusqlite::Error) -> Self {
        err("db", e.to_string())
    }
}

/// Default key prefix from the folder name: its first letters, upper case (`dxtutor` → `DXT`).
pub fn default_prefix(root: &str) -> String {
    let name = Path::new(root.trim_end_matches(['/', '\\']))
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let p: String = name
        .chars()
        .filter(|c| c.is_ascii_alphabetic())
        .take(3)
        .collect::<String>()
        .to_uppercase();
    if p.len() < 2 {
        "DX".into()
    } else {
        p
    }
}

const DAY_MS: i64 = 86_400_000;

pub struct ProjectStore {
    conn: Connection,
}

impl ProjectStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        Self::from_conn(conn)
    }

    pub fn in_memory() -> Result<Self, String> {
        Self::from_conn(Connection::open_in_memory().map_err(|e| e.to_string())?)
    }

    fn from_conn(mut conn: Connection) -> Result<Self, String> {
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| e.to_string())?;
        schema::migrate(&mut conn)?;
        Ok(Self { conn })
    }

    /// The raw connection (tests and the legacy import).
    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    /// Creates the project of `root` on first use: empty, with the method's defaults.
    fn ensure(conn: &Connection, root: &str, now: i64) -> Result<(), ProjectError> {
        conn.execute(
            "INSERT OR IGNORE INTO projects (root, key_prefix, seq, method, iter_days, wip, dor, dod, created, updated)
             VALUES (?1, ?2, 0, 'kanban', 14, ?3, '[]', '[]', ?4, ?4)",
            params![root, default_prefix(root), r#"{"progress":3,"review":2,"accept":2}"#, now],
        )?;
        Ok(())
    }

    /// The whole project of `root` (created empty on first use).
    pub fn load(&self, root: &str, now: i64) -> Result<Project, ProjectError> {
        Self::ensure(&self.conn, root, now)?;
        read_project(&self.conn, root)
    }

    /// Applies one change atomically and returns the project after it.
    pub fn apply(
        &mut self,
        root: &str,
        actor: &str,
        now: i64,
        op: Op,
    ) -> Result<Project, ProjectError> {
        let tx = self.conn.transaction()?;
        Self::ensure(&tx, root, now)?;
        apply_op(&tx, root, actor, now, op)?;
        tx.execute(
            "UPDATE projects SET updated = ?2 WHERE root = ?1",
            params![root, now],
        )?;
        tx.commit()?;
        read_project(&self.conn, root)
    }

    pub fn detail(&self, root: &str, key: &str) -> Result<IssueDetail, ProjectError> {
        let mut st = self.conn.prepare(
            "SELECT at, actor, kind, from_state, to_state, note FROM activity WHERE root = ?1 AND key = ?2 ORDER BY at DESC, id DESC LIMIT 200",
        )?;
        let activity = st
            .query_map(params![root, key], |r| {
                Ok(Activity {
                    at: r.get(0)?,
                    actor: r.get(1)?,
                    kind: r.get(2)?,
                    from: r.get(3)?,
                    to: r.get(4)?,
                    note: r.get(5)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut cs = self.conn.prepare(
            "SELECT session, call, hunk, path, start, end_line, added, removed, decided_by, decided_at
             FROM change_sets WHERE root = ?1 AND issue_key = ?2 ORDER BY decided_at DESC, id DESC",
        )?;
        let change_sets = cs
            .query_map(params![root, key], |r| {
                Ok(ChangeSetRow {
                    session: r.get(0)?,
                    call: r.get(1)?,
                    hunk: r.get(2)?,
                    path: r.get(3)?,
                    start: r.get(4)?,
                    end: r.get(5)?,
                    added: r.get(6)?,
                    removed: r.get(7)?,
                    decided_by: r.get(8)?,
                    decided_at: r.get(9)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        let mut ar = self.conn.prepare(
            "SELECT id, session, at, title, markdown FROM artifacts WHERE root = ?1 AND issue_key = ?2 ORDER BY at DESC, id DESC LIMIT 50",
        )?;
        let reports = ar
            .query_map(params![root, key], |r| {
                Ok(Artifact {
                    id: r.get(0)?,
                    session: r.get(1)?,
                    at: r.get(2)?,
                    title: r.get(3)?,
                    markdown: r.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(IssueDetail {
            activity,
            change_sets,
            reports,
            usage: self.usage(root, key)?,
        })
    }

    /// The sum of the issue's Co-Dev turns (RF-B08/T04).
    fn usage(&self, root: &str, key: &str) -> Result<IssueUsage, ProjectError> {
        let mut u = self.conn.query_row(
            "SELECT COUNT(*), COUNT(DISTINCT session), COALESCE(SUM(tokens_in), 0), COALESCE(SUM(tokens_out), 0),
                    COALESCE(SUM(cost_usd), 0), SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END)
             FROM audit WHERE root = ?1 AND issue_key = ?2 AND event = 'turn'",
            params![root, key],
            |r| {
                Ok(IssueUsage {
                    turns: r.get(0)?,
                    sessions: r.get(1)?,
                    models: Vec::new(),
                    tokens_in: r.get(2)?,
                    tokens_out: r.get(3)?,
                    cost_usd: r.get(4)?,
                    unpriced: r.get::<_, Option<u32>>(5)?.unwrap_or(0),
                })
            },
        )?;
        let mut st = self.conn.prepare(
            "SELECT model FROM audit WHERE root = ?1 AND issue_key = ?2 AND event = 'turn' AND model IS NOT NULL AND model <> ''
             GROUP BY model ORDER BY MIN(at), MIN(id)",
        )?;
        u.models = st
            .query_map(params![root, key], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(u)
    }

    /// The Co-Dev change sets decided at or after `since` (ms), grouped by issue, the most
    /// recent group first (RF-E08). The Source Control pane passes the time of the last commit:
    /// what was accepted before it is, as a rule, already committed.
    pub fn change_sets_since(
        &self,
        root: &str,
        since: i64,
    ) -> Result<Vec<ChangeSetGroup>, ProjectError> {
        let mut st = self.conn.prepare(
            "SELECT c.session, c.call, c.hunk, c.path, c.start, c.end_line, c.added, c.removed, c.decided_by, c.decided_at,
                    c.issue_key, COALESCE(i.title, '')
             FROM change_sets c LEFT JOIN issues i ON i.root = c.root AND i.key = c.issue_key
             WHERE c.root = ?1 AND c.decided_at >= ?2
             ORDER BY c.decided_at DESC, c.id DESC LIMIT 2000",
        )?;
        let mut groups: Vec<ChangeSetGroup> = Vec::new();
        for r in st.query_map(params![root, since], |r| {
            Ok((
                ChangeSetRow {
                    session: r.get(0)?,
                    call: r.get(1)?,
                    hunk: r.get(2)?,
                    path: r.get(3)?,
                    start: r.get(4)?,
                    end: r.get(5)?,
                    added: r.get(6)?,
                    removed: r.get(7)?,
                    decided_by: r.get(8)?,
                    decided_at: r.get(9)?,
                },
                r.get::<_, Option<String>>(10)?,
                r.get::<_, String>(11)?,
            ))
        })? {
            let (row, key, title) = r?;
            match groups.iter_mut().find(|g| g.issue_key == key) {
                Some(g) => g.rows.push(row),
                None => groups.push(ChangeSetGroup {
                    issue_key: key,
                    title,
                    rows: vec![row],
                }),
            }
        }
        Ok(groups)
    }

    /// Records the report of a Co-Dev turn, linked to its issue when it has one.
    pub fn record_artifact(
        &mut self,
        root: &str,
        session: &str,
        issue_key: Option<&str>,
        title: &str,
        markdown: &str,
        now: i64,
    ) -> Result<(), ProjectError> {
        self.conn.execute(
            "INSERT INTO artifacts (root, session, issue_key, at, title, markdown) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![root, session, issue_key, now, title, markdown],
        )?;
        Ok(())
    }

    /// Records one accepted hunk; linked to its issue when the turn came from one.
    pub fn record_change_set(
        &mut self,
        root: &str,
        cs: &NewChangeSet,
        now: i64,
    ) -> Result<(), ProjectError> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO change_sets (root, session, call, hunk, path, start, end_line, added, removed, decided_by, decided_at, issue_key)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![root, cs.session, cs.call, cs.hunk, cs.path, cs.start, cs.end, cs.added, cs.removed, cs.decided_by, now, cs.issue_key],
        )?;
        if let Some(k) = &cs.issue_key {
            log(
                &tx,
                root,
                k,
                now,
                "Co-Dev",
                "change_set",
                None,
                None,
                &format!("{} +{} −{}", cs.path, cs.added, cs.removed),
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Appends one row to the audit log (the caller masks secrets first).
    pub fn record_audit(&mut self, root: &str, e: &AuditEntry) -> Result<(), ProjectError> {
        self.conn.execute(
            "INSERT INTO audit (root, at, session, event, origin, issue_key, actor, mode, tool, call, path, lines, command,
                                verdict, outcome, decided_by, decided_at, reason, model, tokens_in, tokens_out, driver, cost_usd)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            params![
                root, e.at, e.session, e.event, e.origin, e.issue_key, e.actor, e.mode, e.tool, e.call, e.path,
                e.lines, e.command, e.verdict, e.outcome, e.decided_by, e.decided_at, e.reason, e.model,
                e.tokens_in, e.tokens_out, e.driver, e.cost_usd
            ],
        )?;
        Ok(())
    }

    /// Records one test run on a commit (r23 F3, UI-SCM-09).
    pub fn record_test_result(&mut self, root: &str, r: &TestResult) -> Result<(), ProjectError> {
        self.conn.execute(
            "INSERT INTO test_results (root, sha, dirty, at, runner, command, passed, failed, ignored, ok)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![root, r.sha, r.dirty, r.at, r.runner, r.command, r.passed, r.failed, r.ignored, r.ok],
        )?;
        Ok(())
    }

    /// The test runs on these commits (full hashes or prefixes of 7+), newest first.
    pub fn test_results_for(
        &self,
        root: &str,
        shas: &[String],
    ) -> Result<Vec<TestResult>, ProjectError> {
        let mut out = Vec::new();
        let mut st = self.conn.prepare(
            "SELECT sha, dirty, at, runner, command, passed, failed, ignored, ok FROM test_results
             WHERE root = ?1 AND sha LIKE ?2 || '%' ORDER BY at DESC, id DESC LIMIT 20",
        )?;
        for sha in shas
            .iter()
            .filter(|s| s.len() >= 7 && s.chars().all(|c| c.is_ascii_hexdigit()))
        {
            let rows = st.query_map(params![root, sha], |r| {
                Ok(TestResult {
                    sha: r.get(0)?,
                    dirty: r.get(1)?,
                    at: r.get(2)?,
                    runner: r.get(3)?,
                    command: r.get(4)?,
                    passed: r.get(5)?,
                    failed: r.get(6)?,
                    ignored: r.get(7)?,
                    ok: r.get(8)?,
                })
            })?;
            for row in rows {
                out.push(row?);
            }
        }
        Ok(out)
    }

    /// The audit log of a folder, oldest first: of one issue (`Some`) or all of it.
    pub fn audit(
        &self,
        root: &str,
        issue_key: Option<&str>,
    ) -> Result<Vec<AuditEntry>, ProjectError> {
        let mut st = self.conn.prepare(
            "SELECT id, at, session, event, origin, issue_key, actor, mode, tool, call, path, lines, command,
                    verdict, outcome, decided_by, decided_at, reason, model, tokens_in, tokens_out, driver, cost_usd
             FROM audit WHERE root = ?1 AND (?2 IS NULL OR issue_key = ?2) ORDER BY at, id",
        )?;
        let rows = st
            .query_map(params![root, issue_key], |r| {
                Ok(AuditEntry {
                    id: r.get(0)?,
                    at: r.get(1)?,
                    session: r.get(2)?,
                    event: r.get(3)?,
                    origin: r.get(4)?,
                    issue_key: r.get(5)?,
                    actor: r.get(6)?,
                    mode: r.get(7)?,
                    tool: r.get(8)?,
                    call: r.get(9)?,
                    path: r.get(10)?,
                    lines: r.get(11)?,
                    command: r.get(12)?,
                    verdict: r.get(13)?,
                    outcome: r.get(14)?,
                    decided_by: r.get(15)?,
                    decided_at: r.get(16)?,
                    reason: r.get(17)?,
                    model: r.get(18)?,
                    tokens_in: r.get(19)?,
                    tokens_out: r.get(20)?,
                    driver: r.get(21)?,
                    cost_usd: r.get(22)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The gutter's breakpoints of the project (DBG-03).
    pub fn breakpoints(&self, root: &str) -> Result<Vec<breakpoints::Breakpoint>, ProjectError> {
        breakpoints::load(&self.conn, root)
    }

    /// Replaces the breakpoints of one file of the project.
    pub fn save_breakpoints(
        &mut self,
        root: &str,
        file: &str,
        list: &[breakpoints::Breakpoint],
    ) -> Result<(), ProjectError> {
        breakpoints::save_file(&mut self.conn, root, file, list)
    }

    /// Keeps a test run with its per-test results (TEST-03).
    pub fn record_test_run(
        &mut self,
        root: &str,
        run: &testhist::NewRun,
        now: i64,
    ) -> Result<i64, ProjectError> {
        let tx = self.conn.transaction()?;
        let id = testhist::record(&tx, root, run, now)?;
        tx.commit()?;
        Ok(id)
    }

    /// The recent runs and each test's recent results, flips and flakiness.
    pub fn test_history(
        &self,
        root: &str,
        limit: usize,
    ) -> Result<testhist::TestHistory, ProjectError> {
        testhist::history(&self.conn, root, limit)
    }

    pub fn reports(&self, root: &str, now: i64) -> Result<reports::Reports, ProjectError> {
        Self::ensure(&self.conn, root, now)?;
        reports::compute(&self.conn, root, now)
    }
}

#[allow(clippy::too_many_arguments)]
fn log(
    c: &Connection,
    root: &str,
    key: &str,
    at: i64,
    actor: &str,
    kind: &str,
    from: Option<&str>,
    to: Option<&str>,
    note: &str,
) -> rusqlite::Result<()> {
    c.execute(
        "INSERT INTO activity (root, key, at, actor, kind, from_state, to_state, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![root, key, at, actor, kind, from, to, note],
    )?;
    Ok(())
}

fn json<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

fn one_of(v: &str, set: &[&str], what: &str) -> Result<(), ProjectError> {
    if set.contains(&v) {
        Ok(())
    } else {
        Err(err(
            "invalid",
            format!("{what} desconhecido: {v} (válidos: {})", set.join(", ")),
        ))
    }
}

struct IssueRow {
    state: String,
    ready: bool,
    blocked: Option<String>,
    dod_done: Vec<bool>,
}

fn issue_row(c: &Connection, root: &str, key: &str) -> Result<IssueRow, ProjectError> {
    c.query_row(
        "SELECT state, ready, blocked, dod_done FROM issues WHERE root = ?1 AND key = ?2",
        params![root, key],
        |r| {
            let dod: String = r.get(3)?;
            Ok(IssueRow {
                state: r.get(0)?,
                ready: r.get(1)?,
                blocked: r.get(2)?,
                dod_done: serde_json::from_str(&dod).unwrap_or_default(),
            })
        },
    )
    .optional()?
    .ok_or_else(|| err("not_found", format!("a issue {key} não existe")))
}

/// method, WIP limits, DoR, DoD.
type Settings = (String, BTreeMap<String, u32>, Vec<String>, Vec<String>);

fn settings(c: &Connection, root: &str) -> Result<Settings, ProjectError> {
    Ok(c.query_row(
        "SELECT method, wip, dor, dod FROM projects WHERE root = ?1",
        params![root],
        |r| {
            let wip: String = r.get(1)?;
            let dor: String = r.get(2)?;
            let dod: String = r.get(3)?;
            Ok((
                r.get(0)?,
                serde_json::from_str(&wip).unwrap_or_default(),
                serde_json::from_str(&dor).unwrap_or_default(),
                serde_json::from_str(&dod).unwrap_or_default(),
            ))
        },
    )?)
}

fn next_rank(c: &Connection, root: &str) -> rusqlite::Result<f64> {
    let m: Option<f64> = c.query_row(
        "SELECT MAX(rank) FROM issues WHERE root = ?1",
        params![root],
        |r| r.get(0),
    )?;
    Ok(m.map_or(0.0, |x| x + 1.0))
}

fn new_key(c: &Connection, root: &str) -> rusqlite::Result<String> {
    c.execute(
        "UPDATE projects SET seq = seq + 1 WHERE root = ?1",
        params![root],
    )?;
    let (p, n): (String, i64) = c.query_row(
        "SELECT key_prefix, seq FROM projects WHERE root = ?1",
        params![root],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(format!("{p}-{n}"))
}

#[allow(clippy::too_many_arguments)]
fn insert_issue(
    c: &Connection,
    root: &str,
    actor: &str,
    now: i64,
    title: &str,
    kind: &str,
    priority: &str,
    points: Option<u32>,
    epic: &str,
    description: &str,
    acceptance: &[String],
    sprint: Option<&str>,
    origin: &str,
) -> Result<String, ProjectError> {
    if title.trim().is_empty() {
        return Err(err("invalid", "a issue precisa de um título"));
    }
    one_of(kind, &KINDS, "tipo")?;
    one_of(priority, &PRIORITIES, "prioridade")?;
    let key = new_key(c, root)?;
    let rank = next_rank(c, root)?;
    c.execute(
        "INSERT INTO issues (root, key, title, kind, priority, points, epic, rank, state, sprint, ready, description, created, updated)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'todo', ?9, 0, ?10, ?11, ?11)",
        params![root, key, title.trim(), kind, priority, points, epic, rank, sprint, description, now],
    )?;
    for (i, t) in acceptance
        .iter()
        .filter(|t| !t.trim().is_empty())
        .enumerate()
    {
        c.execute(
            "INSERT INTO acceptance (root, key, ord, text, done) VALUES (?1, ?2, ?3, ?4, 0)",
            params![root, key, i as i64, t.trim()],
        )?;
    }
    log(
        c,
        root,
        &key,
        now,
        actor,
        "created",
        None,
        Some("todo"),
        origin,
    )?;
    Ok(key)
}

fn apply_op(c: &Connection, root: &str, actor: &str, now: i64, op: Op) -> Result<(), ProjectError> {
    match op {
        Op::Settings {
            method,
            iter_days,
            wip,
            dor,
            dod,
            key_prefix,
        } => {
            if let Some(m) = &method {
                one_of(m, &METHODS, "método")?;
                c.execute(
                    "UPDATE projects SET method = ?2 WHERE root = ?1",
                    params![root, m],
                )?;
            }
            if let Some(d) = iter_days {
                if !(1..=60).contains(&d) {
                    return Err(err("invalid", "a iteração tem de ter entre 1 e 60 dias"));
                }
                c.execute(
                    "UPDATE projects SET iter_days = ?2 WHERE root = ?1",
                    params![root, d],
                )?;
            }
            if let Some(w) = &wip {
                if let Some(k) = w.keys().find(|k| !STATES.contains(&k.as_str())) {
                    return Err(err("invalid", format!("estado desconhecido no WIP: {k}")));
                }
                c.execute(
                    "UPDATE projects SET wip = ?2 WHERE root = ?1",
                    params![root, json(w)],
                )?;
            }
            if let Some(v) = &dor {
                c.execute(
                    "UPDATE projects SET dor = ?2 WHERE root = ?1",
                    params![root, json(v)],
                )?;
            }
            if let Some(v) = &dod {
                c.execute(
                    "UPDATE projects SET dod = ?2 WHERE root = ?1",
                    params![root, json(v)],
                )?;
            }
            if let Some(p) = &key_prefix {
                let p = p.trim().to_uppercase();
                if p.is_empty() || p.len() > 8 || !p.chars().all(|ch| ch.is_ascii_alphanumeric()) {
                    return Err(err(
                        "invalid",
                        "o prefixo das chaves tem de ter 1 a 8 letras ou dígitos",
                    ));
                }
                c.execute(
                    "UPDATE projects SET key_prefix = ?2 WHERE root = ?1",
                    params![root, p],
                )?;
            }
        }
        Op::CreateIssue {
            title,
            kind,
            priority,
            points,
            epic,
            description,
            acceptance,
            sprint,
        } => {
            if let Some(s) = &sprint {
                sprint_exists(c, root, s)?;
            }
            insert_issue(
                c,
                root,
                actor,
                now,
                &title,
                &kind,
                &priority,
                points,
                &epic,
                &description,
                &acceptance,
                sprint.as_deref(),
                "",
            )?;
        }
        Op::UpdateIssue {
            key,
            title,
            kind,
            priority,
            points,
            assignee,
            pair,
            epic,
            cos,
            blocked,
            ready,
            description,
            branch,
            dod_done,
            story_as,
            story_want,
            story_so,
            scope,
            deps,
            budget_usd,
        } => {
            issue_row(c, root, &key)?;
            if let Some(b) = &budget_usd {
                if b.is_some_and(|v| v.is_nan() || v < 0.0) {
                    return Err(err(
                        "invalid",
                        "o orçamento é um valor em dólares, 0 ou mais",
                    ));
                }
            }
            let mut changed: Vec<&str> = vec![];
            let set = |col: &str, v: &dyn rusqlite::ToSql| -> Result<(), ProjectError> {
                c.execute(
                    &format!(
                        "UPDATE issues SET {col} = ?3, updated = ?4 WHERE root = ?1 AND key = ?2"
                    ),
                    params![root, key, v, now],
                )?;
                Ok(())
            };
            if let Some(t) = &title {
                if t.trim().is_empty() {
                    return Err(err("invalid", "a issue precisa de um título"));
                }
                set("title", &t.trim())?;
                changed.push("título");
            }
            if let Some(k) = &kind {
                one_of(k, &KINDS, "tipo")?;
                set("kind", k)?;
                changed.push("tipo");
            }
            if let Some(p) = &priority {
                one_of(p, &PRIORITIES, "prioridade")?;
                set("priority", p)?;
                changed.push("prioridade");
            }
            if let Some(p) = &points {
                set("points", p)?;
                changed.push("estimativa");
            }
            if let Some(a) = &assignee {
                set("assignee", a)?;
                changed.push("responsável");
            }
            if let Some(p) = &pair {
                set("pair", p)?;
                changed.push("par");
            }
            if let Some(e) = &epic {
                set("epic", e)?;
                changed.push("épico");
            }
            if let Some(v) = &cos {
                one_of(v, &COS, "classe de serviço")?;
                set("cos", v)?;
                changed.push("classe de serviço");
            }
            if let Some(b) = &blocked {
                set("blocked", b)?;
                log(
                    c,
                    root,
                    &key,
                    now,
                    actor,
                    if b.is_some() { "blocked" } else { "unblocked" },
                    None,
                    None,
                    b.as_deref().unwrap_or(""),
                )?;
            }
            for (col, v, label) in [
                ("story_as", &story_as, "como"),
                ("story_want", &story_want, "quero"),
                ("story_so", &story_so, "para"),
            ] {
                if let Some(v) = v {
                    set(col, &v.trim())?;
                    changed.push(label);
                }
            }
            let clean = |v: &Vec<String>| -> Vec<String> {
                v.iter()
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            };
            if let Some(v) = &scope {
                set("scope", &json(&clean(v)))?;
                changed.push("âmbito");
            }
            if let Some(b) = &budget_usd {
                set("budget_usd", b)?;
                changed.push("orçamento");
            }
            if let Some(v) = &deps {
                let v = clean(v);
                if v.contains(&key) {
                    return Err(err("invalid", "uma issue não depende de si própria"));
                }
                set("deps", &json(&v))?;
                changed.push("dependências");
            }
            if let Some(r) = ready {
                // RF-B02: Ready only with the rest of the Definition of Ready complete
                if r {
                    let p = read_project(c, root)?;
                    let states: HashMap<String, String> = p
                        .issues
                        .iter()
                        .map(|i| (i.key.clone(), i.state.clone()))
                        .collect();
                    if let Some(i) = p.issues.iter().find(|i| i.key == key) {
                        let missing: Vec<String> = readiness(i, &states)
                            .into_iter()
                            .filter(|m| m != "aprovação humana (Ready)")
                            .collect();
                        if !missing.is_empty() {
                            return Err(err(
                                "dor",
                                format!("ainda não está Ready — falta: {}", missing.join("; ")),
                            ));
                        }
                    }
                }
                set("ready", &r)?;
                set("ready_by", &r.then(|| actor.to_string()))?;
                changed.push(if r { "pronta (DoR)" } else { "não pronta" });
            }
            if let Some(d) = &description {
                set("description", d)?;
                changed.push("descrição");
            }
            if let Some(b) = &branch {
                set("branch", b)?;
                log(
                    c,
                    root,
                    &key,
                    now,
                    actor,
                    "branch",
                    None,
                    None,
                    b.as_deref().unwrap_or(""),
                )?;
            }
            if let Some(d) = &dod_done {
                set("dod_done", &json(d))?;
                changed.push("DoD");
            }
            if !changed.is_empty() {
                log(
                    c,
                    root,
                    &key,
                    now,
                    actor,
                    "edited",
                    None,
                    None,
                    &changed.join(", "),
                )?;
            }
        }
        Op::SetSprintBudget { id, budget_usd } => {
            sprint_exists(c, root, &id)?;
            if budget_usd.is_some_and(|v| v.is_nan() || v < 0.0) {
                return Err(err(
                    "invalid",
                    "o orçamento é um valor em dólares, 0 ou mais",
                ));
            }
            c.execute(
                "UPDATE sprints SET budget_usd = ?3 WHERE root = ?1 AND id = ?2",
                params![root, id, budget_usd],
            )?;
        }
        Op::CodevFinished {
            key,
            report,
            template_version,
        } => {
            let row = issue_row(c, root, &key)?;
            c.execute(
                "UPDATE issues SET criteria_report = ?3, template_version = COALESCE(?4, template_version), updated = ?5 WHERE root = ?1 AND key = ?2",
                params![root, key, json(&report), template_version, now],
            )?;
            log(
                c,
                root,
                &key,
                now,
                actor,
                "criteria",
                None,
                None,
                "o Co-Dev respondeu aos critérios",
            )?;
            if row.state != "review" && row.state != "accept" && row.state != "done" {
                c.execute(
                    "UPDATE issues SET state = 'review', updated = ?3 WHERE root = ?1 AND key = ?2",
                    params![root, key, now],
                )?;
                log(
                    c,
                    root,
                    &key,
                    now,
                    actor,
                    "moved",
                    Some(&row.state),
                    Some("review"),
                    "critérios respondidos (RF-B06)",
                )?;
            }
        }
        Op::TestsRun {
            key,
            passed,
            summary,
        } => {
            let row = issue_row(c, root, &key)?;
            if passed {
                c.execute(
                    "UPDATE issues SET attempts = 0, updated = ?3 WHERE root = ?1 AND key = ?2",
                    params![root, key, now],
                )?;
                log(
                    c,
                    root,
                    &key,
                    now,
                    actor,
                    "tests",
                    None,
                    None,
                    "os testes passaram",
                )?;
            } else {
                let attempts: u32 = c.query_row(
                    "SELECT attempts FROM issues WHERE root = ?1 AND key = ?2",
                    params![root, key],
                    |r| r.get(0),
                )?;
                let attempts = attempts + 1;
                let blocked = (attempts >= 2).then(|| {
                    format!("precisa de ajuda: os testes falharam {attempts} vezes — {summary}")
                });
                c.execute(
                    "UPDATE issues SET attempts = ?3, state = 'progress', blocked = COALESCE(?4, blocked), updated = ?5 WHERE root = ?1 AND key = ?2",
                    params![root, key, attempts, blocked, now],
                )?;
                log(
                    c,
                    root,
                    &key,
                    now,
                    actor,
                    "tests",
                    None,
                    None,
                    &format!("os testes falharam: {summary}"),
                )?;
                if row.state != "progress" {
                    log(
                        c,
                        root,
                        &key,
                        now,
                        actor,
                        "moved",
                        Some(&row.state),
                        Some("progress"),
                        "testes falharam (RF-B07)",
                    )?;
                }
            }
        }
        Op::SetAcceptance { key, items } => {
            issue_row(c, root, &key)?;
            c.execute(
                "DELETE FROM acceptance WHERE root = ?1 AND key = ?2",
                params![root, key],
            )?;
            for (i, it) in items
                .iter()
                .filter(|i| !i.text.trim().is_empty())
                .enumerate()
            {
                c.execute(
                    "INSERT INTO acceptance (root, key, ord, text, done) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![root, key, i as i64, it.text.trim(), it.done],
                )?;
            }
            c.execute(
                "UPDATE issues SET updated = ?3 WHERE root = ?1 AND key = ?2",
                params![root, key, now],
            )?;
            log(
                c,
                root,
                &key,
                now,
                actor,
                "edited",
                None,
                None,
                "critérios de aceitação",
            )?;
        }
        Op::Move { key, to, reason } => {
            move_issue(c, root, actor, now, &key, &to, reason.as_deref())?
        }
        Op::Rank { key, before } => {
            issue_row(c, root, &key)?;
            let r = match &before {
                None => next_rank(c, root)?,
                Some(b) => {
                    let rb: f64 = c
                        .query_row(
                            "SELECT rank FROM issues WHERE root = ?1 AND key = ?2",
                            params![root, b],
                            |r| r.get(0),
                        )
                        .optional()?
                        .ok_or_else(|| err("not_found", format!("a issue {b} não existe")))?;
                    let prev: Option<f64> = c.query_row(
                        "SELECT MAX(rank) FROM issues WHERE root = ?1 AND rank < ?2 AND key <> ?3",
                        params![root, rb, key],
                        |r| r.get(0),
                    )?;
                    match prev {
                        Some(p) => (p + rb) / 2.0,
                        None => rb - 1.0,
                    }
                }
            };
            c.execute(
                "UPDATE issues SET rank = ?3 WHERE root = ?1 AND key = ?2",
                params![root, key, r],
            )?;
        }
        Op::DeleteIssue { key } => {
            issue_row(c, root, &key)?;
            for t in ["issues", "acceptance", "issue_links"] {
                c.execute(
                    &format!("DELETE FROM {t} WHERE root = ?1 AND key = ?2"),
                    params![root, key],
                )?;
            }
            log(c, root, &key, now, actor, "deleted", None, None, "")?;
        }
        Op::Comment { key, text } => {
            issue_row(c, root, &key)?;
            if text.trim().is_empty() {
                return Err(err("invalid", "comentário vazio"));
            }
            log(
                c,
                root,
                &key,
                now,
                actor,
                "comment",
                None,
                None,
                text.trim(),
            )?;
        }
        Op::CreateSprint {
            name,
            goal,
            start,
            end,
            capacity,
        } => {
            if name.trim().is_empty() || end <= start {
                return Err(err(
                    "invalid",
                    "a sprint precisa de nome e de um fim depois do início",
                ));
            }
            let n: i64 = c.query_row(
                "SELECT COUNT(*) FROM sprints WHERE root = ?1",
                params![root],
                |r| r.get(0),
            )?;
            let id = format!("S{}", n + 1);
            c.execute(
                "INSERT INTO sprints (root, id, name, goal, start, end, state, capacity) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'planned', ?7)",
                params![root, id, name.trim(), goal, start, end, capacity],
            )?;
        }
        Op::StartSprint { id } => {
            sprint_exists(c, root, &id)?;
            let active: Option<String> = c
                .query_row(
                    "SELECT id FROM sprints WHERE root = ?1 AND state = 'active'",
                    params![root],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(a) = active {
                return Err(err(
                    "invalid",
                    format!("a sprint {a} ainda está activa: fecha-a primeiro"),
                ));
            }
            c.execute(
                "UPDATE sprints SET state = 'active' WHERE root = ?1 AND id = ?2",
                params![root, id],
            )?;
        }
        Op::CloseSprint { id, carry_to } => {
            sprint_exists(c, root, &id)?;
            if let Some(t) = &carry_to {
                sprint_exists(c, root, t)?;
            }
            let open: Vec<String> = {
                let mut st = c.prepare(
                    "SELECT key FROM issues WHERE root = ?1 AND sprint = ?2 AND state <> 'done'",
                )?;
                let v = st
                    .query_map(params![root, id], |r| r.get(0))?
                    .collect::<Result<_, _>>()?;
                v
            };
            for k in &open {
                c.execute(
                    "UPDATE issues SET sprint = ?3 WHERE root = ?1 AND key = ?2",
                    params![root, k, carry_to],
                )?;
                log(
                    c,
                    root,
                    k,
                    now,
                    actor,
                    "planned",
                    None,
                    None,
                    &format!(
                        "transitou da {id} para {}",
                        carry_to.as_deref().unwrap_or("backlog")
                    ),
                )?;
            }
            c.execute(
                "UPDATE sprints SET state = 'closed' WHERE root = ?1 AND id = ?2",
                params![root, id],
            )?;
        }
        Op::PlanIssue { key, sprint } => {
            issue_row(c, root, &key)?;
            if let Some(s) = &sprint {
                sprint_exists(c, root, s)?;
            }
            c.execute(
                "UPDATE issues SET sprint = ?3, updated = ?4 WHERE root = ?1 AND key = ?2",
                params![root, key, sprint, now],
            )?;
            log(
                c,
                root,
                &key,
                now,
                actor,
                "planned",
                None,
                None,
                sprint.as_deref().unwrap_or("backlog"),
            )?;
        }
        Op::CreateRelease {
            version,
            date,
            goal,
            epic,
        } => {
            if version.trim().is_empty() {
                return Err(err("invalid", "a release precisa de uma versão"));
            }
            c.execute(
                "INSERT INTO releases (root, version, date, goal, epic) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![root, version.trim(), date, goal, epic],
            )
            .map_err(|_| err("invalid", format!("a release {version} já existe")))?;
        }
        Op::DeleteRelease { version } => {
            c.execute(
                "DELETE FROM releases WHERE root = ?1 AND version = ?2",
                params![root, version],
            )?;
        }
        Op::RetroAdd { kind, text, sprint } => {
            one_of(&kind, &["good", "improve", "action"], "tipo de nota")?;
            if text.trim().is_empty() {
                return Err(err("invalid", "nota vazia"));
            }
            c.execute(
                "INSERT INTO retro (root, sprint, kind, text, at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![root, sprint, kind, text.trim(), now],
            )?;
        }
        Op::RetroDelete { id } => {
            c.execute(
                "DELETE FROM retro WHERE root = ?1 AND id = ?2",
                params![root, id],
            )?;
        }
        Op::Propose {
            title,
            kind,
            points,
            source,
            detail,
        } => {
            if title.trim().is_empty() {
                return Err(err("invalid", "a proposta precisa de um título"));
            }
            one_of(&kind, &KINDS, "tipo")?;
            c.execute(
                "INSERT INTO inbox (root, title, kind, points, source, detail, state, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
                params![root, title.trim(), kind, points, source, detail, now],
            )?;
        }
        Op::AcceptProposal { id } => {
            let (title, kind, points, source, detail): (String, String, Option<u32>, String, String) = c
                .query_row(
                    "SELECT title, kind, points, source, detail FROM inbox WHERE root = ?1 AND id = ?2 AND state = 'pending'",
                    params![root, id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                )
                .optional()?
                .ok_or_else(|| err("not_found", "a proposta já não está na caixa de entrada"))?;
            insert_issue(
                c,
                root,
                actor,
                now,
                &title,
                &kind,
                "medium",
                points,
                "",
                &detail,
                &[],
                None,
                &format!("aceite da caixa de entrada ({source})"),
            )?;
            c.execute(
                "UPDATE inbox SET state = 'accepted' WHERE root = ?1 AND id = ?2",
                params![root, id],
            )?;
        }
        Op::DismissProposal { id } => {
            c.execute("UPDATE inbox SET state = 'dismissed' WHERE root = ?1 AND id = ?2 AND state = 'pending'", params![root, id])?;
        }
        Op::LinkCommits { commits } => {
            let prefix: String = c.query_row(
                "SELECT key_prefix FROM projects WHERE root = ?1",
                params![root],
                |r| r.get(0),
            )?;
            let re = regex_lite(&prefix);
            for cm in commits {
                for key in re(&cm.subject) {
                    let exists: bool = c
                        .query_row(
                            "SELECT 1 FROM issues WHERE root = ?1 AND key = ?2",
                            params![root, key],
                            |_| Ok(true),
                        )
                        .optional()?
                        .is_some();
                    if !exists {
                        continue;
                    }
                    let n = c.execute(
                        "INSERT OR IGNORE INTO issue_links (root, key, kind, ref, title, at) VALUES (?1, ?2, 'commit', ?3, ?4, ?5)",
                        params![root, key, cm.hash, cm.subject, cm.at],
                    )?;
                    if n > 0 {
                        log(
                            c,
                            root,
                            &key,
                            cm.at,
                            "git",
                            "commit",
                            None,
                            None,
                            &format!("{} {}", &cm.hash[..cm.hash.len().min(7)], cm.subject),
                        )?;
                    }
                }
            }
        }
    }
    Ok(())
}

/// Keys `PREFIX-123` cited in a commit subject (case-insensitive prefix, whole words).
fn regex_lite(prefix: &str) -> impl Fn(&str) -> Vec<String> + '_ {
    move |s: &str| {
        let up = s.to_uppercase();
        let p = prefix.to_uppercase();
        let b = up.as_bytes();
        let mut out = vec![];
        let mut i = 0;
        while let Some(off) = up[i..].find(&format!("{p}-")) {
            let at = i + off;
            let before_ok = at == 0 || !b[at - 1].is_ascii_alphanumeric();
            let digits: String = up[at + p.len() + 1..]
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect();
            if before_ok && !digits.is_empty() {
                let key = format!("{p}-{digits}");
                if !out.contains(&key) {
                    out.push(key);
                }
            }
            i = at + p.len() + 1;
        }
        out
    }
}

fn sprint_exists(c: &Connection, root: &str, id: &str) -> Result<(), ProjectError> {
    c.query_row(
        "SELECT 1 FROM sprints WHERE root = ?1 AND id = ?2",
        params![root, id],
        |_| Ok(()),
    )
    .optional()?
    .ok_or_else(|| err("not_found", format!("a sprint {id} não existe")))
}

/// The flow rules (PROJ-02/03), checked before a move; `reason` overrides them.
fn move_issue(
    c: &Connection,
    root: &str,
    actor: &str,
    now: i64,
    key: &str,
    to: &str,
    reason: Option<&str>,
) -> Result<(), ProjectError> {
    one_of(to, &STATES, "estado")?;
    let row = issue_row(c, root, key)?;
    if row.state == to {
        return Ok(());
    }
    let (method, wip, _dor, dod) = settings(c, root)?;
    let from_i = STATES.iter().position(|s| *s == row.state).unwrap_or(0);
    let to_i = STATES.iter().position(|s| *s == to).unwrap_or(0);
    let forward = to_i > from_i;
    let reason = reason.map(str::trim).filter(|r| !r.is_empty());
    let mut broken: Vec<ProjectError> = vec![];
    if from_i.abs_diff(to_i) > 1 {
        broken.push(rule(
            "step",
            format!("{key} só anda um passo de cada vez ({} → {to})", row.state),
        ));
    }
    if forward {
        if let Some(b) = &row.blocked {
            broken.push(rule("blocked", format!("{key} está bloqueada: {b}")));
        }
        if let Some(limit) = wip.get(to) {
            let n: u32 = c.query_row(
                "SELECT COUNT(*) FROM issues WHERE root = ?1 AND state = ?2 AND key <> ?3",
                params![root, to, key],
                |r| r.get(0),
            )?;
            if n >= *limit {
                broken.push(rule(
                    "wip",
                    format!("o limite de WIP de «{to}» é {limit} e já há {n}"),
                ));
            }
        }
        if row.state == "todo" && method != "kanban" && !row.ready {
            broken.push(rule(
                "dor",
                format!("{key} ainda não cumpre a Definition of Ready"),
            ));
        }
        if to == "done" {
            let open: u32 = c.query_row(
                "SELECT COUNT(*) FROM acceptance WHERE root = ?1 AND key = ?2 AND done = 0",
                params![root, key],
                |r| r.get(0),
            )?;
            let dod_missing = (0..dod.len())
                .filter(|i| !row.dod_done.get(*i).copied().unwrap_or(false))
                .count();
            if open > 0 || dod_missing > 0 {
                broken.push(rule(
                    "dod",
                    format!("{key} não cumpre a Definition of Done ({open} critério(s) por cumprir, {dod_missing} item(ns) da DoD por marcar)"),
                ));
            }
        }
    }
    if let Some(first) = broken.first() {
        if reason.is_none() {
            return Err(first.clone());
        }
    }
    c.execute(
        "UPDATE issues SET state = ?3, updated = ?4 WHERE root = ?1 AND key = ?2",
        params![root, key, to, now],
    )?;
    let note = match (broken.is_empty(), reason) {
        (false, Some(r)) => format!(
            "excepção ({}): {r}",
            broken
                .iter()
                .map(|b| b.code.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        _ => String::new(),
    };
    log(
        c,
        root,
        key,
        now,
        actor,
        if broken.is_empty() {
            "moved"
        } else {
            "override"
        },
        Some(&row.state),
        Some(to),
        &note,
    )?;
    Ok(())
}

fn read_project(c: &Connection, root: &str) -> Result<Project, ProjectError> {
    let (key_prefix, method, iter_days, wip, dor, dod): (
        String,
        String,
        u32,
        String,
        String,
        String,
    ) = c.query_row(
        "SELECT key_prefix, method, iter_days, wip, dor, dod FROM projects WHERE root = ?1",
        params![root],
        |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
            ))
        },
    )?;
    let mut acc: BTreeMap<String, Vec<Criterion>> = BTreeMap::new();
    {
        let mut st =
            c.prepare("SELECT key, text, done FROM acceptance WHERE root = ?1 ORDER BY key, ord")?;
        for r in st.query_map(params![root], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Criterion {
                    text: r.get(1)?,
                    done: r.get(2)?,
                },
            ))
        })? {
            let (k, cr) = r?;
            acc.entry(k).or_default().push(cr);
        }
    }
    let mut links: BTreeMap<String, Vec<Link>> = BTreeMap::new();
    {
        let mut st = c.prepare(
            "SELECT key, kind, ref, title, at FROM issue_links WHERE root = ?1 ORDER BY at DESC",
        )?;
        for r in st.query_map(params![root], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Link {
                    kind: r.get(1)?,
                    reference: r.get(2)?,
                    title: r.get(3)?,
                    at: r.get(4)?,
                },
            ))
        })? {
            let (k, l) = r?;
            links.entry(k).or_default().push(l);
        }
    }
    let mut cs: BTreeMap<String, u32> = BTreeMap::new();
    {
        let mut st = c.prepare("SELECT issue_key, COUNT(*) FROM change_sets WHERE root = ?1 AND issue_key IS NOT NULL GROUP BY issue_key")?;
        for r in st.query_map(params![root], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?))
        })? {
            let (k, n) = r?;
            cs.insert(k, n);
        }
    }
    let mut since: BTreeMap<String, i64> = BTreeMap::new();
    {
        let mut st = c.prepare("SELECT key, MAX(at) FROM activity WHERE root = ?1 AND to_state IS NOT NULL GROUP BY key")?;
        for r in st.query_map(params![root], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })? {
            let (k, t) = r?;
            since.insert(k, t);
        }
    }
    let mut st = c.prepare(
        "SELECT key, title, kind, priority, points, assignee, pair, epic, cos, blocked, rank, state, sprint, ready, description, branch, dod_done, created, updated,
                story_as, story_want, story_so, scope, deps, ready_by, attempts, criteria_report, template_version, budget_usd
         FROM issues WHERE root = ?1 ORDER BY rank, key",
    )?;
    let issues = st
        .query_map(params![root], |r| {
            let key: String = r.get(0)?;
            let dod_done: String = r.get(16)?;
            let created: i64 = r.get(17)?;
            Ok(Issue {
                title: r.get(1)?,
                kind: r.get(2)?,
                priority: r.get(3)?,
                points: r.get(4)?,
                assignee: r.get(5)?,
                pair: r.get(6)?,
                epic: r.get(7)?,
                cos: r.get(8)?,
                blocked: r.get(9)?,
                rank: r.get(10)?,
                state: r.get(11)?,
                sprint: r.get(12)?,
                ready: r.get(13)?,
                description: r.get(14)?,
                branch: r.get(15)?,
                acceptance: acc.get(&key).cloned().unwrap_or_default(),
                dod_done: serde_json::from_str(&dod_done).unwrap_or_default(),
                links: links.get(&key).cloned().unwrap_or_default(),
                change_sets: cs.get(&key).copied().unwrap_or(0),
                created,
                updated: r.get(18)?,
                since: since.get(&key).copied().unwrap_or(created),
                story_as: r.get(19)?,
                story_want: r.get(20)?,
                story_so: r.get(21)?,
                scope: serde_json::from_str(&r.get::<_, String>(22)?).unwrap_or_default(),
                deps: serde_json::from_str(&r.get::<_, String>(23)?).unwrap_or_default(),
                ready_by: r.get(24)?,
                attempts: r.get(25)?,
                criteria_report: r
                    .get::<_, Option<String>>(26)?
                    .and_then(|s| serde_json::from_str(&s).ok()),
                template_version: r.get(27)?,
                missing: vec![],
                budget_usd: r.get(28)?,
                spent_usd: 0.0,
                key,
            })
        })?
        .collect::<Result<Vec<Issue>, _>>()?;
    let states: HashMap<String, String> = issues
        .iter()
        .map(|i| (i.key.clone(), i.state.clone()))
        .collect();
    // RF-T03/T04: what Co-Dev spent on each issue — the real cost of its turns
    let mut spent: HashMap<String, f64> = HashMap::new();
    {
        let mut st = c.prepare(
            "SELECT issue_key, SUM(cost_usd) FROM audit WHERE root = ?1 AND issue_key IS NOT NULL AND cost_usd IS NOT NULL GROUP BY issue_key",
        )?;
        for r in st.query_map(params![root], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))
        })? {
            let (k, v) = r?;
            spent.insert(k, v);
        }
    }
    let issues: Vec<Issue> = issues
        .into_iter()
        .map(|mut i| {
            i.missing = readiness(&i, &states);
            i.spent_usd = spent.get(&i.key).copied().unwrap_or(0.0);
            i
        })
        .collect();
    let sprints = {
        let mut st = c.prepare("SELECT id, name, goal, start, end, state, capacity, budget_usd FROM sprints WHERE root = ?1 ORDER BY start, id")?;
        let v = st
            .query_map(params![root], |r| {
                Ok(Sprint {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    goal: r.get(2)?,
                    start: r.get(3)?,
                    end: r.get(4)?,
                    state: r.get(5)?,
                    capacity: r.get(6)?,
                    budget_usd: r.get(7)?,
                    spent_usd: 0.0,
                })
            })?
            .collect::<Result<Vec<Sprint>, _>>()?;
        v
    };
    let sprints: Vec<Sprint> = sprints
        .into_iter()
        .map(|mut sp: Sprint| {
            sp.spent_usd = issues
                .iter()
                .filter(|i| i.sprint.as_deref() == Some(sp.id.as_str()))
                .map(|i| i.spent_usd)
                .sum();
            sp
        })
        .collect();
    let releases = {
        let mut st = c.prepare(
            "SELECT version, date, goal, epic FROM releases WHERE root = ?1 ORDER BY date",
        )?;
        let v = st
            .query_map(params![root], |r| {
                Ok(Release {
                    version: r.get(0)?,
                    date: r.get(1)?,
                    goal: r.get(2)?,
                    epic: r.get(3)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    let retro = {
        let mut st = c.prepare(
            "SELECT id, sprint, kind, text, at FROM retro WHERE root = ?1 ORDER BY at, id",
        )?;
        let v = st
            .query_map(params![root], |r| {
                Ok(RetroNote {
                    id: r.get(0)?,
                    sprint: r.get(1)?,
                    kind: r.get(2)?,
                    text: r.get(3)?,
                    at: r.get(4)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    let inbox = {
        let mut st = c.prepare("SELECT id, title, kind, points, source, detail, created FROM inbox WHERE root = ?1 AND state = 'pending' ORDER BY created, id")?;
        let v = st
            .query_map(params![root], |r| {
                Ok(InboxItem {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    kind: r.get(2)?,
                    points: r.get(3)?,
                    source: r.get(4)?,
                    detail: r.get(5)?,
                    created: r.get(6)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    Ok(Project {
        root: root.to_string(),
        key_prefix,
        method,
        iter_days,
        wip: serde_json::from_str(&wip).unwrap_or_default(),
        dor: serde_json::from_str(&dor).unwrap_or_default(),
        dod: serde_json::from_str(&dod).unwrap_or_default(),
        issues,
        sprints,
        releases,
        retro,
        inbox,
    })
}

/// Milliseconds → whole days (UTC), for the reports.
pub fn day_of(ms: i64) -> i64 {
    ms.div_euclid(DAY_MS)
}

#[cfg(test)]
mod tests;
