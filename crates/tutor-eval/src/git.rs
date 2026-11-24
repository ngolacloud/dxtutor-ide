//! Git integration for the IDE (section 5 — daily work).
//!
//! Read-only: list the working-tree changes and produce a unified diff, so the editor can
//! show a Git diff view. Never mutates the repository. Degrades honestly (empty) when the
//! folder is not a git repo or git is absent.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

/// One changed path with its porcelain status. `status` keeps the trimmed code for
/// back-compat; `index` / `work` are the raw X (staged) and Y (worktree) columns so the
/// SCM view can group Staged vs Changes like VSCode / GitLens.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub status: String,
    pub index: String,
    pub work: String,
}

/// Run `git -C root <args>` and capture stdout, or `None` if git failed / isn't a repo.
fn git(root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Is `root` inside a git work tree?
pub fn is_repo(root: &Path) -> bool {
    git(root, &["rev-parse", "--is-inside-work-tree"])
        .map(|s| s.trim() == "true")
        .unwrap_or(false)
}

/// The current branch name (or a short commit when detached), for a status-bar indicator.
/// `None` when `root` is not a git repo.
pub fn current_branch(root: &Path) -> Option<String> {
    let name = git(root, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }
    if name == "HEAD" {
        // Detached: fall back to the short commit hash.
        return git(root, &["rev-parse", "--short", "HEAD"]).map(|s| format!("@{}", s.trim()));
    }
    Some(name.to_string())
}

/// The working-tree changes (`git status --porcelain`): modified, added, deleted and
/// untracked paths. Empty when clean or not a repo.
pub fn changed_files(root: &Path) -> Vec<GitChange> {
    // `--untracked-files=all` expands untracked DIRECTORIES into their individual files, so
    // every entry is a real file the UI can open/diff (a bare `dir/` entry would otherwise
    // fail `read_text_file`/`git diff` with "Is a directory").
    let out = match git(root, &["status", "--porcelain", "--untracked-files=all"]) {
        Some(o) => o,
        None => return Vec::new(),
    };
    out.lines()
        .filter(|l| l.len() > 3)
        .map(|l| {
            let (code, path) = l.split_at(2);
            let chars: Vec<char> = code.chars().collect();
            let index = chars.first().copied().unwrap_or(' ');
            let work = chars.get(1).copied().unwrap_or(' ');
            // Porcelain may quote paths with spaces/unicode and show "old -> new" on rename.
            let path = path.trim();
            let path = path.rsplit(" -> ").next().unwrap_or(path).trim_matches('"');
            GitChange {
                status: code.trim().to_string(),
                index: index.to_string(),
                work: work.to_string(),
                path: path.to_string(),
            }
        })
        .collect()
}

/// One commit for the graph view: hash + parents (for lane drawing), subject, author,
/// relative date and any refs (branches/tags) pointing at it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub subject: String,
    pub author: String,
    pub date: String,
    pub refs: Vec<String>,
}

/// The last `max` commits reachable from all refs (`git log --all`), newest first, for the
/// commit graph. Empty when not a repo. Uses an unambiguous unit-separator format so
/// subjects with any punctuation parse cleanly.
pub fn log(root: &Path, max: usize) -> Vec<GitCommit> {
    // %x1f = unit separator between fields, %x1e = record separator between commits.
    let fmt = "--pretty=format:%H%x1f%h%x1f%P%x1f%s%x1f%an%x1f%cr%x1f%D%x1e";
    let arg_max = format!("--max-count={max}");
    let out = match git(root, &["log", "--all", "--topo-order", &arg_max, fmt]) {
        Some(o) => o,
        None => return Vec::new(),
    };
    out.split('\u{1e}')
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .filter_map(|rec| {
            let f: Vec<&str> = rec.split('\u{1f}').collect();
            if f.len() < 7 {
                return None;
            }
            let refs = f[6]
                .split(',')
                .map(|s| s.trim().trim_start_matches("HEAD -> ").to_string())
                .filter(|s| !s.is_empty())
                .collect();
            Some(GitCommit {
                hash: f[0].to_string(),
                short: f[1].to_string(),
                parents: f[2].split_whitespace().map(String::from).collect(),
                subject: f[3].to_string(),
                author: f[4].to_string(),
                date: f[5].to_string(),
                refs,
            })
        })
        .collect()
}

/// A unified diff for a single commit (`git show`), for the graph's detail pane.
pub fn show(root: &Path, hash: &str) -> String {
    git(root, &["show", "--no-color", "--stat", "--patch", hash]).unwrap_or_default()
}

