//! The official Django course end to end with the real `dxt`: validate it, prepare its pip cache
//! (a course venv with Django 5.2 LTS from PyPI, hash-checked) into a temporary
//! `DXTUTOR_COURSE_CACHE`, then `dxt plugin test`: every drill runs, every reference solution
//! passes and every starter fails, against the real Django.
//!
//! Validation always runs. Preparing needs the network (PyPI), so the grading half is
//! `#[ignore]`d in CI; run it with
//!
//! ```sh
//! cargo test -p tutor-cli --test django_course -- --ignored
//! ```

use std::path::{Path, PathBuf};
use std::process::Command;

fn course() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../courses/django")
}

fn dxt(args: &[&str], cache: &Path) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_dxt"))
        .args(args)
        .env("DXTUTOR_COURSE_CACHE", cache)
        .output()
        .expect("run dxt");
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (out.status.success(), text)
}

#[test]
fn the_django_course_validates_strictly_and_refuses_to_grade_unprepared() {
    let cache = tempfile::tempdir().unwrap();
    let dir = course();
    let (ok, out) = dxt(
        &["plugin", "validate", dir.to_str().unwrap(), "--strict"],
        cache.path(),
    );
    assert!(ok, "{out}");
    assert!(out.contains("9 units, 36 steps, 0 warning(s)"), "{out}");
    // Grading never downloads: an unprepared course says what to do, and nothing runs.
    let (ok, out) = dxt(&["plugin", "test", dir.to_str().unwrap()], cache.path());
    assert!(!ok);
    assert!(out.contains("has not been prepared"), "{out}");
    assert!(out.contains("dxt plugin prepare"), "{out}");
}

#[test]
#[ignore = "downloads Django from PyPI (network)"]
fn the_django_course_prepares_and_every_step_passes() {
    let cache = tempfile::tempdir().unwrap();
    let dir = course();
    let (ok, out) = dxt(&["plugin", "prepare", dir.to_str().unwrap()], cache.path());
    assert!(ok, "{out}");
    assert!(
        out.contains(
            "downloads: Django 5.2.19 (PyPI), asgiref 3.12.1 (PyPI), sqlparse 0.6.1 (PyPI)"
        ),
        "{out}"
    );
    let (ok, out) = dxt(&["plugin", "test", dir.to_str().unwrap()], cache.path());
    assert!(ok, "{out}");
    assert!(out.contains("36 ok, 0 failed"), "{out}");
}
