use super::*;
use serde_json::json;

fn plain(tool: &str) -> Command {
    Command::new(tool)
}

fn on_path(tool: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(tool).is_file()))
        .unwrap_or(false)
}

#[test]
fn reads_the_scanners_json() {
    let tflint = json!({"issues": [{"rule": {"name": "terraform_unused_declarations", "severity": "warning"}, "message": "variable \"x\" is declared but not used", "range": {"filename": "main.tf", "start": {"line": 3}}}],
        "errors": [{"message": "Failed to load configurations", "range": {"filename": "bad.tf", "start": {"line": 1}}}]});
    let f = parse_tflint(&tflint.to_string(), "infra");
    assert_eq!(
        (f[0].file.as_str(), f[0].line, f[0].severity.as_str()),
        ("infra/main.tf", 3, "warning")
    );
    assert_eq!(
        (f[1].rule.as_str(), f[1].severity.as_str()),
        ("tflint-error", "error")
    );

    let checkov = json!([{"check_type": "terraform", "results": {"failed_checks": [{"check_id": "CKV_AWS_18", "check_name": "Ensure the S3 bucket has access logging enabled", "file_path": "/main.tf", "file_line_range": [5, 9], "resource": "aws_s3_bucket.logs", "severity": null}]}}]);
    let f = parse_checkov(&checkov.to_string(), "infra");
    assert_eq!(
        (f[0].rule.as_str(), f[0].file.as_str(), f[0].line),
        ("CKV_AWS_18", "infra/main.tf", 5)
    );
    assert_eq!(
        (f[0].severity.as_str(), f[0].resource.as_deref()),
        ("error", Some("aws_s3_bucket.logs"))
    );
    // one report as an object, and a severity when the platform gives one
    let one = json!({"results": {"failed_checks": [{"check_id": "CKV_X", "file_path": "/a.tf", "file_line_range": [1, 1], "severity": "LOW"}]}});
    assert_eq!(parse_checkov(&one.to_string(), ".")[0].severity, "warning");

    let trivy = json!({"Results": [{"Target": "main.tf", "Misconfigurations": [
        {"AVDID": "AVD-AWS-0086", "Title": "S3 Access block should block public ACL", "Message": "No public access block", "Severity": "HIGH", "Status": "FAIL", "CauseMetadata": {"Resource": "aws_s3_bucket.logs", "StartLine": 5}},
        {"AVDID": "AVD-AWS-0090", "Severity": "MEDIUM", "Status": "PASS", "CauseMetadata": {}}]}]});
    let f = parse_trivy(&trivy.to_string(), ".");
    assert_eq!(f.len(), 1);
    assert_eq!(
        (
            f[0].rule.as_str(),
            f[0].file.as_str(),
            f[0].line,
            f[0].severity.as_str()
        ),
        ("AVD-AWS-0086", "main.tf", 5, "error")
    );

    let conftest = json!([{"filename": "plan.json", "namespace": "main", "successes": 3, "failures": [{"msg": "aws_s3_bucket.logs must be private"}], "warnings": [{"msg": "tag owner missing"}]}]);
    let f = parse_conftest(&conftest.to_string(), "infra");
    assert_eq!(
        (f.len(), f[0].severity.as_str(), f[1].severity.as_str()),
        (2, "error", "warning")
    );

    let infracost = json!({"currency": "USD", "totalMonthlyCost": "17.52", "projects": [{"breakdown": {"resources": [{"name": "aws_instance.web", "monthlyCost": "17.52"}, {"name": "aws_s3_bucket.logs", "monthlyCost": null}]}}]});
    let (costs, total, cur) = parse_infracost(&infracost.to_string());
    assert_eq!(
        (
            costs.get("aws_instance.web").copied(),
            costs.len(),
            total,
            cur.as_str()
        ),
        (Some(17.52), 1, Some(17.52), "USD")
    );

    let validate = json!({"valid": false, "diagnostics": [{"severity": "error", "summary": "Unsupported argument", "detail": "An argument named \"pasword\" is not expected here.", "range": {"filename": "main.tf", "start": {"line": 7}}}]});
    let f = parse_validate(&validate.to_string(), "infra");
    assert_eq!(
        (f[0].file.as_str(), f[0].line, f[0].severity.as_str()),
        ("infra/main.tf", 7, "error")
    );
    assert!(f[0].message.starts_with("Unsupported argument: "));
}

