//! Comandos IPC de execução de testes e de ficheiro — adaptadores finos sobre o caso de
//! uso Tauri-free `crate::testexec` e sobre utilitários já puros de
//! `tutor_eval::testnav`/`crate::fsops`.
//!
//! Nenhuma regra de negócio vive aqui. Os comandos com regra (`run_test` despacha por
//! língua, `run_tests` escolhe sessão-vs-host, `run_path` traduz argumentos) correm o caso
//! de uso num worker bloqueante (compilar/correr testes é trabalho longo — nunca na thread
//! da janela) e mapeiam o erro tipado → `String` só na fronteira; `list_tests`/
//! `run_all_tests` são passagens directas para funções já Tauri-free. Comportamento idêntico
//! ao que `lib.rs` tinha antes da Etapa 3 (mesmas mensagens de erro, mesmos contratos serde).

use crate::testexec;

/// Section 5: discover the `#[test]` functions under `root` so the UI can list them and
/// run one individually. Syntactic (`syn`); notes `#[ignore]`. Runs off the UI thread.
#[tauri::command]
pub async fn list_tests(root: String) -> Result<Vec<tutor_eval::testnav::TestItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tutor_eval::testnav::discover_tests(std::path::Path::new(&root))
    })
    .await
    .map_err(|e| format!("test discovery task failed: {e}"))
}

/// Section 5: run one test by its `path` (from `list_tests`) in the project at `root`,
/// dispatching by `lang`: Rust via `cargo test --exact`, Go via `go test -run`. Returns
/// pass/fail + the captured output. Hardened + timed; runs off the UI thread.
#[tauri::command]
pub async fn run_test(
    root: String,
    path: String,
    lang: Option<String>,
) -> Result<tutor_eval::testnav::TestRun, String> {
    tauri::async_runtime::spawn_blocking(move || {
        testexec::run_one(std::path::Path::new(&root), &path, lang.as_deref())
    })
    .await
    .map_err(|e| format!("run_test task failed: {e}"))
}

/// Section 5: run the WHOLE test suite in the project at `root` (the "Run all" button),
/// returning the overall pass/fail + captured output. Hardened + timed; off the UI thread.
#[tauri::command]
pub async fn run_all_tests(root: String) -> Result<tutor_eval::testnav::TestRun, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tutor_eval::testnav::run_suite(std::path::Path::new(&root))
    })
    .await
    .map_err(|e| format!("run_all_tests task failed: {e}"))
}

/// Run the project's test suite and return the command + its outcome, so the Agent's
/// verify step cites real evidence (RF-AG-02) instead of claiming success. Runs inside the
/// container session when one is active (its toolchain), else on the host.
#[tauri::command]
pub async fn run_tests(root: String) -> Result<testexec::SuiteRun, String> {
    tauri::async_runtime::spawn_blocking(move || {
        testexec::run_project_suite(std::path::Path::new(&root))
    })
    .await
    .map_err(|e| format!("test task failed: {e}"))?
    .map_err(|e| e.to_string())
}

/// Run a real file/project from the Explorer and return its captured output.
/// Reuses `RunDto { ok, stdout, stderr }`. Runner selection and the wall-clock
/// timeout + kill live in `fsops::run_file`; the argument split is the `testexec` rule.
#[tauri::command]
pub async fn run_path(path: String, args: Option<String>) -> Result<crate::RunDto, String> {
    // Optional program arguments (e.g. "add 2 3") are split on whitespace and forwarded to
    // the program — so a CLI can actually be exercised, not just run with no args.
    let argv = testexec::split_args(args.as_deref());
    // MUST be async + spawn_blocking: `fsops::run_file` compiles/runs the file (and, under
    // the Delonix/Docker sandbox, spins up a container) — long blocking work. On a SYNC
    // command that runs on the webview's main thread and FREEZES the whole app until it
    // returns. Off-loading it keeps the UI responsive (the spinner shows, the app stays live).
    tauri::async_runtime::spawn_blocking(move || -> Result<crate::RunDto, String> {
        let r = crate::fsops::run_file(&path, &argv)?;
        Ok(crate::RunDto {
            ok: r.ok,
            stdout: r.stdout,
            stderr: r.stderr,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
