//! Teste integrado do caso de uso «inteligência de código» (Etapa 3 — grupo code-intel).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`codeintel::*`),
//! sobre um projecto Rust real (tempdir) — a mesma fronteira que os comandos Tauri
//! (`symbol_relations`, `file_outline`) atravessam, sem o runtime Tauri. Prova que a
//! fatia liga: mapa de símbolos real / coordenação outline → relatório tipado, com o
//! comportamento preservado da versão em `lib.rs`. Não depende de rust-analyzer estar
//! instalado (o outline cai no mapa sintáctico quando o servidor não responde).

use dxtutor_ide_lib::codeintel::{outline, relations};
use std::fs;

/// Projecto Rust real com uma função `greet` definida e chamada por `main`: o mapa de
/// símbolos tem de encontrar a definição e a(s) referência(s). Prova que `relations`
/// corre o mecanismo sintáctico sobre ficheiros reais e devolve um relatório tipado.
#[test]
fn relations_maps_a_symbol_across_a_real_project() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(
        root.join("src/main.rs"),
        "fn greet(name: &str) {\n    println!(\"olá {name}\");\n}\n\nfn main() {\n    greet(\"mundo\");\n}\n",
    )
    .unwrap();

    let rel = relations(root, "greet").expect("o caso de uso corre sobre um projecto real");

    assert!(
        !rel.definitions.is_empty(),
        "a definição de `greet` tem de aparecer: {rel:?}"
    );
    assert!(
        !rel.references.is_empty(),
        "a chamada a `greet` em `main` tem de aparecer como referência: {rel:?}"
    );
}

/// `outline` com `root`+`file` reais: tenta o servidor de língua e, quando ausente,
/// cai no mapa sintáctico — de qualquer modo encontra `main`. Prova a regra de
/// coordenação («servidor primeiro, sintáctico como recurso») ligada ao motor real.
#[test]
fn outline_over_a_real_file_finds_the_entrypoint() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir_all(root.join("src")).unwrap();
    let file = root.join("src/main.rs");
    let code =
        "fn helper() -> i32 {\n    42\n}\n\nfn main() {\n    println!(\"{}\", helper());\n}\n";
    fs::write(&file, code).unwrap();

    let syms = outline(
        code,
        "rust",
        Some(root.to_str().unwrap()),
        Some(file.to_str().unwrap()),
    );

    assert!(
        syms.iter().any(|s| s.name == "main"),
        "o outline (LSP ou sintáctico) tem de listar `main`: {syms:?}"
    );
}
