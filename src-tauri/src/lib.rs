//! dxtutor IDE — Tauri backend.
//!
//! Exposes the dxtutor "brain" (the `tutor-*` crates) to the webview through a
//! handful of Tauri commands, and bridges an embedded xterm terminal to a real
//! PTY. Every command serializes with serde_json and handles errors without
//! panicking (results come back as `Result<_, String>`).
//!
//! Honesty principle: `submit` reports correctness strictly from the hidden
//! tests (`tutor_eval::assess`), exposes the empirical complexity estimate with
//! its R²/confidence, and only ships the curated gabarito. `request_hint` uses
//! the offline-safe provider when no API key is present.

pub mod agent;
pub mod arch_rules;
pub mod assistant;
pub mod backlog;
mod board;
mod bridge;
pub mod codeintel;
pub mod codev;
pub mod codev_agent;
mod codev_autonomy;
mod codev_pr;
mod codev_review;
mod codev_worktree;
mod commands;
pub mod debug;
pub mod devcontainer;
pub mod dictation;
pub mod eval;
mod fsops;
pub mod gitops;
pub mod headless;
pub mod ide_tool;
mod keys;
mod llm;
mod lsp;
pub mod missions;
pub mod pair;
pub mod ports;
pub mod problems;
mod procs;
mod pty;
pub mod review;
pub mod roles;
pub mod sandbox;
pub mod schedule;
pub mod search;
mod shell_integration;
pub mod shellenv;
pub mod study;
pub mod testexec;
mod vsix;
pub mod workspace;

// Comandos extraídos para `commands/<feature>.rs` (Etapa 3). Importados por nome
// para o registo de handlers abaixo continuar a referenciá-los sem prefixo de módulo.
use commands::agent::{
    adr_accept, adr_list, agent_isolated_patch, agent_task_cancel, agent_task_status,
    agent_task_submit, arch_conformance, arch_export_mermaid, arch_import_mermaid,
    arch_rules_commit, arch_rules_load, arch_rules_save, arch_save_export, arch_scaffold,
    arch_scaffold_preview, arch_validate,
};
use commands::assistant::{
    assistant_cancel, assistant_chat, assistant_chat_stream, assistant_models, get_diagnostics,
    get_providers_config, list_providers, save_providers_config,
};
use commands::codebase::{deps_report, onboard_map};
use commands::codeintel::{
    diff_lines, file_outline, list_symbols, project_entrypoint, propose_entrypoint,
    resolve_definition, resolve_hover, resolve_references, symbol_ranges, symbol_relations,
};
use commands::codev::{
    codev_policy, codev_session_deliver, codev_session_discard, codev_session_list,
    codev_session_start,
};
use commands::codev_agent::{
    codev_agent_approve, codev_agent_cancel, codev_agent_checkpoints, codev_agent_close,
    codev_agent_extensions, codev_agent_history, codev_agent_live, codev_agent_override,
    codev_agent_permissions, codev_agent_review, codev_agent_rewind, codev_agent_save_permissions,
    codev_agent_send, codev_agent_sessions, codev_agent_set_mode, codev_agent_set_plan,
    codev_agent_start, codev_agent_trust,
};
use commands::codev_autonomy::{
    codev_autonomy_grant, codev_autonomy_pause, codev_autonomy_revoke, codev_autonomy_state,
    codev_pr_open, codev_pr_state,
};
use commands::codev_review::{
    codev_review_cancel, codev_review_integrate, codev_review_request, codev_review_state,
};
use commands::codev_worktree::{
    codev_claims, codev_worktree_commit, codev_worktree_create, codev_worktree_file,
    codev_worktree_plan, codev_worktree_remove, codev_worktrees,
};
use commands::debug_cmds::{
    breakpoints_load, breakpoints_save, debug_attach, debug_attach_targets, debug_available,
    debug_break, debug_capabilities, debug_continue, debug_data_breakpoints, debug_evaluate,
    debug_exception_filters, debug_last_write, debug_launch, debug_locals, debug_pause,
    debug_position, debug_read_memory, debug_record, debug_replay, debug_restart_frame,
    debug_reverse, debug_run, debug_run_to, debug_set_breakpoints, debug_snapshot, debug_stack,
    debug_step, debug_stop, debug_stop_on_panic, debug_test_targets, debug_threads, debug_travel,
    debug_variables, debug_writes,
};
use commands::deploy::{deploy_plan, deploy_rollout};
use commands::devcontainer::{
    devcontainer_exec, devcontainer_info, devcontainer_session_down, devcontainer_session_exec,
    devcontainer_session_run, devcontainer_session_status, devcontainer_session_up,
    devcontainer_up,
};
use commands::dictation::{dictation_cancel, dictation_start, dictation_status, dictation_stop};
use commands::git::{
    gh_prs, gh_prs_for, gh_runs_for, gh_status, git_amend, git_blame, git_branch, git_branches,
    git_changes, git_checkout, git_clone, git_clone_plan, git_commit, git_commit_paths,
    git_compare, git_conflict_stages, git_create_branch, git_diff, git_diff_range, git_history,
    git_hunks, git_lane_commit, git_log, git_merge, git_predict_conflicts, git_rebase, git_refs,
    git_show, git_show_path, git_stage, git_stage_all, git_stage_hunks, git_stash, git_sync,
    git_sync_plan, git_undo_list, git_undo_plan, git_undo_restore, git_undo_snapshot, git_unstage,
    git_worktree,
};
use commands::hood::{hood_line_asm, hood_python_bytecode, measure_growth};
use commands::iac::{iac_apply_command, iac_pipeline_run, iac_state};
use commands::lsp_install::{lsp_install_download, lsp_install_plan};
use commands::metrics::{
    incident_metrics_check, metrics_status, metrics_token_clear, metrics_token_set,
};
use commands::missions::{compile_pipeline, run_drill, run_measured, trace_execution};
use commands::ops::{
    ops_cloud_inventory, ops_cloud_status, ops_iac_dirs, ops_iac_plan, ops_kube_history,
    ops_kube_state,
};
use commands::pair::{pair_host, pair_join, pair_send, pair_stop};
use commands::panel::{ports_list, problems_scan};
use commands::platform::{
    incident_add, incident_feedback, incident_get, incident_list, incident_open, incident_status,
    pr_infra_review, pr_review_submit, queue_handover, queue_items, queue_verify,
};
use commands::plugins::{plugin_install, plugin_list, plugin_remove};
use commands::protect::{
    protect_hook_install, protect_hook_plan, protect_learn, secret_scan, secret_scan_allow,
};
use commands::review::{list_review_analyzers, review_code, verify_review_fix};
use commands::runbook::{
    runbook_decide, runbook_list, runbook_parse, runbook_step, sources_status,
};
use commands::sandbox::{compose_ps, get_sandbox_engine, set_sandbox_engine};
use commands::scaffold::{project_new, project_new_plan, project_templates};
use commands::search::{
    detect_projects, list_files, read_folder_sources, search_project, workspace_projects,
};
use commands::study::{
    course_prepare, course_prepare_status, get_course, get_glossary, get_study_guide,
    learn_cluster_delete, learn_cluster_start, learn_cluster_status, list_courses, list_phases,
    request_fix, request_hint, request_plan, study_policy, submit, submit_step,
};
use commands::tests::{
    list_tests, run_all_tests, run_path, run_test, run_tests, test_history, test_run, test_runners,
};
use commands::vault::{
    vault_dynamic, vault_kv_meta, vault_lease_revoke, vault_login_oidc, vault_login_token,
    vault_renew, vault_reveal_local, vault_reveal_read, vault_revoke, vault_status,
};

