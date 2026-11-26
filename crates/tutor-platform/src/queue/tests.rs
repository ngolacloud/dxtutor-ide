use super::*;
use std::path::PathBuf;

#[test]
fn codeowners_rules() {
    for (pat, path, yes) in [
        ("*.tf", "infra/main.tf", true),
        ("*.tf", "infra/main.tfvars", false),
        ("/infra/", "infra/live/main.tf", true),
        ("/infra/", "app/infra/x", false),
        ("infra/", "app/infra/x.tf", true),
        ("docs/*", "docs/a.md", true),
        ("docs/*", "docs/sub/a.md", false),
        ("infra/**", "infra/a/b/c.tf", true),
        ("Dockerfile", "web/Dockerfile", true),
        ("*", "anything/at/all", true),
    ] {
        assert_eq!(owns(pat, path), yes, "{pat} vs {path}");
    }
    let rules = vec![
        ("*".to_string(), vec!["@team".to_string()]),
        ("*.tf".to_string(), vec!["@ana".to_string()]),
    ];
    assert_eq!(owners_of(&rules, "infra/main.tf").unwrap().1, vec!["@ana"]);
    assert_eq!(owners_of(&rules, "README.md").unwrap().1, vec!["@team"]);
}

fn rb(path: &str, schedule: Option<&str>) -> Runbook {
    let mut r = crate::runbook::parse(path, "# restore\n\n## 1. a [check]\n```\nls\n```\nexpect: `x`\n\n## 2. b [decision]\nexpect: y\n", Path::new("/tmp"));
    r.schedule = schedule.map(String::from);
    r
}

fn run(
    run: &str,
    path: &str,
    n: u32,
    kind: &str,
    matched: Option<bool>,
    at: i64,
) -> RunbookStepRun {
    RunbookStepRun {
        run_id: run.into(),
        path: path.into(),
        n,
        kind: kind.into(),
        matched,
        actor: "ana".into(),
        at,
        ..Default::default()
    }
}

#[test]
fn a_recurring_runbook_is_due_until_a_complete_run() {
    let r = rb("runbooks/restore.md", Some("monthly"));
    assert_eq!(cadence_days("Monthly"), Some(30));
    assert_eq!(cadence_days("sometimes"), None);
    let runs = vec![
        run("a", "runbooks/restore.md", 1, "check", Some(true), 10),
        run("b", "runbooks/restore.md", 1, "check", Some(false), 20),
        run("b", "runbooks/restore.md", 2, "decision", None, 21),
        run("a", "runbooks/restore.md", 2, "decision", None, 11),
        run("c", "runbooks/restore.md", 1, "check", Some(true), 30),
    ];
    assert_eq!(r.steps.len(), 2);
    assert_eq!(
        complete_runs(&r, &runs),
        vec![("a", 11)],
        "b failed a check, c is unfinished"
    );
    let empty = crate::runbook::parse("runbooks/e.md", "# empty\n", Path::new("/tmp"));
    assert!(
        complete_runs(&empty, &runs).is_empty(),
        "a runbook without steps is never complete"
    );
}

