//! Reports computed from the activity log (PROJ-05): nothing is estimated or invented.
//! With little history they come back empty, and the UI says so.
//!
//! The sprint charts (Board A) read the scope and the estimates as they were on each day —
//! `sprint_scope`, `estimate_changes` and the `start`/`close` snapshots of migration 16 — so
//! adding or re-estimating work mid-sprint no longer rewrites the past, and «committed vs done»
//! survives the carry-over. A sprint that started before that history says it is `partial`.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use super::insights::{self, Insight, Withheld};
use super::{day_of, ProjectError, DAY_MS, STATES};

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CycleItem {
    pub key: String,
    /// From entering `progress` (or creation) to `done`, in days.
    pub days: f64,
    pub done_at: i64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WeekCount {
    /// Start of the 7-day window (ms).
    pub start: i64,
    pub done: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CfdDay {
    /// Start of the day (ms, UTC).
    pub day: i64,
    /// Issues in each canonical state at the end of the day, in [`STATES`] order.
    pub counts: [u32; 5],
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BurnPoint {
    pub day: i64,
    /// Points still open at the end of the day (the burndown).
    pub remaining: u32,
    /// Points in the sprint that day, with the estimates of that day (the burnup's scope line).
    pub scope: u32,
    /// Points finished (the burnup).
    pub done: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Burndown {
    pub sprint: String,
    pub name: String,
    pub start: i64,
    pub end: i64,
    /// Where the ideal line starts: the commitment, or (partial) the scope of the first day.
    pub total: u32,
    /// Points committed when the sprint started (`None`: it started before the history).
    pub committed: Option<u32>,
    /// Points in the sprint now.
    pub scope: u32,
    pub days: Vec<BurnPoint>,
    /// The sprint started before the history was recorded: the scope before
    /// [`Reports::history_since`] is today's, not that day's.
    pub partial: bool,
    /// Open issues in the sprint without an estimate (the charts cannot see them).
    pub unestimated: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Velocity {
    pub sprint: String,
    pub name: String,
    /// Points finished in the sprint.
    pub points: u32,
    /// Points committed at the start (`None`: started before the history).
    pub committed: Option<u32>,
    /// Of the committed points, how many were finished.
    pub committed_done: Option<u32>,
    /// Points that joined after the start / committed points that left before the end.
    pub added: Option<u32>,
    pub removed: Option<u32>,
    /// Points still open at the close (carried over or back to the backlog).
    pub carried: Option<u32>,
    /// Started or closed before the history was recorded: only `points` is known, from the
    /// issues the sprint still holds.
    pub partial: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Reports {
    pub cycle: Vec<CycleItem>,
    pub cycle_median: Option<f64>,
    pub cycle_p85: Option<f64>,
    pub throughput: Vec<WeekCount>,
    pub cfd: Vec<CfdDay>,
    pub burndown: Option<Burndown>,
    pub velocity: Vec<Velocity>,
    /// Feedback for the manager, and what still lacks history ([`insights`]).
    pub insights: Vec<Insight>,
    pub withheld: Vec<Withheld>,
    /// When the sprint history (scope, estimates, commitments) began to be recorded.
    pub history_since: Option<i64>,
}

/// Days shown in the cumulative flow; weeks in the throughput.
pub const CFD_DAYS: i64 = 14;
pub const THROUGHPUT_WEEKS: i64 = 8;

struct Hist {
    created: i64,
    /// (at, state), in time order.
    moves: Vec<(i64, String)>,
    deleted: Option<i64>,
    /// Blocked intervals `(from, to)`; `to` is `None` while still blocked.
    blocks: Vec<(i64, Option<i64>)>,
    /// The project's tests run after Co-Dev worked on it (`tests` activity).
    test_runs: u32,
    test_failures: u32,
}

impl Hist {
    fn state_at(&self, t: i64) -> Option<&str> {
        if self.created > t || self.deleted.is_some_and(|d| d <= t) {
            return None;
        }
        Some(
            self.moves
                .iter()
                .rev()
                .find(|(at, _)| *at <= t)
                .map_or("todo", |(_, s)| s.as_str()),
        )
    }
    fn first(&self, s: &str) -> Option<i64> {
        self.moves.iter().find(|(_, x)| x == s).map(|(t, _)| *t)
    }
    fn last(&self, s: &str) -> Option<i64> {
        self.moves
            .iter()
            .rev()
            .find(|(_, x)| x == s)
            .map(|(t, _)| *t)
    }
    /// Time blocked inside `[from, to]`.
    fn blocked_within(&self, from: i64, to: i64) -> i64 {
        self.blocks
            .iter()
            .map(|(a, b)| (b.unwrap_or(to).min(to) - (*a).max(from)).max(0))
            .sum()
    }
}

fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let i = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    Some(sorted[i.min(sorted.len() - 1)])
}

/// An issue as it is now.
struct Cur {
    state: String,
    points: Option<u32>,
    sprint: Option<String>,
    blocked: bool,
}

struct SprintRow {
    id: String,
    name: String,
    start: i64,
    end: i64,
    state: String,
    started_at: Option<i64>,
    closed_at: Option<i64>,
}

/// A sprint snapshot: key → (points, state).
type Snapshot = BTreeMap<String, (Option<u32>, String)>;
/// A join (`true`) or leave of a sprint: (at, joined, points then).
type ScopeEvent = (i64, bool, Option<u32>);
/// An estimate change: (at, old, new).
type EstimateChange = (i64, Option<u32>, Option<u32>);

/// `PREFIX-12` sorts after `PREFIX-9`.
fn key_order(k: &str) -> (String, u64, String) {
    match k.rsplit_once('-') {
        Some((p, n)) => match n.parse() {
            Ok(n) => (p.to_string(), n, String::new()),
            Err(_) => (k.to_string(), 0, String::new()),
        },
        None => (k.to_string(), 0, k.to_string()),
    }
}

/// The recorded sprint history, and the questions the charts ask it.
struct SprintHistory {
    /// (sprint, key) → (at, joined?, points), in time order.
    scope: BTreeMap<(String, String), Vec<ScopeEvent>>,
    /// key → (at, old, new), in time order.
    estimates: BTreeMap<String, Vec<EstimateChange>>,
    /// (sprint, `start` | `close`) → snapshot.
    snapshots: BTreeMap<(String, String), Snapshot>,
    /// The estimate to fall back on: today's, or the last one recorded for a deleted issue.
    base: BTreeMap<String, Option<u32>>,
}

impl SprintHistory {
    fn load(
        c: &Connection,
        root: &str,
        current: &BTreeMap<String, Cur>,
    ) -> Result<Self, ProjectError> {
        let mut h = SprintHistory {
            scope: BTreeMap::new(),
            estimates: BTreeMap::new(),
            snapshots: BTreeMap::new(),
            base: BTreeMap::new(),
        };
        // the last estimate seen for each key, by time (deleted issues have no row any more)
        let mut seen: BTreeMap<String, (i64, Option<u32>)> = BTreeMap::new();
        let mut see = |k: &str, at: i64, p: Option<u32>| {
            let e = seen.entry(k.to_string()).or_insert((at, p));
            if at >= e.0 {
                *e = (at, p);
            }
        };
        let mut st = c.prepare(
            "SELECT sprint, key, at, change, points FROM sprint_scope WHERE root = ?1 ORDER BY at, id",
        )?;
        let rows = st.query_map(params![root], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, Option<u32>>(4)?,
            ))
        })?;
        for r in rows {
            let (sprint, key, at, change, points) = r?;
            see(&key, at, points);
            h.scope
                .entry((sprint, key))
                .or_default()
                .push((at, change == "added", points));
        }
        let mut st = c.prepare(
            "SELECT key, at, old_points, new_points FROM estimate_changes WHERE root = ?1 ORDER BY at, id",
        )?;
        let rows = st.query_map(params![root], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Option<u32>>(2)?,
                r.get::<_, Option<u32>>(3)?,
            ))
        })?;
        for r in rows {
            let (key, at, old, new) = r?;
            see(&key, at, new);
            h.estimates.entry(key).or_default().push((at, old, new));
        }
        let mut st = c.prepare(
            "SELECT sprint, kind, key, points, state, at FROM sprint_snapshots WHERE root = ?1",
        )?;
        let rows = st.query_map(params![root], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<u32>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, i64>(5)?,
            ))
        })?;
        for r in rows {
            let (sprint, kind, key, points, state, at) = r?;
            see(&key, at, points);
            h.snapshots
                .entry((sprint, kind))
                .or_default()
                .insert(key, (points, state));
        }
        for (k, (_, p)) in seen {
            h.base.insert(k, p);
        }
        for (k, cur) in current {
            h.base.insert(k.clone(), cur.points);
        }
        Ok(h)
    }

    /// The estimate of `key` at `t`: the last change by then; before the first recorded change,
    /// that change's old value; with no change recorded, today's (or the last one known).
    fn points_at(&self, key: &str, t: i64) -> Option<u32> {
        if let Some(v) = self.estimates.get(key) {
            if let Some(last) = v.iter().rev().find(|e| e.0 <= t) {
                return last.2;
            }
            if let Some(first) = v.first() {
                return first.1;
            }
        }
        self.base.get(key).copied().flatten()
    }

    /// Was `key` in `sprint` at `t`? The last recorded join/leave by then decides; before the
    /// first one, the opposite of it; with none recorded, where the issue is today.
    fn member_at(&self, sprint: &str, key: &str, t: i64, now_in: bool) -> bool {
        match self.scope.get(&(sprint.to_string(), key.to_string())) {
            Some(v) => match v.iter().rev().find(|e| e.0 <= t) {
                Some(e) => e.1,
                None => !v[0].1,
            },
            None => now_in,
        }
    }

    fn snapshot(&self, sprint: &str, kind: &str) -> Option<&Snapshot> {
        self.snapshots.get(&(sprint.to_string(), kind.to_string()))
    }

    /// Every key that was ever recorded in `sprint`, or is in it today.
    fn keys_of(&self, sprint: &str, current: &BTreeMap<String, Cur>) -> BTreeSet<String> {
        let mut keys: BTreeSet<String> = current
            .iter()
            .filter(|(_, c)| c.sprint.as_deref() == Some(sprint))
            .map(|(k, _)| k.clone())
            .collect();
        keys.extend(
            self.scope
                .keys()
                .filter(|(s, _)| s == sprint)
                .map(|(_, k)| k.clone()),
        );
        for kind in ["start", "close"] {
            if let Some(s) = self.snapshot(sprint, kind) {
                keys.extend(s.keys().cloned());
            }
        }
        keys
    }
}

