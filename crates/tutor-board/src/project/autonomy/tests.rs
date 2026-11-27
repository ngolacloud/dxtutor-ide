//! Delegations (the rules of a grant, expiry, revocation, the issue and its sprint), the kill
//! switch, the events and their rate, the remote branches and the pull requests, and the body of a
//! pull request carrying the gate's evidence.

use super::*;
use crate::project::integration::{CheckRun, CriterionVerdict, Evidence, Tips, Verdict};
use crate::project::{Check, Op};
use serde_json::json;

const ROOT: &str = "/p";
const T0: i64 = 1_800_000_000_000;

fn op(v: serde_json::Value) -> Op {
    serde_json::from_value(v).unwrap()
}

/// A project with issue P-1 in sprint S1 and issue P-2 outside it.
fn store() -> ProjectStore {
    let mut s = ProjectStore::in_memory().unwrap();
    s.apply(
        ROOT,
        "Ana",
        T0,
        op(json!({"op": "settings", "key_prefix": "P"})),
    )
    .unwrap();
    s.apply(
        ROOT,
        "Ana",
        T0,
        op(json!({"op": "create_issue", "title": "Pagar", "kind": "story"})),
    )
    .unwrap();
    s.apply(
        ROOT,
        "Ana",
        T0,
        op(json!({"op": "create_issue", "title": "Outra", "kind": "story"})),
    )
    .unwrap();
    s.apply(ROOT, "Ana", T0, op(json!({"op": "create_sprint", "name": "S1", "start": T0, "end": T0 + 14 * 24 * HOUR_MS})))
        .unwrap();
    s.apply(
        ROOT,
        "Ana",
        T0,
        op(json!({"op": "plan_issue", "key": "P-1", "sprint": "S1"})),
    )
    .unwrap();
    s
}

fn grant(scope: &str, target: &str, actions: &[&str], hours: i64) -> Grant {
    Grant {
        scope: scope.into(),
        target: target.into(),
        actions: actions.iter().map(|a| a.to_string()).collect(),
        hours,
        provider: Some("claude".into()),
        model: None,
        language: Some("pt".into()),
        note: String::new(),
    }
}

fn audit(call: &str) -> AuditEntry {
    AuditEntry {
        at: T0,
        session: "ide".into(),
        event: "approval".into(),
        origin: "ide".into(),
        actor: "Ana".into(),
        mode: "manual".into(),
        tool: Some("codev".into()),
        call: Some(call.into()),
        command: Some("x".into()),
        ..AuditEntry::default()
    }
}

#[test]
fn a_grant_is_bounded_and_unambiguous() {
    assert!(validate_grant(&grant("issue", "P-1", &["review"], 24)).is_ok());
    // never longer than 7 days, never zero
    assert!(validate_grant(&grant("issue", "P-1", &["review"], MAX_HOURS + 1)).is_err());
    assert!(validate_grant(&grant("issue", "P-1", &["review"], 0)).is_err());
    // a known scope, known actions, at least one, no repeats, never both integrate and pr
    assert!(validate_grant(&grant("project", "P-1", &["review"], 1)).is_err());
    assert!(validate_grant(&grant("issue", "P-1", &["merge"], 1)).is_err());
    assert!(validate_grant(&grant("issue", "P-1", &[], 1)).is_err());
    assert!(validate_grant(&grant("issue", "P-1", &["review", "review"], 1)).is_err());
    let e = validate_grant(&grant("issue", "P-1", &["integrate", "pr"], 1)).unwrap_err();
    assert!(e.message.contains("excluem-se"), "{e:?}");
    // the review needs the reviewer's provider
    let mut g = grant("issue", "P-1", &["review"], 1);
    g.provider = Some("  ".into());
    assert!(validate_grant(&g).is_err());
    g.actions = vec!["integrate".into()];
    assert!(validate_grant(&g).is_ok());
    // the actions come back in their order
    let ok = validate_grant(&grant("issue", "P-1", &["pr", "review"], 1)).unwrap();
    assert_eq!(ok.actions, ["review", "pr"]);
}

