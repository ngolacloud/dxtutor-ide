//! Real repositories (and a local bare repository as the remote), a fake model as the reviewer and a
//! fake `gh` — never the real GitHub. No delegation is exactly phase 4; with one, the backend requests
//! the review and integrates (or opens the pull request) only through the gate, and stops — once, with
//! an event and the audit rows — at every closed door: paused, expired, revoked, the grantor's role,
//! the rate, a failed check, a criterion not met, a stale tip, the secret scan, `gh` signed out, a
//! remote branch it did not create.

use super::*;
use crate::codev_review::tests::{all_met, g, reviewer, say, scripted, verdict_call, World};
use std::sync::atomic::{AtomicBool, Ordering};
use tutor_eval::gitwork::codev as wt;

/* ───── the runtime of a test ───── */

struct Rig {
    rt: Runtime,
    told: Arc<Mutex<Vec<Value>>>,
    /// the fake gh's folder (its log of arguments and the last body)
    gh_dir: tempfile::TempDir,
    asked_reviewer: Arc<AtomicBool>,
}

/// A fake `gh`: logs its arguments; `--version` and `auth status` succeed unless `signed-out`
/// exists in its folder; `pr create` keeps the body and prints a pull request URL; `pr view` says it
/// is open.
fn fake_gh(dir: &Path) -> String {
    let p = dir.join("gh");
    std::fs::write(
        &p,
        format!(
            r#"#!/bin/sh
echo "$@" >> "{d}/args"
case "$1 $2" in
  "--version ") echo 'gh version 2.0.0 (fake)';;
  "auth status") [ -e "{d}/signed-out" ] && exit 1; exit 0;;
  "pr create") cat > "{d}/body"; echo 'https://github.com/o/r/pull/42';;
  "pr view") echo '{{"number":42,"url":"https://github.com/o/r/pull/42","state":"OPEN","isDraft":false,"reviewDecision":"REVIEW_REQUIRED","statusCheckRollup":[],"headRefName":"x","headRefOid":"y","baseRefName":"main","mergedAt":""}}';;
  *) exit 3;;
esac
"#,
            d = dir.display()
        ),
    )
    .unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p.display().to_string()
}

/// `replies`: the reviewer's script (`None`: the reviewer must never be asked).
fn rig(w: &World, replies: Option<Vec<tutor_agent::Response>>) -> Rig {
    let told: Arc<Mutex<Vec<Value>>> = Arc::default();
    let t = told.clone();
    let gh_dir = tempfile::tempdir().unwrap();
    let asked = Arc::new(AtomicBool::new(false));
    let a = asked.clone();
    let p = replies.map(scripted);
    let reviewer_for: ReviewerFor = Arc::new(move |_provider, _model| {
        a.store(true, Ordering::SeqCst);
        match &p {
            Some(p) => reviewer(p.clone()),
            None => Box::new(|| Err("the reviewer must not run".into())),
        }
    });
    Rig {
        rt: Runtime {
            db: w.db.clone(),
            ibase: w.ibase.clone(),
            wbase: w.wbase.clone(),
            gh: fake_gh(gh_dir.path()),
            env: Arc::new(|| None),
            reviewer: reviewer_for,
            review_emit: Arc::new(|_| {}),
            notify: Arc::new(move |v| t.lock().unwrap().push(v)),
        },
        told,
        gh_dir,
        asked_reviewer: asked,
    }
}

fn ana() -> Identity {
    Identity {
        name: "Ana".into(),
        email: "ana@example.com".into(),
    }
}

fn delegate(w: &World, actions: &[&str]) -> Delegation {
    grant(
        &w.db,
        &w.root,
        &Grant {
            scope: "issue".into(),
            target: w.key.clone(),
            actions: actions.iter().map(|a| a.to_string()).collect(),
            hours: 24,
            provider: Some("fake".into()),
            model: None,
            language: Some("en".into()),
            note: String::new(),
        },
        &ana(),
    )
    .unwrap()
}

