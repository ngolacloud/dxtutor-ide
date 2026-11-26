//! A prepared course end to end, with the real cargo and no network: the course depends on a
//! crate in a local git repository (`file://`, like the Seiva course's `git = …, tag = …`).
//!
//! - before preparing, grading refuses with `COURSE_NOT_PREPARED` (and says what to do);
//! - `prepare` runs the planned commands into a course `CARGO_HOME`/`target` and writes the marker;
//! - then a single-file challenge, a drill, a one-crate project and a workspace project all grade
//!   offline against that cache (the right answer passes, the starter fails);
//! - a course whose dependencies changed is stale until prepared again.
//!
//! One test function: it sets `DXTUTOR_COURSE_CACHE` for this process.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use tutor_core::{BuildEnv, CourseCache, Gabarito, Level, Phase, ProjectFiles};
use tutor_eval::course_cache::{self, Status, NOT_PREPARED};

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.org")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.org")
        .output()
        .expect("git");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// A git repository with a `mini` crate tagged `v0.1.0`.
fn mini_repo(dir: &Path) {
    std::fs::create_dir_all(dir.join("src")).unwrap();
    std::fs::write(
        dir.join("Cargo.toml"),
        "[package]\nname = \"mini\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
    )
    .unwrap();
    std::fs::write(
        dir.join("src/lib.rs"),
        "pub fn add(a: i32, b: i32) -> i32 { a + b }\n",
    )
    .unwrap();
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "mini"]);
    git(dir, &["tag", "v0.1.0"]);
}

fn phase(build: &BuildEnv, deps: &[String]) -> Phase {
    Phase {
        id: "fx-sum".into(),
        title: "Sum".into(),
        level: Level::Basico,
        language: "rust".into(),
        instructions: String::new(),
        entry: "sum".into(),
        starter: "pub fn sum(a: i32, b: i32) -> i32 { todo!() }".into(),
        tests: "#[test] fn sums() { assert_eq!(student::sum(2, 3), 5); }".into(),
        gabarito: Gabarito {
            solution: "pub fn sum(a: i32, b: i32) -> i32 { mini::add(a, b) }".into(),
            time: String::new(),
            space: String::new(),
            justification: String::new(),
        },
        probe: None,
        hints: Vec::new(),
        dependencies: deps.to_vec(),
        project: None,
        support: Default::default(),
        build: build.clone(),
    }
}

