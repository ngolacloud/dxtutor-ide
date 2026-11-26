use super::*;
use crate::keychain::MemStore;

const APP: &str = "apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 1
  template:
    spec:
      containers:
        - name: web
          image: \"shop/web:1.0\"
          envFrom:
            - secretRef:
                name: shop-env
---
apiVersion: v1
kind: Secret
metadata:
  name: shop-env
stringData:
  DB_PASSWORD: local-pw-123
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  ports:
    - port: 80
";

#[test]
fn the_manifests_without_their_secrets() {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join("deploy/k8s")).unwrap();
    std::fs::write(d.path().join("deploy/k8s/app.yaml"), APP).unwrap();
    let m = read_manifests(d.path(), "deploy/k8s").unwrap();
    assert_eq!(
        (m.deployments.clone(), m.images.clone(), m.secrets.clone()),
        (
            vec!["web".to_string()],
            vec!["shop/web:1.0".to_string()],
            vec!["shop-env".to_string()]
        )
    );
    assert!(
        !m.text.contains("kind: Secret") && !m.text.contains("local-pw-123"),
        "{}",
        m.text
    );
    assert!(m.text.contains("kind: Service"));
    assert_eq!(expected_secrets(&m), vec!["shop-env"]);
    assert!(read_manifests(d.path(), "nope").is_err());
}

#[test]
fn the_pure_rules() {
    assert_eq!(
        issue_of("feat(web): SHOP-42 the cart"),
        Some("SHOP-42".into())
    );
    assert_eq!(issue_of("fix: a-1 and utf-8, X-1"), None);
    let w = vec![Window {
        days: vec!["mon".into(), "tue".into()],
        from: "09:00".into(),
        to: "16:00".into(),
    }];
    assert!(in_window(&w, 0, 9 * 60));
    assert!(!in_window(&w, 0, 16 * 60));
    assert!(!in_window(&w, 2, 10 * 60));
    let g = |id: &str, s: Status| Gate::new(id, s, "");
    let gates = vec![
        g("version", Status::Ok),
        g("sbom", Status::NotInstalled),
        g("slo", Status::NotConnected),
        g("window", Status::Skipped),
    ];
    // staging: only a failed check blocks; production: not installed / not connected too, unless waived
    assert!(blockers("staging", &gates, &[]).is_empty());
    assert_eq!(blockers("production", &gates, &[]), vec!["sbom", "slo"]);
    assert_eq!(
        blockers("production", &gates, &["sbom".into()]),
        vec!["slo"]
    );
    assert_eq!(waivable("production", &gates), vec!["sbom", "slo"]);
    assert!(waivable("staging", &gates).is_empty());
    // the second approver and staging are never waived (owner decision): no gh keeps production closed
    let prod = vec![
        g("approver", Status::NotConnected),
        g("staging", Status::NotConnected),
        g("slo", Status::NotConnected),
    ];
    assert_eq!(waivable("production", &prod), vec!["slo"]);
    assert_eq!(
        blockers(
            "production",
            &prod,
            &["approver".into(), "staging".into(), "slo".into()]
        ),
        vec!["approver", "staging"]
    );
    assert!(confirmed("staging", None, None).is_ok());
    assert!(confirmed("production", Some("prod"), Some("release"))
        .unwrap_err()
        .contains("type production"));
    assert!(confirmed("production", Some(" production "), Some(" "))
        .unwrap_err()
        .contains("needs a reason"));
    assert!(confirmed("production", Some("production"), Some("release 1.4")).is_ok());
    let failed = vec![g("version", Status::Failed)];
    assert_eq!(
        blockers("production", &failed, &["version".into()]),
        vec!["version"]
    );
    let prs = r#"[{"number":7,"url":"https://github.com/o/r/pull/7","reviews":[{"author":{"login":"ana"},"state":"APPROVED"},{"author":{"login":"bruno"},"state":"COMMENTED"},{"author":{"login":"Carla"},"state":"APPROVED"}]}]"#;
    assert_eq!(approver_of(prs, "ana").map(|x| x.0), Some("Carla".into()));
    assert_eq!(approver_of(prs, "carla").map(|x| x.0), Some("ana".into()));
    // approving your own pull request is no second approval
    let mine =
        r#"[{"number":8,"url":"u","reviews":[{"author":{"login":"ana"},"state":"APPROVED"}]}]"#;
    assert_eq!(approver_of(mine, "ANA"), None);
}

