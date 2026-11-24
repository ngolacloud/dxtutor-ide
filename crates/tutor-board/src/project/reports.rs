//! Reports computed from the activity log (PROJ-05): nothing is estimated or invented.
//! With little history they come back empty, and the UI says so.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};
use serde::Serialize;

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
    pub remaining: u32,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Burndown {
    pub sprint: String,
    pub start: i64,
    pub end: i64,
    pub total: u32,
    pub days: Vec<BurnPoint>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Velocity {
    pub sprint: String,
    pub name: String,
    pub points: u32,
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
}

/// Days shown in the cumulative flow; weeks in the throughput.
pub const CFD_DAYS: i64 = 14;
pub const THROUGHPUT_WEEKS: i64 = 8;

struct Hist {
    created: i64,
    /// (at, state), in time order.
    moves: Vec<(i64, String)>,
    deleted: Option<i64>,
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
}

fn percentile(sorted: &[f64], p: f64) -> Option<f64> {
    if sorted.is_empty() {
        return None;
    }
    let i = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    Some(sorted[i.min(sorted.len() - 1)])
}

pub fn compute(c: &Connection, root: &str, now: i64) -> Result<Reports, ProjectError> {
    let mut hist: BTreeMap<String, Hist> = BTreeMap::new();
    let mut st =
        c.prepare("SELECT key, at, kind, to_state FROM activity WHERE root = ?1 ORDER BY at, id")?;
    let rows = st.query_map(params![root], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, i64>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, Option<String>>(3)?,
        ))
    })?;
    for r in rows {
        let (key, at, kind, to) = r?;
        let h = hist.entry(key).or_insert(Hist {
            created: at,
            moves: vec![],
            deleted: None,
        });
        if kind == "created" {
            h.created = at;
        }
        if kind == "deleted" {
            h.deleted = Some(at);
        }
        if let Some(s) = to {
            h.moves.push((at, s));
        }
    }
    let current: BTreeMap<String, (String, u32, Option<String>)> = {
        let mut st = c.prepare(
            "SELECT key, state, COALESCE(points, 0), sprint FROM issues WHERE root = ?1",
        )?;
        let v = st
            .query_map(params![root], |r| {
                Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))
            })?
            .collect::<Result<_, _>>()?;
        v
    };
    let mut rep = Reports::default();

    // cycle time of the finished issues
    for (key, (state, _, _)) in &current {
        let Some(h) = hist.get(key) else { continue };
        if state != "done" {
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

    // burndown of the active sprint
    let active: Option<(String, i64, i64)> = c
        .query_row(
            "SELECT id, start, end FROM sprints WHERE root = ?1 AND state = 'active'",
            params![root],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .ok();
    if let Some((id, start, end)) = active {
        let items: Vec<(&String, u32)> = current
            .iter()
            .filter(|(_, v)| v.2.as_deref() == Some(id.as_str()))
            .map(|(k, v)| (k, v.1))
            .collect();
        let total: u32 = items.iter().map(|(_, p)| p).sum();
        let mut days = vec![];
        for day in day_of(start)..=day_of(end.min(now)) {
            let eod = ((day + 1) * DAY_MS - 1).min(now);
            let done: u32 = items
                .iter()
                .filter(|(k, _)| hist.get(*k).and_then(|h| h.state_at(eod)) == Some("done"))
                .map(|(_, p)| p)
                .sum();
            days.push(BurnPoint {
                day: day * DAY_MS,
                remaining: total.saturating_sub(done),
            });
        }
        rep.burndown = Some(Burndown {
            sprint: id,
            start,
            end,
            total,
            days,
        });
    }

    // velocity of the closed sprints
    let closed: Vec<(String, String)> = {
        let mut st = c.prepare(
            "SELECT id, name FROM sprints WHERE root = ?1 AND state = 'closed' ORDER BY start, id",
        )?;
        let v = st
            .query_map(params![root], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<_, _>>()?;
        v
    };
    for (id, name) in closed {
        let points = current
            .values()
            .filter(|v| v.2.as_deref() == Some(id.as_str()) && v.0 == "done")
            .map(|v| v.1)
            .sum();
        rep.velocity.push(Velocity {
            sprint: id,
            name,
            points,
        });
    }
    Ok(rep)
}
