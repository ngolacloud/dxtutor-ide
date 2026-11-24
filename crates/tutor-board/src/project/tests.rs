use super::*;

const ROOT: &str = "/home/u/dxtutor";
const T0: i64 = 1_763_000_000_000;
const H: i64 = 3_600_000;

fn store() -> ProjectStore {
    ProjectStore::in_memory().unwrap()
}

fn op(json: serde_json::Value) -> Op {
    serde_json::from_value(json).unwrap()
}

fn create(s: &mut ProjectStore, title: &str, at: i64) -> String {
    let p = s
        .apply(
            ROOT,
            "Walter",
            at,
            op(serde_json::json!({"op": "create_issue", "title": title, "points": 3})),
        )
        .unwrap();
    p.issues.last().unwrap().key.clone()
}

fn mv(s: &mut ProjectStore, key: &str, to: &str, at: i64) -> Result<Project, ProjectError> {
    s.apply(
        ROOT,
        "Walter",
        at,
        op(serde_json::json!({"op": "move", "key": key, "to": to})),
    )
}

#[test]
fn a_new_project_is_empty_with_the_method_defaults() {
    let s = store();
    let p = s.load(ROOT, T0).unwrap();
    assert_eq!(p.key_prefix, "DXT");
    assert_eq!(p.method, "kanban");
    assert!(p.issues.is_empty() && p.sprints.is_empty() && p.inbox.is_empty());
    assert_eq!(p.wip.get("progress"), Some(&3));
    assert_eq!(s.load("/other", T0).unwrap().key_prefix, "OTH");
}

#[test]
fn migrations_run_once_and_a_newer_base_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("board.sqlite3");
    {
        let mut s = ProjectStore::open(&f).unwrap();
        create(&mut s, "a", T0);
    }
    let s = ProjectStore::open(&f).unwrap();
    assert_eq!(
        s.load(ROOT, T0).unwrap().issues.len(),
        1,
        "reopening keeps the data"
    );
    let n: i64 = s
        .conn()
        .query_row("SELECT COUNT(*) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, schema::SCHEMA_VERSION as i64);
    s.conn()
        .execute("INSERT INTO schema_version (version) VALUES (999)", [])
        .unwrap();
    drop(s);
    assert!(ProjectStore::open(&f).err().unwrap().contains("newer"));
}

#[test]
fn the_legacy_board_becomes_issues() {
    let dir = tempfile::tempdir().unwrap();
    let f = dir.path().join("board.sqlite3");
    {
        let mut old = crate::BoardStore::open(&f).unwrap();
        let b = crate::Backlog {
            problem: "p".into(),
            seq: 2,
            sprints: vec![crate::Sprint {
                index: 0,
                goal: "g".into(),
            }],
            stories: vec![crate::Story {
                id: "DX-1".into(),
                sprint: 0,
                role: "dev".into(),
                want: "logs".into(),
                so_that: "debug".into(),
                acceptance: vec!["shows logs".into()],
                points: 2,
                stage: "test".into(),
                kind: "fix".into(),
                prompt: "".into(),
                note: "".into(),
                branch: None,
            }],
        };
        old.save_board(ROOT, &b, T0).unwrap();
    }
    let s = ProjectStore::open(&f).unwrap();
    let p = s.load(ROOT, T0).unwrap();
    assert_eq!(p.issues.len(), 1);
    let i = &p.issues[0];
    assert_eq!(
        (i.key.as_str(), i.kind.as_str(), i.state.as_str(), i.points),
        ("DX-1", "bug", "review", Some(2))
    );
    assert_eq!(i.title, "Como dev, quero logs");
    assert_eq!(
        i.acceptance,
        vec![Criterion {
            text: "shows logs".into(),
            done: false
        }]
    );
}

#[test]
fn moves_go_one_step_and_respect_wip() {
    let mut s = store();
    let a = create(&mut s, "a", T0);
    let e = mv(&mut s, &a, "review", T0 + H).unwrap_err();
    assert_eq!((e.code.as_str(), e.overridable), ("step", true));
    for (i, k) in ["b", "c", "d"].iter().enumerate() {
        let k = create(&mut s, k, T0);
        mv(&mut s, &k, "progress", T0 + i as i64).unwrap();
    }
    let e = mv(&mut s, &a, "progress", T0 + H).unwrap_err();
    assert_eq!(e.code, "wip");
    // an override needs a reason and is recorded
    let p = s
        .apply(ROOT, "Walter", T0 + 2 * H, op(serde_json::json!({"op": "move", "key": a, "to": "progress", "reason": "expedite: production down"})))
        .unwrap();
    assert_eq!(
        p.issues.iter().find(|i| i.key == a).unwrap().state,
        "progress"
    );
    let d = s.detail(ROOT, &a).unwrap();
    assert_eq!(d.activity[0].kind, "override");
    assert_eq!(
        d.activity[0].note,
        "excepção (wip): expedite: production down"
    );
    // an empty reason is no reason
    let k = create(&mut s, "e", T0);
    assert!(s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "move", "key": k, "to": "progress", "reason": "  "}))
        )
        .is_err());
}

