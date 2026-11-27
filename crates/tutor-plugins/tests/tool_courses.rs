//! Os cursos de ferramentas (Learn P2b): os plugins oficiais de Kubernetes e do Delonix validam-se
//! sem erros, e a validação recusa um `checks.toml` que corra um comando fora da lista permitida,
//! que nomeie um ficheiro que o passo não tem, ou um desafio de um só ficheiro num curso `yaml`.

use std::path::{Path, PathBuf};

use tutor_plugins::{validate_dir, Taken};

const HOST: &str = "0.7.0";

fn course_dir(id: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("../../courses/{id}"))
}

/// Valida contra um registo SEM os embutidos de ferramentas (os próprios cursos oficiais estão
/// embutidos, e um plugin com o mesmo id de curso substitui-o — o que é permitido).
fn report(dir: &Path) -> tutor_plugins::Report {
    let builtin: Vec<_> = tutor_core::builtin_courses()
        .into_iter()
        .filter(|c| !tutor_core::toolcheck::graded_by_checks(&c.language))
        .collect();
    validate_dir(dir, HOST, &Taken::builtin(&builtin))
}

#[test]
fn the_official_tool_courses_are_valid() {
    for (id, steps) in [("kubernetes", 44), ("delonix", 36)] {
        let r = report(&course_dir(id));
        assert!(r.errors.is_empty(), "{id}: {:#?}", r.errors);
        assert!(r.warnings.is_empty(), "{id}: {:#?}", r.warnings);
        let c = &r.courses[0];
        assert_eq!(c.language, "yaml");
        assert_eq!(c.category, tutor_core::CourseCategory::Tool);
        assert_eq!(c.subject, id);
        let n: usize = c.units.iter().map(|u| u.steps.len()).sum();
        assert_eq!(n, steps, "{id}");
    }
}

/// Uma cópia do curso de Kubernetes com `edit` aplicado ao TOML.
fn mutated(edit: impl Fn(&str) -> String) -> tempfile::TempDir {
    let src = course_dir("kubernetes");
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("courses")).unwrap();
    std::fs::copy(
        src.join("dxtutor-plugin.json"),
        dir.path().join("dxtutor-plugin.json"),
    )
    .unwrap();
    let toml = std::fs::read_to_string(src.join("courses/kubernetes.toml")).unwrap();
    std::fs::write(dir.path().join("courses/kubernetes.toml"), edit(&toml)).unwrap();
    dir
}

#[test]
fn a_command_outside_the_allow_list_is_a_validation_error() {
    let d = mutated(|t| {
        t.replacen(
            r#"cmd = ["kubectl", "kustomize", "overlays/prod"]"#,
            r#"cmd = ["kubectl", "apply", "--dry-run=client", "-f", "overlays/prod"]"#,
            1,
        )
    });
    let e = report(d.path()).errors.join("\n");
    assert!(
        e.contains("step `k8s-p10-overlay`") && e.contains("is not allowed in a check"),
        "{e}"
    );
}

#[test]
fn a_check_on_a_file_the_step_does_not_have_is_an_error() {
    let d = mutated(|t| t.replacen(r#"file = "pod.yaml""#, r#"file = "pods.yml""#, 1));
    let e = report(d.path()).errors.join("\n");
    assert!(
        e.contains("step `k8s-p1-pod`") && e.contains("`pods.yml` is not a file of the step"),
        "{e}"
    );
}

#[test]
fn a_single_file_challenge_in_a_yaml_course_is_an_error() {
    let single = r#"
[[unit.step]]
kind = "challenge"
id = "k8s-x-single"
title = "Single file"
points = 5
instructions = "Write it."
entry = "pod.yaml"
starter = "kind: Pod\n"
tests = "[[check]]\n"

[unit.step.gabarito]
solution = "kind: Pod\n"
time = ""
space = ""
justification = ""
"#;
    let d = mutated(|t| format!("{t}{single}"));
    let e = report(d.path()).errors.join("\n");
    assert!(
        e.contains("step `k8s-x-single`: a course graded by checks (`yaml`) uses project steps"),
        "{e}"
    );
}
