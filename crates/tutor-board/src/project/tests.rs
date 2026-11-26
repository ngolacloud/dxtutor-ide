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
                meta: None,
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
    // RF-B02: Ready only with the story, criteria in Given/When/Then and a scope
    let ready = |s: &mut ProjectStore| {
        s.apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "update_issue", "key": k, "ready": true})),
        )
    };
    let e = ready(&mut s).unwrap_err();
    assert_eq!(e.code, "dor");
    assert!(
        e.message.contains("âmbito") && e.message.contains("Dado/Quando/Então"),
        "{}",
        e.message
    );
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "update_issue", "key": k, "story_as": "dev", "story_want": "logs", "story_so": "depurar", "scope": ["src/**"]}))).unwrap();
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "set_acceptance", "key": k, "items": [{"text": "Dado X, quando Y, então works", "done": false}]}))).unwrap();
    let p = ready(&mut s).unwrap();
    assert_eq!(p.issues[0].ready_by.as_deref(), Some("W"));
    assert!(p.issues[0].missing.is_empty(), "{:?}", p.issues[0].missing);
    for to in ["progress", "review", "accept"] {
        mv(&mut s, &k, to, T0 + H).unwrap();
    }
    let e = mv(&mut s, &k, "done", T0 + 2 * H).unwrap_err();
    assert_eq!(e.code, "dod");
    assert!(e.message.contains("1 critério(s)") && e.message.contains("1 item(ns)"));
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "set_acceptance", "key": k, "items": [{"text": "Dado X, quando Y, então works", "done": true}]}))).unwrap();
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
fn the_source_control_groups_the_change_sets_since_the_last_commit_by_issue() {
    let mut s = store();
    let k = create(&mut s, "Paginate the list", T0);
    let cs = |path: &str, issue: Option<&str>| NewChangeSet {
        session: "cda-1".into(),
        call: "toolu_1".into(),
        hunk: format!("toolu_1:{path}"),
        path: path.into(),
        start: 3,
        end: 4,
        added: 2,
        removed: 1,
        decided_by: "human".into(),
        issue_key: issue.map(str::to_string),
    };
    s.record_change_set(ROOT, &cs("src/old.rs", Some(&k)), T0)
        .unwrap();
    s.record_change_set(ROOT, &cs("src/a.rs", Some(&k)), T0 + H)
        .unwrap();
    s.record_change_set(ROOT, &cs("src/chat.rs", None), T0 + 2 * H)
        .unwrap();
    s.record_change_set(ROOT, &cs("src/b.rs", Some(&k)), T0 + 3 * H)
        .unwrap();
    s.record_change_set("/other", &cs("src/x.rs", Some(&k)), T0 + 3 * H)
        .unwrap();
    // the commit at T0 + 30 min took `src/old.rs`: only what came after it is shown
    let g = s.change_sets_since(ROOT, T0 + H / 2).unwrap();
    assert_eq!(g.len(), 2);
    assert_eq!(g[0].issue_key.as_deref(), Some(k.as_str()));
    assert_eq!(g[0].title, "Paginate the list");
    assert_eq!(
        g[0].rows
            .iter()
            .map(|r| r.path.as_str())
            .collect::<Vec<_>>(),
        ["src/b.rs", "src/a.rs"]
    );
    assert_eq!((g[1].issue_key.clone(), g[1].title.as_str()), (None, ""));
    assert_eq!(g[1].rows[0].path, "src/chat.rs");
    assert_eq!(s.change_sets_since(ROOT, 0).unwrap()[0].rows.len(), 3);
    let j = serde_json::to_value(&g[0]).unwrap();
    assert_eq!(j["issueKey"], serde_json::json!(k));
}

