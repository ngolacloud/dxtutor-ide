//! Comandos IPC de estudo (secção 3) — adaptadores finos sobre o caso de uso Tauri-free
//! `crate::study`.
//!
//! Nenhuma regra vive aqui. A classificação de passos, a política de estudo, o carregamento
//! de conteúdo (com o erro tipado [`study::StudyError`]) e a avaliação honesta
//! (`grade_phase`/`grade_step`, que reusam `tutor_eval::assess`) estão no caso de uso. Os
//! adaptadores só fazem a fronteira IPC: `spawn_blocking` onde o trabalho compila/corre
//! código (nunca na thread da janela), mapeamento do erro → `String` só na fronteira (o
//! `Display` de `StudyError` reproduz as mensagens históricas; o `join` da tarefa pelo seu
//! `to_string`), e a montagem dos DTOs (`crate::*_dto` + os `pub(crate)` de `lib.rs`).
//!
//! Os provedores LLM de `request_hint`/`request_plan`/`request_fix` vivem aqui (constroem o
//! pedido `tutor_llm` e chamam `default_*_provider`), porque é infra de fronteira; a *regra*
//! offline da sugestão curada e o contexto do passo ficam no caso de uso
//! (`study::curated_hint`/`hint_context`). Comportamento idêntico ao anterior — mesmos nomes,
//! args, contratos serde e mensagens de erro.
//!
//! Nenhum destes comandos é hoje invocado pela `ui-app`; preservam-se por serem contrato
//! público do «cérebro» dxtutor (origem do protótipo de estudo / consumido por `ui-next`).

use crate::study;
use crate::{
    assessment_dto, course_dto, course_summary_dto, glossary_dto, project_dto, study_guide_dto,
    AssessmentDto, CourseDto, CourseSummaryDto, GlossaryDto, HintDto, PlanDto, ProjectDto,
    StudyGuideDto,
};
use tutor_llm::policy::StudyPolicy;
use tutor_llm::{
    default_fix_provider, default_plan_provider, default_provider, FixRequest, HintRequest,
    PlanRequest,
};

/// List the project title and its phases (shown in the sidebar as "files").
#[tauri::command]
pub fn list_phases() -> Result<ProjectDto, String> {
    study::load_project()
        .map(|p| project_dto(&p))
        .map_err(|e| e.to_string())
}