/// Run an isolated task in a throwaway **git worktree** of HEAD: apply `writes` (relative
/// path → content) there and return the unified diff — WITHOUT touching the working tree
/// (RF-AG-01/05). The worktree is always removed afterwards. `Err` on git failure.
pub fn worktree_patch(root: &Path, writes: &[(String, String)]) -> Result<String, String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let tmp = std::env::temp_dir().join(format!(
        "dxtutor-wt-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let tmp_s = tmp.to_string_lossy().into_owned();
    git_mutate(root, &["worktree", "add", "--detach", &tmp_s, "HEAD"])?;

    let result = (|| -> Result<String, String> {
        for (rel, content) in writes {
            let p = tmp.join(rel);
            if let Some(parent) = p.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&p, content).map_err(|e| e.to_string())?;
        }
        git_mutate(&tmp, &["add", "-A"])?;
        Ok(git(&tmp, &["diff", "--cached"]).unwrap_or_default())
    })();

    // Always clean up the worktree (best-effort), then also prune its admin entry.
    let _ = git_mutate(root, &["worktree", "remove", "--force", &tmp_s]);
    let _ = git_mutate(root, &["worktree", "prune"]);
    result
}

// ── Co-Dev sessions: an isolated git worktree per working session, like Claude Code ─────────

/// A Co-Dev session worktree: a dedicated branch + checkout where the assistant works in
/// isolation. `base` is the branch it integrates back into on delivery (develop/staging/main…).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub slug: String,
    pub branch: String,
    pub base: String,
    pub worktree: String,
}

/// Outcome of delivering (integrating) a session back onto its base branch.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeliverInfo {
    pub merged: bool,
    pub base: String,
    pub commit: String,
    pub note: String,
}

/// Lowercase, hyphen-separated, git-ref-safe slug for a session name. Non-empty.
fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for c in name.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let s = out.trim_matches('-').to_string();
    if s.is_empty() {
        "session".into()
    } else {
        s
    }
}

/// Keep `.worktrees/` out of the base tree's `git status` without touching tracked files:
/// append it to `.git/info/exclude` (idempotent).
fn ensure_worktrees_excluded(root: &Path) {
    let Some(common) = git(root, &["rev-parse", "--git-common-dir"]) else {
        return;
    };
    let common = common.trim();
    let gitdir = if Path::new(common).is_absolute() {
        PathBuf::from(common)
    } else {
        root.join(common)
    };
    let excl = gitdir.join("info").join("exclude");
    let cur = std::fs::read_to_string(&excl).unwrap_or_default();
    if cur.lines().any(|l| l.trim() == ".worktrees/") {
        return;
    }
    if let Some(parent) = excl.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut next = cur;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(".worktrees/\n");
    let _ = std::fs::write(&excl, next);
}

/// Start a Co-Dev session: create `<root>/.worktrees/<slug>` on a new branch `codev/<slug>`
/// from the current HEAD, so the assistant works in isolation. `Err` when `root` is not a repo
/// or a session of the same name already exists.
pub fn session_start(root: &Path, name: &str) -> Result<SessionInfo, String> {
    if !is_repo(root) {
        return Err("not a git repository".into());
    }
    let base = current_branch(root).ok_or("no current branch")?;
    let slug = slugify(name);
    let branch = format!("codev/{slug}");
    let wt = root.join(".worktrees").join(&slug);
    let wt_s = wt.to_string_lossy().into_owned();
    if wt.exists() {
        return Err(format!("a session '{slug}' is already open"));
    }
    ensure_worktrees_excluded(root);
    // Reuse a stale branch of the same name if present; otherwise branch from HEAD.
    let exists = git(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )
    .is_some();
    if exists {
        git_mutate(root, &["worktree", "add", &wt_s, &branch])?;
    } else {
        git_mutate(root, &["worktree", "add", "-b", &branch, &wt_s, "HEAD"])?;
    }
    Ok(SessionInfo {
        slug,
        branch,
        base,
        worktree: wt_s,
    })
}

