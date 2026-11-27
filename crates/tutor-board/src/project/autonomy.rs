//! Multi Co-Dev, phase 5: delegated autonomy and pull requests — the data and the pure rules.
//!
//! **The owner's rules.** A change lands only through the integration gate of phase 4 (the
//! mandatory checks on the exact candidate, the reviewer's `met` with evidence on every criterion,
//! and the functional approval for the criteria of now); autonomy never skips any of them, and the
//! functional approval stays a human act it cannot perform. The reviewer never acts on its own
//! unless a human delegated it.
//!
//! - A **delegation** ([`Delegation`]) is what one human handed over, for one issue or one sprint,
//!   until an expiry (at most [`MAX_HOURS`]): `review` (request the review when the issue's Co-Dev
//!   session finishes it), `integrate` (merge locally when the gate is open) or `pr` (push the issue
//!   branch and open a pull request when the gate is open) — never both `integrate` and `pr`. It is
//!   revocable, and granting, revoking and every use go to the audit log.
//! - **Events** ([`Event`]) are every step the autonomy took or refused, with the audit rows it wrote;
//!   no delegation means no event (exactly phase 4).
//! - The **kill switch** ([`Switch`]) is one row for the whole app: the backend reads it before every
//!   action.
//! - **Remote branches** dxtutor created by a push are remembered: it never pushes to a remote branch
//!   it did not create. **Pull requests** it opened are kept with the review they came from.
//!
//! Tables of migration 20. Who may grant (the roles) is the caller's: the store keeps the facts.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::integration::Review;
use super::{audit_insert, err, AuditEntry, FunctionalApproval, ProjectError, ProjectStore};

/// What may be delegated.
pub const ACTIONS: [&str; 3] = ["review", "integrate", "pr"];
/// What a delegation covers.
pub const SCOPES: [&str; 2] = ["issue", "sprint"];
/// The longest a delegation may last (7 days).
pub const MAX_HOURS: i64 = 7 * 24;
pub const HOUR_MS: i64 = 3_600_000;
/// Autonomous actions (a review requested, an integration, a pull request) one project may take in
/// an hour; past it the autonomy stops and says so.
pub const MAX_ACTIONS_PER_HOUR: u32 = 6;

/// What a human asks to delegate.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    /// `issue` or `sprint`
    pub scope: String,
    /// the issue's key or the sprint's id
    pub target: String,
    pub actions: Vec<String>,
    /// how long, in hours (1 to [`MAX_HOURS`])
    pub hours: i64,
    /// the reviewer's provider and model (`review`: the Co-Dev's when the grant was made)
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    /// the language the reviewer answers in
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub note: String,
}

/// One delegation.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Delegation {
    pub id: i64,
    pub scope: String,
    pub target: String,
    pub actions: Vec<String>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub language: Option<String>,
    pub note: String,
    pub granted_by: String,
    pub granted_email: String,
    pub granted_at: i64,
    pub expires_at: i64,
    pub revoked_by: Option<String>,
    pub revoked_at: Option<i64>,
    pub revoke_reason: Option<String>,
}

impl Delegation {
    /// Not revoked and not expired at `now`.
    pub fn active(&self, now: i64) -> bool {
        self.revoked_at.is_none() && now < self.expires_at
    }

    pub fn allows(&self, action: &str) -> bool {
        self.actions.iter().any(|a| a == action)
    }
}

/// One step the autonomy took, or refused to take.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(default)]
    pub id: i64,
    pub key: String,
    /// the delegation it acted under
    pub delegation: Option<i64>,
    /// `review`, `integrate`, `pr`
    pub action: String,
    /// what started it: `session_finished`, `committed`, `review_done`, `functional_approved`
    pub trigger: String,
    /// `started` (a review runs), `ok`, `stopped` (a rule or a fact said no: nothing was changed),
    /// `failed` (it acted and it failed)
    pub outcome: String,
    /// why, as a code the interface words
    pub code: String,
    pub detail: String,
    /// the review it requested or used
    pub review: Option<i64>,
    /// the audit rows it wrote
    pub audit: Vec<i64>,
    pub at: i64,
}