use serde::Serialize;
use tutor_core::{Level, Phase, StepKind};
use tutor_eval::{
    Assessment, Confidence, Estimate, ExecutionTrace, MemSample, Pipeline, Telemetry,
};

// `PROJECT_ID` e as regras de estudo/missões migraram para os casos de uso Tauri-free
// `crate::study` / `crate::missions` (Etapa 3, 13º grupo). `lib.rs` guarda só os DTOs
// serializáveis (fronteira para o webview, partilhados entre grupos) e os seus mappers.

// ── Serializable DTOs (camelCase to match the TypeScript frontend) ───────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PhaseDto {
    id: String,
    title: String,
    level: String,
    instructions: String,
    starter: String,
    entry: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectDto {
    project_id: String,
    project_title: String,
    language: String,
    summary: String,
    phases: Vec<PhaseDto>,
}

#[derive(Serialize)]
struct CorrectnessDto {
    passed: bool,
    summary: String,
    raw: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComplexityDto {
    big_o: String,
    r_squared: f64,
    exponent: f64,
    confidence: String,
    ranking: Vec<(String, f64)>,
}

#[derive(Serialize)]
struct GabaritoDto {
    solution: String,
    time: String,
    space: String,
    justification: String,
    /// Project step: the reference solution files (path → content). Absent for a
    /// single-file challenge, so its payload is unchanged.
    #[serde(skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    files: std::collections::BTreeMap<String, String>,
}

#[derive(Serialize)]
pub(crate) struct AssessmentDto {
    correctness: CorrectnessDto,
    complexity: Option<ComplexityDto>,
    expected: Option<String>,
    /// The curated reference solution — **only present after the hidden tests pass**.
    /// On a failed attempt this is `None`, so no application path can leak the answer
    /// (P0 honesty contract). See [`reveal_gabarito`].
    gabarito: Option<GabaritoDto>,
}

#[derive(Serialize)]
pub(crate) struct HintDto {
    pub(crate) text: String,
    pub(crate) provider: String,
    pub(crate) level: u8,
}

#[derive(Serialize)]
pub(crate) struct PlanDto {
    pub(crate) steps: Vec<String>,
}

// ── Guided-learning DTOs (camelCase) ─────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StepDto {
    /// "concept" | "drill" | "challenge".
    kind: String,
    id: String,
    title: String,
    points: u32,
    /// Pedagogical briefing shown BEFORE the exercise: how the computation solves
    /// this problem (markdown). Populated for every step kind.
    intro: String,
    /// Increasing difficulty marker (0 = none). Presentation only.
    difficulty: u8,
    /// concept: markdown body.
    body: String,
    /// drill: what/why (markdown).
    prompt: String,
    /// drill: the exact complete Rust program to retype.
    target: String,
    /// drill: shown after the program runs.
    explanation: String,
    /// drill: one explanation per line of `target`, aligned by index
    /// (`lineComments[i]` explains line `i` of `target.split('\n')`). Empty when
    /// the step carries no per-line comments.
    line_comments: Vec<String>,
    /// "shown" (basic units: the placeholder/target appears at once) or
    /// "on_demand" (advanced units: hidden until the student clicks Show
    /// placeholder). Defaults to "shown".
    placeholder_policy: String,
    /// Package-manager commands to SHOW the student to install this exercise's
    /// external packages (e.g. `["go get github.com/google/uuid"]`). Empty when the
    /// exercise needs only the standard library. Display/teaching only.
    install_commands: Vec<String>,
    /// Command to SHOW the student to run this exercise on the CLI (e.g.
    /// `"go run ."` or `"go test ./..."`). Empty when not applicable. Display only.
    run_command: String,
    /// Extra Cargo `[dependencies]` lines this step needs (Rust). Unlike
    /// `install_commands` (display only), these are actually sent to `run_drill`
    /// and written into the scaffolded crate so it compiles. Empty for std-only.
    dependencies: Vec<String>,
    /// challenge: markdown instructions.
    instructions: String,
    /// challenge: the function name to implement.
    entry: String,
    /// challenge: starter code.
    starter: String,
    /// Project step (several files): the starter files, the file to open first and the
    /// read-only ones. The hidden test files and the solution files are NOT here (honesty).
    /// Absent for every other step, so their payload is unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    project: Option<StepProjectDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StepProjectDto {
    main: String,
    files: std::collections::BTreeMap<String, String>,
    readonly: Vec<String>,
    /// The step is checked live in the course's practice cluster (Learn P3b); absent otherwise.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    live: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnitDto {
    id: String,
    title: String,
    intro: String,
    /// The topic's reading text (markdown): the unit's concepts and how the language
    /// expresses them. Empty for content that does not carry one yet.
    concepts: String,
    /// Increasing difficulty marker (0 = none). Presentation only.
    difficulty: u8,
    /// Pedagogical level: "basic" | "intermediate" | "advanced". Lets the
    /// frontend organize and filter the track by level.
    level: String,
    steps: Vec<StepDto>,
}