/// Evaluate the student's code for a phase: run the hidden tests (source of
/// truth) and, on pass, measure complexity. Reveal the curated gabarito.
#[tauri::command]
pub async fn submit(phase_id: String, code: String) -> Result<AssessmentDto, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<AssessmentDto, String> {
        let (assessment, phase) =
            study::grade_phase(&phase_id, &code).map_err(|e| e.to_string())?;
        Ok(assessment_dto(&assessment, &phase))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Produce a progressive hint (level 1..3) for a guided-course step. Offline-safe:
/// without `ANTHROPIC_API_KEY` the OfflineProvider returns a useful generic message.
#[tauri::command]
pub fn request_hint(phase_id: String, code: String, level: u8) -> Result<HintDto, String> {
    // Prefer a curated, offline progressive hint when the phase ships one (e.g. the
    // "count characters" scenario). Deterministic and model-free — the essential path
    // works with no provider. Falls through to the provider otherwise.
    if let Some((text, level)) = study::curated_hint(&phase_id, level) {
        return Ok(HintDto {
            text,
            provider: "curated".to_string(),
            level,
        });
    }

    let (instructions, entry) = study::hint_context(&phase_id);
    let req = HintRequest {
        instructions,
        entry,
        student_code: code,
        test_output: None,
        level,
    };
    let provider = default_provider();
    let text = provider
        .hint(&req)
        .map_err(|e| format!("hint provider failed: {e}"))?;

    Ok(HintDto {
        text,
        provider: provider.name().to_string(),
        level: req.level(),
    })
}

/// Turn a "what I want to solve" comment into a high-level PLAN (steps, no code)
/// so the student types the solution themselves. Offline-safe.
#[tauri::command]
pub fn request_plan(phase_id: String, comment: String, code: String) -> Result<PlanDto, String> {
    let phase = study::load_phase(&phase_id).map_err(|e| e.to_string())?;
    let req = PlanRequest {
        language: phase.language.clone(),
        comment,
        context_code: code,
    };
    let plan = default_plan_provider()
        .plan(&req)
        .map_err(|e| format!("plan provider failed: {e}"))?;
    Ok(PlanDto { steps: plan.steps })
}

/// Explain a single diagnostic and how to fix THAT line — never rewrites the
/// whole function or solves the exercise. Offline-safe.
#[tauri::command]
pub fn request_fix(
    phase_id: String,
    code: String,
    line: u32,
    message: String,
) -> Result<String, String> {
    let phase = study::load_phase(&phase_id).map_err(|e| e.to_string())?;
    let req = FixRequest {
        language: phase.language.clone(),
        code,
        line,
        message,
    };
    default_fix_provider()
        .fix_suggestion(&req)
        .map_err(|e| format!("fix provider failed: {e}"))
}

/// Load the guided course for a language (e.g. `"rust"`). Returns the course
/// tree (units → steps) the beginner mode renders. With `subject` (optional, backwards
/// compatible), the course of that framework/tool instead (e.g. `"django"`).
#[tauri::command]
pub fn get_course(language: String, subject: Option<String>) -> Result<CourseDto, String> {
    study::course_for(&language, subject.as_deref())
        .map(|c| course_dto(&c))
        .map_err(|e| e.to_string())
}

/// List every built-in course (one per language curriculum) so the onboarding can
/// build its language picker dynamically, instead of hard-coding which languages
/// are available. Adding a course (or a plugin language with a course) makes it
/// appear without any frontend change.
#[tauri::command]
pub fn list_courses() -> Vec<CourseSummaryDto> {
    study::courses()
        .into_iter()
        .map(course_summary_dto)
        .collect()
}

/// The active study policy for the given mode + step. The frontend uses it to hide
/// solution/buffer-writing surfaces while an exercise is open (defence in depth); the
/// backend commands enforce the same policy regardless of what the UI shows.
#[tauri::command]
pub fn study_policy(mode: String, step_id: Option<String>) -> StudyPolicy {
    study::study_policy(&mode, step_id.as_deref())
}

/// Grade a `challenge` step: find it across the courses' units, build a `Phase`
/// from it and reuse the honest evaluator (`tutor_eval::assess`). `language` (optional,
/// backwards compatible) narrows the search to that language's courses: step ids repeat
/// across languages. `files` (optional) grades a project step with the learner's editable
/// files (path → content); without it, `code` is the single file (the main file of a project).
#[tauri::command]
pub async fn submit_step(
    step_id: String,
    code: String,
    language: Option<String>,
    files: Option<std::collections::BTreeMap<String, String>>,
) -> Result<AssessmentDto, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<AssessmentDto, String> {
        let (assessment, phase) = match &files {
            Some(files) => study::grade_step_files(&step_id, language.as_deref(), files),
            None => study::grade_step_in(&step_id, language.as_deref(), &code),
        }
        .map_err(|e| e.to_string())?;
        Ok(assessment_dto(&assessment, &phase))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Load the curated glossary for a language (e.g. `"rust"`). Each entry explains
/// a reserved word or core item: what it does, when to use it, and an example.
#[tauri::command]
pub fn get_glossary(language: String) -> Result<GlossaryDto, String> {
    study::glossary(&language)
        .map(glossary_dto)
        .map_err(|e| e.to_string())
}

/// Load the remediation study guide for a unit (e.g. `"u1-hello"`) in a language.
/// Shown to a struggling learner so they can re-read the unit's concepts calmly.
#[tauri::command]
pub fn get_study_guide(language: String, unit_id: String) -> Result<StudyGuideDto, String> {
    study::study_guide(&language, &unit_id)
        .map(study_guide_dto)
        .map_err(|e| e.to_string())
}
