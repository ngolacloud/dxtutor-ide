//! Comandos IPC de depuração real (secção 5) — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::debug` (gdb/MI) e `tutor_eval::dapc` (DAP).
//!
//! Nenhuma regra vive aqui. O motor gdb/MI (`debug::driver`) e a detecção de capacidade
//! (`debug::capabilities`) já são Tauri-free: os comandos só desembrulham o estado gerido e
//! encaminham, com as mensagens de erro do motor tal-e-quais.
//!
//! ADR-0006, R4: `debug_launch`/`debug_run`/`debug_continue`/`debug_step` são `async` — esperam
//! até o programa parar, fora da thread da janela.
//!
//! A7 (docs/v2/UI-AUDIT.md item 4): com um adaptador DAP no PATH (lldb-dap), `debug_launch`
//! abre uma sessão DAP e os mesmos comandos (`break`/`run`/`continue`/`step`/`locals`/`stack`/
//! `stop`) seguem por ela; sem adaptador, o gdb/MI como antes. Só o DAP dá o resto: breakpoints
//! com condição, contagem e logpoints (`debug_set_breakpoints`), parar em panic, threads,
//! variáveis em árvore com o que mudou, watch, step out e pause. A saída do programa chega pelo
//! evento `debug://output`. Os breakpoints do gutter ficam na base do projecto
//! (`breakpoints_load`/`breakpoints_save`) e um snapshot da sessão vai para a issue
//! (`debug_snapshot`).

use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;
use tutor_eval::dapc::{BreakpointSpec, BreakpointState, DapSession, DapThread, VarNode};

use crate::debug::{self, DapSessions, DebugSessions};

/// Section 5 (DAP): what the host can really do for debugging. Honest — `available` is
/// true only when a real DAP adapter is installed; otherwise the note points at the
/// instrumentation tracer (Visualize) as the fallback. Detection only, starts nothing.
#[tauri::command]
pub fn debug_capabilities() -> debug::DebugCapability {
    debug::capabilities()
}

#[tauri::command]
pub fn debug_available() -> bool {
    debug::available() || tutor_eval::dapc::find_adapter().is_some()
}

/// The engine a session runs on.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchInfo {
    /// "dap" or "gdb"
    pub engine: String,
    pub adapter: String,
}

#[derive(Clone, Serialize)]
struct OutputEvent {
    id: String,
    category: String,
    text: String,
}

#[tauri::command]
pub async fn debug_launch(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
    program: String,
    cwd: Option<String>,
    engine: Option<String>,
) -> Result<LaunchInfo, String> {
    if engine.as_deref() != Some("gdb") && tutor_eval::dapc::find_adapter().is_some() {
        let (sid, app2) = (id.clone(), app.clone());
        let on_output: tutor_eval::dapc::OnOutput = Arc::new(move |category: &str, text: &str| {
            let _ = app2.emit(
                "debug://output",
                OutputEvent {
                    id: sid.clone(),
                    category: category.into(),
                    text: text.into(),
                },
            );
        });
        let s = tauri::async_runtime::spawn_blocking(move || {
            DapSession::launch(&program, &[], cwd.as_deref(), Some(on_output))
        })
        .await
        .map_err(|e| format!("debug task failed: {e}"))??;
        let adapter = s.adapter.clone();
        dap.insert(id, s)?;
        return Ok(LaunchInfo {
            engine: "dap".into(),
            adapter,
        });
    }
    debug::driver::launch(&sessions, id, program, cwd)?;
    Ok(LaunchInfo {
        engine: "gdb".into(),
        adapter: "gdb".into(),
    })
}

fn dap_of(dap: &DapSessions, id: &str) -> Option<Arc<DapSession>> {
    dap.get(id)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("debug task failed: {e}"))?
}

fn need_dap(dap: &DapSessions, id: &str) -> Result<Arc<DapSession>, String> {
    dap_of(dap, id).ok_or_else(|| {
        "this needs a DAP session — install lldb-dap (LLVM) and start debugging again".to_string()
    })
}

