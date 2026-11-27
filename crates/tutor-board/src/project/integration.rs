//! Multi Co-Dev, phase 4: the reviews of an issue branch and the integration gate.
//!
//! **The gate (the owner's rule, `docs/v2/QUESTIONS.md` Q9).** A change is integrated into the
//! default branch only if all three hold, for the tips as they are NOW:
//! 1. every mandatory check of the project passed on the candidate — the issue branch merged onto
//!    the default branch's current tip, the exact tree that would land — and the architect's rules
//!    found nothing there (a run on another commit does not count: when either tip moves, or the
//!    checks change, the review is stale);
//! 2. the Co-Dev reviewer confirmed every acceptance criterion of the issue, one by one, with
//!    evidence, for that same candidate and those same criteria;
//! 3. the responsible person recorded the functional approval, and it was given for the criteria the
//!    issue has now.
//!
//! [`gate`] is pure: the caller reads the facts (the newest review, the tips, the candidate's
//! integrity, the checks, the criteria, the approval) and asks it right before integrating. A
//! review is one row of `integration_reviews` (migration 19): the tips and the candidate, what
//! each check ran and gave, the architect's findings, and the reviewer's verdict.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{Check, FunctionalApproval, ProjectError};

/// The verdict words (per criterion and overall).
pub const STATUSES: [&str; 3] = ["met", "not_met", "unclear"];
/// The kinds of evidence a reviewer may give.
pub const EVIDENCE: [&str; 3] = ["file", "test", "output"];

/// The two tips a review is about (as `tutor_eval::gitwork::integrate::Tips`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Tips {
    pub target: String,
    pub base: String,
    pub branch: String,
    pub head: String,
}

/// One mandatory check as it ran on the candidate.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckRun {
    pub name: String,
    pub command: String,
    /// `None`: it did not end by itself (timed out, cancelled, killed by a signal)
    pub exit: Option<i32>,
    pub passed: bool,
    /// the end of its output, secrets masked
    pub tail: String,
    pub ms: u64,
    #[serde(default)]
    pub timed_out: bool,
}

/// A rule of the architect broken by a file of the candidate (no accepted ADR excuses it).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchFinding {
    pub rule: String,
    pub message: String,
    pub path: String,
    pub line: Option<usize>,
}

/// One piece of evidence: a file (and lines) of the candidate, a test, or a check's output.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub kind: String,
    /// the path (`file`), the test's name (`test`) or the check's name (`output`)
    #[serde(rename = "ref")]
    pub reference: String,
    /// `12` or `12-30` (`file`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lines: Option<String>,
    /// what it shows (a quote of the output, what the lines do)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// The reviewer's answer for one acceptance criterion.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CriterionVerdict {
    /// 1-based, in the issue's order
    pub index: u32,
    /// the criterion as the reviewer was given it
    pub text: String,
    pub status: String,
    pub evidence: Vec<Evidence>,
    #[serde(default)]
    pub note: String,
}

/// The reviewer's verdict on a candidate.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub overall: String,
    pub summary: String,
    pub criteria: Vec<CriterionVerdict>,
}

/// One review of an issue branch.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Review {
    #[serde(default)]
    pub id: i64,
    pub key: String,
    pub tips: Tips,
    /// the merge commit (empty when the merge conflicts)
    pub candidate: String,
    /// its tree
    pub tree: String,
    /// the criteria the reviewer was given
    pub criteria: Vec<String>,
    /// the mandatory checks when it was requested
    pub required: Vec<Check>,
    /// what they gave, in order (fewer than `required` when it stopped)
    pub checks: Vec<CheckRun>,
    /// the architect's rules exist in the project (`.dxtutor/architecture.toml`)
    pub arch_rules: bool,
    pub arch: Vec<ArchFinding>,
    /// the files that conflict (state `conflict`)
    pub conflicts: Vec<String>,
    /// the secret scan of what the candidate brings (masked report), when it ran
    pub scan: Option<Value>,
    pub verdict: Option<Verdict>,
    /// the reviewer's model
    pub reviewer: Option<String>,
    pub tokens_in: u64,
    pub tokens_out: u64,
    /// `checking` → `reviewing` → `reviewed`; or `checked` (a check failed or a rule broke: the
    /// reviewer does not run), `conflict`, `failed` (with `error`), `cancelled`; `integrated` at the end
    pub state: String,
    pub error: Option<String>,
    pub actor: String,
    pub created: i64,
    pub updated: i64,
}

