//! Feedback for the project manager, computed from the recorded history (Board A).
//!
//! Pure: [`compute`] reads an [`Input`] that [`super::reports`] builds from the store and
//! returns what it can say. Each [`Insight`] has a severity, a message code (the UI holds the
//! one-line sentence for each code, in English and pt-AO), the numbers behind it and the issue
//! keys involved. When there is not enough history for an insight, it is not guessed: a
//! [`Withheld`] entry says what is missing instead.

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{json, Value};

use super::reports::{BurnPoint, Velocity};
use super::DAY_MS;

/// Days of burn the forecast averages over (the most recent ones).
pub const FORECAST_WINDOW_DAYS: usize = 5;
/// Days a sprint must have run before its end is forecast.
pub const FORECAST_MIN_DAYS: usize = 2;
/// Closed sprints with a recorded commitment needed to judge reliability.
pub const MIN_CLOSED_SPRINTS: usize = 2;
/// How many of the latest recorded sprints the reliability looks at.
pub const RELIABILITY_SPRINTS: usize = 5;
/// Finished issues needed to know the usual cycle time (aging cards).
pub const MIN_CYCLE_SAMPLES: usize = 5;
/// Finished, estimated issues with Co-Dev cost needed for a cost per point.
pub const MIN_COST_ISSUES: usize = 3;
/// Test runs after Co-Dev work needed for a rework rate.
pub const MIN_TEST_RUNS: usize = 3;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Risk,
    Warn,
    Info,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    /// What it says (`forecast_late`, `scope_creep`, …): the UI's catalog has the sentence.
    pub code: String,
    pub severity: Severity,
    /// The numbers behind it, by name (the sentence's parameters).
    pub params: BTreeMap<String, Value>,
    /// The issues involved, most relevant first.
    pub keys: Vec<String>,
}

/// An insight that was not given, and why (what history is still missing).
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Withheld {
    pub code: String,
    pub params: BTreeMap<String, Value>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Insights {
    pub items: Vec<Insight>,
    pub withheld: Vec<Withheld>,
}

/// The active sprint, as the burndown sees it.
#[derive(Clone, Debug, Default)]
pub struct ActiveSprint {
    pub id: String,
    pub start: i64,
    pub end: i64,
    /// Started before the history was recorded: the scope before then is not known.
    pub partial: bool,
    /// Points committed at the start (`None` when partial).
    pub committed: Option<u32>,
    /// One point per day so far.
    pub days: Vec<BurnPoint>,
    /// Open issues in the sprint now, with their estimate (0 when not estimated).
    pub open: Vec<(String, u32)>,
    /// Open issues in the sprint without an estimate.
    pub unestimated: Vec<String>,
    /// Issues that joined after the start (points now) — empty when partial.
    pub added: Vec<(String, u32)>,
    /// Committed issues that left before the end (points when they left) — empty when partial.
    pub removed: Vec<(String, u32)>,
    /// Points the committed issues still in the sprint gained (or lost) by re-estimation.
    pub reestimated: i64,
    /// Time the sprint's issues spent blocked since the start (ms), as far as recorded.
    pub blocked_ms: i64,
}

/// An issue in the flow (In progress, Review, Acceptance).
#[derive(Clone, Debug)]
pub struct WipItem {
    pub key: String,
    pub state: String,
    /// When it entered In progress (or was created).
    pub started: i64,
}

/// An issue blocked now; `since` is unknown when the block was not recorded.
#[derive(Clone, Debug)]
pub struct BlockedItem {
    pub key: String,
    pub since: Option<i64>,
}

/// What Co-Dev spent on an issue (the audit log's turns).
#[derive(Clone, Debug)]
pub struct IssueCost {
    pub key: String,
    pub cost_usd: f64,
    pub points: Option<u32>,
    pub done: bool,
    pub turns: u32,
    /// Turns without a price (local models, unknown prices).
    pub unpriced: u32,
}

/// The project's tests run after Co-Dev worked on an issue.
#[derive(Clone, Debug)]
pub struct IssueTests {
    pub key: String,
    pub runs: u32,
    pub failed: u32,
}

#[derive(Clone, Debug, Default)]
pub struct Input {
    pub now: i64,
    /// Is there any sprint at all (planned, active or closed)? Reliability is only missed then.
    pub has_sprints: bool,
    pub active: Option<ActiveSprint>,
    /// The closed sprints, oldest first.
    pub closed: Vec<Velocity>,
    /// Cycle time of the finished issues, in days.
    pub cycle_days: Vec<f64>,
    pub wip: Vec<WipItem>,
    pub blocked: Vec<BlockedItem>,
    pub costs: Vec<IssueCost>,
    pub tests: Vec<IssueTests>,
}

fn r1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}
fn r2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}
fn days(ms: i64) -> f64 {
    ms as f64 / DAY_MS as f64
}
fn pct(part: f64, whole: f64) -> i64 {
    if whole <= 0.0 {
        0
    } else {
        (part / whole * 100.0).round() as i64
    }
}