// ── Scaffolding DTOs (glossary + study guide) ────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GlossaryEntryDto {
    keyword: String,
    summary: String,
    when_to_use: String,
    example: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlossaryDto {
    entries: Vec<GlossaryEntryDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StudyGuideDto {
    title: String,
    /// Markdown body re-explaining the unit's concepts calmly.
    body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CourseDto {
    id: String,
    /// The language the steps are written and graded in.
    language: String,
    /// "language" | "framework" | "tool".
    category: &'static str,
    /// The framework/tool taught (empty for a language course).
    subject: String,
    title: String,
    level: String,
    summary: String,
    /// Reading text that introduces the language (markdown). May be empty.
    overview: String,
    /// The course compiles against dependencies prepared once (`[build] prepare`): grade only
    /// after `course_prepare` (`course_prepare_status` says whether it is ready).
    prepare: bool,
    units: Vec<UnitDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CourseSummaryDto {
    id: String,
    language: String,
    /// "language" | "framework" | "tool".
    category: &'static str,
    /// The framework/tool taught (empty for a language course).
    subject: String,
    title: String,
    level: String,
    summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RunDto {
    pub(crate) ok: bool,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

// ── Honest observability DTOs (measured run + compiler pipeline) ──────────────

/// One point of the memory time-series sampled DURING the measured run: elapsed
/// time (ms) and resident set size (KB), read from `/proc/<pid>/statm`. Serialized
/// as `tMs`/`rssKb`. Nothing fabricated — it's what the kernel reported.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SampleDto {
    t_ms: f64,
    rss_kb: u64,
}

/// Real, kernel-measured telemetry of the student's binary (nothing fabricated):
/// wall clock, user/sys CPU, peak RSS, I/O blocks (all from `wait4`/`rusage`), plus
/// a memory time-series (`samples`) sampled live from `/proc` during the run.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TelemetryDto {
    wall_ms: f64,
    cpu_user_ms: f64,
    cpu_sys_ms: f64,
    peak_rss_kb: u64,
    io_read_blocks: u64,
    io_write_blocks: u64,
    exit_code: i32,
    /// Memory time-series sampled during execution (empty if unavailable).
    samples: Vec<SampleDto>,
}

/// A run plus its telemetry. `run` has the same shape as `run_drill`'s output.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MeasuredRunDto {
    pub(crate) run: RunDto,
    pub(crate) telemetry: TelemetryDto,
}

/// The compiler's intermediate representations for the student's code, produced
/// by the real toolchain. Anything the toolchain cannot emit stays empty, with
/// the honest reason in `notes`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipelineDto {
    mir: String,
    llvm_ir: String,
    asm: String,
    binary_bytes: u64,
    disasm: String,
    notes: String,
}

// ── Step-through execution trace DTOs (camelCase) ─────────────────────────────

/// One observed variable in a trace step: name, truncated `repr()`, and its
/// Python `type(...).__name__`. Read from the student's real frame — nothing
/// fabricated.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VarDto {
    name: String,
    value: String,
    ty: String,
}

/// One step of the execution trace: the line about to run (or the call/return),
/// the function, the stack depth, the locals, and the accumulated stdout length.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TraceStepDto {
    line: u32,
    /// "line" | "call" | "return".
    event: String,
    func: String,
    depth: u32,
    locals: Vec<VarDto>,
    stdout_len: u32,
}

/// A full step-through trace of a program's REAL execution (Python-Tutor style).
/// `supported = false` for languages without tracing here, with an honest reason
/// in `notes`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExecutionTraceDto {
    supported: bool,
    notes: String,
    steps: Vec<TraceStepDto>,
    stdout: String,
}

// ── Conversions ───────────────────────────────────────────────────────────────

fn level_str(level: Level) -> &'static str {
    match level {
        Level::Basico => "basico",
        Level::Intermedio => "intermedio",
        Level::Avancado => "avancado",
    }
}

fn confidence_str(c: Confidence) -> &'static str {
    match c {
        Confidence::Low => "low",
        Confidence::Medium => "medium",
        Confidence::High => "high",
    }
}

/// `serde_json` turns non-finite floats (`NaN`, `±∞`) into JSON `null`, which then
/// crashes `.toFixed()` in the webview. Some complexity classes (e.g. exponential
/// at these sizes) legitimately fit to a non-finite R², so sanitize before sending.
fn finite(x: f64) -> f64 {
    if x.is_finite() {
        x
    } else {
        0.0
    }
}

fn complexity_dto(est: &Estimate) -> ComplexityDto {
    ComplexityDto {
        big_o: est.big_o().to_string(),
        r_squared: finite(est.r_squared),
        exponent: finite(est.loglog_exponent),
        confidence: confidence_str(est.confidence).to_string(),
        ranking: est
            .ranking
            .iter()
            .map(|(class, r2)| (class.big_o().to_string(), finite(*r2)))
            .collect(),
    }
}

fn phase_dto(p: &Phase) -> PhaseDto {
    PhaseDto {
        id: p.id.clone(),
        title: p.title.clone(),
        level: level_str(p.level).to_string(),
        instructions: p.instructions.clone(),
        starter: p.starter.clone(),
        entry: p.entry.clone(),
    }
}

/// Map the loaded project to the DTO the sidebar renders (`list_phases`). Shared with
/// `commands::study`, which produces the `Project` via `study::load_project`.
pub(crate) fn project_dto(project: &tutor_core::Project) -> ProjectDto {
    ProjectDto {
        project_id: project.id.clone(),
        project_title: project.title.clone(),
        language: project.language.clone(),
        summary: project.summary.clone(),
        phases: project.phases.iter().map(phase_dto).collect(),
    }
}

fn step_kind_str(kind: StepKind) -> &'static str {
    match kind {
        StepKind::Concept => "concept",
        StepKind::Drill => "drill",
        StepKind::Challenge => "challenge",
    }
}

fn step_dto(s: &tutor_core::Step) -> StepDto {
    // Note: the hidden `tests` and `gabarito` are deliberately NOT exposed — the
    // honesty principle keeps the source of truth out of the webview.
    StepDto {
        kind: step_kind_str(s.kind).to_string(),
        id: s.id.clone(),
        title: s.title.clone(),
        points: s.points,
        intro: s.intro.clone(),
        difficulty: s.difficulty,
        body: s.body.clone(),
        prompt: s.prompt.clone(),
        target: s.target.clone(),
        explanation: s.explanation.clone(),
        line_comments: s.line_comments.clone(),
        placeholder_policy: s.placeholder_policy.clone(),
        install_commands: s.install_commands.clone(),
        run_command: s.run_command.clone(),
        dependencies: s.dependencies.clone(),
        instructions: s.instructions.clone(),
        entry: s.entry.clone(),
        starter: s.starter.clone(),
        project: s.project.as_ref().map(|p| StepProjectDto {
            main: p.main.clone(),
            files: p.starter.clone(),
            readonly: p.readonly.clone(),
            live: tutor_core::livecheck::step_is_live(p),
        }),
    }
}