/// A fake `kubectl` and `gh`: log their arguments (and kubectl's stdin) and answer like the real ones.
fn fakes(dir: &Path, staging_version: &str) -> PathBuf {
    let bin = dir.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let log = dir.join("calls.log");
    let kubectl = format!(
        r#"#!/bin/sh
echo "kubectl $*" >> {log}
case "$*" in
  *" version "*|*" version") exit 0 ;;
  *"auth whoami"*) printf 'kind-admin' ;;
  *"get secret"*) echo "secret/shop-env" ;;
  *"--dry-run=server"*) cat > /dev/null; [ -f {dir}/deny ] && {{ echo 'admission webhook "policy" denied the request: image must be signed' >&2; exit 1; }}; echo ok ;;
  *"create namespace"*) printf 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: shop\n' ;;
  *"get deploy -o json"*) printf '{{"items":[{{"metadata":{{"name":"web","annotations":{{"dxtutor.io/version":"%s"}}}},"spec":{{"replicas":1}},"status":{{"readyReplicas":1}}}}]}}' "{sv}" ;;
  *"apply -f -"*) cat >> {dir}/applied.yaml; echo "applied" ;;
  *annotate*) echo "annotated" ;;
  *"rollout status"*) echo "successfully rolled out" ;;
esac
"#,
        log = log.display(),
        dir = dir.display(),
        sv = staging_version
    );
    let gh = format!(
        r#"#!/bin/sh
echo "gh $*" >> {log}
case "$*" in
  "api user -q .login") echo ana ;;
  "pr list"*) echo '[{{"number":7,"url":"https://github.com/o/r/pull/7","reviews":[{{"author":{{"login":"bruno"}},"state":"APPROVED"}}]}}]' ;;
esac
"#,
        log = log.display()
    );
    for (n, s) in [("kubectl", kubectl), ("gh", gh)] {
        let p = bin.join(n);
        std::fs::write(&p, s).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    bin
}

fn git(root: &Path, args: &[&str]) {
    assert!(
        Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap()
            .status
            .success(),
        "git {args:?}"
    );
}

fn project() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    let r = d.path();
    git(r, &["init", "-q", "-b", "main"]);
    git(r, &["config", "user.email", "t@example.com"]);
    git(r, &["config", "user.name", "ana"]);
    std::fs::create_dir_all(r.join("deploy/k8s")).unwrap();
    std::fs::write(r.join("deploy/k8s/app.yaml"), APP).unwrap();
    git(r, &["add", "."]);
    git(r, &["commit", "-qm", "feat: SHOP-7 the web"]);
    d
}

