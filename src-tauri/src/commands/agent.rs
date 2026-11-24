//! Comandos IPC de agente / arquitectura — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::agent`.
//!
//! Nenhuma regra de negócio vive aqui. `arch_validate`/`arch_scaffold_preview` são
//! passagens puras ao caso de uso. `arch_scaffold` corre a regra (`agent::scaffold`,
//! erro tipado `ScaffoldError`) num worker bloqueante (escrever disco nunca trava a
//! janela) e aplana o erro → `String` na fronteira, preservando as mensagens
//! históricas. `agent_isolated_patch` e o trio `agent_task_*` (RF-AG-01, consumido por
//! `bridge.ts`) vestem o executor isolado e o registo de tarefas do caso de uso: o
//! `spawn_blocking` e o prefixo `"… task failed: …"` ficam aqui; o estado e as transições
//! ficam no caso de uso. Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3 —
//! mesmos nomes, args, contratos serde e mensagens.

use crate::agent::{self, AgentTask};
use std::path::Path;

/// Validate a System Design (Architecture Studio): run the structural rules over the drawn
/// components + connections and return the findings (errors first). Pure; no I/O.
#[tauri::command]
pub async fn arch_validate(
    arch: tutor_eval::arch::Architecture,
) -> Result<Vec<tutor_eval::arch::Finding>, String> {
    Ok(agent::validate(&arch))
}

/// Generate a project scaffold from a VALID System Design: writes a folder per live component
/// plus ARCHITECTURE.md under `root` (never overwriting existing files). Returns the relative
/// paths written. Errors if the design is invalid.
#[tauri::command]
pub async fn arch_scaffold(
    root: String,
    arch: tutor_eval::arch::Architecture,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || agent::scaffold(Path::new(&root), &arch))
        .await
        .map_err(|e| format!("scaffold task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Preview the scaffold of a design WITHOUT writing: returns the (relPath, content) pairs
/// `arch_scaffold` would write. Feeds the isolated-task delegation (agent_task_submit), so a
/// mission can be reviewed as a worktree patch before anything lands. Empty if the design is
/// invalid (same rule as scaffold).
#[tauri::command]
pub fn arch_scaffold_preview(arch: tutor_eval::arch::Architecture) -> Vec<(String, String)> {
    agent::scaffold_preview(&arch)
}

/// Export a design to Mermaid (`graph TB`, one subgraph per panel and group). The trailing
/// `%% dxt:` comment lines carry what Mermaid cannot (kinds, protocols, panels), so
/// importing the result gives the same design back. Pure; no I/O.
#[tauri::command]
pub fn arch_export_mermaid(arch: tutor_eval::arch::Architecture) -> String {
    agent::export_mermaid(&arch)
}

/// Import a Mermaid `graph`/`flowchart` (with `subgraph`) into a design, plus warnings for
/// what could not be brought over exactly. Errors only when the source is not a flowchart.
/// Parsed in Rust, never in the client. Pure; no I/O.
#[tauri::command]
pub fn arch_import_mermaid(source: String) -> Result<agent::MermaidImport, String> {
    agent::import_mermaid(&source)
}

/// Run a delegated task in an isolated git worktree of HEAD: apply `writes` ([relPath,
/// content] pairs) there and return the unified diff, WITHOUT touching the working tree
/// (RF-AG-01/05). The caller reviews the patch before anything lands.
#[tauri::command]
pub async fn agent_isolated_patch(
    root: String,
    writes: Vec<(String, String)>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || agent::worktree_patch(Path::new(&root), &writes))
        .await
        .map_err(|e| format!("git task failed: {e}"))?
}

/// Submit a delegated task: runs the isolated executor and registers the result under a task
/// id (submit → the task runs → collectable by id). Returns the id immediately.
#[tauri::command]
pub async fn agent_task_submit(
    root: String,
    writes: Vec<(String, String)>,
) -> Result<String, String> {
    let id = agent::new_task_id();
    agent::register_running(&id);
    let id2 = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        agent::run_and_store(&id2, Path::new(&root), &writes);
    });
    Ok(id)
}

/// Status + result of a submitted task (collect). `None` when the id is unknown.
#[tauri::command]
pub fn agent_task_status(id: String) -> Option<AgentTask> {
    agent::status(&id)
}

/// Cancel/forget a task (removes its record). Returns whether it existed.
#[tauri::command]
pub fn agent_task_cancel(id: String) -> bool {
    agent::cancel(&id)
}