pub(crate) fn course_dto(c: &tutor_core::Course) -> CourseDto {
    CourseDto {
        id: c.id.clone(),
        language: c.language.clone(),
        category: c.category.as_str(),
        subject: c.subject.clone(),
        title: c.title.clone(),
        level: c.level.clone(),
        summary: c.summary.clone(),
        overview: c.overview.clone(),
        prepare: c.build.prepare,
        units: c
            .units
            .iter()
            .map(|u| UnitDto {
                id: u.id.clone(),
                title: u.title.clone(),
                intro: u.intro.clone(),
                concepts: u.concepts.clone(),
                difficulty: u.difficulty,
                level: u.level.clone(),
                steps: u.steps.iter().map(step_dto).collect(),
            })
            .collect(),
    }
}

/// Map a course to its summary row for the language picker (`list_courses`). Consumes the
/// `Course` like the original command did.
pub(crate) fn course_summary_dto(c: tutor_core::Course) -> CourseSummaryDto {
    CourseSummaryDto {
        id: c.id,
        language: c.language,
        category: c.category.as_str(),
        subject: c.subject,
        title: c.title,
        level: c.level,
        summary: c.summary,
    }
}

/// Map a loaded glossary to its DTO (`get_glossary`).
pub(crate) fn glossary_dto(glossary: tutor_core::Glossary) -> GlossaryDto {
    GlossaryDto {
        entries: glossary
            .entries
            .into_iter()
            .map(|e| GlossaryEntryDto {
                keyword: e.keyword,
                summary: e.summary,
                when_to_use: e.when_to_use,
                example: e.example,
            })
            .collect(),
    }
}

/// Map a remediation study guide to its DTO (`get_study_guide`).
pub(crate) fn study_guide_dto(guide: tutor_core::StudyGuide) -> StudyGuideDto {
    StudyGuideDto {
        title: guide.title,
        body: guide.body,
    }
}

/// Reveal the curated gabarito **only when the submission passed the hidden tests**.
///
/// This is the single decision that gates the reference solution: a failed attempt
/// gets `None`, so the DTO that reaches the webview never carries the answer (nor its
/// revealing justification). Pure and deterministic, so the harness can prove the
/// contract at the real serialization boundary without building a `Phase`.
fn reveal_gabarito(passed: bool, g: &tutor_core::Gabarito) -> Option<GabaritoDto> {
    if !passed {
        return None;
    }
    Some(GabaritoDto {
        solution: g.solution.clone(),
        time: g.time.clone(),
        space: g.space.clone(),
        justification: g.justification.clone(),
        files: std::collections::BTreeMap::new(),
    })
}

/// Build the assessment DTO from an evaluation plus the phase that was graded
/// (the gabarito travels with the phase). Shared by `submit` and `submit_step`.
pub(crate) fn assessment_dto(a: &Assessment, phase: &Phase) -> AssessmentDto {
    AssessmentDto {
        correctness: CorrectnessDto {
            passed: a.correctness.passed,
            summary: a.correctness.summary.clone(),
            raw: a.correctness.raw.clone(),
        },
        complexity: a.complexity.as_ref().map(complexity_dto),
        expected: a.expected.as_ref().map(|c| c.big_o().to_string()),
        // Honesty contract: no solution in the payload unless the tests passed.
        gabarito: reveal_gabarito(a.correctness.passed, &phase.gabarito).map(|mut g| {
            // A project step's solution is its files; they follow the same gate.
            if let Some(p) = &phase.project {
                g.files = p.solution.clone();
            }
            g
        }),
    }
}

fn sample_dto(s: &MemSample) -> SampleDto {
    SampleDto {
        t_ms: finite(s.t_ms),
        rss_kb: s.rss_kb,
    }
}

pub(crate) fn telemetry_dto(t: &Telemetry) -> TelemetryDto {
    TelemetryDto {
        wall_ms: finite(t.wall_ms),
        cpu_user_ms: finite(t.cpu_user_ms),
        cpu_sys_ms: finite(t.cpu_sys_ms),
        peak_rss_kb: t.peak_rss_kb,
        io_read_blocks: t.io_read_blocks,
        io_write_blocks: t.io_write_blocks,
        exit_code: t.exit_code,
        samples: t.samples.iter().map(sample_dto).collect(),
    }
}

pub(crate) fn pipeline_dto(p: Pipeline) -> PipelineDto {
    PipelineDto {
        mir: p.mir,
        llvm_ir: p.llvm_ir,
        asm: p.asm,
        binary_bytes: p.binary_bytes,
        disasm: p.disasm,
        notes: p.notes,
    }
}

pub(crate) fn execution_trace_dto(t: ExecutionTrace) -> ExecutionTraceDto {
    ExecutionTraceDto {
        supported: t.supported,
        notes: t.notes,
        steps: t
            .steps
            .into_iter()
            .map(|s| TraceStepDto {
                line: s.line,
                event: s.event,
                func: s.func,
                depth: s.depth,
                locals: s
                    .locals
                    .into_iter()
                    .map(|v| VarDto {
                        name: v.name,
                        value: v.value,
                        ty: v.ty,
                    })
                    .collect(),
                stdout_len: s.stdout_len,
            })
            .collect(),
        stdout: t.stdout,
    }
}

// ── Grupo `estudo`/`missões` (secção 3): o 13º e ÚLTIMO grupo extraído de `lib.rs` ──
// Os onze comandos de estudo (`list_phases`, `submit`, `submit_step`, `request_hint`,
// `request_plan`, `request_fix`, `get_course`, `list_courses`, `study_policy`, `get_glossary`,
// `get_study_guide`) saíram para `commands::study` (adaptadores finos) sobre o caso de uso
// Tauri-free `crate::study`: classificação de passos
// (`course_step`/`step_language`/`step_is_autonomous`, partilhadas com `commands::assistant`),
// política de estudo, carregamento de conteúdo com erro tipado `StudyError`, e avaliação
// honesta (`grade_phase`/`grade_step`, que reusam `tutor_eval::assess`, a fonte de verdade).
// Os provedores LLM de `request_hint`/`plan`/`fix` ficam no adaptador; a regra offline curada
// (`study::curated_hint`) e o `PROJECT_ID` migraram para o caso de uso.
//
// Os quatro comandos de missões/execução (`run_drill`, `run_measured`, `compile_pipeline`,
// `trace_execution`) saíram para `commands::missions` — passagens sobre `tutor_eval` (já
// Tauri-free: runner, medição `wait4`/`rusage`, pipeline do toolchain, tracer); a única regra
// isolada é o despacho Go-vs-Rust do drill (`missions::drill_language`, puro e testável).
//
// `lib.rs` guarda só os DTOs serializáveis (`ProjectDto`/`AssessmentDto`/`CourseDto`/
// `CourseSummaryDto`/`GlossaryDto`/`StudyGuideDto`/`HintDto`/`PlanDto`/`RunDto`/
// `MeasuredRunDto`/`PipelineDto`/`ExecutionTraceDto`) + os seus mappers `pub(crate)` — a
// fronteira de serialização para o webview, partilhada entre grupos. Importados por nome
// acima; registados sem prefixo no registo de handlers.