#[test]
fn reads_the_state_without_its_values() {
    let st = json!({"version": 4, "serial": 7, "lineage": "abc", "resources": [
        {"mode": "managed", "type": "aws_db_instance", "name": "main", "instances": [{"attributes": {"id": "db-1", "password": "hunter2"}, "sensitive_attributes": [[{"type": "get_attr", "value": "password"}]]}]},
        {"module": "module.net", "mode": "data", "type": "aws_vpc", "name": "main", "instances": [{"index_key": 0, "attributes": {"id": "vpc-1"}}, {"index_key": "b", "attributes": {"id": "vpc-2"}}]}]});
    let (serial, lineage, r) = parse_state(&st.to_string()).unwrap();
    assert_eq!((serial, lineage.as_deref()), (Some(7), Some("abc")));
    assert_eq!(r[0].address, "aws_db_instance.main");
    assert_eq!(
        (r[0].id.as_deref(), r[0].sensitive.clone()),
        (Some("db-1"), vec!["password".to_string()])
    );
    assert_eq!(r[1].address, "module.net.data.aws_vpc.main[0]");
    assert_eq!(r[2].address, "module.net.data.aws_vpc.main[\"b\"]");
    assert!(!serde_json::to_string(&r).unwrap().contains("hunter2"));
    assert_eq!(parse_state("").unwrap(), (None, None, vec![]));
}

#[test]
fn the_plan_knows_modules_replacements_blast_radius_and_write_only_arguments() {
    let plan = json!({
        "resource_changes": [
            {"address": "aws_db_instance.main", "change": {"actions": ["delete", "create"], "before": {"engine": "postgres"}, "after": {"engine": "mysql"}, "replace_paths": [["engine"]]}, "action_reason": "replace_because_cannot_update"},
            {"address": "module.app.aws_instance.web[0]", "module_address": "module.app", "change": {"actions": ["update"], "before": {"ami": "a"}, "after": {"ami": "b"}}}
        ],
        "configuration": {"root_module": {
            "resources": [
                {"address": "aws_db_instance.main", "expressions": {"password_wo": {"references": ["var.db_password"]}}},
                {"address": "aws_route53_record.db", "expressions": {"records": {"references": ["aws_db_instance.main.address", "aws_db_instance.main"]}}},
                {"address": "aws_cloudwatch_metric_alarm.dns", "expressions": {"dimensions": {"references": ["aws_route53_record.db.fqdn"]}}},
                {"address": "aws_lb.front", "expressions": {"targets": {"references": ["module.app.ids", "module.app"]}}}
            ],
            "module_calls": {"app": {"expressions": {"db_host": {"references": ["aws_db_instance.main.address"]}},
                "module": {"resources": [{"address": "aws_instance.web", "expressions": {}}, {"address": "aws_eip.web", "expressions": {"instance": {"references": ["aws_instance.web.id"]}}}]}}}
        }}
    });
    let (changes, _) = ops::parse_plan(&plan.to_string()).unwrap();
    let db = &changes[0];
    assert_eq!(
        (db.action.as_str(), db.reason.as_deref()),
        ("replace", Some("replace_because_cannot_update"))
    );
    assert_eq!(db.replace_paths, vec!["engine"]);
    assert_eq!(db.write_only, vec!["password_wo"]);
    assert_eq!(
        db.dependents,
        // a module that takes the address is a dependent as a whole (its variables are not followed inside)
        vec![
            "aws_cloudwatch_metric_alarm.dns",
            "aws_lb.front",
            "aws_route53_record.db",
            "module.app"
        ]
    );
    let web = &changes[1];
    assert_eq!(web.module.as_deref(), Some("module.app"));
    assert_eq!(
        web.dependents,
        vec!["aws_lb.front", "module.app.aws_eip.web"]
    );
}

#[test]
fn a_finding_key_survives_moving_the_line() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("a.tf"), "locals {\n  password = \"x\"\n}\n").unwrap();
    let f = Finding {
        source: "built-in".into(),
        rule: "secret-argument".into(),
        file: "a.tf".into(),
        line: 2,
        ..Default::default()
    };
    let k = finding_key(d.path(), &f);
    std::fs::write(
        d.path().join("a.tf"),
        "# moved\nlocals {\n    password   = \"x\"\n}\n",
    )
    .unwrap();
    assert_eq!(
        finding_key(
            d.path(),
            &Finding {
                line: 3,
                ..f.clone()
            }
        ),
        k
    );
    assert_ne!(
        finding_key(
            d.path(),
            &Finding {
                rule: "other".into(),
                line: 3,
                ..f
            }
        ),
        k
    );
}

fn ctx<'a>(
    root: &'a Path,
    dir: &'a str,
    plans: &'a Path,
    accepted: &'a HashSet<String>,
) -> Ctx<'a> {
    Ctx {
        root,
        dir,
        target: None,
        plans,
        accepted,
        cmd: &plain,
        has: &on_path,
    }
}

fn status(r: &PipelineRun, id: &str) -> Status {
    r.stages
        .iter()
        .find(|s| s.id == id)
        .map(|s| s.status)
        .unwrap()
}

