//! Real repositories in temporary folders and a fake model: every branch of the gate, from the
//! request to the integration of exactly the reviewed tree.

use super::*;
use std::collections::VecDeque;
use std::process::Command;
use tutor_agent::{ProviderError, Request, Response, StopReason, StreamEvent, Usage};

pub(crate) fn g(d: &Path, a: &[&str]) -> String {
    let o = Command::new("git")
        .arg("-C")
        .arg(d)
        .args(a)
        .output()
        .unwrap();
    assert!(
        o.status.success(),
        "git {a:?}: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

/* ───── a model that follows a script ───── */

pub(crate) struct Scripted {
    pub(crate) replies: Mutex<VecDeque<Response>>,
    pub(crate) seen: Mutex<Vec<Request>>,
}

impl Provider for Scripted {
    fn stream(
        &self,
        req: &Request,
        _: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<Response, ProviderError> {
        self.seen.lock().unwrap().push(req.clone());
        Ok(self
            .replies
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| say("…")))
    }
}

pub(crate) fn reply(stop: StopReason, content: Vec<Value>) -> Response {
    Response {
        id: "m".into(),
        model: "fake-model".into(),
        content,
        stop_reason: stop,
        stop_details: None,
        usage: Usage {
            input_tokens: 100,
            output_tokens: 10,
            ..Default::default()
        },
        invalid_tool_inputs: vec![],
    }
}

pub(crate) fn say(text: &str) -> Response {
    reply(
        StopReason::EndTurn,
        vec![json!({"type": "text", "text": text})],
    )
}

pub(crate) fn verdict_call(id: &str, input: Value) -> Response {
    reply(
        StopReason::ToolUse,
        vec![json!({"type": "tool_use", "id": id, "name": "review_verdict", "input": input})],
    )
}

pub(crate) fn tool_call(id: &str, name: &str, input: Value) -> Response {
    reply(
        StopReason::ToolUse,
        vec![json!({"type": "tool_use", "id": id, "name": name, "input": input})],
    )
}

pub(crate) fn scripted(replies: Vec<Response>) -> Arc<Scripted> {
    Arc::new(Scripted {
        replies: Mutex::new(replies.into()),
        seen: Mutex::new(vec![]),
    })
}

pub(crate) fn reviewer(p: Arc<Scripted>) -> MakeReviewer {
    Box::new(move || Ok((p as Arc<dyn Provider>, "fake-model".to_string())))
}

/// A reviewer that must never be asked (the checks failed, or there was a conflict).
pub(crate) fn never() -> MakeReviewer {
    Box::new(|| panic!("the reviewer must not run"))
}

pub(crate) fn all_met() -> Value {
    json!({
        "overall": "met",
        "summary": "Paying works and is tested.",
        "criteria": [
            {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs", "lines": "1"}, {"kind": "output", "ref": "tests", "detail": "ok"}]},
            {"index": 2, "status": "met", "evidence": [{"kind": "test", "ref": "pay::tests::pays"}]}
        ]
    })
}

/* ───── the world: a repository, a project, an issue on a branch ───── */

pub(crate) const CRITERIA: [&str; 2] = [
    "Dado um carrinho, quando pago, então fica pago",
    "Dado um pagamento, quando corre o teste, então passa",
];

pub(crate) struct World {
    pub(crate) repo: tempfile::TempDir,
    pub(crate) _data: tempfile::TempDir,
    pub(crate) db: PathBuf,
    pub(crate) ibase: PathBuf,
    pub(crate) wbase: PathBuf,
    pub(crate) root: String,
    pub(crate) key: String,
    pub(crate) branch: String,
}

impl World {
    /// `main` with `src/cart.rs`; the issue (two criteria, Ready, in Review) works in its Co-Dev
    /// worktree and commits `src/pay.rs` (with a test named `pays`) on its branch. The mandatory
    /// check: `tests: test -f src/pay.rs`.
    pub(crate) fn new() -> Self {
        let repo = tempfile::tempdir().unwrap();
        let p = repo.path();
        g(p, &["init", "-q", "-b", "main"]);
        g(p, &["config", "user.name", "Ana"]);
        g(p, &["config", "user.email", "ana@example.com"]);
        g(p, &["config", "commit.gpgsign", "false"]);
        std::fs::create_dir_all(p.join("src")).unwrap();
        std::fs::write(p.join("src/cart.rs"), "pub fn cart() {}\n").unwrap();
        g(p, &["add", "."]);
        g(p, &["commit", "-q", "-m", "init"]);
        let data = tempfile::tempdir().unwrap();
        let db = data.path().join("board.sqlite3");
        let root = p.display().to_string();
        let mut st = ProjectStore::open(&db).unwrap();
        let pr = st
            .apply(
                &root,
                "Ana",
                1,
                serde_json::from_value(
                    json!({"op": "create_issue", "title": "Pagar com cartão", "kind": "story"}),
                )
                .unwrap(),
            )
            .unwrap();
        let key = pr.issues[0].key.clone();
        let items: Vec<Value> = CRITERIA
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
        st.apply(&root, "Ana", 3, serde_json::from_value(json!({"op": "settings", "checks": [{"name": "tests", "command": "test -f src/pay.rs"}], "dor": [], "dod": []})).unwrap())
            .unwrap();
        st.conn()
            .execute(
                "UPDATE issues SET state = 'review', ready = 1 WHERE root = ?1 AND key = ?2",
                [root.as_str(), key.as_str()],
            )
            .unwrap();
        let wbase = data.path().join("worktrees");
        let ibase = data.path().join("integration");
        // the Co-Dev worktree of phase 3, on the issue's branch, with one commit
        let branch = format!("feature/{}-pagar", key.to_lowercase());
        let plan = wt::plan(p, &wbase, &key, &branch).unwrap();
        let w = wt::create(p, &wbase, &key, &branch, &plan.command).unwrap();
        st.apply(
            &root,
            "Ana",
            4,
            serde_json::from_value(json!({"op": "update_issue", "key": key, "branch": branch}))
                .unwrap(),
        )
        .unwrap();
        std::fs::write(
            Path::new(&w.dir).join("src/pay.rs"),
            "pub fn pay() -> bool { true }\n#[cfg(test)]\nmod tests { #[test] fn pays() { assert!(super::pay()); } }\n",
        )
        .unwrap();
        wt::commit(p, &wbase, &key, &format!("{key}: pay")).unwrap();
        World {
            repo,
            _data: data,
            db,
            ibase,
            wbase,
            root,
            key,
            branch,
        }
    }

    pub(crate) fn p(&self) -> &Path {
        self.repo.path()
    }

    pub(crate) fn state(&self) -> ReviewState {
        state(&self.db, &self.ibase, &self.wbase, &self.root, &self.key).unwrap()
    }

    /// «Request review» with the command the panel shows, run to the end.
    pub(crate) fn review(&self, rv: MakeReviewer) -> Review {
        let cmd = self.state().request.expect("a review can be requested");
        let s = request(
            &self.db,
            &self.ibase,
            &self.root,
            &self.key,
            &cmd,
            Some(7),
            rv,
            ReplyLang::En,
            None,
        )
        .unwrap();
        if let Some(job) = s.job {
            job.run(Arc::new(|_| {}));
        }
        self.state().review.unwrap()
    }

    pub(crate) fn approve(&self) {
        let mut st = ProjectStore::open(&self.db).unwrap();
        st.apply(
            &self.root,
            "Rita",
            9,
            tutor_board::project::Op::ApproveFunctional {
                key: self.key.clone(),
                note: None,
            },
        )
        .unwrap();
    }

    pub(crate) fn integrate(&self, command: &str) -> Result<Integrated, String> {
        integrate(
            &self.db,
            &self.wbase,
            &self.root,
            &self.key,
            command,
            Some(8),
        )
    }

    /// One more commit on the issue's branch (in its worktree).
    pub(crate) fn branch_moves(&self) {
        let w = wt::find(self.p(), &self.wbase, &self.key).unwrap().unwrap();
        std::fs::write(Path::new(&w.dir).join("src/more.rs"), "\n").unwrap();
        wt::commit(self.p(), &self.wbase, &self.key, "more").unwrap();
    }

    /// One more commit on the default branch (in the project folder).
    pub(crate) fn main_moves(&self) {
        std::fs::write(self.p().join("NEWS"), "x\n").unwrap();
        g(self.p(), &["add", "NEWS"]);
        g(self.p(), &["commit", "-q", "-m", "news"]);
    }

    pub(crate) fn audit(&self) -> Vec<(String, String)> {
        let st = ProjectStore::open(&self.db).unwrap();
        let mut q = st
            .conn()
            .prepare(
                "SELECT call, outcome FROM audit WHERE root = ?1 AND tool = 'codev' ORDER BY id",
            )
            .unwrap();
        q.query_map([&self.root], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    pub(crate) fn issue_state(&self) -> String {
        let st = ProjectStore::open(&self.db).unwrap();
        let p = st.load(&self.root, 10).unwrap();
        p.issues
            .iter()
            .find(|i| i.key == self.key)
            .unwrap()
            .state
            .clone()
    }
}

/* ───── the tests ───── */

#[test]
fn the_happy_path_integrates_exactly_the_reviewed_tree() {
    let w = World::new();
    let p = w.p();
    let before = g(p, &["rev-parse", "main"]);
    let s = w.state();
    assert!(!s.gate.ok && s.integrate.is_none());
    assert_eq!(s.gate.checks.code, "no_review");
    assert_eq!(s.ahead, 1);
    let model = scripted(vec![
        tool_call("t1", "read", json!({"path": "src/pay.rs"})),
        verdict_call("v1", all_met()),
        say("Done."),
    ]);
    let r = w.review(reviewer(model.clone()));
    assert_eq!(r.state, "reviewed", "{:?}", r.error);
    assert!(r.checks[0].passed && r.checks[0].exit == Some(0));
    assert_eq!(r.verdict.as_ref().unwrap().overall, "met");
    assert_eq!((r.tokens_in, r.tokens_out), (300, 30));
    // the reviewer got the criteria, the checks and the diff — and only read-only tools
    let seen = model.seen.lock().unwrap();
    let first = seen[0].messages[0].text();
    assert!(
        first.contains(CRITERIA[0])
            && first.contains("test -f src/pay.rs")
            && first.contains("+pub fn pay()"),
        "{first}"
    );
    let tools: Vec<&str> = seen[0].tools.iter().map(|t| t.name.as_str()).collect();
    assert_eq!(tools, ["read", "glob", "grep", "review_verdict"]);
    drop(seen);
    // the temporary worktree is gone; the candidate stays (its ref)
    assert!(!gi::location(p, &w.ibase, &w.key).unwrap().exists());
    // no functional approval yet: the gate is closed and integrating is refused
    let s = w.state();
    assert!(s.gate.checks.ok && s.gate.reviewer.ok && !s.gate.functional.ok);
    let plan = gi::integrate_command(p, &r.candidate);
    assert!(w
        .integrate(&plan)
        .unwrap_err()
        .contains("functional: not_recorded"));
    w.approve();
    // ticking the criteria done (the DoD needs it for Done) keeps their texts: the approval stays
    let mut st = ProjectStore::open(&w.db).unwrap();
    let items: Vec<Value> = CRITERIA
        .iter()
        .map(|t| json!({"text": t, "done": true}))
        .collect();
    st.apply(
        &w.root,
        "Rita",
        10,
        serde_json::from_value(json!({"op": "set_acceptance", "key": w.key, "items": items}))
            .unwrap(),
    )
    .unwrap();
    let s = w.state();
    assert!(s.gate.ok, "{:?}", s.gate);
    let cmd = s.integrate.clone().unwrap();
    assert!(
        cmd.starts_with(&plan) && cmd.contains("worktree remove"),
        "{cmd}"
    );
    // a command that is not the plan runs nothing
    assert!(w.integrate("git merge x").is_err());
    let done = w.integrate(&cmd).unwrap();
    assert_eq!(done.commit, r.candidate);
    assert_eq!(g(p, &["rev-parse", "main"]), r.candidate);
    assert_eq!(g(p, &["rev-parse", "main^{tree}"]), r.tree);
    assert_eq!(g(p, &["rev-parse", "main^1"]), before);
    assert!(p.join("src/pay.rs").is_file(), "the project folder follows");
    assert!(done.worktree_removed, "the clean Co-Dev worktree goes");
    assert_eq!(done.state, "done");
    assert_eq!(w.issue_state(), "done");
    // the branch stays; the undo snapshot brings main back
    assert!(!g(p, &["branch", "--list", &w.branch]).is_empty());
    assert!(tutor_eval::gitwork::undo_list(p)
        .unwrap()
        .iter()
        .any(|e| e.id == done.snapshot));
    let calls: Vec<String> = w
        .audit()
        .into_iter()
        .map(|(c, o)| format!("{c}:{o}"))
        .collect();
    assert!(
        calls.ends_with(&[
            "review.request:sent".to_string(),
            "review.request:ok".to_string(),
            "review.integrate:sent".to_string(),
            "review.integrate:ok".to_string(),
            "worktree.remove:sent".to_string(),
            "worktree.remove:ok".to_string(),
        ]),
        "{calls:?}"
    );
    // integrated: the gate does not open twice
    let s = w.state();
    assert!(!s.gate.ok);
}

#[test]
fn a_failed_check_stops_the_review_before_the_reviewer_and_closes_the_gate() {
    let w = World::new();
    let mut st = ProjectStore::open(&w.db).unwrap();
    st.apply(
        &w.root,
        "Ana",
        5,
        serde_json::from_value(json!({"op": "settings", "checks": [
            {"name": "tests", "command": "test -f src/pay.rs"},
            {"name": "lint", "command": "echo 'lint: 2 problems' >&2; exit 3"}
        ]}))
        .unwrap(),
    )
    .unwrap();
    w.approve();
    let r = w.review(never());
    assert_eq!(r.state, "checked");
    assert_eq!((r.checks[1].exit, r.checks[1].passed), (Some(3), false));
    assert!(r.checks[1].tail.contains("lint: 2 problems"));
    let s = w.state();
    assert_eq!(
        (s.gate.checks.code.as_str(), s.gate.checks.items.clone()),
        ("failed", vec!["lint".to_string()])
    );
    assert_eq!(s.gate.reviewer.code, "skipped");
    assert!(!s.gate.ok && s.integrate.is_none());
    let before = g(w.p(), &["rev-parse", "main"]);
    assert!(w
        .integrate(&gi::integrate_command(w.p(), &r.candidate))
        .unwrap_err()
        .contains("checks: failed (lint)"));
    assert_eq!(g(w.p(), &["rev-parse", "main"]), before);
}

#[test]
fn the_issue_branch_moving_after_a_green_review_makes_it_stale() {
    let w = World::new();
    w.approve();
    let r = w.review(reviewer(scripted(vec![
        verdict_call("v", all_met()),
        say("ok"),
    ])));
    assert!(w.state().gate.ok);
    let cmd = w.state().integrate.unwrap();
    w.branch_moves();
    let s = w.state();
    assert_eq!(
        (s.gate.checks.code.as_str(), s.gate.reviewer.code.as_str()),
        ("stale_head", "stale")
    );
    assert!(!s.gate.ok && s.integrate.is_none());
    let before = g(w.p(), &["rev-parse", "main"]);
    assert!(w.integrate(&cmd).unwrap_err().contains("stale_head"));
    assert_eq!(g(w.p(), &["rev-parse", "main"]), before);
    // a new review of the new tip is what counts
    let r2 = w.review(reviewer(scripted(vec![
        verdict_call("v", all_met()),
        say("ok"),
    ])));
    assert_ne!(r2.candidate, r.candidate);
    assert!(w.state().gate.ok);
}

#[test]
fn the_default_branch_moving_after_a_green_review_makes_it_stale() {
    let w = World::new();
    w.approve();
    w.review(reviewer(scripted(vec![
        verdict_call("v", all_met()),
        say("ok"),
    ])));
    let cmd = w.state().integrate.unwrap();
    w.main_moves();
    let s = w.state();
    assert_eq!(s.gate.checks.code, "stale_base");
    assert!(!s.gate.ok);
    let moved = g(w.p(), &["rev-parse", "main"]);
    assert!(w.integrate(&cmd).unwrap_err().contains("stale_base"));
    assert_eq!(g(w.p(), &["rev-parse", "main"]), moved);
}

#[test]
fn criteria_that_change_after_the_approval_invalidate_it_and_the_review() {
    let w = World::new();
    w.approve();
    w.review(reviewer(scripted(vec![
        verdict_call("v", all_met()),
        say("ok"),
    ])));
    let cmd = w.state().integrate.unwrap();
    let mut st = ProjectStore::open(&w.db).unwrap();
    let items = vec![
        json!({"text": CRITERIA[0], "done": false}),
        json!({"text": "Dado um reembolso, quando peço, então devolve", "done": false}),
    ];
    st.apply(
        &w.root,
        "Ana",
        11,
        serde_json::from_value(json!({"op": "set_acceptance", "key": w.key, "items": items}))
            .unwrap(),
    )
    .unwrap();
    let s = w.state();
    assert_eq!(
        s.gate.functional.code, "not_recorded",
        "the approval dropped with the criteria"
    );
    assert_eq!(s.gate.reviewer.code, "stale_criteria");
    assert!(!s.gate.ok);
    assert!(w.integrate(&cmd).is_err());
    // approving again does not revive the review of the old criteria
    w.approve();
    let s = w.state();
    assert!(s.gate.functional.ok && !s.gate.reviewer.ok && !s.gate.ok);
}

#[test]
fn a_reviewer_that_says_not_met_or_unclear_closes_the_gate() {
    let w = World::new();
    w.approve();
    w.review(reviewer(scripted(vec![
        verdict_call("v", json!({"overall": "not_met", "summary": "It charges twice.", "criteria": [
            {"index": 1, "status": "not_met", "evidence": [{"kind": "file", "ref": "src/pay.rs", "lines": "1"}], "note": "no idempotency"},
            {"index": 2, "status": "met", "evidence": [{"kind": "test", "ref": "pays"}]}
        ]})),
        say("ok"),
    ])));
    let s = w.state();
    assert_eq!(
        (s.gate.reviewer.code.as_str(), s.gate.reviewer.items.clone()),
        ("not_met", vec!["1".to_string()])
    );
    assert!(s.gate.checks.ok && s.gate.functional.ok && !s.gate.ok && s.integrate.is_none());
    w.review(reviewer(scripted(vec![
        verdict_call(
            "v",
            json!({"overall": "unclear", "summary": "No test for 2.", "criteria": [
                {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/pay.rs"}]},
                {"index": 2, "status": "unclear", "evidence": [], "note": "nothing runs it"}
            ]}),
        ),
        say("ok"),
    ])));
    let s = w.state();
    assert_eq!(s.gate.reviewer.code, "unclear");
    assert!(!s.gate.ok);
    let r = s.review.unwrap();
    assert!(w
        .integrate(&gi::integrate_command(w.p(), &r.candidate))
        .unwrap_err()
        .contains("reviewer: unclear"));
}

#[test]
fn invented_evidence_is_sent_back_and_a_reviewer_with_no_verdict_fails() {
    let w = World::new();
    let ghost = json!({"overall": "met", "summary": "s", "criteria": [
        {"index": 1, "status": "met", "evidence": [{"kind": "file", "ref": "src/ghost.rs"}]},
        {"index": 2, "status": "met", "evidence": [{"kind": "test", "ref": "refunds_twice"}, {"kind": "file", "ref": "src/pay.rs", "lines": "1-99"}]}
    ]});
    let model = scripted(vec![
        verdict_call("v1", ghost),
        verdict_call("v2", all_met()),
        say("ok"),
    ]);
    let r = w.review(reviewer(model.clone()));
    assert_eq!(r.state, "reviewed");
    let seen = model.seen.lock().unwrap();
    let back = serde_json::to_string(&seen[1].messages).unwrap();
    assert!(
        back.contains("src/ghost.rs is not a file of this tree"),
        "{back}"
    );
    assert!(back.contains("no test named refunds_twice"), "{back}");
    assert!(back.contains("has 3 lines, not 99"), "{back}");
    drop(seen);
    // a reviewer that never gives a verdict (asked twice) leaves no verdict
    let r = w.review(reviewer(scripted(vec![
        say("Looks fine to me."),
        say("Still fine."),
    ])));
    assert_eq!(r.state, "failed");
    assert_eq!(
        r.error.as_deref(),
        Some("the reviewer ended without a verdict")
    );
    w.approve();
    let s = w.state();
    assert_eq!(s.gate.reviewer.code, "no_verdict");
    assert!(!s.gate.ok);
    // and a reviewer that cannot be built (no key) fails the same way
    let r = w.review(Box::new(|| Err("no Anthropic key".into())));
    assert_eq!(
        (r.state.as_str(), r.error.as_deref()),
        ("failed", Some("no Anthropic key"))
    );
    assert!(!w.state().gate.ok);
}

#[test]
fn a_conflict_is_reported_with_its_files_and_nothing_is_reviewed() {
    let w = World::new();
    let wtree = wt::find(w.p(), &w.wbase, &w.key).unwrap().unwrap();
    std::fs::write(
        Path::new(&wtree.dir).join("src/cart.rs"),
        "pub fn cart() { 1 }\n",
    )
    .unwrap();
    wt::commit(w.p(), &w.wbase, &w.key, "cart 1").unwrap();
    std::fs::write(w.p().join("src/cart.rs"), "pub fn cart() { 2 }\n").unwrap();
    g(w.p(), &["commit", "-qam", "cart 2"]);
    w.approve();
    let r = w.review(never());
    assert_eq!(
        (r.state.as_str(), r.conflicts.clone()),
        ("conflict", vec!["src/cart.rs".to_string()])
    );
    let s = w.state();
    assert_eq!(
        (s.gate.checks.code.as_str(), s.gate.checks.items.clone()),
        ("conflict", vec!["src/cart.rs".to_string()])
    );
    assert!(!s.gate.ok);
    assert!(!gi::location(w.p(), &w.ibase, &w.key).unwrap().exists());
    assert!(w.audit().ends_with(&[
        ("review.request".into(), "sent".into()),
        ("review.request".into(), "failed".into())
    ]));
}

#[test]
fn a_request_runs_only_the_approved_plan_and_needs_checks_and_criteria() {
    let w = World::new();
    let cmd = w.state().request.unwrap();
    // the branch moved since the approval: refused, nothing recorded
    w.branch_moves();
    let n = w.audit().len();
    let e = request(
        &w.db,
        &w.ibase,
        &w.root,
        &w.key,
        &cmd,
        None,
        never(),
        ReplyLang::En,
        None,
    )
    .err()
    .unwrap();
    assert!(e.contains("changed since the approval"), "{e}");
    assert_eq!(w.audit().len(), n);
    // no mandatory checks: no request (an empty list never opens the gate)
    let mut st = ProjectStore::open(&w.db).unwrap();
    st.apply(
        &w.root,
        "Ana",
        5,
        serde_json::from_value(json!({"op": "settings", "checks": []})).unwrap(),
    )
    .unwrap();
    let s = w.state();
    assert!(s.request.is_none() && s.request_blocked.unwrap().contains("no mandatory checks"));
    assert_eq!(s.gate.checks.code, "none_set");
}

#[test]
fn a_secret_in_the_candidate_stops_the_integration_until_a_reason_is_given() {
    let w = World::new();
    let wtree = wt::find(w.p(), &w.wbase, &w.key).unwrap().unwrap();
    std::fs::write(
        Path::new(&wtree.dir).join("src/db.rs"),
        "const URL: &str = \"postgres://u:p@h/app\";\n",
    )
    .unwrap();
    // the worktree commit's own scan blocks it too: the human gave a reason there
    tutor_protect::scan::allow_once(w.p(), "fixture").unwrap();
    wt::commit(w.p(), &w.wbase, &w.key, "db").unwrap();
    w.approve();
    let r = w.review(reviewer(scripted(vec![
        verdict_call("v", all_met()),
        say("ok"),
    ])));
    assert_eq!(
        r.scan.as_ref().unwrap()["findings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let cmd = w.state().integrate.unwrap();
    let before = g(w.p(), &["rev-parse", "main"]);
    let e = w.integrate(&cmd).unwrap_err();
    assert!(
        e.starts_with(tutor_protect::scan::BLOCKED) && !e.contains("u:p@"),
        "{e}"
    );
    assert_eq!(g(w.p(), &["rev-parse", "main"]), before);
    tutor_protect::scan::allow_once(w.p(), "test fixture, not a real database").unwrap();
    assert_eq!(w.integrate(&cmd).unwrap().commit, r.candidate);
}

#[test]
fn a_broken_architecture_rule_stops_the_review_before_the_reviewer() {
    let w = World::new();
    std::fs::create_dir_all(w.p().join(".dxtutor")).unwrap();
    std::fs::write(
        w.p().join(".dxtutor/architecture.toml"),
        "[[naming]]\npaths = [\"src/**/*.rs\"]\npattern = \"^cart\\\\.rs$\"\n",
    )
    .unwrap();
    let r = w.review(never());
    assert_eq!(r.state, "checked");
    assert!(
        r.arch_rules && r.arch.iter().any(|a| a.path == "src/pay.rs"),
        "{:?}",
        r.arch
    );
    let s = w.state();
    assert_eq!(s.gate.checks.code, "arch");
    assert!(!s.gate.ok);
}