/// The app-wide kill switch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Switch {
    pub paused: bool,
    pub by: Option<String>,
    pub at: Option<i64>,
    pub reason: Option<String>,
}

/// A pull request dxtutor opened for an issue.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    #[serde(default)]
    pub id: i64,
    pub key: String,
    pub review: i64,
    pub remote: String,
    /// the remote's push URL
    pub url: String,
    pub branch: String,
    /// the commit pushed (the reviewed tip of the issue branch)
    pub head: String,
    /// the default branch's tip the review was made on
    pub base: String,
    /// the pull request's base branch
    pub target: String,
    pub number: u64,
    pub pr_url: String,
    pub actor: String,
    pub delegation: Option<i64>,
    pub at: i64,
}

/// How an issue integrates when its gate opens, by its delegations.
#[derive(Debug, Clone, PartialEq)]
pub enum Mode<'a> {
    /// nothing delegated: a human integrates (phase 4)
    Manual,
    Integrate(&'a Delegation),
    Pr(&'a Delegation),
    /// both `integrate` and `pr` are delegated (by two delegations): it does neither and says so
    Ambiguous,
}

/* ───── the pure rules ───── */

/// The grant as it will be stored (trimmed, actions in order), or why it is refused.
pub fn validate_grant(g: &Grant) -> Result<Grant, ProjectError> {
    let scope = g.scope.trim().to_string();
    if !SCOPES.contains(&scope.as_str()) {
        return Err(err(
            "invalid",
            "a delegação é de uma issue ou de uma sprint",
        ));
    }
    let target = g.target.trim().to_string();
    if target.is_empty() || target.len() > 64 {
        return Err(err("invalid", "falta a issue ou a sprint da delegação"));
    }
    let mut actions = vec![];
    for a in &g.actions {
        let a = a.trim();
        if !ACTIONS.contains(&a) {
            return Err(err("invalid", format!("acção desconhecida: {a:?}")));
        }
        if actions.iter().any(|x: &String| x == a) {
            return Err(err("invalid", format!("a acção {a} está repetida")));
        }
        actions.push(a.to_string());
    }
    if actions.is_empty() {
        return Err(err("invalid", "escolhe pelo menos uma acção a delegar"));
    }
    if actions.iter().any(|a| a == "integrate") && actions.iter().any(|a| a == "pr") {
        return Err(err(
            "invalid",
            "integrar localmente e abrir um pull request excluem-se: escolhe um",
        ));
    }
    actions.sort_by_key(|a| ACTIONS.iter().position(|x| x == a));
    if g.hours < 1 || g.hours > MAX_HOURS {
        return Err(err(
            "invalid",
            format!("uma delegação dura de 1 a {MAX_HOURS} horas (7 dias)"),
        ));
    }
    let clean = |v: &Option<String>| {
        v.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let provider = clean(&g.provider);
    if actions.iter().any(|a| a == "review") && provider.is_none() {
        return Err(err(
            "invalid",
            "pedir a revisão sozinho precisa do provedor do revisor (o do Co-Dev)",
        ));
    }
    Ok(Grant {
        scope,
        target,
        actions,
        hours: g.hours,
        provider,
        model: clean(&g.model),
        language: clean(&g.language),
        note: g.note.trim().chars().take(500).collect(),
    })
}

/// The newest active delegation that allows `action`.
pub fn effective<'a>(ds: &'a [Delegation], action: &str, now: i64) -> Option<&'a Delegation> {
    ds.iter()
        .filter(|d| d.active(now) && d.allows(action))
        .max_by_key(|d| (d.granted_at, d.id))
}

