//! Learn P3b, on the REAL practice cluster: kind on rootless Podman, from the prepared cache of the
//! built-in Kubernetes course. Skipped (with the reason) when the course is not prepared in
//! `DXTUTOR_COURSE_CACHE` (or the user data folder) or this machine cannot run the sandbox — CI
//! never downloads the ~1 GB. To run it:
//!
//! ```sh
//! export DXTUTOR_COURSE_CACHE=/tmp/cc
//! dxt plugin prepare courses/kubernetes
//! cargo test -p tutor-eval --test kind_live_real -- --nocapture
//! ```
//!
//! It proves what the structural checks cannot: with the checks that need no cluster removed, the
//! starter of the Services unit is applied and the LIVE checks fail for the right reason (the
//! stranger Pod is among the endpoints, the port has no name), the solution passes, the grading
//! namespaces are gone, and the cluster this test created is deleted with nothing left behind.

use std::collections::BTreeMap;
use std::time::Duration;

use tutor_core::{toolcheck::CHECKS_FILE, Level};
use tutor_eval::{course_cache, kindbox};

fn course() -> tutor_core::Course {
    tutor_core::builtin_courses()
        .into_iter()
        .find(|c| c.id == "kubernetes-basics")
        .expect("the built-in Kubernetes course")
}

/// The checks of `step` without the `[[check]]`s on the learner's files (the live part only).
fn live_only(raw: &str, learner_file: &str) -> String {
    let mut v: toml::Table = toml::from_str(raw).expect("checks.toml");
    if let Some(toml::Value::Array(checks)) = v.get_mut("check") {
        checks.retain(|c| c.get("file").and_then(|f| f.as_str()) != Some(learner_file));
    }
    toml::to_string(&v).expect("serialise")
}

#[test]
fn live_checks_catch_what_only_a_cluster_shows_and_leave_nothing_behind() {
    let Some(root) = course_cache::root() else {
        eprintln!("skipped: no course cache folder");
        return;
    };
    let c = course();
    let ch = c.step("k8s-p13-endpoints").expect("the Services unit");
    let mut phase = c.phase(ch, Level::Basico).expect("a phase");
    let cache = phase.build.cache.clone().expect("a prepared course");
    match course_cache::status(&root, &cache) {
        Ok(s) if s.is_ready() => {}
        _ => {
            eprintln!(
                "skipped: kubernetes-basics is not prepared in {} (run `dxt plugin prepare courses/kubernetes`)",
                root.display()
            );
            return;
        }
    }
    let support = kindbox::probe();
    if !support.ok {
        eprintln!("skipped: {}", support.reason.unwrap_or_default());
        return;
    }
    let sb = course_cache::layout(&root, &cache.key).unwrap().sandbox();
    let existed = kindbox::status(&sb).map(|s| s.exists).unwrap_or(false);

    let project = phase.project.as_mut().unwrap();
    let raw = project.tests[CHECKS_FILE].clone();
    project
        .tests
        .insert(CHECKS_FILE.into(), live_only(&raw, "app.yaml"));
    let starter = tutor_eval::assess_project(&phase, &BTreeMap::new()).expect("graded");
    let raw_report = &starter.correctness.raw;
    eprintln!("{raw_report}");
    assert!(!starter.correctness.passed, "{raw_report}");
    assert!(
        raw_report.contains("practice cluster dxtutor-kubernetes-basics"),
        "{raw_report}"
    );
    assert!(
        raw_report.contains("Exactly 2 endpoints: your 2 Pods, not the stranger"),
        "the stranger Pod must be caught by the live endpoints: {raw_report}"
    );
    assert!(
        raw_report.contains("The endpoints' port http resolves to 80."),
        "an unnamed port has no `http` in the EndpointSlice: {raw_report}"
    );

    let solution = ch.project.as_ref().unwrap().solution.clone();
    let good = tutor_eval::assess_project(&phase, &solution).expect("graded");
    assert!(good.correctness.passed, "{}", good.correctness.raw);

    // The grading namespaces are deleted (they may still be terminating: wait a little).
    let kubectl = tutor_eval::tool_runner::find_tool(tutor_core::toolcheck::Tool::Kubectl).unwrap();
    let mut left = String::new();
    for _ in 0..60 {
        let r = kindbox::run(
            kindbox::kubectl(
                &sb,
                &kubectl,
                None,
                &[
                    "get".into(),
                    "namespaces".into(),
                    "-l".into(),
                    kindbox::GRADING_LABEL.into(),
                    "-o".into(),
                    "name".into(),
                ],
            ),
            Duration::from_secs(30),
        )
        .unwrap();
        left = r.stdout.trim().to_string();
        if left.is_empty() {
            break;
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    assert!(left.is_empty(), "grading namespaces left: {left}");

    if !existed {
        let _lock = kindbox::lock(&sb).unwrap();
        let d = kindbox::delete_cluster(&sb).unwrap();
        eprintln!("deleted the practice cluster in {:.1} s", d.secs);
        assert!(d.existed);
        assert!(
            !sb.kubeconfig.exists(),
            "the kubeconfig goes with the cluster"
        );
        assert!(
            !sb.runtime.exists(),
            "the runtime folder (and Podman's pause process) go too"
        );
        assert!(!sb.state.exists());
        assert!(!kindbox::status(&sb).unwrap().exists);
        // Asking kind itself starts the sandbox's Podman again: ask, then leave it as found.
        assert!(
            kindbox::clusters(&sb).unwrap().is_empty(),
            "no cluster in the sandbox"
        );
        kindbox::podman::stop_pause(&sb);
        let _ = std::fs::remove_dir_all(&sb.runtime);
    }
}
