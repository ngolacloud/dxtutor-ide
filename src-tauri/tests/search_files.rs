//! Teste integrado do caso de uso «pesquisa e projecto» (Etapa 3 — grupo search).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`search::*`),
//! sobre ficheiros reais (tempdir) — a mesma fronteira que os comandos Tauri
//! (`search_project`, `list_files`, `detect_projects`, `read_folder_sources`)
//! atravessam, sem o runtime Tauri. Prova que a fatia liga: varrimento/detecção real
//! → DTOs tipados, com o comportamento preservado da versão em `lib.rs` (defaults de
//! página, directórios de build saltados, truncagem honesta).

use dxtutor_ide_lib::search::{detect_projects, list_files, read_folder_sources, search};
use std::fs;

/// `search` + `list_files` sobre um projecto real: a pesquisa literal encontra o termo
/// e o quick-open lista o ficheiro. Prova que os defaults de página delegam ao mecanismo
/// `tutor_eval::search` com a fronteira tipada.
#[test]
fn search_and_list_cover_a_real_project() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("src/main.rs"), "fn main() {\n    let needle = 42;\n}\n").unwrap();

    let hits = search(root, "needle", None, None);
    assert!(!hits.is_empty(), "a pesquisa literal tem de encontrar `needle`: {hits:?}");

    let files = list_files(root, None);
    assert!(
        files.iter().any(|f| f.ends_with("main.rs")),
        "o quick-open tem de listar main.rs: {files:?}"
    );
}

/// `detect_projects` sobre um workspace multi-projecto real: a raiz (Rust) e uma
/// sub-pasta (Go) são detectadas; `target/` (ruído de build) é saltado. Prova a regra
/// de detecção «raiz + um nível, ignorando build/ocultos» ligada ao disco.
#[test]
fn detect_projects_pins_root_and_one_level() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("Cargo.toml"), "[package]\nname=\"root\"\n").unwrap();
    fs::create_dir_all(root.join("api")).unwrap();
    fs::write(root.join("api/go.mod"), "module api\n").unwrap();
    fs::create_dir_all(root.join("target/inner")).unwrap();
    fs::write(root.join("target/inner/Cargo.toml"), "[package]\nname=\"x\"\n").unwrap();

    let found = detect_projects(root);
    assert!(found.iter().any(|p| p.kind == "rust"), "raiz Rust: {found:?}");
    assert!(found.iter().any(|p| p.kind == "go"), "api/ Go: {found:?}");
    assert!(
        !found.iter().any(|p| p.path.contains("target")),
        "target/ não é um projecto a listar: {found:?}"
    );
}

/// `read_folder_sources` sobre uma pasta real: recolhe a fonte, respeita o limite de
/// ficheiros (truncagem honesta) e salta directórios de build. Prova a coordenação de
/// recolha ligada ao disco com o contrato de caps preservado.
#[test]
fn read_folder_sources_bounds_and_filters() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("a.rs"), "fn a() {}\n").unwrap();
    fs::write(root.join("b.py"), "def b(): pass\n").unwrap();
    fs::create_dir_all(root.join("dist")).unwrap();
    fs::write(root.join("dist/bundle.js"), "console.log(1)\n").unwrap();

    // Default de página: ambas as fontes entram, o directório de build não.
    let all = read_folder_sources(root, None, None);
    assert_eq!(all.len(), 2, "duas fontes reais, sem o dist/: {all:?}");
    assert!(
        !all.iter().any(|s| s.path.contains("dist")),
        "dist/ é ruído de build e é saltado: {all:?}"
    );

    // Limite explícito de 1 ficheiro: truncagem honesta pára ao primeiro.
    let capped = read_folder_sources(root, Some(1), None);
    assert_eq!(capped.len(), 1, "o cap de ficheiros é respeitado: {capped:?}");
}
