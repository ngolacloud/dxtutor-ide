use super::*;
use crate::policy::read_only;

const LATENCY: &str = "# orders-api: latency above the SLO

Owner: Orders · on-call: Walter
schedule: weekly

## 1. List the pods [check]
```sh
kubectl -n shop get pods -o wide
```
expect: `Running`

## 2. Read the logs of the last hour [check]
```sh
kubectl -n shop logs deploy/orders-api --since=1h | grep -c ERROR
```
expect: /^[0-9]+$/

## 3. Return to the desired state [action]
```sh
argocd app sync shop --prune
```
expect: Synced and Healthy

## 4. Page the database team? [decision]
expect: decided with the on-call

## 5. Restart the pods [check]
```sh
kubectl -n shop rollout restart deploy/orders-api
```
expect: restarted
";

#[test]
fn parses_the_grammar() {
    let root = Path::new("/tmp");
    let rb = parse("runbooks/orders-api-latency.md", LATENCY, root);
    assert_eq!(rb.title, "orders-api: latency above the SLO");
    assert_eq!(rb.schedule.as_deref(), Some("weekly"));
    assert_eq!(rb.about[0], "Owner: Orders · on-call: Walter");
    assert_eq!(
        rb.steps.iter().map(|s| (s.n, s.kind)).collect::<Vec<_>>(),
        vec![
            (1, Kind::Check),
            (2, Kind::Check),
            (3, Kind::Action),
            (4, Kind::Decision),
            (5, Kind::Check)
        ]
    );
    assert_eq!(rb.steps[0].command, "kubectl -n shop get pods -o wide");
    assert_eq!(rb.steps[2].expect, "Synced and Healthy");
    assert!(
        rb.steps[0].refused.is_none() && rb.steps[1].refused.is_none(),
        "{:?} / {:?}",
        rb.steps[0].refused,
        rb.steps[1].refused
    );
    // a «check» that changes something is refused: it must be an action
    assert!(
        rb.steps[4]
            .refused
            .as_deref()
            .unwrap()
            .starts_with("not_read_only"),
        "{:?}",
        rb.steps[4]
    );
    assert!(rb.problems.is_empty(), "{:?}", rb.problems);
    let bad = parse(
        "runbooks/x.md",
        "# x\n\n## 1. a [check]\nexpect: y\n\n## 3. b [action]\n```\nls\n```\n```\npwd\n```\n",
        root,
    );
    assert_eq!(
        bad.problems,
        vec![
            "step 1 has no command",
            "step 3 has 2 command blocks: only the first runs",
            "step 3 follows step 1"
        ]
    );
    assert_eq!(bad.steps[1].command, "ls");
}

/// r23 F5 acceptance: a check that is not read-only is refused — here, in Rust — and an action needs an
/// approval.
#[test]
fn the_rule_refuses_what_is_not_read_only() {
    let root = Path::new("/tmp");
    let rb = parse("runbooks/orders-api-latency.md", LATENCY, root);
    assert!(may_run(&rb.steps[0], false).is_ok());
    assert!(may_run(&rb.steps[4], true)
        .unwrap_err()
        .starts_with("not_read_only"));
    assert_eq!(
        may_run(&rb.steps[2], false).unwrap_err(),
        "an action runs only with an approval"
    );
    assert!(may_run(&rb.steps[2], true).is_ok());
    assert!(may_run(&rb.steps[3], true).is_err());
    for ok in [
        "kubectl -n shop get deploy",
        "kubectl logs deploy/web --since=1h | grep -c ERROR",
        "aws ec2 describe-instances --region eu-west-1",
        "aws sts get-caller-identity",
        "tofu plan -no-color",
        "gh pr list --state open",
        "vault kv metadata get -mount=secret apps/shop/production/db",
        "curl -s https://status.example.com/health",
        "kubectl get pods 2>/dev/null || echo none",
        "dig +short example.com",
        "psql \"$URL\" -c \"select count(*) from orders\"",
    ] {
        assert!(
            read_only(ok, root).is_ok(),
            "{ok}: {:?}",
            read_only(ok, root)
        );
    }
    for bad in [
        "kubectl delete pod web-1",
        "kubectl get pods > pods.txt",
        "kubectl get secret db -o yaml",
        "aws secretsmanager get-secret-value --secret-id db",
        "aws ec2 terminate-instances --instance-ids i-1",
        "vault kv get secret/apps/shop/production/db",
        "tofu apply -auto-approve",
        "curl -X POST https://example.com/deploy",
        "rm -rf /tmp/x",
        "kubectl get pods; kubectl scale deploy/web --replicas=0",
        "psql \"$URL\" -c \"delete from orders\"",
        "sh ./fix.sh",
    ] {
        assert!(read_only(bad, root).is_err(), "{bad} should be refused");
    }
}

