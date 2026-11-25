//! Teste integrado do caso de uso «debug» (Etapa 3 — grupo debug/DAP).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`debug::*`) — a mesma
//! fronteira Tauri-free que os comandos (`debug_capabilities`/`available`/`launch`/`break`/
//! `run`/`continue`/`step`/`locals`/`stack`/`stop`) atravessam, sem o runtime Tauri. Prova
//! que a fatia liga: detecção honesta de capacidade + o registo de sessões rejeita ids
//! desconhecidos com a mensagem estável, e — quando há gdb+cc — um ciclo real break→run→ler.

use dxtutor_ide_lib::debug::{self, DebugSessions};
use std::process::Command;

/// Detecção de capacidade honesta e Tauri-free: a nota explica sempre o estado e, havendo
/// gdb na PATH (`available`), o detector reporta um motor. Mesma superfície de
/// `debug_capabilities`/`debug_available`, atravessada pelo crate de teste sem ver `tutor_eval`.
#[test]
fn capabilities_and_available_are_reachable_and_honest() {
    let cap = debug::capabilities();
    assert!(
        !cap.note.is_empty(),
        "a nota de capacidade nunca é vazia: {cap:?}"
    );
    if debug::available() {
        assert!(
            cap.engine.is_some(),
            "com gdb na PATH há motor detectado: {cap:?}"
        );
    }
}

/// O registo de sessões rejeita ids desconhecidos com a mensagem histórica — o caminho de
/// erro que o adaptador IPC aplanava para `String` — sem precisar de um depurador real.
#[test]
fn unknown_session_fails_loudly_without_a_debugger() {
    let sessions = DebugSessions::default();
    assert_eq!(
        debug::driver::set_break(&sessions, "ghost", "t.c", 1).unwrap_err(),
        "no such debug session"
    );
    assert_eq!(
        debug::driver::run(&sessions, "ghost").unwrap_err(),
        "no such debug session"
    );
    // `stop` numa sessão inexistente é benigno, como antes.
    assert!(debug::driver::stop(&sessions, "ghost").is_ok());
}

/// Ciclo real break→run→ler locais→backtrace→stop sobre um programa C minúsculo, pela API
/// pública da fatia. Ignorado quando `gdb`/`cc` não estão na PATH (CI sem eles fica verde) —
/// espelha o teste vivo de `debug.rs`, agora atravessando a fronteira do crate.
#[test]
fn live_round_trip_through_the_public_api() {
    if !debug::available() || which("cc").is_none() {
        eprintln!("skipping: gdb/cc not on PATH");
        return;
    }
    let dir = std::env::temp_dir().join(format!("dxdbg-it-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let src = dir.join("t.c");
    std::fs::write(
        &src,
        "int add(int a,int b){int s=a+b;return s;}\nint main(){return add(2,40);}\n",
    )
    .unwrap();
    let bin = dir.join("t");
    let ok = Command::new("cc")
        .args(["-g", "-O0", "-o"])
        .arg(&bin)
        .arg(&src)
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    assert!(ok, "cc must compile the test program");

    let sessions = DebugSessions::default();
    debug::driver::launch(
        &sessions,
        "t".into(),
        bin.to_string_lossy().into(),
        vec![],
        None,
    )
    .unwrap();
    let bp = debug::driver::set_break(&sessions, "t", &src.to_string_lossy(), 1).unwrap();
    assert!(bp >= 1, "breakpoint number");
    let stop = debug::driver::run(&sessions, "t").unwrap();
    assert!(
        stop.stopped && !stop.exited,
        "stops at the breakpoint: {stop:?}"
    );
    assert_eq!(stop.func, "add", "stopped in add");
    let vars = debug::driver::locals(&sessions, "t").unwrap();
    assert!(
        vars.iter().any(|v| v.name == "a" && v.value == "2"),
        "a=2 among {vars:?}"
    );
    let frames = debug::driver::stack(&sessions, "t").unwrap();
    assert!(
        frames.iter().any(|f| f.func == "main"),
        "main in backtrace: {frames:?}"
    );
    debug::driver::stop(&sessions, "t").unwrap();
    let _ = std::fs::remove_dir_all(&dir);
}

fn which(tool: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(tool))
        .find(|p| p.is_file())
}