fn p(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.clone()))
        .collect()
}

struct Out {
    items: Vec<Insight>,
    withheld: Vec<Withheld>,
}

impl Out {
    fn say(&mut self, code: &str, severity: Severity, params: &[(&str, Value)], keys: Vec<String>) {
        self.items.push(Insight {
            code: code.into(),
            severity,
            params: p(params),
            keys,
        });
    }
    fn hold(&mut self, code: &str, params: &[(&str, Value)]) {
        self.withheld.push(Withheld {
            code: code.into(),
            params: p(params),
        });
    }
}

/// Everything the history supports, the most severe first.
pub fn compute(i: &Input) -> Insights {
    let mut o = Out {
        items: vec![],
        withheld: vec![],
    };
    if let Some(a) = &i.active {
        forecast(i.now, a, &mut o);
        scope_creep(a, &mut o);
        unestimated(a, &mut o);
    }
    reliability(i, &mut o);
    aging(i, &mut o);
    blocked(i, &mut o);
    cost(i, &mut o);
    rework(i, &mut o);
    // stable: the order above within each severity
    o.items.sort_by_key(|x| x.severity);
    Insights {
        items: o.items,
        withheld: o.withheld,
    }
}

/// Open keys, the biggest first (ties by key).
fn open_keys(a: &ActiveSprint) -> Vec<String> {
    let mut v = a.open.clone();
    v.sort_by(|x, y| y.1.cmp(&x.1).then_with(|| x.0.cmp(&y.0)));
    v.into_iter().map(|(k, _)| k).collect()
}

/// Will the sprint finish what is in it, at the pace of its last days?
fn forecast(now: i64, a: &ActiveSprint, o: &mut Out) {
    let Some(last) = a.days.last() else {
        return; // not started yet: nothing to forecast
    };
    let remaining = last.remaining;
    if a.open.is_empty() {
        o.say(
            "forecast_done",
            Severity::Info,
            &[("done", json!(last.done))],
            vec![],
        );
        return;
    }
    if remaining == 0 {
        // open work, but none of it estimated: the burn rate says nothing about it
        o.hold("forecast_unestimated", &[("open", json!(a.open.len()))]);
        return;
    }
    if now >= a.end {
        o.say(
            "forecast_overdue",
            Severity::Risk,
            &[
                ("remaining", json!(remaining)),
                ("open", json!(a.open.len())),
            ],
            open_keys(a),
        );
        return;
    }
    let elapsed = a.days.len() - 1;
    if elapsed < FORECAST_MIN_DAYS {
        o.hold(
            "forecast_wait",
            &[
                ("needDays", json!(FORECAST_MIN_DAYS)),
                ("haveDays", json!(elapsed)),
            ],
        );
        return;
    }
    let w = elapsed.min(FORECAST_WINDOW_DAYS);
    let from = &a.days[a.days.len() - 1 - w];
    // points finished (the burnup), so scope added meanwhile does not hide the pace
    let rate = (last.done as f64 - from.done as f64).max(0.0) / w as f64;
    let left = days(a.end - now).max(0.0);
    let base = [
        ("remaining", json!(remaining)),
        ("daysLeft", json!(r1(left))),
        ("windowDays", json!(w)),
        ("partial", json!(a.partial)),
    ];
    if rate <= 0.0 {
        let mut ps = base.to_vec();
        ps.push(("open", json!(a.open.len())));
        o.say("forecast_stalled", Severity::Risk, &ps, open_keys(a));
        return;
    }
    let need = remaining as f64 / rate;
    let mut ps = base.to_vec();
    ps.push(("rate", json!(r1(rate))));
    if need <= left {
        ps.push(("finishInDays", json!(r1(need))));
        o.say("forecast_on_track", Severity::Info, &ps, vec![]);
    } else {
        let projected = (rate * left).floor().min(remaining as f64);
        ps.push(("projectedDone", json!(projected as u32)));
        ps.push(("lateDays", json!((need - left).ceil() as i64)));
        let sev = if projected < remaining as f64 * 0.7 {
            Severity::Risk
        } else {
            Severity::Warn
        };
        o.say("forecast_late", sev, &ps, open_keys(a));
    }
}

