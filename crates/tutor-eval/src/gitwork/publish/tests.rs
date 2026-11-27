//! A real repository and a local bare repository as its remote: the issue branch is pushed at
//! exactly the reviewed commit; the default branch, the remote's default, a branch dxtutor did not
//! create and a push that would need force are refused, and nothing reaches the remote.

use super::*;
use std::process::Command;

fn g(d: &Path, a: &[&str]) -> String {
    let o = Command::new("git")
        .arg("-C")
        .arg(d)
        .args(a)
        .output()
        .unwrap();
    assert!(
        o.status.success(),
        "git {a:?}: {}",
        String::from_utf8_lossy(&o.stderr)
    );
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

const BRANCH: &str = "feature/dx-1-pay";

struct World {
    _d: tempfile::TempDir,
    repo: std::path::PathBuf,
    remote: std::path::PathBuf,
    head: String,
}

/// `main` (pushed to the bare `origin`, its default) and the issue branch with one more commit
/// (not pushed).
fn world() -> World {
    let d = tempfile::tempdir().unwrap();
    let repo = d.path().join("repo");
    let remote = d.path().join("remote.git");
    std::fs::create_dir_all(&repo).unwrap();
    g(
        d.path(),
        &["init", "-q", "--bare", "-b", "main", "remote.git"],
    );
    g(&repo, &["init", "-q", "-b", "main"]);
    g(&repo, &["config", "user.name", "Ana"]);
    g(&repo, &["config", "user.email", "ana@example.com"]);
    g(&repo, &["config", "commit.gpgsign", "false"]);
    std::fs::write(repo.join("a.rs"), "fn a() {}\n").unwrap();
    g(&repo, &["add", "."]);
    g(&repo, &["commit", "-q", "-m", "init"]);
    g(
        &repo,
        &["remote", "add", "origin", &remote.display().to_string()],
    );
    g(&repo, &["push", "-q", "origin", "main"]);
    g(&repo, &["branch", BRANCH]);
    g(&repo, &["checkout", "-q", BRANCH]);
    std::fs::write(repo.join("pay.rs"), "fn pay() {}\n").unwrap();
    g(&repo, &["add", "."]);
    g(&repo, &["commit", "-q", "-m", "DX-1: pay"]);
    let head = g(&repo, &["rev-parse", "HEAD"]);
    g(&repo, &["checkout", "-q", "main"]);
    World {
        _d: d,
        repo,
        remote,
        head,
    }
}

fn on_remote(w: &World, branch: &str) -> Option<String> {
    let out = g(
        &w.remote,
        &[
            "for-each-ref",
            "--format=%(objectname)",
            &format!("refs/heads/{branch}"),
        ],
    );
    (!out.is_empty()).then_some(out)
}

#[test]
fn the_issue_branch_is_pushed_at_exactly_the_reviewed_commit() {
    let w = world();
    let p = plan(&w.repo, "main", BRANCH, &w.head, &|_, _| false).unwrap();
    assert_eq!((p.remote.as_str(), p.exists), ("origin", false));
    assert_eq!(p.url, w.remote.display().to_string());
    assert_eq!(
        p.command,
        format!(
            "git -C {} push --porcelain -- origin {}:refs/heads/{BRANCH}",
            w.repo.display(),
            w.head
        )
    );
    // only the approved command runs
    assert!(push(&w.repo, &p, "git push --force origin main").is_err());
    assert_eq!(on_remote(&w, BRANCH), None);
    push(&w.repo, &p, &p.command).unwrap();
    assert_eq!(on_remote(&w, BRANCH).as_deref(), Some(w.head.as_str()));
    // the remote's main did not move
    assert_eq!(
        on_remote(&w, "main"),
        Some(g(&w.repo, &["rev-parse", "main"]))
    );
}

#[test]
fn never_the_default_branch_nor_the_remotes_default_nor_main() {
    let w = world();
    let main = g(&w.repo, &["rev-parse", "main"]);
    let e = plan(&w.repo, "main", "main", &main, &|_, _| true).unwrap_err();
    assert!(e.contains("default branch"), "{e}");
    // the project folder on another branch: main is still never pushed
    let e = plan(&w.repo, "develop", "main", &main, &|_, _| true).unwrap_err();
    assert!(
        e.contains("never pushes main") || e.contains("default branch"),
        "{e}"
    );
    // the remote's default (its HEAD), whatever its name — even a branch dxtutor created
    g(
        &w.repo,
        &["push", "-q", "origin", &format!("main:refs/heads/{BRANCH}")],
    );
    g(
        &w.remote,
        &["symbolic-ref", "HEAD", &format!("refs/heads/{BRANCH}")],
    );
    let e = plan(&w.repo, "main", BRANCH, &w.head, &|_, _| true).unwrap_err();
    assert!(
        e.contains(&format!("{BRANCH} is the default branch of origin")),
        "{e}"
    );
    // option-looking or force-looking names
    for bad in ["-f", "+feature/x", "a:b", "feature/x y"] {
        assert!(
            plan(&w.repo, "main", bad, &w.head, &|_, _| true).is_err(),
            "{bad}"
        );
    }
    // a short or made-up hash
    assert!(plan(&w.repo, "main", BRANCH, &w.head[..8], &|_, _| true).is_err());
    // nothing was pushed: the remote's branch is still main's commit
    assert_eq!(on_remote(&w, BRANCH), Some(main));
}

#[test]
fn never_a_remote_branch_dxtutor_did_not_create_and_never_forced() {
    let w = world();
    // someone else pushed the branch first
    g(
        &w.repo,
        &["push", "-q", "origin", &format!("main:refs/heads/{BRANCH}")],
    );
    let e = plan(&w.repo, "main", BRANCH, &w.head, &|_, _| false).unwrap_err();
    assert!(e.contains("did not create it"), "{e}");
    // created by dxtutor: a fast-forward is fine
    let p = plan(&w.repo, "main", BRANCH, &w.head, &|url, b| {
        url == w.remote.display().to_string() && b == BRANCH
    })
    .unwrap();
    assert!(p.exists);
    push(&w.repo, &p, &p.command).unwrap();
    assert_eq!(on_remote(&w, BRANCH).as_deref(), Some(w.head.as_str()));
    // a rewritten branch would need force: refused before git is asked, the remote untouched
    g(&w.repo, &["checkout", "-q", BRANCH]);
    g(
        &w.repo,
        &["commit", "-q", "--amend", "-m", "DX-1: pay (amended)"],
    );
    let rewritten = g(&w.repo, &["rev-parse", "HEAD"]);
    g(&w.repo, &["checkout", "-q", "main"]);
    let e = plan(&w.repo, "main", BRANCH, &rewritten, &|_, _| true).unwrap_err();
    assert!(e.contains("never force-pushes"), "{e}");
    assert_eq!(on_remote(&w, BRANCH).as_deref(), Some(w.head.as_str()));
}

#[test]
fn no_remote_and_the_remote_it_picks() {
    let d = tempfile::tempdir().unwrap();
    g(d.path(), &["init", "-q", "-b", "main"]);
    assert!(remote_for(d.path(), "main")
        .unwrap_err()
        .contains("no remote"));
    g(d.path(), &["remote", "add", "fork", "/nowhere/a.git"]);
    assert_eq!(remote_for(d.path(), "main").unwrap(), "fork");
    g(d.path(), &["remote", "add", "upstream", "/nowhere/b.git"]);
    assert!(remote_for(d.path(), "main").is_err());
    g(d.path(), &["config", "branch.main.remote", "upstream"]);
    assert_eq!(remote_for(d.path(), "main").unwrap(), "upstream");
}