const INSERT_COLS: &str = "key, target, base, branch, head, candidate, tree, criteria, required, checks, arch_rules, arch, conflicts, scan, verdict, reviewer, tokens_in, tokens_out, state, error, actor, created, updated";
const COLS: &str = "id, key, target, base, branch, head, candidate, tree, criteria, required, checks, arch_rules, arch, conflicts, scan, verdict, reviewer, tokens_in, tokens_out, state, error, actor, created, updated";

fn j<T: Serialize>(v: &T) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "null".into())
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Review> {
    let parse = |i: usize| -> rusqlite::Result<String> { r.get::<_, String>(i) };
    let list = |s: String| serde_json::from_str(&s).unwrap_or_default();
    Ok(Review {
        id: r.get(0)?,
        key: r.get(1)?,
        tips: Tips {
            target: r.get(2)?,
            base: r.get(3)?,
            branch: r.get(4)?,
            head: r.get(5)?,
        },
        candidate: r.get(6)?,
        tree: r.get(7)?,
        criteria: list(parse(8)?),
        required: serde_json::from_str(&parse(9)?).unwrap_or_default(),
        checks: serde_json::from_str(&parse(10)?).unwrap_or_default(),
        arch_rules: r.get(11)?,
        arch: serde_json::from_str(&parse(12)?).unwrap_or_default(),
        conflicts: list(parse(13)?),
        scan: r
            .get::<_, Option<String>>(14)?
            .and_then(|s| serde_json::from_str(&s).ok()),
        verdict: r
            .get::<_, Option<String>>(15)?
            .and_then(|s| serde_json::from_str(&s).ok()),
        reviewer: r.get(16)?,
        tokens_in: r.get::<_, i64>(17)?.max(0) as u64,
        tokens_out: r.get::<_, i64>(18)?.max(0) as u64,
        state: r.get(19)?,
        error: r.get(20)?,
        actor: r.get(21)?,
        created: r.get(22)?,
        updated: r.get(23)?,
    })
}

/// Records a new review; returns its id.
pub fn insert(c: &Connection, root: &str, v: &Review) -> Result<i64, ProjectError> {
    c.execute(
        &format!(
            "INSERT INTO integration_reviews (root, {INSERT_COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)"
        ),
        params![
            root,
            v.key,
            v.tips.target,
            v.tips.base,
            v.tips.branch,
            v.tips.head,
            v.candidate,
            v.tree,
            j(&v.criteria),
            j(&v.required),
            j(&v.checks),
            v.arch_rules,
            j(&v.arch),
            j(&v.conflicts),
            v.scan.as_ref().map(j),
            v.verdict.as_ref().map(j),
            v.reviewer,
            v.tokens_in as i64,
            v.tokens_out as i64,
            v.state,
            v.error,
            v.actor,
            v.created,
            v.updated,
        ],
    )?;
    Ok(c.last_insert_rowid())
}

/// Writes back what a review learned (its checks, findings, verdict, state).
pub fn update(c: &Connection, root: &str, v: &Review, now: i64) -> Result<(), ProjectError> {
    let n = c.execute(
        "UPDATE integration_reviews SET checks = ?3, arch_rules = ?4, arch = ?5, scan = ?6, verdict = ?7, reviewer = ?8,
                tokens_in = ?9, tokens_out = ?10, state = ?11, error = ?12, updated = ?13
         WHERE root = ?1 AND id = ?2",
        params![
            root,
            v.id,
            j(&v.checks),
            v.arch_rules,
            j(&v.arch),
            v.scan.as_ref().map(j),
            v.verdict.as_ref().map(j),
            v.reviewer,
            v.tokens_in as i64,
            v.tokens_out as i64,
            v.state,
            v.error,
            now,
        ],
    )?;
    if n == 0 {
        return Err(super::err(
            "not_found",
            format!("review {} not found", v.id),
        ));
    }
    Ok(())
}

/// The newest review of issue `key`.
pub fn latest(c: &Connection, root: &str, key: &str) -> Result<Option<Review>, ProjectError> {
    Ok(c
        .query_row(
            &format!("SELECT {COLS} FROM integration_reviews WHERE root = ?1 AND key = ?2 ORDER BY id DESC LIMIT 1"),
            params![root, key],
            row,
        )
        .optional()?)
}