/// What changed in the sprint since it started (joined, left, re-estimated).
fn scope_creep(a: &ActiveSprint, o: &mut Out) {
    if a.partial {
        o.hold("scope_creep_partial", &[]);
        return;
    }
    let added: u32 = a.added.iter().map(|x| x.1).sum();
    let removed: u32 = a.removed.iter().map(|x| x.1).sum();
    if a.added.is_empty() && a.removed.is_empty() && a.reestimated == 0 {
        return;
    }
    let committed = a.committed.unwrap_or(0);
    let net = added as i64 - removed as i64 + a.reestimated;
    let share = if committed > 0 {
        Some(pct(net as f64, committed as f64))
    } else {
        None
    };
    let sev = match share {
        Some(s) if s > 50 => Severity::Risk,
        Some(s) if s > 20 => Severity::Warn,
        None if net > 0 => Severity::Warn,
        _ => Severity::Info,
    };
    let mut keys: Vec<String> = a.added.iter().map(|x| x.0.clone()).collect();
    keys.extend(a.removed.iter().map(|x| x.0.clone()));
    o.say(
        "scope_creep",
        sev,
        &[
            ("added", json!(added)),
            ("addedCount", json!(a.added.len())),
            ("removed", json!(removed)),
            ("removedCount", json!(a.removed.len())),
            ("reestimated", json!(a.reestimated)),
            ("net", json!(net)),
            ("committed", json!(committed)),
            ("pct", share.map_or(Value::Null, |s| json!(s))),
        ],
        keys,
    );
}

/// Open issues in the sprint the burndown cannot see.
fn unestimated(a: &ActiveSprint, o: &mut Out) {
    if a.unestimated.is_empty() {
        return;
    }
    o.say(
        "unestimated",
        Severity::Warn,
        &[("count", json!(a.unestimated.len()))],
        a.unestimated.clone(),
    );
}

/// How much of what the team commits to gets done (closed sprints with a recorded commitment).
fn reliability(i: &Input, o: &mut Out) {
    let rec: Vec<&Velocity> = i
        .closed
        .iter()
        .filter(|v| v.committed.is_some_and(|c| c > 0) && v.committed_done.is_some())
        .collect();
    if rec.len() < MIN_CLOSED_SPRINTS {
        if i.has_sprints {
            o.hold(
                "reliability_wait",
                &[
                    ("need", json!(MIN_CLOSED_SPRINTS)),
                    ("have", json!(rec.len())),
                ],
            );
        }
        return;
    }
    let last = &rec[rec.len().saturating_sub(RELIABILITY_SPRINTS)..];
    let committed: u32 = last.iter().filter_map(|v| v.committed).sum();
    let delivered: u32 = last.iter().filter_map(|v| v.committed_done).sum();
    let share = pct(delivered as f64, committed as f64);
    let recent = &last[last.len().saturating_sub(3)..];
    let avg = recent.iter().map(|v| v.points as f64).sum::<f64>() / recent.len() as f64;
    let worst = last
        .iter()
        .min_by(|a, b| {
            let ra = a.committed_done.unwrap_or(0) as f64 / a.committed.unwrap_or(1) as f64;
            let rb = b.committed_done.unwrap_or(0) as f64 / b.committed.unwrap_or(1) as f64;
            ra.partial_cmp(&rb).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|v| v.name.clone())
        .unwrap_or_default();
    let sev = if share < 60 {
        Severity::Risk
    } else if share < 80 {
        Severity::Warn
    } else {
        Severity::Info
    };
    o.say(
        "reliability",
        sev,
        &[
            ("sprints", json!(last.len())),
            ("committed", json!(committed)),
            ("delivered", json!(delivered)),
            ("pct", json!(share)),
            ("avgVelocity", json!(r1(avg))),
            ("avgOf", json!(recent.len())),
            ("worst", json!(worst)),
        ],
        vec![],
    );
}

fn percentile(v: &[f64], q: f64) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    let mut s = v.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let k = ((s.len() as f64 - 1.0) * q).round() as usize;
    Some(s[k.min(s.len() - 1)])
}