fn events(w: &World) -> Vec<(String, String, String)> {
    let st = ProjectStore::open(&w.db).unwrap();
    let mut v: Vec<(String, String, String)> = st
        .autonomy_events(&w.root, Some(&w.key), 100)
        .unwrap()
        .into_iter()
        .map(|e| (e.action, e.outcome, e.code))
        .collect();
    v.reverse();
    v
}

fn ev(a: &str, o: &str, c: &str) -> (String, String, String) {
    (a.into(), o.into(), c.into())
}

fn head(w: &World) -> String {
    g(w.p(), &["rev-parse", "HEAD"])
}

/// Every audit row the autonomy wrote says so: mode `autonomous`, decided by the delegation.
fn autonomous_rows(w: &World, d: &Delegation) -> Vec<(String, String)> {
    let st = ProjectStore::open(&w.db).unwrap();
    st.audit(&w.root, None)
        .unwrap()
        .into_iter()
        .filter(|a| a.mode == "autonomous")
        .inspect(|a| {
            assert_eq!(
                a.decided_by.as_deref(),
                Some(format!("delegation:{}:Ana", d.id).as_str()),
                "{a:?}"
            );
            assert_eq!(a.actor, rv::AUTONOMY_ACTOR);
            assert_eq!(a.issue_key.as_deref(), Some(w.key.as_str()));
        })
        .map(|a| (a.call.unwrap_or_default(), a.outcome.unwrap_or_default()))
        .collect()
}

/* ───── no delegation: phase 4 ───── */

#[test]
fn without_a_delegation_nothing_happens_and_nothing_is_recorded() {
    let w = World::new();
    let r = rig(&w, None);
    let before = head(&w);
    assert!(review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).is_none());
    w.approve();
    assert!(integrate_now(&r.rt, &w.root, &w.key, Trigger::FunctionalApproved).is_none());
    assert!(w.state().review.is_none(), "no review was requested");
    assert!(!r.asked_reviewer.load(Ordering::SeqCst));
    assert!(events(&w).is_empty() && r.told.lock().unwrap().is_empty());
    assert_eq!(head(&w), before);
}

/* ───── the whole loop ───── */

#[test]
fn a_delegated_issue_is_reviewed_and_integrated_through_the_gate() {
    let w = World::new();
    w.approve(); // the functional approval stays the human's
    let d = delegate(&w, &["review", "integrate"]);
    let r = rig(&w, Some(vec![verdict_call("v1", all_met()), say("done")]));
    let step = review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).unwrap();
    assert_eq!(
        (step.outcome.as_str(), step.code.as_str()),
        ("ok", "reviewed")
    );
    assert_eq!(
        events(&w),
        vec![
            ev("review", "started", "requested"),
            ev("review", "ok", "reviewed"),
            ev("integrate", "ok", "integrated"),
        ]
    );
    // exactly the reviewed candidate landed on main, and the issue walked by the move rules
    let s = w.state();
    assert_eq!(s.review.as_ref().unwrap().state, "integrated");
    assert_eq!(head(&w), s.review.unwrap().candidate);
    // ... by the move rules, never overridden: the criteria are not ticked, so it holds in Accept
    let activity = ProjectStore::open(&w.db)
        .unwrap()
        .detail(&w.root, &w.key)
        .unwrap()
        .activity;
    assert_eq!(w.issue_state(), "accept");
    assert!(activity
        .iter()
        .any(|a| a.kind == "held" && a.note.contains("Definition of Done")));
    assert!(!activity.iter().any(|a| a.kind == "override"));
    // the audit log: the request and the integration, before and with the result, as the delegation
    let rows = autonomous_rows(&w, &d);
    assert_eq!(
        rows,
        vec![
            ("review.request".into(), "sent".into()),
            ("review.request".into(), "ok".into()),
            ("review.integrate".into(), "sent".into()),
            ("review.integrate".into(), "ok".into()),
            ("worktree.remove".into(), "sent".into()),
            ("worktree.remove".into(), "ok".into()),
        ]
    );
    // each step links its audit rows, and the interface was told (the integration included)
    let st = ProjectStore::open(&w.db).unwrap();
    let all = st.autonomy_events(&w.root, Some(&w.key), 10).unwrap();
    assert!(all.iter().all(|e| e.delegation == Some(d.id)));
    assert_eq!(all[0].audit.len(), 4, "{:?}", all[0]);
    let told = r.told.lock().unwrap();
    assert!(told.iter().any(|v| v["integrated"]["commit"].is_string()));
}