/// How the issue integrates when its gate opens.
pub fn mode(ds: &[Delegation], now: i64) -> Mode<'_> {
    match (effective(ds, "integrate", now), effective(ds, "pr", now)) {
        (None, None) => Mode::Manual,
        (Some(d), None) => Mode::Integrate(d),
        (None, Some(d)) => Mode::Pr(d),
        (Some(_), Some(_)) => Mode::Ambiguous,
    }
}

fn cell(s: &str) -> String {
    s.replace('|', "\\|")
        .replace(['\n', '\r'], " ")
        .trim()
        .to_string()
}

/// What the pull request's body carries: the gate's evidence for exactly the reviewed tips.
pub struct BodyInput<'a> {
    pub key: &'a str,
    pub title: &'a str,
    pub review: &'a Review,
    pub functional: Option<&'a FunctionalApproval>,
    /// the delegation it was opened under (`None`: a human approved it in the dialog)
    pub delegation: Option<&'a Delegation>,
    /// who opened it (the human, or the delegation's grantor)
    pub opened_by: &'a str,
}

/// The pull request's body (Markdown): the tips, each mandatory check with the candidate's commit,
/// the reviewer's verdict per criterion with its evidence, who approved functionally and when, and
/// how it was opened. The caller masks secrets before it leaves the machine.
pub fn pr_body(i: &BodyInput) -> String {
    let r = i.review;
    let mut s = format!("## {}: {}\n\n", i.key, cell(i.title));
    s.push_str(
        "Opened by dxtutor after its integration gate held for exactly these tips: the mandatory \
         checks passed on the candidate, the Co-Dev reviewer confirmed every acceptance criterion \
         with evidence, and the functional approval is recorded for these criteria.\n\n",
    );
    s.push_str(&format!(
        "- Branch `{}` at `{}`, onto `{}` at `{}`\n- Candidate (the merge that was checked): `{}`, tree `{}`\n\n",
        r.tips.branch, r.tips.head, r.tips.target, r.tips.base, r.candidate, r.tree
    ));
    s.push_str(&format!(
        "### 1. Mandatory checks — passed on `{}`\n\n| Check | Command | Exit | Time |\n|---|---|---|---|\n",
        r.candidate
    ));
    for c in &r.checks {
        s.push_str(&format!(
            "| {} | `{}` | {} | {:.1} s |\n",
            cell(&c.name),
            cell(&c.command).replace('`', "'"),
            c.exit.map(|e| e.to_string()).unwrap_or_else(|| "?".into()),
            c.ms as f64 / 1000.0
        ));
    }
    s.push_str(if r.arch_rules {
        "\nArchitect's rules: none broken on the candidate.\n\n"
    } else {
        "\nArchitect's rules: the project defines none.\n\n"
    });
    match &r.verdict {
        Some(v) => {
            s.push_str(&format!(
                "### 2. Co-Dev reviewer — {} ({})\n\n{}\n\n| # | Criterion | Verdict | Evidence |\n|---|---|---|---|\n",
                v.overall,
                r.reviewer.as_deref().unwrap_or("?"),
                cell(&v.summary)
            ));
            for c in &v.criteria {
                let ev: Vec<String> = c
                    .evidence
                    .iter()
                    .map(|e| match e.kind.as_str() {
                        "file" => match &e.lines {
                            Some(l) => format!("`{}:{l}`", e.reference),
                            None => format!("`{}`", e.reference),
                        },
                        "test" => format!("test `{}`", e.reference),
                        _ => match &e.detail {
                            Some(d) => format!("output of {} — «{}»", e.reference, d),
                            None => format!("output of {}", e.reference),
                        },
                    })
                    .collect();
                s.push_str(&format!(
                    "| {} | {} | {} | {} |\n",
                    c.index,
                    cell(&c.text),
                    c.status,
                    cell(&ev.join("; "))
                ));
            }
            s.push('\n');
        }
        None => s.push_str("### 2. Co-Dev reviewer — no verdict\n\n"),
    }
    match i.functional {
        Some(f) => s.push_str(&format!(
            "### 3. Functional approval\n\nRecorded by {} on {} UTC, for the criteria above.{}\n\n",
            cell(&f.by),
            super::evidence::when(f.at),
            if f.note.trim().is_empty() {
                String::new()
            } else {
                format!(" Note: {}", cell(&f.note))
            }
        )),
        None => s.push_str("### 3. Functional approval\n\nNot recorded.\n\n"),
    }
    s.push_str("---\n");
    match i.delegation {
        Some(d) => s.push_str(&format!(
            "Opened autonomously under delegation #{} granted by {} (until {} UTC).",
            d.id,
            cell(&d.granted_by),
            super::evidence::when(d.expires_at)
        )),
        None => s.push_str(&format!(
            "Opened by {} with dxtutor's approval dialog.",
            cell(i.opened_by)
        )),
    }
    s.push_str(" dxtutor does not merge pull requests: the merge stays with the reviewers here.\n");
    s
}

