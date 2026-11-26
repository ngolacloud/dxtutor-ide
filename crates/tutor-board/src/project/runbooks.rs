//! Runbook runs (r23 F5a, docs/v2/AUDIT-r23.md §4.5 — RF-BK-R02): each step a person ran (or decided) —
//! the command, its output (secrets masked by the runner), the exit code, the result against the
//! expectation (or the person's judgement), who and when. A complete run is exportable evidence.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::ProjectError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunbookStepRun {
    #[serde(default)]
    pub id: i64,
    /// the run this step belongs to (several steps, one run)
    pub run_id: String,
    pub path: String,
    pub runbook: String,
    pub n: u32,
    pub title: String,
    /// `check` | `action` | `decision`
    pub kind: String,
    pub command: String,
    pub exit_code: Option<i32>,
    pub output: String,
    pub expect: String,
    /// against the expectation: checked by the runner, or judged by the person; none = not judged
    pub matched: Option<bool>,
    /// a decision's text, or why the person judged the result so
    pub note: Option<String>,
    pub actor: String,
    pub at: i64,
    pub ms: i64,
}

pub fn record(conn: &Connection, root: &str, r: &RunbookStepRun) -> Result<i64, ProjectError> {
    conn.execute(
        "INSERT INTO runbook_runs (root, run_id, path, runbook, n, title, kind, command, exit_code, output, expect, matched, note, actor, at, ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![root, r.run_id, r.path, r.runbook, r.n, r.title, r.kind, r.command, r.exit_code, r.output, r.expect, r.matched, r.note, r.actor, r.at, r.ms],
    )?;
    Ok(conn.last_insert_rowid())
}

/// The person's judgement of a step's result (prose expectations), by the step's row.
pub fn judge(
    conn: &Connection,
    root: &str,
    id: i64,
    matched: bool,
    note: &str,
) -> Result<bool, ProjectError> {
    let n = conn.execute(
        "UPDATE runbook_runs SET matched = ?3, note = ?4 WHERE root = ?1 AND id = ?2",
        params![root, id, matched, note],
    )?;
    Ok(n > 0)
}

const COLS: &str = "id, run_id, path, runbook, n, title, kind, command, exit_code, output, expect, matched, note, actor, at, ms";

fn row(r: &rusqlite::Row) -> rusqlite::Result<RunbookStepRun> {
    Ok(RunbookStepRun {
        id: r.get(0)?,
        run_id: r.get(1)?,
        path: r.get(2)?,
        runbook: r.get(3)?,
        n: r.get(4)?,
        title: r.get(5)?,
        kind: r.get(6)?,
        command: r.get(7)?,
        exit_code: r.get(8)?,
        output: r.get(9)?,
        expect: r.get(10)?,
        matched: r.get(11)?,
        note: r.get(12)?,
        actor: r.get(13)?,
        at: r.get(14)?,
        ms: r.get(15)?,
    })
}

/// The steps run (of one runbook, or all), between `from` and `to` (ms), oldest first.
pub fn list(
    conn: &Connection,
    root: &str,
    path: Option<&str>,
    from: i64,
    to: i64,
) -> Result<Vec<RunbookStepRun>, ProjectError> {
    let mut st = conn.prepare(&format!(
        "SELECT {COLS} FROM runbook_runs WHERE root = ?1 AND (?2 IS NULL OR path = ?2) AND at >= ?3 AND at < ?4 ORDER BY at, id"
    ))?;
    let rows = st
        .query_map(params![root, path, from, to], row)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}
