//! Deploy records (r23 F4c2, docs/v2/AUDIT-r23.md §4.4 — D04): every rollout of the guided deploy,
//! ok or not — the commit, its issue, the environment and cluster, who deployed and who approved, the
//! checks with their status and the ones waived with a reason. They feed a commit's lifecycle (F3:
//! «environments») and the evidence of F5.

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::ProjectError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeployRecord {
    #[serde(default)]
    pub id: i64,
    pub env: String,
    pub context: String,
    pub namespace: String,
    /// the full commit hash
    pub version: String,
    pub issue: Option<String>,
    pub actor: String,
    /// production's second approver
    pub approver: Option<String>,
    pub at: i64,
    pub ok: bool,
    pub failed_step: Option<String>,
    /// `[[check, reason], …]` as JSON
    pub waivers: String,
    /// `{check: status}` as JSON
    pub gates: String,
    pub reason: Option<String>,
}

pub fn record(conn: &Connection, root: &str, r: &DeployRecord) -> Result<i64, ProjectError> {
    conn.execute(
        "INSERT INTO deploys (root, env, context, namespace, version, issue_key, actor, approver, at, ok, failed_step, waivers, gates, reason)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![root, r.env, r.context, r.namespace, r.version, r.issue, r.actor, r.approver, r.at, r.ok, r.failed_step, r.waivers, r.gates, r.reason],
    )?;
    Ok(conn.last_insert_rowid())
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<DeployRecord> {
    Ok(DeployRecord {
        id: r.get(0)?,
        env: r.get(1)?,
        context: r.get(2)?,
        namespace: r.get(3)?,
        version: r.get(4)?,
        issue: r.get(5)?,
        actor: r.get(6)?,
        approver: r.get(7)?,
        at: r.get(8)?,
        ok: r.get(9)?,
        failed_step: r.get(10)?,
        waivers: r.get(11)?,
        gates: r.get(12)?,
        reason: r.get(13)?,
    })
}

const COLS: &str = "id, env, context, namespace, version, issue_key, actor, approver, at, ok, failed_step, waivers, gates, reason";

/// The deploys of these commits (full hashes or prefixes of 7+), newest first; all of them (up to
/// 200) without commits.
pub fn list(
    conn: &Connection,
    root: &str,
    shas: Option<&[String]>,
) -> Result<Vec<DeployRecord>, ProjectError> {
    let mut out = vec![];
    match shas {
        None => {
            let mut st = conn.prepare(&format!(
                "SELECT {COLS} FROM deploys WHERE root = ?1 ORDER BY at DESC, id DESC LIMIT 200"
            ))?;
            for r in st.query_map(params![root], row)? {
                out.push(r?);
            }
        }
        Some(list) => {
            let mut st = conn.prepare(&format!("SELECT {COLS} FROM deploys WHERE root = ?1 AND version LIKE ?2 || '%' ORDER BY at DESC, id DESC LIMIT 50"))?;
            for sha in list
                .iter()
                .filter(|s| s.len() >= 7 && s.chars().all(|c| c.is_ascii_hexdigit()))
            {
                for r in st.query_map(params![root, sha], row)? {
                    out.push(r?);
                }
            }
            out.sort_by(|a, b| b.at.cmp(&a.at).then(b.id.cmp(&a.id)));
        }
    }
    Ok(out)
}