// `get_diagnostics` migrou para `commands::assistant` (adaptador fino sobre a regra de
// mapeamento `crate::assistant::diagnostics`), Etapa 3. Ver `use commands::assistant::…`.

// ── review de código ──
// Os comandos `review_code` / `list_review_analyzers` / `verify_review_fix` saíram
// para `commands/review.rs` (adaptadores finos) sobre o caso de uso Tauri-free
// `crate::review` (Etapa 3). Ver `use commands::review::…` no topo.

// Grupo `assistant`/providers (`assistant_models`, `assistant_chat`, `list_providers`,
// `get_providers_config`, `save_providers_config`, `assistant_chat_stream`,
// `assistant_cancel`, `get_diagnostics`) extraído para `commands::assistant` (adaptadores
// finos) sobre o caso de uso Tauri-free `crate::assistant` — Etapa 3. A política de estudo,
// a validação de provider, o dispatch do stream e o registo de cancelamento vivem no caso
// de uso; a emissão dos eventos `llm://token|done|error` fica no adaptador. Importados por
// nome acima; registados sem prefixo.

// `codev_policy` migrou para `commands::codev` (adaptador fino sobre a regra
// `crate::codev::policy_for_mode`), Etapa 3. Ver `use commands::codev::…` no topo.

// `assistant_chat_stream` e `assistant_cancel` migraram para `commands::assistant` (Etapa 3):
// a preparação do stream (política + provider) e o dispatch SSE são `crate::assistant`; os
// eventos `llm://*` e a thread ficam no adaptador. Ver `use commands::assistant::…`.

// Grupo `testes`/execução (`list_tests`, `run_test`, `run_all_tests`, `run_tests`,
// `run_path`) extraído para `commands::tests` (adaptadores finos) sobre o caso de uso
// Tauri-free `crate::testexec` — Etapa 3. Importados por nome acima; registados sem prefixo.

// Grupo `debug` (DAP, secção 5): os dez comandos `debug_*` — detecção
// (`debug_capabilities`/`debug_available`) e o motor gdb/MI
// (`debug_launch`/`break`/`run`/`continue`/`step`/`locals`/`stack`/`stop`) — foram
// extraídos para `commands::debug_cmds` (adaptadores finos) sobre o caso de uso Tauri-free
// `crate::debug`, que já encapsulava o driver gdb/MI e ganhou a fachada `capabilities()`.
// É um grupo de passagens: nenhuma regra nova; os adaptadores só desembrulham o
// `tauri::State<'_, DebugSessions>` para `&DebugSessions`. Importados por nome acima;
// registados sem prefixo no registo de handlers. O registo da sessão (`DebugSessions`)
// continua gerido pelo Tauri (`.manage(...)` abaixo).

// Grupo `git` (SCM, secção 5): os treze comandos `git_*` — leituras
// (`git_changes`/`git_log`/`git_show`/`git_branch`/`git_branches`/`git_diff`) e mutações
// (`git_stage`/`git_unstage`/`git_stage_all`/`git_commit`/`git_checkout`/`git_create_branch`/
// `git_clone`) — foram extraídos para `commands::git` (adaptadores finos) sobre o caso de uso
// Tauri-free `crate::gitops` (erro tipado `GitError`, página por omissão do histórico,
// default de diff). Importados por nome acima; registados sem prefixo no registo de handlers.

// `run_tests` (suite do projecto, host-vs-sessão) extraído para `commands::tests` sobre o
// caso de uso Tauri-free `testexec::run_project_suite` (erro tipado `TestError`, DTO
// `SuiteRun`) — Etapa 3.

// Grupo `agente`/`arquitectura` (secção 9): os sete comandos — arquitectura
// (`arch_validate`/`arch_scaffold`/`arch_scaffold_preview`) e tarefa cloud-shaped
// (`agent_isolated_patch` + `agent_task_submit`/`status`/`cancel`, RF-AG-01) — foram
// extraídos para `commands::agent` (adaptadores finos) sobre o caso de uso Tauri-free
// `crate::agent`: regra do scaffold com erro tipado `ScaffoldError`, registo de tarefas
// como orquestração pura (`AgentTask`, transições `running → done|error`), e o executor
// isolado `worktree_patch` re-exportado como fachada. Importados por nome acima; registados
// sem prefixo no registo de handlers.

// Os quatro `codev_session_*` migraram para `commands::codev` (adaptadores finos sobre o
// mecanismo de worktrees `crate::codev::session_*`), Etapa 3. Ver `use commands::codev::…`.

// Os quatro comandos de pesquisa/projecto (`search_project`, `list_files`,
// `read_folder_sources`, `detect_projects`) migraram para `commands::search` (adaptadores
// finos sobre o caso de uso Tauri-free `crate::search`), Etapa 3. Ver `use commands::search::…`.

// ── IDE/Workspace runner command ─────────────────────────────────────────────
// `run_path` (correr um ficheiro do Explorer) extraído para `commands::tests` sobre o caso
// de uso Tauri-free `testexec::split_args` (+ `fsops::run_file`, intocado) — Etapa 3.

// ── Stack services (F8) + selecção de motor de sandbox ──────────────────────────────────
// Os três comandos sandbox/run (`compose_ps`, `get_sandbox_engine`, `set_sandbox_engine`)
// + o DTO `ComposeService`, o parser puro `parse_compose_ps` e o erro tipado
// `SandboxError` (motor desconhecido / falha do `docker compose ps`) migraram para
// `commands::sandbox` (adaptadores finos) sobre o caso de uso Tauri-free `crate::sandbox`,
// Etapa 3. Ver `use commands::sandbox::…` no topo. (A precedência runtime→env→host do motor
// continua em `tutor_eval`; o arranque em `run()` chama `tutor_eval::set_engine` directo.)