#[tauri::command]
pub async fn debug_break(
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
    file: String,
    line: u32,
) -> Result<u32, String> {
    if let Some(s) = dap_of(&dap, &id) {
        return blocking(move || {
            let r = s.add_breakpoint(&file, line)?;
            Ok(if r.verified { line } else { 0 })
        })
        .await;
    }
    debug::driver::set_break(&sessions, &id, &file, line)
}

#[tauri::command]
pub async fn debug_run(
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
) -> Result<debug::Stop, String> {
    if let Some(s) = dap_of(&dap, &id) {
        return blocking(move || s.run().map(Into::into)).await;
    }
    debug::driver::run(&sessions, &id)
}

#[tauri::command]
pub async fn debug_continue(
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
) -> Result<debug::Stop, String> {
    if let Some(s) = dap_of(&dap, &id) {
        return blocking(move || s.cont().map(Into::into)).await;
    }
    debug::driver::cont(&sessions, &id)
}

/// Step over (`into` false), into (`into` true), or out (`kind: "out"`, DAP only).
#[tauri::command]
pub async fn debug_step(
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
    into: bool,
    kind: Option<String>,
) -> Result<debug::Stop, String> {
    if let Some(s) = dap_of(&dap, &id) {
        let k = kind.unwrap_or_else(|| if into { "into".into() } else { "over".into() });
        return blocking(move || s.step(&k).map(Into::into)).await;
    }
    if kind.as_deref() == Some("out") {
        return Err("step out needs a DAP session (lldb-dap)".into());
    }
    debug::driver::step(&sessions, &id, into)
}

#[tauri::command]
pub async fn debug_locals(
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
) -> Result<Vec<debug::Var>, String> {
    if let Some(s) = dap_of(&dap, &id) {
        return blocking(move || {
            Ok(s.locals(0)?
                .into_iter()
                .map(|v| debug::Var {
                    name: v.name,
                    value: v.value,
                })
                .collect())
        })
        .await;
    }
    debug::driver::locals(&sessions, &id)
}

/// The stack of the stopped thread (or of `thread`, DAP).
#[tauri::command]
pub async fn debug_stack(
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
    thread: Option<i64>,
) -> Result<Vec<debug::Frame>, String> {
    if let Some(s) = dap_of(&dap, &id) {
        return blocking(move || {
            Ok(s.stack(thread)?
                .into_iter()
                .map(|f| debug::Frame {
                    level: f.level,
                    func: f.func,
                    file: f.file,
                    line: f.line,
                })
                .collect())
        })
        .await;
    }
    debug::driver::stack(&sessions, &id)
}

#[tauri::command]
pub fn debug_stop(
    sessions: tauri::State<'_, DebugSessions>,
    dap: tauri::State<'_, DapSessions>,
    id: String,
) -> Result<(), String> {
    if let Some(s) = dap.remove(&id) {
        std::thread::spawn(move || s.stop());
        return Ok(());
    }
    debug::driver::stop(&sessions, &id)
}

/// The breakpoints of one file with their condition, hit count and log message (DAP).
#[tauri::command]
pub async fn debug_set_breakpoints(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    file: String,
    breakpoints: Vec<BreakpointSpec>,
) -> Result<Vec<BreakpointState>, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.set_breakpoints(&file, &breakpoints)).await
}

/// Stop when the program panics (`rust_panic`) — DAP. Returns whether the adapter found it.
#[tauri::command]
pub async fn debug_stop_on_panic(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    on: bool,
) -> Result<bool, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || {
        Ok(s.set_function_breakpoints(&if on {
            vec!["rust_panic".to_string()]
        } else {
            vec![]
        })? > 0)
    })
    .await
}

#[tauri::command]
pub async fn debug_threads(
    dap: tauri::State<'_, DapSessions>,
    id: String,
) -> Result<Vec<DapThread>, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.threads()).await
}

/// The scopes of a frame (no `reference`) or the children of a variable, with what changed.
#[tauri::command]
pub async fn debug_variables(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    frame: u32,
    reference: Option<i64>,
) -> Result<Vec<VarNode>, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.variables(frame, reference)).await
}

/// A watch expression in a frame.
#[tauri::command]
pub async fn debug_evaluate(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    expression: String,
    frame: u32,
) -> Result<VarNode, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.evaluate(&expression, frame)).await
}