#[test]
fn the_issue_panel_sums_the_turns_of_its_issue() {
    let mut s = store();
    let k = create(&mut s, "x", T0);
    assert_eq!(s.detail(ROOT, &k).unwrap().usage, IssueUsage::default());
    let turn =
        |at: i64, session: &str, issue: Option<&str>, model: &str, cost: Option<f64>| AuditEntry {
            at,
            session: session.into(),
            event: "turn".into(),
            origin: "issue".into(),
            issue_key: issue.map(str::to_string),
            actor: "ana".into(),
            mode: "assist".into(),
            model: Some(model.into()),
            tokens_in: Some(1000),
            tokens_out: Some(200),
            cost_usd: cost,
            ..Default::default()
        };
    s.record_audit(
        ROOT,
        &turn(T0 + 1, "cda-1", Some(&k), "claude-sonnet-5-5", Some(0.25)),
    )
    .unwrap();
    s.record_audit(
        ROOT,
        &turn(T0 + 2, "cda-1", Some(&k), "claude-opus-5-5", Some(0.5)),
    )
    .unwrap();
    s.record_audit(ROOT, &turn(T0 + 3, "cda-2", Some(&k), "llama3", None))
        .unwrap();
    s.record_audit(
        ROOT,
        &turn(T0 + 4, "cda-2", Some(&k), "claude-sonnet-5-5", Some(0.25)),
    )
    .unwrap();
    // other issues, the chat and the calls do not count
    s.record_audit(ROOT, &turn(T0 + 5, "cda-3", None, "gpt", Some(9.0)))
        .unwrap();
    s.record_audit(
        ROOT,
        &AuditEntry {
            event: "call".into(),
            ..turn(T0 + 6, "cda-1", Some(&k), "x", Some(9.0))
        },
    )
    .unwrap();
    let u = s.detail(ROOT, &k).unwrap().usage;
    assert_eq!((u.turns, u.sessions, u.unpriced), (4, 2, 1));
    assert_eq!((u.tokens_in, u.tokens_out), (4000, 800));
    assert!((u.cost_usd - 1.0).abs() < 1e-9, "{}", u.cost_usd);
    assert_eq!(u.models, ["claude-sonnet-5-5", "claude-opus-5-5", "llama3"]);
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
fn the_audit_log_keeps_every_decision_in_order_and_by_issue() {
    let mut s = store();
    let k = create(&mut s, "x", T0);
    let call = |at: i64, issue: Option<&str>, outcome: &str| AuditEntry {
        at,
        session: "cda-1".into(),
        event: "call".into(),
        origin: if issue.is_some() { "issue" } else { "chat" }.into(),
        issue_key: issue.map(str::to_string),
        actor: "ana".into(),
        mode: "auto".into(),
        tool: Some("bash".into()),
        call: Some("toolu_1".into()),
        command: Some("git push".into()),
        verdict: Some("ask".into()),
        outcome: Some(outcome.into()),
        decided_by: Some("human:ana".into()),
        decided_at: Some(at + 5),
        ..Default::default()
    };
    s.record_audit(ROOT, &call(T0 + 2, Some(&k), "denied"))
        .unwrap();
    s.record_audit(ROOT, &call(T0 + 1, Some(&k), "allowed"))
        .unwrap();
    s.record_audit(ROOT, &call(T0 + 3, None, "allowed"))
        .unwrap();
    s.record_audit("/other", &call(T0, Some(&k), "allowed"))
        .unwrap();
    let of_issue = s.audit(ROOT, Some(&k)).unwrap();
    assert_eq!(
        of_issue
            .iter()
            .map(|e| e.outcome.clone().unwrap())
            .collect::<Vec<_>>(),
        ["allowed", "denied"]
    );
    assert_eq!(of_issue[0].decided_by.as_deref(), Some("human:ana"));
    assert_eq!(s.audit(ROOT, None).unwrap().len(), 3);
    // the export is JSON, camelCase
    let j = serde_json::to_value(&of_issue[0]).unwrap();
    assert_eq!(j["issueKey"], serde_json::json!(k));
    assert_eq!(j["decidedBy"], "human:ana");
}

#[test]
fn readiness_lists_what_is_missing_and_dependencies_must_be_done() {
    let mut s = store();
    let a = create(&mut s, "a", T0);
    let b = create(&mut s, "b", T0);
    s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "update_issue", "key": b, "deps": [a.clone(), "PRJ-404"], "scope": ["src/"]}))).unwrap();
    assert_eq!(
        s.apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "update_issue", "key": b, "deps": [b.clone()]}))
        )
        .unwrap_err()
        .code,
        "invalid"
    );
    let p = s.load(ROOT, T0).unwrap();
    let ib = p.issues.iter().find(|i| i.key == b).unwrap();
    assert!(
        ib.missing
            .iter()
            .any(|m| m == &format!("dependência {a} em Done")),
        "{:?}",
        ib.missing
    );
    assert!(ib.missing.iter().any(|m| m.contains("PRJ-404 não existe")));
    assert!(ib.missing.iter().any(|m| m == "critérios de aceitação"));
    assert!(!ib.missing.iter().any(|m| m.contains("âmbito")));
    assert_eq!(
        ib.missing.last().map(String::as_str),
        Some("aprovação humana (Ready)")
    );
    assert!(is_gwt(
        "Given a user, When she logs in, Then she sees the board"
    ));
    assert!(!is_gwt("works"));
}

