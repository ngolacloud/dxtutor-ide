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
fn variant(
    edit: impl Fn(String) -> String,
    edit_manifest: impl Fn(String) -> String,
) -> tempfile::TempDir {
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
    validate_dir(dir, HOST, &Taken::builtin(&builtin))
        .errors
        .join("\n")
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
    assert_eq!(
        (c.category, c.track(), c.language.as_str()),
        (CourseCategory::Framework, "minishop", "python")
    );
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
    let d = variant(
        |c| c.replace("category = \"framework\"", "category = \"tool\""),
        |m| m,
    );
    assert!(errors_of(d.path())
        .contains("course category `tool` differs from the manifest's category `framework`"));
    let d = variant(
        |c| c.replace("subject = \"minishop\"", "subject = \"other\""),
        |m| m,
    );
    assert!(errors_of(d.path()).contains("course subject `other` differs"));
    let d = variant(|c| c, |m| m.replace("\"category\": \"framework\",", ""));
    let e = errors_of(d.path());
    assert!(
        e.contains("subject is only for framework and tool plugins"),
        "{e}"
    );
    // A course of a plain language plugin cannot carry a subject.
    let d = variant(
        |c| c.replace("category = \"framework\"\n", ""),
        |m| {
            let start = m.find("\"category\"").unwrap();
            let end = m.find("\"language\"").unwrap();
            format!("{}{}", &m[..start], &m[end..])
        },
    );
    assert!(errors_of(d.path())
        .contains("course subject `minishop` is only for framework and tool courses"));
}

#[test]
fn project_step_authoring_errors_are_caught() {
    let d = variant(
        |c| c.replace("main = \"shop/cart.py\"", "main = \"shop/config.py\""),
        |m| m,
    );
    assert!(errors_of(d.path())
        .contains("step `msf-p1-cart`: project.main: `shop/config.py` is read-only"));
    let d = variant(
        |c| {
            c.replace("\"shop/cart.py\" = '''\nfrom shop.prices import with_vat\n\n\ndef total(items):\n    return", "\"../cart.py\" = '''\nfrom shop.prices import with_vat\n\n\ndef total(items):\n    return")
        },
        |m| m,
    );
    let e = errors_of(d.path());
    assert!(
        e.contains("`../cart.py` is not a safe relative path"),
        "{e}"
    );
    let d = variant(
        |c| {
            c.replace(
                "run_command = \"python3 -m unittest\"",
                "starter = \"x\"\nrun_command = \"python3 -m unittest\"",
            )
        },
        |m| m,
    );
    assert!(errors_of(d.path())
        .contains("a project step keeps its files in `project`; remove `starter`"));
    let d = variant(
        |c| {
            c.replace("[unit.step.project]\n", "[unit.step.gabarito]\nsolution = \"\"\ntime = \"\"\nspace = \"\"\njustification = \"\"\n\n[unit.step.project]\n")
        },
        |m| m,
    );
    assert!(errors_of(d.path()).contains("remove `gabarito`"));
    let d = variant(
        |c| c.replace("\"test_shop.py\" = '''", "\"shop/cart.py\" = '''"),
        |m| m,
    );
    assert!(errors_of(d.path()).contains("is also a starter file"));
}

#[test]
fn the_build_table_is_checked() {
    let with_build = |table: &'static str| {
        move |c: String| c.replacen("\n[[unit]]", &format!("\n{table}\n[[unit]]"), 1)
    };
    // a prepared cache needs dependencies, a sane timeout, and a course graded in rust or python
    let d = variant(
        with_build("[build]\nprepare = true\ntimeout_secs = 5\n"),
        |m| m,
    );
    let errs = errors_of(d.path());
    assert!(errs.contains("nothing to prepare"), "{errs}");
    assert!(
        errs.contains("build.timeout_secs must be between"),
        "{errs}"
    );
    let d = variant(
        |c| {
            with_build("[build]\nprepare = true\ndependencies = ['x = \"1\"']\n")(c)
                .replace("language = \"python\"", "language = \"typescript\"")
        },
        |m| m.replace("\"id\": \"python\"", "\"id\": \"typescript\""),
    );
    let errs = errors_of(d.path());
    assert!(
        errs.contains("only available for courses graded in rust (cargo) or python (pip)"),
        "{errs}"
    );
    // a python course pins every package with its hash (pip --require-hashes), never a range
    // or an index, and installs them only into a prepared cache
    let hash = "5965d974a5218a2b68a11dd1276434707f23886525c23f0598eccedaf4f4ca00";
    let d = variant(
        with_build("[build]\nprepare = true\ndependencies = ['Django>=5']\n"),
        |m| m,
    );
    let errs = errors_of(d.path());
    assert!(errs.contains("pin an exact version"), "{errs}");
    let pinned = format!(
        "[build]\nprepare = true\ndependencies = ['Django==5.2.19 --index-url https://evil.example --hash=sha256:{hash}']\n"
    );
    let d = variant(
        |c| c.replacen("\n[[unit]]", &format!("\n{pinned}\n[[unit]]"), 1),
        |m| m,
    );
    let errs = errors_of(d.path());
    assert!(errs.contains("only `--hash=sha256:<64 hex>`"), "{errs}");
    let unprepared = format!("[build]\ndependencies = ['Django==5.2.19 --hash=sha256:{hash}']\n");
    let d = variant(
        |c| c.replacen("\n[[unit]]", &format!("\n{unprepared}\n[[unit]]"), 1),
        |m| m,
    );
    let errs = errors_of(d.path());
    assert!(errs.contains("set build.prepare = true"), "{errs}");
    let ok = format!(
        "[build]\nprepare = true\ntimeout_secs = 120\ndependencies = ['Django==5.2.19 --hash=sha256:{hash}']\n"
    );
    let d = variant(
        |c| c.replacen("\n[[unit]]", &format!("\n{ok}\n[[unit]]"), 1),
        |m| m,
    );
    assert_eq!(errors_of(d.path()), "");
    // an undefined `${name}` makes the course unreadable, with the reason
    let d = variant(
        with_build("[build]\ndependencies = ['x = { ${nope} }']\n"),
        |m| m,
    );
    let errs = errors_of(d.path());
    assert!(
        errs.contains("`${nope}`") && errs.contains("[build.vars]"),
        "{errs}"
    );
    // shared dependencies without a cache are fine where nothing installs them (a course
    // graded in a language without a package step, here typescript)
    let d = variant(
        |c| {
            with_build(
                "[build]\ndependencies = ['x = { ${v} }']\n[build.vars]\nv = 'version = \"1\"'\n",
            )(c)
            .replace("language = \"python\"", "language = \"typescript\"")
        },
        |m| m.replace("\"id\": \"python\"", "\"id\": \"typescript\""),
    );
    assert_eq!(errors_of(d.path()), "");
}
