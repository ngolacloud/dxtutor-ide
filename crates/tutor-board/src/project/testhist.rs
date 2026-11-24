//! The history of test runs (docs/v2/UI-AUDIT.md item 3, TEST-03): every run the Testing pane
//! starts is kept with its per-test results; the pane's cards are computed from it — pass
//! rate over time, flaky tests (a test whose result flips between passed and failed across
//! recent runs), the slowest tests. Nothing is estimated: no runs, no cards.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use super::ProjectError;

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewCase {
    pub case_id: String,
    pub name: String,
    pub suite: String,
    /// `passed | failed | skipped`.
    pub status: String,
    pub duration_ms: Option<u64>,
    pub message: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewRun {
    pub runner: String,
    pub command: String,
    /// `all | case | changed`.
    pub scope: String,
    pub ok: bool,
    pub duration_ms: u64,
    pub cases: Vec<NewCase>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunRow {
    pub id: i64,
    pub at: i64,
    pub runner: String,
    pub command: String,
    pub scope: String,
    pub ok: bool,
    pub duration_ms: u64,
    pub passed: u32,
    pub failed: u32,
    pub skipped: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CaseStat {
    pub case_id: String,
    pub name: String,
    pub suite: String,
    /// Results in the recent runs where the test ran, oldest first (`p`, `f`, `s`).
    pub recent: String,
    pub last: String,
    /// Changes between passed and failed in `recent`.
    pub flips: u32,
    /// Flips at least twice: it fails and passes again without a clear cause.
    pub flaky: bool,
    pub avg_ms: Option<u64>,
    pub last_message: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TestHistory {
    /// Most recent first.
    pub runs: Vec<RunRow>,
    pub cases: Vec<CaseStat>,
}

/// Runs looked at for flaky detection.
pub const RECENT_RUNS: usize = 10;

pub fn record(c: &Connection, root: &str, run: &NewRun, now: i64) -> Result<i64, ProjectError> {
    let n = |s: &str| run.cases.iter().filter(|x| x.status == s).count() as u32;
    c.execute(
        "INSERT INTO test_runs (root, at, runner, command, scope, ok, duration_ms, passed, failed, skipped)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![root, now, run.runner, run.command, run.scope, run.ok, run.duration_ms as i64, n("passed"), n("failed"), n("skipped")],
    )?;
    let id = c.last_insert_rowid();
    for k in &run.cases {
        c.execute(
            "INSERT INTO test_cases (run_id, case_id, name, suite, status, duration_ms, message) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, k.case_id, k.name, k.suite, k.status, k.duration_ms.map(|d| d as i64), k.message],
        )?;
    }
    Ok(id)
}

pub fn history(c: &Connection, root: &str, limit: usize) -> Result<TestHistory, ProjectError> {
    let mut st = c.prepare(
        "SELECT id, at, runner, command, scope, ok, duration_ms, passed, failed, skipped FROM test_runs
         WHERE root = ?1 ORDER BY at DESC, id DESC LIMIT ?2",
    )?;
    let runs: Vec<RunRow> = st
        .query_map(params![root, limit as i64], |r| {
            Ok(RunRow {
                id: r.get(0)?,
                at: r.get(1)?,
                runner: r.get(2)?,
                command: r.get(3)?,
                scope: r.get(4)?,
                ok: r.get(5)?,
                duration_ms: r.get::<_, i64>(6)? as u64,
                passed: r.get(7)?,
                failed: r.get(8)?,
                skipped: r.get(9)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    // per test: its results in the runs where it ran, oldest first
    let mut st = c.prepare(
        "SELECT c.case_id, c.name, c.suite, c.status, c.duration_ms, c.message FROM test_cases c
         JOIN test_runs r ON r.id = c.run_id WHERE r.root = ?1 ORDER BY r.at, r.id",
    )?;
    type Acc = (String, String, Vec<(String, Option<i64>, Option<String>)>);
    let mut by: BTreeMap<String, Acc> = BTreeMap::new();
    for row in st.query_map(params![root], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, Option<i64>>(4)?,
            r.get::<_, Option<String>>(5)?,
        ))
    })? {
        let (id, name, suite, status, ms, msg) = row?;
        by.entry(id)
            .or_insert((name, suite, vec![]))
            .2
            .push((status, ms, msg));
    }
    let mut cases: Vec<CaseStat> = by
        .into_iter()
        .map(|(case_id, (name, suite, all))| {
            let recent: Vec<&(String, Option<i64>, Option<String>)> = all
                .iter()
                .rev()
                .take(RECENT_RUNS)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            let letters: String = recent
                .iter()
                .map(|(s, _, _)| match s.as_str() {
                    "passed" => 'p',
                    "failed" => 'f',
                    _ => 's',
                })
                .collect();
            let pf: Vec<char> = letters.chars().filter(|c| *c != 's').collect();
            let flips = pf.windows(2).filter(|w| w[0] != w[1]).count() as u32;
            let durations: Vec<i64> = recent.iter().filter_map(|(_, d, _)| *d).collect();
            let last = recent.last().map(|(s, _, _)| s.clone()).unwrap_or_default();
            CaseStat {
                case_id,
                name,
                suite,
                flips,
                flaky: flips >= 2,
                avg_ms: (!durations.is_empty())
                    .then(|| (durations.iter().sum::<i64>() / durations.len() as i64) as u64),
                last_message: all
                    .iter()
                    .rev()
                    .find(|(s, _, _)| s == "failed")
                    .and_then(|(_, _, m)| m.clone()),
                recent: letters,
                last,
            }
        })
        .collect();
    cases.sort_by(|a, b| {
        b.flaky
            .cmp(&a.flaky)
            .then((b.last == "failed").cmp(&(a.last == "failed")))
            .then(a.case_id.cmp(&b.case_id))
    });
    Ok(TestHistory { runs, cases })
}
