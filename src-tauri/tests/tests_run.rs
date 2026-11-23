//! Teste integrado do caso de uso «correr testes» (Etapa 3 — grupo testes/execução).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`testexec::*`), sobre
//! um projecto Rust real (tempdir) — a mesma fronteira que os comandos Tauri (`run_tests`,
//! `run_test`) atravessam, sem o runtime Tauri. Prova que a fatia liga: escolha de comando
//! + execução real → DTO tipado / erro tipado, com o comportamento (e as mensagens)
//! preservados da versão em `lib.rs`.

use dxtutor_ide_lib::testexec::{run_project_suite, TestError};
use std::fs;

/// Cria um crate Rust mínimo (sem dependências, logo compila offline) com um teste que
/// passa. Devolve o directório temporário (mantido vivo pelo chamador).
fn trivial_passing_crate() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"x\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/lib.rs"),
        "pub fn add(a: i32, b: i32) -> i32 { a + b }\n\
         #[cfg(test)]\nmod tests {\n    use super::*;\n    #[test]\n    fn soma() { assert_eq!(add(2, 2), 4); }\n}\n",
    )
    .unwrap();
    dir
}

/// Projecto Rust real sem sessão de contentor: o caso de uso escolhe `cargo test` e corre-o
/// no host, devolvendo o DTO tipado com o comando que correu e `ok == true`. Prova que a
/// fatia liga ponta-a-ponta ao mecanismo real (compila + corre um teste que passa).
#[test]
fn runs_the_project_suite_over_a_real_rust_project() {
    let dir = trivial_passing_crate();

    let run = run_project_suite(dir.path()).expect("um crate Rust válido tem comando de teste");

    assert_eq!(
        run.command, "cargo test",
        "escolheu o comando pelo marcador Cargo.toml"
    );
    assert!(run.ok, "a suite passa: {}\n{}", run.stdout, run.stderr);
}

/// Pasta sem marcador de projecto → erro TIPADO (`NoTestCommand`), com a mensagem estável
/// da UI, ANTES de correr qualquer processo (a regra corta primeiro).
#[test]
fn no_known_suite_is_a_typed_error() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("README.md"), "# vazio\n").unwrap();

    let err = run_project_suite(dir.path()).unwrap_err();
    assert!(matches!(err, TestError::NoTestCommand));
    assert_eq!(err.to_string(), "No known test command for this project.");
}
