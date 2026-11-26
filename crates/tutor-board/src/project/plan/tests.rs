use super::*;

fn issue(key: &str, scope: &[&str]) -> PlanIssue {
    PlanIssue {
        key: key.into(),
        title: format!("title of {key}"),
        points: Some(3),
        priority: "medium".into(),
        rank: key
            .trim_start_matches(|c: char| !c.is_ascii_digit())
            .parse()
            .unwrap_or(0.0),
        state: "todo".into(),
        scope: scope.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }
}

fn files(f: &[&str]) -> Vec<String> {
    f.iter().map(|s| s.to_string()).collect()
}

fn states(p: &[&PlanIssue], done: &[&str]) -> HashMap<String, String> {
    let mut m: HashMap<String, String> =
        p.iter().map(|i| (i.key.clone(), i.state.clone())).collect();
    for d in done {
        m.insert(d.to_string(), "done".into());
    }
    m
}

fn plan(issues: &[PlanIssue], n: u32, f: &[&str]) -> SprintPlan {
    let st = states(&issues.iter().collect::<Vec<_>>(), &[]);
    plan_sprint(issues, &st, n, &files(f))
}

/// `lane → [key@wave]`, to read a plan at a glance.
fn lanes(p: &SprintPlan) -> Vec<Vec<String>> {
    p.lanes
        .iter()
        .map(|l| {
            l.issues
                .iter()
                .map(|i| format!("{}@{}", i.key, i.wave))
                .collect()
        })
        .collect()
}

fn wave(p: &SprintPlan, key: &str) -> u32 {
    p.lanes
        .iter()
        .flat_map(|l| &l.issues)
        .find(|i| i.key == key)
        .map(|i| i.wave)
        .unwrap_or(0)
}

fn reason<'a>(p: &'a SprintPlan, key: &str) -> Option<&'a LeftOut> {
    p.left_out.iter().find(|l| l.key == key)
}

const FILES: &[&str] = &[
    "Cargo.toml",
    "src/lib.rs",
    "src/cart/mod.rs",
    "src/cart/total.rs",
    "src/pay/mod.rs",
    "ui/app.ts",
    "ui/cart/view.ts",
    "docs/README.md",
];

#[test]
fn scope_globs_follow_the_codev_permissions() {
    assert!(scope_matches("src/**", "src/a/b.rs"));
    assert!(scope_matches("src/**", "src"));
    assert!(scope_matches("src/", "src/a.rs"));
    assert!(
        scope_matches("src", "src/a.rs"),
        "a literal folder covers what is under it"
    );
    assert!(!scope_matches("src", "srcx/a.rs"));
    assert!(scope_matches("Cargo.toml", "Cargo.toml"));
    assert!(scope_matches("./Cargo.toml", "Cargo.toml"));
    assert!(scope_matches("src/*.rs", "src/lib.rs"));
    assert!(
        !scope_matches("src/*.rs", "src/cart/mod.rs"),
        "`*` does not cross a folder"
    );
    assert!(
        scope_matches("src/**/*.rs", "src/lib.rs"),
        "`**/` is zero folders too"
    );
    assert!(scope_matches("src/**/*.rs", "src/cart/total.rs"));
    assert!(!scope_matches("src/**/*.rs", "src/cart/total.ts"));
    assert!(scope_matches("**/mod.rs", "src/cart/mod.rs"));
    assert!(scope_matches("**/mod.rs", "mod.rs"));
    assert!(
        scope_matches("src/**.rs", "src/cart/mod.rs"),
        "`**` without `/` is anything"
    );
    assert!(scope_matches("src/m?d.rs", "src/mod.rs"));
    assert!(!scope_matches("src/?", "src/ab"));
    assert!(!scope_matches("src/?", "src//"));
    assert!(scope_matches("src\\cart\\**", "src/cart/mod.rs"));
    assert!(!scope_matches("", "src/lib.rs"));
    assert!(!scope_matches("  ", "src/lib.rs"));
    // no blow-up on a pathological glob
    assert!(!scope_matches("*a*a*a*a*a*a*a*a*a*a*b", &"a".repeat(200)));
}

