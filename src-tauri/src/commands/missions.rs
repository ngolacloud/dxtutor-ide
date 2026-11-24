//! Comandos IPC de missões / execução (secção 3) — adaptadores finos sobre `tutor_eval`
//! (já Tauri-free) e sobre o despacho de linguagem `crate::missions`.
//!
//! Nenhuma regra nova vive aqui. Correr/medir/compilar/tracejar programas completos já é
//! `tutor_eval` (runner, medição `wait4`/`rusage`, pipeline do toolchain, tracer). Os
//! adaptadores só fazem a fronteira IPC: `spawn_blocking` (compilar/correr é trabalho
//! bloqueante longo — nunca na thread da janela), mapeamento do erro → `String` com as mesmas
//! mensagens que `lib.rs` emitia, e a montagem dos DTOs (`crate::*` + `crate::*_dto`). A única
//! regra isolada é o despacho Go-vs-Rust do drill ([`missions::drill_language`]), para a
//! decisão não ficar embutida no comando IPC.
//!
//! Os quatro (`run_drill`, `run_measured`, `compile_pipeline`, `trace_execution`) são
//! marcados «X» (executam código) na matriz IPC. Nenhum é hoje invocado pela `ui-app`;
//! preservam-se por serem contrato público.

use crate::missions::{self, DrillLang};
use crate::{execution_trace_dto, pipeline_dto, telemetry_dto};
use crate::{ExecutionTraceDto, MeasuredRunDto, PipelineDto, RunDto};

/// Compile and run a COMPLETE program (a drill's target the student retyped) and return
/// its output. Never judges an exercise — it just executes. Go uses `go run` (with `go mod
/// tidy`); everything else uses the Rust path. `dependencies` are extra Cargo lines the Rust
/// drill needs (ignored by the Go path, which resolves imports via `go mod tidy`).
#[tauri::command]
pub async fn run_drill(
    code: String,
    language: String,
    dependencies: Vec<String>,
) -> Result<RunDto, String> {
    // async + spawn_blocking: compiling/running is long blocking work — keep it off the
    // webview's main thread so the app never freezes while a drill runs.
    tauri::async_runtime::spawn_blocking(move || -> Result<RunDto, String> {
        // Rust/Go pelos runners nativos (como antes: `drill_language`); qualquer outra
        // linguagem com descritor registado (Python, C, drop-ins) pelo runner declarativo.
        let out = match missions::drill_language(&language) {
            DrillLang::Go => tutor_eval::run_go_program_with_deps(&code, &dependencies),
            DrillLang::Rust if tutor_eval::find_plugin(&language).is_some() => {
                tutor_eval::run_program(&language, &code, &dependencies)
            }
            DrillLang::Rust => tutor_eval::run_rust_snippet_with_deps(&code, &dependencies),
        }
        .map_err(|e| format!("run failed: {e}"))?;
        Ok(RunDto {
            ok: out.ok,
            stdout: out.stdout,
            stderr: out.stderr,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Compile and run a COMPLETE Rust program and return its output PLUS real,
/// kernel-measured telemetry (wall clock, user/sys CPU, peak RSS, I/O blocks).
/// Honest observability: every number is measured from the student's own
/// process via `wait4`/`rusage` — no fabricated GPU/NPU figures.
#[tauri::command]
pub async fn run_measured(code: String) -> Result<MeasuredRunDto, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<MeasuredRunDto, String> {
        let (out, telemetry) = tutor_eval::run_rust_snippet_measured(&code)
            .map_err(|e| format!("measured run failed: {e}"))?;
        Ok(MeasuredRunDto {
            run: RunDto {
                ok: out.ok,
                stdout: out.stdout,
                stderr: out.stderr,
            },
            telemetry: telemetry_dto(&telemetry),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Run the real compiler pipeline over the student's code: MIR, LLVM-IR, assembly,
/// binary size, and (if `objdump` exists) a disassembly. Shows honestly what the
/// toolchain actually produces; missing stages are reported in `notes`.
#[tauri::command]
pub async fn compile_pipeline(code: String) -> Result<PipelineDto, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<PipelineDto, String> {
        let pipeline = tutor_eval::compile_pipeline(&code)
            .map_err(|e| format!("compile pipeline failed: {e}"))?;
        Ok(pipeline_dto(pipeline))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Produce a step-through execution TRACE of the student's program (Python-Tutor
/// style): run it under `sys.settrace` and return every executed line/call/return
/// with the frame's locals, stack depth, and accumulated stdout length. Honest:
/// the trace is the REAL execution; runtime errors land in `notes`, nothing is
/// fabricated. Only Python is supported here; other languages come back with
/// `supported = false` and an honest reason.
#[tauri::command]
pub async fn trace_execution(language: String, code: String) -> Result<ExecutionTraceDto, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<ExecutionTraceDto, String> {
        let trace = tutor_eval::trace_execution(&language, &code)
            .map_err(|e| format!("trace failed: {e}"))?;
        Ok(execution_trace_dto(trace))
    })
    .await
    .map_err(|e| e.to_string())?
}