/// The points of a snapshot, without the issues already Done when it was taken.
fn open_points(s: &Snapshot) -> u32 {
    s.values()
        .filter(|(_, st)| st != "done")
        .map(|(p, _)| p.unwrap_or(0))
        .sum()
}

pub fn compute(c: &Connection, root: &str, now: i64) -> Result<Reports, ProjectError> {
    let mut hist: BTreeMap<String, Hist> = BTreeMap::new();
    let mut st = c.prepare(
        "SELECT key, at, kind, to_state, note FROM activity WHERE root = ?1 ORDER BY at, id",
    )?;
    let rows = st.query_map(params![root], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    for r in rows {
        let (key, at, kind, to, note) = r?;
        let h = hist.entry(key).or_insert(Hist {
            created: at,
            moves: vec![],
            deleted: None,
            blocks: vec![],
            test_runs: 0,
            test_failures: 0,
        });
        match kind.as_str() {
            "created" => h.created = at,
            "deleted" => h.deleted = Some(at),
            // a new reason on a blocked issue keeps the block that was already open
            "blocked" if !h.blocks.last().is_some_and(|b| b.1.is_none()) => {
                h.blocks.push((at, None))
            }
            "unblocked" => {
                if let Some(b) = h.blocks.last_mut().filter(|b| b.1.is_none()) {
                    b.1 = Some(at);
                }
            }
            "tests" => {
                h.test_runs += 1;
                if note.starts_with("os testes falharam") {
                    h.test_failures += 1;
                }
            }
            _ => {}
        }
        if let Some(s) = to {
            h.moves.push((at, s));
        }
    }
    let current: BTreeMap<String, Cur> = {
        let mut st = c.prepare(
            "SELECT key, state, points, sprint, blocked IS NOT NULL FROM issues WHERE root = ?1",
        )?;
        let v = st
            .query_map(params![root], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    Cur {
                        state: r.get(1)?,
                        points: r.get(2)?,
                        sprint: r.get(3)?,
                        blocked: r.get(4)?,
                    },
                ))
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    let sprints: Vec<SprintRow> = {
        let mut st = c.prepare(
            "SELECT id, name, start, end, state, started_at, closed_at FROM sprints WHERE root = ?1 ORDER BY start, id",
        )?;
        let v = st
            .query_map(params![root], |r| {
                Ok(SprintRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    start: r.get(2)?,
                    end: r.get(3)?,
                    state: r.get(4)?,
                    started_at: r.get(5)?,
                    closed_at: r.get(6)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    let sh = SprintHistory::load(c, root, &current)?;
    let mut rep = Reports {
        history_since: c
            .query_row(
                "SELECT history_since FROM projects WHERE root = ?1",
                params![root],
                |r| r.get::<_, Option<i64>>(0),
            )
            .optional()?
            .flatten(),
        ..Reports::default()
    };

    // cycle time of the finished issues
    for (key, cur) in &current {
        let Some(h) = hist.get(key) else { continue };
        if cur.state != "done" {
            continue;
        }
        let Some(done) = h.last("done") else { continue };
        let start = h.first("progress").unwrap_or(h.created);
        rep.cycle.push(CycleItem {
            key: key.clone(),
            days: ((done - start).max(0) as f64 / DAY_MS as f64 * 10.0).round() / 10.0,
            done_at: done,
        });
    }
    rep.cycle.sort_by_key(|c| c.done_at);
    let mut d: Vec<f64> = rep.cycle.iter().map(|c| c.days).collect();
    d.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    rep.cycle_median = percentile(&d, 0.5);
    rep.cycle_p85 = percentile(&d, 0.85);

    // throughput per week (only once something was finished)
    if !rep.cycle.is_empty() {
        for w in (0..THROUGHPUT_WEEKS).rev() {
            let end = now - w * 7 * DAY_MS;
            let start = end - 7 * DAY_MS;
            let done = rep
                .cycle
                .iter()
                .filter(|c| c.done_at > start && c.done_at <= end)
                .count() as u32;
            rep.throughput.push(WeekCount { start, done });
        }
    }

    // cumulative flow, from the first day with an issue
    if !hist.is_empty() {
        let today = day_of(now);
        let first = day_of(hist.values().map(|h| h.created).min().unwrap_or(now));
        for day in (today - CFD_DAYS + 1).max(first)..=today {
            let eod = (day + 1) * DAY_MS - 1;
            let mut counts = [0u32; 5];
            for h in hist.values() {
                if let Some(s) = h.state_at(eod.min(now)) {
                    if let Some(i) = STATES.iter().position(|x| *x == s) {
                        counts[i] += 1;
                    }
                }
            }
            rep.cfd.push(CfdDay {
                day: day * DAY_MS,
                counts,
            });
        }
    }

    let state_at = |k: &str, t: i64| hist.get(k).and_then(|h| h.state_at(t));
    let in_now = |s: &str, k: &str| {
        current
            .get(k)
            .is_some_and(|c| c.sprint.as_deref() == Some(s))
    };

    // burndown and burnup of the active sprint, with the scope and estimates of each day
    let mut active_in: Option<insights::ActiveSprint> = None;
    if let Some(sp) = sprints.iter().find(|s| s.state == "active") {
        let id = sp.id.as_str();
        let partial = sp.started_at.is_none();
        let ref_start = sp.started_at.unwrap_or(sp.start);
        let keys = sh.keys_of(id, &current);
        // in the sprint at `t`, and not an issue that was already Done when the sprint began
        let counts = |k: &str, t: i64| {
            let s = state_at(k, t);
            s.is_some()
                && sh.member_at(id, k, t, in_now(id, k))
                && !(s == Some("done") && state_at(k, ref_start) == Some("done"))
        };
        let measure = |t: i64| {
            let (mut scope, mut done) = (0u32, 0u32);
            for k in &keys {
                if counts(k, t) {
                    let p = sh.points_at(k, t).unwrap_or(0);
                    scope += p;
                    if state_at(k, t) == Some("done") {
                        done += p;
                    }
                }
            }
            (scope, done)
        };
        let mut days = vec![];
        for day in day_of(sp.start)..=day_of(sp.end.min(now)) {
            let eod = ((day + 1) * DAY_MS - 1).min(now);
            let (scope, done) = measure(eod);
            days.push(BurnPoint {
                day: day * DAY_MS,
                remaining: scope.saturating_sub(done),
                scope,
                done,
            });
        }
        let start_snap = sh.snapshot(id, "start").filter(|_| !partial);
        let committed = start_snap.map(open_points);
        let (scope_now, _) = measure(now);
        let mut open: Vec<(String, u32)> = vec![];
        let mut unestimated: Vec<String> = vec![];
        for (k, cur) in &current {
            if cur.sprint.as_deref() == Some(id) && cur.state != "done" {
                open.push((k.clone(), cur.points.unwrap_or(0)));
                if cur.points.is_none() {
                    unestimated.push(k.clone());
                }
            }
        }
        unestimated.sort_by_key(|k| key_order(k));
        let (mut added, mut removed, mut reestimated) = (vec![], vec![], 0i64);
        if let Some(snap) = start_snap {
            let committed_keys: BTreeMap<&String, Option<u32>> = snap
                .iter()
                .filter(|(_, (_, st))| st != "done")
                .map(|(k, (p, _))| (k, *p))
                .collect();
            for k in &keys {
                let now_in = counts(k, now);
                match committed_keys.get(k) {
                    Some(p0) if now_in => {
                        reestimated +=
                            sh.points_at(k, now).unwrap_or(0) as i64 - p0.unwrap_or(0) as i64;
                    }
                    Some(p0) => removed.push((k.clone(), p0.unwrap_or(0))),
                    None if now_in => added.push((k.clone(), sh.points_at(k, now).unwrap_or(0))),
                    None => {}
                }
            }
            added.sort_by_key(|x| key_order(&x.0));
            removed.sort_by_key(|x| key_order(&x.0));
        }
        let blocked_ms = keys
            .iter()
            .filter(|k| counts(k, now))
            .filter_map(|k| hist.get(k))
            .map(|h| h.blocked_within(ref_start, now))
            .sum();
        let total = committed.unwrap_or_else(|| days.first().map_or(scope_now, |d| d.scope));
        rep.burndown = Some(Burndown {
            sprint: sp.id.clone(),
            name: sp.name.clone(),
            start: sp.start,
            end: sp.end,
            total,
            committed,
            scope: scope_now,
            days: days.clone(),
            partial,
            unestimated: unestimated.clone(),
        });
        active_in = Some(insights::ActiveSprint {
            id: sp.id.clone(),
            start: sp.start,
            end: sp.end,
            partial,
            committed,
            days,
            open,
            unestimated,
            added,
            removed,
            reestimated,
            blocked_ms,
        });
    }

    // velocity of the closed sprints: committed vs done, from the snapshots
    for sp in sprints.iter().filter(|s| s.state == "closed") {
        let id = sp.id.as_str();
        let close = sp.closed_at.and(sh.snapshot(id, "close"));
        let v = match (sp.closed_at, close) {
            (Some(_), close) => {
                let empty = Snapshot::new();
                let close = close.unwrap_or(&empty);
                let start = sp.started_at.and(sh.snapshot(id, "start"));
                // already Done when the sprint began (planned in afterwards, or in the commitment as Done)
                let ref_start = sp.started_at.unwrap_or(sp.start);
                let done_at_start = |k: &str| {
                    start
                        .and_then(|s| s.get(k))
                        .is_some_and(|(_, st)| st == "done")
                        || state_at(k, ref_start) == Some("done")
                };
                let mut points = 0;
                let mut carried = 0;
                for (k, (p, st)) in close {
                    if st == "done" {
                        if !done_at_start(k) {
                            points += p.unwrap_or(0);
                        }
                    } else {
                        carried += p.unwrap_or(0);
                    }
                }
                match (sp.started_at, start) {
                    (Some(_), start) => {
                        let empty = Snapshot::new();
                        let start = start.unwrap_or(&empty);
                        let committed = open_points(start);
                        let mut committed_done = 0;
                        let mut removed = 0;
                        for (k, (p, _)) in start.iter().filter(|(_, (_, st))| st != "done") {
                            match close.get(k) {
                                Some((_, cst)) if cst == "done" => committed_done += p.unwrap_or(0),
                                Some(_) => {}
                                None => removed += p.unwrap_or(0),
                            }
                        }
                        let added = close
                            .iter()
                            .filter(|(k, (_, st))| {
                                !start.contains_key(*k) && !(st == "done" && done_at_start(k))
                            })
                            .map(|(_, (p, _))| p.unwrap_or(0))
                            .sum();
                        Velocity {
                            sprint: sp.id.clone(),
                            name: sp.name.clone(),
                            points,
                            committed: Some(committed),
                            committed_done: Some(committed_done),
                            added: Some(added),
                            removed: Some(removed),
                            carried: Some(carried),
                            partial: false,
                        }
                    }
                    (None, _) => Velocity {
                        sprint: sp.id.clone(),
                        name: sp.name.clone(),
                        points,
                        committed: None,
                        committed_done: None,
                        added: None,
                        removed: None,
                        carried: Some(carried),
                        partial: true,
                    },
                }
            }
            // closed before the history: only what it still holds is known
            (None, _) => Velocity {
                sprint: sp.id.clone(),
                name: sp.name.clone(),
                points: current
                    .values()
                    .filter(|v| v.sprint.as_deref() == Some(id) && v.state == "done")
                    .map(|v| v.points.unwrap_or(0))
                    .sum(),
                committed: None,
                committed_done: None,
                added: None,
                removed: None,
                carried: None,
                partial: true,
            },
        };
        rep.velocity.push(v);
    }

    // the manager's insights
    let costs: Vec<insights::IssueCost> = {
        let mut st = c.prepare(
            "SELECT issue_key, COALESCE(SUM(cost_usd), 0), COUNT(*), SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END)
             FROM audit WHERE root = ?1 AND event = 'turn' AND issue_key IS NOT NULL GROUP BY issue_key",
        )?;
        let rows = st.query_map(params![root], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, f64>(1)?,
                r.get::<_, u32>(2)?,
                r.get::<_, Option<u32>>(3)?,
            ))
        })?;
        let mut v = vec![];
        for r in rows {
            let (key, cost_usd, turns, unpriced) = r?;
            let Some(cur) = current.get(&key) else {
                continue;
            };
            v.push(insights::IssueCost {
                key,
                cost_usd,
                points: cur.points,
                done: cur.state == "done",
                turns,
                unpriced: unpriced.unwrap_or(0),
            });
        }
        v
    };
    let mut input = insights::Input {
        now,
        has_sprints: !sprints.is_empty(),
        active: active_in,
        closed: rep.velocity.clone(),
        cycle_days: rep.cycle.iter().map(|c| c.days).collect(),
        costs,
        ..Default::default()
    };
    for (k, cur) in &current {
        let h = hist.get(k);
        if ["progress", "review", "accept"].contains(&cur.state.as_str()) {
            if let Some(h) = h {
                input.wip.push(insights::WipItem {
                    key: k.clone(),
                    state: cur.state.clone(),
                    started: h.first("progress").unwrap_or(h.created),
                });
            }
        }
        if cur.blocked {
            input.blocked.push(insights::BlockedItem {
                key: k.clone(),
                since: h
                    .and_then(|h| h.blocks.last())
                    .filter(|b| b.1.is_none())
                    .map(|b| b.0),
            });
        }
        if let Some(h) = h.filter(|h| h.test_runs > 0) {
            input.tests.push(insights::IssueTests {
                key: k.clone(),
                runs: h.test_runs,
                failed: h.test_failures,
            });
        }
    }
    let out = insights::compute(&input);
    rep.insights = out.items;
    rep.withheld = out.withheld;
    Ok(rep)
}
