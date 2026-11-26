//! Real repositories in temporary folders: plan, approve, create, change, keep, commit, remove.

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

fn repo() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    g(d.path(), &["init", "-q", "-b", "main"]);
    g(d.path(), &["config", "user.name", "Ana"]);
    g(d.path(), &["config", "user.email", "ana@example.com"]);
    g(d.path(), &["config", "commit.gpgsign", "false"]);
    std::fs::create_dir_all(d.path().join("src")).unwrap();
    std::fs::write(d.path().join("src/cart.rs"), "pub fn cart() {}\n").unwrap();
    g(d.path(), &["add", "."]);
    g(d.path(), &["commit", "-q", "-m", "init"]);
    d
}

const BRANCH: &str = "feature/dx-1-cart";

#[test]
fn not_a_repository_or_no_commit_means_the_main_tree() {
    let plain = tempfile::tempdir().unwrap();
    let base = tempfile::tempdir().unwrap();
    let p = plan(plain.path(), base.path(), "DX-1", BRANCH).unwrap();
    assert!(!p.available);
    assert_eq!(p.reason.as_deref(), Some("not a git repository"));
    let empty = tempfile::tempdir().unwrap();
    g(empty.path(), &["init", "-q", "-b", "main"]);
    let p = plan(empty.path(), base.path(), "DX-1", BRANCH).unwrap();
    assert!(!p.available);
    assert!(p.reason.unwrap().contains("no commit"));
    // keys and branches that are not names are refused
    let r = repo();
    assert!(plan(r.path(), base.path(), "../x", BRANCH).is_err());
    assert!(plan(r.path(), base.path(), "DX-1", "-x").is_err());
    assert!(plan(r.path(), base.path(), "DX-1", "a..b").is_err());
}

#[test]
fn a_worktree_is_created_only_with_the_approved_commands_and_reused_after() {
    let r = repo();
    let base = tempfile::tempdir().unwrap();
    let head = g(r.path(), &["rev-parse", "HEAD"]);
    let p = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    assert!(p.available && !p.exists && p.new_branch);
    assert_eq!(p.base.as_deref(), Some(head.as_str()));
    // outside the project folder, under the repository's folder of the base
    let at = Path::new(&p.path);
    assert!(at.starts_with(base.path()) && !at.starts_with(r.path()));
    assert_eq!(at.file_name().unwrap(), "DX-1");
    assert_eq!(
        p.command,
        format!(
            "git -C {} worktree add -b {BRANCH} -- {} {head}",
            r.path().display(),
            p.path
        )
    );
    // another command than the approved one runs nothing
    let e = create(r.path(), base.path(), "DX-1", BRANCH, "git worktree add /tmp/x").unwrap_err();
    assert!(e.contains("changed since the approval"), "{e}");
    assert!(!at.exists());
    let w = create(r.path(), base.path(), "DX-1", BRANCH, &p.command).unwrap();
    assert_eq!(w.branch.as_deref(), Some(BRANCH));
    assert_eq!(w.dir, p.path);
    assert!(w.dirty.is_empty() && w.changed.is_empty());
    assert_eq!(
        std::fs::read_to_string(at.join("src/cart.rs")).unwrap(),
        "pub fn cart() {}\n"
    );
    // the main tree does not see it
    assert_eq!(g(r.path(), &["status", "--porcelain", "-uall"]), "");
    assert_eq!(g(r.path(), &["branch", "--show-current"]), "main");
    assert!(same_repo(r.path(), at));
    assert!(!same_repo(r.path(), r.path()));
    // planning again: it exists, nothing to run or approve
    let again = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    assert!(again.exists && again.command.is_empty());
    assert_eq!(again.branch, BRANCH);
    assert_eq!(
        create(r.path(), base.path(), "DX-1", BRANCH, "").unwrap().path,
        w.path
    );
    assert_eq!(list(r.path(), base.path()).unwrap().len(), 1);
    // another repository's worktrees are elsewhere under the same base
    let other = repo();
    assert!(list(other.path(), base.path()).unwrap().is_empty());
    assert_ne!(
        repo_dir(r.path(), base.path()).unwrap(),
        repo_dir(other.path(), base.path()).unwrap()
    );
}