/// r23 F4b acceptance: the pipeline runs every stage (the tools that are missing say so), keeps the
/// plan, and the apply applies that file; a later edit, a failed stage or a secret in the state block
/// it until the risk is accepted.
#[test]
fn real_pipeline_with_opentofu() {
    if !on_path("tofu") && !on_path("terraform") {
        eprintln!("skipped: no tofu/terraform");
        return;
    }
    let d = tempfile::tempdir().unwrap();
    let plans = tempfile::tempdir().unwrap();
    let root = d.path();
    let infra = root.join("infra");
    std::fs::create_dir_all(&infra).unwrap();
    std::fs::write(
        infra.join("main.tf"),
        "resource \"terraform_data\" \"a\" {\n  input = \"v1\"\n}\n\nresource \"terraform_data\" \"b\" {\n  input = terraform_data.a.output\n}\n",
    )
    .unwrap();
    let none = HashSet::new();
    let mut seen = vec![];
    let r = run(
        &ctx(root, "infra", plans.path(), &none),
        &mut |s: &Stage| seen.push((s.id.clone(), s.status)),
    );
    assert!(!r.blocked, "{:#?}", r);
    assert_eq!(r.stages.len(), ORDER.len());
    assert_eq!(seen.len(), ORDER.len() * 2);
    assert_eq!(seen[0], ("init".to_string(), Status::Running));
    for (id, st) in [
        ("init", Status::Ok),
        ("fmt", Status::Ok),
        ("validate", Status::Ok),
        ("rules", Status::Ok),
        ("state", Status::Skipped),
        ("plan", Status::Ok),
        ("drift", Status::Ok),
    ] {
        assert_eq!(status(&r, id), st, "{id}: {:#?}", r.stages);
    }
    for tool in ["tflint", "checkov", "trivy", "conftest", "infracost"] {
        if !on_path(tool) {
            let s = r.stages.iter().find(|s| s.id == tool).unwrap();
            assert_eq!(s.status, Status::NotInstalled);
            assert!(
                s.hint.as_deref().unwrap_or("").contains(tool)
                    || s.hint.as_deref().unwrap_or("").contains("Install")
            );
        } else if tool != "infracost" {
            // installed: the scanner ran on this clean configuration and found nothing that blocks
            // (conftest is skipped: this project has no `policy/` folder)
            let want = if tool == "conftest" {
                Status::Skipped
            } else {
                Status::Ok
            };
            assert_eq!(status(&r, tool), want, "{tool}: {:#?}", r.stages);
        }
    }
    // infracost installed without an API key: «not connected», and the hint is to sign in, not to install
    let ic = r.stages.iter().find(|s| s.id == "infracost").unwrap();
    if ic.status == Status::NotConnected {
        assert_eq!(ic.hint.as_deref(), Some(CONNECT_INFRACOST));
    }
    let p = r.plan.as_ref().unwrap();
    assert_eq!((p.add, p.change, p.destroy), (2, 0, 0));
    assert_eq!(
        p.changes
            .iter()
            .find(|c| c.address == "terraform_data.a")
            .unwrap()
            .dependents,
        vec!["terraform_data.b"]
    );
    assert_eq!(r.id.len(), 64);
    // the reviewed plan file is kept, private, and the apply applies it
    let a = apply_command(root, "infra", &r.id, plans.path()).unwrap();
    assert!(
        a.command.starts_with("cd infra && ")
            && a.command.contains(&a.plan_file)
            && a.command.contains(" apply -input=false "),
        "{}",
        a.command
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&a.plan_file)
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    assert!(apply_command(root, ".", &r.id, plans.path()).is_err());
    assert!(apply_command(root, "infra", &"0".repeat(64), plans.path()).is_err());
    let ok = Command::new("sh")
        .arg("-c")
        .arg(&a.command)
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        ok.status.success(),
        "{}",
        String::from_utf8_lossy(&ok.stderr)
    );
    // the state: addresses and ids
    let st = state(&ctx(root, "infra", plans.path(), &none));
    assert!(st.ok, "{}", st.notes);
    assert_eq!(st.backend, "local");
    assert!(st.lock_readable && st.lock.is_none());
    assert_eq!(
        st.resources
            .iter()
            .map(|r| r.address.as_str())
            .collect::<Vec<_>>(),
        vec!["terraform_data.a", "terraform_data.b"]
    );
    assert!(st
        .resources
        .iter()
        .all(|r| r.id.as_deref().is_some_and(|i| !i.is_empty())));
    assert!(st.serial.is_some());

    // a plan made before an edit is not applied after it
    let r2 = run(&ctx(root, "infra", plans.path(), &none), &mut |_| {});
    std::fs::write(
        infra.join("extra.tf"),
        "resource \"terraform_data\" \"c\" {\n  input = \"v\"\n}\n",
    )
    .unwrap();
    assert!(r2.plan.as_ref().unwrap().changes.is_empty());
    assert!(
        apply_command(root, "infra", &r2.id, plans.path()).is_err(),
        "nothing to apply"
    );
    let r3 = run(&ctx(root, "infra", plans.path(), &none), &mut |_| {});
    assert!(!r3.blocked);
    std::fs::write(
        infra.join("extra.tf"),
        "resource \"terraform_data\" \"c\" {\n  input = \"w\"\n}\n",
    )
    .unwrap();
    assert!(apply_command(root, "infra", &r3.id, plans.path())
        .unwrap_err()
        .contains("configuration changed"));

    // a secret in the code fails the built-in rules: blocked, in Rust, until the risk is accepted
    std::fs::write(
        infra.join("extra.tf"),
        "variable \"db_password\" {\n  type      = string\n  sensitive = true\n  default   = \"s3cr3t-value\"\n}\n\nlocals {\n  password = var.db_password\n}\n\nresource \"terraform_data\" \"c\" {\n  input = local.password\n}\n",
    )
    .unwrap();
    let r4 = run(&ctx(root, "infra", plans.path(), &none), &mut |_| {});
    assert_eq!(status(&r4, "rules"), Status::Failed, "{:#?}", r4.stages);
    assert!(r4.blocked && r4.blockers.contains(&"rules".to_string()));
    assert!(apply_command(root, "infra", &r4.id, plans.path())
        .unwrap_err()
        .contains("pipeline failed"));
    let finding = r4.stages.iter().find(|s| s.id == "rules").unwrap().findings[0].clone();
    assert_eq!(
        (finding.file.as_str(), finding.line, finding.rule.as_str()),
        ("infra/extra.tf", 8, "secret-argument")
    );
    let accepted: HashSet<String> = [finding.key.clone()].into();
    let r5 = run(&ctx(root, "infra", plans.path(), &accepted), &mut |_| {});
    assert!(!r5.blocked, "{:#?}", r5.stages);
    assert!(r5.stages.iter().find(|s| s.id == "rules").unwrap().findings[0].accepted);
    let a5 = apply_command(root, "infra", &r5.id, plans.path()).unwrap();
    assert!(Command::new("sh")
        .arg("-c")
        .arg(&a5.command)
        .current_dir(root)
        .status()
        .unwrap()
        .success());

    // now the state keeps the secret: the state stage says where, never what
    let r6 = run(&ctx(root, "infra", plans.path(), &accepted), &mut |_| {});
    let s = r6.stages.iter().find(|s| s.id == "state").unwrap();
    assert_eq!(s.status, Status::Failed, "{:#?}", s);
    assert_eq!(s.findings[0].resource.as_deref(), Some("terraform_data.c"));
    assert_eq!(
        (s.findings[0].file.as_str(), s.findings[0].line),
        ("infra/extra.tf", 11)
    );
    let json = serde_json::to_string(&r6).unwrap();
    assert!(
        !json.contains("s3cr3t-value"),
        "a secret value was serialized"
    );
    let st = state(&ctx(root, "infra", plans.path(), &none));
    assert!(!serde_json::to_string(&st).unwrap().contains("s3cr3t-value"));
    assert!(st.backup_serial.is_some());

    // a targeted run plans one address; a bad one is refused before any tool runs
    let t = Ctx {
        target: Some("terraform_data.a"),
        ..ctx(root, "infra", plans.path(), &accepted)
    };
    assert_eq!(
        run(&t, &mut |_| {}).target.as_deref(),
        Some("terraform_data.a")
    );
    let bad = Ctx {
        target: Some("-destroy"),
        ..ctx(root, "infra", plans.path(), &accepted)
    };
    assert!(run(&bad, &mut |_| {})
        .notes
        .contains("not a resource address"));
    assert!(run(&ctx(root, "../etc", plans.path(), &none), &mut |_| {})
        .notes
        .contains("outside"));
}

#[test]
fn an_unformatted_file_fails_fmt() {
    if !on_path("tofu") && !on_path("terraform") {
        eprintln!("skipped: no tofu/terraform");
        return;
    }
    let d = tempfile::tempdir().unwrap();
    let plans = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("main.tf"),
        "resource \"terraform_data\" \"a\" {\ninput=\"v1\"\n}\n",
    )
    .unwrap();
    let none = HashSet::new();
    let r = run(&ctx(d.path(), ".", plans.path(), &none), &mut |_| {});
    let fmt = r.stages.iter().find(|s| s.id == "fmt").unwrap();
    assert_eq!(
        (fmt.status, fmt.findings[0].file.as_str()),
        (Status::Failed, "main.tf")
    );
    assert!(r.blocked);
    assert!(apply_command(d.path(), ".", &r.id, plans.path()).is_err());
}
