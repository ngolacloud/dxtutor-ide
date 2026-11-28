//! O avaliador dos cursos que corre DENTRO do devcontainer do curso (ADR-0008).
//!
//! A IDE já não avalia no seu processo: monta o curso só de leitura no contentor do curso, corre
//! `dxtutor-grade` com um [`GradeRequest`] no stdin e lê o [`GradeReport`] do stdout. Este crate
//! é esse lado: encontra o passo no curso da pasta, constrói o `Phase` (com os ficheiros de apoio)
//! e avalia-o com o mesmo motor de sempre (`tutor_eval::assess`/`assess_project`), agora com as
//! ferramentas do contentor em vez das da máquina do aluno.
//!
//! Corre sempre no próprio contentor (motor `Host` do `tutor_eval`): nunca lança outro contentor
//! lá de dentro.

use std::path::Path;

use tutor_core::grade::{
    codes, Complexity, Correctness, GradeError, GradeReport, GradeRequest, Outcome, Submission,
    GRADE_PROTOCOL,
};
use tutor_core::{Course, Level};

/// Quem avalia, como aparece em [`GradeReport::grader`].
pub const GRADER: &str = concat!("dxtutor-grade ", env!("CARGO_PKG_VERSION"));

/// Onde o devcontainer do curso monta o curso (só de leitura), por omissão.
pub const DEFAULT_COURSE_DIR: &str = "/dxtutor/course";

/// Avalia o pedido `raw` (JSON) contra o curso da pasta `dir`. Devolve sempre um relatório: um
/// pedido ou um curso inválido é um relatório com `outcome: error`, nunca um pânico.
pub fn grade_dir(dir: &Path, raw: &str) -> GradeReport {
    let req = match GradeRequest::parse(raw) {
        Ok(r) => r,
        Err(e) => return GradeReport::failure(step_of(raw), e, GRADER),
    };
    let courses = match tutor_plugins::load_dir(dir) {
        Ok((_, courses)) => courses,
        Err(e) => {
            return GradeReport::failure(
                req.step,
                GradeError::new(codes::COURSE_INVALID, e),
                GRADER,
            )
        }
    };
    grade(&courses, &req)
}

/// Avalia `req` contra `courses` (as regras do `study::grade_in` da IDE, que este avaliador
/// substitui).
pub fn grade(courses: &[Course], req: &GradeRequest) -> GradeReport {
    // Já estamos no contentor do curso: o motor do `tutor_eval` é a própria máquina.
    tutor_eval::set_engine(tutor_eval::SandboxEngine::Host);
    let fail = |e: GradeError| GradeReport::failure(req.step.clone(), e, GRADER);
    let wanted = req
        .language
        .as_deref()
        .map(|l| l.trim().to_ascii_lowercase());
    let found = courses.iter().find_map(|c| {
        if wanted
            .as_deref()
            .is_some_and(|l| !c.language.eq_ignore_ascii_case(l))
        {
            return None;
        }
        c.step(&req.step).map(|s| (c, s))
    });
    let Some((course, step)) = found else {
        let within = req
            .language
            .as_deref()
            .map(|l| format!(" in the {l} course"))
            .unwrap_or_default();
        return fail(GradeError::new(
            codes::STEP_NOT_FOUND,
            format!("no step `{}`{within} in this course folder", req.step),
        ));
    };
    let Some(phase) = course.phase(step, Level::Basico) else {
        return fail(GradeError::new(
            codes::NOT_A_CHALLENGE,
            format!("step `{}` is not a challenge", req.step),
        ));
    };
    // Sem avaliador para a linguagem, o `tutor_eval` cairia no Rust: melhor dizê-lo.
    if !tutor_eval::language_supported(&course.language) {
        return fail(GradeError::new(
            codes::LANGUAGE_UNSUPPORTED,
            format!("{GRADER} cannot grade {} yet", course.language),
        ));
    }
    if let Some(cache) = &phase.build.cache {
        if tutor_core::livecheck::phase_needs_cache(&phase) {
            if let Err(e) = prepared(cache) {
                return fail(e);
            }
        }
    }
    let assessed = match &req.submission {
        Submission::Code { code } => tutor_eval::assess(&phase, code),
        Submission::Files { files } => {
            if phase.project.is_none() {
                return fail(GradeError::new(
                    codes::NOT_A_PROJECT,
                    format!("step `{}` takes one file, not a project", req.step),
                ));
            }
            tutor_eval::assess_project(&phase, files)
        }
    };
    let a = match assessed {
        Ok(a) => a,
        Err(e) => return fail(classify(&e)),
    };
    GradeReport {
        protocol: GRADE_PROTOCOL,
        step: req.step.clone(),
        course: Some(course.id.clone()),
        outcome: if a.correctness.passed {
            Outcome::Passed
        } else {
            Outcome::Failed
        },
        correctness: Some(Correctness {
            passed: a.correctness.passed,
            summary: a.correctness.summary,
            raw: a.correctness.raw,
        }),
        complexity: a.complexity.as_ref().map(complexity),
        expected: a.expected.map(|c| c.big_o().to_string()),
        error: None,
        grader: GRADER.to_string(),
    }
}

