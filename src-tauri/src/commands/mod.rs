//! Comandos Tauri por feature (Etapa 3 da reorg Clean Architecture).
//!
//! O monólito `lib.rs` registava todos os `#[tauri::command]` no mesmo ficheiro.
//! Esta pasta recolhe-os por feature como **adaptadores finos** sobre casos de uso
//! Tauri-free (ex. `commands::review` → `crate::review`), deixando `lib.rs` a
//! compor/registar. Grupos extraídos: `review`, `codeintel`, `tests`, `git`, `codev`,
//! `codev_agent`, `dictation`, `search`, `agent`, `assistant`, `debug_cmds`, `devcontainer`, `sandbox`, `pair`,
//! `study`, `missions`, `panel`.

pub mod agent;
pub mod assistant;
pub mod codebase;
pub mod codeintel;
pub mod codev;
pub mod codev_agent;
pub mod debug_cmds;
pub mod devcontainer;
pub mod dictation;
pub mod git;
pub mod hood;
pub mod missions;
pub mod ops;
pub mod pair;
pub mod panel;
pub mod plugins;
pub mod protect;
pub mod review;
pub mod sandbox;
pub mod search;
pub mod study;
pub mod tests;