#[test]
fn runs_a_step_and_checks_the_expectation() {
    let d = tempfile::tempdir().unwrap();
    let sh = |p: &str| Command::new(p);
    let step = |cmd: &str, expect: &str| Step {
        n: 1,
        title: "t".into(),
        kind: Kind::Check,
        command: cmd.into(),
        expect: expect.into(),
        refused: None,
    };
    let ok = run(
        &sh,
        d.path(),
        &step("echo Synced; echo Healthy", "`Synced`"),
        &[],
        Duration::from_secs(10),
    );
    assert_eq!((ok.exit_code, ok.matched), (0, Some(true)));
    assert!(ok.output.contains("Healthy"));
    let no = run(
        &sh,
        d.path(),
        &step("echo OutOfSync", "`Synced`"),
        &[],
        Duration::from_secs(10),
    );
    assert_eq!(no.matched, Some(false));
    let re = run(
        &sh,
        d.path(),
        &step("echo 'p95: 176 ms'", "/p95: [0-2][0-9][0-9] ms/"),
        &[],
        Duration::from_secs(10),
    );
    assert_eq!(re.matched, Some(true));
    let prose = run(
        &sh,
        d.path(),
        &step("echo hi", "pool usage below 80 %"),
        &[],
        Duration::from_secs(10),
    );
    assert_eq!(prose.matched, None, "prose is the human's to judge");
    let fail = run(
        &sh,
        d.path(),
        &step("echo boom >&2; exit 3", "`ok`"),
        &[],
        Duration::from_secs(10),
    );
    assert_eq!((fail.exit_code, fail.matched), (3, Some(false)));
    assert!(fail.output.contains("boom"));
    let env = run(
        &sh,
        d.path(),
        &step("echo \"$VAULT_DYN_USERNAME\"", "`v-app`"),
        &[("VAULT_DYN_USERNAME".into(), "v-app".into())],
        Duration::from_secs(10),
    );
    assert_eq!(env.matched, Some(true));
    let slow = run(
        &sh,
        d.path(),
        &step("sleep 5", ""),
        &[],
        Duration::from_millis(300),
    );
    assert_eq!(slow.exit_code, -2);
    assert!(slow.output.contains("stopped after"));
    // a secret in the output is masked before it is kept
    let sec = run(
        &sh,
        d.path(),
        &step("echo postgres://app:hunter2pass@db/app", ""),
        &[],
        Duration::from_secs(10),
    );
    assert!(!sec.output.contains("hunter2pass"), "{}", sec.output);
}

#[test]
fn lists_and_loads_the_project_runbooks() {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join("runbooks")).unwrap();
    std::fs::write(d.path().join("runbooks/b.md"), LATENCY).unwrap();
    std::fs::write(
        d.path().join("runbooks/a.md"),
        "# restore test\n\n## 1. snapshot [check]\n```\nls\n```\nexpect: `x`\n",
    )
    .unwrap();
    std::fs::write(d.path().join("runbooks/notes.txt"), "x").unwrap();
    let all = list(d.path());
    assert_eq!(
        all.iter().map(|r| r.path.as_str()).collect::<Vec<_>>(),
        vec!["runbooks/a.md", "runbooks/b.md"]
    );
    assert_eq!(
        load(d.path(), "runbooks/a.md").unwrap().title,
        "restore test"
    );
    assert!(
        load(d.path(), "../etc/passwd").is_err() && load(d.path(), "runbooks/../x.md").is_err()
    );
}

#[test]
fn a_pattern_ignores_the_final_line_break_of_the_output() {
    assert_eq!(matches("/^[0-9]+$/", "3\n"), Some(true));
    assert_eq!(matches("/^[0-9]+$/", "3\r\n"), Some(true));
    assert_eq!(matches("/^[0-9]+$/", "3\nERROR\n"), Some(false));
    assert_eq!(matches("`3`", "3\n"), Some(true));
}
