//! «My queue» (r23 F5b, docs/v2/AUDIT-r23.md §4.5 — RF-BK-Q01/Q02, UI-PLAT-09): items computed from real state,
//! each with why it is yours, one action, and a verification — an item is done only when its verification
//! passes, never because it was clicked.
//!
//! - **review**: pull requests that request your review (`gh … review-requested:@me`), with the CODEOWNERS rule that
//!   makes them yours; done when you have reviewed, or the PR is closed.
//! - **iac**: blocking built-in IaC findings in `.tf` files you changed in the last 90 days (`git log --author`);
//!   done when none is left (or each is accepted with a reason).
//! - **recurring**: runbooks with a `schedule:` (daily, weekly, monthly, quarterly) not completed within it; done when
//!   a complete run exists after it fell due.
//! - **incident**: open incidents you command; done when resolved.
//! - **deploy**: your last deploy to an environment failed; done when a later one there succeeded.
//!
//! On-call and drift «where you are on call» need a pager source: «not connected» (owner decision §5 Q9).

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tutor_board::project::deploys::DeployRecord;
use tutor_board::project::incidents::{Incident, QueueEvent};
use tutor_board::project::runbooks::RunbookStepRun;

use crate::runbook::{self, Runbook};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    /// stable: `review:49`, `iac:infra/main.tf`, `recurring:runbooks/restore.md`, `incident:3`, `deploy:staging`
    pub id: String,
    pub kind: String,
    pub title: String,
    /// why it is yours
    pub why: String,
    /// the one action: `open-pr` | `open-file` | `run-runbook` | `open-incident` | `open-deploy`
    pub action: String,
    pub arg: String,
    pub line: u32,
    pub done: bool,
    pub proof: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub name: String,
    pub email: String,
    pub gh: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Queue {
    pub me: Me,
    /// open: mine, not verified done, not handed over
    pub items: Vec<Item>,
    /// verified done (from the project base), newest first
    pub done: Vec<QueueEvent>,
    /// handed over (by anyone), newest first — the Team view
    pub team: Vec<QueueEvent>,
    /// counts measured in this workspace only
    pub measured: Vec<(String, String)>,
    /// the sources the queue could not read (`gh` not signed in, on-call…)
    pub missing: Vec<String>,
}

/// What the queue reads (the caller gathers it from the project base).
pub struct Ctx<'a> {
    pub root: &'a Path,
    pub cmd: &'a dyn Fn(&str) -> Command,
    pub has: &'a dyn Fn(&str) -> bool,
    pub runs: &'a [RunbookStepRun],
    pub incidents: &'a [Incident],
    pub deploys: &'a [DeployRecord],
    pub events: &'a [QueueEvent],
    /// accepted IaC risks still in force (their keys)
    pub accepted: &'a HashSet<String>,
    /// Co-Dev's precision on incidents: (right, judged)
    pub precision: (i64, i64),
    pub now: i64,
}

fn out(c: &Ctx, program: &str, args: &[&str]) -> Option<String> {
    let o = (c.cmd)(program)
        .args(args)
        .current_dir(c.root)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    o.status
        .success()
        .then(|| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

pub fn me(c: &Ctx) -> Me {
    Me {
        name: out(c, "git", &["config", "user.name"]).unwrap_or_default(),
        email: out(c, "git", &["config", "user.email"]).unwrap_or_default(),
        gh: if (c.has)("gh") {
            out(c, "gh", &["api", "user", "-q", ".login"]).filter(|s| !s.is_empty())
        } else {
            None
        },
    }
}

// ───── CODEOWNERS ─────

/// A CODEOWNERS pattern against a path (gitignore-like: `*.tf`, `/infra/`, `infra/**`, `docs/*`).
pub fn owns(pattern: &str, path: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let anchored = pattern.starts_with('/');
    let p = pattern.trim_start_matches('/');
    if let Some(dir) = p.strip_suffix('/') {
        if anchored || dir.contains('/') {
            return path.starts_with(&format!("{dir}/"));
        }
        let segs: Vec<&str> = path.split('/').collect();
        return segs[..segs.len().saturating_sub(1)]
            .iter()
            .any(|s| glob(dir, s));
    }
    if !anchored && !p.contains('/') {
        return path.split('/').any(|s| glob(p, s));
    }
    glob(p, path) || path.starts_with(&format!("{}/", p.trim_end_matches("/**")))
}

fn glob(p: &str, s: &str) -> bool {
    fn go(p: &[u8], s: &[u8]) -> bool {
        match (p.first(), s.first()) {
            (None, None) => true,
            (Some(b'*'), _) => {
                let double = p.get(1) == Some(&b'*');
                let rest = if double { &p[2..] } else { &p[1..] };
                (0..=s.len()).any(|i| (double || !s[..i].contains(&b'/')) && go(rest, &s[i..]))
            }
            (Some(b'?'), Some(c)) if *c != b'/' => go(&p[1..], &s[1..]),
            (Some(a), Some(b)) if a == b => go(&p[1..], &s[1..]),
            _ => false,
        }
    }
    go(p.as_bytes(), s.as_bytes())
}

/// The project's CODEOWNERS rules (`.github/`, the root, `docs/`), in order.
pub fn codeowners(root: &Path) -> Vec<(String, Vec<String>)> {
    for f in [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"] {
        if let Ok(t) = std::fs::read_to_string(root.join(f)) {
            return t
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .filter_map(|l| {
                    let mut w = l.split_whitespace();
                    let pat = w.next()?.to_string();
                    Some((pat, w.map(String::from).collect()))
                })
                .collect();
        }
    }
    vec![]
}

/// The owners of a path: the LAST matching rule wins.
pub fn owners_of<'a>(
    rules: &'a [(String, Vec<String>)],
    path: &str,
) -> Option<&'a (String, Vec<String>)> {
    rules.iter().rev().find(|(p, _)| owns(p, path))
}