#[test]
fn a_branch_in_use_elsewhere_is_refused_and_an_existing_branch_is_checked_out() {
    let r = repo();
    let base = tempfile::tempdir().unwrap();
    // the main tree has the branch: refused, never forced
    let e = plan(r.path(), base.path(), "DX-1", "main").unwrap_err();
    assert!(e.contains("checked out in"), "{e}");
    // an existing branch (no -b)
    g(r.path(), &["branch", BRANCH]);
    let p = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    assert!(!p.new_branch && p.base.is_none());
    assert!(p.command.ends_with(&format!("worktree add -- {} {BRANCH}", p.path)));
    create(r.path(), base.path(), "DX-1", BRANCH, &p.command).unwrap();
    // a second issue cannot take the same branch
    let e = plan(r.path(), base.path(), "DX-2", BRANCH).unwrap_err();
    assert!(e.contains(BRANCH), "{e}");
    // a folder git does not know, in the way
    let in_way = location(r.path(), base.path(), "DX-3").unwrap();
    std::fs::create_dir_all(&in_way).unwrap();
    let e = plan(r.path(), base.path(), "DX-3", "feature/dx-3").unwrap_err();
    assert!(e.contains("in the way"), "{e}");
}

#[test]
fn changes_keep_the_worktree_a_commit_lands_on_its_branch_and_then_it_goes() {
    let r = repo();
    let base = tempfile::tempdir().unwrap();
    let p = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    let w = create(r.path(), base.path(), "DX-1", BRANCH, &p.command).unwrap();
    let top = PathBuf::from(&w.path);
    std::fs::write(top.join("src/cart.rs"), "pub fn cart() { /* done */ }\n").unwrap();
    std::fs::write(top.join("src/total.rs"), "pub fn total() {}\n").unwrap();
    let w = find(r.path(), base.path(), "DX-1").unwrap().unwrap();
    assert_eq!(w.dirty, ["src/cart.rs", "src/total.rs"]);
    let st: Vec<(String, String)> = w
        .changed
        .iter()
        .map(|c| (c.path.clone(), c.status.clone()))
        .collect();
    assert_eq!(
        st,
        [
            ("src/cart.rs".to_string(), "M".to_string()),
            ("src/total.rs".to_string(), "?".to_string())
        ]
    );
    // read-only view: where the branch left main, and now
    let f = file(r.path(), base.path(), "DX-1", "src/cart.rs").unwrap();
    assert_eq!(f.before.as_deref(), Some("pub fn cart() {}\n"));
    assert_eq!(f.now.as_deref(), Some("pub fn cart() { /* done */ }\n"));
    assert_eq!(f.branch.as_deref(), Some(BRANCH));
    let new = file(r.path(), base.path(), "DX-1", "src/total.rs").unwrap();
    assert!(new.before.is_none() && new.now.is_some());
    assert!(file(r.path(), base.path(), "DX-1", "../x").is_err());
    assert!(file(r.path(), base.path(), "DX-1", "/etc/passwd").is_err());
    // uncommitted changes keep it — never forced
    let kept = remove(r.path(), base.path(), "DX-1", None).unwrap();
    assert!(!kept.removed);
    assert_eq!(kept.dirty, ["src/cart.rs", "src/total.rs"]);
    assert!(top.is_dir());
    // the commit lands on the issue's branch, in the worktree; main does not move
    let main_before = g(r.path(), &["rev-parse", "HEAD"]);
    let sha = commit(r.path(), base.path(), "DX-1", "DX-1: cart and total").unwrap();
    assert_eq!(g(r.path(), &["rev-parse", "--short", BRANCH]), sha);
    assert_eq!(g(r.path(), &["rev-parse", "HEAD"]), main_before);
    assert_eq!(g(r.path(), &["status", "--porcelain", "-uall"]), "");
    let w = find(r.path(), base.path(), "DX-1").unwrap().unwrap();
    assert!(w.dirty.is_empty());
    assert_eq!(w.changed.len(), 2, "committed changes still count against main");
    assert!(commit(r.path(), base.path(), "DX-1", "again")
        .unwrap_err()
        .contains("nothing to commit"));
    // clean now: removed, with the exact command; the branch stays
    let plan_rm = remove_plan(r.path(), base.path(), "DX-1").unwrap();
    assert_eq!(
        plan_rm.command,
        format!("git -C {} worktree remove -- {}", r.path().display(), w.path)
    );
    assert!(remove(r.path(), base.path(), "DX-1", Some("git worktree remove x")).is_err());
    let gone = remove(r.path(), base.path(), "DX-1", Some(&plan_rm.command)).unwrap();
    assert!(gone.removed && !top.exists());
    assert_eq!(g(r.path(), &["rev-parse", "--short", BRANCH]), sha);
    assert!(list(r.path(), base.path()).unwrap().is_empty());
    // the same issue again reuses its branch
    let p = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    assert!(!p.new_branch);
}