#[test]
fn codev_answers_the_criteria_then_tests_send_it_back_and_twice_block_it() {
    let mut s = store();
    let k = create(&mut s, "x", T0);
    let p = s
        .apply(ROOT, "Co-Dev", T0, op(serde_json::json!({"op": "codev_finished", "key": k, "report": [{"criterion": 0, "met": true, "evidence": "test a"}], "template_version": "abc123"})))
        .unwrap();
    let i = p.issues.iter().find(|i| i.key == k).unwrap();
    assert_eq!(i.state, "review");
    assert_eq!(i.template_version.as_deref(), Some("abc123"));
    assert_eq!(i.criteria_report.as_ref().unwrap()[0]["met"], true);
    let fail = |s: &mut ProjectStore| {
        s.apply(ROOT, "Co-Dev", T0, op(serde_json::json!({"op": "tests_run", "key": k, "passed": false, "summary": "1 failed"}))).unwrap()
    };
    let p = fail(&mut s);
    let i = p.issues.iter().find(|i| i.key == k).unwrap();
    assert_eq!(
        (i.state.as_str(), i.attempts, i.blocked.is_none()),
        ("progress", 1, true)
    );
    let p = fail(&mut s);
    let i = p.issues.iter().find(|i| i.key == k).unwrap();
    assert_eq!(i.attempts, 2);
    assert!(i
        .blocked
        .as_deref()
        .unwrap()
        .starts_with("precisa de ajuda"));
    let p = s
        .apply(
            ROOT,
            "Co-Dev",
            T0,
            op(serde_json::json!({"op": "tests_run", "key": k, "passed": true})),
        )
        .unwrap();
    assert_eq!(p.issues.iter().find(|i| i.key == k).unwrap().attempts, 0);
}

#[test]
fn budgets_per_issue_and_sprint_and_what_codev_spent_from_the_audit_log() {
    let mut s = store();
    let p = s.apply(ROOT, "W", T0, op(serde_json::json!({"op": "create_sprint", "name": "S1", "start": T0, "end": T0 + 14 * 24 * H}))).unwrap();
    let sprint = p.sprints[0].id.clone();
    let a = create(&mut s, "a", T0);
    let b = create(&mut s, "b", T0);
    for k in [&a, &b] {
        s.apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "plan_issue", "key": k, "sprint": sprint})),
        )
        .unwrap();
    }
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "update_issue", "key": a, "budget_usd": 1.0})),
    )
    .unwrap();
    s.apply(
        ROOT,
        "W",
        T0,
        op(serde_json::json!({"op": "set_sprint_budget", "id": sprint, "budget_usd": 5.0})),
    )
    .unwrap();
    assert_eq!(
        s.apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "update_issue", "key": a, "budget_usd": -1.0}))
        )
        .unwrap_err()
        .code,
        "invalid"
    );
    let turn = |issue: &str, cost: f64| AuditEntry {
        at: T0,
        session: "cda".into(),
        event: "turn".into(),
        origin: "issue".into(),
        issue_key: Some(issue.into()),
        cost_usd: Some(cost),
        ..Default::default()
    };
    s.record_audit(ROOT, &turn(&a, 0.25)).unwrap();
    s.record_audit(ROOT, &turn(&a, 0.5)).unwrap();
    s.record_audit(ROOT, &turn(&b, 0.1)).unwrap();
    let p = s.load(ROOT, T0).unwrap();
    let ia = p.issues.iter().find(|i| i.key == a).unwrap();
    assert_eq!(ia.budget_usd, Some(1.0));
    assert!((ia.spent_usd - 0.75).abs() < 1e-9);
    assert_eq!(p.sprints[0].budget_usd, Some(5.0));
    assert!((p.sprints[0].spent_usd - 0.85).abs() < 1e-9);
    // removing the budget
    let p = s
        .apply(
            ROOT,
            "W",
            T0,
            op(serde_json::json!({"op": "update_issue", "key": a, "budget_usd": null})),
        )
        .unwrap();
    assert_eq!(
        p.issues.iter().find(|i| i.key == a).unwrap().budget_usd,
        None
    );
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