// ───── recurring runbooks ─────

/// The cadence of a `schedule:` in days.
pub fn cadence_days(schedule: &str) -> Option<i64> {
    Some(match schedule.trim().to_ascii_lowercase().as_str() {
        "daily" => 1,
        "weekly" => 7,
        "monthly" => 30,
        "quarterly" => 91,
        _ => return None,
    })
}

/// The runs of a runbook that are complete (every step has a row; checks and actions matched, or judged), by run.
pub fn complete_runs<'a>(rb: &Runbook, runs: &'a [RunbookStepRun]) -> Vec<(&'a str, i64)> {
    if rb.steps.is_empty() {
        return vec![];
    }
    let mut by: HashMap<&str, Vec<&RunbookStepRun>> = HashMap::new();
    for r in runs.iter().filter(|r| r.path == rb.path) {
        by.entry(r.run_id.as_str()).or_default().push(r);
    }
    let mut out: Vec<(&str, i64)> = by
        .into_iter()
        .filter(|(_, steps)| {
            rb.steps.iter().all(|s| {
                steps
                    .iter()
                    .any(|r| r.n == s.n && (r.kind == "decision" || r.matched == Some(true)))
            })
        })
        .map(|(id, steps)| (id, steps.iter().map(|s| s.at).max().unwrap_or(0)))
        .collect();
    out.sort_by_key(|(_, at)| *at);
    out
}

// ───── the items ─────

fn reviews(c: &Ctx, me: &Me, missing: &mut Vec<String>) -> Vec<Item> {
    let Some(login) = &me.gh else {
        missing.push(if (c.has)("gh") {
            "review requests: gh is not signed in".into()
        } else {
            "review requests: gh is not installed".into()
        });
        return vec![];
    };
    let Some(json) = out(
        c,
        "gh",
        &[
            "pr",
            "list",
            "--search",
            "review-requested:@me",
            "--state",
            "open",
            "--json",
            "number,title,url,author,files",
        ],
    ) else {
        missing.push("review requests: gh could not list the pull requests".into());
        return vec![];
    };
    let rules = codeowners(c.root);
    let v: Value = serde_json::from_str(&json).unwrap_or(Value::Null);
    v.as_array()
        .into_iter()
        .flatten()
        .map(|pr| {
            let n = pr["number"].as_u64().unwrap_or(0);
            let files: Vec<&str> = pr["files"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|f| f["path"].as_str())
                .collect();
            let rule = files.iter().find_map(|f| {
                owners_of(&rules, f).filter(|(_, o)| {
                    o.iter().any(|x| {
                        x.trim_start_matches('@').eq_ignore_ascii_case(login) || x.contains('/')
                    })
                })
            });
            Item {
                id: format!("review:{n}"),
                kind: "review".into(),
                title: format!("Review PR #{n}: {}", pr["title"].as_str().unwrap_or("")),
                why: match rule {
                    Some((p, o)) => {
                        format!("your review is requested — CODEOWNERS: {p} {}", o.join(" "))
                    }
                    None => format!(
                        "your review is requested by {}",
                        pr["author"]["login"].as_str().unwrap_or("?")
                    ),
                },
                action: "open-pr".into(),
                arg: n.to_string(),
                ..Default::default()
            }
        })
        .collect()
}