/* ───── the store ───── */

const DCOLS: &str = "id, scope, target, actions, provider, model, language, note, granted_by, granted_email, granted_at, expires_at, revoked_by, revoked_at, revoke_reason";

fn drow(r: &rusqlite::Row) -> rusqlite::Result<Delegation> {
    Ok(Delegation {
        id: r.get(0)?,
        scope: r.get(1)?,
        target: r.get(2)?,
        actions: serde_json::from_str(&r.get::<_, String>(3)?).unwrap_or_default(),
        provider: r.get(4)?,
        model: r.get(5)?,
        language: r.get(6)?,
        note: r.get(7)?,
        granted_by: r.get(8)?,
        granted_email: r.get(9)?,
        granted_at: r.get(10)?,
        expires_at: r.get(11)?,
        revoked_by: r.get(12)?,
        revoked_at: r.get(13)?,
        revoke_reason: r.get(14)?,
    })
}

const ECOLS: &str =
    "id, key, delegation, action, trigger, outcome, code, detail, review, audit, at";

fn erow(r: &rusqlite::Row) -> rusqlite::Result<Event> {
    Ok(Event {
        id: r.get(0)?,
        key: r.get(1)?,
        delegation: r.get(2)?,
        action: r.get(3)?,
        trigger: r.get(4)?,
        outcome: r.get(5)?,
        code: r.get(6)?,
        detail: r.get(7)?,
        review: r.get(8)?,
        audit: serde_json::from_str(&r.get::<_, String>(9)?).unwrap_or_default(),
        at: r.get(10)?,
    })
}

const PCOLS: &str = "id, key, review, remote, url, branch, head, base, target, number, pr_url, actor, delegation, at";

fn prow(r: &rusqlite::Row) -> rusqlite::Result<PullRequest> {
    Ok(PullRequest {
        id: r.get(0)?,
        key: r.get(1)?,
        review: r.get(2)?,
        remote: r.get(3)?,
        url: r.get(4)?,
        branch: r.get(5)?,
        head: r.get(6)?,
        base: r.get(7)?,
        target: r.get(8)?,
        number: r.get::<_, i64>(9)?.max(0) as u64,
        pr_url: r.get(10)?,
        actor: r.get(11)?,
        delegation: r.get(12)?,
        at: r.get(13)?,
    })
}

fn delegation(c: &Connection, root: &str, id: i64) -> Result<Option<Delegation>, ProjectError> {
    Ok(c.query_row(
        &format!("SELECT {DCOLS} FROM autonomy_delegations WHERE root = ?1 AND id = ?2"),
        params![root, id],
        drow,
    )
    .optional()?)
}