/// One review by id.
pub fn get(c: &Connection, root: &str, id: i64) -> Result<Option<Review>, ProjectError> {
    Ok(c.query_row(
        &format!("SELECT {COLS} FROM integration_reviews WHERE root = ?1 AND id = ?2"),
        params![root, id],
        row,
    )
    .optional()?)
}

/* ───── the reviewer's verdict, checked before it is kept ───── */

fn line_range(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    let (a, b) = s.split_once('-').unwrap_or((s, s));
    let (a, b) = (a.trim().parse::<u32>().ok()?, b.trim().parse::<u32>().ok()?);
    (a >= 1 && b >= a).then_some((a, b))
}

/// The verdict the reviewer gave (the input of its `review_verdict` tool), checked: every
/// criterion answered once by its 1-based index, a known status, evidence for each `met` (and a
/// note or evidence otherwise), each piece of evidence of a known kind that `evidence_ok` confirms
/// exists (a file of the candidate, a test, a check that ran), and the overall verdict consistent
/// with the criteria (`met` only when all are met, `not_met` when one is not). The problems come
/// back as a list, for the reviewer to fix.
pub fn validate_verdict(
    input: &Value,
    criteria: &[String],
    evidence_ok: &dyn Fn(&Evidence) -> Result<(), String>,
) -> Result<Verdict, Vec<String>> {
    let mut problems = vec![];
    let overall = input["overall"].as_str().unwrap_or("").trim().to_string();
    if !STATUSES.contains(&overall.as_str()) {
        problems.push("`overall` must be one of met, not_met, unclear".to_string());
    }
    let summary: String = input["summary"]
        .as_str()
        .unwrap_or("")
        .trim()
        .chars()
        .take(4000)
        .collect();
    if summary.is_empty() {
        problems.push("`summary` is empty".to_string());
    }
    let given = input["criteria"].as_array().cloned().unwrap_or_default();
    let mut out: Vec<Option<CriterionVerdict>> = vec![None; criteria.len()];
    for item in &given {
        let Some(index) = item["index"].as_u64().filter(|i| *i >= 1) else {
            problems.push("each criterion needs its `index` (1-based)".to_string());
            continue;
        };
        let k = index as usize - 1;
        if k >= criteria.len() {
            problems.push(format!(
                "criterion {index} does not exist (the issue has {})",
                criteria.len()
            ));
            continue;
        }
        if out[k].is_some() {
            problems.push(format!("criterion {index} is answered twice"));
            continue;
        }
        let status = item["status"].as_str().unwrap_or("").trim().to_string();
        if !STATUSES.contains(&status.as_str()) {
            problems.push(format!(
                "criterion {index}: `status` must be met, not_met or unclear"
            ));
            continue;
        }
        let note: String = item["note"]
            .as_str()
            .unwrap_or("")
            .trim()
            .chars()
            .take(2000)
            .collect();
        let mut evidence = vec![];
        for e in item["evidence"].as_array().cloned().unwrap_or_default() {
            let ev = Evidence {
                kind: e["kind"].as_str().unwrap_or("").trim().to_string(),
                reference: e["ref"].as_str().unwrap_or("").trim().to_string(),
                lines: e["lines"]
                    .as_str()
                    .map(|s| s.trim().to_string())
                    .or_else(|| e["lines"].as_u64().map(|n| n.to_string()))
                    .filter(|s| !s.is_empty()),
                detail: e["detail"]
                    .as_str()
                    .map(|s| s.trim().chars().take(1000).collect::<String>())
                    .filter(|s| !s.is_empty()),
            };
            if !EVIDENCE.contains(&ev.kind.as_str()) || ev.reference.is_empty() {
                problems.push(format!(
                    "criterion {index}: each piece of evidence needs a `kind` (file, test, output) and a `ref`"
                ));
                continue;
            }
            if let Some(l) = &ev.lines {
                if ev.kind != "file" || line_range(l).is_none() {
                    problems.push(format!(
                        "criterion {index}: `lines` is `12` or `12-30`, on a file"
                    ));
                    continue;
                }
            }
            if let Err(why) = evidence_ok(&ev) {
                problems.push(format!("criterion {index}: {why}"));
                continue;
            }
            evidence.push(ev);
        }
        if status == "met" && evidence.is_empty() {
            problems.push(format!(
                "criterion {index} is met: give the evidence (files and lines, tests, output)"
            ));
            continue;
        }
        if status != "met" && evidence.is_empty() && note.is_empty() {
            problems.push(format!(
                "criterion {index} is {status}: say why in `note` (or give evidence)"
            ));
            continue;
        }
        out[k] = Some(CriterionVerdict {
            index: index as u32,
            text: criteria[k].clone(),
            status,
            evidence,
            note,
        });
    }
    for (k, c) in out.iter().enumerate() {
        if c.is_none()
            && !problems
                .iter()
                .any(|p| p.starts_with(&format!("criterion {} ", k + 1)))
        {
            problems.push(format!(
                "criterion {} («{}») has no answer",
                k + 1,
                criteria[k]
            ));
        }
    }
    if problems.is_empty() {
        let all: Vec<CriterionVerdict> = out.into_iter().flatten().collect();
        let expected = if all.iter().all(|c| c.status == "met") {
            "met"
        } else if all.iter().any(|c| c.status == "not_met") {
            "not_met"
        } else {
            "unclear"
        };
        if overall != expected {
            problems.push(format!(
                "`overall` is {overall} but the criteria say {expected} (met only when every criterion is met; not_met when one is not)"
            ));
        } else {
            return Ok(Verdict {
                overall,
                summary,
                criteria: all,
            });
        }
    }
    Err(problems)
}

