//! Teste integrado do caso de uso «rever código» (Etapa 3 — grupo review).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`review::run_review`),
//! sobre um projecto Rust real (tempdir) — a mesma fronteira que o comando Tauri
//! `review_code` atravessa, sem precisar do runtime Tauri. Prova que a fatia liga:
//! regra de escopo tipada → motor offline `tutor_eval::review` → relatório tipado /
//! erro tipado, com o comportamento (e as mensagens) preservados da versão em `lib.rs`.

use dxtutor_ide_lib::review::{run_review, ReviewError};
use std::fs;

/// Projecto Rust real: o motor corre os analisadores locais e devolve um relatório
/// tipado que ecoa a `version` pedida. Não assere findings concretos (dependem das
/// ferramentas instaladas no host) — assere que o caso de uso liga ponta-a-ponta.
#[test]
fn reviews_a_real_rust_project_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(
        root.join("Cargo.toml"),
        "[package]\nname = \"x\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/main.rs"),
        "fn main() {\n    let x = 5;\n    println!(\"{x}\");\n}\n",
    )
    .unwrap();

    let report = run_review(root, "project", None, Some("v1".into()))
        .expect("o caso de uso corre sobre um projecto real");

    assert_eq!(
        report.version.as_deref(),
        Some("v1"),
        "a versão é ecoada tal-e-qual"
    );
    // O motor regista sempre que analisadores correu (honesto mesmo sem nenhum).
    assert!(
        !report.analyzers.is_empty(),
        "há um relatório de cobertura dos analisadores"
    );
}

/// Escopo `"file"` sem caminho → erro TIPADO (`FileScopeNeedsPath`), com a mensagem
/// estável da UI, ANTES de tocar no disco (a regra corta primeiro).
#[test]
fn file_scope_without_path_is_a_typed_error() {
    let err = run_review(std::path::Path::new("/nonexistent"), "file", None, None).unwrap_err();
    assert!(matches!(err, ReviewError::FileScopeNeedsPath));
    assert_eq!(err.to_string(), "file scope needs a path");
}

/// Escopo desconhecido cai no projecto inteiro (fail-open histórico): não é erro.
#[test]
fn unknown_scope_falls_back_to_project() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("README.md"), "# vazio\n").unwrap();
    // Sem Cargo.toml/go.mod/python → nenhum analisador corre, mas o relatório existe.
    let report =
        run_review(dir.path(), "whatever", None, None).expect("escopo desconhecido não é erro");
    assert!(
        report.findings.is_empty(),
        "projecto sem fontes analisáveis → sem findings"
    );
}
