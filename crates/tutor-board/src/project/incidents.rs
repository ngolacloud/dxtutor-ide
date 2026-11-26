//! Incidents and the queue's events (r23 F5b, docs/v2/AUDIT-r23.md §4.5 — RF-BK-Q01/Q02, UI-PLAT-12, A01–A03).
//!
//! Owner decision (2026-11-26, §5 Q9): an incident is a local record a person opens — no pager source exists, so
//! on-call and alerts are «not connected». An incident keeps its timeline: evidence a person adds, the checks that
//! were run and the ones that were not (with why), status changes, notes, and the feedback on whether the top
//! cause was right (Co-Dev's precision). The queue keeps what was verified done (with its proof) and what was
//! handed over (recipient and reason, for the Team view).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use super::ProjectError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub id: i64,
    /// `INC-1`, `INC-2`… per project
    pub key: String,
    pub title: String,
    /// `SEV-1` … `SEV-4`
    pub severity: String,
    /// `investigating` | `mitigated` | `resolved`
    pub status: String,
    pub commander: String,
    pub opened_at: i64,
    pub mitigated_at: Option<i64>,
    pub resolved_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IncidentEvent {
    pub id: i64,
    /// `evidence` | `checked` | `not-checked` | `status` | `note` | `feedback`
    pub kind: String,
    pub text: String,
    pub reason: Option<String>,
    pub actor: String,
    pub at: i64,
}

fn invalid(m: &str) -> ProjectError {
    ProjectError {
        code: "invalid".into(),
        message: m.into(),
        overridable: false,
    }
}

const SEVERITIES: &[&str] = &["SEV-1", "SEV-2", "SEV-3", "SEV-4"];
pub const KINDS: &[&str] = &["evidence", "checked", "not-checked", "note"];

pub fn open(
    conn: &Connection,
    root: &str,
    title: &str,
    severity: &str,
    commander: &str,
    at: i64,
) -> Result<Incident, ProjectError> {
    let title = title.trim();
    if title.chars().count() < 3 {
        return Err(invalid("an incident needs a title"));
    }
    if !SEVERITIES.contains(&severity) {
        return Err(invalid("severity is SEV-1 to SEV-4"));
    }
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM incidents WHERE root = ?1",
        params![root],
        |r| r.get(0),
    )?;
    let key = format!("INC-{}", n + 1);
    conn.execute(
        "INSERT INTO incidents (root, key, title, severity, status, commander, opened_at) VALUES (?1, ?2, ?3, ?4, 'investigating', ?5, ?6)",
        params![root, key, title, severity, commander, at],
    )?;
    let id = conn.last_insert_rowid();
    event(conn, id, "status", "investigating", None, commander, at)?;
    Ok(Incident {
        id,
        key,
        title: title.into(),
        severity: severity.into(),
        status: "investigating".into(),
        commander: commander.into(),
        opened_at: at,
        ..Default::default()
    })
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Incident> {
    Ok(Incident {
        id: r.get(0)?,
        key: r.get(1)?,
        title: r.get(2)?,
        severity: r.get(3)?,
        status: r.get(4)?,
        commander: r.get(5)?,
        opened_at: r.get(6)?,
        mitigated_at: r.get(7)?,
        resolved_at: r.get(8)?,
    })
}
const COLS: &str =
    "id, key, title, severity, status, commander, opened_at, mitigated_at, resolved_at";