#[test]
fn without_the_functional_approval_it_waits_and_the_approval_lets_it_integrate() {
    let w = World::new();
    delegate(&w, &["review", "integrate"]);
    let r = rig(&w, Some(vec![verdict_call("v1", all_met()), say("done")]));
    let before = head(&w);
    review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished);
    assert_eq!(
        events(&w).last().unwrap(),
        &ev("integrate", "stopped", "awaiting_functional")
    );
    assert_eq!(head(&w), before, "autonomy never approves functionally");
    w.approve();
    let s = integrate_now(&r.rt, &w.root, &w.key, Trigger::FunctionalApproved).unwrap();
    assert_eq!(s.code, "integrated");
    assert_ne!(head(&w), before);
}

/* ───── every closed door stops it, once ───── */

#[test]
fn paused_it_never_acts() {
    let w = World::new();
    w.approve();
    delegate(&w, &["review", "integrate"]);
    let r = rig(&w, None);
    set_paused(&w.db, &w.root, true, "incident", &ana()).unwrap();
    let s = review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).unwrap();
    assert_eq!((s.outcome.as_str(), s.code.as_str()), ("stopped", "paused"));
    assert!(w.state().review.is_none());
    assert!(!r.asked_reviewer.load(Ordering::SeqCst));
    // the pause and the resume are in the audit log
    let calls: Vec<String> = ProjectStore::open(&w.db)
        .unwrap()
        .audit(&w.root, None)
        .unwrap()
        .into_iter()
        .filter_map(|a| a.call)
        .collect();
    assert!(calls.contains(&"autonomy.pause".to_string()));
    set_paused(&w.db, &w.root, false, "", &ana()).unwrap();
    assert!(overview(&w.db, &w.root, None).unwrap().switch.paused == false);
}

#[test]
fn an_expired_or_revoked_delegation_is_no_delegation() {
    let w = World::new();
    let d = delegate(&w, &["review"]);
    let r = rig(&w, None);
    revoke(&w.db, &w.root, d.id, "done with it", &ana()).unwrap();
    assert!(review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).is_none());
    // expired: written as if it had been granted long ago
    let d2 = delegate(&w, &["review"]);
    ProjectStore::open(&w.db)
        .unwrap()
        .conn()
        .execute(
            "UPDATE autonomy_delegations SET expires_at = 1 WHERE id = ?1",
            [d2.id],
        )
        .unwrap();
    assert!(review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).is_none());
    assert!(w.state().review.is_none());
    assert!(events(&w).is_empty());
}

#[test]
fn the_grantor_must_still_have_the_role_when_it_acts() {
    let w = World::new();
    std::fs::create_dir_all(w.p().join(".dxtutor")).unwrap();
    std::fs::write(
        w.p().join(".dxtutor/team.json"),
        r#"{"people": [{"name": "Ana", "email": "ana@example.com", "roles": ["tech_lead"]}]}"#,
    )
    .unwrap();
    let d = delegate(&w, &["review"]);
    // Ana is no longer a Tech Lead (and she is not the issue's assignee)
    std::fs::write(
        w.p().join(".dxtutor/team.json"),
        r#"{"people": [{"name": "Ana", "email": "ana@example.com", "roles": ["developer"]}]}"#,
    )
    .unwrap();
    let r = rig(&w, None);
    let s = review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).unwrap();
    assert_eq!(
        (s.code.as_str(), s.delegation),
        ("grantor_role", Some(d.id))
    );
    assert!(w.state().review.is_none());
    // a developer cannot grant one either
    let e = grant(
        &w.db,
        &w.root,
        &Grant {
            scope: "issue".into(),
            target: w.key.clone(),
            actions: vec!["integrate".into()],
            hours: 1,
            provider: None,
            model: None,
            language: None,
            note: String::new(),
        },
        &ana(),
    )
    .unwrap_err();
    assert!(e.contains("delegar a autonomia"), "{e}");
}

