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
pub async fn list_phases() -> Result<ProjectDto, String> {
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

/// Whether the study helpers may call Anthropic directly: not when the model-call policy
/// requires the organisation's gateway. They then answer offline (curated and generic hints)
/// instead of failing — the essential path works with no provider.
async fn remote_allowed() -> bool {
    tauri::async_runtime::spawn_blocking(|| crate::llm_policy::check("claude", None, None).is_ok())
        .await
        .unwrap_or(false)
}

async fn hint_provider() -> Box<dyn tutor_llm::HintProvider> {
    if remote_allowed().await {
        default_provider()
    } else {
        Box::new(tutor_llm::OfflineProvider)
    }
}

async fn plan_provider() -> Box<dyn tutor_llm::PlanProvider> {
    if remote_allowed().await {
        default_plan_provider()
    } else {
        Box::new(tutor_llm::OfflineProvider)
    }
}

async fn fix_provider() -> Box<dyn tutor_llm::FixProvider> {
    if remote_allowed().await {
        default_fix_provider()
    } else {
        Box::new(tutor_llm::OfflineProvider)
    }
}

/// Produce a progressive hint (level 1..3) for a guided-course step. Offline-safe:
/// without `ANTHROPIC_API_KEY` the OfflineProvider returns a useful generic message.
#[tauri::command]
pub async fn request_hint(phase_id: String, code: String, level: u8) -> Result<HintDto, String> {
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
    let provider = hint_provider().await;
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
pub async fn request_plan(
    phase_id: String,
    comment: String,
    code: String,
) -> Result<PlanDto, String> {
    let phase = study::load_phase(&phase_id).map_err(|e| e.to_string())?;
    let req = PlanRequest {
        language: phase.language.clone(),
        comment,
        context_code: code,
    };
    let plan = plan_provider()
        .await
        .plan(&req)
        .map_err(|e| format!("plan provider failed: {e}"))?;
    Ok(PlanDto { steps: plan.steps })
}

/// Explain a single diagnostic and how to fix THAT line — never rewrites the
/// whole function or solves the exercise. Offline-safe.
#[tauri::command]
pub async fn request_fix(
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
    fix_provider()
        .await
        .fix_suggestion(&req)
        .map_err(|e| format!("fix provider failed: {e}"))
}

/// Load the guided course for a language (e.g. `"rust"`). Returns the course
/// tree (units → steps) the beginner mode renders. With `subject` (optional, backwards
/// compatible), the course of that framework/tool instead (e.g. `"django"`).
#[tauri::command]
pub async fn get_course(language: String, subject: Option<String>) -> Result<CourseDto, String> {
    study::course_for(&language, subject.as_deref())
        .map(|c| course_dto(&c))
        .map_err(|e| e.to_string())
}

/// List every built-in course (one per language curriculum) so the onboarding can
/// build its language picker dynamically, instead of hard-coding which languages
/// are available. Adding a course (or a plugin language with a course) makes it
/// appear without any frontend change.
#[tauri::command]
pub async fn list_courses() -> Vec<CourseSummaryDto> {
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
pub async fn get_glossary(language: String) -> Result<GlossaryDto, String> {
    study::glossary(&language)
        .map(glossary_dto)
        .map_err(|e| e.to_string())
}

/// Load the remediation study guide for a unit (e.g. `"u1-hello"`) in a language.
/// Shown to a struggling learner so they can re-read the unit's concepts calmly.
#[tauri::command]
pub async fn get_study_guide(language: String, unit_id: String) -> Result<StudyGuideDto, String> {
    study::study_guide(&language, &unit_id)
        .map(study_guide_dto)
        .map_err(|e| e.to_string())
}

// ── Preparar um curso (Learn P1): a única porta para a rede, aprovada pelo humano ────────

/// What the Learning Track shows about preparing a course whose grading runs offline against a
/// course cache (`[build] prepare = true`).
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoursePrepareDto {
    /// The course needs a one-time preparation.
    pub needed: bool,
    /// `not-needed`, `missing`, `stale` or `ready`.
    pub state: String,
    /// The exact commands to approve (empty when nothing to prepare).
    pub command: String,
    /// The package manager of the course cache: `cargo` or `pip` (empty when nothing to
    /// prepare).
    pub kind: String,
    /// The packages the preparation downloads (name, version, source, exact or not), listed in
    /// the approval dialog: a third-party course can declare any dependency.
    pub packages: Vec<tutor_eval::course_cache::Package>,
    /// The course cache folder (the approval's scope and the audit row's root).
    pub dir: String,
    /// Wall-clock limit (s) of each build of this course (0 = the evaluator's default).
    pub timeout_secs: u64,
    /// When it was prepared (s since the epoch), and the measured times.
    pub prepared_at: Option<u64>,
    pub fetch_secs: Option<f64>,
    pub warm_secs: Option<f64>,
}

fn prepare_dto(st: &study::PrepareStatus) -> CoursePrepareDto {
    CoursePrepareDto {
        needed: st.needed,
        state: st.state.to_string(),
        command: st
            .plan
            .as_ref()
            .map(|p| p.command.clone())
            .unwrap_or_default(),
        kind: st
            .plan
            .as_ref()
            .map(|p| p.kind.as_str().to_string())
            .unwrap_or_default(),
        packages: st
            .plan
            .as_ref()
            .map(|p| p.packages.clone())
            .unwrap_or_default(),
        dir: st
            .plan
            .as_ref()
            .map(|p| p.layout.dir.display().to_string())
            .unwrap_or_default(),
        timeout_secs: st.timeout_secs,
        prepared_at: st.marker.as_ref().map(|m| m.prepared_at),
        fetch_secs: st.marker.as_ref().map(|m| m.fetch_secs),
        warm_secs: st.marker.as_ref().map(|m| m.warm_secs),
    }
}

fn cache_root() -> Result<std::path::PathBuf, String> {
    tutor_eval::course_cache::root()
        .ok_or_else(|| "cannot find the user data folder for the course cache".to_string())
}

/// Whether a course must be prepared before grading, its state, and the exact commands that
/// preparing it runs (built here; the UI shows them in the approval dialog).
#[tauri::command]
pub async fn course_prepare_status(course_id: String) -> Result<CoursePrepareDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = cache_root()?;
        study::prepare_status_in(&study::all_courses(), &course_id, &root)
            .map(|st| prepare_dto(&st))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The human's decision in the approval dialog: the command they saw, and why.
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrepareDecision {
    pub command: String,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub decided_at: Option<i64>,
}

/// The result of preparing a course.
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoursePreparedDto {
    pub ok: bool,
    /// The last lines of the commands' output (shown when it fails).
    pub output: String,
    pub status: CoursePrepareDto,
}

/// Prepares a course: downloads its dependencies (the ONLY network step of the Learning Track)
/// into the course cache and builds them once, running exactly the commands of
/// `course_prepare_status` — refused when the approved command is not the current one. The run
/// goes to the audit log first (an approval that cannot be audited does not run) and again with
/// the result. A refusal in the dialog is recorded by the UI (`audit_record`).
#[tauri::command]
pub async fn course_prepare(
    app: tauri::AppHandle,
    course_id: String,
    decision: PrepareDecision,
) -> Result<CoursePreparedDto, String> {
    // Everything here blocks (the course list, the audit log, cargo): off the async runtime.
    tauri::async_runtime::spawn_blocking(move || prepare_blocking(&app, &course_id, &decision))
        .await
        .map_err(|e| e.to_string())?
}

fn prepare_blocking(
    app: &tauri::AppHandle,
    course_id: &str,
    decision: &PrepareDecision,
) -> Result<CoursePreparedDto, String> {
    let root = cache_root()?;
    let plan = study::approved_plan_in(&study::all_courses(), course_id, &root, &decision.command)
        .map_err(|e| e.to_string())?;
    let dir = plan.layout.dir.display().to_string();
    std::fs::create_dir_all(&plan.layout.dir).map_err(|e| format!("{dir}: {e}"))?;
    let row = |outcome: &str| crate::board::IdeAudit {
        feature: "learn".into(),
        action: "course.prepare".into(),
        command: plan.command.clone(),
        scope: Some(format!("course {course_id} · {dir}")),
        approved: true,
        reason: decision.reason.clone().filter(|r| !r.trim().is_empty()),
        outcome: Some(outcome.into()),
        decided_at: decision.decided_at,
    };
    crate::board::record_ide_audit(app, &dir, &row("sent"))
        .map_err(|e| format!("not audited, nothing ran: {}", e.message))?;
    let done = match tutor_eval::course_cache::prepare(&plan) {
        Ok(d) => d,
        Err(e) => {
            let _ = crate::board::record_ide_audit(app, &dir, &row("failed"));
            return Err(e.to_string());
        }
    };
    let _ = crate::board::record_ide_audit(app, &dir, &row(if done.ok { "ok" } else { "failed" }));
    let status = study::prepare_status_in(&study::all_courses(), course_id, &root)
        .map(|st| prepare_dto(&st))
        .map_err(|e| e.to_string())?;
    let tail: Vec<&str> = done.output.lines().rev().take(40).collect();
    Ok(CoursePreparedDto {
        ok: done.ok,
        output: tail.into_iter().rev().collect::<Vec<_>>().join("\n"),
        status,
    })
}

// ── O cluster de prática dos cursos de Kubernetes (Learn P3b) ────────────────────────────

/// What the Learning Track shows about a course's practice cluster (kind on rootless Podman).
#[derive(serde::Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClusterDto {
    /// The course has steps checked live in the practice cluster.
    pub live: bool,
    /// The course is prepared (kind, the node image and the step images are downloaded).
    pub prepared: bool,
    /// Whether this machine can run the cluster (Podman, cgroup v2, delegation, user
    /// namespaces, D-Bus), and why not.
    pub support: tutor_eval::kindbox::Support,
    /// The cluster now (only when prepared and supported).
    pub status: Option<tutor_eval::kindbox::ClusterStatus>,
    /// The exact commands the approval dialog shows for «Start practice cluster» and «Delete
    /// cluster».
    pub start_command: String,
    pub delete_command: String,
    /// The sandbox folder (the approval's scope and the audit row's root).
    pub dir: String,
    pub idle_minutes: u64,
}

fn cluster_dto(course_id: &str) -> Result<ClusterDto, String> {
    let root = cache_root()?;
    let found =
        study::cluster_of(&study::all_courses(), course_id, &root).map_err(|e| e.to_string())?;
    let support = tutor_eval::kindbox::probe();
    let Some((sb, prepared)) = found else {
        return Ok(ClusterDto {
            live: false,
            prepared: false,
            support,
            status: None,
            start_command: String::new(),
            delete_command: String::new(),
            dir: String::new(),
            idle_minutes: tutor_eval::kindbox::IDLE_SECS / 60,
        });
    };
    let status = if prepared && support.ok {
        Some(tutor_eval::kindbox::status(&sb).map_err(|e| e.to_string())?)
    } else {
        None
    };
    Ok(ClusterDto {
        live: true,
        prepared,
        support,
        status,
        start_command: tutor_eval::kindbox::start_command_text(&sb),
        delete_command: tutor_eval::kindbox::delete_command_text(&sb),
        dir: sb.dir.display().to_string(),
        idle_minutes: tutor_eval::kindbox::IDLE_SECS / 60,
    })
}

/// The practice cluster of a course: whether it is live, prepared, supported here, and the
/// cluster's state (reads only; nothing is created).
#[tauri::command]
pub async fn learn_cluster_status(course_id: String) -> Result<ClusterDto, String> {
    tauri::async_runtime::spawn_blocking(move || cluster_dto(&course_id))
        .await
        .map_err(|e| e.to_string())?
}

/// Which practice-cluster action the human approved.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ClusterAction {
    Start,
    Delete,
}

fn cluster_blocking(
    app: &tauri::AppHandle,
    course_id: &str,
    decision: &PrepareDecision,
    action: ClusterAction,
) -> Result<ClusterDto, String> {
    let root = cache_root()?;
    let (sb, prepared) = study::cluster_of(&study::all_courses(), course_id, &root)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("course {course_id} has no live steps"))?;
    let command = match action {
        ClusterAction::Start => tutor_eval::kindbox::start_command_text(&sb),
        ClusterAction::Delete => tutor_eval::kindbox::delete_command_text(&sb),
    };
    if command != decision.command {
        return Err("the approved command is not this cluster's current one; ask again".into());
    }
    if action == ClusterAction::Start && !prepared {
        return Err(tutor_eval::course_cache::not_prepared_message(
            &sb.key, false,
        ));
    }
    let dir = sb.dir.display().to_string();
    std::fs::create_dir_all(&sb.dir).map_err(|e| format!("{dir}: {e}"))?;
    let row = |outcome: &str| crate::board::IdeAudit {
        feature: "learn".into(),
        action: match action {
            ClusterAction::Start => "cluster.start",
            ClusterAction::Delete => "cluster.delete",
        }
        .into(),
        command: command.clone(),
        scope: Some(format!("course {course_id} · cluster {} · {dir}", sb.name)),
        approved: true,
        reason: decision.reason.clone().filter(|r| !r.trim().is_empty()),
        outcome: Some(outcome.into()),
        decided_at: decision.decided_at,
    };
    crate::board::record_ide_audit(app, &dir, &row("sent"))
        .map_err(|e| format!("not audited, nothing ran: {}", e.message))?;
    let result = (|| -> Result<(), String> {
        let _lock = tutor_eval::kindbox::lock(&sb).map_err(|e| e.to_string())?;
        match action {
            ClusterAction::Start => {
                let kubectl =
                    tutor_eval::tool_runner::find_tool(tutor_core::toolcheck::Tool::Kubectl)
                        .ok_or("kubectl is not installed")?;
                tutor_eval::kindbox::ensure(&sb, &kubectl).map_err(|e| e.to_string())?;
            }
            ClusterAction::Delete => {
                tutor_eval::kindbox::delete_cluster(&sb).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    })();
    let _ = crate::board::record_ide_audit(
        app,
        &dir,
        &row(if result.is_ok() { "ok" } else { "failed" }),
    );
    result?;
    cluster_dto(course_id)
}

/// «Start practice cluster»: creates (or reuses) the course's kind cluster and loads the step
/// images, running exactly the approved commands; audited before and with the result.
#[tauri::command]
pub async fn learn_cluster_start(
    app: tauri::AppHandle,
    course_id: String,
    decision: PrepareDecision,
) -> Result<ClusterDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cluster_blocking(&app, &course_id, &decision, ClusterAction::Start)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// «Delete cluster»: deletes the course's kind cluster, its kubeconfig and network (the prepared
/// images stay); audited before and with the result.
#[tauri::command]
pub async fn learn_cluster_delete(
    app: tauri::AppHandle,
    course_id: String,
    decision: PrepareDecision,
) -> Result<ClusterDto, String> {
    tauri::async_runtime::spawn_blocking(move || {
        cluster_blocking(&app, &course_id, &decision, ClusterAction::Delete)
    })
    .await
    .map_err(|e| e.to_string())?
}