/// Cards in the flow for longer than 85% of the finished issues took from start to Done.
fn aging(i: &Input, o: &mut Out) {
    if i.wip.is_empty() {
        return;
    }
    if i.cycle_days.len() < MIN_CYCLE_SAMPLES {
        o.hold(
            "aging_wait",
            &[
                ("need", json!(MIN_CYCLE_SAMPLES)),
                ("have", json!(i.cycle_days.len())),
            ],
        );
        return;
    }
    let Some(p85) = percentile(&i.cycle_days, 0.85) else {
        return;
    };
    let mut old: Vec<(&WipItem, f64)> = i
        .wip
        .iter()
        .map(|w| (w, days(i.now - w.started)))
        .filter(|(_, age)| *age > p85)
        .collect();
    if old.is_empty() {
        return;
    }
    old.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.key.cmp(&b.0.key))
    });
    let oldest = old[0].1;
    let sev = if oldest > 2.0 * p85.max(0.1) {
        Severity::Risk
    } else {
        Severity::Warn
    };
    o.say(
        "aging",
        sev,
        &[
            ("count", json!(old.len())),
            ("p85", json!(r1(p85))),
            ("oldestDays", json!(r1(oldest))),
            ("oldestState", json!(old[0].0.state)),
        ],
        old.iter().map(|(w, _)| w.key.clone()).collect(),
    );
}

/// Issues blocked now, and how long the sprint's issues have been blocked.
fn blocked(i: &Input, o: &mut Out) {
    let sprint_days = i.active.as_ref().map_or(0.0, |a| r1(days(a.blocked_ms)));
    if i.blocked.is_empty() {
        if sprint_days > 0.0 {
            o.say(
                "blocked_sprint",
                Severity::Info,
                &[("sprintDays", json!(sprint_days))],
                vec![],
            );
        }
        return;
    }
    let mut v: Vec<(&BlockedItem, Option<f64>)> = i
        .blocked
        .iter()
        .map(|b| (b, b.since.map(|s| days(i.now - s))))
        .collect();
    v.sort_by(|a, b| {
        b.1.unwrap_or(-1.0)
            .partial_cmp(&a.1.unwrap_or(-1.0))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.0.key.cmp(&b.0.key))
    });
    let longest = v[0].1;
    let sev = if longest.is_some_and(|d| d >= 2.0) {
        Severity::Risk
    } else {
        Severity::Warn
    };
    o.say(
        "blocked",
        sev,
        &[
            ("count", json!(v.len())),
            ("longestDays", longest.map_or(Value::Null, |d| json!(r1(d)))),
            ("longestKey", json!(v[0].0.key)),
            (
                "unknownSince",
                json!(v.iter().filter(|x| x.1.is_none()).count()),
            ),
            ("sprintDays", json!(sprint_days)),
        ],
        v.iter().map(|(b, _)| b.key.clone()).collect(),
    );
}

