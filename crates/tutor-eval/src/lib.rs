//! `tutor-eval` — o avaliador do dxtutor.
//!
//! Duas responsabilidades, bem separadas e **honestas**:
//!
//! 1. **Correcção** (fonte da verdade): corre os testes da fase na linguagem dela.
//! 2. **Complexidade** (dica empírica): cronometra a solução do aluno em tamanhos
//!    crescentes e ajusta a classe — declarada sempre como estimativa, nunca prova.
//!
//! # Multi-linguagem
//!
//! O contrato está no trait [`LanguageRunner`] (ver [`lang`]): cada linguagem serve
//! `check_correctness`, `probe_complexity` e `diagnostics` à sua maneira. [`assess`]
//! despacha pela [`tutor_core::Phase::language`] — `"rust"` usa o [`runner::RustRunner`]
//! (compila e corre um pacote cargo isolado, com sandbox); `"js"` usa o
//! [`js_runner::JsRunner`] (motor QuickJS embebido). A API pública ([`assess`],
//! [`Assessment`], [`Correctness`]) mantém-se estável — acrescentar uma linguagem é
//! aditivo.

pub mod advisor;
pub mod arch;
pub mod attach;
pub mod codemap;
pub mod complexity;
pub mod container;
mod container_check;
pub mod course_cache;
pub mod dap;
pub mod dapc;
pub mod deps;
pub mod entrypoint;
pub mod gh;
pub mod git;
pub mod gitwork;
pub mod gitx;
pub mod go_runner;
pub mod hood;
pub mod iac;
pub mod iacfind;
pub mod js_runner;
pub mod kindbox;
pub mod lang;
pub mod langcontrib;
pub mod langreg;
pub mod lsp;
pub mod lspconf;
pub mod lspinstall;
pub mod measured;
pub mod onboard;
pub mod ops;
pub mod plugin;
pub mod review;
pub mod rr;
pub mod runner;
pub mod rust_tracer;
pub mod sandbox;
pub mod search;
pub mod testbins;
pub mod testnav;
pub mod testrun;
pub mod textdiff;
pub mod tool_runner;
pub mod tracer;

pub use advisor::advise;
pub use complexity::{Class, Confidence, Estimate, Sample};
pub use container::{
    build_image, cache_volumes_for, current_engine, engine_available, engine_name, image_for,
    parse_engine, project_test_command, run_file_command, run_in_container, run_python_in_sandbox,
    run_rust_snippet_in_container, run_rust_snippet_in_container_deps, sandbox_engine,
    session_down, session_exec, session_name, session_running, session_shell_command, session_up,
    set_engine, ContainerLimits, ContainerSpec, SandboxEngine,
};
pub use go_runner::{run_go_program, run_go_program_with_deps};
pub use lang::{
    assess, assess_project, diagnostics, diagnostics_for, language_supported, Diagnostic,
    LanguageRunner, Severity,
};
pub use measured::{compile_pipeline, run_rust_snippet_measured, MemSample, Pipeline, Telemetry};
pub use plugin::{
    available_languages, builtin_plugins, find_plugin, registry, run_course_program, run_program,
    run_program_with_support, toolchain_version, LanguageInfo, LanguagePlugin, PluginRunner,
};
pub use runner::{
    run_rust_snippet, run_rust_snippet_in, run_rust_snippet_with_deps, Assessment, Correctness,
    RunOutput,
};
pub use tracer::{trace_execution, trace_python, ExecutionTrace, TraceStep, Var};