/* ───── the gate ───── */

/// One condition of the gate: whether it holds and, as a code the interface words, why.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub ok: bool,
    pub code: String,
    /// what the code is about (check names, criterion numbers, files, the approver)
    pub items: Vec<String>,
}

fn cond(ok: bool, code: &str, items: Vec<String>) -> Condition {
    Condition {
        ok,
        code: code.into(),
        items,
    }
}

/// The three conditions and the decision.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Gate {
    pub checks: Condition,
    pub reviewer: Condition,
    pub functional: Condition,
    /// all three hold: the candidate may be integrated
    pub ok: bool,
}

/// What [`gate`] decides on — read by the caller right before it asks.
#[derive(Clone, Debug)]
pub struct GateFacts<'a> {
    /// the newest review of the issue
    pub review: Option<&'a Review>,
    /// a review of the issue is running in this app now
    pub running: bool,
    /// the tips as they are now (`Err`: they cannot be read — why)
    pub now: Result<&'a Tips, &'a str>,
    /// the review's candidate is still that tree with exactly those parents
    pub candidate_ok: bool,
    /// the project's mandatory checks now
    pub checks: &'a [Check],
    /// the issue's acceptance criteria now
    pub criteria: &'a [String],
    pub functional: Option<&'a FunctionalApproval>,
    /// the criteria the approval was given for
    pub functional_criteria: Option<&'a [String]>,
}

fn same_checks(a: &[Check], b: &[Check]) -> bool {
    let key = |v: &[Check]| {
        let mut k: Vec<(String, String)> = v
            .iter()
            .map(|c| (c.name.trim().to_string(), c.command.trim().to_string()))
            .collect();
        k.sort();
        k
    };
    key(a) == key(b)
}

/// The integration gate. Every condition is decided from the facts as they are now; the review
/// counts only for the tips, candidate, checks and criteria it was made for.
pub fn gate(f: &GateFacts) -> Gate {
    let checks = checks_condition(f);
    let reviewer = reviewer_condition(f);
    let functional = functional_condition(f);
    let ok = checks.ok
        && reviewer.ok
        && functional.ok
        && f.review.is_some_and(|r| r.state == "reviewed");
    Gate {
        checks,
        reviewer,
        functional,
        ok,
    }
}

/// Why the review no longer speaks for the tips as they are (`None`: it does).
fn staleness(f: &GateFacts, r: &Review) -> Option<Condition> {
    let now = match f.now {
        Ok(t) => t,
        Err(e) => return Some(cond(false, "tips", vec![e.to_string()])),
    };
    if now.branch != r.tips.branch {
        return Some(cond(
            false,
            "stale_branch",
            vec![now.branch.clone(), r.tips.branch.clone()],
        ));
    }
    if now.target != r.tips.target {
        return Some(cond(
            false,
            "stale_target",
            vec![now.target.clone(), r.tips.target.clone()],
        ));
    }
    if now.base != r.tips.base {
        return Some(cond(false, "stale_base", vec![r.tips.target.clone()]));
    }
    if now.head != r.tips.head {
        return Some(cond(false, "stale_head", vec![r.tips.branch.clone()]));
    }
    if !f.candidate_ok {
        return Some(cond(false, "candidate", vec![r.candidate.clone()]));
    }
    None
}