#[test]
fn breakpoints_are_kept_per_project_and_file() {
    use super::breakpoints::Breakpoint;
    let mut s = store();
    let bp = |line: u32, cond: Option<&str>| Breakpoint {
        file: "src/main.rs".into(),
        line,
        condition: cond.map(String::from),
        hit_condition: None,
        log_message: None,
        enabled: true,
        trigger: None,
        group: None,
    };
    s.save_breakpoints("/p", "src/main.rs", &[bp(3, None), bp(9, Some("i == 3"))])
        .unwrap();
    s.save_breakpoints(
        "/p",
        "src/lib.rs",
        &[Breakpoint {
            file: "src/lib.rs".into(),
            line: 1,
            condition: None,
            hit_condition: Some("2".into()),
            log_message: Some("x={x}".into()),
            enabled: false,
            trigger: Some("src/main.rs:3".into()),
            group: Some("eviction".into()),
        }],
    )
    .unwrap();
    s.save_breakpoints("/other", "src/main.rs", &[bp(1, None)])
        .unwrap();
    let all = s.breakpoints("/p").unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].file, "src/lib.rs");
    assert!(!all[0].enabled);
    assert_eq!(all[0].log_message.as_deref(), Some("x={x}"));
    assert_eq!(all[0].trigger.as_deref(), Some("src/main.rs:3"));
    assert_eq!(all[0].group.as_deref(), Some("eviction"));
    assert_eq!(all[2].condition.as_deref(), Some("i == 3"));
    // replacing a file's list; blank strings are not kept
    s.save_breakpoints("/p", "src/main.rs", &[bp(4, Some("  "))])
        .unwrap();
    let main: Vec<_> = s
        .breakpoints("/p")
        .unwrap()
        .into_iter()
        .filter(|b| b.file == "src/main.rs")
        .collect();
    assert_eq!(main.len(), 1);
    assert_eq!(main[0].condition, None);
}

#[test]
fn test_results_are_kept_per_commit_newest_first() {
    let d = tempfile::tempdir().unwrap();
    let mut st = ProjectStore::open(&d.path().join("p.sqlite3")).unwrap();
    let r = |sha: &str, at: i64, ok: bool| TestResult {
        sha: sha.into(),
        dirty: false,
        at,
        runner: "cargo".into(),
        command: "cargo test".into(),
        passed: 3,
        failed: if ok { 0 } else { 1 },
        ignored: 0,
        ok,
    };
    st.record_test_result("/p", &r("abcdef1234567890", 1, false))
        .unwrap();
    st.record_test_result("/p", &r("abcdef1234567890", 2, true))
        .unwrap();
    st.record_test_result("/p", &r("1111111222222", 3, true))
        .unwrap();
    st.record_test_result("/q", &r("abcdef1234567890", 4, true))
        .unwrap();
    let got = st.test_results_for("/p", &["abcdef1".into()]).unwrap();
    assert_eq!(
        got.iter().map(|x| (x.at, x.ok)).collect::<Vec<_>>(),
        vec![(2, true), (1, false)]
    );
    assert!(st
        .test_results_for("/p", &["abc".into(), "zzzzzzz".into()])
        .unwrap()
        .is_empty());
}

/// r23 F4b: an accepted IaC risk has a reason, lasts at most 30 days, and can be revoked.
#[test]
fn accepted_risks_expire_and_can_be_revoked() {
    let mut st = store();
    let day = 24 * H;
    assert!(st
        .accept_risk("/p", "k1", "finding", "x", " ", "Walter", T0, 30)
        .is_err());
    assert!(st
        .accept_risk("/p", "k1", "other", "x", "a reason", "Walter", T0, 30)
        .is_err());
    let a = st
        .accept_risk(
            "/p",
            "k1",
            "finding",
            "checkov CKV_X · main.tf:5",
            "fixture bucket",
            "Walter",
            T0,
            90,
        )
        .unwrap();
    assert_eq!(a.expires, T0 + 30 * day);
    st.accept_risk(
        "/p",
        "drift:infra:x.y",
        "drift",
        "x.y",
        "changed by the on-call",
        "Walter",
        T0 + 1,
        7,
    )
    .unwrap();
    st.accept_risk("/q", "k1", "finding", "x", "other folder", "Walter", T0, 30)
        .unwrap();
    let keys = |v: Vec<risks::AcceptedRisk>| v.into_iter().map(|r| r.key).collect::<Vec<_>>();
    assert_eq!(
        keys(st.accepted_risks("/p", T0 + day).unwrap()),
        vec!["drift:infra:x.y", "k1"]
    );
    assert_eq!(
        keys(st.accepted_risks("/p", T0 + 8 * day).unwrap()),
        vec!["k1"]
    );
    assert!(st.accepted_risks("/p", T0 + 30 * day).unwrap().is_empty());
    assert_eq!(
        st.revoke_risk("/p", a.id, T0 + day).unwrap().map(|r| r.key),
        Some("k1".into())
    );
    assert!(st.revoke_risk("/p", a.id, T0 + day).unwrap().is_none());
    assert_eq!(
        keys(st.accepted_risks("/p", T0 + 2 * day).unwrap()),
        vec!["drift:infra:x.y"]
    );
}

