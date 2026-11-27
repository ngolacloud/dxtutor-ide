//! The gate decides on facts only: every branch of it, the verdict's checks, the reviews kept in the
//! base, and the integration walking the issue towards Done by the normal rules.

use super::*;
use crate::project::{Op, ProjectStore};
use serde_json::json;

fn tips() -> Tips {
    Tips {
        target: "main".into(),
        base: "b1".into(),
        branch: "feature/dx-1".into(),
        head: "h1".into(),
    }
}

fn check(name: &str, command: &str) -> Check {
    Check {
        name: name.into(),
        command: command.into(),
    }
}

fn run(name: &str, command: &str, exit: i32) -> CheckRun {
    CheckRun {
        name: name.into(),
        command: command.into(),
        exit: Some(exit),
        passed: exit == 0,
        tail: String::new(),
        ms: 1,
        timed_out: false,
    }
}

fn met(i: u32, text: &str) -> CriterionVerdict {
    CriterionVerdict {
        index: i,
        text: text.into(),
        status: "met".into(),
        evidence: vec![Evidence {
            kind: "file".into(),
            reference: "src/pay.rs".into(),
            lines: Some("1-3".into()),
            detail: None,
        }],
        note: String::new(),
    }
}

const CRITERIA: [&str; 2] = [
    "Dado um carrinho, quando pago, então fica pago",
    "Dado X, quando Y, então Z",
];

fn criteria() -> Vec<String> {
    CRITERIA.iter().map(|s| s.to_string()).collect()
}

/// A review that holds: both checks green, no finding, every criterion met.
fn reviewed() -> Review {
    Review {
        id: 1,
        key: "DX-1".into(),
        tips: tips(),
        candidate: "c1".into(),
        tree: "t1".into(),
        criteria: criteria(),
        required: vec![check("tests", "cargo test"), check("lint", "cargo clippy")],
        checks: vec![
            run("tests", "cargo test", 0),
            run("lint", "cargo clippy", 0),
        ],
        arch_rules: true,
        arch: vec![],
        conflicts: vec![],
        scan: None,
        verdict: Some(Verdict {
            overall: "met".into(),
            summary: "ok".into(),
            criteria: vec![met(1, CRITERIA[0]), met(2, CRITERIA[1])],
        }),
        reviewer: Some("m".into()),
        tokens_in: 1,
        tokens_out: 1,
        state: "reviewed".into(),
        error: None,
        actor: "Ana".into(),
        created: 1,
        updated: 1,
    }
}

fn approval() -> FunctionalApproval {
    FunctionalApproval {
        by: "Rita".into(),
        at: 5,
        note: String::new(),
    }
}

struct World {
    review: Option<Review>,
    running: bool,
    now: Tips,
    candidate_ok: bool,
    checks: Vec<Check>,
    criteria: Vec<String>,
    functional: Option<FunctionalApproval>,
    functional_criteria: Option<Vec<String>>,
}

impl World {
    fn good() -> Self {
        World {
            review: Some(reviewed()),
            running: false,
            now: tips(),
            candidate_ok: true,
            checks: vec![check("tests", "cargo test"), check("lint", "cargo clippy")],
            criteria: criteria(),
            functional: Some(approval()),
            functional_criteria: Some(criteria()),
        }
    }
    fn gate(&self) -> Gate {
        gate(&GateFacts {
            review: self.review.as_ref(),
            running: self.running,
            now: Ok(&self.now),
            candidate_ok: self.candidate_ok,
            checks: &self.checks,
            criteria: &self.criteria,
            functional: self.functional.as_ref(),
            functional_criteria: self.functional_criteria.as_deref(),
        })
    }
}

#[test]
fn all_three_conditions_hold_for_the_tips_as_they_are() {
    let g = World::good().gate();
    assert!(
        g.checks.ok && g.reviewer.ok && g.functional.ok && g.ok,
        "{g:?}"
    );
    assert_eq!(g.functional.items, ["Rita"]);
}