fn head(r: &Path) -> String {
    String::from_utf8(
        Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(r)
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap()
    .trim()
    .to_string()
}

/// r23 F4c2 acceptance: a staging deploy plans every check (missing tools say so), applies the
/// manifests WITHOUT the Secrets (no value leaves for the cluster), annotates the version and waits
/// for the rollout; production is blocked by what it cannot verify until each is waived with a reason,
/// needs staging to run this version and a second approver.
#[test]
fn staging_then_production_with_a_fake_cluster() {
    let p = project();
    let root = p.path();
    let sha = head(root);
    let tools_dir = tempfile::tempdir().unwrap();
    let bin = fakes(tools_dir.path(), &sha[..12]);
    let cmd = |prog: &str| -> Command {
        let fake = bin.join(prog);
        if fake.exists() {
            Command::new(fake)
        } else {
            Command::new(prog)
        }
    };
    let has = |prog: &str| matches!(prog, "kubectl" | "gh" | "git");
    let store = MemStore::default();
    let t = Tools {
        cmd: &cmd,
        has: &has,
        store: &store,
    };
    let target = Target {
        env: "staging".into(),
        context: "kind-dev".into(),
        namespace: "shop".into(),
        ..Default::default()
    };
    let plan = plan(&t, root, &target).unwrap();
    let st = |id: &str| {
        plan.gates
            .iter()
            .find(|g| g.id == id)
            .map(|g| g.status)
            .unwrap()
    };
    assert_eq!(st("version"), Status::Ok);
    assert_eq!(
        (st("sbom"), st("signature"), st("vulns")),
        (
            Status::NotInstalled,
            Status::NotInstalled,
            Status::NotInstalled
        )
    );
    assert!(plan
        .gates
        .iter()
        .filter(|g| g.status == Status::NotInstalled)
        .all(|g| g.hint.is_some()));
    assert_eq!(
        st("secrets"),
        Status::NotConnected,
        "Vault not connected: {:?}",
        plan.gates
    );
    assert_eq!(
        (st("secret-check"), st("slo")),
        (Status::NotConnected, Status::NotConnected)
    );
    assert_eq!(
        (st("drift"), st("window"), st("migrations")),
        (Status::Skipped, Status::Skipped, Status::Skipped)
    );
    assert_eq!(st("admission"), Status::Ok);
    assert_eq!(
        plan.identity,
        Identity {
            git: "ana".into(),
            cluster: Some("kind-admin".into()),
            vault: None
        }
    );
    assert_eq!(
        (plan.issue.as_deref(), plan.secrets_from_vault.clone()),
        (Some("SHOP-7"), vec!["shop-env".to_string()])
    );
    assert!(
        plan.blockers.is_empty() && plan.waivable.is_empty(),
        "staging: only a failed check blocks"
    );
    assert!(plan.commands[1].contains("without the Secrets (shop-env)"));
    let mut lines = vec![];
    let r = rollout(&plan.id, &t, &[], &mut |l| lines.push(l.to_string())).unwrap();
    assert!(r.ok, "{lines:#?}");
    let applied = std::fs::read_to_string(tools_dir.path().join("applied.yaml")).unwrap();
    assert!(
        applied.contains("kind: Deployment")
            && !applied.contains("kind: Secret")
            && !applied.contains("local-pw-123"),
        "{applied}"
    );
    let calls = std::fs::read_to_string(tools_dir.path().join("calls.log")).unwrap();
    // only this deploy's Deployments carry its version — measured on kind: `--all` marked the
    // namespace's other Deployments with it too
    assert!(
        calls.contains(&format!(
            "annotate deploy/web dxtutor.io/version={}",
            &sha[..12]
        )),
        "{calls}"
    );
    assert!(!calls.contains("--all"), "{calls}");
    assert!(calls.contains("rollout status deploy/web --timeout=180s"));
    assert!(
        rollout(&plan.id, &t, &[], &mut |_| {})
            .unwrap_err()
            .contains("no longer kept"),
        "a plan is used once"
    );

    // production: staging runs this version, bruno approved the PR; what cannot be verified blocks
    let prod = Target {
        env: "production".into(),
        context: "prod".into(),
        namespace: "shop".into(),
        staging: Some(("kind-dev".into(), "shop".into())),
        ..Default::default()
    };
    let pp = super::plan(&t, root, &prod).unwrap();
    let pst = |id: &str| {
        pp.gates
            .iter()
            .find(|g| g.id == id)
            .map(|g| g.status)
            .unwrap()
    };
    assert_eq!(
        (pst("staging"), pst("approver")),
        (Status::Ok, Status::Ok),
        "{:#?}",
        pp.gates
    );
    assert_eq!(pp.approver.as_deref(), Some("bruno"));
    assert_eq!(
        pp.blockers,
        vec![
            "sbom",
            "signature",
            "vulns",
            "secrets",
            "secret-check",
            "slo"
        ]
    );
    assert_eq!(pp.waivable, pp.blockers);
    assert!(rollout(&pp.id, &t, &[], &mut |_| {})
        .unwrap_err()
        .contains("blocked by: sbom"));
    let some: Vec<(String, String)> = pp
        .waivable
        .iter()
        .map(|g| (g.clone(), "no scanner here yet".to_string()))
        .collect();
    let mut short = some.clone();
    short[0].1 = " ".into();
    assert!(rollout(&pp.id, &t, &short, &mut |_| {})
        .unwrap_err()
        .contains("needs a reason"));
    assert!(rollout(
        &pp.id,
        &t,
        &[("version".into(), "x".repeat(5))],
        &mut |_| {}
    )
    .unwrap_err()
    .contains("cannot be waived"));
    let r = rollout(&pp.id, &t, &some, &mut |_| {}).unwrap();
    assert!(r.ok && r.waivers.len() == 6);
}

#[test]
fn a_dirty_tree_a_moved_head_or_changed_manifests_are_refused() {
    let p = project();
    let root = p.path();
    let tools_dir = tempfile::tempdir().unwrap();
    let bin = fakes(tools_dir.path(), "none");
    let cmd = |prog: &str| -> Command {
        let fake = bin.join(prog);
        if fake.exists() {
            Command::new(fake)
        } else {
            Command::new(prog)
        }
    };
    let has = |prog: &str| matches!(prog, "kubectl" | "git");
    let store = MemStore::default();
    let t = Tools {
        cmd: &cmd,
        has: &has,
        store: &store,
    };
    let target = Target {
        env: "staging".into(),
        context: "kind-dev".into(),
        namespace: "shop".into(),
        ..Default::default()
    };
    std::fs::write(root.join("deploy/k8s/app.yaml"), APP.replace("1.0", "1.1")).unwrap();
    let dirty = plan(&t, root, &target).unwrap();
    assert_eq!(dirty.blockers, vec!["version"]);
    assert!(rollout(&dirty.id, &t, &[], &mut |_| {})
        .unwrap_err()
        .contains("blocked by: version"));
    git(root, &["commit", "-qam", "chore: 1.1"]);
    let ok = plan(&t, root, &target).unwrap();
    std::fs::write(root.join("README.md"), "x").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "docs: readme"]);
    assert!(rollout(&ok.id, &t, &[], &mut |_| {})
        .unwrap_err()
        .contains("HEAD moved"));
    // the cluster's admission policy refuses: a failed check, never waivable
    std::fs::write(tools_dir.path().join("deny"), "").unwrap();
    let denied = plan(&t, root, &target).unwrap();
    assert_eq!(denied.blockers, vec!["admission"]);
    assert!(denied
        .gates
        .iter()
        .any(|g| g.id == "admission" && g.detail.contains("must be signed")));
    assert!(plan(
        &t,
        root,
        &Target {
            env: "dev".into(),
            ..target.clone()
        }
    )
    .is_err());
    assert!(plan(
        &t,
        root,
        &Target {
            namespace: "".into(),
            ..target
        }
    )
    .unwrap_err()
    .contains("choose staging's cluster"));
}