/// Recusa um curso cuja cache de dependências não está pronta neste contentor.
fn prepared(cache: &tutor_core::CourseCache) -> Result<(), GradeError> {
    use tutor_eval::course_cache::{not_prepared_message, root, status, Status};
    let not = |stale| {
        GradeError::new(
            codes::COURSE_NOT_PREPARED,
            not_prepared_message(&cache.key, stale),
        )
    };
    let root = root().ok_or_else(|| not(false))?;
    match status(&root, cache) {
        Ok(Status::Ready(_)) => Ok(()),
        Ok(Status::Missing) => Err(not(false)),
        Ok(Status::Stale(_)) => Err(not(true)),
        Err(e) => Err(GradeError::new(codes::EVAL, e.to_string())),
    }
}

/// O código de um erro do motor: as recusas conhecidas começam pelo seu código.
fn classify(e: &anyhow::Error) -> GradeError {
    let text = format!("{e:#}");
    for code in [codes::COURSE_NOT_PREPARED, codes::LIVE_UNAVAILABLE] {
        if e.chain().any(|c| c.to_string().starts_with(code)) {
            return GradeError::new(code, text);
        }
    }
    GradeError::new(codes::EVAL, text)
}

fn complexity(est: &tutor_eval::Estimate) -> Complexity {
    Complexity {
        big_o: est.big_o().to_string(),
        r_squared: finite(est.r_squared),
        exponent: finite(est.loglog_exponent),
        confidence: match est.confidence {
            tutor_eval::Confidence::Low => "low",
            tutor_eval::Confidence::Medium => "medium",
            tutor_eval::Confidence::High => "high",
        }
        .to_string(),
        ranking: est
            .ranking
            .iter()
            .map(|(class, r2)| (class.big_o().to_string(), finite(*r2)))
            .collect(),
    }
}

/// O JSON não tem `NaN`/`∞` (sairiam como `null` e o relatório não se leria do outro lado).
fn finite(x: f64) -> f64 {
    if x.is_finite() {
        x
    } else {
        0.0
    }
}

