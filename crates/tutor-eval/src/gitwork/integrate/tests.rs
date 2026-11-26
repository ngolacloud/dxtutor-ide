//! Real repositories in temporary folders: the candidate, its worktree, the conflict, the stale
//! tips and the fast-forward of exactly the reviewed commit.

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

const BRANCH: &str = "feature/dx-1-cart";

/// `main` with `src/cart.rs`; the issue branch adds `src/pay.rs`; `main` then gains `README.md`.
fn repo() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    let p = d.path();
    g(p, &["init", "-q", "-b", "main"]);
    g(p, &["config", "user.name", "Ana"]);
    g(p, &["config", "user.email", "ana@example.com"]);
    g(p, &["config", "commit.gpgsign", "false"]);
    std::fs::create_dir_all(p.join("src")).unwrap();
    std::fs::write(p.join("src/cart.rs"), "pub fn cart() {}\n").unwrap();
    g(p, &["add", "."]);
    g(p, &["commit", "-q", "-m", "init"]);
    g(p, &["branch", BRANCH]);
    g(p, &["checkout", "-q", BRANCH]);
    std::fs::write(p.join("src/pay.rs"), "pub fn pay() {}\n").unwrap();
    g(p, &["add", "."]);
    g(p, &["commit", "-q", "-m", "DX-1: pay"]);
    g(p, &["checkout", "-q", "main"]);
    std::fs::write(p.join("README.md"), "# shop\n").unwrap();
    g(p, &["add", "."]);
    g(p, &["commit", "-q", "-m", "readme"]);
    d
}

#[test]
fn the_tips_are_the_checked_out_branch_and_the_issue_branch() {
    let r = repo();
    let t = tips(r.path(), BRANCH).unwrap();
    assert_eq!(t.target, "main");
    assert_eq!(t.base, g(r.path(), &["rev-parse", "main"]));
    assert_eq!(t.head, g(r.path(), &["rev-parse", BRANCH]));
    assert_eq!(ahead(r.path(), &t).unwrap(), 1);
    // refused: a missing branch, the checked-out branch itself, a detached HEAD, an option
    assert!(tips(r.path(), "feature/none")
        .unwrap_err()
        .contains("does not exist"));
    assert!(tips(r.path(), "main").is_err());
    assert!(tips(r.path(), "-x").is_err());
    g(r.path(), &["checkout", "-q", "--detach"]);
    assert!(tips(r.path(), BRANCH).unwrap_err().contains("detached"));
}

#[test]
fn the_candidate_is_the_merge_of_both_tips_checked_out_in_a_temporary_worktree() {
    let r = repo();
    let base = tempfile::tempdir().unwrap();
    let t = tips(r.path(), BRANCH).unwrap();
    let cmd = request_command(
        r.path(),
        base.path(),
        "DX-1",
        &t,
        &[("tests".into(), "true".into())],
    )
    .unwrap();
    assert!(
        cmd.contains(&t.base) && cmd.contains(&t.head) && cmd.ends_with("&& true   # tests"),
        "{cmd}"
    );
    let Prepared::Ready(c) = prepare(r.path(), base.path(), "DX-1", &t, "Merge DX-1").unwrap()
    else {
        panic!("conflict")
    };
    // the tree that would land has both sides; the commit has exactly the two parents
    assert!(verify(r.path(), &c.commit, &c.tree, &t.base, &t.head));
    assert!(!verify(r.path(), &c.commit, &c.tree, &t.head, &t.base));
    assert_eq!(
        g(r.path(), &["rev-parse", &format!("{REVIEW_NS}DX-1")]),
        c.commit
    );
    let dir = Path::new(&c.dir);
    assert!(dir.join("src/pay.rs").is_file() && dir.join("README.md").is_file());
    assert_eq!(g(dir, &["rev-parse", "HEAD"]), c.commit);
    // nothing moved: both branches are where they were, the project folder is clean
    assert_eq!(tips(r.path(), BRANCH).unwrap(), t);
    assert_eq!(g(r.path(), &["status", "--porcelain"]), "");
    assert_eq!(
        changed(r.path(), &t.base, &c.commit).unwrap(),
        ["src/pay.rs"]
    );
    let (d, cut) = diff(r.path(), &t.base, &c.commit, 100_000).unwrap();
    assert!(d.contains("+pub fn pay() {}") && !cut);
    assert!(diff(r.path(), &t.base, &c.commit, 10).unwrap().1);
    // preparing again replaces the worktree; discarding removes it and git forgets it
    std::fs::write(dir.join("build.out"), "x").unwrap();
    let Prepared::Ready(c2) = prepare(r.path(), base.path(), "DX-1", &t, "Merge DX-1").unwrap()
    else {
        panic!("conflict")
    };
    assert!(!Path::new(&c2.dir).join("build.out").exists());
    discard(r.path(), base.path(), "DX-1").unwrap();
    assert!(!Path::new(&c2.path).exists());
    assert!(!g(r.path(), &["worktree", "list"]).contains(&c2.path));
}