#[test]
fn a_failed_check_closes_the_gate_and_names_it() {
    let mut w = World::good();
    let r = w.review.as_mut().unwrap();
    r.checks[1] = run("lint", "cargo clippy", 1);
    let g = w.gate();
    assert!(!g.ok && !g.checks.ok);
    assert_eq!(
        (g.checks.code.as_str(), g.checks.items.clone()),
        ("failed", vec!["lint".to_string()])
    );
    // a check with no run at all is not a pass; neither is `passed` without exit 0
    let mut w = World::good();
    w.review.as_mut().unwrap().checks.pop();
    assert_eq!(w.gate().checks.code, "failed");
    let mut w = World::good();
    w.review.as_mut().unwrap().checks[0].exit = None;
    assert_eq!(w.gate().checks.code, "failed");
}

#[test]
fn no_mandatory_check_never_opens_the_gate() {
    let mut w = World::good();
    w.checks.clear();
    let g = w.gate();
    assert_eq!(g.checks.code, "none_set");
    assert!(!g.ok);
}

#[test]
fn a_tip_that_moved_after_a_green_run_makes_the_review_stale() {
    let mut w = World::good();
    w.now.head = "h2".into();
    let g = w.gate();
    assert_eq!(
        (g.checks.code.as_str(), g.reviewer.code.as_str()),
        ("stale_head", "stale")
    );
    assert!(!g.ok);
    let mut w = World::good();
    w.now.base = "b2".into();
    assert_eq!(w.gate().checks.code, "stale_base");
    assert!(!w.gate().ok);
    let mut w = World::good();
    w.now.target = "develop".into();
    assert_eq!(w.gate().checks.code, "stale_target");
    let mut w = World::good();
    w.candidate_ok = false;
    assert_eq!(w.gate().checks.code, "candidate");
    assert!(!w.gate().ok);
    let w = World::good();
    let g = gate(&GateFacts {
        now: Err("not a git repository"),
        ..GateFacts {
            review: w.review.as_ref(),
            running: false,
            now: Ok(&w.now),
            candidate_ok: true,
            checks: &w.checks,
            criteria: &w.criteria,
            functional: w.functional.as_ref(),
            functional_criteria: w.functional_criteria.as_deref(),
        }
    });
    assert_eq!(g.checks.code, "tips");
    assert!(!g.ok);
}

#[test]
fn checks_that_changed_after_the_review_must_run_again() {
    let mut w = World::good();
    w.checks.push(check("e2e", "npm run e2e"));
    assert_eq!(w.gate().checks.code, "stale_checks");
    let mut w = World::good();
    w.checks[0].command = "cargo test --all".into();
    assert_eq!(w.gate().checks.code, "stale_checks");
    assert!(!w.gate().ok);
    // the same checks in another order are the same checks
    let mut w = World::good();
    w.checks.reverse();
    assert!(w.gate().ok);
}

#[test]
fn a_broken_architecture_rule_closes_the_gate() {
    let mut w = World::good();
    w.review.as_mut().unwrap().arch.push(ArchFinding {
        rule: "layer:domain->infra".into(),
        message: "m".into(),
        path: "src/domain/a.rs".into(),
        line: Some(3),
    });
    let g = w.gate();
    assert_eq!(g.checks.code, "arch");
    assert_eq!(g.checks.items, ["src/domain/a.rs:3 layer:domain->infra"]);
    assert!(!g.ok);
}

#[test]
fn the_reviewer_must_say_met_for_every_criterion_with_evidence() {
    let mut w = World::good();
    let v = w.review.as_mut().unwrap().verdict.as_mut().unwrap();
    v.criteria[1].status = "not_met".into();
    v.overall = "not_met".into();
    let g = w.gate();
    assert_eq!(
        (g.reviewer.code.as_str(), g.reviewer.items.clone()),
        ("not_met", vec!["2".to_string()])
    );
    assert!(!g.ok);
    let mut w = World::good();
    let v = w.review.as_mut().unwrap().verdict.as_mut().unwrap();
    v.criteria[0].status = "unclear".into();
    v.overall = "unclear".into();
    assert_eq!(w.gate().reviewer.code, "unclear");
    assert!(!w.gate().ok);
    // an overall `met` does not cover a criterion left out, nor one without evidence
    let mut w = World::good();
    w.review
        .as_mut()
        .unwrap()
        .verdict
        .as_mut()
        .unwrap()
        .criteria
        .pop();
    assert_eq!(
        (
            w.gate().reviewer.code.as_str(),
            w.gate().reviewer.items.clone()
        ),
        ("unclear", vec!["2".to_string()])
    );
    let mut w = World::good();
    w.review
        .as_mut()
        .unwrap()
        .verdict
        .as_mut()
        .unwrap()
        .criteria[0]
        .evidence
        .clear();
    assert_eq!(w.gate().reviewer.code, "unclear");
    assert!(!w.gate().ok);
}