#[test]
fn the_rate_limit_stops_it() {
    let w = World::new();
    let d = delegate(&w, &["review"]);
    {
        let mut st = ProjectStore::open(&w.db).unwrap();
        for _ in 0..au::MAX_ACTIONS_PER_HOUR {
            st.autonomy_event(
                &w.root,
                &Event {
                    id: 0,
                    key: "OTHER-1".into(),
                    delegation: Some(d.id),
                    action: "integrate".into(),
                    trigger: "review_done".into(),
                    outcome: "ok".into(),
                    code: "integrated".into(),
                    detail: String::new(),
                    review: None,
                    audit: vec![],
                    at: now_ms(),
                },
            )
            .unwrap();
        }
    }
    let r = rig(&w, None);
    let s = review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).unwrap();
    assert_eq!(s.code, "rate_limited");
    assert!(w.state().review.is_none());
}

#[test]
fn a_criterion_not_met_stops_before_the_integration() {
    let w = World::new();
    w.approve();
    delegate(&w, &["review", "integrate"]);
    let mut v = all_met();
    v["overall"] = json!("not_met");
    v["criteria"][1] = json!({"index": 2, "status": "not_met", "evidence": [], "note": "no test"});
    let r = rig(&w, Some(vec![verdict_call("v1", v), say("done")]));
    let before = head(&w);
    review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished);
    assert_eq!(
        events(&w),
        vec![
            ev("review", "started", "requested"),
            ev("review", "stopped", "not_met")
        ]
    );
    // even asked directly, the gate refuses
    let s = integrate_now(&r.rt, &w.root, &w.key, Trigger::FunctionalApproved).unwrap();
    assert_eq!(s.code, "not_met");
    assert_eq!(head(&w), before);
}

#[test]
fn failing_checks_stop_it_and_the_reviewer_never_runs() {
    let w = World::new();
    delegate(&w, &["review", "integrate"]);
    let mut st = ProjectStore::open(&w.db).unwrap();
    st.apply(
        &w.root,
        "Ana",
        5,
        serde_json::from_value(
            json!({"op": "settings", "checks": [{"name": "tests", "command": "exit 3"}]}),
        )
        .unwrap(),
    )
    .unwrap();
    let r = rig(&w, None);
    review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished);
    assert_eq!(
        events(&w).last().unwrap(),
        &ev("review", "stopped", "checks")
    );
    // the same tips are not reviewed again by the autonomy (no loop)
    let s = review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).unwrap();
    assert_eq!(s.code, "already_reviewed");
    assert_eq!(
        events(&w).iter().filter(|e| e.1 == "started").count(),
        1,
        "{:?}",
        events(&w)
    );
}

#[test]
fn a_stale_tip_stops_the_integration() {
    let w = World::new();
    w.approve();
    delegate(&w, &["integrate"]);
    // a human's review, all met; then main moves
    w.review(reviewer(scripted(vec![
        verdict_call("v1", all_met()),
        say("done"),
    ])));
    w.main_moves();
    let before = head(&w);
    let s = integrate_now(&rig(&w, None).rt, &w.root, &w.key, Trigger::ReviewDone).unwrap();
    assert_eq!((s.outcome.as_str(), s.code.as_str()), ("stopped", "stale"));
    assert_eq!(head(&w), before);
    // the issue branch moving is stale too
    w.branch_moves();
    let s = integrate_now(&rig(&w, None).rt, &w.root, &w.key, Trigger::ReviewDone).unwrap();
    assert_eq!(s.code, "stale");
}

