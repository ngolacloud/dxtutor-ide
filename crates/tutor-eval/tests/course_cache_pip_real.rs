//! A prepared PYTHON course end to end (Learn P2a), with the real `python3 -m venv` and pip and
//! no network: the course pins a wheel served from a local package index (`file://`) instead of
//! PyPI — the only change to the planned commands is that index URL.
//!
//! - before preparing, grading refuses with `COURSE_NOT_PREPARED`;
//! - `prepare` creates the course venv, installs the pinned wheel with `--require-hashes`, runs
//!   `pip check` and writes the marker;
//! - a single-file challenge, a drill and a project step then run in the course venv (the
//!   package is importable there and nowhere else);
//! - a wrong hash makes pip refuse, and the course stays unprepared.
//!
//! One test function: it sets `DXTUTOR_COURSE_CACHE` for this process. Skipped (with a note)
//! when the host has no `python3` with the `venv` module.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use sha2::{Digest, Sha256};
use tutor_core::{BuildEnv, CacheKind, CourseCache, Gabarito, Level, Phase, ProjectFiles};
use tutor_eval::course_cache::{self, Status, NOT_PREPARED, PIP_INDEX_URL};

/// Writes `mini-0.1.0-py3-none-any.whl` (a package `mini` with `add`) into `dir` with python's
/// zipfile, and returns its sha256.
fn build_wheel(python: &Path, dir: &Path) -> String {
    std::fs::create_dir_all(dir).unwrap();
    let script = r#"
import sys, zipfile
files = {
    "mini/__init__.py": "def add(a, b):\n    return a + b\n",
    "mini-0.1.0.dist-info/METADATA": "Metadata-Version: 2.1\nName: mini\nVersion: 0.1.0\n",
    "mini-0.1.0.dist-info/WHEEL": "Wheel-Version: 1.0\nGenerator: dxtutor-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
}
files["mini-0.1.0.dist-info/RECORD"] = "".join(f"{p},,\n" for p in files) + "mini-0.1.0.dist-info/RECORD,,\n"
with zipfile.ZipFile(sys.argv[1], "w") as z:
    for path, text in files.items():
        z.writestr(path, text)
"#;
    let wheel = dir.join("mini-0.1.0-py3-none-any.whl");
    let out = Command::new(python)
        .args(["-I", "-c", script])
        .arg(&wheel)
        .output()
        .expect("python3");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let bytes = std::fs::read(&wheel).unwrap();
    Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A PEP 503 "simple" index for `mini` under `root/simple`, linking the wheel in `root/files`.
fn simple_index(root: &Path, sha: &str) {
    let page = root.join("simple/mini");
    std::fs::create_dir_all(&page).unwrap();
    std::fs::write(
        page.join("index.html"),
        format!(
            "<!doctype html><html><body><a href=\"../../files/mini-0.1.0-py3-none-any.whl#sha256={sha}\">mini-0.1.0-py3-none-any.whl</a></body></html>\n"
        ),
    )
    .unwrap();
}

fn venv_available(python: &Path) -> bool {
    let tmp = tempfile::tempdir().unwrap();
    Command::new(python)
        .args(["-m", "venv"])
        .arg(tmp.path().join("v"))
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn phase(build: &BuildEnv) -> Phase {
    Phase {
        id: "pyfx-sum".into(),
        title: "Sum".into(),
        level: Level::Basico,
        language: "python".into(),
        instructions: String::new(),
        entry: "total".into(),
        starter: "import mini\n\n\ndef total(a, b):\n    raise NotImplementedError\n".into(),
        tests: "class T(unittest.TestCase):\n    def test_total(self):\n        self.assertEqual(total(2, 3), 5)\n".into(),
        gabarito: Gabarito {
            solution: "import mini\n\n\ndef total(a, b):\n    return mini.add(a, b)\n".into(),
            time: String::new(),
            space: String::new(),
            justification: String::new(),
        },
        probe: None,
        hints: Vec::new(),
        dependencies: Vec::new(),
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
fn a_prepared_python_course_grades_in_its_course_venv() {
    let Some(python) = course_cache::host_python() else {
        eprintln!("skipped: no python3");
        return;
    };
    if !venv_available(&python) {
        eprintln!("skipped: python3 has no venv module (python3-venv)");
        return;
    }
    let tmp = tempfile::tempdir().unwrap();
    let sha = build_wheel(&python, &tmp.path().join("index/files"));
    simple_index(&tmp.path().join("index"), &sha);
    let index = format!("file://{}/index/simple", tmp.path().display());
    let root = tmp.path().join("cache");
    std::env::set_var("DXTUTOR_COURSE_CACHE", &root);

    let cache = CourseCache {
        key: "py-fixture".into(),
        language: "python".into(),
        dependencies: vec![format!("mini==0.1.0 --hash=sha256:{sha}")],
    };
    assert_eq!(cache.kind(), Some(CacheKind::Pip));
    let build = BuildEnv {
        cache: Some(cache.clone()),
        timeout_secs: 60,
    };
    let ph = phase(&build);

    // 1. not prepared: a clear refusal, nothing ran
    let err = tutor_eval::assess(&ph, &ph.gabarito.solution)
        .unwrap_err()
        .to_string();
    assert!(err.starts_with(NOT_PREPARED), "{err}");

    // 2. prepare: the planned commands (with the local index instead of PyPI)
    let mut plan = course_cache::plan_with(&root, &cache, &python).unwrap();
    for step in &mut plan.steps {
        for a in &mut step.args {
            if a == PIP_INDEX_URL {
                *a = index.clone();
            }
        }
    }
    let done = course_cache::prepare(&plan).unwrap();
    assert!(done.ok, "{}", done.output);
    let marker = done.marker.expect("marker");
    assert!(marker.tool.starts_with("Python 3"), "{marker:?}");
    assert!(course_cache::status(&root, &cache).unwrap().is_ready());
    assert!(plan.layout.venv_python().is_file());

    // 3. a single-file challenge: the answer passes (mini only exists in the venv), the starter fails
    let good = tutor_eval::assess(&ph, &ph.gabarito.solution).unwrap();
    assert!(good.correctness.passed, "{}", good.correctness.raw);
    let bad = tutor_eval::assess(&ph, &ph.starter).unwrap();
    assert!(!bad.correctness.passed);
    // the same challenge without the course cache: the system Python has no `mini`
    let plain = tutor_eval::assess(&phase(&BuildEnv::default()), &ph.gabarito.solution).unwrap();
    assert!(!plain.correctness.passed, "{}", plain.correctness.raw);

    // 4. a drill runs in the venv, with pip unable to reach an index
    let out = tutor_eval::run_course_program(
        "python",
        "import os, mini\nprint(mini.add(40, 2), os.environ.get('PIP_NO_INDEX'))\n",
        &[],
        &Default::default(),
        &build,
    )
    .unwrap();
    assert!(out.ok, "{}{}", out.stdout, out.stderr);
    assert_eq!(out.stdout.trim(), "42 1");

    // 5. a project step (unittest discovery over the tree) in the venv
    let mut pj = ph.clone();
    pj.project = Some(ProjectFiles {
        main: "app/calc.py".into(),
        starter: files(&[
            ("app/__init__.py", ""),
            ("app/calc.py", "def total(a, b):\n    raise NotImplementedError\n"),
        ]),
        tests: files(&[(
            "test_calc.py",
            "import unittest\nfrom app.calc import total\n\n\nclass T(unittest.TestCase):\n    def test_total(self):\n        self.assertEqual(total(1, 2), 3)\n",
        )]),
        solution: files(&[(
            "app/calc.py",
            "import mini\n\n\ndef total(a, b):\n    return mini.add(a, b)\n",
        )]),
        readonly: vec!["app/__init__.py".into()],
        explanation: String::new(),
    });
    let solution = pj.project.as_ref().unwrap().solution.clone();
    let good = tutor_eval::assess_project(&pj, &solution).unwrap();
    assert!(good.correctness.passed, "{}", good.correctness.raw);
    let bad = tutor_eval::assess_project(&pj, &BTreeMap::new()).unwrap();
    assert!(!bad.correctness.passed);

    // 6. a wrong hash: pip refuses, nothing is marked prepared
    let wrong = CourseCache {
        key: "py-fixture-bad".into(),
        language: "python".into(),
        dependencies: vec![format!("mini==0.1.0 --hash=sha256:{}", "0".repeat(64))],
    };
    let mut plan = course_cache::plan_with(&root, &wrong, &python).unwrap();
    for step in &mut plan.steps {
        for a in &mut step.args {
            if a == PIP_INDEX_URL {
                *a = index.clone();
            }
        }
    }
    let failed = course_cache::prepare(&plan).unwrap();
    assert!(!failed.ok);
    assert!(
        failed.output.contains("HASHES") || failed.output.contains("hash"),
        "{}",
        failed.output
    );
    assert_eq!(
        course_cache::status(&root, &wrong).unwrap(),
        Status::Missing
    );
}
