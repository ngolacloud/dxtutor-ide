//! Comandos IPC de depuração real (DAP, secção 5) — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::debug`.
//!
//! Nenhuma regra vive aqui. O motor gdb/MI (`debug::driver`) e a detecção de capacidade
//! (`debug::capabilities`) já são Tauri-free: os comandos só desembrulham o
//! `tauri::State<'_, DebugSessions>` para `&DebugSessions` e encaminham. Comportamento
//! idêntico ao que `lib.rs` tinha antes da Etapa 3 — mesmos nomes, args, contratos serde e
//! mensagens de erro (o `String` de `debug::driver` passa cru). O registo da sessão
//! (`DebugSessions`) continua gerido pelo Tauri (`.manage(...)` em `lib.rs`).

use crate::debug::{self, DebugSessions};

/// Section 5 (DAP): what the host can really do for debugging. Honest — `available` is
/// true only when a real DAP adapter is installed; otherwise the note points at the
/// instrumentation tracer (Visualize) as the fallback. Detection only, starts nothing.
#[tauri::command]
pub fn debug_capabilities() -> debug::DebugCapability {
    debug::capabilities()
}

#[tauri::command]
pub fn debug_available() -> bool {
    debug::available()
}

#[tauri::command]
pub fn debug_launch(
    sessions: tauri::State<'_, DebugSessions>,
    id: String,
    program: String,
    cwd: Option<String>,
) -> Result<(), String> {
    debug::driver::launch(&sessions, id, program, cwd)
}

#[tauri::command]
pub fn debug_break(
    sessions: tauri::State<'_, DebugSessions>,
    id: String,
    file: String,
    line: u32,
) -> Result<u32, String> {
    debug::driver::set_break(&sessions, &id, &file, line)
}

#[tauri::command]
pub fn debug_run(
    sessions: tauri::State<'_, DebugSessions>,
    id: String,
) -> Result<debug::Stop, String> {
    debug::driver::run(&sessions, &id)
}

#[tauri::command]
pub fn debug_continue(
    sessions: tauri::State<'_, DebugSessions>,
    id: String,
) -> Result<debug::Stop, String> {
    debug::driver::cont(&sessions, &id)
}

#[tauri::command]
pub fn debug_step(
    sessions: tauri::State<'_, DebugSessions>,
    id: String,
    into: bool,
) -> Result<debug::Stop, String> {
    debug::driver::step(&sessions, &id, into)
}

#[tauri::command]
pub fn debug_locals(
    sessions: tauri::State<'_, DebugSessions>,
    id: String,
) -> Result<Vec<debug::Var>, String> {
    debug::driver::locals(&sessions, &id)
}

#[tauri::command]
pub fn debug_stack(
    sessions: tauri::State<'_, DebugSessions>,
    id: String,
) -> Result<Vec<debug::Frame>, String> {
    debug::driver::stack(&sessions, &id)
}

#[tauri::command]
pub fn debug_stop(sessions: tauri::State<'_, DebugSessions>, id: String) -> Result<(), String> {
    debug::driver::stop(&sessions, &id)
}