/// Co-Dev cost per point of the finished issues, and open issues already well above it.
fn cost(i: &Input, o: &mut Out) {
    let spent: f64 = i.costs.iter().map(|c| c.cost_usd).sum();
    let unpriced: u32 = i.costs.iter().map(|c| c.unpriced).sum();
    let base: Vec<&IssueCost> = i
        .costs
        .iter()
        .filter(|c| c.done && c.points.is_some_and(|p| p > 0) && c.cost_usd > 0.0)
        .collect();
    if base.len() < MIN_COST_ISSUES {
        if spent > 0.0 {
            o.hold(
                "cost_wait",
                &[
                    ("need", json!(MIN_COST_ISSUES)),
                    ("have", json!(base.len())),
                ],
            );
        }
        return;
    }
    let pts: u32 = base.iter().filter_map(|c| c.points).sum();
    let total: f64 = base.iter().map(|c| c.cost_usd).sum();
    let per_point = total / pts as f64;
    let mut ratios: Vec<f64> = base
        .iter()
        .map(|c| c.cost_usd / c.points.unwrap_or(1) as f64)
        .collect();
    ratios.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = percentile(&ratios, 0.5).unwrap_or(per_point);
    let mut costly: Vec<&&IssueCost> = base
        .iter()
        .filter(|c| c.cost_usd / c.points.unwrap_or(1) as f64 > 2.0 * median)
        .collect();
    costly.sort_by(|a, b| {
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    o.say(
        "cost_per_point",
        if costly.is_empty() {
            Severity::Info
        } else {
            Severity::Warn
        },
        &[
            ("perPoint", json!(r2(per_point))),
            ("issues", json!(base.len())),
            ("points", json!(pts)),
            ("total", json!(r2(total))),
            ("outliers", json!(costly.len())),
            ("unpriced", json!(unpriced)),
        ],
        costly.iter().map(|c| c.key.clone()).collect(),
    );
    // open issues that already cost more than twice what their points usually cost
    let mut over: Vec<(&IssueCost, f64)> = i
        .costs
        .iter()
        .filter(|c| !c.done)
        .filter_map(|c| {
            let p = c.points.filter(|p| *p > 0)?;
            let usual = per_point * p as f64;
            (c.cost_usd > 2.0 * usual).then_some((c, c.cost_usd / usual))
        })
        .collect();
    if !over.is_empty() {
        over.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        o.say(
            "cost_overrun",
            Severity::Warn,
            &[
                ("count", json!(over.len())),
                ("perPoint", json!(r2(per_point))),
                ("worstKey", json!(over[0].0.key)),
                ("worstCost", json!(r2(over[0].0.cost_usd))),
                ("worstTimes", json!(r1(over[0].1))),
            ],
            over.iter().map(|(c, _)| c.key.clone()).collect(),
        );
    }
}

/// How often the tests fail after Co-Dev worked on an issue.
fn rework(i: &Input, o: &mut Out) {
    let runs: u32 = i.tests.iter().map(|t| t.runs).sum();
    let failed: u32 = i.tests.iter().map(|t| t.failed).sum();
    if (runs as usize) < MIN_TEST_RUNS {
        if runs > 0 {
            o.hold(
                "rework_wait",
                &[("need", json!(MIN_TEST_RUNS)), ("have", json!(runs))],
            );
        }
        return;
    }
    let share = pct(failed as f64, runs as f64);
    let mut keys: Vec<&IssueTests> = i.tests.iter().filter(|t| t.failed > 0).collect();
    keys.sort_by(|a, b| b.failed.cmp(&a.failed).then_with(|| a.key.cmp(&b.key)));
    let sev = if share > 50 {
        Severity::Risk
    } else if share > 25 {
        Severity::Warn
    } else {
        Severity::Info
    };
    o.say(
        "rework",
        sev,
        &[
            ("runs", json!(runs)),
            ("failed", json!(failed)),
            ("pct", json!(share)),
            ("issues", json!(keys.len())),
        ],
        keys.iter().map(|t| t.key.clone()).collect(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_763_000_000_000;
    const D: i64 = DAY_MS;

    fn bp(day: i64, scope: u32, done: u32) -> BurnPoint {
        BurnPoint {
            day: T0 + day * D,
            remaining: scope - done,
            scope,
            done,
        }
    }

    fn sprint(days: Vec<BurnPoint>) -> ActiveSprint {
        ActiveSprint {
            id: "S1".into(),
            start: T0,
            end: T0 + 10 * D,
            committed: Some(20),
            days,
            open: vec![("A-1".into(), 5), ("A-2".into(), 8)],
            ..Default::default()
        }
    }

    fn find<'a>(r: &'a Insights, code: &str) -> Option<&'a Insight> {
        r.items.iter().find(|i| i.code == code)
    }
    fn held(r: &Insights, code: &str) -> bool {
        r.withheld.iter().any(|w| w.code == code)
    }

    #[test]
    fn nothing_is_said_without_history() {
        let r = compute(&Input {
            now: T0,
            ..Default::default()
        });
        assert!(r.items.is_empty() && r.withheld.is_empty(), "{r:?}");
    }

    #[test]
    fn the_forecast_waits_for_two_days_then_reads_the_recent_pace() {
        let now = T0 + D;
        let r = compute(&Input {
            now,
            active: Some(sprint(vec![bp(0, 20, 0), bp(1, 20, 4)])),
            ..Default::default()
        });
        assert!(held(&r, "forecast_wait"), "{r:?}");

        // 4 days in, 8 points done (2/day), 12 left with 6 days to go → on track
        let now = T0 + 4 * D;
        let days = (0..=4).map(|d| bp(d, 20, (d * 2) as u32)).collect();
        let r = compute(&Input {
            now,
            active: Some(sprint(days)),
            ..Default::default()
        });
        let f = find(&r, "forecast_on_track").expect("on track");
        assert_eq!(f.severity, Severity::Info);
        assert_eq!(f.params["rate"], json!(2.0));
        assert_eq!(f.params["finishInDays"], json!(6.0));
        assert_eq!(f.params["daysLeft"], json!(6.0));

        // same days but only 1 point a day: 16 left, 6 days → 6 done, 10 days late
        let days = (0..=4).map(|d| bp(d, 20, d as u32)).collect();
        let r = compute(&Input {
            now,
            active: Some(sprint(days)),
            ..Default::default()
        });
        let f = find(&r, "forecast_late").expect("late");
        assert_eq!(f.severity, Severity::Risk);
        assert_eq!(f.params["projectedDone"], json!(6));
        assert_eq!(f.params["lateDays"], json!(10));
        assert_eq!(f.keys, ["A-2", "A-1"], "biggest open issue first");
    }

    #[test]
    fn the_pace_comes_from_the_last_days_and_ignores_added_scope() {
        // 8 days: nothing for 3, then 3/day; 10 points joined on day 6 — the scope grows,
        // the remaining does not fall, but the pace (done) is still 3/day
        let mut days: Vec<BurnPoint> = (0..=3).map(|d| bp(d, 20, 0)).collect();
        days.extend((4..=5).map(|d| bp(d, 20, ((d - 3) * 3) as u32)));
        days.extend((6..=8).map(|d| bp(d, 30, ((d - 3) * 3) as u32)));
        let mut a = sprint(days);
        a.end = T0 + 14 * D;
        let r = compute(&Input {
            now: T0 + 8 * D,
            active: Some(a),
            ..Default::default()
        });
        let f = find(&r, "forecast_on_track")
            .or(find(&r, "forecast_late"))
            .unwrap();
        assert_eq!(f.params["rate"], json!(3.0), "{f:?}");
        assert_eq!(f.params["windowDays"], json!(FORECAST_WINDOW_DAYS));
        assert_eq!(f.params["remaining"], json!(15));
    }

    #[test]
    fn a_stalled_overdue_or_finished_sprint_says_so() {
        let days: Vec<BurnPoint> = (0..=3).map(|d| bp(d, 20, 5)).collect();
        let r = compute(&Input {
            now: T0 + 3 * D,
            active: Some(sprint(days.clone())),
            ..Default::default()
        });
        assert_eq!(
            find(&r, "forecast_stalled").unwrap().severity,
            Severity::Risk
        );

        let r = compute(&Input {
            now: T0 + 11 * D,
            active: Some(sprint(days)),
            ..Default::default()
        });
        assert!(find(&r, "forecast_overdue").is_some());

        let mut a = sprint(vec![bp(0, 20, 0), bp(1, 20, 20)]);
        a.open.clear();
        let r = compute(&Input {
            now: T0 + D,
            active: Some(a),
            ..Default::default()
        });
        assert!(find(&r, "forecast_done").is_some());

        // open work, none estimated: no forecast, and why
        let mut a = sprint(vec![bp(0, 5, 5), bp(1, 5, 5), bp(2, 5, 5)]);
        a.open = vec![("A-3".into(), 0)];
        a.unestimated = vec!["A-3".into()];
        let r = compute(&Input {
            now: T0 + 2 * D,
            active: Some(a),
            ..Default::default()
        });
        assert!(held(&r, "forecast_unestimated"));
        assert_eq!(find(&r, "unestimated").unwrap().keys, ["A-3"]);
    }

    #[test]
    fn scope_creep_counts_joined_left_and_reestimated_points() {
        let mut a = sprint(vec![bp(0, 20, 0)]);
        a.added = vec![("A-7".into(), 5), ("A-8".into(), 3)];
        a.removed = vec![("A-2".into(), 2)];
        a.reestimated = 2;
        let r = compute(&Input {
            now: T0,
            active: Some(a.clone()),
            ..Default::default()
        });
        let s = find(&r, "scope_creep").unwrap();
        assert_eq!(s.params["net"], json!(8));
        assert_eq!(s.params["pct"], json!(40));
        assert_eq!(s.severity, Severity::Warn);
        assert_eq!(s.keys, ["A-7", "A-8", "A-2"]);

        // nothing changed: nothing to say
        let r = compute(&Input {
            now: T0,
            active: Some(sprint(vec![bp(0, 20, 0)])),
            ..Default::default()
        });
        assert!(find(&r, "scope_creep").is_none() && !held(&r, "scope_creep_partial"));

        // started before the history: not guessed
        a.partial = true;
        a.committed = None;
        let r = compute(&Input {
            now: T0,
            active: Some(a),
            ..Default::default()
        });
        assert!(find(&r, "scope_creep").is_none() && held(&r, "scope_creep_partial"));
    }

    fn vel(name: &str, committed: Option<u32>, cdone: Option<u32>, points: u32) -> Velocity {
        Velocity {
            sprint: name.into(),
            name: name.into(),
            points,
            committed,
            committed_done: cdone,
            added: None,
            removed: None,
            carried: None,
            partial: committed.is_none(),
        }
    }

    #[test]
    fn reliability_needs_two_recorded_sprints_and_skips_partial_ones() {
        let r = compute(&Input {
            has_sprints: true,
            closed: vec![vel("S1", None, None, 9), vel("S2", Some(10), Some(8), 8)],
            ..Default::default()
        });
        assert_eq!(
            r.withheld[0].params["have"],
            json!(1),
            "the partial sprint does not count"
        );
        let r = compute(&Input {
            has_sprints: true,
            closed: vec![
                vel("S1", None, None, 9),
                vel("S2", Some(10), Some(8), 8),
                vel("S3", Some(12), Some(3), 6),
            ],
            ..Default::default()
        });
        let x = find(&r, "reliability").unwrap();
        assert_eq!(x.params["pct"], json!(50));
        assert_eq!(x.params["sprints"], json!(2));
        assert_eq!(x.params["worst"], json!("S3"));
        assert_eq!(
            x.params["avgVelocity"],
            json!(7.0),
            "the recorded sprints only"
        );
        assert_eq!(x.severity, Severity::Risk);
    }

    #[test]
    fn aging_compares_with_the_cycle_time_percentile() {
        let wip = vec![
            WipItem {
                key: "A-1".into(),
                state: "review".into(),
                started: T0,
            },
            WipItem {
                key: "A-2".into(),
                state: "progress".into(),
                started: T0 + 9 * D,
            },
        ];
        let now = T0 + 10 * D;
        let r = compute(&Input {
            now,
            wip: wip.clone(),
            cycle_days: vec![1.0, 2.0],
            ..Default::default()
        });
        assert!(held(&r, "aging_wait"));
        let r = compute(&Input {
            now,
            wip,
            cycle_days: vec![1.0, 2.0, 2.0, 3.0, 4.0, 4.0],
            ..Default::default()
        });
        let a = find(&r, "aging").unwrap();
        assert_eq!(a.keys, ["A-1"]);
        assert_eq!(a.params["p85"], json!(4.0));
        assert_eq!(a.params["oldestDays"], json!(10.0));
        assert_eq!(a.severity, Severity::Risk);
    }

    #[test]
    fn blocked_issues_longest_first_and_unknown_starts_are_not_guessed() {
        let now = T0 + 5 * D;
        let r = compute(&Input {
            now,
            blocked: vec![
                BlockedItem {
                    key: "A-1".into(),
                    since: Some(T0 + 4 * D),
                },
                BlockedItem {
                    key: "A-2".into(),
                    since: Some(T0),
                },
                BlockedItem {
                    key: "A-3".into(),
                    since: None,
                },
            ],
            ..Default::default()
        });
        let b = find(&r, "blocked").unwrap();
        assert_eq!(b.keys, ["A-2", "A-1", "A-3"]);
        assert_eq!(b.params["longestDays"], json!(5.0));
        assert_eq!(b.params["unknownSince"], json!(1));
        assert_eq!(b.severity, Severity::Risk);
    }

    fn cost_of(key: &str, usd: f64, points: Option<u32>, done: bool) -> IssueCost {
        IssueCost {
            key: key.into(),
            cost_usd: usd,
            points,
            done,
            turns: 1,
            unpriced: 0,
        }
    }

    #[test]
    fn cost_per_point_outliers_and_overruns() {
        let r = compute(&Input {
            costs: vec![cost_of("A-1", 1.0, Some(2), true)],
            ..Default::default()
        });
        assert!(held(&r, "cost_wait"));
        let r = compute(&Input {
            costs: vec![
                cost_of("A-1", 1.0, Some(2), true),
                cost_of("A-2", 1.5, Some(3), true),
                cost_of("A-3", 6.0, Some(3), true),
                cost_of("A-4", 0.4, None, true),
                cost_of("A-5", 9.0, Some(1), false),
                cost_of("A-6", 0.5, Some(5), false),
            ],
            ..Default::default()
        });
        let c = find(&r, "cost_per_point").unwrap();
        assert_eq!(c.params["perPoint"], json!(1.06), "8.5 $ / 8 points");
        assert_eq!(
            c.params["issues"],
            json!(3),
            "unestimated issues are left out"
        );
        assert_eq!(c.keys, ["A-3"]);
        let o = find(&r, "cost_overrun").unwrap();
        assert_eq!(o.keys, ["A-5"]);
    }

    #[test]
    fn rework_rate_from_the_test_runs() {
        let r = compute(&Input {
            tests: vec![IssueTests {
                key: "A-1".into(),
                runs: 2,
                failed: 1,
            }],
            ..Default::default()
        });
        assert!(held(&r, "rework_wait"));
        let r = compute(&Input {
            tests: vec![
                IssueTests {
                    key: "A-1".into(),
                    runs: 3,
                    failed: 2,
                },
                IssueTests {
                    key: "A-2".into(),
                    runs: 1,
                    failed: 0,
                },
            ],
            ..Default::default()
        });
        let x = find(&r, "rework").unwrap();
        assert_eq!(x.params["pct"], json!(50));
        assert_eq!(x.keys, ["A-1"]);
        assert_eq!(x.severity, Severity::Warn);
    }

    #[test]
    fn the_most_severe_come_first() {
        let mut a = sprint((0..=3).map(|d| bp(d, 20, 5)).collect());
        a.unestimated = vec!["A-9".into()];
        let r = compute(&Input {
            now: T0 + 3 * D,
            active: Some(a),
            ..Default::default()
        });
        let sev: Vec<Severity> = r.items.iter().map(|i| i.severity).collect();
        let mut sorted = sev.clone();
        sorted.sort();
        assert_eq!(sev, sorted);
        assert_eq!(r.items[0].code, "forecast_stalled");
    }
}