#[test]
fn disjoint_issues_run_side_by_side_balanced_by_points() {
    let mut a = issue("P-1", &["src/cart/**"]);
    a.points = Some(8);
    let mut b = issue("P-2", &["src/pay/**"]);
    b.points = Some(5);
    let mut c = issue("P-3", &["ui/**"]);
    c.points = Some(3);
    let mut d = issue("P-4", &["docs/**"]);
    d.points = Some(2);
    let p = plan(&[a, b, c, d], 2, FILES);
    assert_eq!(p.codevs, 2);
    assert!(p.left_out.is_empty() && p.overlaps.is_empty(), "{p:?}");
    // wave 1: the two first by priority/rank; wave 2: the heavier goes to the lighter lane
    assert_eq!(
        lanes(&p),
        vec![vec!["P-1@1", "P-4@2"], vec!["P-2@1", "P-3@2"]]
    );
    assert_eq!(p.waves, 2);
    assert_eq!((p.lanes[0].points, p.lanes[1].points), (10, 8));
    assert_eq!(p.files, FILES.len() as u32);
}

#[test]
fn overlapping_issues_never_share_a_wave() {
    // P-1 and P-2 both reach src/cart/total.rs; P-3 is apart
    let p = plan(
        &[
            issue("P-1", &["src/cart/**"]),
            issue("P-2", &["src/**/total.rs", "ui/cart/**"]),
            issue("P-3", &["src/pay/**"]),
        ],
        3,
        FILES,
    );
    assert_eq!(wave(&p, "P-1"), 1);
    assert_eq!(
        wave(&p, "P-3"),
        1,
        "the next issue that does not overlap takes the free lane"
    );
    assert_eq!(
        wave(&p, "P-2"),
        2,
        "serialised behind the issue it overlaps with"
    );
    let p2 = p
        .lanes
        .iter()
        .flat_map(|l| &l.issues)
        .find(|i| i.key == "P-2")
        .unwrap();
    assert_eq!(p2.serialised_after, vec!["P-1"]);
    assert_eq!(p.overlaps.len(), 1);
    let o = &p.overlaps[0];
    assert_eq!((o.a.as_str(), o.b.as_str()), ("P-1", "P-2"));
    assert_eq!(o.paths, vec!["src/cart/total.rs"]);
    assert_eq!(o.total, 1);
    assert_eq!(
        o.globs,
        vec![["src/cart/**".to_string(), "src/**/total.rs".to_string()]]
    );
}

#[test]
fn a_literal_scope_entry_counts_even_before_the_file_exists() {
    let p = plan(
        &[issue("P-1", &["src/new.rs"]), issue("P-2", &["src/**"])],
        2,
        FILES,
    );
    assert_eq!(p.overlaps.len(), 1);
    assert!(p.overlaps[0].paths.contains(&"src/new.rs".to_string()));
    assert_ne!(wave(&p, "P-1"), wave(&p, "P-2"));
    // two wildcard globs that would only meet on files that do not exist: not detected (documented)
    let q = plan(
        &[issue("P-1", &["src/*.go"]), issue("P-2", &["src/a*"])],
        2,
        FILES,
    );
    assert!(q.overlaps.is_empty());
}

#[test]
fn known_files_make_issues_overlap_outside_their_globs() {
    let mut a = issue("P-1", &["src/cart/**"]);
    a.known_files = vec!["Cargo.toml".into()];
    let mut b = issue("P-2", &["Cargo.toml"]);
    b.points = Some(1);
    let mut c = issue("P-3", &["docs/**"]);
    c.known_files = vec!["src/cart/total.rs".into()];
    let p = plan(&[a, b, c], 3, FILES);
    let pairs: Vec<(String, String, Vec<String>)> = p
        .overlaps
        .iter()
        .map(|o| (o.a.clone(), o.b.clone(), o.paths.clone()))
        .collect();
    assert_eq!(
        pairs,
        vec![
            ("P-1".into(), "P-2".into(), vec!["Cargo.toml".to_string()]),
            (
                "P-1".into(),
                "P-3".into(),
                vec!["src/cart/total.rs".to_string()]
            ),
        ]
    );
    assert_eq!(
        p.overlaps[0].globs,
        vec![["known".to_string(), "Cargo.toml".to_string()]]
    );
    // P-2 and P-3 do not overlap with each other: both go in wave 2
    assert_eq!(
        (wave(&p, "P-1"), wave(&p, "P-2"), wave(&p, "P-3")),
        (1, 2, 2)
    );
}

#[test]
fn branch_conflicts_count_as_known_files_and_are_shown() {
    let mut a = issue("P-1", &["docs/**"]);
    a.branch_conflicts = vec!["src/lib.rs".into()];
    let b = issue("P-2", &["src/*.rs"]);
    let p = plan(&[a, b], 2, FILES);
    assert_eq!(p.overlaps.len(), 1);
    let p1 = p
        .lanes
        .iter()
        .flat_map(|l| &l.issues)
        .find(|i| i.key == "P-1")
        .unwrap();
    assert_eq!(p1.branch_conflicts, vec!["src/lib.rs"]);
}