fn verify_review(c: &Ctx, me: &Me, n: &str) -> Option<String> {
    let login = me.gh.as_ref()?;
    let v: Value = serde_json::from_str(&out(
        c,
        "gh",
        &["pr", "view", n, "--json", "state,reviews"],
    )?)
    .ok()?;
    if v["state"].as_str().is_some_and(|s| s != "OPEN") {
        return Some(format!(
            "PR #{n} is {}",
            v["state"].as_str().unwrap_or("").to_lowercase()
        ));
    }
    v["reviews"].as_array()?.iter().rev().find_map(|r| {
        let who = r["author"]["login"].as_str()?;
        let state = r["state"].as_str()?;
        (who.eq_ignore_ascii_case(login) && state != "PENDING")
            .then(|| format!("{who} reviewed: {state}"))
    })
}

fn blocking_in(c: &Ctx, file: &str) -> Vec<(u32, String)> {
    let Ok(text) = std::fs::read_to_string(c.root.join(file)) else {
        return vec![];
    };
    tutor_eval::iacfind::builtin(file, &text)
        .into_iter()
        .filter(|f| f.severity == "error")
        .filter(|f| {
            let fi = tutor_eval::iac::Finding {
                source: "built-in".into(),
                rule: f.rule.clone(),
                file: f.file.clone(),
                line: f.line,
                ..Default::default()
            };
            !c.accepted
                .contains(&tutor_eval::iac::finding_key(c.root, &fi))
        })
        .map(|f| (f.line, f.rule))
        .collect()
}