fn checks_condition(f: &GateFacts) -> Condition {
    if f.checks.is_empty() {
        return cond(false, "none_set", vec![]);
    }
    let Some(r) = f.review else {
        return cond(false, "no_review", vec![]);
    };
    if f.running && matches!(r.state.as_str(), "checking" | "reviewing") {
        return cond(false, "running", vec![]);
    }
    match r.state.as_str() {
        "conflict" => return cond(false, "conflict", r.conflicts.clone()),
        "checking" => return cond(false, "interrupted", vec![]),
        "cancelled" if r.checks.len() < r.required.len() => {
            return cond(false, "cancelled", vec![])
        }
        "failed" if r.checks.len() < r.required.len() => {
            return cond(false, "error", r.error.clone().into_iter().collect())
        }
        _ => {}
    }
    if let Some(s) = staleness(f, r) {
        return s;
    }
    if !same_checks(f.checks, &r.required) {
        return cond(false, "stale_checks", vec![]);
    }
    let failed: Vec<String> = f
        .checks
        .iter()
        .filter(|c| {
            !r.checks.iter().any(|x| {
                x.passed
                    && x.exit == Some(0)
                    && x.name.trim() == c.name.trim()
                    && x.command.trim() == c.command.trim()
            })
        })
        .map(|c| c.name.clone())
        .collect();
    if !failed.is_empty() {
        return cond(false, "failed", failed);
    }
    if !r.arch.is_empty() {
        return cond(
            false,
            "arch",
            r.arch
                .iter()
                .map(|a| match a.line {
                    Some(l) => format!("{}:{l} {}", a.path, a.rule),
                    None => format!("{} {}", a.path, a.rule),
                })
                .collect(),
        );
    }
    cond(
        true,
        "ok",
        f.checks.iter().map(|c| c.name.clone()).collect(),
    )
}

fn reviewer_condition(f: &GateFacts) -> Condition {
    let Some(r) = f.review else {
        return cond(false, "no_review", vec![]);
    };
    if f.running && matches!(r.state.as_str(), "checking" | "reviewing") {
        return cond(false, "running", vec![]);
    }
    if r.state == "conflict" {
        return cond(false, "conflict", r.conflicts.clone());
    }
    if staleness(f, r).is_some() {
        return cond(false, "stale", vec![]);
    }
    let Some(v) = &r.verdict else {
        return match r.state.as_str() {
            "checked" => cond(false, "skipped", vec![]),
            "checking" | "reviewing" => cond(false, "interrupted", vec![]),
            "cancelled" => cond(false, "cancelled", vec![]),
            _ => cond(false, "no_verdict", r.error.clone().into_iter().collect()),
        };
    };
    let trimmed = |v: &[String]| v.iter().map(|s| s.trim().to_string()).collect::<Vec<_>>();
    if trimmed(&r.criteria) != trimmed(f.criteria) || f.criteria.is_empty() {
        return cond(false, "stale_criteria", vec![]);
    }
    let answer = |i: usize| v.criteria.iter().find(|c| c.index as usize == i);
    let not_met: Vec<String> = (1..=f.criteria.len())
        .filter(|i| answer(*i).is_some_and(|c| c.status == "not_met"))
        .map(|i| i.to_string())
        .collect();
    if !not_met.is_empty() || v.overall == "not_met" {
        return cond(false, "not_met", not_met);
    }
    // a criterion with no answer, an answer that is not `met`, or a `met` without evidence
    let unclear: Vec<String> = (1..=f.criteria.len())
        .filter(|i| answer(*i).is_none_or(|c| c.status != "met" || c.evidence.is_empty()))
        .map(|i| i.to_string())
        .collect();
    if !unclear.is_empty() || v.overall != "met" {
        return cond(false, "unclear", unclear);
    }
    cond(true, "ok", vec![])
}

fn functional_condition(f: &GateFacts) -> Condition {
    let Some(a) = f.functional else {
        return cond(false, "not_recorded", vec![]);
    };
    let trimmed = |v: &[String]| v.iter().map(|s| s.trim().to_string()).collect::<Vec<_>>();
    match f.functional_criteria {
        Some(c) if !f.criteria.is_empty() && trimmed(c) == trimmed(f.criteria) => {
            cond(true, "ok", vec![a.by.clone()])
        }
        _ => cond(false, "criteria_changed", vec![a.by.clone()]),
    }
}

#[cfg(test)]
mod tests;