#[test]
fn dependencies_make_waves() {
    let a = issue("P-1", &["src/cart/**"]);
    let mut b = issue("P-2", &["src/pay/**"]);
    b.deps = vec!["P-1".into()];
    let mut c = issue("P-3", &["ui/**"]);
    c.deps = vec!["P-2".into()];
    let d = issue("P-4", &["docs/**"]);
    let p = plan(&[a, b, c, d], 4, FILES);
    assert_eq!(
        (
            wave(&p, "P-1"),
            wave(&p, "P-2"),
            wave(&p, "P-3"),
            wave(&p, "P-4")
        ),
        (1, 2, 3, 1)
    );
    assert_eq!(p.waves, 3);
    let p3 = p
        .lanes
        .iter()
        .flat_map(|l| &l.issues)
        .find(|i| i.key == "P-3")
        .unwrap();
    assert_eq!(p3.after, vec!["P-2"]);
}

#[test]
fn a_dependency_done_outside_the_sprint_does_not_hold_the_issue() {
    let mut a = issue("P-1", &["src/**"]);
    a.deps = vec!["P-9".into()];
    let st = states(&[&a], &["P-9"]);
    let p = plan_sprint(&[a], &st, 1, &files(FILES));
    assert_eq!(wave(&p, "P-1"), 1);
    assert!(p.lanes[0].issues[0].after.is_empty());
}

#[test]
fn what_does_not_go_in_says_why() {
    let mut not_ready = issue("P-1", &["src/**"]);
    not_ready.missing = vec!["critérios de aceitação".into()];
    let mut flow = issue("P-2", &["src/pay/**"]);
    flow.state = "progress".into();
    let mut overlaps_flow = issue("P-3", &["src/pay/mod.rs"]);
    overlaps_flow.points = Some(1);
    let mut blocked = issue("P-4", &["docs/**"]);
    blocked.deps = vec!["P-1".into()];
    let mut unknown = issue("P-5", &["ui/**"]);
    unknown.deps = vec!["P-77".into()];
    let mut outside = issue("P-6", &["Cargo.toml"]);
    outside.deps = vec!["P-8".into()];
    let mut done = issue("P-7", &["src/**"]);
    done.state = "done".into();
    let mut later = issue("P-9", &["ui/cart/**"]);
    later.deps = vec!["P-5".into()];
    let ok = issue("P-10", &["src/cart/**"]);
    let all = vec![
        not_ready,
        flow,
        overlaps_flow,
        blocked,
        unknown,
        outside,
        done,
        later,
        ok,
    ];
    let mut st = states(&all.iter().collect::<Vec<_>>(), &[]);
    st.insert("P-8".into(), "review".into());
    let p = plan_sprint(&all, &st, 2, &files(FILES));
    let r = |k: &str| reason(&p, k).map(|l| (l.reason.clone(), l.keys.clone(), l.missing.clone()));
    assert_eq!(
        r("P-1"),
        Some((
            "not_ready".into(),
            vec![],
            vec!["critérios de aceitação".into()]
        ))
    );
    assert_eq!(
        r("P-2"),
        Some(("in_flow".into(), vec!["progress".into()], vec![]))
    );
    assert_eq!(
        r("P-3"),
        Some(("overlaps_in_flow".into(), vec!["P-2".into()], vec![]))
    );
    assert_eq!(
        r("P-4"),
        Some(("blocked_by_deps".into(), vec!["P-1".into()], vec![]))
    );
    assert_eq!(
        r("P-5"),
        Some(("blocked_by_deps".into(), vec!["P-77".into()], vec![]))
    );
    assert_eq!(
        r("P-6"),
        Some(("blocked_by_deps".into(), vec!["P-8".into()], vec![]))
    );
    assert_eq!(
        r("P-7"),
        None,
        "a done issue is neither planned nor left out"
    );
    assert_eq!(
        r("P-9"),
        Some(("blocked_by_deps".into(), vec!["P-5".into()], vec![])),
        "a dependency left out holds its dependents"
    );
    assert_eq!(lanes(&p), vec![vec!["P-10@1"], vec![]]);
    // the overlap with the issue in the flow is listed
    assert!(p
        .overlaps
        .iter()
        .any(|o| o.a == "P-3" && o.b == "P-2" && o.paths == vec!["src/pay/mod.rs".to_string()]));
}