#[test]
fn scrum_needs_ready_to_start_and_done_needs_the_dod() {
    let mut s = store();
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "settings", "method": "scrum", "dod": ["Code reviewed"], "wip": {}}))).unwrap();
    let p = s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "create_issue", "title": "x", "acceptance": ["works"]})),
        )
        .unwrap();
    let k = p.issues[0].key.clone();
    assert_eq!(mv(&mut s, &k, "progress", T0).unwrap_err().code, "dor");
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "update_issue", "key": k, "ready": true})),
    )
    .unwrap();
    for to in ["progress", "review", "accept"] {
        mv(&mut s, &k, to, T0 + H).unwrap();
    }
    let e = mv(&mut s, &k, "done", T0 + 2 * H).unwrap_err();
    assert_eq!(e.code, "dod");
    assert!(e.message.contains("1 critério(s)") && e.message.contains("1 item(ns)"));
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "set_acceptance", "key": k, "items": [{"text": "works", "done": true}]}))).unwrap();
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "update_issue", "key": k, "dod_done": [true]})),
    )
    .unwrap();
    assert_eq!(
        mv(&mut s, &k, "done", T0 + 3 * H).unwrap().issues[0].state,
        "done"
    );
    // going back a step is always allowed
    assert_eq!(
        mv(&mut s, &k, "accept", T0 + 4 * H).unwrap().issues[0].state,
        "accept"
    );
}

#[test]
fn a_blocked_issue_does_not_move_forward() {
    let mut s = store();
    let k = create(&mut s, "x", T0);
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "update_issue", "key": k, "blocked": "waiting for the API key"}))).unwrap();
    assert_eq!(mv(&mut s, &k, "progress", T0).unwrap_err().code, "blocked");
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "update_issue", "key": k, "blocked": null})),
    )
    .unwrap();
    assert!(mv(&mut s, &k, "progress", T0).is_ok());
}

#[test]
fn rank_puts_an_issue_before_another() {
    let mut s = store();
    let a = create(&mut s, "a", T0);
    let b = create(&mut s, "b", T0);
    let c = create(&mut s, "c", T0);
    let p = s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "rank", "key": c, "before": b})),
        )
        .unwrap();
    let order: Vec<&str> = p.issues.iter().map(|i| i.key.as_str()).collect();
    assert_eq!(order, [a.as_str(), c.as_str(), b.as_str()]);
}

#[test]
fn sprints_start_one_at_a_time_and_closing_carries_unfinished_work() {
    let mut s = store();
    let mk = |s: &mut ProjectStore, n: &str| {
        s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "create_sprint", "name": n, "start": T0, "end": T0 + 14 * 24 * H}))).unwrap()
    };
    mk(&mut s, "Sprint 1");
    let p = mk(&mut s, "Sprint 2");
    assert_eq!(
        p.sprints.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(),
        ["S1", "S2"]
    );
    let a = create(&mut s, "a", T0);
    let b = create(&mut s, "b", T0);
    for k in [&a, &b] {
        s.apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "plan_issue", "key": k, "sprint": "S1"})),
        )
        .unwrap();
    }
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "start_sprint", "id": "S1"})),
    )
    .unwrap();
    assert!(s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "start_sprint", "id": "S2"}))
        )
        .is_err());
    s.conn()
        .execute(
            "UPDATE issues SET state = 'done' WHERE key = ?1",
            params![a],
        )
        .unwrap();
    let p = s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "close_sprint", "id": "S1", "carry_to": "S2"})),
        )
        .unwrap();
    let get = |k: &str| p.issues.iter().find(|i| i.key == k).unwrap().sprint.clone();
    assert_eq!(get(&a).as_deref(), Some("S1"));
    assert_eq!(get(&b).as_deref(), Some("S2"));
    assert_eq!(p.sprints[0].state, "closed");
}

