//! The pre-commit hook end to end: a real repository, the hook `tutor_protect::hook` installs, and
//! `git commit` from a "terminal" — blocked with a secret, through without one, blocked (and saying
//! why) when `dxt` is not on the PATH.

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn dxt_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_dxt"))
        .parent()
        .unwrap()
        .to_path_buf()
}

/// `git` with no user or system config (no global `core.hooksPath`, no gitleaks of the machine's
/// PATH unless asked), and `path` as the PATH.
fn git(dir: &Path, path: &str, args: &[&str]) -> Output {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("PATH", path)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@example.com")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@example.com")
        .output()
        .unwrap()
}

fn text(o: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    )
}

#[test]
fn the_hook_blocks_a_terminal_commit_with_a_secret() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    // the system dirs where git and sh live, and the freshly built dxt — nothing else
    let with_dxt = format!("{}:/usr/bin:/bin", dxt_dir().display());
    let without = "/usr/bin:/bin";
    assert!(git(root, without, &["init", "-q"]).status.success());
    let hook = tutor_protect::hook::install(root).unwrap();
    assert_eq!(hook.state, "installed");

    // a secret: blocked, masked in the output
    std::fs::write(
        root.join("db.rs"),
        "const URL: &str = \"postgres://app:s3cr3tP4ss@db.internal:5432/app\";\n",
    )
    .unwrap();
    assert!(git(root, with_dxt.as_str(), &["add", "db.rs"])
        .status
        .success());
    let o = git(root, with_dxt.as_str(), &["commit", "-qm", "db"]);
    let out = text(&o);
    assert!(!o.status.success(), "the commit went through: {out}");
    assert!(out.contains("the commit is blocked"), "{out}");
    assert!(out.contains("db.rs:1"), "{out}");
    assert!(!out.contains("s3cr3tP4ss"), "the secret leaked: {out}");

    // without it: through
    std::fs::write(
        root.join("db.rs"),
        "const URL: &str = env!(\"DATABASE_URL\");\n",
    )
    .unwrap();
    assert!(git(root, with_dxt.as_str(), &["add", "db.rs"])
        .status
        .success());
    let o = git(root, with_dxt.as_str(), &["commit", "-qm", "db"]);
    assert!(o.status.success(), "{}", text(&o));

    // a forbidden file
    std::fs::write(root.join(".env"), "API_TOKEN=abc\n").unwrap();
    assert!(git(root, with_dxt.as_str(), &["add", "-f", ".env"])
        .status
        .success());
    let o = git(root, with_dxt.as_str(), &["commit", "-qm", "env"]);
    assert!(!o.status.success(), "{}", text(&o));
    assert!(text(&o).contains(".env"), "{}", text(&o));
    assert!(
        git(root, with_dxt.as_str(), &["rm", "-q", "--cached", ".env"])
            .status
            .success()
    );

    // no dxt on the PATH: blocked, and it says why
    std::fs::write(root.join("a.txt"), "hello\n").unwrap();
    assert!(git(root, without, &["add", "a.txt"]).status.success());
    let o = git(root, without, &["commit", "-qm", "a"]);
    assert!(!o.status.success());
    assert!(text(&o).contains("dxt is not on the PATH"), "{}", text(&o));
    assert!(text(&o).contains("cargo install --path crates/tutor-cli"));
}

#[test]
fn outside_a_repository_the_scan_cannot_run() {
    let d = tempfile::tempdir().unwrap();
    let o = Command::new(env!("CARGO_BIN_EXE_dxt"))
        .args(["secret-scan", "--staged"])
        .current_dir(d.path())
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(2), "{}", text(&o));
    assert!(text(&o).contains("not inside a git repository"));
}
