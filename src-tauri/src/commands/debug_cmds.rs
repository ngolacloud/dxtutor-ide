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
use tutor_eval::dapc::{
    BreakpointSpec, BreakpointState, DapSession, DapThread, DataBreakpoint, DataTarget,
    MemoryBlock, Position, SessionCaps, VarNode, WriteHit,
};

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
    /// what the adapter can do (DAP; none for gdb) — r23 F2
    pub caps: Option<SessionCaps>,
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
    args: Option<Vec<String>>,
) -> Result<LaunchInfo, String> {
    let args = args.unwrap_or_default();
    if engine.as_deref() != Some("gdb") && tutor_eval::dapc::find_adapter().is_some() {
        let (sid, app2) = (id.clone(), app.clone());
        let on_output: tutor_eval::dapc::OnOutput = Arc::new(move |category: &str, text: &str| {
            let _ = app2.emit(
                "debug://output",
                OutputEvent {
                    id: sid.clone(),
                    category: category.into(),
                    // r23 F4a (X04): a debugged program's output is masked too
                    text: tutor_protect::redact::current().mask(text),
                },
            );
        });
        let s = tauri::async_runtime::spawn_blocking(move || {
            DapSession::launch(&program, &args, cwd.as_deref(), Some(on_output))
        })
        .await
        .map_err(|e| format!("debug task failed: {e}"))??;
        let adapter = s.adapter.clone();
        let caps = Some(s.caps());
        dap.insert(id, s)?;
        return Ok(LaunchInfo {
            engine: "dap".into(),
            adapter,
            caps,
        });
    }
    debug::driver::launch(&sessions, id, program, args, cwd)?;
    Ok(LaunchInfo {
        engine: "gdb".into(),
        adapter: "gdb".into(),
        caps: None,
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
        // lldb resolves `rust_panic`; gdb (a replay, r23 F2b) only `__rustc::rust_panic`, the
        // symbol's full name in current Rust. Both name the same place: the program stops once.
        Ok(s.set_function_breakpoints(&if on {
            vec!["rust_panic".to_string(), "__rustc::rust_panic".to_string()]
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

/// A watch expression in a frame, or (`context: "repl"`) a line of the debug console (r23 F2).
#[tauri::command]
pub async fn debug_evaluate(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    expression: String,
    frame: u32,
    context: Option<String>,
) -> Result<VarNode, String> {
    let s = need_dap(&dap, &id)?;
    let ctx = context.unwrap_or_else(|| "watch".into());
    blocking(move || s.evaluate_in(&expression, frame, &ctx)).await
}

/// Run to the cursor (r23 F2): a temporary breakpoint on `line` of `file`, continue, and the
/// temporary breakpoint is gone wherever the program stops.
#[tauri::command]
pub async fn debug_run_to(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    file: String,
    line: u32,
) -> Result<debug::Stop, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.run_to(&file, line).map(Into::into)).await
}

/// Restart a frame (r23 F2) — only adapters that announce `supportsRestartFrame`.
#[tauri::command]
pub async fn debug_restart_frame(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    frame: u32,
) -> Result<debug::Stop, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.restart_frame(frame).map(Into::into)).await
}

/// Data breakpoints (r23 F2): add one on a variable and/or remove one by its id; the list back.
#[tauri::command]
pub async fn debug_data_breakpoints(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    add: Option<DataTarget>,
    remove: Option<String>,
) -> Result<Vec<DataBreakpoint>, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.data_breakpoints(add, remove.as_deref())).await
}

/// The bytes of a variable (r23 F2), from its memory reference.
#[tauri::command]
pub async fn debug_read_memory(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    memory_reference: String,
    offset: i64,
    count: u32,
) -> Result<MemoryBlock, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.read_memory(&memory_reference, offset, count)).await
}

/// The exception filters to stop on (r23 F2), among the ones the adapter offers; the ones set.
#[tauri::command]
pub async fn debug_exception_filters(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    filters: Vec<String>,
) -> Result<Vec<String>, String> {
    let s = need_dap(&dap, &id)?;
    blocking(move || s.set_exception_filters(&filters)).await
}

/* ───── r23 F2b: record and replay (rr) ───── */

fn output_sink(app: &tauri::AppHandle, id: &str) -> tutor_eval::dapc::OnOutput {
    let (sid, app2) = (id.to_string(), app.clone());
    Arc::new(move |category: &str, text: &str| {
        let _ = app2.emit(
            "debug://output",
            OutputEvent {
                id: sid.clone(),
                category: category.into(),
                // r23 F4a (X04): a debugged program's output is masked too
                text: tutor_protect::redact::current().mask(text),
            },
        );
    })
}