#[test]
fn proposals_wait_in_the_inbox_until_a_human_decides() {
    let mut s = store();
    let p = s
        .apply(ROOT, "Studio", T0, op(serde_json::json!({"op": "propose", "title": "API gateway", "kind": "story", "points": 5, "source": "studio", "detail": "from the design"})))
        .unwrap();
    assert!(p.issues.is_empty());
    let id = p.inbox[0].id;
    let p = s
        .apply(
            ROOT,
            "Walter",
            T0,
            op(serde_json::json!({"op": "accept_proposal", "id": id})),
        )
        .unwrap();
    assert!(p.inbox.is_empty());
    assert_eq!(p.issues[0].title, "API gateway");
    assert_eq!(p.issues[0].description, "from the design");
    assert!(s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "accept_proposal", "id": id}))
        )
        .is_err());
    let p = s
        .apply(
            ROOT,
            "S",
            T0,
            op(serde_json::json!({"op": "propose", "title": "x", "source": "studio"})),
        )
        .unwrap();
    let p = s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "dismiss_proposal", "id": p.inbox[0].id})),
        )
        .unwrap();
    assert!(p.inbox.is_empty() && p.issues.len() == 1);
}

#[test]
fn commits_citing_a_key_are_linked_once() {
    let mut s = store();
    let k = create(&mut s, "x", T0); // DXT-1
    let commits = serde_json::json!([
        {"hash": "abc1234567", "subject": "fix(lexer): DXT-1 tokenise numbers", "at": T0 + H},
        {"hash": "def7654321", "subject": "chore: nothing (ADXT-1 is not a key)", "at": T0 + H},
        {"hash": "0123456789", "subject": "feat: DXT-99 unknown issue", "at": T0 + H},
    ]);
    let p = s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "link_commits", "commits": commits.clone()})),
        )
        .unwrap();
    assert_eq!(p.issues[0].links.len(), 1);
    assert_eq!(p.issues[0].links[0].reference, "abc1234567");
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "link_commits", "commits": commits})),
    )
    .unwrap();
    let d = s.detail(ROOT, &k).unwrap();
    assert_eq!(
        d.activity.iter().filter(|a| a.kind == "commit").count(),
        1,
        "linking twice records once"
    );
}

#[test]
fn change_sets_are_linked_to_their_issue() {
    let mut s = store();
    let k = create(&mut s, "x", T0);
    let cs = NewChangeSet {
        session: "cda-1".into(),
        call: "toolu_1".into(),
        hunk: "toolu_1:1".into(),
        path: "src/lib.rs".into(),
        start: 3,
        end: 3,
        added: 1,
        removed: 1,
        decided_by: "human".into(),
        issue_key: Some(k.clone()),
    };
    s.record_change_set(ROOT, &cs, T0 + H).unwrap();
    s.record_change_set(
        ROOT,
        &NewChangeSet {
            issue_key: None,
            ..cs.clone()
        },
        T0 + H,
    )
    .unwrap();
    assert_eq!(s.load(ROOT, T0).unwrap().issues[0].change_sets, 1);
    let d = s.detail(ROOT, &k).unwrap();
    assert_eq!(d.change_sets.len(), 1);
    assert_eq!(d.activity[0].note, "src/lib.rs +1 −1");
}

#[test]
fn reports_come_from_the_history_and_are_empty_without_it() {
    let mut s = store();
    let r = s.reports(ROOT, T0).unwrap();
    assert!(
        r.cycle.is_empty()
            && r.throughput.is_empty()
            && r.cfd.is_empty()
            && r.burndown.is_none()
            && r.velocity.is_empty()
    );

    let day = 24 * H;
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "settings", "wip": {}})),
    )
    .unwrap();
    let a = create(&mut s, "a", T0);
    let b = create(&mut s, "b", T0);
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "create_sprint", "name": "S", "start": T0, "end": T0 + 10 * day}))).unwrap();
    for k in [&a, &b] {
        s.apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "plan_issue", "key": k, "sprint": "S1"})),
        )
        .unwrap();
    }
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "start_sprint", "id": "S1"})),
    )
    .unwrap();
    mv(&mut s, &a, "progress", T0 + day).unwrap();
    for (i, to) in ["review", "accept", "done"].iter().enumerate() {
        mv(&mut s, &a, to, T0 + 2 * day + i as i64 * H).unwrap();
    }
    let now = T0 + 3 * day;
    let r = s.reports(ROOT, now).unwrap();
    assert_eq!(r.cycle.len(), 1);
    assert_eq!(r.cycle[0].key, a);
    assert!((r.cycle[0].days - 1.1).abs() < 0.01, "{}", r.cycle[0].days);
    assert_eq!(r.throughput.iter().map(|w| w.done).sum::<u32>(), 1);
    let last = r.cfd.last().unwrap();
    assert_eq!(last.counts, [1, 0, 0, 0, 1]);
    let bd = r.burndown.unwrap();
    assert_eq!(bd.total, 6);
    assert_eq!(bd.days.first().unwrap().remaining, 6);
    assert_eq!(bd.days.last().unwrap().remaining, 3);

    s.apply(
        ROOT,
        "W",
        now,
        op(serde_json::json!({"op": "close_sprint", "id": "S1"})),
    )
    .unwrap();
    let r = s.reports(ROOT, now).unwrap();
    assert_eq!(
        r.velocity,
        vec![reports::Velocity {
            sprint: "S1".into(),
            name: "S".into(),
            points: 3
        }]
    );
}

