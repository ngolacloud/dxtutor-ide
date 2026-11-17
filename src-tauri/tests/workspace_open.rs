//! Teste integrado do caso de uso «abrir workspace» (Etapa 2 — primeira fatia vertical).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`workspace::open_workspace`),
//! sobre um sistema de ficheiros real (tempdir) — a mesma fronteira que o comando Tauri
//! `load_workspace` atravessa, sem precisar do runtime Tauri. Prova que a fatia liga ponta-a-ponta
//! do lado do backend: política tipada → walk real de disco → `Loaded` tipado → erro tipado.

use dxtutor_ide_lib::workspace::{open_workspace, LoadPolicy, OpenError};
use std::fs;

/// Projecto real: carrega ficheiros de texto, ordena-os, ignora `node_modules`/binários,
/// e devolve o nome da pasta — tudo pelo caso de uso, com a política por omissão.
#[test]
fn opens_a_real_project_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("node_modules/x")).unwrap();
    fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
    fs::write(root.join("README.md"), "# projecto\n").unwrap();
    fs::write(root.join("node_modules/x/a.js"), "ignored").unwrap();
    fs::write(root.join("logo.bin"), [0u8, 159, 146, 150]).unwrap();

    let loaded = open_workspace(root, LoadPolicy::default()).expect("abre o workspace");

    let paths: Vec<_> = loaded.files.iter().map(|f| f.path.as_str()).collect();
    assert_eq!(paths, vec!["README.md", "src/main.rs"], "só texto, ordenado, sem node_modules");
    assert_eq!(loaded.skipped, 1, "o binário é contado como ignorado");
    assert!(!loaded.truncated);
    assert_eq!(
        loaded.root,
        root.canonicalize().unwrap().to_string_lossy(),
        "a raiz vem canonicalizada"
    );
    assert!(!loaded.name.is_empty());
}

/// A política é uma regra do caso de uso, não um número preso no comando: baixá-la trunca.
#[test]
fn custom_policy_truncates_the_file_set() {
    let dir = tempfile::tempdir().unwrap();
    for i in 0..6 {
        fs::write(dir.path().join(format!("f{i}.txt")), "x").unwrap();
    }
    let loaded = open_workspace(dir.path(), LoadPolicy { max_files: 2, max_bytes: 1024 })
        .expect("abre com política apertada");
    assert_eq!(loaded.files.len(), 2);
    assert!(loaded.truncated, "atingido o limite → truncado");
}

/// Raiz que não é pasta → erro TIPADO (`NotADirectory`), com a mensagem estável da UI.
#[test]
fn a_file_root_is_a_typed_not_a_directory_error() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.txt");
    fs::write(&file, "x").unwrap();
    let err = open_workspace(&file, LoadPolicy::default()).unwrap_err();
    assert!(matches!(err, OpenError::NotADirectory));
    assert_eq!(err.to_string(), "not a folder");
}
