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

/// A6 (docs/v2/UI-AUDIT.md item 3, TEST-04): the test runners the project really has (cargo,
/// go, pytest/unittest, vitest/jest, maven/gradle), each with its command and whether its
/// tool is installed. Never invents one.
#[tauri::command]
pub async fn test_runners(root: String) -> Result<Vec<tutor_eval::testrun::Runner>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        tutor_eval::testrun::detect_runners(std::path::Path::new(root.trim()))
    })
    .await
    .map_err(|e| format!("test runner detection failed: {e}"))
}

/// The files changed in the working tree (tracked changes since HEAD + untracked), for the
/// "affected tests" scope (TEST-05).
fn changed_files(root: &std::path::Path) -> Vec<String> {
    let run = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| {
                String::from_utf8_lossy(&o.stdout)
                    .lines()
                    .map(String::from)
                    .filter(|l| !l.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };
    let mut v = run(&["diff", "--name-only", "HEAD"]);
    v.extend(run(&["ls-files", "--others", "--exclude-standard"]));
    v.sort();
    v.dedup();
    v
}

/// Runs one runner on a scope (`{kind:"all"}`, `{kind:"case", name}`, or
/// `{kind:"changed", files}` — empty `files` = the files git sees as changed) and returns the
/// per-test results. The run is kept in the project database (the Testing pane's history).
#[tauri::command]
pub async fn test_run(
    app: tauri::AppHandle,
    root: String,
    runner: String,
    scope: tutor_eval::testrun::Scope,
) -> Result<tutor_eval::testrun::TestRunReport, String> {
    let db = crate::board::db_path(&app).ok();
    tauri::async_runtime::spawn_blocking(
        move || -> Result<tutor_eval::testrun::TestRunReport, String> {
            use tutor_eval::testrun::{Scope, Status};
            let root_p = std::path::PathBuf::from(root.trim());
            let r = tutor_eval::testrun::detect_runners(&root_p)
                .into_iter()
                .find(|r| r.id == runner)
                .ok_or_else(|| format!("runner desconhecido nesta pasta: {runner}"))?;
            let scope = match scope {
                Scope::Changed { files } if files.is_empty() => Scope::Changed {
                    files: changed_files(&root_p),
                },
                s => s,
            };
            if let Scope::Changed { files } = &scope {
                if files.is_empty() {
                    return Err("não há ficheiros alterados (git diff HEAD vazio)".into());
                }
            }
            let rep = tutor_eval::testrun::run(&root_p, &r, &scope);
            // a run that ran no test (nothing matched the changed files) is not history
            if rep.ran && !rep.results.is_empty() {
                if let Some(db) = &db {
                    let st = |s: Status| match s {
                        Status::Passed => "passed",
                        Status::Failed => "failed",
                        Status::Skipped => "skipped",
                    };
                    let run = tutor_board::project::testhist::NewRun {
                        runner: rep.runner.clone(),
                        command: rep.command.clone(),
                        scope: match &scope {
                            Scope::All => "all",
                            Scope::Case { .. } => "case",
                            Scope::Changed { .. } => "changed",
                        }
                        .into(),
                        ok: rep.ok,
                        duration_ms: rep.duration_ms,
                        cases: rep
                            .results
                            .iter()
                            .map(|c| tutor_board::project::testhist::NewCase {
                                case_id: c.id.clone(),
                                name: c.name.clone(),
                                suite: c.suite.clone(),
                                status: st(c.status).into(),
                                duration_ms: c.duration_ms,
                                message: c.message.clone(),
                            })
                            .collect(),
                    };
                    if let Ok(mut s) = tutor_board::project::ProjectStore::open(db) {
                        let _ = s.record_test_run(&root, &run, crate::board::now_ms());
                    }
                }
            }
            Ok(rep)
        },
    )
    .await
    .map_err(|e| format!("test run failed: {e}"))?
}

/// The recent test runs of the project and each test's recent results (pass/fail flips,
/// flaky, average duration) — computed from the kept runs, empty without them (TEST-03).
#[tauri::command]
pub fn test_history(
    app: tauri::AppHandle,
    root: String,
) -> Result<tutor_board::project::testhist::TestHistory, String> {
    let db = crate::board::db_path(&app)?;
    let s = tutor_board::project::ProjectStore::open(&db)?;
    s.test_history(root.trim(), 30).map_err(|e| e.message)
}