#[test]
fn a_secret_scan_finding_stops_it_and_never_takes_a_humans_override() {
    let w = World::new();
    // the issue branch brings a secret (committed past the guard, as a human could)
    let wt = wt::find(w.p(), &w.wbase, &w.key).unwrap().unwrap();
    std::fs::write(
        Path::new(&wt.dir).join("src/db.rs"),
        "const URL: &str = \"postgres://u:p@h/app\";\n",
    )
    .unwrap();
    g(Path::new(&wt.dir), &["add", "src/db.rs"]);
    g(Path::new(&wt.dir), &["commit", "-q", "-m", "db"]);
    w.approve();
    let d = delegate(&w, &["integrate"]);
    w.review(reviewer(scripted(vec![
        verdict_call("v1", all_met()),
        say("done"),
    ])));
    // a human allowed their own next commit: the autonomy must not use it
    tutor_protect::scan::allow_once(w.p(), "a human's commit").unwrap();
    let before = head(&w);
    let s = integrate_now(&rig(&w, None).rt, &w.root, &w.key, Trigger::ReviewDone).unwrap();
    assert_eq!(
        (s.outcome.as_str(), s.code.as_str()),
        ("stopped", "secret_scan")
    );
    assert!(!s.detail.contains("u:p@"), "{}", s.detail);
    assert_eq!(head(&w), before);
    assert_eq!(
        autonomous_rows(&w, &d),
        vec![
            ("review.integrate".into(), "sent".into()),
            ("review.integrate".into(), "failed".into())
        ]
    );
    // the human's override is still there for the human
    assert!(tutor_protect::scan::guard_commit(
        w.p(),
        &tutor_protect::scan::Scope::Between(&before, &before)
    )
    .is_ok());
}

#[test]
fn uncommitted_work_stops_it_and_the_humans_commit_lets_it_go() {
    let w = World::new();
    delegate(&w, &["review"]);
    let wt = wt::find(w.p(), &w.wbase, &w.key).unwrap().unwrap();
    std::fs::write(Path::new(&wt.dir).join("src/more.rs"), "\n").unwrap();
    let r = rig(&w, None);
    let s = review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished).unwrap();
    assert_eq!(s.code, "uncommitted");
    assert!(waiting_for_commit(&w.db, &w.root, &w.key));
    wt::commit(w.p(), &w.wbase, &w.key, "more").unwrap();
    // the commit trigger asks again (the reviewer is not asked here: the checks of this rig fail)
    let mut st = ProjectStore::open(&w.db).unwrap();
    st.apply(
        &w.root,
        "Ana",
        5,
        serde_json::from_value(
            json!({"op": "settings", "checks": [{"name": "tests", "command": "exit 1"}]}),
        )
        .unwrap(),
    )
    .unwrap();
    let s = review_now(&r.rt, &w.root, &w.key, Trigger::Committed).unwrap();
    assert_eq!(s.code, "checks");
    let st = ProjectStore::open(&w.db).unwrap();
    let started = st.autonomy_events(&w.root, Some(&w.key), 10).unwrap();
    assert!(started
        .iter()
        .any(|e| e.code == "requested" && e.trigger == "committed"));
    assert!(!waiting_for_commit(&w.db, &w.root, &w.key));
}

#[test]
fn an_issue_out_of_review_is_not_reviewed() {
    let w = World::new();
    delegate(&w, &["review"]);
    ProjectStore::open(&w.db)
        .unwrap()
        .conn()
        .execute(
            "UPDATE issues SET state = 'progress' WHERE root = ?1 AND key = ?2",
            [w.root.as_str(), w.key.as_str()],
        )
        .unwrap();
    let s = review_now(&rig(&w, None).rt, &w.root, &w.key, Trigger::SessionFinished).unwrap();
    assert_eq!(s.code, "not_in_review");
}

