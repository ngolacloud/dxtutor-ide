//! PR infra review (r23 F5b, docs/v2/AUDIT-r23.md §4.5 — UI-PLAT-11, C01/C02): a pull request read through `gh`, its
//! diff, and «Before you merge» — each check with its source, or «not connected»:
//!
//! - **ci**: the PR's own checks (`statusCheckRollup`);
//! - **plan / policy / cost**: the IaC pipeline (`tutor_eval::iac::run`) on every IaC folder the PR touches, in a
//!   temporary worktree of the PR head (`git fetch origin pull/N/head`), removed after;
//! - **window**: the change windows of `.dxtutor/deploy.json`;
//! - **rollback**: a PR that touches migrations needs a down migration to roll back;
//! - **incidents**: the local incidents that name what the PR touches;
//! - **capacity, error budget**: the project's Prometheus (`crate::metrics`) — the cluster's requests over the
//!   allocatable, and each SLO's budget; without the source, «not connected»;
//! - **on-call**: no pager source — «not connected».
//!
//! The rule ([`submit_args`]): approving with a failing check needs a reason, posted on the PR with the approval;
//! the PR must still be the one reviewed (same head). The caller audits it and runs `gh pr review`.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tutor_board::project::incidents::Incident;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Ok,
    Failed,
    Pending,
    NotInstalled,
    NotConnected,
    Skipped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    pub status: Status,
    pub summary: String,
    /// where the answer comes from (`gh statusCheckRollup`, `tofu plan in infra/`, …)
    pub source: String,
}