// `ProjectInfo`/`project_kind`/`detect_projects` + `FolderSource`/`read_folder_sources`
// migraram para `commands::search` (adaptadores finos) sobre o caso de uso Tauri-free
// `crate::search` (DTOs, walk de projectos e recolha de fontes), Etapa 3.

// Os oito comandos `devcontainer_*` (+ DTOs `DevcontainerInfo`/`DevcontainerUp`/
// `SessionStatus`, a resolução de imagem, o parsing JSONC `strip_jsonc_comments` e o erro
// tipado `DevcontainerError`) migraram para `commands::devcontainer` (adaptadores finos)
// sobre o caso de uso Tauri-free `crate::devcontainer`, Etapa 3. Ver `use
// commands::devcontainer::…` no topo.

// ── PairCode (exclusivo do dxtutor-ide): sessão par-a-par com WebRTC no webview ──
// Os quatro comandos (`pair_host`, `pair_join`, `pair_send`, `pair_stop`) + o helper de
// emissão `pair_events` migraram para `commands::pair` (adaptadores finos) sobre o caso de
// uso Tauri-free `crate::pair` (mecanismo TCP + ChaCha20-Poly1305 + WebSocket, intocado),
// Etapa 3. Ver `use commands::pair::…` no topo. O estado `pair::Pair` continua gerido pelo
// Tauri (`.manage(...)` abaixo); `enable_media` (abaixo) é setup da App, não um comando.

/// Camera and microphone for the PairCode call: WebKitGTK has them off by default.
#[cfg(target_os = "linux")]
fn enable_media(app: &tauri::App) {
    use tauri::Manager;
    use webkit2gtk::glib::prelude::*;
    use webkit2gtk::{PermissionRequestExt, SettingsExt, UserMediaPermissionRequest, WebViewExt};
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.with_webview(|wv| {
            let v = wv.inner();
            if let Some(s) = WebViewExt::settings(&v) {
                s.set_enable_media_stream(true);
                s.set_enable_webrtc(true);
                s.set_enable_mediasource(true);
                // the call starts when the pair joins, not on a click of ours
                s.set_media_playback_requires_user_gesture(false);
            }
            v.connect_permission_request(|_, req| {
                if req.is::<UserMediaPermissionRequest>() {
                    req.allow();
                    true
                } else {
                    false
                }
            });
        });
    }
}

/// Gives the memory freed since the last call back to the system, a few seconds from now (after the answer that
/// held it was serialized and sent). glibc keeps what a thread frees in that thread's arena; measured 2026-11-27:
/// opening this repository (1113 files, 16 MB) left the app ~27 MB bigger for good.
pub fn trim_soon() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_secs(3));
        // SAFETY: malloc_trim only releases free memory held by the allocator
        unsafe {
            libc::malloc_trim(0);
        }
    });
}