#[test]
fn integrate_and_pr_both_delegated_does_neither() {
    let w = World::new();
    w.approve();
    delegate(&w, &["integrate"]);
    grant(
        &w.db,
        &w.root,
        &Grant {
            scope: "issue".into(),
            target: w.key.clone(),
            actions: vec!["pr".into()],
            hours: 1,
            provider: None,
            model: None,
            language: None,
            note: String::new(),
        },
        &ana(),
    )
    .unwrap();
    w.review(reviewer(scripted(vec![
        verdict_call("v1", all_met()),
        say("done"),
    ])));
    let before = head(&w);
    let s = integrate_now(&rig(&w, None).rt, &w.root, &w.key, Trigger::ReviewDone).unwrap();
    assert_eq!(s.code, "ambiguous");
    assert_eq!(head(&w), before);
}

/* ───── pull requests ───── */

/// A local bare repository as `origin`, with `main` pushed.
fn with_remote(w: &World) -> PathBuf {
    let remote = w._data.path().join("remote.git");
    g(
        w._data.path(),
        &["init", "-q", "--bare", "-b", "main", "remote.git"],
    );
    g(
        w.p(),
        &["remote", "add", "origin", &remote.display().to_string()],
    );
    g(w.p(), &["push", "-q", "origin", "main"]);
    remote
}

fn remote_ref(remote: &Path, branch: &str) -> String {
    g(
        remote,
        &[
            "for-each-ref",
            "--format=%(objectname)",
            &format!("refs/heads/{branch}"),
        ],
    )
}

#[test]
fn a_delegated_pr_pushes_the_issue_branch_and_carries_the_gates_evidence() {
    let w = World::new();
    let remote = with_remote(&w);
    let main_before = remote_ref(&remote, "main");
    w.approve();
    let d = delegate(&w, &["review", "pr"]);
    let r = rig(&w, Some(vec![verdict_call("v1", all_met()), say("done")]));
    let local_before = head(&w);
    review_now(&r.rt, &w.root, &w.key, Trigger::SessionFinished);
    assert_eq!(events(&w).last().unwrap(), &ev("pr", "ok", "pr_opened"));
    let review = w.state().review.unwrap();
    // the remote has the issue branch at exactly the reviewed tip; main moved nowhere, here or there
    assert_eq!(remote_ref(&remote, &w.branch), review.tips.head);
    assert_eq!(remote_ref(&remote, "main"), main_before);
    assert_eq!(
        head(&w),
        local_before,
        "a pull request is not a local merge"
    );
    // gh: a pull request into main from the issue branch, never a login, never a merge
    let args = std::fs::read_to_string(r.gh_dir.path().join("args")).unwrap();
    assert!(
        args.contains(&format!("pr create --base main --head {}", w.branch)),
        "{args}"
    );
    assert!(!args.contains("login") && !args.contains("merge"), "{args}");
    // the body: the checks with the candidate's commit, the verdict per criterion, the approval
    let body = std::fs::read_to_string(r.gh_dir.path().join("body")).unwrap();
    assert!(
        body.contains(&format!("passed on `{}`", review.candidate)),
        "{body}"
    );
    assert!(
        body.contains("| tests | `test -f src/pay.rs` | 0 |"),
        "{body}"
    );
    assert!(
        body.contains(&format!("| 1 | {} | met |", CRITERIA_1)),
        "{body}"
    );
    assert!(body.contains("Recorded by Rita on"), "{body}");
    assert!(
        body.contains(&format!("delegation #{} granted by Ana", d.id)),
        "{body}"
    );
    // recorded, audited as the delegation, and not opened twice for the same review
    let pr = ProjectStore::open(&w.db)
        .unwrap()
        .pr_latest(&w.root, &w.key)
        .unwrap()
        .unwrap();
    assert_eq!((pr.number, pr.head.clone()), (42, review.tips.head.clone()));
    let rows = autonomous_rows(&w, &d);
    assert!(rows.contains(&("review.pr".into(), "sent".into())));
    assert!(rows.contains(&("review.pr".into(), "ok".into())));
    let again = integrate_now(&r.rt, &w.root, &w.key, Trigger::FunctionalApproved).unwrap();
    assert_eq!(again.code, "pr_blocked");
    assert!(again.detail.contains("already open"), "{}", again.detail);
    // the panel reads the pull request back, read-only
    let ps = crate::codev_pr::state(&w.db, &w.root, &w.key, &r.rt.gh).unwrap();
    assert_eq!(ps.live.unwrap().state, "OPEN");
}