fn check(id: &str, status: Status, summary: impl Into<String>, source: &str) -> Check {
    Check {
        id: id.into(),
        status,
        summary: summary.into(),
        source: source.into(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PrReview {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub head_sha: String,
    pub files: Vec<String>,
    /// the diff, secrets masked (at most 200 000 characters)
    pub diff: String,
    pub checks: Vec<Check>,
    /// the checks that fail (approving needs a reason)
    pub failing: Vec<String>,
}

pub struct Ctx<'a> {
    pub root: &'a Path,
    pub cmd: &'a dyn Fn(&str) -> Command,
    pub has: &'a dyn Fn(&str) -> bool,
    pub incidents: &'a [Incident],
    /// accepted IaC risks (the pipeline does not block on them)
    pub accepted: &'a HashSet<String>,
    /// the project's metrics source, connected (capacity, error budget), or why not
    pub metrics: Result<&'a crate::metrics::Live, String>,
}

/// Capacity and error budget from the metrics source.
fn metric_checks(m: &Result<&crate::metrics::Live, String>) -> [Check; 2] {
    let l = match m {
        Ok(l) => *l,
        Err(why) => {
            return [
                check(
                    "capacity",
                    Status::NotConnected,
                    format!("capacity needs a metrics source ({why})"),
                    "not connected",
                ),
                check(
                    "error-budget",
                    Status::NotConnected,
                    format!("the error budget needs a metrics source ({why})"),
                    "not connected",
                ),
            ]
        }
    };
    let src = format!("Prometheus {} at {}", l.version, l.prom.url);
    let cap = match crate::metrics::capacity(&l.prom, &l.cfg.capacity) {
        Ok(c) => check(
            "capacity",
            if c.over { Status::Failed } else { Status::Ok },
            crate::metrics::capacity_line(&c),
            &format!("{src} (kube-state-metrics)"),
        ),
        Err(e) => check("capacity", Status::NotConnected, e, &src),
    };
    let budget = if l.slos.is_empty() {
        check(
            "error-budget",
            Status::Skipped,
            format!("no SLOs in {}", crate::metrics::SLO_FILE),
            crate::metrics::SLO_FILE,
        )
    } else {
        let (mut lines, mut spent, mut unknown) = (vec![], false, false);
        for s in &l.slos {
            match crate::metrics::budget(&l.prom, s) {
                Ok(b) => {
                    spent |= b.exhausted;
                    unknown |= b.remaining.is_none();
                    lines.push(crate::metrics::budget_line(&b));
                }
                Err(e) => {
                    unknown = true;
                    lines.push(format!("{}: {e}", s.name));
                }
            }
        }
        let st = if spent {
            Status::Failed
        } else if unknown {
            Status::NotConnected
        } else {
            Status::Ok
        };
        check("error-budget", st, lines.join(" · "), &src)
    };
    [cap, budget]
}

struct Out {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn run(c: &Ctx, cwd: &Path, program: &str, args: &[&str]) -> Out {
    match (c.cmd)(program)
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .output()
    {
        Ok(o) => Out {
            ok: o.status.success(),
            stdout: String::from_utf8_lossy(&o.stdout).to_string(),
            stderr: String::from_utf8_lossy(&o.stderr).to_string(),
        },
        Err(e) => Out {
            ok: false,
            stdout: String::new(),
            stderr: e.to_string(),
        },
    }
}

/// The reviews kept for [`submit_args`]: PR number → (the head reviewed, the failing checks).
type Kept = Mutex<HashMap<u64, (String, Vec<String>)>>;

fn kept() -> &'static Kept {
    static K: std::sync::OnceLock<Kept> = std::sync::OnceLock::new();
    K.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The PR's own checks (`statusCheckRollup`: CheckRun `conclusion`/`status`, StatusContext `state`).
pub fn ci_of(rollup: &Value) -> Check {
    let items = rollup.as_array().cloned().unwrap_or_default();
    if items.is_empty() {
        return check(
            "ci",
            Status::Skipped,
            "the PR has no checks",
            "gh statusCheckRollup",
        );
    }
    let mut failed = vec![];
    let mut pending = vec![];
    for i in &items {
        let name = i["name"]
            .as_str()
            .or(i["context"].as_str())
            .unwrap_or("?")
            .to_string();
        let conclusion = i["conclusion"]
            .as_str()
            .or(i["state"].as_str())
            .unwrap_or("")
            .to_ascii_uppercase();
        let status = i["status"]
            .as_str()
            .unwrap_or("COMPLETED")
            .to_ascii_uppercase();
        if matches!(
            conclusion.as_str(),
            "FAILURE" | "ERROR" | "CANCELLED" | "TIMED_OUT" | "ACTION_REQUIRED" | "STARTUP_FAILURE"
        ) {
            failed.push(name);
        } else if status != "COMPLETED"
            || conclusion == "PENDING"
            || conclusion == "EXPECTED"
            || conclusion.is_empty()
        {
            pending.push(name);
        }
    }
    if !failed.is_empty() {
        check(
            "ci",
            Status::Failed,
            format!("failing: {}", failed.join(", ")),
            "gh statusCheckRollup",
        )
    } else if !pending.is_empty() {
        check(
            "ci",
            Status::Pending,
            format!("still running: {}", pending.join(", ")),
            "gh statusCheckRollup",
        )
    } else {
        check(
            "ci",
            Status::Ok,
            format!("{} check(s) passed", items.len()),
            "gh statusCheckRollup",
        )
    }
}

/// The IaC folders a PR touches (the folders of its `.tf` files).
pub fn iac_dirs_of(files: &[String]) -> Vec<String> {
    let mut d: Vec<String> = files
        .iter()
        .filter(|f| f.ends_with(".tf") || f.ends_with(".tfvars"))
        .map(|f| {
            f.rsplit_once('/')
                .map(|(a, _)| a.to_string())
                .unwrap_or_else(|| ".".into())
        })
        .collect();
    d.sort();
    d.dedup();
    d
}

const MIGRATION_DIRS: &[&str] = &[
    "migrations/",
    "db/migrate/",
    "prisma/migrations/",
    "alembic/versions/",
    "db/migration/",
];

pub fn rollback_of(files: &[String]) -> Check {
    let m: Vec<&String> = files
        .iter()
        .filter(|f| MIGRATION_DIRS.iter().any(|d| f.contains(d)))
        .collect();
    if m.is_empty() {
        check(
            "rollback",
            Status::Ok,
            "no migrations: reverting the merge restores the previous state",
            "the PR's files",
        )
    } else {
        check(
            "rollback",
            Status::Failed,
            format!(
                "touches migrations ({}): rolling back needs a down migration",
                m.iter().map(|s| s.as_str()).collect::<Vec<_>>().join(", ")
            ),
            "the PR's files",
        )
    }
}

/// The local incidents that name a folder or file the PR touches.
pub fn similar(incidents: &[Incident], files: &[String]) -> Check {
    let words: HashSet<String> = files
        .iter()
        .flat_map(|f| {
            f.split('/')
                .map(|s| {
                    s.trim_end_matches(".tf")
                        .trim_end_matches(".yaml")
                        .to_ascii_lowercase()
                })
                .collect::<Vec<_>>()
        })
        .filter(|w| w.len() >= 4)
        .collect();
    let hits: Vec<String> = incidents
        .iter()
        .filter(|i| {
            let t = i.title.to_ascii_lowercase();
            words.iter().any(|w| t.contains(w.as_str()))
        })
        .map(|i| format!("{} {}", i.key, i.title))
        .collect();
    if hits.is_empty() {
        check(
            "incidents",
            Status::Ok,
            "no local incident names what this PR touches",
            "local incidents",
        )
    } else {
        check(
            "incidents",
            Status::Ok,
            format!("similar: {}", hits.join("; ")),
            "local incidents",
        )
    }
}

fn iac_checks(c: &Ctx, number: u64, dirs: &[String]) -> Vec<Check> {
    if dirs.is_empty() {
        return ["plan", "policy", "cost"]
            .iter()
            .map(|id| {
                check(
                    id,
                    Status::Skipped,
                    "no infrastructure as code in this PR",
                    "the PR's files",
                )
            })
            .collect();
    }
    let refname = format!("refs/dxtutor/pr/{number}");
    let spec = format!("+pull/{number}/head:{refname}");
    let f = run(c, c.root, "git", &["fetch", "--no-tags", "origin", &spec]);
    if !f.ok {
        let why = format!(
            "could not fetch the PR head: {}",
            f.stderr.trim().lines().last().unwrap_or("")
        );
        return ["plan", "policy", "cost"]
            .iter()
            .map(|id| {
                check(
                    id,
                    Status::NotConnected,
                    why.clone(),
                    "git fetch origin pull/N/head",
                )
            })
            .collect();
    }
    let tmp = match tempfile::tempdir() {
        Ok(t) => t,
        Err(e) => {
            return vec![check(
                "plan",
                Status::NotConnected,
                e.to_string(),
                "a temporary worktree",
            )]
        }
    };
    let wt: PathBuf = tmp.path().join("pr");
    let wts = wt.to_string_lossy().to_string();
    let add = run(
        c,
        c.root,
        "git",
        &["worktree", "add", "--detach", &wts, &refname],
    );
    if !add.ok {
        return vec![check(
            "plan",
            Status::NotConnected,
            format!("no worktree of the PR head: {}", add.stderr.trim()),
            "git worktree",
        )];
    }
    let plans = tmp.path().join("plans");
    let mut plan_lines = vec![];
    let mut plan_status = Status::Ok;
    let mut policy_failed = vec![];
    let mut missing: HashSet<String> = HashSet::new();
    let mut cost: Option<Check> = None;
    for dir in dirs {
        let ctx = tutor_eval::iac::Ctx {
            root: &wt,
            dir,
            target: None,
            plans: &plans,
            accepted: c.accepted,
            cmd: c.cmd,
            has: c.has,
        };
        let r = tutor_eval::iac::run(&ctx, &mut |_| {});
        let st = |id: &str| r.stages.iter().find(|s| s.id == id);
        match (st("plan"), r.plan.as_ref()) {
            (_, Some(p)) => {
                plan_lines.push(format!("{dir}: +{} ~{} −{}", p.add, p.change, p.destroy))
            }
            (Some(s), None) => {
                plan_status = Status::Failed;
                plan_lines.push(format!("{dir}: {}", s.summary));
            }
            (None, None) => {
                plan_status = Status::Failed;
                plan_lines.push(format!("{dir}: {}", r.notes));
            }
        }
        for s in &r.stages {
            match (s.id.as_str(), s.status) {
                (
                    "rules" | "tflint" | "checkov" | "trivy" | "state" | "conftest",
                    tutor_eval::iac::Status::Failed,
                ) => policy_failed.push(format!("{dir}: {} ({})", s.id, s.summary)),
                (
                    "rules" | "tflint" | "checkov" | "trivy" | "conftest",
                    tutor_eval::iac::Status::NotInstalled,
                ) => {
                    missing.insert(s.id.clone());
                }
                ("infracost", st) => {
                    cost = Some(match st {
                        tutor_eval::iac::Status::Ok => {
                            check("cost", Status::Ok, s.summary.clone(), "infracost")
                        }
                        tutor_eval::iac::Status::NotInstalled => check(
                            "cost",
                            Status::NotInstalled,
                            "infracost is not installed",
                            "infracost",
                        ),
                        tutor_eval::iac::Status::NotConnected => check(
                            "cost",
                            Status::NotConnected,
                            "infracost has no API key",
                            "infracost",
                        ),
                        _ => check("cost", Status::Skipped, s.summary.clone(), "infracost"),
                    })
                }
                _ => {}
            }
        }
    }
    let _ = run(c, c.root, "git", &["worktree", "remove", "--force", &wts]);
    let _ = run(c, c.root, "git", &["update-ref", "-d", &refname]);
    let mut miss: Vec<String> = missing.into_iter().collect();
    miss.sort();
    vec![
        check(
            "plan",
            plan_status,
            plan_lines.join(" · "),
            "the IaC pipeline on the PR head",
        ),
        if policy_failed.is_empty() {
            check(
                "policy",
                Status::Ok,
                if miss.is_empty() {
                    "no blocking finding".to_string()
                } else {
                    format!("no blocking finding (not installed: {})", miss.join(", "))
                },
                "built-in rules, tflint, checkov, trivy, conftest",
            )
        } else {
            check(
                "policy",
                Status::Failed,
                policy_failed.join(" · "),
                "built-in rules, tflint, checkov, trivy, conftest",
            )
        },
        cost.unwrap_or_else(|| check("cost", Status::Skipped, "no plan to cost", "infracost")),
    ]
}

/// Reviews PR `number`: its data, diff and every «Before you merge» check. Kept for [`submit_args`].
pub fn review(c: &Ctx, number: u64) -> Result<PrReview, String> {
    if !(c.has)("gh") {
        return Err("gh is not installed: install the GitHub CLI and run `gh auth login`".into());
    }
    let n = number.to_string();
    let v = run(c, c.root, "gh", &["pr", "view", &n, "--json", "number,title,url,author,headRefName,baseRefName,headRefOid,files,statusCheckRollup,state"]);
    if !v.ok {
        return Err(format!(
            "gh could not read PR #{number}: {}",
            v.stderr.trim()
        ));
    }
    let pr: Value = serde_json::from_str(&v.stdout).map_err(|e| e.to_string())?;
    let files: Vec<String> = pr["files"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| f["path"].as_str().map(String::from))
        .collect();
    let d = run(c, c.root, "gh", &["pr", "diff", &n]);
    let diff = tutor_protect::redact::current().mask(&d.stdout);
    let diff = if diff.chars().count() > 200_000 {
        diff.chars().take(200_000).collect()
    } else {
        diff
    };
    let mut checks = vec![ci_of(&pr["statusCheckRollup"])];
    checks.extend(iac_checks(c, number, &iac_dirs_of(&files)));
    let cfg = crate::deploy::load_config(c.root).unwrap_or_default();
    checks.push(if cfg.windows.is_empty() {
        check(
            "window",
            Status::Skipped,
            "no change window configured (.dxtutor/deploy.json)",
            ".dxtutor/deploy.json",
        )
    } else {
        let s = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let (day, min) = (((s / 86400 + 3) % 7) as u32, ((s % 86400) / 60) as u32);
        if crate::deploy::in_window(&cfg.windows, day, min) {
            check(
                "window",
                Status::Ok,
                "inside a change window (UTC)",
                ".dxtutor/deploy.json",
            )
        } else {
            check(
                "window",
                Status::Failed,
                "outside every change window (UTC)",
                ".dxtutor/deploy.json",
            )
        }
    });
    checks.push(rollback_of(&files));
    checks.push(similar(c.incidents, &files));
    checks.extend(metric_checks(&c.metrics));
    checks.push(check(
        "on-call",
        Status::NotConnected,
        "on-call needs a pager source",
        "not connected",
    ));
    let failing: Vec<String> = checks
        .iter()
        .filter(|x| x.status == Status::Failed)
        .map(|x| x.id.clone())
        .collect();
    let head_sha = pr["headRefOid"].as_str().unwrap_or("").to_string();
    kept()
        .lock()
        .unwrap()
        .insert(number, (head_sha.clone(), failing.clone()));
    Ok(PrReview {
        number,
        title: pr["title"].as_str().unwrap_or("").into(),
        url: pr["url"].as_str().unwrap_or("").into(),
        author: pr["author"]["login"].as_str().unwrap_or("").into(),
        head: pr["headRefName"].as_str().unwrap_or("").into(),
        base: pr["baseRefName"].as_str().unwrap_or("").into(),
        head_sha,
        files,
        diff,
        checks,
        failing,
    })
}

/// The `gh pr review` arguments for a decision (`approve` | `request-changes` | `comment`), refused when the PR was
/// not reviewed here, moved since, or is approved with failing checks and no reason (the reason goes on the PR).
pub fn submit_args(
    number: u64,
    head_now: &str,
    decision: &str,
    body: &str,
    reason: Option<&str>,
) -> Result<Vec<String>, String> {
    let (head, failing) = kept()
        .lock()
        .unwrap()
        .get(&number)
        .cloned()
        .ok_or("review the PR here first")?;
    if head != head_now {
        return Err("the PR changed after this review: review it again".into());
    }
    let flag = match decision {
        "approve" => "--approve",
        "request-changes" => "--request-changes",
        "comment" => "--comment",
        _ => return Err(format!("not a review decision: {decision}")),
    };
    let reason = reason.map(str::trim).filter(|r| !r.is_empty());
    let mut text = body.trim().to_string();
    if decision == "approve" && !failing.is_empty() {
        let Some(r) = reason.filter(|r| r.chars().count() >= 3) else {
            return Err(format!(
                "approving with failing checks ({}) needs a reason",
                failing.join(", ")
            ));
        };
        text = format!(
            "{text}\n\nApproved with failing checks: {} — reason: {r}",
            failing.join(", ")
        )
        .trim()
        .to_string();
    }
    if decision != "approve" && text.is_empty() {
        return Err("say what to change (the review's body)".into());
    }
    Ok(vec![
        "pr".into(),
        "review".into(),
        number.to_string(),
        flag.into(),
        "--body".into(),
        text,
    ])
}

/// The PR's head now (`gh pr view N --json headRefOid`).
pub fn head_now(c: &Ctx, number: u64) -> Result<String, String> {
    let o = run(
        c,
        c.root,
        "gh",
        &[
            "pr",
            "view",
            &number.to_string(),
            "--json",
            "headRefOid",
            "-q",
            ".headRefOid",
        ],
    );
    if o.ok {
        Ok(o.stdout.trim().into())
    } else {
        Err(o.stderr.trim().into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_checks_of_a_pr() {
        assert_eq!(ci_of(&json!([])).status, Status::Skipped);
        let ci = ci_of(
            &json!([{"name": "test", "status": "COMPLETED", "conclusion": "SUCCESS"}, {"context": "deploy/preview", "state": "FAILURE"}]),
        );
        assert_eq!(
            (ci.status, ci.summary.as_str()),
            (Status::Failed, "failing: deploy/preview")
        );
        assert_eq!(
            ci_of(&json!([{"name": "build", "status": "IN_PROGRESS", "conclusion": ""}])).status,
            Status::Pending
        );
        assert_eq!(
            ci_of(&json!([{"name": "build", "status": "COMPLETED", "conclusion": "SUCCESS"}]))
                .status,
            Status::Ok
        );
        let files = vec![
            "infra/live/main.tf".to_string(),
            "infra/live/vars.tfvars".into(),
            "main.tf".into(),
            "app/src/x.rs".into(),
        ];
        assert_eq!(iac_dirs_of(&files), vec![".", "infra/live"]);
        assert_eq!(rollback_of(&files).status, Status::Ok);
        assert_eq!(
            rollback_of(&["db/migrate/0007_add.sql".to_string()]).status,
            Status::Failed
        );
        let inc = vec![Incident {
            key: "INC-2".into(),
            title: "checkout latency after a payments change".into(),
            ..Default::default()
        }];
        assert!(similar(&inc, &["services/payments/main.tf".to_string()])
            .summary
            .contains("INC-2"));
        assert!(similar(&inc, &["docs/readme.md".to_string()])
            .summary
            .starts_with("no local incident"));
    }

    /// r23 F5b acceptance: approving with a failing check needs a reason (in Rust), which goes on the PR; a PR that
    /// changed after the review, or was not reviewed here, is refused.
    #[test]
    fn approving_with_a_failing_check_needs_a_reason() {
        kept()
            .lock()
            .unwrap()
            .insert(49, ("abc".into(), vec!["ci".into(), "rollback".into()]));
        kept().lock().unwrap().insert(50, ("def".into(), vec![]));
        assert!(submit_args(48, "x", "approve", "", None)
            .unwrap_err()
            .contains("review the PR here first"));
        assert!(submit_args(49, "zzz", "approve", "", Some("ok"))
            .unwrap_err()
            .contains("changed after"));
        assert!(submit_args(49, "abc", "approve", "lgtm", None)
            .unwrap_err()
            .contains("failing checks (ci, rollback) needs a reason"));
        assert!(submit_args(49, "abc", "approve", "lgtm", Some(" ")).is_err());
        let a = submit_args(
            49,
            "abc",
            "approve",
            "lgtm",
            Some("the preview env is down, not this change"),
        )
        .unwrap();
        assert_eq!(a[..5], ["pr", "review", "49", "--approve", "--body"]);
        assert_eq!(a[5], "lgtm\n\nApproved with failing checks: ci, rollback — reason: the preview env is down, not this change");
        assert_eq!(submit_args(50, "def", "approve", "", None).unwrap()[5], "");
        assert!(submit_args(50, "def", "request-changes", " ", None)
            .unwrap_err()
            .contains("say what"));
        assert!(submit_args(50, "def", "merge", "x", None).is_err());
    }

    /// A whole review with a fake `gh`: the PR's checks, the diff masked, the IaC checks «not connected» when the PR head
    /// cannot be fetched (never green), and what has no source here.
    #[test]
    fn a_review_with_a_fake_gh() {
        let d = tempfile::tempdir().unwrap();
        let bin = d.path().join("gh");
        std::fs::write(&bin, r#"#!/bin/sh
case "$*" in
  "pr view 77 --json"*) echo '{"number":77,"title":"bigger db","url":"https://github.com/o/r/pull/77","author":{"login":"bruno"},"headRefName":"db","baseRefName":"main","headRefOid":"abc123","state":"OPEN","files":[{"path":"infra/db/main.tf"}],"statusCheckRollup":[{"name":"test","status":"COMPLETED","conclusion":"FAILURE"}]}' ;;
  "pr diff 77") printf 'diff --git a/infra/db/main.tf\n+  url = "postgres://app:hunter2pass@db/app"\n' ;;
esac
"#).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let repo = tempfile::tempdir().unwrap();
        assert!(Command::new("git")
            .args(["init", "-q"])
            .current_dir(repo.path())
            .status()
            .unwrap()
            .success());
        let b2 = bin.clone();
        let cmd = move |p: &str| {
            if p == "gh" {
                Command::new(&b2)
            } else {
                Command::new(p)
            }
        };
        let has = |p: &str| p == "gh" || p == "git";
        let none = HashSet::new();
        let c = Ctx {
            root: repo.path(),
            cmd: &cmd,
            has: &has,
            incidents: &[],
            accepted: &none,
            metrics: Err("not connected".into()),
        };
        let r = review(&c, 77).unwrap();
        assert_eq!(
            (r.title.as_str(), r.head_sha.as_str(), r.author.as_str()),
            ("bigger db", "abc123", "bruno")
        );
        assert!(!r.diff.contains("hunter2pass"), "{}", r.diff);
        let st = |id: &str| {
            r.checks
                .iter()
                .find(|x| x.id == id)
                .map(|x| x.status)
                .unwrap()
        };
        assert_eq!(
            (st("ci"), st("plan"), st("policy"), st("cost")),
            (
                Status::Failed,
                Status::NotConnected,
                Status::NotConnected,
                Status::NotConnected
            )
        );
        assert_eq!(
            (
                st("capacity"),
                st("error-budget"),
                st("on-call"),
                st("window"),
                st("rollback")
            ),
            (
                Status::NotConnected,
                Status::NotConnected,
                Status::NotConnected,
                Status::Skipped,
                Status::Ok
            )
        );
        assert_eq!(r.failing, vec!["ci"]);
        assert!(submit_args(77, "abc123", "approve", "", None)
            .unwrap_err()
            .contains("(ci)"));
        let no_gh = Ctx {
            has: &|_: &str| false,
            ..c
        };
        assert!(review(&no_gh, 77).unwrap_err().contains("not installed"));
    }

    /// Capacity and error budget from a (fake) Prometheus: CPU over the limit fails, a healthy budget is ok, and
    /// without the source both say why.
    #[test]
    fn capacity_and_error_budget_from_metrics() {
        use crate::metrics::testkit::{fake, vector, BUILD, EMPTY};
        use crate::metrics::{
            Api, CapacityCfg, Config, Live, Slo, Q_CPU_ALLOC, Q_CPU_REQ, Q_MEM_ALLOC, Q_MEM_REQ,
        };
        let url = fake(|path, q, _| match path {
            "/api/v1/status/buildinfo" => (200, BUILD.into()),
            _ if q == Q_CPU_ALLOC => (200, vector(4.0)),
            _ if q == Q_CPU_REQ => (200, vector(3.8)),
            _ if q == Q_MEM_ALLOC => (200, vector(16e9)),
            _ if q == Q_MEM_REQ => (200, vector(4e9)),
            _ if q.contains("errs") => (200, vector(1.0)),
            _ if q.contains("reqs") => (200, vector(10_000.0)),
            _ => (200, EMPTY.into()),
        });
        let l = Live {
            prom: Api::plain(&url),
            version: "3.16.0".into(),
            cfg: Config {
                capacity: CapacityCfg { max_percent: 85.0 },
                ..Default::default()
            },
            slos: vec![Slo {
                name: "web".into(),
                objective: 99.0,
                window: "30d".into(),
                errors: "sum(errs[$window])".into(),
                total: "sum(reqs[$window])".into(),
                deployments: vec![],
            }],
        };
        let [cap, budget] = metric_checks(&Ok(&l));
        assert_eq!(cap.status, Status::Failed, "{cap:?}");
        assert_eq!(
            cap.summary,
            "CPU 95% · memory 25% of the allocatable requested (limit 85%)"
        );
        assert!(cap.source.contains("kube-state-metrics"));
        assert_eq!(budget.status, Status::Ok, "{budget:?}");
        assert!(budget
            .summary
            .starts_with("web: 99% of the 30d budget left"));
        let [c2, b2] = metric_checks(&Err("no token".into()));
        assert_eq!(
            (c2.status, b2.status),
            (Status::NotConnected, Status::NotConnected)
        );
        assert!(c2.summary.contains("no token"));
    }
}