#[test]
fn a_delegation_covers_its_issue_or_the_issues_of_its_sprint_until_it_expires() {
    let mut s = store();
    let (d, a1) = s
        .delegation_grant(
            ROOT,
            &grant("sprint", "S1", &["review", "integrate"], 2),
            "Ana",
            "ana@x.pt",
            T0,
            audit("autonomy.grant"),
        )
        .unwrap();
    assert_eq!(
        (d.expires_at, d.granted_by.as_str()),
        (T0 + 2 * HOUR_MS, "Ana")
    );
    assert!(a1 > 0);
    // the grant is in the audit log, with what was granted
    let rows = s.audit(ROOT, None).unwrap();
    let row = rows.iter().find(|r| r.id == a1).unwrap();
    assert!(
        row.reason
            .as_deref()
            .unwrap()
            .contains("review, integrate de sprint S1"),
        "{row:?}"
    );
    // P-1 is in S1, P-2 is not
    let p1 = s.delegations_for(ROOT, "P-1").unwrap();
    assert_eq!(p1.len(), 1);
    assert!(s.delegations_for(ROOT, "P-2").unwrap().is_empty());
    assert!(effective(&p1, "review", T0 + HOUR_MS).is_some());
    assert!(effective(&p1, "pr", T0 + HOUR_MS).is_none());
    // expired: nothing is effective any more
    assert!(effective(&p1, "review", T0 + 2 * HOUR_MS).is_none());
    // an unknown issue or sprint is refused
    assert_eq!(
        s.delegation_grant(
            ROOT,
            &grant("issue", "P-9", &["review"], 1),
            "Ana",
            "",
            T0,
            audit("autonomy.grant")
        )
        .unwrap_err()
        .code,
        "not_found"
    );
    assert!(s
        .delegation_grant(
            ROOT,
            &grant("sprint", "S9", &["review"], 1),
            "Ana",
            "",
            T0,
            audit("autonomy.grant")
        )
        .is_err());
    // moving P-1 out of the sprint takes it out of the sprint's delegation
    s.apply(
        ROOT,
        "Ana",
        T0,
        op(json!({"op": "plan_issue", "key": "P-1", "sprint": null})),
    )
    .unwrap();
    assert!(s.delegations_for(ROOT, "P-1").unwrap().is_empty());
}

#[test]
fn revoking_takes_it_back_once_with_its_audit_row() {
    let mut s = store();
    let (d, _) = s
        .delegation_grant(
            ROOT,
            &grant("issue", "P-1", &["pr"], 24),
            "Ana",
            "",
            T0,
            audit("autonomy.grant"),
        )
        .unwrap();
    let (r, a) = s
        .delegation_revoke(
            ROOT,
            d.id,
            "Rui",
            "mudámos de ideias",
            T0 + 10,
            audit("autonomy.revoke"),
        )
        .unwrap();
    assert_eq!(
        (r.revoked_by.as_deref(), r.revoked_at),
        (Some("Rui"), Some(T0 + 10))
    );
    assert!(!r.active(T0 + 11));
    let rows = s.audit(ROOT, Some("P-1")).unwrap();
    assert!(rows.iter().any(|x| x.id == a
        && x.reason.as_deref()
            == Some(&format!("delegação #{} revogada: mudámos de ideias", d.id))));
    // twice: refused; an unknown one: refused
    assert!(s
        .delegation_revoke(ROOT, d.id, "Rui", "", T0 + 20, audit("autonomy.revoke"))
        .is_err());
    assert_eq!(
        s.delegation_revoke(ROOT, 999, "Rui", "", T0, audit("autonomy.revoke"))
            .unwrap_err()
            .code,
        "not_found"
    );
    assert!(effective(&s.delegations_for(ROOT, "P-1").unwrap(), "pr", T0 + 30).is_none());
}

#[test]
fn integrate_and_pr_from_two_delegations_is_ambiguous() {
    let mut s = store();
    s.delegation_grant(
        ROOT,
        &grant("sprint", "S1", &["integrate"], 24),
        "Ana",
        "",
        T0,
        audit("autonomy.grant"),
    )
    .unwrap();
    let ds = s.delegations_for(ROOT, "P-1").unwrap();
    assert!(matches!(mode(&ds, T0 + 1), Mode::Integrate(_)));
    s.delegation_grant(
        ROOT,
        &grant("issue", "P-1", &["pr"], 24),
        "Ana",
        "",
        T0 + 1,
        audit("autonomy.grant"),
    )
    .unwrap();
    let ds = s.delegations_for(ROOT, "P-1").unwrap();
    assert_eq!(mode(&ds, T0 + 2), Mode::Ambiguous);
    assert_eq!(mode(&[], T0), Mode::Manual);
}

