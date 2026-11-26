//! O plugin-fixture de framework (`tests/fixtures/framework-project`, nunca publicado como
//! curso): valida sem erros nem avisos, instala-se como os outros, e as regras novas da
//! categoria e dos passos de projecto apanham os erros de autoria.

use std::path::{Path, PathBuf};

use tutor_core::CourseCategory;
use tutor_plugins::{validate_dir, Source, Store, Taken};

const HOST: &str = "0.7.0";

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/framework-project")
}

/// Uma cópia do fixture com o curso transformado por `edit` e o manifesto por `edit_manifest`.
fn variant(edit: impl Fn(String) -> String, edit_manifest: impl Fn(String) -> String) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(dir.path().join("courses")).unwrap();
    let m = std::fs::read_to_string(fixture().join("dxtutor-plugin.json")).unwrap();
    std::fs::write(dir.path().join("dxtutor-plugin.json"), edit_manifest(m)).unwrap();
    let c = std::fs::read_to_string(fixture().join("courses/minishop.toml")).unwrap();
    std::fs::write(dir.path().join("courses/minishop.toml"), edit(c)).unwrap();
    dir
}

fn errors_of(dir: &Path) -> String {
    let builtin = tutor_core::builtin_courses();
    validate_dir(dir, HOST, &Taken::builtin(&builtin)).errors.join("\n")
}

#[test]
fn the_fixture_is_valid_without_warnings() {
    let builtin = tutor_core::builtin_courses();
    let r = validate_dir(&fixture(), HOST, &Taken::builtin(&builtin));
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    let m = r.manifest.unwrap();
    assert_eq!(m.category, CourseCategory::Framework);
    assert_eq!(m.subject.unwrap().id, "minishop");
    let c = &r.courses[0];
    assert_eq!((c.category, c.track(), c.language.as_str()), (CourseCategory::Framework, "minishop", "python"));
    let p = c.step("msf-p1-cart").unwrap().project.as_ref().unwrap();
    assert_eq!(p.main, "shop/cart.py");
    assert_eq!(p.editable(), vec!["shop/cart.py", "shop/prices.py"]);
}

#[test]
fn it_installs_like_any_plugin_and_reports_its_subject() {
    let store_dir = tempfile::tempdir().unwrap();
    let store = Store::at(store_dir.path());
    let builtin = tutor_core::builtin_courses();
    let out = store
        .install(&Source::LocalDir(fixture()), HOST, &builtin)
        .expect("install");
    assert_eq!(out.category, CourseCategory::Framework);
    assert_eq!(out.subject.as_ref().unwrap().name, "MiniShop");
    assert_eq!(out.course_ids, vec!["minishop-fixture"]);
    let courses = store.courses();
    assert_eq!(courses.len(), 1);
    assert_eq!(courses[0].1.track(), "minishop");
}

#[test]
fn category_and_subject_must_match_the_manifest() {
    let d = variant(|c| c.replace("category = \"framework\"", "category = \"tool\""), |m| m);
    assert!(errors_of(d.path()).contains("course category `tool` differs from the manifest's category `framework`"));
    let d = variant(|c| c.replace("subject = \"minishop\"", "subject = \"other\""), |m| m);
    assert!(errors_of(d.path()).contains("course subject `other` differs"));
    let d = variant(|c| c, |m| m.replace("\"category\": \"framework\",", ""));
    let e = errors_of(d.path());
    assert!(e.contains("subject is only for framework and tool plugins"), "{e}");
    // A course of a plain language plugin cannot carry a subject.
    let d = variant(
        |c| c.replace("category = \"framework\"\n", ""),
        |m| {
            let start = m.find("\"category\"").unwrap();
            let end = m.find("\"language\"").unwrap();
            format!("{}{}", &m[..start], &m[end..])
        },
    );
    assert!(errors_of(d.path()).contains("course subject `minishop` is only for framework and tool courses"));
}

#[test]
fn project_step_authoring_errors_are_caught() {
    let d = variant(|c| c.replace("main = \"shop/cart.py\"", "main = \"shop/config.py\""), |m| m);
    assert!(errors_of(d.path()).contains("step `msf-p1-cart`: project.main: `shop/config.py` is read-only"));
    let d = variant(|c| c.replace("\"shop/cart.py\" = '''\nfrom shop.prices import with_vat\n\n\ndef total(items):\n    return", "\"../cart.py\" = '''\nfrom shop.prices import with_vat\n\n\ndef total(items):\n    return"), |m| m);
    let e = errors_of(d.path());
    assert!(e.contains("`../cart.py` is not a safe relative path"), "{e}");
    let d = variant(|c| c.replace("run_command = \"python3 -m unittest\"", "starter = \"x\"\nrun_command = \"python3 -m unittest\""), |m| m);
    assert!(errors_of(d.path()).contains("a project step keeps its files in `project`; remove `starter`"));
    let d = variant(|c| c.replace("[unit.step.project]\n", "[unit.step.gabarito]\nsolution = \"\"\ntime = \"\"\nspace = \"\"\njustification = \"\"\n\n[unit.step.project]\n"), |m| m);
    assert!(errors_of(d.path()).contains("remove `gabarito`"));
    let d = variant(|c| c.replace("\"test_shop.py\" = '''", "\"shop/cart.py\" = '''"), |m| m);
    assert!(errors_of(d.path()).contains("is also a starter file"));
}