#[test]
fn criteria_that_changed_after_the_review_or_the_approval_close_the_gate() {
    let mut w = World::good();
    w.criteria[1] = "Dado X, quando Y, então W".into();
    let g = w.gate();
    assert_eq!(g.reviewer.code, "stale_criteria");
    assert_eq!(g.functional.code, "criteria_changed");
    assert!(!g.ok);
    // an approval with no recorded criteria is not trusted
    let mut w = World::good();
    w.functional_criteria = None;
    assert_eq!(w.gate().functional.code, "criteria_changed");
    assert!(!w.gate().ok);
    let mut w = World::good();
    w.functional = None;
    assert_eq!(w.gate().functional.code, "not_recorded");
    assert!(!w.gate().ok);
}

#[test]
fn a_review_that_is_running_conflicted_or_stopped_never_opens_the_gate() {
    let mut w = World::good();
    let r = w.review.as_mut().unwrap();
    r.state = "reviewing".into();
    r.verdict = None;
    w.running = true;
    assert_eq!(
        (
            w.gate().checks.code.as_str(),
            w.gate().reviewer.code.as_str()
        ),
        ("running", "running")
    );
    w.running = false;
    assert_eq!(w.gate().reviewer.code, "interrupted");
    assert!(!w.gate().ok);
    let mut w = World::good();
    let r = w.review.as_mut().unwrap();
    r.state = "conflict".into();
    r.conflicts = vec!["src/cart.rs".into()];
    r.checks.clear();
    r.verdict = None;
    let g = w.gate();
    assert_eq!(
        (g.checks.code.as_str(), g.checks.items.clone()),
        ("conflict", vec!["src/cart.rs".to_string()])
    );
    assert!(!g.ok);
    // checks failed: the reviewer was not asked
    let mut w = World::good();
    let r = w.review.as_mut().unwrap();
    r.state = "checked".into();
    r.checks[0] = run("tests", "cargo test", 101);
    r.verdict = None;
    assert_eq!(w.gate().reviewer.code, "skipped");
    // the reviewer failed to answer
    let mut w = World::good();
    let r = w.review.as_mut().unwrap();
    r.state = "failed".into();
    r.verdict = None;
    r.error = Some("the reviewer ended without a verdict".into());
    let g = w.gate();
    assert!(g.checks.ok);
    assert_eq!(g.reviewer.code, "no_verdict");
    assert!(!g.ok);
    // an integrated review is history, not a ticket to integrate again
    let mut w = World::good();
    w.review.as_mut().unwrap().state = "integrated".into();
    assert!(!w.gate().ok);
    let mut w = World::good();
    w.review = None;
    assert_eq!(w.gate().checks.code, "no_review");
    assert!(!w.gate().ok);
}

fn files_exist(e: &Evidence) -> Result<(), String> {
    match (e.kind.as_str(), e.reference.as_str()) {
        ("file", "src/pay.rs") | ("test", "pays_a_cart") | ("output", "tests") => Ok(()),
        (k, r) => Err(format!("{k} {r} does not exist")),
    }
}