/// The issue's assignee and sprint (`None`: no such issue).
fn issue_scope(
    c: &Connection,
    root: &str,
    key: &str,
) -> Result<Option<(String, Option<String>)>, ProjectError> {
    Ok(c.query_row(
        "SELECT assignee, sprint FROM issues WHERE root = ?1 AND key = ?2",
        params![root, key],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()?)
}

impl ProjectStore {
    /// Records a delegation and its audit row in one transaction (an audit row that cannot be
    /// written means no delegation). `who`/`email`: the person granting it (the caller checked
    /// their role); `audit`: the row, without its reason (filled here with what was granted).
    pub fn delegation_grant(
        &mut self,
        root: &str,
        g: &Grant,
        who: &str,
        email: &str,
        now: i64,
        mut audit: AuditEntry,
    ) -> Result<(Delegation, i64), ProjectError> {
        let g = validate_grant(g)?;
        let tx = self.conn.transaction()?;
        let exists: bool = if g.scope == "issue" {
            issue_scope(&tx, root, &g.target)?.is_some()
        } else {
            tx.query_row(
                "SELECT COUNT(*) FROM sprints WHERE root = ?1 AND id = ?2",
                params![root, g.target],
                |r| r.get::<_, i64>(0),
            )? > 0
        };
        if !exists {
            return Err(err(
                "not_found",
                format!(
                    "{} {} não existe",
                    if g.scope == "issue" {
                        "a issue"
                    } else {
                        "a sprint"
                    },
                    g.target
                ),
            ));
        }
        let expires = now + g.hours * HOUR_MS;
        tx.execute(
            "INSERT INTO autonomy_delegations (root, scope, target, actions, provider, model, language, note, granted_by, granted_email, granted_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                root,
                g.scope,
                g.target,
                serde_json::to_string(&g.actions).unwrap_or_else(|_| "[]".into()),
                g.provider,
                g.model,
                g.language,
                g.note,
                who,
                email,
                now,
                expires
            ],
        )?;
        let id = tx.last_insert_rowid();
        let d = delegation(&tx, root, id)?.ok_or_else(|| err("db", "delegation lost"))?;
        if audit.issue_key.is_none() && d.scope == "issue" {
            audit.issue_key = Some(d.target.clone());
        }
        audit.reason = Some(format!(
            "delegação #{id}: {} de {} {} até {}{}",
            d.actions.join(", "),
            d.scope,
            d.target,
            super::evidence::when(d.expires_at),
            if d.note.is_empty() {
                String::new()
            } else {
                format!(" — {}", d.note)
            }
        ));
        let audit_id = audit_insert(&tx, root, &audit)?;
        tx.commit()?;
        Ok((d, audit_id))
    }

    /// Revokes a delegation (with its audit row, in one transaction). Revoking one already
    /// revoked or expired is refused (nothing to take back).
    pub fn delegation_revoke(
        &mut self,
        root: &str,
        id: i64,
        who: &str,
        reason: &str,
        now: i64,
        mut audit: AuditEntry,
    ) -> Result<(Delegation, i64), ProjectError> {
        let tx = self.conn.transaction()?;
        let d = delegation(&tx, root, id)?
            .ok_or_else(|| err("not_found", format!("a delegação #{id} não existe")))?;
        if !d.active(now) {
            return Err(err(
                "invalid",
                format!("a delegação #{id} já não está activa"),
            ));
        }
        let reason = reason.trim().chars().take(500).collect::<String>();
        tx.execute(
            "UPDATE autonomy_delegations SET revoked_by = ?3, revoked_at = ?4, revoke_reason = ?5 WHERE root = ?1 AND id = ?2",
            params![root, id, who, now, reason],
        )?;
        let d = delegation(&tx, root, id)?.ok_or_else(|| err("db", "delegation lost"))?;
        if audit.issue_key.is_none() && d.scope == "issue" {
            audit.issue_key = Some(d.target.clone());
        }
        audit.reason = Some(if reason.is_empty() {
            format!("delegação #{id} revogada")
        } else {
            format!("delegação #{id} revogada: {reason}")
        });
        let audit_id = audit_insert(&tx, root, &audit)?;
        tx.commit()?;
        Ok((d, audit_id))
    }

    /// One delegation of the folder.
    pub fn delegation(&self, root: &str, id: i64) -> Result<Option<Delegation>, ProjectError> {
        delegation(&self.conn, root, id)
    }

    /// The folder's delegations, newest first (the last 100).
    pub fn delegations(&self, root: &str) -> Result<Vec<Delegation>, ProjectError> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {DCOLS} FROM autonomy_delegations WHERE root = ?1 ORDER BY id DESC LIMIT 100"
        ))?;
        let rows = st
            .query_map(params![root], drow)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The delegations that cover issue `key` now: its own and its sprint's (active or not — the
    /// caller asks [`effective`]).
    pub fn delegations_for(&self, root: &str, key: &str) -> Result<Vec<Delegation>, ProjectError> {
        let Some((_, sprint)) = issue_scope(&self.conn, root, key)? else {
            return Ok(vec![]);
        };
        let mut st = self.conn.prepare(&format!(
            "SELECT {DCOLS} FROM autonomy_delegations WHERE root = ?1
             AND ((scope = 'issue' AND target = ?2) OR (scope = 'sprint' AND ?3 IS NOT NULL AND target = ?3))
             ORDER BY id DESC"
        ))?;
        let rows = st
            .query_map(params![root, key, sprint], drow)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The issue's assignee and sprint (`None`: no such issue).
    pub fn issue_assignment(
        &self,
        root: &str,
        key: &str,
    ) -> Result<Option<(String, Option<String>)>, ProjectError> {
        issue_scope(&self.conn, root, key)
    }

    /// The kill switch (paused for the whole app, or not).
    pub fn autonomy_switch(&self) -> Result<Switch, ProjectError> {
        Ok(self
            .conn
            .query_row(
                "SELECT paused, by, at, reason FROM autonomy_switch WHERE id = 1",
                [],
                |r| {
                    Ok(Switch {
                        paused: r.get::<_, i64>(0)? != 0,
                        by: r.get(1)?,
                        at: r.get(2)?,
                        reason: r.get(3)?,
                    })
                },
            )
            .optional()?
            .unwrap_or_default())
    }

    /// Pauses (or resumes) every autonomous action of the app, with its audit row (written in
    /// `root`'s log) in the same transaction.
    pub fn set_autonomy_paused(
        &mut self,
        root: &str,
        paused: bool,
        who: &str,
        reason: &str,
        now: i64,
        mut audit: AuditEntry,
    ) -> Result<(Switch, i64), ProjectError> {
        let reason = reason.trim().chars().take(500).collect::<String>();
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO autonomy_switch (id, paused, by, at, reason) VALUES (1, ?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET paused = ?1, by = ?2, at = ?3, reason = ?4",
            params![paused as i64, who, now, reason],
        )?;
        audit.reason = Some(if reason.is_empty() {
            if paused {
                "autonomia em pausa".to_string()
            } else {
                "autonomia retomada".to_string()
            }
        } else {
            reason.clone()
        });
        let audit_id = audit_insert(&tx, root, &audit)?;
        tx.commit()?;
        Ok((
            Switch {
                paused,
                by: Some(who.to_string()),
                at: Some(now),
                reason: Some(reason),
            },
            audit_id,
        ))
    }

    /// Records one step of the autonomy; returns its id.
    pub fn autonomy_event(&mut self, root: &str, e: &Event) -> Result<i64, ProjectError> {
        self.conn.execute(
            "INSERT INTO autonomy_events (root, key, delegation, action, trigger, outcome, code, detail, review, audit, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                root,
                e.key,
                e.delegation,
                e.action,
                e.trigger,
                e.outcome,
                e.code,
                e.detail.chars().take(4000).collect::<String>(),
                e.review,
                serde_json::to_string(&e.audit).unwrap_or_else(|_| "[]".into()),
                e.at
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// The autonomy's steps, newest first: of one issue (`Some`) or of the folder.
    pub fn autonomy_events(
        &self,
        root: &str,
        key: Option<&str>,
        limit: u32,
    ) -> Result<Vec<Event>, ProjectError> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {ECOLS} FROM autonomy_events WHERE root = ?1 AND (?2 IS NULL OR key = ?2) ORDER BY id DESC LIMIT ?3"
        ))?;
        let rows = st
            .query_map(params![root, key, limit.min(500)], erow)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    /// The newest step of `action` on issue `key`.
    pub fn last_autonomy_event(
        &self,
        root: &str,
        key: &str,
        action: &str,
    ) -> Result<Option<Event>, ProjectError> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {ECOLS} FROM autonomy_events WHERE root = ?1 AND key = ?2 AND action = ?3 ORDER BY id DESC LIMIT 1"),
                params![root, key, action],
                erow,
            )
            .optional()?)
    }

    /// How many autonomous actions the folder took since `since` (ms): the ones that did something
    /// (`started`, `ok`, `failed`) — a stop changed nothing and does not count.
    pub fn autonomy_actions_since(&self, root: &str, since: i64) -> Result<u32, ProjectError> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM autonomy_events WHERE root = ?1 AND at >= ?2
             AND action IN ('review', 'integrate', 'pr') AND outcome IN ('started', 'ok', 'failed')",
            params![root, since],
            |r| r.get::<_, i64>(0),
        )? as u32)
    }

    /// dxtutor created `branch` on the remote at `url` (by a push of its own).
    pub fn remote_branch_is_ours(
        &self,
        root: &str,
        url: &str,
        branch: &str,
    ) -> Result<bool, ProjectError> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM remote_branches WHERE root = ?1 AND url = ?2 AND branch = ?3",
            params![root, url, branch],
            |r| r.get::<_, i64>(0),
        )? > 0)
    }

    /// Remembers that a push of dxtutor created `branch` on the remote at `url`.
    pub fn remote_branch_created(
        &mut self,
        root: &str,
        url: &str,
        branch: &str,
        actor: &str,
        now: i64,
    ) -> Result<(), ProjectError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO remote_branches (root, url, branch, actor, at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![root, url, branch, actor, now],
        )?;
        Ok(())
    }

    /// Records a pull request dxtutor opened, and says it in the issue's activity (one transaction).
    pub fn pr_record(&mut self, root: &str, p: &PullRequest) -> Result<i64, ProjectError> {
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO integration_prs (root, key, review, remote, url, branch, head, base, target, number, pr_url, actor, delegation, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                root,
                p.key,
                p.review,
                p.remote,
                p.url,
                p.branch,
                p.head,
                p.base,
                p.target,
                p.number as i64,
                p.pr_url,
                p.actor,
                p.delegation,
                p.at
            ],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "INSERT OR IGNORE INTO issue_links (root, key, kind, ref, title, at) VALUES (?1, ?2, 'pr', ?3, ?4, ?5)",
            params![root, p.key, p.pr_url, format!("pull request #{} para {}", p.number, p.target), p.at],
        )?;
        super::log(
            &tx,
            root,
            &p.key,
            p.at,
            &p.actor,
            "pull_request",
            None,
            None,
            &format!(
                "pull request #{} aberto: {} → {} ({})",
                p.number, p.branch, p.target, p.pr_url
            ),
        )?;
        tx.commit()?;
        Ok(id)
    }

    /// The newest pull request dxtutor opened for issue `key`.
    pub fn pr_latest(&self, root: &str, key: &str) -> Result<Option<PullRequest>, ProjectError> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {PCOLS} FROM integration_prs WHERE root = ?1 AND key = ?2 ORDER BY id DESC LIMIT 1"),
                params![root, key],
                prow,
            )
            .optional()?)
    }
}

#[cfg(test)]
mod tests;