fn need_replay(dap: &DapSessions, id: &str) -> Result<Arc<DapSession>, String> {
    let s = need_dap(dap, id)?;
    if s.is_replay() {
        Ok(s)
    } else {
        Err("this needs a recording (rr): replay the run first".into())
    }
}

/// Records `program args` in `cwd` with rr (Linux); the trace to replay, its exit code and output.
#[tauri::command]
pub async fn debug_record(
    id: String,
    program: String,
    args: Option<Vec<String>>,
    cwd: Option<String>,
) -> Result<tutor_eval::rr::Recording, String> {
    blocking(move || {
        tutor_eval::rr::record(
            &id,
            &program,
            &args.unwrap_or_default(),
            cwd.as_deref().map(std::path::Path::new),
        )
    })
    .await
}

/// Replays a recording: rr serves it, gdb (DAP mode) drives it; the session takes the usual
/// `debug_*` commands, plus the ones below (backwards, the position, travel, writes).
#[tauri::command]
pub async fn debug_replay(
    app: tauri::AppHandle,
    dap: tauri::State<'_, DapSessions>,
    id: String,
    trace: String,
    program: String,
    cwd: Option<String>,
) -> Result<LaunchInfo, String> {
    let on = output_sink(&app, &id);
    let s =
        blocking(move || DapSession::replay(&trace, &program, cwd.as_deref(), Some(on))).await?;
    let (adapter, caps) = (s.adapter.clone(), Some(s.caps()));
    dap.insert(id, s)?;
    Ok(LaunchInfo {
        engine: "dap".into(),
        adapter,
        caps,
    })
}

/// Backwards in a replay: `next`, `step`, `out` or `continue`.
#[tauri::command]
pub async fn debug_reverse(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    kind: String,
) -> Result<debug::Stop, String> {
    let s = need_replay(&dap, &id)?;
    blocking(move || s.reverse(&kind).map(Into::into)).await
}

/// Where a replay is in its recording (ticks, event) and the recording's span.
#[tauri::command]
pub async fn debug_position(
    dap: tauri::State<'_, DapSessions>,
    id: String,
) -> Result<Position, String> {
    let s = need_replay(&dap, &id)?;
    blocking(move || s.position()).await
}

/// To the moment `(event, ticks)` of the recording (a stop at `file:line`; empty file: start or end).
#[tauri::command]
pub async fn debug_travel(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    event: u64,
    ticks: u64,
    file: String,
    line: u32,
    watch: Option<String>,
) -> Result<debug::Stop, String> {
    let s = need_replay(&dap, &id)?;
    blocking(move || {
        s.travel(event, ticks, &file, line, watch.as_deref())
            .map(Into::into)
    })
    .await
}

/// «Where did this come from»: back to the last write to `expression` in frame `frame`.
#[tauri::command]
pub async fn debug_last_write(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    frame: u32,
    expression: String,
) -> Result<debug::Stop, String> {
    let s = need_replay(&dap, &id)?;
    blocking(move || s.last_write(frame, &expression).map(Into::into)).await
}

/// Every change to `expression` (frame `frame`) while its function runs, up to `max`.
#[tauri::command]
pub async fn debug_writes(
    dap: tauri::State<'_, DapSessions>,
    id: String,
    frame: u32,
    expression: String,
    max: Option<usize>,
) -> Result<Vec<WriteHit>, String> {
    let s = need_replay(&dap, &id)?;
    blocking(move || s.writes(frame, &expression, max.unwrap_or(50).min(200))).await
}

/// «Debug this test» (r23 F2): builds the project's test binaries and lists their tests.
#[tauri::command]
pub async fn debug_test_targets(
    root: String,
) -> Result<Vec<tutor_eval::testbins::TestBinary>, String> {
    blocking(move || {
        tutor_eval::testbins::test_targets(
            std::path::Path::new(root.trim()),
            &crate::shellenv::command,
        )
    })
    .await
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
#[allow(clippy::too_many_arguments)] // um argumento por campo do IPC (como o codev_agent_start e o pty)
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
                // r23 F4a (X04): a debugged program's output is masked too
                text: tutor_protect::redact::current().mask(text),
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
    let caps = Some(s.caps());
    dap.insert(id, s)?;
    Ok(LaunchInfo {
        engine: "dap".into(),
        adapter: label,
        caps,
    })
}