#[test]
fn a_verdict_is_kept_only_when_every_criterion_is_answered_with_real_evidence() {
    let c = criteria();
    let good = json!({
        "overall": "met",
        "summary": "Both criteria hold.",
        "criteria": [
            {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs", "lines": "1-4"}, {"kind": "test", "ref": "pays_a_cart"}]},
            {"index": 2, "status": "met", "evidence": [{"kind": "output", "ref": "tests", "detail": "test result: ok"}]}
        ]
    });
    let v = validate_verdict(&good, &c, &files_exist).unwrap();
    assert_eq!(v.overall, "met");
    assert_eq!(
        v.criteria[0].text, CRITERIA[0],
        "the criterion is ours, not the model's"
    );
    assert_eq!(v.criteria[0].evidence[0].lines.as_deref(), Some("1-4"));
    // a missing criterion, a duplicate, an unknown index
    let e = validate_verdict(
        &json!({"overall": "met", "summary": "s", "criteria": [
            {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs"}]},
            {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs"}]},
            {"index": 3, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs"}]}
        ]}),
        &c,
        &files_exist,
    )
    .unwrap_err();
    assert!(e.iter().any(|p| p.contains("answered twice")), "{e:?}");
    assert!(
        e.iter().any(|p| p.contains("criterion 3 does not exist")),
        "{e:?}"
    );
    assert!(
        e.iter()
            .any(|p| p.contains("criterion 2") && p.contains("no answer")),
        "{e:?}"
    );
    // invented evidence, met without evidence, bad lines, a not_met with no reason
    let e = validate_verdict(
        &json!({"overall": "not_met", "summary": "s", "criteria": [
            {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/ghost.rs"}]},
            {"index": 2, "status": "not_met", "evidence": []}
        ]}),
        &c,
        &files_exist,
    )
    .unwrap_err();
    assert!(
        e.iter().any(|p| p.contains("src/ghost.rs does not exist")),
        "{e:?}"
    );
    assert!(
        e.iter()
            .any(|p| p.contains("criterion 1 is met: give the evidence")),
        "{e:?}"
    );
    assert!(
        e.iter()
            .any(|p| p.contains("criterion 2 is not_met: say why")),
        "{e:?}"
    );
    let e = validate_verdict(&json!({"overall": "met", "summary": "s", "criteria": [
        {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs", "lines": "9-2"}]},
        {"index": 2, "status": "maybe", "evidence": []}
    ]}), &c, &files_exist).unwrap_err();
    assert!(e.iter().any(|p| p.contains("`lines`")), "{e:?}");
    assert!(
        e.iter().any(|p| p.contains("criterion 2: `status`")),
        "{e:?}"
    );
    // the overall verdict follows the criteria
    let e = validate_verdict(
        &json!({"overall": "met", "summary": "s", "criteria": [
            {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs"}]},
            {"index": 2, "status": "unclear", "note": "no test covers it"}
        ]}),
        &c,
        &files_exist,
    )
    .unwrap_err();
    assert!(
        e.iter().any(|p| p.contains("the criteria say unclear")),
        "{e:?}"
    );
    let v = validate_verdict(
        &json!({"overall": "not_met", "summary": "s", "criteria": [
            {"index": 1, "status": "not_met", "note": "it charges twice"},
            {"index": 2, "status": "unclear", "note": "no test covers it"}
        ]}),
        &c,
        &files_exist,
    )
    .unwrap();
    assert_eq!(v.overall, "not_met");
    assert!(validate_verdict(&json!({}), &c, &files_exist).is_err());
}

/// A project with one issue (two criteria) on a branch.
fn store() -> (tempfile::TempDir, ProjectStore, String, String) {
    let d = tempfile::tempdir().unwrap();
    let mut st = ProjectStore::open(&d.path().join("b.sqlite3")).unwrap();
    let root = "/p".to_string();
    let p = st
        .apply(
            &root,
            "Ana",
            1,
            serde_json::from_value(
                json!({"op": "create_issue", "title": "Pagar", "kind": "story"}),
            )
            .unwrap(),
        )
        .unwrap();
    let key = p.issues[0].key.clone();
    let items: Vec<_> = CRITERIA
        .iter()
        .map(|t| json!({"text": t, "done": false}))
        .collect();
    st.apply(
        &root,
        "Ana",
        2,
        serde_json::from_value(json!({"op": "set_acceptance", "key": key, "items": items}))
            .unwrap(),
    )
    .unwrap();
    st.apply(
        &root,
        "Ana",
        3,
        serde_json::from_value(json!({"op": "update_issue", "key": key, "branch": "feature/dx-1"}))
            .unwrap(),
    )
    .unwrap();
    (d, st, root, key)
}

#[test]
fn the_approval_keeps_the_criteria_it_was_given_for_and_drops_with_them() {
    let (_d, mut st, root, key) = store();
    let f = st.gate_facts(&root, &key).unwrap();
    assert_eq!(
        (f.functional.clone(), f.functional_criteria.clone()),
        (None, None)
    );
    assert_eq!(f.branch.as_deref(), Some("feature/dx-1"));
    st.apply(
        &root,
        "Rita",
        4,
        Op::ApproveFunctional {
            key: key.clone(),
            note: None,
        },
    )
    .unwrap();
    let f = st.gate_facts(&root, &key).unwrap();
    assert_eq!(f.functional.as_ref().map(|a| a.by.as_str()), Some("Rita"));
    assert_eq!(
        f.functional_criteria.as_deref(),
        Some(criteria().as_slice())
    );
    let items = vec![json!({"text": "Dado A, quando B, então C", "done": false})];
    st.apply(
        &root,
        "Ana",
        5,
        serde_json::from_value(json!({"op": "set_acceptance", "key": key, "items": items}))
            .unwrap(),
    )
    .unwrap();
    let f = st.gate_facts(&root, &key).unwrap();
    assert_eq!((f.functional, f.functional_criteria), (None, None));
}

#[test]
fn a_review_round_trips_and_the_newest_one_counts() {
    let (_d, mut st, root, key) = store();
    let mut r = reviewed();
    r.key = key.clone();
    r.state = "checking".into();
    r.verdict = None;
    r.scan = Some(json!({"tool": "built-in", "findings": []}));
    let id = st.review_insert(&root, &r).unwrap();
    r.id = id;
    assert_eq!(st.review_latest(&root, &key).unwrap(), Some(r.clone()));
    r.state = "reviewed".into();
    r.verdict = reviewed().verdict;
    r.tokens_in = 900;
    st.review_update(&root, &r, 9).unwrap();
    let back = st.review(&root, id).unwrap().unwrap();
    assert_eq!(
        (back.state.as_str(), back.tokens_in, back.updated),
        ("reviewed", 900, 9)
    );
    assert_eq!(back.verdict, reviewed().verdict);
    let mut r2 = r.clone();
    r2.state = "checking".into();
    let id2 = st.review_insert(&root, &r2).unwrap();
    assert_eq!(st.review_latest(&root, &key).unwrap().unwrap().id, id2);
    assert!(st.review_latest(&root, "NOPE-1").unwrap().is_none());
}

#[test]
fn an_integration_walks_the_issue_towards_done_by_the_normal_rules() {
    let (_d, mut st, root, key) = store();
    // the issue is in Review; the DoD has one item not ticked: it stops in Accept, with why
    st.apply(
        &root,
        "Ana",
        4,
        serde_json::from_value(json!({"op": "settings", "dod": ["Docs updated"], "dor": []}))
            .unwrap(),
    )
    .unwrap();
    st.conn()
        .execute(
            "UPDATE issues SET state = 'review', ready = 1 WHERE root = ?1 AND key = ?2",
            rusqlite::params![root, key],
        )
        .unwrap();
    let mut r = reviewed();
    r.key = key.clone();
    let id = st.review_insert(&root, &r).unwrap();
    // a review that is not `reviewed` cannot be recorded as integrated
    let mut r2 = r.clone();
    r2.state = "checked".into();
    let id2 = st.review_insert(&root, &r2).unwrap();
    assert!(st
        .record_integration(&root, "Ana", 6, &key, id2, "c1", "main")
        .is_err());
    let end = st
        .record_integration(&root, "Ana", 7, &key, id, "c1", "main")
        .unwrap();
    assert_eq!(end, "accept");
    let back = st.review(&root, id).unwrap().unwrap();
    assert_eq!(back.state, "integrated");
    // twice is refused: it is no longer `reviewed`
    assert!(st
        .record_integration(&root, "Ana", 8, &key, id, "c1", "main")
        .is_err());
    let d = st.detail(&root, &key).unwrap();
    let kinds: Vec<String> = d.activity.iter().map(|a| a.kind.clone()).collect();
    assert!(
        kinds.contains(&"integrated".to_string()) && kinds.contains(&"held".to_string()),
        "{kinds:?}"
    );
    let p = st.load(&root, 9).unwrap();
    let i = p.issues.iter().find(|i| i.key == key).unwrap();
    assert!(i
        .links
        .iter()
        .any(|l| l.kind == "commit" && l.reference == "c1"));
}