/// r23 F4c2: deploy records, per commit (prefixes of 7+) and all of them.
#[test]
fn deploy_records_per_commit() {
    let mut st = store();
    let rec = |env: &str, version: &str, at: i64, ok: bool| deploys::DeployRecord {
        env: env.into(),
        context: "kind-dev".into(),
        namespace: "shop".into(),
        version: version.into(),
        issue: Some("SHOP-7".into()),
        actor: "ana".into(),
        approver: None,
        at,
        ok,
        failed_step: (!ok).then(|| "rollout".into()),
        waivers: "[]".into(),
        gates: "{}".into(),
        reason: None,
        ..Default::default()
    };
    st.record_deploy("/p", &rec("staging", "abcdef1234567890", T0, true))
        .unwrap();
    st.record_deploy("/p", &rec("production", "abcdef1234567890", T0 + H, false))
        .unwrap();
    st.record_deploy("/p", &rec("staging", "1234567aaaa", T0 + 2 * H, true))
        .unwrap();
    st.record_deploy("/q", &rec("staging", "abcdef1234567890", T0, true))
        .unwrap();
    let mine = st.deploys("/p", Some(&["abcdef1".to_string()])).unwrap();
    assert_eq!(
        mine.iter()
            .map(|r| (r.env.as_str(), r.ok))
            .collect::<Vec<_>>(),
        vec![("production", false), ("staging", true)]
    );
    assert_eq!(mine[0].failed_step.as_deref(), Some("rollout"));
    assert!(st
        .deploys("/p", Some(&["abc".to_string()]))
        .unwrap()
        .is_empty());
    assert_eq!(st.deploys("/p", None).unwrap().len(), 3);
}