pub fn list(conn: &Connection, root: &str) -> Result<Vec<Incident>, ProjectError> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM incidents WHERE root = ?1 ORDER BY opened_at DESC, id DESC"
    ))?;
    let rows = st
        .query_map(params![root], row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get(
    conn: &Connection,
    root: &str,
    id: i64,
) -> Result<Option<(Incident, Vec<IncidentEvent>)>, ProjectError> {
    let inc = conn
        .query_row(
            &format!("SELECT {COLS} FROM incidents WHERE root = ?1 AND id = ?2"),
            params![root, id],
            row,
        )
        .optional()?;
    let Some(inc) = inc else { return Ok(None) };
    let mut st = conn.prepare("SELECT id, kind, text, reason, actor, at FROM incident_events WHERE incident_id = ?1 ORDER BY at, id")?;
    let ev = st
        .query_map(params![id], |r| {
            Ok(IncidentEvent {
                id: r.get(0)?,
                kind: r.get(1)?,
                text: r.get(2)?,
                reason: r.get(3)?,
                actor: r.get(4)?,
                at: r.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Some((inc, ev)))
}

fn event(
    conn: &Connection,
    id: i64,
    kind: &str,
    text: &str,
    reason: Option<&str>,
    actor: &str,
    at: i64,
) -> Result<(), ProjectError> {
    conn.execute(
        "INSERT INTO incident_events (incident_id, kind, text, reason, actor, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, kind, text, reason, actor, at],
    )?;
    Ok(())
}

/// Adds evidence, a check run, a check not run (a reason is required), or a note.
#[allow(clippy::too_many_arguments)]
pub fn add(
    conn: &Connection,
    root: &str,
    id: i64,
    kind: &str,
    text: &str,
    reason: Option<&str>,
    actor: &str,
    at: i64,
) -> Result<(), ProjectError> {
    if !KINDS.contains(&kind) {
        return Err(invalid("not an incident event"));
    }
    if text.trim().chars().count() < 2 {
        return Err(invalid("say what"));
    }
    let reason = reason.map(str::trim).filter(|r| !r.is_empty());
    if kind == "not-checked" && reason.map(|r| r.chars().count() < 3).unwrap_or(true) {
        return Err(invalid("a check not run needs the reason it was not run"));
    }
    let (inc, _) = get(conn, root, id)?.ok_or_else(|| invalid("no such incident"))?;
    if inc.status == "resolved" && kind != "note" {
        return Err(invalid("the incident is resolved: add a note"));
    }
    event(conn, id, kind, text.trim(), reason, actor, at)
}

/// Moves an incident on: investigating → mitigated → resolved (resolving needs a summary of what happened).
pub fn set_status(
    conn: &Connection,
    root: &str,
    id: i64,
    status: &str,
    note: &str,
    actor: &str,
    at: i64,
) -> Result<Incident, ProjectError> {
    let (inc, _) = get(conn, root, id)?.ok_or_else(|| invalid("no such incident"))?;
    let ok = matches!(
        (inc.status.as_str(), status),
        ("investigating", "mitigated")
            | ("investigating", "resolved")
            | ("mitigated", "resolved")
            | ("mitigated", "investigating")
    );
    if !ok {
        return Err(invalid(&format!("{} cannot go to {status}", inc.status)));
    }
    if status == "resolved" && note.trim().chars().count() < 3 {
        return Err(invalid("resolving needs a summary of what happened"));
    }
    match status {
        "mitigated" => conn.execute("UPDATE incidents SET status = ?2, mitigated_at = ?3 WHERE id = ?1", params![id, status, at])?,
        "resolved" => conn.execute("UPDATE incidents SET status = ?2, resolved_at = ?3, mitigated_at = COALESCE(mitigated_at, ?3) WHERE id = ?1", params![id, status, at])?,
        _ => conn.execute("UPDATE incidents SET status = ?2 WHERE id = ?1", params![id, status])?,
    };
    event(
        conn,
        id,
        "status",
        status,
        Some(note.trim()).filter(|n| !n.is_empty()),
        actor,
        at,
    )?;
    Ok(get(conn, root, id)?.expect("just updated").0)
}

/// «Was the top cause right?» — once per incident, after it is mitigated.
pub fn feedback(
    conn: &Connection,
    root: &str,
    id: i64,
    right: bool,
    actor: &str,
    at: i64,
) -> Result<(), ProjectError> {
    let (inc, ev) = get(conn, root, id)?.ok_or_else(|| invalid("no such incident"))?;
    if inc.status == "investigating" {
        return Err(invalid(
            "judge the top cause once the incident is mitigated",
        ));
    }
    if ev.iter().any(|e| e.kind == "feedback") {
        return Err(invalid("the top cause was already judged"));
    }
    event(
        conn,
        id,
        "feedback",
        if right { "right" } else { "wrong" },
        None,
        actor,
        at,
    )
}

/// Co-Dev's precision across the project's incidents: (right, judged).
pub fn precision(conn: &Connection, root: &str) -> Result<(i64, i64), ProjectError> {
    let (r, n): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(e.text = 'right'), 0), COUNT(*) FROM incident_events e JOIN incidents i ON i.id = e.incident_id WHERE i.root = ?1 AND e.kind = 'feedback'",
        params![root],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok((r, n))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueueEvent {
    pub id: i64,
    pub item: String,
    /// `done` | `handover`
    pub kind: String,
    pub title: String,
    pub proof: Option<String>,
    pub recipient: Option<String>,
    pub reason: Option<String>,
    pub actor: String,
    pub at: i64,
}

pub fn queue_event(conn: &Connection, root: &str, e: &QueueEvent) -> Result<i64, ProjectError> {
    if e.kind == "handover" {
        if e.recipient
            .as_deref()
            .map(|r| r.trim().is_empty())
            .unwrap_or(true)
        {
            return Err(invalid("handing over needs a recipient"));
        }
        if e.reason
            .as_deref()
            .map(|r| r.trim().chars().count() < 3)
            .unwrap_or(true)
        {
            return Err(invalid("handing over needs a reason"));
        }
    }
    conn.execute(
        "INSERT INTO queue_events (root, item, kind, title, proof, recipient, reason, actor, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![root, e.item, e.kind, e.title, e.proof, e.recipient.as_deref().map(str::trim), e.reason.as_deref().map(str::trim), e.actor, e.at],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn queue_events(conn: &Connection, root: &str) -> Result<Vec<QueueEvent>, ProjectError> {
    let mut st = conn.prepare("SELECT id, item, kind, title, proof, recipient, reason, actor, at FROM queue_events WHERE root = ?1 ORDER BY at DESC, id DESC LIMIT 500")?;
    let rows = st
        .query_map(params![root], |r| {
            Ok(QueueEvent {
                id: r.get(0)?,
                item: r.get(1)?,
                kind: r.get(2)?,
                title: r.get(3)?,
                proof: r.get(4)?,
                recipient: r.get(5)?,
                reason: r.get(6)?,
                actor: r.get(7)?,
                at: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Confidence {
    /// `low` | `medium` | `high`
    pub level: String,
    /// why it is not higher (or what holds it up)
    pub reasons: Vec<String>,
}

/// How much the investigation can be trusted, from what it rests on: the evidence and the checks run, the checks
/// NOT run, and whether a metrics source exists at all. Without one it never goes above «low» — it would be a guess.
pub fn confidence(events: &[IncidentEvent], has_metrics: bool) -> Confidence {
    let n = |k: &str| events.iter().filter(|e| e.kind == k).count();
    let (evidence, checked, unchecked) = (n("evidence"), n("checked"), n("not-checked"));
    let mut reasons = vec![];
    if !has_metrics {
        reasons.push("no metrics source is connected: the causes are hypotheses".into());
    }
    if checked == 0 {
        reasons.push("no check has been run".into());
    }
    if unchecked > 0 {
        reasons.push(format!("{unchecked} check(s) not run"));
    }
    if evidence == 0 {
        reasons.push("no evidence added".into());
    }
    let level = if !has_metrics || checked == 0 {
        "low"
    } else if checked >= 3 && unchecked == 0 && evidence > 0 {
        "high"
    } else {
        "medium"
    };
    if reasons.is_empty() {
        reasons.push(format!(
            "{checked} check(s) run, {evidence} piece(s) of evidence"
        ));
    }
    Confidence {
        level: level.into(),
        reasons,
    }
}