fn iac_items(c: &Ctx, me: &Me) -> Vec<Item> {
    if me.email.is_empty() {
        return vec![];
    }
    let author = format!("--author={}", me.email);
    let Some(log) = out(
        c,
        "git",
        &[
            "log",
            &author,
            "--since=90.days",
            "--name-only",
            "--format=",
        ],
    ) else {
        return vec![];
    };
    let mut files: Vec<&str> = log
        .lines()
        .map(str::trim)
        .filter(|l| l.ends_with(".tf") && c.root.join(l).is_file())
        .collect();
    files.sort();
    files.dedup();
    files
        .into_iter()
        .filter_map(|f| {
            let b = blocking_in(c, f);
            (!b.is_empty()).then(|| Item {
                id: format!("iac:{f}"),
                kind: "iac".into(),
                title: format!("{} blocking IaC finding(s) in {f}", b.len()),
                why: format!(
                    "you changed this file in the last 90 days (git log): {}",
                    b.iter()
                        .map(|(l, r)| format!("{r} at {l}"))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
                action: "open-file".into(),
                arg: f.into(),
                line: b[0].0,
                ..Default::default()
            })
        })
        .collect()
}

fn recurring(c: &Ctx, runbooks: &[Runbook]) -> Vec<Item> {
    runbooks
        .iter()
        .filter_map(|rb| {
            let days = cadence_days(rb.schedule.as_deref()?)?;
            let last = complete_runs(rb, c.runs).last().map(|(_, at)| *at);
            let due = last.map(|t| t + days * 86_400_000).unwrap_or(0);
            (c.now >= due).then(|| Item {
                id: format!("recurring:{}", rb.path),
                kind: "recurring".into(),
                title: format!("Run «{}»", rb.title),
                why: match last {
                    Some(_) => format!(
                        "recurring task ({}): the last complete run is more than {days} day(s) old",
                        rb.schedule.as_deref().unwrap_or("")
                    ),
                    None => format!(
                        "recurring task ({}): never run to the end",
                        rb.schedule.as_deref().unwrap_or("")
                    ),
                },
                action: "run-runbook".into(),
                arg: rb.path.clone(),
                ..Default::default()
            })
        })
        .collect()
}

fn incident_items(c: &Ctx, me: &Me) -> Vec<Item> {
    c.incidents
        .iter()
        .filter(|i| {
            i.status != "resolved"
                && (i.commander == me.name || Some(&i.commander) == me.gh.as_ref())
        })
        .map(|i| Item {
            id: format!("incident:{}", i.id),
            kind: "incident".into(),
            title: format!("{} {} ({}) is {}", i.key, i.title, i.severity, i.status),
            why: "you are its commander".into(),
            action: "open-incident".into(),
            arg: i.id.to_string(),
            ..Default::default()
        })
        .collect()
}

fn deploy_items(c: &Ctx, me: &Me) -> Vec<Item> {
    let mut latest: HashMap<&str, &DeployRecord> = HashMap::new();
    for d in c.deploys {
        if latest
            .get(d.env.as_str())
            .map(|x| d.at > x.at)
            .unwrap_or(true)
        {
            latest.insert(&d.env, d);
        }
    }
    let mut v: Vec<Item> = latest
        .into_values()
        .filter(|d| !d.ok && d.actor == me.name)
        .map(|d| Item {
            id: format!("deploy:{}", d.env),
            kind: "deploy".into(),
            title: format!(
                "The deploy to {} failed at {}",
                d.env,
                d.failed_step.as_deref().unwrap_or("?")
            ),
            why: format!(
                "you ran it ({} · {}/{})",
                d.version.chars().take(10).collect::<String>(),
                d.context,
                d.namespace
            ),
            action: "open-deploy".into(),
            arg: d.env.clone(),
            ..Default::default()
        })
        .collect();
    v.sort_by(|a, b| a.id.cmp(&b.id));
    v
}

/// Verifies one item against the real state now: `Some(proof)` when it is done.
pub fn verify(c: &Ctx, me: &Me, runbooks: &[Runbook], id: &str) -> Option<String> {
    let (kind, arg) = id.split_once(':')?;
    match kind {
        "review" => verify_review(c, me, arg),
        "iac" => blocking_in(c, arg)
            .is_empty()
            .then(|| format!("no blocking finding left in {arg}")),
        "recurring" => {
            let rb = runbooks.iter().find(|r| r.path == arg)?;
            let days = cadence_days(rb.schedule.as_deref()?)?;
            let (run, at) = complete_runs(rb, c.runs).last().copied()?;
            (c.now - at < days * 86_400_000)
                .then(|| format!("run {run} complete: {} step(s) with output", rb.steps.len()))
        }
        "incident" => {
            let i = c.incidents.iter().find(|i| i.id.to_string() == arg)?;
            (i.status == "resolved").then(|| format!("{} resolved", i.key))
        }
        "deploy" => {
            let last = c
                .deploys
                .iter()
                .filter(|d| d.env == arg)
                .max_by_key(|d| d.at)?;
            last.ok.then(|| {
                format!(
                    "deployed {} to {arg}",
                    last.version.chars().take(10).collect::<String>()
                )
            })
        }
        _ => None,
    }
}

/// The queue: my open items (verified ones and handed-over ones left out), done, team, measured.
pub fn build(c: &Ctx) -> Queue {
    let me = me(c);
    let runbooks = runbook::list(c.root);
    let mut missing = vec![];
    let mut items = reviews(c, &me, &mut missing);
    items.extend(iac_items(c, &me));
    items.extend(recurring(c, &runbooks));
    items.extend(incident_items(c, &me));
    items.extend(deploy_items(c, &me));
    missing.push("on-call and alerts: not connected (no pager source)".into());
    let handed: HashSet<&str> = c
        .events
        .iter()
        .filter(|e| e.kind == "handover" && e.actor == me.name)
        .map(|e| e.item.as_str())
        .collect();
    // an item done earlier comes back if its state does not hold any more (a new finding, a new failed deploy)
    for it in items.iter_mut() {
        if let Some(p) = verify(c, &me, &runbooks, &it.id) {
            it.done = true;
            it.proof = Some(p);
        }
    }
    let open: Vec<Item> = items
        .into_iter()
        .filter(|i| !i.done && !handed.contains(i.id.as_str()))
        .collect();
    let mine = |e: &&QueueEvent| e.actor == me.name;
    let deploys_mine = c.deploys.iter().filter(|d| d.actor == me.name).count();
    let mut run_ids: HashSet<&str> = HashSet::new();
    for r in c.runs.iter().filter(|r| r.actor == me.name) {
        run_ids.insert(&r.run_id);
    }
    let complete = runbooks
        .iter()
        .map(|rb| complete_runs(rb, c.runs).len())
        .sum::<usize>();
    let resolved = c
        .incidents
        .iter()
        .filter(|i| i.status == "resolved")
        .collect::<Vec<_>>();
    let ttr = if resolved.is_empty() {
        "—".to_string()
    } else {
        let mut m: Vec<i64> = resolved
            .iter()
            .map(|i| {
                (i.mitigated_at
                    .unwrap_or(i.resolved_at.unwrap_or(i.opened_at))
                    - i.opened_at)
                    / 60_000
            })
            .collect();
        m.sort();
        format!("{} min (median)", m[m.len() / 2])
    };
    Queue {
        measured: vec![
            ("deploysYouRan".into(), deploys_mine.to_string()),
            ("runbookRunsComplete".into(), complete.to_string()),
            ("runbookRunsYours".into(), run_ids.len().to_string()),
            ("incidentsResolved".into(), resolved.len().to_string()),
            ("timeToRestore".into(), ttr),
            (
                "codevConfirmed".into(),
                if c.precision.1 > 0 {
                    format!("{}/{}", c.precision.0, c.precision.1)
                } else {
                    "—".into()
                },
            ),
            (
                "verifiedDone".into(),
                c.events
                    .iter()
                    .filter(|e| e.kind == "done")
                    .filter(mine)
                    .count()
                    .to_string(),
            ),
        ],
        done: c
            .events
            .iter()
            .filter(|e| e.kind == "done")
            .cloned()
            .collect(),
        team: c
            .events
            .iter()
            .filter(|e| e.kind == "handover")
            .cloned()
            .collect(),
        items: open,
        missing,
        me,
    }
}

#[cfg(test)]
mod tests;