/// The queue end to end, in a real git repository: a blocking IaC finding in a file I changed, a recurring
/// runbook, an incident I command and my failed deploy — each verified done from the real state, and an item
/// handed over leaves my queue.
#[test]
fn the_queue_from_real_state() {
    let d = tempfile::tempdir().unwrap();
    let root: PathBuf = d.path().into();
    let git = |args: &[&str]| {
        assert!(
            Command::new("git")
                .args(args)
                .current_dir(&root)
                .output()
                .unwrap()
                .status
                .success(),
            "git {args:?}"
        )
    };
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.email", "ana@example.com"]);
    git(&["config", "user.name", "ana"]);
    std::fs::create_dir_all(root.join("infra")).unwrap();
    std::fs::create_dir_all(root.join("runbooks")).unwrap();
    std::fs::write(
        root.join("infra/main.tf"),
        "resource \"aws_db_instance\" \"main\" {\n  password = var.db_password\n}\n",
    )
    .unwrap();
    std::fs::write(
        root.join("runbooks/restore.md"),
        "# restore test\n\nschedule: monthly\n\n## 1. list [check]\n```\nls\n```\nexpect: `x`\n",
    )
    .unwrap();
    git(&["add", "."]);
    git(&["commit", "-qm", "feat: db"]);
    let cmd = |p: &str| Command::new(p);
    let has = |p: &str| p == "git";
    let inc = Incident {
        id: 7,
        key: "INC-1".into(),
        title: "checkout latency".into(),
        severity: "SEV-2".into(),
        status: "mitigated".into(),
        commander: "ana".into(),
        opened_at: 0,
        ..Default::default()
    };
    let failed = DeployRecord {
        env: "staging".into(),
        context: "kind".into(),
        namespace: "shop".into(),
        version: "abc".into(),
        actor: "ana".into(),
        at: 5,
        ok: false,
        failed_step: Some("rollout".into()),
        ..Default::default()
    };
    let accepted = HashSet::new();
    let events = vec![];
    let ctx = |incidents: &'static [Incident],
               deploys: &'static [DeployRecord],
               runs: &'static [RunbookStepRun],
               events: &'static [QueueEvent]| Ctx {
        root: Box::leak(root.clone().into_boxed_path()),
        cmd: &cmd,
        has: &has,
        runs,
        incidents,
        deploys,
        events,
        accepted: Box::leak(Box::new(accepted.clone())),
        precision: (1, 2),
        now: 100 * 86_400_000,
    };
    let leak = |v: Vec<Incident>| -> &'static [Incident] { Box::leak(v.into_boxed_slice()) };
    let leakd =
        |v: Vec<DeployRecord>| -> &'static [DeployRecord] { Box::leak(v.into_boxed_slice()) };
    let q = build(&ctx(
        leak(vec![inc.clone()]),
        leakd(vec![failed.clone()]),
        &[],
        Box::leak(events.clone().into_boxed_slice()),
    ));
    assert_eq!(q.me.name, "ana");
    let ids: Vec<&str> = q.items.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "iac:infra/main.tf",
            "recurring:runbooks/restore.md",
            "incident:7",
            "deploy:staging"
        ]
    );
    let iac = &q.items[0];
    assert_eq!(
        (iac.action.as_str(), iac.arg.as_str(), iac.line),
        ("open-file", "infra/main.tf", 2)
    );
    assert!(iac.why.contains("you changed this file") && iac.why.contains("secret-argument"));
    assert!(
        q.missing.iter().any(|m| m.contains("gh is not installed"))
            && q.missing.iter().any(|m| m.contains("on-call"))
    );
    assert!(q
        .measured
        .iter()
        .any(|(k, v)| k == "codevConfirmed" && v == "1/2"));
    // fix the finding, resolve the incident, a later deploy succeeds, a complete run: every item verifies done
    std::fs::write(
        root.join("infra/main.tf"),
        "resource \"aws_db_instance\" \"main\" {\n  password_wo = var.db_password\n}\n",
    )
    .unwrap();
    let resolved = Incident {
        status: "resolved".into(),
        resolved_at: Some(9),
        ..inc
    };
    let ok = DeployRecord {
        at: 6,
        ok: true,
        ..failed
    };
    let runs: &'static [RunbookStepRun] = Box::leak(
        vec![run(
            "r1",
            "runbooks/restore.md",
            1,
            "check",
            Some(true),
            99 * 86_400_000,
        )]
        .into_boxed_slice(),
    );
    let c = ctx(
        leak(vec![resolved]),
        leakd(vec![failed_again(), ok]),
        runs,
        &[],
    );
    let q = build(&c);
    assert!(q.items.is_empty(), "{:#?}", q.items);
    let me = me(&c);
    let rbs = crate::runbook::list(c.root);
    assert_eq!(
        verify(&c, &me, &rbs, "iac:infra/main.tf").as_deref(),
        Some("no blocking finding left in infra/main.tf")
    );
    assert_eq!(
        verify(&c, &me, &rbs, "incident:7").as_deref(),
        Some("INC-1 resolved")
    );
    assert_eq!(
        verify(&c, &me, &rbs, "deploy:staging").as_deref(),
        Some("deployed abc to staging")
    );
    assert!(verify(&c, &me, &rbs, "recurring:runbooks/restore.md")
        .unwrap()
        .starts_with("run r1 complete"));
    // a handed-over item leaves my queue (and shows in Team)
    std::fs::write(
        root.join("infra/main.tf"),
        "resource \"aws_db_instance\" \"main\" {\n  password = var.x\n}\n",
    )
    .unwrap();
    let ev: &'static [QueueEvent] = Box::leak(
        vec![QueueEvent {
            item: "iac:infra/main.tf".into(),
            kind: "handover".into(),
            title: "x".into(),
            recipient: Some("bruno".into()),
            reason: Some("his module".into()),
            actor: "ana".into(),
            at: 1,
            ..Default::default()
        }]
        .into_boxed_slice(),
    );
    let q = build(&ctx(&[], &[], runs, ev));
    assert!(q.items.iter().all(|i| i.id != "iac:infra/main.tf"));
    assert_eq!(q.team[0].recipient.as_deref(), Some("bruno"));
}

fn failed_again() -> DeployRecord {
    DeployRecord {
        env: "staging".into(),
        version: "abc".into(),
        actor: "ana".into(),
        at: 5,
        ok: false,
        ..Default::default()
    }
}