#[test]
fn a_dependency_cycle_is_left_out() {
    let mut a = issue("P-1", &["src/cart/**"]);
    a.deps = vec!["P-2".into()];
    let mut b = issue("P-2", &["src/pay/**"]);
    b.deps = vec!["P-1".into()];
    let c = issue("P-3", &["docs/**"]);
    let p = plan(&[a, b, c], 2, FILES);
    assert_eq!(lanes(&p), vec![vec!["P-3@1"], vec![]]);
    assert_eq!(p.waves, 1);
    assert_eq!(
        reason(&p, "P-1").map(|l| (l.reason.as_str(), l.keys.clone())),
        Some(("dep_cycle", vec!["P-2".to_string()]))
    );
    assert_eq!(
        reason(&p, "P-2").map(|l| l.reason.as_str()),
        Some("dep_cycle")
    );
}

#[test]
fn priority_then_rank_decide_who_goes_first() {
    let mut low = issue("P-1", &["src/**"]);
    low.priority = "low".into();
    let mut high = issue("P-2", &["src/lib.rs"]);
    high.priority = "high".into();
    let p = plan(&[low, high], 2, FILES);
    assert_eq!((wave(&p, "P-2"), wave(&p, "P-1")), (1, 2));
}

#[test]
fn one_codev_runs_everything_in_order_and_the_count_is_clamped() {
    let is = vec![
        issue("P-1", &["src/cart/**"]),
        issue("P-2", &["src/pay/**"]),
        issue("P-3", &["ui/**"]),
    ];
    let p = plan(&is, 1, FILES);
    assert_eq!(lanes(&p), vec![vec!["P-1@1", "P-2@2", "P-3@3"]]);
    assert_eq!(plan(&is, 0, FILES).codevs, 1);
    assert_eq!(plan(&is, 99, FILES).codevs, MAX_CODEVS);
    assert_eq!(plan(&is, 99, FILES).lanes.len(), MAX_CODEVS as usize);
}

#[test]
fn unestimated_issues_weigh_one_and_are_counted() {
    let mut a = issue("P-1", &["src/cart/**"]);
    a.points = None;
    let p = plan(&[a, issue("P-2", &["src/pay/**"])], 2, FILES);
    // the estimated one is heavier: it takes the first lane
    assert_eq!((p.lanes[0].points, p.lanes[0].unestimated), (3, 0));
    assert_eq!((p.lanes[1].points, p.lanes[1].unestimated), (0, 1));
}

#[test]
fn the_plan_is_deterministic() {
    let mk = || {
        let mut v = vec![];
        for k in 1..=12 {
            let mut i = issue(
                &format!("P-{k}"),
                &[[
                    "src/cart/**",
                    "src/pay/**",
                    "ui/**",
                    "docs/**",
                    "Cargo.toml",
                ][k % 5]],
            );
            i.points = Some((k as u32 * 7) % 5 + 1);
            if k % 4 == 0 {
                i.deps = vec![format!("P-{}", k - 1)];
            }
            v.push(i);
        }
        v
    };
    let a = plan(&mk(), 3, FILES);
    let mut rev = mk();
    rev.reverse();
    let b = plan(&rev, 3, FILES);
    assert_eq!(a, b, "the input order does not matter");
    // and every pair in one wave is disjoint, every dependency ran earlier
    let all: Vec<&PlannedIssue> = a.lanes.iter().flat_map(|l| &l.issues).collect();
    assert_eq!(all.len(), 12);
    for x in &all {
        for y in &all {
            if x.key != y.key && x.wave == y.wave {
                assert!(
                    !a.overlaps
                        .iter()
                        .any(|o| (o.a == x.key && o.b == y.key) || (o.a == y.key && o.b == x.key)),
                    "{} and {} share wave {}",
                    x.key,
                    y.key,
                    x.wave
                );
            }
        }
        for d in &x.after {
            assert!(wave(&a, d) < x.wave);
        }
    }
    // each lane takes at most one issue per wave, in wave order
    for l in &a.lanes {
        let w: Vec<u32> = l.issues.iter().map(|i| i.wave).collect();
        assert!(w.windows(2).all(|p| p[0] < p[1]), "{w:?}");
    }
}

#[test]
fn many_overlapping_paths_are_capped_but_counted() {
    let many: Vec<String> = (0..50).map(|k| format!("src/gen/f{k:02}.rs")).collect();
    let p = plan_sprint(
        &[
            issue("P-1", &["src/gen/**"]),
            issue("P-2", &["src/**/*.rs"]),
        ],
        &HashMap::new(),
        2,
        &many,
    );
    assert_eq!(p.overlaps[0].total, 50);
    assert_eq!(p.overlaps[0].paths.len(), MAX_PATHS);
    assert_eq!(p.overlaps[0].paths[0], "src/gen/f00.rs");
}

// ───── from the store ─────

