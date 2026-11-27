//! Accepted IaC risks and ignored drift (r23 F4b, docs/v2/AUDIT-r23.md §4.4 — P03/P04): a finding of
//! the IaC pipeline (or a drifted resource) a human accepted, with a reason, for a limited time.
//! The pipeline gets the keys still in force and stops blocking the apply on them; when one
//! expires, it blocks again. Who and when are decided by the caller (the backend), never the UI.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::ProjectError;

/// The longest an acceptance can last.
pub const MAX_DAYS: i64 = 30;
const DAY_MS: i64 = 24 * 3600 * 1000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptedRisk {
    pub id: i64,
    /// the finding's key (or `drift:<dir>:<address>`)
    pub key: String,
    /// `finding` | `drift`
    pub kind: String,
    /// what was accepted, as the human saw it (`checkov CKV_AWS_18 · infra/main.tf:5`)
    pub label: String,
    pub reason: String,
    pub actor: String,
    pub at: i64,
    pub expires: i64,
}

fn invalid(m: &str) -> ProjectError {
    ProjectError {
        code: "invalid".into(),
        message: m.into(),
        overridable: false,
    }
}

/// Keeps an acceptance for `days` (1–30) from `now`. A reason is required.
#[allow(clippy::too_many_arguments)]
pub fn accept(
    conn: &Connection,
    root: &str,
    key: &str,
    kind: &str,
    label: &str,
    reason: &str,
    actor: &str,
    now: i64,
    days: i64,
) -> Result<AcceptedRisk, ProjectError> {
    let reason = reason.trim();
    if reason.chars().count() < 3 {
        return Err(invalid("an accepted risk needs a reason"));
    }
    if key.trim().is_empty() || !matches!(kind, "finding" | "drift") {
        return Err(invalid("not a finding or a drift"));
    }
    let days = days.clamp(1, MAX_DAYS);
    let clip = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let r = AcceptedRisk {
        id: 0,
        key: clip(key, 500),
        kind: kind.into(),
        label: clip(label, 500),
        reason: clip(reason, 2000),
        actor: actor.into(),
        at: now,
        expires: now + days * DAY_MS,
    };
    conn.execute(
        "INSERT INTO iac_accepted (root, key, kind, label, reason, actor, at, expires) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![root, r.key, r.kind, r.label, r.reason, r.actor, r.at, r.expires],
    )?;
    Ok(AcceptedRisk {
        id: conn.last_insert_rowid(),
        ..r
    })
}

/// The acceptances still in force at `now`, newest first.
pub fn active(conn: &Connection, root: &str, now: i64) -> Result<Vec<AcceptedRisk>, ProjectError> {
    let mut st = conn.prepare(
        "SELECT id, key, kind, label, reason, actor, at, expires FROM iac_accepted
         WHERE root = ?1 AND expires > ?2 ORDER BY at DESC, id DESC",
    )?;
    let rows = st
        .query_map(params![root, now], |r| {
            Ok(AcceptedRisk {
                id: r.get(0)?,
                key: r.get(1)?,
                kind: r.get(2)?,
                label: r.get(3)?,
                reason: r.get(4)?,
                actor: r.get(5)?,
                at: r.get(6)?,
                expires: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Ends an acceptance now (it stays in the table, expired). Returns what was revoked.
pub fn revoke(
    conn: &Connection,
    root: &str,
    id: i64,
    now: i64,
) -> Result<Option<AcceptedRisk>, ProjectError> {
    let found = active(conn, root, now)?.into_iter().find(|r| r.id == id);
    if found.is_some() {
        conn.execute(
            "UPDATE iac_accepted SET expires = ?3 WHERE root = ?1 AND id = ?2",
            params![root, id, now],
        )?;
    }
    Ok(found)
}