#[test]
fn the_kill_switch_is_one_row_for_the_app_with_audit_rows() {
    let mut s = store();
    assert!(!s.autonomy_switch().unwrap().paused);
    let (sw, a) = s
        .set_autonomy_paused(ROOT, true, "Ana", "", T0, audit("autonomy.pause"))
        .unwrap();
    assert!(sw.paused && a > 0);
    let now = s.autonomy_switch().unwrap();
    assert_eq!((now.paused, now.by.as_deref()), (true, Some("Ana")));
    // the same switch from another folder
    s.set_autonomy_paused(
        "/other",
        false,
        "Rui",
        "ok",
        T0 + 1,
        audit("autonomy.resume"),
    )
    .unwrap();
    assert!(!s.autonomy_switch().unwrap().paused);
    assert_eq!(
        s.audit("/other", None).unwrap()[0].reason.as_deref(),
        Some("ok")
    );
}

#[test]
fn events_are_kept_and_only_actions_count_for_the_rate() {
    let mut s = store();
    let ev = |action: &str, outcome: &str, code: &str, at: i64| Event {
        id: 0,
        key: "P-1".into(),
        delegation: Some(1),
        action: action.into(),
        trigger: "session_finished".into(),
        outcome: outcome.into(),
        code: code.into(),
        detail: String::new(),
        review: None,
        audit: vec![3, 4],
        at,
    };
    // one review (its start and its end count once), a stop, a failed request, an integration
    s.autonomy_event(ROOT, &ev("review", "started", "requested", T0)).unwrap();
    s.autonomy_event(ROOT, &ev("review", "ok", "reviewed", T0 + 1)).unwrap();
    s.autonomy_event(ROOT, &ev("review", "stopped", "paused", T0 + 2)).unwrap();
    s.autonomy_event(ROOT, &ev("review", "failed", "request_failed", T0 + 3)).unwrap();
    s.autonomy_event(ROOT, &ev("integrate", "stopped", "stale", T0 + 4)).unwrap();
    s.autonomy_event(ROOT, &ev("integrate", "ok", "integrated", T0 + 5)).unwrap();
    s.autonomy_event(ROOT, &ev("pr", "failed", "pr_failed", T0 + 6)).unwrap();
    assert_eq!(s.autonomy_actions_since(ROOT, T0).unwrap(), 4);
    assert_eq!(s.autonomy_actions_since(ROOT, T0 + 4).unwrap(), 2);
    let all = s.autonomy_events(ROOT, Some("P-1"), 10).unwrap();
    assert_eq!(all.len(), 7);
    assert_eq!((all[0].outcome.as_str(), all[0].audit.clone()), ("failed", vec![3, 4]));
    assert_eq!(s.last_autonomy_event(ROOT, "P-1", "review").unwrap().unwrap().code, "request_failed");
    assert!(s.last_autonomy_event(ROOT, "P-2", "pr").unwrap().is_none());
}

#[test]
fn remote_branches_and_pull_requests_are_remembered() {
    let mut s = store();
    assert!(!s
        .remote_branch_is_ours(ROOT, "/r.git", "feature/p-1")
        .unwrap());
    s.remote_branch_created(ROOT, "/r.git", "feature/p-1", "Ana", T0)
        .unwrap();
    assert!(s
        .remote_branch_is_ours(ROOT, "/r.git", "feature/p-1")
        .unwrap());
    assert!(!s
        .remote_branch_is_ours(ROOT, "/other.git", "feature/p-1")
        .unwrap());
    let pr = PullRequest {
        id: 0,
        key: "P-1".into(),
        review: 3,
        remote: "origin".into(),
        url: "/r.git".into(),
        branch: "feature/p-1".into(),
        head: "h".into(),
        base: "b".into(),
        target: "main".into(),
        number: 42,
        pr_url: "https://github.com/o/r/pull/42".into(),
        actor: "Ana".into(),
        delegation: None,
        at: T0,
    };
    s.pr_record(ROOT, &pr).unwrap();
    let got = s.pr_latest(ROOT, "P-1").unwrap().unwrap();
    assert_eq!(
        (got.number, got.pr_url.as_str()),
        (42, "https://github.com/o/r/pull/42")
    );
    let d = s.detail(ROOT, "P-1").unwrap();
    assert!(d
        .activity
        .iter()
        .any(|a| a.kind == "pull_request" && a.note.contains("#42")));
}