/// Ask a running program to stop (the waiting `run`/`continue` returns the stop).
#[tauri::command]
pub async fn debug_pause(dap: tauri::State<'_, DapSessions>, id: String) -> Result<(), String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.pause()).await
}

/// The gutter's breakpoints of the project (kept in the project database).
#[tauri::command]
pub fn breakpoints_load(
    app: tauri::AppHandle,
    root: String,
) -> Result<Vec<tutor_board::project::breakpoints::Breakpoint>, String> {
    let s = tutor_board::project::ProjectStore::open(&crate::board::db_path(&app)?)?;
    s.breakpoints(root.trim()).map_err(|e| e.message)
}

/// Replaces the kept breakpoints of one file (relative to the project).
#[tauri::command]
pub fn breakpoints_save(
    app: tauri::AppHandle,
    root: String,
    file: String,
    breakpoints: Vec<tutor_board::project::breakpoints::Breakpoint>,
) -> Result<(), String> {
    let mut s = tutor_board::project::ProjectStore::open(&crate::board::db_path(&app)?)?;
    s.save_breakpoints(root.trim(), &file, &breakpoints)
        .map_err(|e| e.message)
}

/// Keeps a snapshot of the session (where it stopped, the stack, the variables, the output) as
/// markdown, linked to an issue when one is given — it shows in the issue's panel.
#[tauri::command]
pub fn debug_snapshot(
    app: tauri::AppHandle,
    root: String,
    id: String,
    issue: Option<String>,
    title: String,
    markdown: String,
) -> Result<(), String> {
    let mut s = tutor_board::project::ProjectStore::open(&crate::board::db_path(&app)?)?;
    let issue = issue
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty());
    s.record_artifact(
        root.trim(),
        &format!("debug:{id}"),
        issue.as_deref(),
        &title,
        &markdown,
        crate::board::now_ms(),
    )
    .map_err(|e| e.message)
}

/// Onde anexar o depurador (A10): os contentores/pods (sem nome), ou os processos dentro de um (ou
/// desta máquina, `local`) e o adaptador DAP que lá existe.
#[tauri::command]
pub async fn debug_attach_targets(
    target: tutor_eval::attach::Target,
) -> Result<tutor_eval::attach::Targets, String> {
    blocking(move || Ok(tutor_eval::attach::targets(&target))).await
}

/// Anexa o depurador ao processo `pid` do alvo (local, contentor ou pod) por DAP: o adaptador corre
/// onde o processo corre (`docker exec -i … lldb-dap`); `remote_root` mapeia o caminho onde o
/// programa foi construído para a pasta do projecto. Depois, os `debug_*` seguem por esta sessão.
#[tauri::command]
pub async fn debug_attach(
    app: tauri::AppHandle,
    dap: tauri::State<'_, DapSessions>,
    id: String,
    target: tutor_eval::attach::Target,
    pid: u32,
    adapter: Option<String>,
    root: Option<String>,
    remote_root: Option<String>,
) -> Result<LaunchInfo, String> {
    let adapter = match adapter {
        Some(a) if !a.trim().is_empty() => a,
        _ if target.kind == "local" => tutor_eval::dapc::find_adapter()
            .map(|p| p.display().to_string())
            .ok_or("no DAP adapter on PATH — install lldb-dap (LLVM)")?,
        _ => "lldb-dap".to_string(),
    };
    let argv = tutor_eval::attach::adapter_command(&target, &adapter)?;
    let (sid, app2) = (id.clone(), app.clone());
    let on_output: tutor_eval::dapc::OnOutput = Arc::new(move |category: &str, text: &str| {
        let _ = app2.emit(
            "debug://output",
            OutputEvent {
                id: sid.clone(),
                category: category.into(),
                text: text.into(),
            },
        );
    });
    let map = match (remote_root, root.clone()) {
        (Some(r), Some(l)) if !r.trim().is_empty() => Some((r, l)),
        _ => None,
    };
    let label = argv.join(" ");
    let s = blocking(move || DapSession::attach(&argv, pid, root.as_deref(), Some(on_output), map))
        .await?;
    dap.insert(id, s)?;
    Ok(LaunchInfo {
        engine: "dap".into(),
        adapter: label,
    })
}
