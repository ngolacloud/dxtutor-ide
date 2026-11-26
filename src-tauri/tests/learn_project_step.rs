//! Teste integrado do Learning Track com um plugin de FRAMEWORK e um passo de PROJECTO.
//!
//! Corre de fora do crate, contra a fachada Tauri-free `study::*` que os comandos
//! `list_courses`/`get_course`/`submit_step` atravessam, com o registo de plugins REAL: o
//! plugin-fixture (`crates/tutor-plugins/tests/fixtures/framework-project`, nunca publicado) é
//! instalado numa pasta temporária (`DXTUTOR_PLUGINS_DIR`, posta antes de qualquer chamada —
//! cada ficheiro de `tests/` é um processo próprio) e avaliado pelo descritor Python real.

use std::collections::BTreeMap;
use std::path::Path;

use dxtutor_ide_lib::study;
use tutor_core::CourseCategory;

#[test]
fn a_framework_plugin_with_a_project_step_is_listed_loaded_and_graded() {
    let plugins = tempfile::tempdir().unwrap();
    std::env::set_var("DXTUTOR_PLUGINS_DIR", plugins.path());
    let fixture =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../crates/tutor-plugins/tests/fixtures/framework-project");
    let store = tutor_plugins::Store::open_default().unwrap();
    assert_eq!(store.root(), plugins.path());
    store
        .install(
            &tutor_plugins::Source::LocalDir(fixture),
            env!("CARGO_PKG_VERSION"),
            study::builtin_courses(),
        )
        .expect("install the fixture");

    // list_courses: aparece com a categoria e o subject; get_course(language) continua a dar o
    // curso de Python, e get_course(language, subject) o do framework.
    let all = study::courses();
    let fw = all.iter().find(|c| c.id == "minishop-fixture").expect("listed");
    assert_eq!((fw.category, fw.subject.as_str()), (CourseCategory::Framework, "minishop"));
    assert_eq!(study::course("python").unwrap().id, "python-basics");
    assert_eq!(
        study::course_for("python", Some("minishop")).unwrap().id,
        "minishop-fixture"
    );

    // submit_step com ficheiros: só de leitura recusado; sem python3 pára aqui.
    let files = |pairs: &[(&str, &str)]| -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    };
    let err = study::grade_step_files(
        "msf-p1-cart",
        Some("python"),
        &files(&[("shop/config.py", "VAT = 0\n")]),
    )
    .unwrap_err();
    assert!(err.to_string().contains("read-only"), "{err}");
    if !tutor_eval::find_plugin("python").is_some_and(|p| p.host_available()) {
        return;
    }
    let project = fw.step("msf-p1-cart").unwrap().project.clone().unwrap();
    let (good, phase) =
        study::grade_step_files("msf-p1-cart", Some("python"), &project.solution).unwrap();
    assert!(good.correctness.passed, "{}", good.correctness.raw);
    assert_eq!(phase.project.as_ref().unwrap().main, "shop/cart.py");
    let (starter, _) = study::grade_step_files("msf-p1-cart", Some("python"), &files(&[])).unwrap();
    assert!(!starter.correctness.passed);
    // A forma antiga, só `code`: o ficheiro principal sobre o starter.
    let (main_only, _) =
        study::grade_step_in("msf-p1-cart", Some("python"), &project.solution["shop/cart.py"]).unwrap();
    assert!(!main_only.correctness.passed);
}