/// O passo de um pedido que não se conseguiu ler, para o relatório o nomear quando dá.
fn step_of(raw: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|v| v.get("step").and_then(|s| s.as_str()).map(str::to_string))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tutor_core::StepKind;

    fn course_dir(id: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../courses")
            .join(id)
    }

    fn request(step: &str, language: Option<&str>, submission: Submission) -> String {
        serde_json::to_string(&GradeRequest::new(
            step,
            language.map(str::to_string),
            submission,
        ))
        .unwrap()
    }

    fn code(c: &str) -> Submission {
        Submission::Code { code: c.into() }
    }

    #[test]
    fn a_bad_request_or_course_is_a_report_never_a_panic() {
        let r = grade_dir(&course_dir("python"), "{");
        assert_eq!(r.outcome, Outcome::Error);
        assert_eq!(r.error.as_ref().unwrap().code, codes::BAD_REQUEST);
        assert!(r.check().is_ok());

        let r = grade_dir(&course_dir("python"), r#"{"protocol": 9, "step": "s1"}"#);
        assert_eq!(r.error.as_ref().unwrap().code, codes::PROTOCOL);
        assert_eq!(r.step, "s1", "the step is named when it can be read");

        let tmp = tempfile::tempdir().unwrap();
        let r = grade_dir(tmp.path(), &request("s1", None, code("")));
        assert_eq!(r.error.as_ref().unwrap().code, codes::COURSE_INVALID);
    }

    #[test]
    fn the_step_is_looked_up_in_the_requested_language_only() {
        let (_, courses) = tutor_plugins::load_dir(&course_dir("python")).unwrap();
        let step = courses[0]
            .units
            .iter()
            .flat_map(|u| &u.steps)
            .find(|s| s.kind == StepKind::Challenge)
            .unwrap()
            .id
            .clone();
        let req = GradeRequest::new(step.clone(), Some("go".into()), code(""));
        let r = grade(&courses, &req);
        assert_eq!(r.error.as_ref().unwrap().code, codes::STEP_NOT_FOUND);
        assert!(r.error.unwrap().message.contains("go course"));

        let r = grade(&courses, &GradeRequest::new("no-such-step", None, code("")));
        assert_eq!(r.error.unwrap().code, codes::STEP_NOT_FOUND);
    }

    #[test]
    fn files_for_a_one_file_step_are_refused_before_grading() {
        let (_, courses) = tutor_plugins::load_dir(&course_dir("python")).unwrap();
        let step = courses[0]
            .units
            .iter()
            .flat_map(|u| &u.steps)
            .find(|s| s.kind == StepKind::Challenge && s.project.is_none())
            .unwrap();
        let req = GradeRequest::new(
            step.id.clone(),
            Some("python".into()),
            Submission::Files {
                files: BTreeMap::from([("main.py".into(), String::new())]),
            },
        );
        assert_eq!(
            grade(&courses, &req).error.unwrap().code,
            codes::NOT_A_PROJECT
        );
    }

    #[test]
    fn a_step_that_is_not_a_challenge_says_so() {
        let (_, courses) = tutor_plugins::load_dir(&course_dir("python")).unwrap();
        let Some(step) = courses[0]
            .units
            .iter()
            .flat_map(|u| &u.steps)
            .find(|s| s.kind != StepKind::Challenge)
        else {
            return;
        };
        let r = grade(
            &courses,
            &GradeRequest::new(step.id.clone(), None, code("")),
        );
        assert_eq!(r.error.unwrap().code, codes::NOT_A_CHALLENGE);
    }

    #[test]
    fn known_refusals_keep_their_code() {
        let e =
            anyhow::anyhow!("COURSE_NOT_PREPARED: run Prepare course").context("building the step");
        assert_eq!(classify(&e).code, codes::COURSE_NOT_PREPARED);
        let e = anyhow::anyhow!("LIVE_UNAVAILABLE: no cgroup v2");
        assert_eq!(classify(&e).code, codes::LIVE_UNAVAILABLE);
        let e = anyhow::anyhow!("compiler crashed");
        assert_eq!(classify(&e).code, codes::EVAL);
    }

    #[test]
    fn non_finite_numbers_never_reach_the_json() {
        assert_eq!(finite(f64::NAN), 0.0);
        assert_eq!(finite(f64::INFINITY), 0.0);
        assert_eq!(finite(0.5), 0.5);
    }
}
