//! O binário `dxtutor-grade` de ponta a ponta: um pedido no stdin, um relatório no stdout, contra
//! um curso oficial do repositório. Precisa do `python3` (o avaliador corre as ferramentas da
//! máquina onde está, que no uso real é o devcontainer do curso); sem ele, salta com o motivo.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use tutor_core::grade::{codes, GradeReport, GradeRequest, Outcome, Submission, GRADE_PROTOCOL};
use tutor_core::StepKind;

fn course_dir(id: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../courses")
        .join(id)
}

/// O binário. O cargo diz onde está em `CARGO_BIN_EXE_dxtutor-grade`, mas um `RUSTC_WRAPPER` em
/// `sh` larga as variáveis com hífen; nesse caso está ao lado do teste (`target/<perfil>/`).
fn bin() -> PathBuf {
    option_env!("CARGO_BIN_EXE_dxtutor-grade")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let exe = std::env::current_exe().unwrap();
            exe.parent()
                .unwrap()
                .parent()
                .unwrap()
                .join("dxtutor-grade")
        })
}

fn run(args: &[&str], stdin: &str) -> (i32, String) {
    let mut child = Command::new(bin())
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    (
        out.status.code().unwrap_or(-1),
        String::from_utf8(out.stdout).unwrap(),
    )
}

#[test]
fn protocol_and_version_are_one_line_each() {
    let (code, out) = run(&["--protocol"], "");
    assert_eq!(code, 0);
    assert_eq!(out.trim(), GRADE_PROTOCOL.to_string());
    let (code, out) = run(&["--version"], "");
    assert_eq!(code, 0);
    assert!(out.starts_with("dxtutor-grade "), "{out}");
    let (code, out) = run(&["--nope"], "");
    assert_eq!(
        (code, out.as_str()),
        (2, ""),
        "bad arguments give no report"
    );
}

#[test]
fn an_error_report_exits_3_and_still_parses() {
    let dir = course_dir("python");
    let (code, out) = run(&["--course-dir", dir.to_str().unwrap()], "{");
    assert_eq!(code, 3);
    let r = GradeReport::parse(&out).unwrap();
    assert_eq!(r.error.unwrap().code, codes::BAD_REQUEST);
}

#[test]
fn the_python_course_passes_its_solution_and_fails_its_starter() {
    if Command::new("python3").arg("--version").output().is_err() {
        eprintln!("skipped: python3 is not on PATH (the course's devcontainer has it)");
        return;
    }
    let dir = course_dir("python");
    let (_, courses) = tutor_plugins::load_dir(&dir).unwrap();
    let step = courses[0]
        .units
        .iter()
        .flat_map(|u| &u.steps)
        .find(|s| s.kind == StepKind::Challenge && s.project.is_none() && s.gabarito.is_some())
        .expect("the python course has a one-file challenge");
    let ask = |code: &str| {
        serde_json::to_string(&GradeRequest::new(
            step.id.clone(),
            Some("python".into()),
            Submission::Code { code: code.into() },
        ))
        .unwrap()
    };
    let dir = dir.to_str().unwrap();

    let solution = &step.gabarito.as_ref().unwrap().solution;
    let (code, out) = run(&["--course-dir", dir], &ask(solution));
    let r = GradeReport::parse(&out).unwrap();
    assert_eq!((code, r.outcome), (0, Outcome::Passed), "{out}");
    assert_eq!(r.course.as_deref(), Some(courses[0].id.as_str()));
    assert!(
        !out.contains(solution.trim()),
        "the report never carries the solution"
    );

    let (code, out) = run(&["--course-dir", dir], &ask(&step.starter));
    let r = GradeReport::parse(&out).unwrap();
    assert_eq!((code, r.outcome), (0, Outcome::Failed), "{out}");
    assert!(
        !r.correctness.unwrap().raw.is_empty(),
        "the failure says what failed"
    );
}