const CRITERIA_1: &str = crate::codev_review::tests::CRITERIA[0];

#[test]
fn gh_signed_out_stops_it_before_anything_is_pushed() {
    let w = World::new();
    let remote = with_remote(&w);
    w.approve();
    delegate(&w, &["pr"]);
    w.review(reviewer(scripted(vec![
        verdict_call("v1", all_met()),
        say("done"),
    ])));
    let r = rig(&w, None);
    std::fs::write(r.gh_dir.path().join("signed-out"), "").unwrap();
    let s = integrate_now(&r.rt, &w.root, &w.key, Trigger::ReviewDone).unwrap();
    assert_eq!(s.code, "gh_signed_out");
    assert!(s.detail.contains("gh auth login"), "{}", s.detail);
    assert_eq!(remote_ref(&remote, &w.branch), "", "nothing was pushed");
    let args = std::fs::read_to_string(r.gh_dir.path().join("args")).unwrap();
    assert!(
        !args.contains("pr create") && !args.contains("login"),
        "{args}"
    );
}

#[test]
fn a_remote_branch_it_did_not_create_is_never_pushed() {
    let w = World::new();
    let remote = with_remote(&w);
    // someone pushed the issue branch's name first (main's commit)
    g(
        w.p(),
        &[
            "push",
            "-q",
            "origin",
            &format!("main:refs/heads/{}", w.branch),
        ],
    );
    let theirs = remote_ref(&remote, &w.branch);
    w.approve();
    delegate(&w, &["pr"]);
    w.review(reviewer(scripted(vec![
        verdict_call("v1", all_met()),
        say("done"),
    ])));
    let r = rig(&w, None);
    let s = integrate_now(&r.rt, &w.root, &w.key, Trigger::ReviewDone).unwrap();
    assert_eq!(s.code, "pr_blocked");
    assert!(s.detail.contains("did not create it"), "{}", s.detail);
    assert_eq!(remote_ref(&remote, &w.branch), theirs);
}

#[test]
fn a_human_opens_the_pull_request_with_the_approved_text_only() {
    let w = World::new();
    let remote = with_remote(&w);
    w.approve();
    w.review(reviewer(scripted(vec![
        verdict_call("v1", all_met()),
        say("done"),
    ])));
    let r = rig(&w, None);
    let ps = crate::codev_pr::state(&w.db, &w.root, &w.key, &r.rt.gh).unwrap();
    let plan = ps
        .plan
        .clone()
        .expect("the gate holds: a pull request can be opened");
    assert!(
        plan.contains(" push --porcelain -- origin ") && !plan.contains("--force"),
        "{plan}"
    );
    // another text: refused, nothing pushed
    let e = crate::codev_pr::open_as(
        &w.db,
        &w.root,
        &w.key,
        "git push --force",
        By::human(Some(1)),
        &r.rt.gh,
    )
    .unwrap_err();
    assert!(e.contains("changed since the approval"), "{e}");
    assert_eq!(remote_ref(&remote, &w.branch), "");
    let o = crate::codev_pr::open_as(&w.db, &w.root, &w.key, &plan, By::human(Some(1)), &r.rt.gh)
        .unwrap();
    assert_eq!((o.number, o.created_branch), (42, true));
    let body = std::fs::read_to_string(r.gh_dir.path().join("body")).unwrap();
    assert!(body.contains("with dxtutor's approval dialog"), "{body}");
    // the human's rows: decided by the human
    let st = ProjectStore::open(&w.db).unwrap();
    let rows: Vec<_> = st
        .audit(&w.root, None)
        .unwrap()
        .into_iter()
        .filter(|a| a.call.as_deref() == Some("review.pr"))
        .collect();
    assert_eq!(rows.len(), 2);
    assert!(rows
        .iter()
        .all(|a| a.decided_by.as_deref() == Some("human:Ana")));
    // nothing autonomous happened
    assert!(events(&w).is_empty());
}