const ROOT: &str = "/home/u/shop";
const T0: i64 = 1_763_000_000_000;

fn apply(
    s: &mut super::super::ProjectStore,
    v: serde_json::Value,
) -> Result<super::super::Project, super::super::ProjectError> {
    s.apply(ROOT, "Walter", T0, serde_json::from_value(v).unwrap())
}

#[test]
fn the_sprint_keeps_its_codevs_and_the_source_comes_from_the_store() {
    let mut s = super::super::ProjectStore::in_memory().unwrap();
    let p = apply(&mut s, serde_json::json!({"op": "create_sprint", "name": "S1", "start": T0, "end": T0 + 86_400_000})).unwrap();
    let sid = p.sprints[0].id.clone();
    assert_eq!(p.sprints[0].codevs, None);
    let p = apply(
        &mut s,
        serde_json::json!({"op": "set_sprint_codevs", "id": sid, "codevs": 3}),
    )
    .unwrap();
    assert_eq!(p.sprints[0].codevs, Some(3));
    for bad in [0, MAX_CODEVS + 1] {
        let e = apply(
            &mut s,
            serde_json::json!({"op": "set_sprint_codevs", "id": sid, "codevs": bad}),
        )
        .unwrap_err();
        assert_eq!(e.code, "invalid");
    }
    assert_eq!(
        apply(
            &mut s,
            serde_json::json!({"op": "set_sprint_codevs", "id": "nope", "codevs": 2})
        )
        .unwrap_err()
        .code,
        "not_found"
    );
    let p = apply(
        &mut s,
        serde_json::json!({"op": "set_sprint_codevs", "id": sid, "codevs": null}),
    )
    .unwrap();
    assert_eq!(p.sprints[0].codevs, None);

    // two issues in the sprint, the second depends on the first; one in the backlog
    let p = apply(&mut s, serde_json::json!({"op": "create_issue", "title": "Cart", "sprint": sid, "acceptance": ["Given a cart When I add Then it counts"]})).unwrap();
    let a = p.issues.last().unwrap().key.clone();
    let p = apply(
        &mut s,
        serde_json::json!({"op": "create_issue", "title": "Pay", "sprint": sid}),
    )
    .unwrap();
    let b = p.issues.last().unwrap().key.clone();
    apply(
        &mut s,
        serde_json::json!({"op": "create_issue", "title": "Later"}),
    )
    .unwrap();
    apply(&mut s, serde_json::json!({"op": "update_issue", "key": a, "scope": ["src/cart/**"], "branch": "feature/cart"})).unwrap();
    apply(
        &mut s,
        serde_json::json!({"op": "update_issue", "key": b, "deps": [a], "scope": ["src/pay/**"]}),
    )
    .unwrap();
    s.conn()
        .execute(
            "INSERT INTO change_sets (root, session, call, hunk, path, start, end_line, added, removed, decided_by, decided_at, issue_key)
             VALUES (?1, 's', 'c', 'h', 'Cargo.toml', 1, 2, 1, 0, 'Walter', ?2, ?3)",
            rusqlite::params![ROOT, T0, a],
        )
        .unwrap();
    apply(&mut s, serde_json::json!({"op": "link_commits", "commits": [{"hash": "abc1234", "subject": format!("{a}: start"), "at": T0}]})).unwrap();

    let src = s.plan_source(ROOT, None, T0).unwrap();
    assert_eq!(
        src.sprint.id, sid,
        "without an active sprint, the next planned one"
    );
    assert_eq!(
        src.issues.iter().map(|i| i.key.clone()).collect::<Vec<_>>(),
        vec![a.clone(), b.clone()]
    );
    let ia = &src.issues[0];
    assert_eq!(ia.known_files, vec!["Cargo.toml"]);
    assert!(
        !ia.missing.iter().any(|m| m.contains("âmbito")),
        "{:?}",
        ia.missing
    );
    let ib = &src.issues[1];
    assert!(
        !ib.missing.iter().any(|m| m.contains("dependência")),
        "its dependencies are not a reason here: {:?}",
        ib.missing
    );
    assert!(ib.missing.iter().any(|m| m.contains("critérios")));
    assert_eq!(
        src.branches.get(&a).map(String::as_str),
        Some("feature/cart")
    );
    assert_eq!(src.commits.get(&a), Some(&vec!["abc1234".to_string()]));
    assert_eq!(src.states.len(), 3);
    assert_eq!(
        s.plan_source(ROOT, Some("nope"), T0).unwrap_err().code,
        "not_found"
    );
    assert_eq!(
        s.plan_source("/other", None, T0).unwrap_err().code,
        "not_found"
    );
}