/// r23 F5a: runbook runs are kept (and a person's judgement), and the evidence file groups real rows by
/// ISO/IEC 27001 control — every control listed, «no records in this period» when empty.
#[test]
fn runbook_runs_and_the_evidence_file() {
    let mut st = store();
    let step = |run: &str, path: &str, rb: &str, n: u32, matched: Option<bool>, at: i64| {
        runbooks::RunbookStepRun {
            run_id: run.into(),
            path: path.into(),
            runbook: rb.into(),
            n,
            title: format!("step {n}"),
            kind: "check".into(),
            command: "kubectl get pods".into(),
            exit_code: Some(0),
            output: "web-1 Running".into(),
            expect: "`Running`".into(),
            matched,
            note: None,
            actor: "ana".into(),
            at,
            ms: 12,
            ..Default::default()
        }
    };
    st.record_runbook_step(
        "/p",
        &step(
            "r1",
            "runbooks/latency.md",
            "orders-api latency",
            1,
            Some(true),
            T0,
        ),
    )
    .unwrap();
    let id = st
        .record_runbook_step(
            "/p",
            &step(
                "r1",
                "runbooks/latency.md",
                "orders-api latency",
                2,
                None,
                T0 + 1,
            ),
        )
        .unwrap();
    st.record_runbook_step(
        "/p",
        &step(
            "r2",
            "runbooks/restore.md",
            "orders-db restore test",
            1,
            Some(false),
            T0 + 2,
        ),
    )
    .unwrap();
    assert!(st
        .judge_runbook_step("/p", id, true, "pool at 41 %")
        .unwrap());
    assert!(!st.judge_runbook_step("/q", id, true, "x").unwrap());
    let runs = st.runbook_runs("/p", None, T0, T0 + H).unwrap();
    assert_eq!(runs.len(), 3);
    assert_eq!(
        (runs[1].matched, runs[1].note.as_deref()),
        (Some(true), Some("pool at 41 %"))
    );
    assert_eq!(
        st.runbook_runs("/p", Some("runbooks/restore.md"), T0, T0 + H)
            .unwrap()
            .len(),
        1
    );

    let a = |tool: &str, call: &str, cmd: &str, at: i64| AuditEntry {
        at,
        origin: "ide".into(),
        actor: "ana".into(),
        tool: Some(tool.into()),
        call: Some(call.into()),
        command: Some(cmd.into()),
        outcome: Some("ok".into()),
        reason: Some("rotating".into()),
        ..AuditEntry::default()
    };
    let audit = vec![
        a(
            "vault",
            "reveal-local",
            "show secret/apps/shop/local/db DB_PASSWORD for 20 s",
            T0,
        ),
        a(
            "iac",
            "risk.accept",
            "checkov CKV_AWS_18 · main.tf:5 · 30 days",
            T0 + 1,
        ),
        a(
            "ops",
            "iac.apply",
            "cd infra && tofu apply -input=false /x.bin",
            T0 + 2,
        ),
        a("board", "move", "SHOP-1 to done", T0 + 3),
        a(
            "vault",
            "reveal-local",
            "outside the period",
            T0 + 40 * 24 * H,
        ),
        AuditEntry {
            origin: "chat".into(),
            at: T0,
            tool: Some("bash".into()),
            ..AuditEntry::default()
        },
    ];
    let deploys = vec![deploys::DeployRecord {
        env: "staging".into(),
        context: "kind-dev".into(),
        namespace: "shop".into(),
        version: "0123456789abcdef".into(),
        issue: Some("SHOP-7".into()),
        actor: "ana".into(),
        at: T0 + 4,
        ok: true,
        waivers: "[]".into(),
        gates: "{}".into(),
        ..Default::default()
    }];
    let md = evidence::markdown(
        "shop",
        T0 - H,
        T0 + 30 * 24 * H,
        T0 + 5,
        &audit,
        &deploys,
        &runs,
    );
    assert!(md.starts_with("# Evidence export — shop\n"));
    let section = |c: &str| {
        let i = md.find(&format!("## {c}")).unwrap();
        let rest = &md[i..];
        rest[..rest[3..].find("\n## ").map(|j| j + 3).unwrap_or(rest.len())].to_string()
    };
    assert!(
        section("A.8.32").contains("ops.iac.apply: cd infra && tofu apply")
            && section("A.8.32")
                .contains("deployed 0123456789ab to staging (kind-dev/shop) for SHOP-7 · ok")
    );
    assert!(section("A.8.32").contains("runbook «orders-api latency» (runbooks/latency.md): 2 step(s) with output — 2 as expected, 0 not, 0 not judged"));
    assert!(section("A.8.9").contains("iac.risk.accept"));
    assert!(section("A.5.17").contains("vault.reveal-local") && !md.contains("outside the period"));
    assert!(
        section("A.8.13").contains("orders-db restore test")
            && section("A.8.13").contains("0 as expected, 1 not")
    );
    assert!(section("A.5.24").contains("no records in this period"));
    assert!(section("Other IDE operations").contains("board.move: SHOP-1 to done"));
    assert!(!md.contains("bash"), "Co-Dev rows are not IDE operations");
    assert_eq!(evidence::day(T0), "2025-11-13");
}

