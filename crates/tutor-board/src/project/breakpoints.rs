//! The gutter's breakpoints per workspace (A7, docs/v2/UI-AUDIT.md item 4, DBG-03): a line, an
//! optional condition, hit count and log message (a logpoint), and whether it is on. Kept in
//! the project database so they survive a restart; the file path is relative to the project.
//! r23 F2: a breakpoint can wait for another (`trigger`, `file:line` relative) and belong to a
//! group (a scenario switched on or off as a whole).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::ProjectError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Breakpoint {
    pub file: String,
    pub line: u32,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default)]
    pub hit_condition: Option<String>,
    #[serde(default)]
    pub log_message: Option<String>,
    #[serde(default = "on")]
    pub enabled: bool,
    #[serde(default)]
    pub trigger: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
}

fn on() -> bool {
    true
}

fn nz(s: &Option<String>) -> Option<&str> {
    s.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

pub fn load(conn: &Connection, root: &str) -> Result<Vec<Breakpoint>, ProjectError> {
    let mut st = conn.prepare(
        "SELECT file, line, condition, hit_condition, log_message, enabled, trigger_on, grp FROM breakpoints WHERE root = ?1 ORDER BY file, line",
    )?;
    let rows = st.query_map(params![root], |r| {
        Ok(Breakpoint {
            file: r.get(0)?,
            line: r.get(1)?,
            condition: r.get(2)?,
            hit_condition: r.get(3)?,
            log_message: r.get(4)?,
            enabled: r.get::<_, i64>(5)? != 0,
            trigger: r.get(6)?,
            group: r.get(7)?,
        })
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

/// Replaces the breakpoints of one file (an empty list clears it).
pub fn save_file(
    conn: &mut Connection,
    root: &str,
    file: &str,
    list: &[Breakpoint],
) -> Result<(), ProjectError> {
    let tx = conn.transaction()?;
    tx.execute(
        "DELETE FROM breakpoints WHERE root = ?1 AND file = ?2",
        params![root, file],
    )?;
    for b in list {
        tx.execute(
            "INSERT OR REPLACE INTO breakpoints (root, file, line, condition, hit_condition, log_message, enabled, trigger_on, grp) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![root, file, b.line, nz(&b.condition), nz(&b.hit_condition), nz(&b.log_message), b.enabled as i64, nz(&b.trigger), nz(&b.group)],
        )?;
    }
    tx.commit()?;
    Ok(())
}