/// Deliver a session: commit anything uncommitted in the worktree, integrate its branch into
/// the base branch with a `--no-ff` merge (back in `root`), then remove the worktree and delete
/// the session branch. A clean session (no commits ahead of base) integrates nothing but is
/// still torn down. `Err` (leaving the worktree intact for inspection) on a merge conflict.
pub fn session_deliver(root: &Path, slug: &str, message: &str) -> Result<DeliverInfo, String> {
    let base = current_branch(root).ok_or("no current branch")?;
    let branch = format!("codev/{slug}");
    let wt = root.join(".worktrees").join(slug);
    let wt_s = wt.to_string_lossy().into_owned();
    if !wt.exists() {
        return Err(format!("no open session '{slug}'"));
    }
    // 1) Commit the session's work (if the worktree is dirty).
    git_mutate(&wt, &["add", "-A"])?;
    let has_staged = git(&wt, &["diff", "--cached", "--quiet"]).is_none(); // exit 1 (None) ⇒ staged changes
    if has_staged {
        let msg = if message.trim().is_empty() {
            format!("codev session {slug}")
        } else {
            message.to_string()
        };
        commit(&wt, &msg)?;
    }
    // 2) Integrate into the base branch iff the session has commits the base lacks.
    let ahead = git(root, &["rev-list", "--count", &format!("{base}..{branch}")])
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(0);
    let (merged, commit_short, note) = if ahead > 0 {
        require_identity(root)?;
        let out = Command::new("git")
            .arg("-C")
            .arg(root)
            .args([
                "merge",
                "--no-ff",
                "-m",
                &format!("Merge codev session {slug}"),
                &branch,
            ])
            .output()
            .map_err(|e| format!("could not start git: {e}"))?;
        if !out.status.success() {
            // Abort a half-done merge so the base tree is left clean; keep the worktree.
            let _ = git_mutate(root, &["merge", "--abort"]);
            return Err(format!(
                "merge into {base} failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let short = git(root, &["rev-parse", "--short", "HEAD"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default();
        (true, short, format!("integrated into {base}"))
    } else {
        (false, String::new(), "nothing to integrate".to_string())
    };
    // 3) Tear down the worktree and the session branch.
    let _ = git_mutate(root, &["worktree", "remove", "--force", &wt_s]);
    let _ = git_mutate(root, &["worktree", "prune"]);
    let _ = git_mutate(root, &["branch", "-D", &branch]);
    Ok(DeliverInfo {
        merged,
        base,
        commit: commit_short,
        note,
    })
}

/// Discard a session without integrating: remove the worktree and delete its branch.
pub fn session_discard(root: &Path, slug: &str) -> Result<(), String> {
    let branch = format!("codev/{slug}");
    let wt_s = root
        .join(".worktrees")
        .join(slug)
        .to_string_lossy()
        .into_owned();
    let _ = git_mutate(root, &["worktree", "remove", "--force", &wt_s]);
    let _ = git_mutate(root, &["worktree", "prune"]);
    git_mutate(root, &["branch", "-D", &branch])
}

/// The open Co-Dev sessions (worktrees on `codev/*` branches). Empty when not a repo.
pub fn sessions(root: &Path) -> Vec<SessionInfo> {
    let out = match git(root, &["worktree", "list", "--porcelain"]) {
        Some(o) => o,
        None => return Vec::new(),
    };
    let base = current_branch(root).unwrap_or_default();
    let mut res = Vec::new();
    let mut cur_path: Option<String> = None;
    for line in out.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            cur_path = Some(p.trim().to_string());
        } else if let Some(b) = line.strip_prefix("branch ") {
            let b = b.trim().trim_start_matches("refs/heads/");
            if let Some(slug) = b.strip_prefix("codev/") {
                if let Some(path) = cur_path.take() {
                    res.push(SessionInfo {
                        slug: slug.to_string(),
                        branch: b.to_string(),
                        base: base.clone(),
                        worktree: path,
                    });
                }
            }
        }
    }
    res
}

/// Local branch names (`git branch`), current branch first. Empty when not a repo.
pub fn branches(root: &Path) -> Vec<String> {
    let out = match git(root, &["branch", "--format=%(refname:short)"]) {
        Some(o) => o,
        None => return Vec::new(),
    };
    let current = current_branch(root);
    let mut names: Vec<String> = out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    // Current branch to the front so the UI can mark it.
    if let Some(c) = current {
        names.sort_by_key(|n| if *n == c { 0 } else { 1 });
    }
    names
}

/// Switch to an existing branch (`git checkout <branch>`).
pub fn checkout(root: &Path, branch: &str) -> Result<(), String> {
    git_mutate(root, &["checkout", branch])
}

/// Create and switch to a new branch (`git checkout -b <branch>`).
pub fn create_branch(root: &Path, name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("empty branch name".into());
    }
    git_mutate(root, &["checkout", "-b", name])
}