#[test]
fn a_worktree_whose_folder_vanished_is_listed_and_pruned() {
    let r = repo();
    let base = tempfile::tempdir().unwrap();
    let p = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    create(r.path(), base.path(), "DX-1", BRANCH, &p.command).unwrap();
    std::fs::remove_dir_all(&p.path).unwrap();
    let l = list(r.path(), base.path()).unwrap();
    assert_eq!(l.len(), 1);
    assert!(l[0].prunable && l[0].dirty.is_empty());
    assert!(find(r.path(), base.path(), "DX-1").unwrap().is_none());
    // planning it again forgets the old entry first
    let again = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    assert!(again.command.contains("worktree prune\n"), "{}", again.command);
    let rm = remove_plan(r.path(), base.path(), "DX-1").unwrap();
    assert!(rm.command.ends_with("worktree prune"));
    assert!(remove(r.path(), base.path(), "DX-1", Some(&rm.command)).unwrap().removed);
    assert!(list(r.path(), base.path()).unwrap().is_empty());
}

#[test]
fn the_secret_scan_guards_a_worktree_commit() {
    let r = repo();
    let base = tempfile::tempdir().unwrap();
    let p = plan(r.path(), base.path(), "DX-1", BRANCH).unwrap();
    let w = create(r.path(), base.path(), "DX-1", BRANCH, &p.command).unwrap();
    std::fs::write(
        Path::new(&w.path).join("src/db.rs"),
        "const URL: &str = \"postgres://u:p@h\";\n",
    )
    .unwrap();
    let e = commit(r.path(), base.path(), "DX-1", "db").unwrap_err();
    assert!(e.starts_with(tutor_protect::scan::BLOCKED), "{e}");
    // the human's override is given for the project, and counts for its worktree's commit
    tutor_protect::scan::allow_once(r.path(), "a test fixture").unwrap();
    commit(r.path(), base.path(), "DX-1", "db").unwrap();
}

#[test]
fn a_project_in_a_subfolder_works_in_the_same_subfolder_of_the_worktree() {
    let r = repo();
    let base = tempfile::tempdir().unwrap();
    let sub = r.path().join("src");
    let p = plan(&sub, base.path(), "DX-1", BRANCH).unwrap();
    let w = create(&sub, base.path(), "DX-1", BRANCH, &p.command).unwrap();
    assert_eq!(Path::new(&w.dir), Path::new(&w.path).join("src"));
    std::fs::write(Path::new(&w.dir).join("cart.rs"), "x\n").unwrap();
    let w = find(&sub, base.path(), "DX-1").unwrap().unwrap();
    assert_eq!(w.dirty, ["cart.rs"]);
    let f = file(&sub, base.path(), "DX-1", "cart.rs").unwrap();
    assert_eq!(f.before.as_deref(), Some("pub fn cart() {}\n"));
}