#[test]
fn a_conflict_names_the_files_and_makes_nothing() {
    let r = repo();
    let p = r.path();
    g(p, &["checkout", "-q", BRANCH]);
    std::fs::write(p.join("src/cart.rs"), "pub fn cart() { 1 }\n").unwrap();
    g(p, &["commit", "-qam", "cart 1"]);
    g(p, &["checkout", "-q", "main"]);
    std::fs::write(p.join("src/cart.rs"), "pub fn cart() { 2 }\n").unwrap();
    g(p, &["commit", "-qam", "cart 2"]);
    let base = tempfile::tempdir().unwrap();
    let t = tips(p, BRANCH).unwrap();
    assert_eq!(
        prepare(p, base.path(), "DX-1", &t, "m").unwrap(),
        Prepared::Conflict(vec!["src/cart.rs".into()])
    );
    assert!(g(p, &["for-each-ref", REVIEW_NS]).is_empty());
    assert!(!location(p, base.path(), "DX-1").unwrap().exists());
}

#[test]
fn integrating_fast_forwards_the_default_branch_to_exactly_the_candidate() {
    let r = repo();
    let p = r.path();
    let base = tempfile::tempdir().unwrap();
    let t = tips(p, BRANCH).unwrap();
    let Prepared::Ready(c) = prepare(p, base.path(), "DX-1", &t, "Merge DX-1").unwrap() else {
        panic!("conflict")
    };
    discard(p, base.path(), "DX-1").unwrap();
    assert_eq!(
        integrate_command(p, &c.commit),
        format!(
            "git -C {} merge --ff-only {}",
            q(&p.display().to_string()),
            c.commit
        )
    );
    assert_eq!(integrate(p, "DX-1", &t, &c.commit).unwrap(), c.commit);
    assert_eq!(g(p, &["rev-parse", "main"]), c.commit);
    assert_eq!(g(p, &["rev-parse", "HEAD^{tree}"]), c.tree);
    assert!(p.join("src/pay.rs").is_file(), "the working tree follows");
    assert!(
        g(p, &["for-each-ref", REVIEW_NS]).is_empty(),
        "the candidate's ref goes"
    );
}

#[test]
fn a_tip_that_moved_after_the_review_stops_the_integration() {
    // the issue branch moved
    let r = repo();
    let p = r.path();
    let base = tempfile::tempdir().unwrap();
    let t = tips(p, BRANCH).unwrap();
    let Prepared::Ready(c) = prepare(p, base.path(), "DX-1", &t, "m").unwrap() else {
        panic!()
    };
    let wt = tempfile::tempdir().unwrap();
    let w = wt.path().join("w");
    g(
        p,
        &["worktree", "add", "-q", &w.display().to_string(), BRANCH],
    );
    std::fs::write(w.join("src/more.rs"), "\n").unwrap();
    g(&w, &["add", "."]);
    g(&w, &["commit", "-q", "-m", "more"]);
    assert!(integrate(p, "DX-1", &t, &c.commit)
        .unwrap_err()
        .contains(BRANCH));
    assert_eq!(g(p, &["rev-parse", "main"]), t.base);
    // the default branch moved
    let r = repo();
    let p = r.path();
    let t = tips(p, BRANCH).unwrap();
    let Prepared::Ready(c) = prepare(p, base.path(), "DX-2", &t, "m").unwrap() else {
        panic!()
    };
    std::fs::write(p.join("NEWS"), "x\n").unwrap();
    g(p, &["add", "."]);
    g(p, &["commit", "-q", "-m", "news"]);
    let moved = g(p, &["rev-parse", "main"]);
    assert!(integrate(p, "DX-2", &t, &c.commit)
        .unwrap_err()
        .contains("main moved"));
    assert_eq!(g(p, &["rev-parse", "main"]), moved);
    // the project folder switched to another branch
    g(p, &["checkout", "-q", "-b", "other"]);
    assert!(integrate(p, "DX-2", &t, &c.commit)
        .unwrap_err()
        .contains("other"));
}

#[test]
fn uncommitted_changes_git_would_overwrite_stop_it_and_nothing_moves() {
    let r = repo();
    let p = r.path();
    let base = tempfile::tempdir().unwrap();
    let t = tips(p, BRANCH).unwrap();
    let Prepared::Ready(c) = prepare(p, base.path(), "DX-1", &t, "m").unwrap() else {
        panic!()
    };
    // a file the merge brings exists, untracked, in the project folder
    std::fs::write(p.join("src/pay.rs"), "mine\n").unwrap();
    assert!(integrate(p, "DX-1", &t, &c.commit).is_err());
    assert_eq!(g(p, &["rev-parse", "main"]), t.base);
    assert_eq!(
        std::fs::read_to_string(p.join("src/pay.rs")).unwrap(),
        "mine\n"
    );
}