fn files(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

#[test]
fn a_prepared_course_grades_offline_against_its_cache() {
    let tmp = tempfile::tempdir().unwrap();
    let repo = tmp.path().join("mini");
    mini_repo(&repo);
    let root = tmp.path().join("cache");
    std::env::set_var("DXTUTOR_COURSE_CACHE", &root);

    let dep = format!(
        "mini = {{ git = \"file://{}\", tag = \"v0.1.0\" }}",
        repo.display()
    );
    let deps = vec![dep];
    let cache = CourseCache {
        key: "fixture-course".into(),
        dependencies: deps.clone(),
    };
    let build = BuildEnv {
        cache: Some(cache.clone()),
        timeout_secs: 120,
    };
    let ph = phase(&build, &deps);

    // 1. not prepared: a clear refusal, nothing compiled
    assert_eq!(
        course_cache::status(&root, &cache).unwrap(),
        Status::Missing
    );
    let err = tutor_eval::assess(&ph, &ph.gabarito.solution)
        .unwrap_err()
        .to_string();
    assert!(
        err.starts_with(NOT_PREPARED) && err.contains("Prepare course"),
        "{err}"
    );

    // 2. prepare: the planned commands, the marker, the lock
    let plan = course_cache::plan(&root, &cache).unwrap();
    let done = course_cache::prepare(&plan).unwrap();
    assert!(done.ok, "{}", done.output);
    let marker = done.marker.expect("marker");
    assert!(marker.cargo.starts_with("cargo "), "{marker:?}");
    assert!(course_cache::status(&root, &cache).unwrap().is_ready());
    assert!(
        plan.layout.cargo_home.join("git").is_dir(),
        "the source sits in the course CARGO_HOME"
    );
    assert!(
        plan.layout.target.join("debug").is_dir(),
        "the target is warm"
    );

    // 3. a single-file challenge: the answer passes, the starter fails
    let good = tutor_eval::assess(&ph, &ph.gabarito.solution).unwrap();
    assert!(good.correctness.passed, "{}", good.correctness.raw);
    let bad = tutor_eval::assess(&ph, &ph.starter).unwrap();
    assert!(!bad.correctness.passed);

    // 4. a drill runs against the cache
    let out = tutor_eval::run_course_program(
        "rust",
        "fn main() { println!(\"{}\", mini::add(40, 2)); }",
        &deps,
        &Default::default(),
        &build,
    )
    .unwrap();
    assert!(out.ok, "{}", out.stderr);
    assert_eq!(out.stdout.trim(), "42");

    // 5. a one-crate project: src/lib.rs + a module, hidden tests in tests/
    let mut one = phase(&build, &deps);
    one.project = Some(ProjectFiles {
        main: "src/calc.rs".into(),
        starter: files(&[
            ("src/lib.rs", "pub mod calc;\n"),
            ("src/calc.rs", "pub fn double(x: i32) -> i32 { todo!() }\n"),
        ]),
        readonly: vec!["src/lib.rs".into()],
        tests: files(&[(
            "tests/hidden.rs",
            "#[test] fn doubles() { assert_eq!(student::calc::double(21), 42); }\n",
        )]),
        solution: files(&[(
            "src/calc.rs",
            "pub fn double(x: i32) -> i32 { mini::add(x, x) }\n",
        )]),
        explanation: String::new(),
    });
    let p = one.project.clone().unwrap();
    let good = tutor_eval::assess_project(&one, &p.solution).unwrap();
    assert!(good.correctness.passed, "{}", good.correctness.raw);
    assert!(
        !tutor_eval::assess_project(&one, &BTreeMap::new())
            .unwrap()
            .correctness
            .passed
    );

    // 6. a workspace project: the course dependency becomes [workspace.dependencies]
    let mut ws = phase(&build, &deps);
    ws.project = Some(ProjectFiles {
        main: "app/src/lib.rs".into(),
        starter: files(&[
            (
                "Cargo.toml",
                "[workspace]\nresolver = \"2\"\nmembers = [\"app\"]\n# the course writes [workspace.dependencies] below\n",
            ),
            (
                "app/Cargo.toml",
                "[package]\nname = \"app\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[dependencies]\nmini = { workspace = true }\n",
            ),
            ("app/src/lib.rs", "pub fn triple(x: i32) -> i32 { todo!() }\n"),
        ]),
        readonly: vec!["Cargo.toml".into(), "app/Cargo.toml".into()],
        tests: files(&[(
            "app/tests/hidden.rs",
            "#[test] fn triples() { assert_eq!(app::triple(3), 9); }\n",
        )]),
        solution: files(&[(
            "app/src/lib.rs",
            "pub fn triple(x: i32) -> i32 { mini::add(mini::add(x, x), x) }\n",
        )]),
        explanation: String::new(),
    });
    let p = ws.project.clone().unwrap();
    let good = tutor_eval::assess_project(&ws, &p.solution).unwrap();
    assert!(good.correctness.passed, "{}", good.correctness.raw);
    assert!(
        !tutor_eval::assess_project(&ws, &BTreeMap::new())
            .unwrap()
            .correctness
            .passed
    );
    // a root Cargo.toml that is not a workspace is refused with a clear message
    let mut not_ws = ws.clone();
    let pj = not_ws.project.as_mut().unwrap();
    pj.starter
        .insert("Cargo.toml".into(), "[package]\nname = \"x\"\n".into());
    let e = tutor_eval::assess_project(&not_ws, &BTreeMap::new()).unwrap_err();
    assert!(e.to_string().contains("must be a workspace"), "{e}");
    // …and so is one that declares its own [workspace.dependencies] (they come from the course)
    let mut own_deps = ws.clone();
    let pj = own_deps.project.as_mut().unwrap();
    pj.starter.insert(
        "Cargo.toml".into(),
        "[workspace]\nmembers = [\"app\"]\n\n[workspace.dependencies]\nmini = \"1\"\n".into(),
    );
    let e = tutor_eval::assess_project(&own_deps, &BTreeMap::new()).unwrap_err();
    assert!(e.to_string().contains("must not declare"), "{e}");

    // 7. the course changed its dependencies: stale until prepared again
    let changed = CourseCache {
        key: cache.key.clone(),
        dependencies: vec![format!("{} # v2", deps[0])],
    };
    assert!(matches!(
        course_cache::status(&root, &changed).unwrap(),
        Status::Stale(_)
    ));
    let stale = phase(
        &BuildEnv {
            cache: Some(changed),
            timeout_secs: 120,
        },
        &deps,
    );
    let e = tutor_eval::assess(&stale, &stale.gabarito.solution)
        .unwrap_err()
        .to_string();
    assert!(e.contains("changed its dependencies"), "{e}");
}