pub fn run() {
    // Default the desktop to running student/user code inside Delonix containers
    // (real isolation + package caches). The user can switch at runtime via
    // `set_sandbox_engine`. The env var still wins if it was set explicitly first:
    // only default to Delonix when nothing was requested through the environment.
    if std::env::var(tutor_eval::container::ENGINE_ENV).is_err() {
        tutor_eval::set_engine(tutor_eval::SandboxEngine::Delonix);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .manage(lsp::LspState::default())
        .manage(procs::Procs::default())
        .manage(debug::DebugSessions::default())
        .manage(debug::DapSessions::default())
        .manage(pair::Pair::default())
        .setup(|_app| {
            #[cfg(target_os = "linux")]
            enable_media(_app);
            // the login shell's environment (`bash -ilc env`, nvm and all: 0.4 s on an idle machine, seconds under
            // load) is resolved once, by whoever asks first — warm it here, off the UI thread
            std::thread::spawn(|| {
                let _ = shellenv::get();
            });
            // LSP P2: where the user's override file and the approvals live; reload on change
            lsp::init(_app.handle());
            // Learn P3b: practice clusters idle for 20 min (or left by an earlier run) are deleted
            study::start_cluster_reaper();
            // Multi Co-Dev, phase 5: what the backend needs to act on what a human delegated
            if let Err(e) = commands::codev_autonomy::install(_app.handle()) {
                eprintln!("autonomy: not installed ({e})");
            }
            // r23 F4a (X02): each request that lost secrets is shown (and audited) by the UI
            let handle = _app.handle().clone();
            tutor_protect::redact::on_redact(move |origin, count| {
                let _ = tauri::Emitter::emit(
                    &handle,
                    "protect://redacted",
                    serde_json::json!({"origin": origin, "count": count, "total": tutor_protect::redact::total()}),
                );
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ── PairCode (exclusivo do dxtutor-ide) ──
            pair_host,
            pair_join,
            pair_send,
            pair_stop,
            // ── v7 desktop UI bridge (ui-app/src/bridge.ts) — 14 generic commands ──
            // pick_folder is provided by the existing fsops (non-blocking on Linux).
            fsops::pick_folder,
            bridge::load_workspace,
            bridge::write_file,
            bridge::delete_file,
            bridge::expand_path,
            bridge::exec,
            bridge::run_shell,
            bridge::kill_shell,
            bridge::keys_status,
            bridge::save_key,
            bridge::llm_chat,
            bridge::llm_plan,
            bridge::vsix_manifest,
            bridge::vsix_fetch_open_vsx,
            bridge::vsix_search_open_vsx,
            bridge::app_info,
            bridge::selftest_report,
            // ── rich dxtutor backend (unchanged) ──
            list_phases,
            submit,
            request_hint,
            get_diagnostics,
            review_code,
            list_review_analyzers,
            verify_review_fix,
            study_policy,
            codev_policy,
            symbol_relations,
            list_symbols,
            symbol_ranges,
            file_outline,
            diff_lines,
            propose_entrypoint,
            resolve_definition,
            resolve_references,
            resolve_hover,
            list_tests,
            run_test,
            run_all_tests,
            test_runners,
            test_run,
            test_history,
            search_project,
            list_files,
            git_changes,
            git_diff,
            git_clone,
            git_clone_plan,
            git_blame,
            git_history,
            git_show_path,
            git_compare,
            git_stash,
            git_worktree,
            git_refs,
            git_hunks,
            git_stage_hunks,
            git_undo_snapshot,
            git_undo_list,
            git_undo_plan,
            git_undo_restore,
            git_predict_conflicts,
            git_merge,
            git_conflict_stages,
            git_sync_plan,
            git_sync,
            gh_status,
            gh_prs,
            gh_runs_for,
            gh_prs_for,
            git_commit_paths,
            git_lane_commit,
            git_rebase,
            git_amend,
            git_stage,
            git_unstage,
            git_stage_all,
            git_commit,
            git_branches,
            git_checkout,
            git_create_branch,
            agent_isolated_patch,
            arch_scaffold_preview,
            agent_task_submit,
            agent_task_status,
            agent_task_cancel,
            arch_validate,
            arch_scaffold,
            arch_export_mermaid,
            arch_import_mermaid,
            arch_save_export,
            arch_conformance,
            arch_rules_load,
            arch_rules_save,
            adr_list,
            adr_accept,
            arch_rules_commit,
            run_tests,
            git_log,
            git_show,
            git_branch,
            codev_session_start,
            codev_session_deliver,
            codev_session_discard,
            codev_session_list,
            // agente Co-Dev v2 (ADR-0003) — commands/codev_agent.rs
            codev_agent_start,
            codev_agent_send,
            codev_agent_approve,
            codev_agent_review,
            codev_agent_override,
            codev_agent_permissions,
            codev_agent_save_permissions,
            codev_agent_cancel,
            codev_agent_close,
            codev_agent_set_mode,
            codev_agent_sessions,
            codev_agent_live,
            codev_agent_history,
            codev_agent_set_plan,
            codev_agent_checkpoints,
            codev_agent_rewind,
            codev_agent_extensions,
            codev_agent_trust,
            // Multi Co-Dev, fase 3 — worktrees e reservas de ficheiros (commands/codev_worktree.rs)
            codev_worktree_plan,
            codev_worktree_create,
            codev_worktrees,
            codev_worktree_remove,
            codev_worktree_file,
            codev_worktree_commit,
            codev_claims,
            // Multi Co-Dev, fase 4 — a revisão Co-Dev assistida e a porta de integração (commands/codev_review.rs)
            codev_review_state,
            codev_review_request,
            codev_review_cancel,
            codev_review_integrate,
            // Multi Co-Dev, fase 5 — a autonomia delegada e os pull requests (commands/codev_autonomy.rs)
            codev_autonomy_state,
            codev_autonomy_grant,
            codev_autonomy_revoke,
            codev_autonomy_pause,
            codev_pr_state,
            codev_pr_open,
            dictation_status,
            dictation_start,
            dictation_stop,
            dictation_cancel,
            debug_capabilities,
            assistant_models,
            assistant_chat,
            assistant_chat_stream,
            assistant_cancel,
            list_providers,
            get_providers_config,
            save_providers_config,
            request_plan,
            request_fix,
            get_course,
            plugin_list,
            plugin_install,
            plugin_remove,
            list_courses,
            run_drill,
            run_measured,
            compile_pipeline,
            trace_execution,
            submit_step,
            course_prepare_status,
            course_prepare,
            learn_cluster_status,
            learn_cluster_start,
            learn_cluster_delete,
            get_glossary,
            get_study_guide,
            fsops::list_dir,
            fsops::read_text_file,
            fsops::write_text_file,
            fsops::create_path,
            fsops::delete_path,
            fsops::rename_path,
            fsops::workspace_tree,
            fsops::workspace_action,
            fsops::workspace_resolve,
            run_path,
            project_entrypoint,
            compose_ps,
            get_sandbox_engine,
            set_sandbox_engine,
            read_folder_sources,
            debug_available,
            debug_launch,
            debug_break,
            debug_run,
            debug_continue,
            debug_step,
            debug_locals,
            debug_stack,
            debug_stop,
            debug_set_breakpoints,
            debug_stop_on_panic,
            debug_threads,
            debug_variables,
            debug_evaluate,
            debug_pause,
            debug_run_to,
            debug_restart_frame,
            debug_data_breakpoints,
            debug_read_memory,
            debug_exception_filters,
            debug_test_targets,
            debug_record,
            debug_replay,
            debug_reverse,
            debug_position,
            debug_travel,
            debug_last_write,
            debug_writes,
            debug_snapshot,
            breakpoints_load,
            breakpoints_save,
            hood_line_asm,
            hood_python_bytecode,
            measure_growth,
            ops_iac_dirs,
            ops_iac_plan,
            ops_kube_state,
            ops_kube_history,
            ops_cloud_status,
            ops_cloud_inventory,
            deps_report,
            onboard_map,
            git_diff_range,
            debug_attach_targets,
            debug_attach,
            devcontainer_info,
            devcontainer_up,
            devcontainer_exec,
            devcontainer_session_up,
            devcontainer_session_exec,
            devcontainer_session_run,
            devcontainer_session_status,
            devcontainer_session_down,
            detect_projects,
            workspace_projects,
            pty::pty_spawn,
            pty::pty_spawn_in_session,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_shells,
            pty::pty_info,
            problems_scan,
            protect_learn,
            metrics_status,
            metrics_token_set,
            metrics_token_clear,
            incident_metrics_check,
            protect_hook_plan,
            protect_hook_install,
            secret_scan,
            secret_scan_allow,
            iac_pipeline_run,
            iac_apply_command,
            iac_state,
            vault_status,
            vault_login_token,
            vault_login_oidc,
            vault_renew,
            vault_revoke,
            vault_kv_meta,
            vault_reveal_local,
            vault_reveal_read,
            vault_dynamic,
            vault_lease_revoke,
            deploy_plan,
            deploy_rollout,
            runbook_list,
            runbook_parse,
            runbook_step,
            runbook_decide,
            sources_status,
            queue_items,
            queue_verify,
            queue_handover,
            pr_infra_review,
            pr_review_submit,
            incident_open,
            incident_list,
            incident_get,
            incident_add,
            incident_status,
            incident_feedback,
            ports_list,
            lsp::lsp_start,
            lsp::lsp_did_open,
            lsp::lsp_did_change,
            lsp::lsp_definition,
            lsp::lsp_references,
            lsp::lsp_hover,
            lsp::lsp_completion,
            lsp::lsp_signature_help,
            lsp::lsp_code_action,
            lsp::lsp_execute_command,
            lsp::lsp_format,
            lsp::lsp_document_symbols,
            lsp::lsp_workspace_symbols,
            lsp::lsp_prepare_type_hierarchy,
            lsp::lsp_type_hierarchy,
            lsp::lsp_rename,
            lsp::lsp_prepare_rename,
            lsp::lsp_server_status,
            // LSP P2: the user's and the project's override files, and the project commands' approval
            lsp::lsp_config,
            lsp::lsp_config_file,
            lsp::lsp_user_config_save,
            lsp::lsp_approve_server,
            // LSP P3: install a missing server from the registry's recipes
            lsp_install_plan,
            lsp_install_download,
            // LSP P6: documents and folders closed, the live servers, their log, stop and restart
            lsp::lsp_did_close,
            lsp::lsp_folder_closed,
            lsp::lsp_servers,
            lsp::lsp_server_log,
            lsp::lsp_server_stop,
            lsp::lsp_server_restart,
            // LSP P4: the languages the installed VS Code extensions contribute
            lsp::lsp_contributions,
            board::board_load,
            board::board_save,
            board::project_load,
            board::project_apply,
            board::project_issue,
            board::project_change_sets,
            board::project_reports,
            board::project_audit,
            board::audit_record,
            board::test_results_record,
            board::test_results_for,
            board::iac_risk_accept,
            board::iac_risks,
            board::iac_risk_revoke,
            board::deploy_records,
            board::runbook_judge,
            board::runbook_runs,
            board::audit_export_evidence,
            board::project_issue_prompt,
            board::project_create_from_backlog,
            project_templates,
            project_new_plan,
            project_new,
            board::project_sprint_plan,
            board::project_scope_overlap,
            board::project_checks,
            board::project_method_preview,
        ])
        .build(tauri::generate_context!())
        .expect("error while running dxtutor IDE")
        .run(|app, event| {
            // LSP P6: the language servers end the way the protocol asks (shutdown, exit), reaped
            if let tauri::RunEvent::Exit = event {
                lsp::shutdown_all(app);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_gabarito() -> tutor_core::Gabarito {
        tutor_core::Gabarito {
            solution: "fn answer() -> u32 { 42 }".into(),
            time: "O(1)".into(),
            space: "O(1)".into(),
            justification: "constant work".into(),
        }
    }

    /// F4 gestor de missões: o payload de `arch_scaffold_preview` (== `arch.scaffold()`) é o
    /// conjunto de ficheiros que a missão delega como patch isolado — inclui o compose.
    #[test]
    fn scaffold_preview_payload_has_compose() {
        use tutor_eval::arch::{Architecture, Component, Kind};
        let arch = Architecture {
            components: vec![Component::new("api", "api", Kind::Service)],
            ..Default::default()
        };
        let files = arch.scaffold(); // exactamente o que arch_scaffold_preview devolve
        assert!(
            files.iter().any(|(p, _)| p == "docker-compose.yml"),
            "sem compose: {:?}",
            files.iter().map(|(p, _)| p).collect::<Vec<_>>()
        );
        assert!(files.iter().any(|(p, _)| p == "services/api/Dockerfile"));
    }

    // Os testes de `parse_compose_ps` (NDJSON/array/vazio) migraram para o caso de uso
    // `crate::sandbox` (Etapa 3) — ver `src-tauri/src/sandbox.rs` e o teste integrado
    // `src-tauri/tests/sandbox_group.rs`.

    /// P0-1 regression: a FAILED attempt must never carry the reference solution.
    /// Serialize the DTO (the exact payload the webview receives) and assert the
    /// gabarito field is `null` and the solution text appears nowhere in the JSON.
    #[test]
    fn failed_attempt_hides_gabarito() {
        let g = sample_gabarito();
        assert!(reveal_gabarito(false, &g).is_none());

        let dto = AssessmentDto {
            correctness: CorrectnessDto {
                passed: false,
                summary: "1 test failed".into(),
                raw: "assertion failed".into(),
            },
            complexity: None,
            expected: None,
            gabarito: reveal_gabarito(false, &g),
        };
        let json = serde_json::to_string(&dto).expect("serialize");
        assert!(
            json.contains("\"gabarito\":null"),
            "gabarito must be null: {json}"
        );
        assert!(
            !json.contains("fn answer") && !json.contains("constant work"),
            "failed payload leaked the solution/justification: {json}"
        );
    }

    /// A PASSED attempt unlocks the gabarito (the reward is real on success).
    #[test]
    fn passed_attempt_reveals_gabarito() {
        let g = sample_gabarito();
        let revealed = reveal_gabarito(true, &g).expect("passed → Some");
        assert_eq!(revealed.solution, "fn answer() -> u32 { 42 }");

        let dto = AssessmentDto {
            correctness: CorrectnessDto {
                passed: true,
                summary: "ok".into(),
                raw: String::new(),
            },
            complexity: None,
            expected: None,
            gabarito: reveal_gabarito(true, &g),
        };
        let json = serde_json::to_string(&dto).expect("serialize");
        assert!(
            json.contains("fn answer"),
            "passed payload should include the solution: {json}"
        );
        assert!(
            !json.contains("\"files\""),
            "single-file payload unchanged: {json}"
        );
    }

    /// A project step: the step DTO carries the starter files but never the hidden tests or
    /// the solution files; the assessment reveals the solution files only after a pass.
    #[test]
    fn project_step_hides_tests_and_reveals_solution_files_only_on_pass() {
        let raw = std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../crates/tutor-plugins/tests/fixtures/framework-project/courses/minishop.toml"
        ))
        .expect("fixture");
        let course = tutor_core::Course::parse(&raw, tutor_core::CourseFormat::Toml).unwrap();
        let dto = serde_json::to_string(&course_dto(&course)).unwrap();
        assert!(
            dto.contains(r#""category":"framework""#) && dto.contains(r#""subject":"minishop""#)
        );
        assert!(dto.contains(r#""main":"shop/cart.py""#), "{dto}");
        assert!(dto.contains("shop/config.py") && dto.contains("readonly"));
        assert!(!dto.contains("test_shop.py"), "hidden test files leaked");
        assert!(
            !dto.contains("sum(quantity * price"),
            "solution files leaked"
        );
        assert!(
            !dto.contains("\"project\":null"),
            "other steps keep their payload"
        );

        let step = course.step("msf-p1-cart").unwrap();
        let phase = step.as_phase("python", tutor_core::Level::Basico).unwrap();
        let outcome = |passed: bool| Assessment {
            correctness: tutor_eval::Correctness {
                passed,
                summary: String::new(),
                raw: String::new(),
            },
            complexity: None,
            expected: None,
        };
        let failed = serde_json::to_string(&assessment_dto(&outcome(false), &phase)).unwrap();
        assert!(failed.contains("\"gabarito\":null") && !failed.contains("sum(quantity"));
        let passed = serde_json::to_string(&assessment_dto(&outcome(true), &phase)).unwrap();
        assert!(
            passed.contains("sum(quantity * price") && passed.contains("shop/prices.py"),
            "{passed}"
        );
        assert!(
            passed.contains("applies VAT once"),
            "the explanation travels as the justification"
        );
    }
}
