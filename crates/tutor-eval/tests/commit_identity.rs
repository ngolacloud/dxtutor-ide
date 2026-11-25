//! Bug 3 of docs/v2/RF-DELONIX-PLANO.md §2 (RF-T02, fixed in F4.8): the backend's commit is the
//! human's. Without a git identity it is refused with how to set one — never signed by a made-up
//! `dxtutor` user; with one, that is the author.
//!
//! Its own test binary: it hides the machine's global and system git config through the
//! environment, which would leak into other tests running in parallel in the same process.

use std::path::Path;
use std::process::Command;

fn git(d: &Path, args: &[&str]) -> String {
    let o = Command::new("git")
        .args(args)
        .current_dir(d)
        .output()
        .unwrap();
    assert!(
        o.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

#[test]
fn the_commit_is_refused_without_a_git_identity_and_is_the_humans_with_one() {
    let home = tempfile::tempdir().unwrap();
    let empty = home.path().join("gitconfig");
    std::fs::write(&empty, "").unwrap();
    // no global or system identity for this process (the only test in this binary)
    std::env::set_var("GIT_CONFIG_GLOBAL", &empty);
    std::env::set_var("GIT_CONFIG_NOSYSTEM", "1");
    std::env::set_var("HOME", home.path());
    std::env::remove_var("GIT_AUTHOR_NAME");
    std::env::remove_var("GIT_AUTHOR_EMAIL");
    std::env::remove_var("GIT_COMMITTER_NAME");
    std::env::remove_var("GIT_COMMITTER_EMAIL");
    std::env::remove_var("EMAIL");

    let d = tempfile::tempdir().unwrap();
    git(d.path(), &["init", "-q", "-b", "main"]);
    std::fs::write(d.path().join("a.txt"), "x\n").unwrap();
    git(d.path(), &["add", "a.txt"]);

    let err = tutor_eval::git::commit(d.path(), "feat: first").unwrap_err();
    assert!(
        err.contains("user.name") && err.contains("user.email"),
        "{err}"
    );
    assert!(
        git(d.path(), &["rev-list", "--all"]).is_empty(),
        "nothing was committed"
    );

    git(d.path(), &["config", "user.name", "Ana Silva"]);
    git(d.path(), &["config", "user.email", "ana@example.com"]);
    tutor_eval::git::commit(d.path(), "feat: first").unwrap();
    let author = git(d.path(), &["log", "-1", "--format=%an <%ae>|%cn"]);
    assert_eq!(author, "Ana Silva <ana@example.com>|Ana Silva");
    assert!(!author.contains("dxtutor"));
}