/// Stage a path (`git add -- <path>`). Returns `Err` with git's stderr on failure.
pub fn stage(root: &Path, path: &str) -> Result<(), String> {
    git_mutate(root, &["add", "--", path])
}

/// Unstage a path (`git reset -q HEAD -- <path>`).
pub fn unstage(root: &Path, path: &str) -> Result<(), String> {
    git_mutate(root, &["reset", "-q", "HEAD", "--", path])
}

/// Stage every change (`git add -A`).
pub fn stage_all(root: &Path) -> Result<(), String> {
    git_mutate(root, &["add", "-A"])
}

/// The author of every commit is the human (RF-T02, docs/v2/RF-DELONIX-PLANO.md F4.8): the
/// repository's (or the global) git identity. Without one, the commit is refused with how to set
/// it — never signed by a made-up `dxtutor` user.
fn require_identity(root: &Path) -> Result<(), String> {
    let get = |k: &str| {
        git(root, &["config", k])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    match (get("user.name"), get("user.email")) {
        (Some(_), Some(_)) => Ok(()),
        _ => Err(
            "o git não tem user.name/user.email: os commits são de quem trabalha \
                  (git config user.name «Nome»; git config user.email «email»)"
                .into(),
        ),
    }
}

/// Commit the staged changes with `message`, as the human (the git identity of the repo).
pub fn commit(root: &Path, message: &str) -> Result<(), String> {
    if message.trim().is_empty() {
        return Err("empty commit message".into());
    }
    require_identity(root)?;
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["commit", "-m", message])
        .output()
        .map_err(|e| format!("could not start git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Run a mutating `git -C root <args>`, surfacing stderr on failure.
fn git_mutate(root: &Path, args: &[&str]) -> Result<(), String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("could not start git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Like [`git`] but returns stdout even on a non-zero exit — needed for `git diff
/// --no-index`, which exits 1 precisely when the files differ.
fn git_allow_fail(root: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .ok()?;
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

/// A unified diff (optionally scoped to `file`). When `staged`, shows the index vs HEAD
/// (`git diff --cached`); otherwise the working tree vs HEAD. For an untracked file (no
/// diff vs HEAD) it shows the whole file as additions, so the view isn't blank for a new
/// file. Empty when there's nothing to show or it's not a repo.
pub fn diff(root: &Path, file: Option<&str>, staged: bool) -> String {
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("HEAD");
    if let Some(f) = file {
        args.push("--");
        args.push(f);
    }
    let tracked = git(root, &args).unwrap_or_default();
    if !tracked.is_empty() {
        return tracked;
    }
    // Untracked file (only meaningful for the worktree view): show its content as additions.
    if !staged {
        if let Some(f) = file {
            return git_allow_fail(root, &["diff", "--no-index", "--", "/dev/null", f])
                .unwrap_or_default();
        }
    }
    tracked
}

/// Clone `url` into `parent_dir`, returning the path of the freshly created repository
/// directory on success (so the caller can mount it). The destination name is derived by
/// `git` from the URL; we discover it by reading the parent dir before/after the clone.
/// Returns `Err` with git's stderr when the clone fails.
pub fn clone_repo(url: &str, parent_dir: &Path) -> Result<std::path::PathBuf, String> {
    let before: std::collections::HashSet<std::path::PathBuf> = std::fs::read_dir(parent_dir)
        .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    let out = Command::new("git")
        .arg("-C")
        .arg(parent_dir)
        .args(["clone", url])
        .output()
        .map_err(|e| format!("could not start git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    // The new directory is the one that appeared.
    std::fs::read_dir(parent_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .find(|p| p.is_dir() && !before.contains(p))
        .ok_or_else(|| "clone succeeded but the new folder was not found".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(root: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(args)
            .status()
            .unwrap();
        assert!(ok.success(), "git {args:?} failed");
    }

    #[test]
    fn status_and_diff_on_a_temp_repo() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        run(root, &["init", "-q"]);
        run(root, &["config", "user.email", "t@t"]);
        run(root, &["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        run(root, &["add", "a.txt"]);
        run(root, &["commit", "-q", "-m", "init"]);
        assert!(is_repo(root));
        assert!(changed_files(root).is_empty(), "clean after commit");

        // Modify tracked + add untracked.
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(root.join("b.txt"), "new\n").unwrap();
        // An untracked DIRECTORY must be expanded into its files (not a bare `dir/` entry),
        // so the UI can open/diff each one.
        std::fs::create_dir_all(root.join("newdir")).unwrap();
        std::fs::write(root.join("newdir/inside.txt"), "x\n").unwrap();

        let changes = changed_files(root);
        assert!(
            changes.iter().any(|c| c.path == "a.txt" && c.status == "M"),
            "{changes:?}"
        );
        assert!(
            changes
                .iter()
                .any(|c| c.path == "b.txt" && c.status == "??"),
            "{changes:?}"
        );
        assert!(
            changes.iter().any(|c| c.path == "newdir/inside.txt"),
            "untracked dir expanded: {changes:?}"
        );
        assert!(
            !changes.iter().any(|c| c.path.ends_with('/')),
            "no bare directory entries: {changes:?}"
        );

        let d = diff(root, Some("a.txt"), false);
        assert!(d.contains("+two"), "diff should show the added line:\n{d}");

        // Branch name (git's default may be master or main depending on config).
        let branch = current_branch(root).expect("a branch");
        assert!(
            branch == "main" || branch == "master",
            "unexpected branch: {branch}"
        );

        // An untracked file shows its whole content as additions (not blank).
        let du = diff(root, Some("b.txt"), false);
        assert!(
            du.contains("+new"),
            "untracked diff should show the content:\n{du}"
        );
    }

    #[test]
    fn stage_commit_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        run(root, &["init", "-q"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();

        // Untracked: index blank, work "?".
        let before = changed_files(root);
        let a = before
            .iter()
            .find(|c| c.path == "a.txt")
            .expect("a.txt listed");
        assert_eq!(a.work, "?");

        // Stage it → it moves to the index column ("A").
        stage(root, "a.txt").unwrap();
        let staged = changed_files(root);
        assert!(
            staged.iter().any(|c| c.path == "a.txt" && c.index == "A"),
            "{staged:?}"
        );

        // RF-T02: with no identity the commit is refused (no made-up author)…
        if git(root, &["config", "user.email"]).map_or(true, |s| s.trim().is_empty()) {
            assert!(commit(root, "add a")
                .unwrap_err()
                .contains("user.name/user.email"));
        }
        run(root, &["config", "user.email", "ana@example.com"]);
        run(root, &["config", "user.name", "Ana"]);
        // Commit the staged change → tree is clean, and the author is the human.
        commit(root, "add a").unwrap();
        assert!(changed_files(root).is_empty(), "clean after commit");
        assert_eq!(
            git(root, &["log", "-1", "--format=%an <%ae>"])
                .unwrap()
                .trim(),
            "Ana <ana@example.com>"
        );

        // Unstage after a new staged change returns it to the worktree.
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        stage(root, "a.txt").unwrap();
        unstage(root, "a.txt").unwrap();
        let un = changed_files(root);
        assert!(
            un.iter().any(|c| c.path == "a.txt" && c.work == "M"),
            "{un:?}"
        );
    }

    #[test]
    fn branch_list_create_checkout() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        run(root, &["init", "-q"]);
        run(root, &["config", "user.email", "t@t"]);
        run(root, &["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        run(root, &["add", "a.txt"]);
        run(root, &["commit", "-q", "-m", "init"]);

        let base = current_branch(root).unwrap();
        create_branch(root, "feature/x").unwrap();
        assert_eq!(current_branch(root).as_deref(), Some("feature/x"));
        let names = branches(root);
        assert!(
            names.contains(&"feature/x".to_string()) && names.contains(&base),
            "{names:?}"
        );
        assert_eq!(
            names.first().unwrap(),
            "feature/x",
            "current branch first: {names:?}"
        );

        checkout(root, &base).unwrap();
        assert_eq!(current_branch(root).as_deref(), Some(base.as_str()));
    }

    #[test]
    fn log_lists_commits_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        run(root, &["init", "-q"]);
        run(root, &["config", "user.email", "t@t"]);
        run(root, &["config", "user.name", "Tester"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        run(root, &["add", "a.txt"]);
        run(
            root,
            &["commit", "-q", "-m", "first: with punctuation, commas"],
        );
        std::fs::write(root.join("a.txt"), "one\ntwo\n").unwrap();
        run(root, &["add", "a.txt"]);
        run(root, &["commit", "-q", "-m", "second"]);

        let commits = log(root, 10);
        assert_eq!(commits.len(), 2, "{commits:?}");
        assert_eq!(commits[0].subject, "second");
        assert_eq!(commits[1].subject, "first: with punctuation, commas");
        assert_eq!(commits[0].author, "Tester");
        assert_eq!(commits[0].parents, vec![commits[1].hash.clone()]);
        assert!(commits[1].parents.is_empty(), "root has no parent");
        // HEAD/branch ref is attached to the tip.
        assert!(commits[0]
            .refs
            .iter()
            .any(|r| r.contains("main") || r.contains("master")));

        let patch = show(root, &commits[0].hash);
        assert!(patch.contains("+two"), "{patch}");
    }

    #[test]
    fn worktree_patch_isolates_the_change() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        run(root, &["init", "-q"]);
        run(root, &["config", "user.email", "t@t"]);
        run(root, &["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "one\n").unwrap();
        run(root, &["add", "a.txt"]);
        run(root, &["commit", "-q", "-m", "init"]);

        let patch = worktree_patch(
            root,
            &[
                ("a.txt".into(), "one\ntwo\n".into()),
                ("new.txt".into(), "hi\n".into()),
            ],
        )
        .unwrap();
        assert!(patch.contains("+two"), "patch shows the edit:\n{patch}");
        assert!(
            patch.contains("new.txt"),
            "patch shows the new file:\n{patch}"
        );

        // The real working tree is UNTOUCHED (no two, no new file, tree clean).
        assert_eq!(
            std::fs::read_to_string(root.join("a.txt")).unwrap(),
            "one\n"
        );
        assert!(!root.join("new.txt").exists());
        assert!(changed_files(root).is_empty(), "working tree stayed clean");
    }

    #[test]
    fn session_worktree_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        run(root, &["init", "-q", "-b", "develop"]);
        run(root, &["config", "user.email", "t@t"]);
        run(root, &["config", "user.name", "t"]);
        std::fs::write(root.join("a.txt"), "base\n").unwrap();
        run(root, &["add", "a.txt"]);
        run(root, &["commit", "-q", "-m", "init"]);

        // Start a session: a real worktree on codev/<slug>, base = develop.
        let s = session_start(root, "Add Feature").unwrap();
        assert_eq!(s.slug, "add-feature");
        assert_eq!(s.branch, "codev/add-feature");
        assert_eq!(s.base, "develop");
        let wt = Path::new(&s.worktree);
        assert!(wt.is_dir(), "worktree checkout exists");
        assert_eq!(
            current_branch(wt).as_deref(),
            Some("codev/add-feature"),
            "worktree is on the session branch"
        );
        // The base tree's status stays clean (.worktrees excluded).
        assert!(
            changed_files(root).is_empty(),
            "base tree clean: {:?}",
            changed_files(root)
        );

        // The assistant works in the worktree: new file + edit, then deliver.
        std::fs::write(wt.join("feature.txt"), "hello\n").unwrap();
        std::fs::write(wt.join("a.txt"), "base\nmore\n").unwrap();
        let d = session_deliver(root, &s.slug, "feat: the feature").unwrap();
        assert!(d.merged, "something was integrated: {d:?}");
        assert_eq!(d.base, "develop");
        assert!(!d.commit.is_empty(), "merge commit recorded");

        // The change landed on develop (the base tree), and the worktree is gone.
        assert_eq!(
            std::fs::read_to_string(root.join("feature.txt")).unwrap(),
            "hello\n"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("a.txt")).unwrap(),
            "base\nmore\n"
        );
        assert!(!wt.exists(), "worktree removed");
        assert!(sessions(root).is_empty(), "no open sessions after deliver");
        assert!(
            !branches(root).contains(&"codev/add-feature".to_string()),
            "session branch deleted"
        );
        // A real merge commit (two parents) tops develop.
        let commits = log(root, 10);
        assert!(
            commits[0].subject.contains("Merge codev session"),
            "{commits:?}"
        );
        assert_eq!(commits[0].parents.len(), 2, "no-ff merge has two parents");

        // Discard path: start another, then throw it away without integrating.
        let s2 = session_start(root, "scratch").unwrap();
        std::fs::write(Path::new(&s2.worktree).join("junk.txt"), "x\n").unwrap();
        session_discard(root, &s2.slug).unwrap();
        assert!(
            !Path::new(&s2.worktree).exists(),
            "discarded worktree removed"
        );
        assert!(
            !root.join("junk.txt").exists(),
            "discard integrated nothing"
        );
        assert!(sessions(root).is_empty());
    }

    #[test]
    fn non_repo_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_repo(dir.path()));
        assert!(changed_files(dir.path()).is_empty());
        assert!(diff(dir.path(), None, false).is_empty());
        assert!(current_branch(dir.path()).is_none());
    }
}
