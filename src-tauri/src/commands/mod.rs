//! Comandos Tauri por feature (Etapa 3 da reorg Clean Architecture).
//!
//! O monólito `lib.rs` registava todos os `#[tauri::command]` no mesmo ficheiro.
//! Esta pasta recolhe-os por feature como **adaptadores finos** sobre casos de uso
//! Tauri-free (ex. `commands::review` → `crate::review`), deixando `lib.rs` a
//! compor/registar. Grupos extraídos: `review`, `codeintel`, `tests`, `git`, `codev`,
//! `codev_agent`, `codev_autonomy`, `codev_review`, `codev_worktree`, `dictation`, `search`, `agent`, `assistant`, `debug_cmds`, `devcontainer`, `sandbox`, `pair`,
//! `study`, `missions`, `panel`.

pub mod agent;
pub mod assistant;
pub mod codebase;
pub mod codeintel;
pub mod codev;
pub mod codev_agent;
pub mod codev_autonomy;
pub mod codev_review;
pub mod codev_worktree;
pub mod debug_cmds;
pub mod deploy;
pub mod devcontainer;
pub mod dictation;
pub mod git;
pub mod hood;
pub mod iac;
pub mod llm_policy;
pub mod lsp_install;
pub mod metrics;
pub mod missions;
pub mod ops;
pub mod pair;
pub mod panel;
pub mod platform;
pub mod plugins;
pub mod protect;
pub mod review;
pub mod runbook;
pub mod sandbox;
pub mod scaffold;
pub mod search;
pub mod study;
pub mod tests;
pub mod vault;
