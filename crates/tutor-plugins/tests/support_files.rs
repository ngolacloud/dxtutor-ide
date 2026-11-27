//! Ficheiros de apoio (`[support]`) nos plugins: a validação lê-os como a instalação, apanha um
//! ficheiro em falta e um caminho que choca com um passo de projecto, e o plugin instalado chega
//! ao registo com eles carregados. O curso oficial Dxjs passa por tudo isto.

use std::path::{Path, PathBuf};

use tutor_plugins::{validate_dir, Source, Store, Taken};

const HOST: &str = "0.7.0";

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/framework-project")
}

fn dxjs() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../courses/dxjs")
}

/// Uma cópia do fixture com uma tabela `[support]` e, se `file` for dado, o ficheiro de apoio.
fn with_support(table: &str, file: Option<(&str, &str)>) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("courses")).unwrap();
    std::fs::copy(
        fixture().join("dxtutor-plugin.json"),
        dir.path().join("dxtutor-plugin.json"),
    )
    .unwrap();
    let c = std::fs::read_to_string(fixture().join("courses/minishop.toml")).unwrap();
    let c = c.replacen("[[unit]]", &format!("[support]\n{table}\n\n[[unit]]"), 1);
    std::fs::write(dir.path().join("courses/minishop.toml"), c).unwrap();
    if let Some((rel, content)) = file {
        let p = dir.path().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, content).unwrap();
    }
    dir
}

fn errors_of(dir: &Path) -> String {
    let builtin = tutor_core::builtin_courses();
    validate_dir(dir, HOST, &Taken::builtin(&builtin))
        .errors
        .join("\n")
}

#[test]
fn a_missing_support_file_is_a_validation_error() {
    let d = with_support("\"lib/helpers.py\" = \"support/helpers.py\"", None);
    let e = errors_of(d.path());
    assert!(
        e.contains("courses/minishop.toml: support: `support/helpers.py`: file not found"),
        "{e}"
    );
}

#[test]
fn a_support_path_that_clashes_with_a_project_file_is_an_error() {
    let d = with_support(
        "\"shop/cart.py\" = \"support/cart.py\"",
        Some(("support/cart.py", "x = 1\n")),
    );
    let e = errors_of(d.path());
    assert!(
        e.contains("step `msf-p1-cart`: `shop/cart.py` is also a support file of the course"),
        "{e}"
    );
}

#[test]
fn valid_support_files_are_loaded_by_validation_and_by_the_installed_store() {
    let d = with_support(
        "\"lib/helpers.py\" = \"support/helpers.py\"",
        Some(("support/helpers.py", "def helper():\n    return 1\n")),
    );
    let builtin = tutor_core::builtin_courses();
    let r = validate_dir(d.path(), HOST, &Taken::builtin(&builtin));
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert_eq!(
        r.courses[0]
            .support_files
            .get("lib/helpers.py")
            .map(String::as_str),
        Some("def helper():\n    return 1\n")
    );
    let store_dir = tempfile::tempdir().unwrap();
    let store = Store::at(store_dir.path());
    store
        .install(&Source::LocalDir(d.path().to_path_buf()), HOST, &builtin)
        .expect("install");
    let courses = store.courses();
    assert_eq!(courses.len(), 1);
    assert_eq!(courses[0].1.support_files.len(), 1);
}

#[test]
fn the_official_dxjs_plugin_validates_strictly_and_installs_with_its_support_files() {
    let builtin = tutor_core::builtin_courses();
    let r = validate_dir(&dxjs(), HOST, &Taken::builtin(&builtin));
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    let c = &r.courses[0];
    assert_eq!((c.id.as_str(), c.subject.as_str()), ("dxjs-basics", "dxjs"));
    let embedded = tutor_core::load_course("dxjs-basics").unwrap();
    assert_eq!(
        c.support_files, embedded.support_files,
        "the plugin on disk and the built-in course carry the same support files"
    );
    let store_dir = tempfile::tempdir().unwrap();
    let store = Store::at(store_dir.path());
    store
        .install(&Source::LocalDir(dxjs()), HOST, &builtin)
        .expect("install");
    let installed = store.courses();
    assert_eq!(installed[0].1.support_files.len(), 15);
}