#[test]
fn projects_are_isolated_per_root_and_bad_input_is_refused() {
    let mut s = store();
    create(&mut s, "a", T0);
    assert!(s.load("/elsewhere", T0).unwrap().issues.is_empty());
    for bad in [
        serde_json::json!({"op": "create_issue", "title": " "}),
        serde_json::json!({"op": "create_issue", "title": "x", "kind": "epic"}),
        serde_json::json!({"op": "settings", "method": "waterfall"}),
        serde_json::json!({"op": "settings", "wip": {"doing": 2}}),
        serde_json::json!({"op": "move", "key": "NOPE-1", "to": "done"}),
    ] {
        let e = s.apply(ROOT, "W", T0, op(bad.clone())).unwrap_err();
        assert!(e.code == "invalid" || e.code == "not_found", "{bad}: {e:?}");
    }
}

#[test]
fn turn_reports_are_kept_with_their_issue() {
    let mut s = store();
    let k = create(&mut s, "x", T0);
    s.record_artifact(
        ROOT,
        "cda-1",
        Some(&k),
        "corrige o E0382",
        "**Files changed:** none",
        T0 + H,
    )
    .unwrap();
    s.record_artifact(ROOT, "cda-1", None, "conversa", "…", T0 + H)
        .unwrap();
    let d = s.detail(ROOT, &k).unwrap();
    assert_eq!(d.reports.len(), 1);
    assert_eq!(d.reports[0].title, "corrige o E0382");
    let n: i64 = s
        .conn()
        .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, schema::SCHEMA_VERSION as i64);
}

#[test]
fn test_history_finds_flaky_tests_and_keeps_runs() {
    use testhist::{NewCase, NewRun};
    let mut s = store();
    let case = |id: &str, st: &str, ms: u64| NewCase {
        case_id: id.into(),
        name: id.into(),
        suite: "lib".into(),
        status: st.into(),
        duration_ms: Some(ms),
        message: (st == "failed").then(|| format!("{id} broke")),
    };
    // a: passes, fails, passes, fails → flaky; b: fails once then fixed → not flaky
    for (i, (a, b)) in [
        ("passed", "failed"),
        ("failed", "passed"),
        ("passed", "passed"),
        ("failed", "passed"),
    ]
    .iter()
    .enumerate()
    {
        let run = NewRun {
            runner: "cargo:.".into(),
            command: "cargo test".into(),
            scope: "all".into(),
            ok: *a == "passed" && *b == "passed",
            duration_ms: 1000,
            cases: vec![case("a", a, 10 + i as u64 * 10), case("b", b, 5)],
        };
        s.record_test_run(ROOT, &run, T0 + i as i64 * H).unwrap();
    }
    let h = s.test_history(ROOT, 30).unwrap();
    assert_eq!(h.runs.len(), 4);
    assert_eq!(h.runs[0].at, T0 + 3 * H, "most recent first");
    assert_eq!((h.runs[0].passed, h.runs[0].failed), (1, 1));
    let a = h.cases.iter().find(|c| c.case_id == "a").unwrap();
    assert_eq!(a.recent, "pfpf");
    assert_eq!((a.flips, a.flaky, a.last.as_str()), (3, true, "failed"));
    assert_eq!(a.avg_ms, Some(25));
    assert_eq!(a.last_message.as_deref(), Some("a broke"));
    let b = h.cases.iter().find(|c| c.case_id == "b").unwrap();
    assert_eq!((b.flips, b.flaky), (1, false));
    assert_eq!(h.cases[0].case_id, "a", "flaky first");
    assert!(s.test_history("/other", 30).unwrap().runs.is_empty());
}