/// r23 F5b: incidents (local records) with their timeline and rules, Co-Dev's precision, and the queue's events.
#[test]
fn incidents_and_the_queue() {
    let st = store();
    let c = st.conn();
    assert!(incidents::open(c, "/p", "x", "SEV-2", "ana", T0).is_err());
    assert!(incidents::open(c, "/p", "checkout latency", "SEV-9", "ana", T0).is_err());
    let i = incidents::open(
        c,
        "/p",
        "checkout latency above the SLO",
        "SEV-2",
        "ana",
        T0,
    )
    .unwrap();
    assert_eq!(
        (i.key.as_str(), i.status.as_str()),
        ("INC-1", "investigating")
    );
    assert_eq!(
        incidents::open(c, "/q", "other project", "SEV-3", "ana", T0)
            .unwrap()
            .key,
        "INC-1"
    );
    incidents::add(
        c,
        "/p",
        i.id,
        "evidence",
        "customers report timeouts since 10:30",
        None,
        "ana",
        T0 + 1,
    )
    .unwrap();
    incidents::add(
        c,
        "/p",
        i.id,
        "checked",
        "kubectl get pods: 3/3 ready",
        None,
        "ana",
        T0 + 2,
    )
    .unwrap();
    assert!(incidents::add(
        c,
        "/p",
        i.id,
        "not-checked",
        "database metrics",
        None,
        "ana",
        T0 + 3
    )
    .unwrap_err()
    .message
    .contains("reason"));
    incidents::add(
        c,
        "/p",
        i.id,
        "not-checked",
        "database metrics",
        Some("no metrics source connected"),
        "ana",
        T0 + 3,
    )
    .unwrap();
    assert!(incidents::add(c, "/p", i.id, "bogus", "x", None, "ana", T0).is_err());
    assert!(
        incidents::feedback(c, "/p", i.id, true, "ana", T0 + 4).is_err(),
        "only after mitigation"
    );
    assert!(
        incidents::set_status(c, "/p", i.id, "resolved", " ", "ana", T0 + 5).is_err(),
        "resolving needs a summary"
    );
    let m = incidents::set_status(
        c,
        "/p",
        i.id,
        "mitigated",
        "rolled back web to rev 3",
        "ana",
        T0 + 5,
    )
    .unwrap();
    assert_eq!(m.mitigated_at, Some(T0 + 5));
    incidents::feedback(c, "/p", i.id, true, "ana", T0 + 6).unwrap();
    assert!(
        incidents::feedback(c, "/p", i.id, false, "ana", T0 + 7).is_err(),
        "once"
    );
    let r = incidents::set_status(
        c,
        "/p",
        i.id,
        "resolved",
        "pool exhausted after the 1.4 deploy",
        "ana",
        T0 + 8,
    )
    .unwrap();
    assert_eq!(
        (r.status.as_str(), r.resolved_at),
        ("resolved", Some(T0 + 8))
    );
    assert!(incidents::set_status(c, "/p", i.id, "investigating", "", "ana", T0 + 9).is_err());
    assert!(incidents::add(c, "/p", i.id, "evidence", "late", None, "ana", T0 + 9).is_err());
    let (_, ev) = incidents::get(c, "/p", i.id).unwrap().unwrap();
    assert_eq!(
        ev.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
        vec![
            "status",
            "evidence",
            "checked",
            "not-checked",
            "status",
            "feedback",
            "status"
        ]
    );
    assert_eq!(incidents::precision(c, "/p").unwrap(), (1, 1));
    // confidence: never above «low» without a metrics source
    let low = incidents::confidence(&ev, false);
    assert_eq!(low.level, "low");
    assert!(low.reasons[0].contains("no metrics source"));
    assert_eq!(
        incidents::confidence(&ev, true).level,
        "medium",
        "a check was not run"
    );
    let e = |k: &str| incidents::IncidentEvent {
        kind: k.into(),
        ..Default::default()
    };
    assert_eq!(
        incidents::confidence(
            &[e("evidence"), e("checked"), e("checked"), e("checked")],
            true
        )
        .level,
        "high"
    );
    assert_eq!(incidents::confidence(&[], true).level, "low");
    assert_eq!(incidents::list(c, "/p").unwrap().len(), 1);
    // the queue: done with proof; a handover needs a recipient and a reason
    let q = |kind: &str, recipient: Option<&str>, reason: Option<&str>| incidents::QueueEvent {
        item: "pr:49".into(),
        kind: kind.into(),
        title: "Review PR #49".into(),
        recipient: recipient.map(String::from),
        reason: reason.map(String::from),
        actor: "ana".into(),
        at: T0,
        ..Default::default()
    };
    assert!(incidents::queue_event(c, "/p", &q("handover", None, Some("on leave"))).is_err());
    assert!(incidents::queue_event(c, "/p", &q("handover", Some("bruno"), Some(" "))).is_err());
    incidents::queue_event(
        c,
        "/p",
        &q("handover", Some("bruno"), Some("on leave until Monday")),
    )
    .unwrap();
    incidents::queue_event(
        c,
        "/p",
        &incidents::QueueEvent {
            proof: Some("ana reviewed: APPROVED".into()),
            ..q("done", None, None)
        },
    )
    .unwrap();
    assert_eq!(incidents::queue_events(c, "/p").unwrap().len(), 2);
}