fn review() -> Review {
    Review {
        id: 7,
        key: "P-1".into(),
        tips: Tips {
            target: "main".into(),
            base: "b1b1".into(),
            branch: "feature/p-1".into(),
            head: "h1h1".into(),
        },
        candidate: "c1c1".into(),
        tree: "t1t1".into(),
        criteria: vec!["Dado X | Y".into()],
        required: vec![Check {
            name: "tests".into(),
            command: "cargo test".into(),
        }],
        checks: vec![CheckRun {
            name: "tests".into(),
            command: "cargo test".into(),
            exit: Some(0),
            passed: true,
            tail: "ok".into(),
            ms: 1500,
            timed_out: false,
        }],
        arch_rules: true,
        arch: vec![],
        conflicts: vec![],
        scan: None,
        verdict: Some(Verdict {
            overall: "met".into(),
            summary: "Works.".into(),
            criteria: vec![CriterionVerdict {
                index: 1,
                text: "Dado X | Y".into(),
                status: "met".into(),
                evidence: vec![
                    Evidence {
                        kind: "file".into(),
                        reference: "src/pay.rs".into(),
                        lines: Some("1-3".into()),
                        detail: None,
                    },
                    Evidence {
                        kind: "test".into(),
                        reference: "pays".into(),
                        lines: None,
                        detail: None,
                    },
                ],
                note: String::new(),
            }],
        }),
        reviewer: Some("fake-model".into()),
        tokens_in: 1,
        tokens_out: 1,
        state: "reviewed".into(),
        error: None,
        actor: "Ana".into(),
        created: T0,
        updated: T0,
    }
}

#[test]
fn the_pull_request_body_carries_the_gates_evidence() {
    let r = review();
    let f = FunctionalApproval {
        by: "Rita".into(),
        at: T0,
        note: String::new(),
    };
    let d = Delegation {
        id: 5,
        scope: "issue".into(),
        target: "P-1".into(),
        actions: vec!["pr".into()],
        provider: None,
        model: None,
        language: None,
        note: String::new(),
        granted_by: "Ana".into(),
        granted_email: String::new(),
        granted_at: T0,
        expires_at: T0 + HOUR_MS,
        revoked_by: None,
        revoked_at: None,
        revoke_reason: None,
    };
    let b = pr_body(&BodyInput {
        key: "P-1",
        title: "Pagar",
        review: &r,
        functional: Some(&f),
        delegation: Some(&d),
        opened_by: "Ana",
    });
    // the checks with the candidate's commit, each criterion with its verdict and evidence
    assert!(b.contains("passed on `c1c1`"), "{b}");
    assert!(b.contains("| tests | `cargo test` | 0 | 1.5 s |"), "{b}");
    assert!(
        b.contains("| 1 | Dado X \\| Y | met | `src/pay.rs:1-3`; test `pays` |"),
        "{b}"
    );
    // who approved functionally and when (UTC)
    assert!(
        b.contains("Recorded by Rita on 2027-01-15 08:00 UTC"),
        "{b}"
    );
    // how it was opened, and that dxtutor does not merge it
    assert!(b.contains("delegation #5 granted by Ana"), "{b}");
    assert!(b.contains("does not merge pull requests"), "{b}");
    let human = pr_body(&BodyInput {
        key: "P-1",
        title: "Pagar",
        review: &r,
        functional: None,
        delegation: None,
        opened_by: "Ana",
    });
    assert!(
        human.contains("Opened by Ana with dxtutor's approval dialog")
            && human.contains("Not recorded")
    );
}
