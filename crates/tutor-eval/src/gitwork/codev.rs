//! Multi Co-Dev, phase 3: a git worktree per Co-Dev issue session.
//!
//! When two Co-Devs work at once, the second one (and any issue that already has one) works in its
//! own linked worktree on the issue's branch, so their files never mix on disk. Where:
//! `<base>/<repo id>/<issue key>`, with `base` the app's local data folder (`worktrees/`) and the
//! repo id the first 12 hex digits of the SHA-256 of the repository's common git dir. Outside the
//! project folder on purpose: no tool of the project (test runners, linters, watchers, search, the
//! IDE's own file loader) ever walks into it, and it never shows in the main tree's `git status`.
//! Git keeps it registered (`git worktree list`), so a worktree left after a crash is found again.
//!
//! Rules (every function runs the real `git`):
//! - Creating one changes the repository: [`plan`] gives the exact commands for the approval
//!   dialog, [`create`] runs them only if they are still the approved ones.
//! - A branch checked out in another worktree (the main one included) is refused, never forced.
//! - Removing one never forces: with uncommitted changes (tracked or new) it is kept and listed;
//!   the branch always stays.
//! - A commit happens in the worktree, on its branch, after the secret scan.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::gitx::{self, git, Worktree};

/// The issue key as a folder name: letters, digits, `-`/`_`, starting with a letter or digit.
pub fn check_key(key: &str) -> Result<&str, String> {
    let k = key.trim();
    let ok = !k.is_empty()
        && k.len() <= 40
        && k.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
        && k.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(k)
    } else {
        Err(format!("not an issue key: {key:?}"))
    }
}

fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn trimmed(root: &Path, args: &[&str]) -> Option<String> {
    git(root, args)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// The repository's common git dir (the same for every worktree of it), absolute.
fn common_dir(root: &Path) -> Result<PathBuf, String> {
    let d = trimmed(root, &["rev-parse", "--git-common-dir"])
        .ok_or_else(|| format!("not a git repository: {}", root.display()))?;
    let p = PathBuf::from(&d);
    Ok(canon(&if p.is_absolute() { p } else { root.join(p) }))
}

/// Do `a` and `b` belong to the same repository, as two different worktrees?
pub fn same_repo(a: &Path, b: &Path) -> bool {
    matches!((common_dir(a), common_dir(b)), (Ok(x), Ok(y)) if x == y)
        && trimmed(a, &["rev-parse", "--show-toplevel"]).map(PathBuf::from).map(|p| canon(&p))
            != trimmed(b, &["rev-parse", "--show-toplevel"]).map(PathBuf::from).map(|p| canon(&p))
}

/// The folder of this repository's Co-Dev worktrees under `base`.
pub fn repo_dir(root: &Path, base: &Path) -> Result<PathBuf, String> {
    let c = common_dir(root)?;
    let h = Sha256::digest(c.to_string_lossy().as_bytes());
    let id: String = h.iter().take(6).map(|b| format!("{b:02x}")).collect();
    Ok(base.join(id))
}

/// Where the worktree of issue `key` lives.
pub fn location(root: &Path, base: &Path, key: &str) -> Result<PathBuf, String> {
    Ok(repo_dir(root, base)?.join(check_key(key)?))
}

/// The project folder inside the repository (`""` when the project is the repository's top).
fn prefix(root: &Path) -> String {
    git(root, &["rev-parse", "--show-prefix"])
        .map(|s| s.trim().trim_end_matches('/').to_string())
        .unwrap_or_default()
}

fn worktrees(root: &Path) -> Result<Vec<Worktree>, String> {
    git(root, &["worktree", "list", "--porcelain"]).map(|t| gitx::parse_worktrees(&t, root))
}

fn same_path(a: &str, b: &Path) -> bool {
    Path::new(a) == b || canon(Path::new(a)) == canon(b)
}

/// For the approval dialog and the audit log: the commands as a POSIX shell would read them.
fn shown(root: &Path, steps: &[Vec<String>]) -> String {
    steps
        .iter()
        .map(|s| {
            let mut w = vec!["git".to_string(), "-C".into(), q(&root.display().to_string())];
            w.extend(s.iter().map(|a| q(a)));
            w.join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn q(s: &str) -> String {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "_./:=@%+,-".contains(c))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// What starting a Co-Dev session on an issue does to the repository.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreePlan {
    /// `false`: worktrees cannot be used here (`reason`: not a git repository, no commit yet) —
    /// the session works in the main tree.
    pub available: bool,
    pub reason: Option<String>,
    pub key: String,
    /// the branch the worktree checks out (the one it has, when it exists)
    pub branch: String,
    /// the worktree's folder (its top)
    pub path: String,
    /// it exists already: nothing to run, nothing to approve
    pub exists: bool,
    /// the branch does not exist yet: it starts at `base`
    pub new_branch: bool,
    /// the commit a new branch starts from (the main tree's HEAD)
    pub base: Option<String>,
    /// the exact commands, one per line (empty when it exists)
    pub command: String,
    #[serde(skip)]
    steps: Vec<Vec<String>>,
}

fn unavailable(key: &str, branch: &str, reason: &str) -> WorktreePlan {
    WorktreePlan {
        available: false,
        reason: Some(reason.to_string()),
        key: key.to_string(),
        branch: branch.to_string(),
        path: String::new(),
        exists: false,
        new_branch: false,
        base: None,
        command: String::new(),
        steps: vec![],
    }
}

/// What the worktree of issue `key` on `branch` needs: nothing (it exists — whatever branch it is
/// on now), or the commands that create it. Refused: a branch in use in another worktree, a folder
/// in the way that git does not know.
pub fn plan(root: &Path, base: &Path, key: &str, branch: &str) -> Result<WorktreePlan, String> {
    let key = check_key(key)?;
    let branch = branch.trim();
    if trimmed(root, &["rev-parse", "--is-inside-work-tree"]).as_deref() != Some("true") {
        return Ok(unavailable(key, branch, "not a git repository"));
    }
    let Some(head) = trimmed(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]) else {
        return Ok(unavailable(key, branch, "the repository has no commit yet"));
    };
    if branch.is_empty()
        || branch.starts_with('-')
        || git(root, &["check-ref-format", "--branch", branch]).is_err()
    {
        return Err(format!("not a branch name: {branch:?}"));
    }
    let path = location(root, base, key)?;
    let path_s = path.display().to_string();
    let list = worktrees(root)?;
    let mut steps: Vec<Vec<String>> = vec![];
    if let Some(w) = list.iter().find(|w| same_path(&w.path, &path)) {
        if !w.prunable && path.is_dir() {
            return Ok(WorktreePlan {
                available: true,
                reason: None,
                key: key.to_string(),
                branch: w.branch.clone().unwrap_or_default(),
                path: w.path.clone(),
                exists: true,
                new_branch: false,
                base: None,
                command: String::new(),
                steps: vec![],
            });
        }
        // registered, but its folder is gone (a crash, a manual delete): git forgets it first
        steps.push(vec!["worktree".into(), "prune".into()]);
    } else if path.exists() {
        return Err(format!(
            "{} is in the way and is not a worktree of this repository: move it away and try again",
            path.display()
        ));
    }
    if let Some(w) = list
        .iter()
        .find(|w| w.branch.as_deref() == Some(branch) && !same_path(&w.path, &path) && !w.prunable)
    {
        return Err(format!(
            "the branch {branch} is checked out in {}: a branch lives in one worktree at a time — switch that one to another branch first",
            w.path
        ));
    }
    let exists = git(
        root,
        &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")],
    )
    .is_ok();
    steps.push(if exists {
        vec!["worktree".into(), "add".into(), "--".into(), path_s.clone(), branch.into()]
    } else {
        vec![
            "worktree".into(),
            "add".into(),
            "-b".into(),
            branch.into(),
            "--".into(),
            path_s.clone(),
            head.clone(),
        ]
    });
    Ok(WorktreePlan {
        available: true,
        reason: None,
        key: key.to_string(),
        branch: branch.to_string(),
        path: path_s,
        exists: false,
        new_branch: !exists,
        base: (!exists).then_some(head),
        command: shown(root, &steps),
        steps,
    })
}

/// One file a worktree changed against where its branch left the main tree.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    /// project-relative
    pub path: String,
    /// `A` added, `M` modified, `D` deleted, `R` renamed, `?` new and not added yet
    pub status: String,
}

/// A Co-Dev worktree as the strip lists it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub key: String,
    /// its top folder
    pub path: String,
    /// the project folder inside it (where the session works)
    pub dir: String,
    /// `None` when detached
    pub branch: Option<String>,
    pub head: String,
    /// git still lists it, but its folder is gone
    pub prunable: bool,
    /// uncommitted changes, tracked or new (project-relative)
    pub dirty: Vec<String>,
    /// everything it changed since its branch left the main tree, committed or not
    pub changed: Vec<Changed>,
}

fn strip<'a>(prefix: &str, p: &'a str) -> Option<&'a str> {
    if prefix.is_empty() {
        Some(p)
    } else {
        p.strip_prefix(prefix).and_then(|r| r.strip_prefix('/'))
    }
}

/// Uncommitted changes of a worktree (tracked or new, never ignored), relative to its top.
fn dirty_files(top: &Path) -> Vec<String> {
    let Ok(text) = git(top, &["status", "--porcelain=v1", "-z", "-uall"]) else {
        return vec![];
    };
    let mut out = vec![];
    let mut parts = text.split('\0');
    while let Some(e) = parts.next() {
        if e.len() < 4 {
            continue;
        }
        let (xy, p) = (&e[..2], &e[3..]);
        if xy.starts_with('R') || xy.starts_with('C') {
            parts.next();
        }
        out.push(p.to_string());
    }
    out.sort();
    out.dedup();
    out
}

fn changed_files(root: &Path, top: &Path) -> Vec<Changed> {
    let mut out: Vec<Changed> = vec![];
    let main = trimmed(root, &["rev-parse", "HEAD"]);
    let fork = main.and_then(|m| trimmed(top, &["merge-base", "HEAD", &m]));
    if let Some(fork) = fork {
        if let Ok(text) = git(top, &["diff", "--name-status", "-z", "--no-renames", &fork]) {
            let mut it = text.split('\0').filter(|s| !s.is_empty());
            while let (Some(st), Some(p)) = (it.next(), it.next()) {
                out.push(Changed {
                    path: p.to_string(),
                    status: st.chars().next().unwrap_or('M').to_string(),
                });
            }
        }
    }
    if let Ok(text) = git(top, &["ls-files", "--others", "--exclude-standard", "-z"]) {
        for p in text.split('\0').filter(|s| !s.is_empty()) {
            out.push(Changed {
                path: p.to_string(),
                status: "?".into(),
            });
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out.dedup_by(|a, b| a.path == b.path);
    out
}

fn info_of(root: &Path, key: &str, w: &Worktree) -> WorktreeInfo {
    let top = PathBuf::from(&w.path);
    let pre = prefix(root);
    let dir = if pre.is_empty() { top.clone() } else { top.join(&pre) };
    let live = !w.prunable && top.is_dir();
    let rel = |v: Vec<String>| -> Vec<String> {
        v.iter()
            .filter_map(|p| strip(&pre, p).map(str::to_string))
            .collect()
    };
    WorktreeInfo {
        key: key.to_string(),
        path: w.path.clone(),
        dir: dir.display().to_string(),
        branch: w.branch.clone(),
        head: w.head.clone(),
        prunable: !live,
        dirty: if live { rel(dirty_files(&top)) } else { vec![] },
        changed: if live {
            changed_files(root, &top)
                .into_iter()
                .filter_map(|c| {
                    strip(&pre, &c.path).map(|p| Changed {
                        path: p.to_string(),
                        status: c.status.clone(),
                    })
                })
                .collect()
        } else {
            vec![]
        },
    }
}

/// The Co-Dev worktrees of this repository (the ones under its folder in `base`), by key.
pub fn list(root: &Path, base: &Path) -> Result<Vec<WorktreeInfo>, String> {
    let dir = canon(&repo_dir(root, base)?);
    let mut v: Vec<WorktreeInfo> = worktrees(root)?
        .iter()
        .filter_map(|w| {
            let p = Path::new(&w.path);
            let parent = p.parent().map(canon)?;
            let key = p.file_name()?.to_string_lossy().to_string();
            (parent == dir && check_key(&key).is_ok()).then(|| info_of(root, &key, w))
        })
        .collect();
    v.sort_by(|a, b| a.key.cmp(&b.key));
    Ok(v)
}

/// The worktree of issue `key`, when it exists and its folder is there.
pub fn find(root: &Path, base: &Path, key: &str) -> Result<Option<WorktreeInfo>, String> {
    let key = check_key(key)?;
    Ok(list(root, base)?
        .into_iter()
        .find(|w| w.key == key && !w.prunable))
}

/// Creates the worktree of `plan` — only if planning again gives the commands the human approved
/// (`approved`, as [`WorktreePlan::command`] showed them). An existing one is returned as it is.
pub fn create(
    root: &Path,
    base: &Path,
    key: &str,
    branch: &str,
    approved: &str,
) -> Result<WorktreeInfo, String> {
    let p = plan(root, base, key, branch)?;
    if !p.available {
        return Err(p.reason.unwrap_or_else(|| "worktrees are not available here".into()));
    }
    if !p.exists {
        if p.command != approved.trim() {
            return Err(format!(
                "the repository changed since the approval: the commands are now\n{}",
                p.command
            ));
        }
        let parent = Path::new(&p.path)
            .parent()
            .ok_or("the worktree has no parent folder")?;
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
        for s in &p.steps {
            let args: Vec<&str> = s.iter().map(String::as_str).collect();
            git(root, &args)?;
        }
    }
    find(root, base, key)?.ok_or_else(|| format!("the worktree of {key} was not created"))
}

/// Removing a worktree: what runs, and what keeps it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removal {
    pub key: String,
    pub path: String,
    pub branch: Option<String>,
    /// the exact command (`git worktree remove`, never forced; `prune` when its folder is gone)
    pub command: String,
    /// it was removed (the branch stays)
    pub removed: bool,
    /// why it stays: uncommitted changes, tracked or new
    pub dirty: Vec<String>,
}

fn removal_of(root: &Path, w: WorktreeInfo) -> Removal {
    let step: Vec<String> = if w.prunable {
        vec!["worktree".into(), "prune".into()]
    } else {
        vec!["worktree".into(), "remove".into(), "--".into(), w.path.clone()]
    };
    Removal {
        key: w.key,
        command: shown(root, &[step]),
        path: w.path,
        branch: w.branch,
        removed: false,
        dirty: w.dirty,
    }
}

/// The exact command that removes a listed worktree (for the approval dialog).
pub fn remove_command(root: &Path, w: &WorktreeInfo) -> String {
    removal_of(root, w.clone()).command
}

/// What removing the worktree of `key` runs, and whether uncommitted changes keep it.
pub fn remove_plan(root: &Path, base: &Path, key: &str) -> Result<Removal, String> {
    let key = check_key(key)?;
    let w = list(root, base)?
        .into_iter()
        .find(|w| w.key == key)
        .ok_or_else(|| format!("there is no Co-Dev worktree for {key}"))?;
    Ok(removal_of(root, w))
}

/// Removes the linked worktree whose folder holds `dir` (a session's worktree, when it closes) if
/// it has no uncommitted changes; the main worktree is never removed. See [`remove`].
pub fn remove_at(root: &Path, dir: &Path) -> Result<Removal, String> {
    let top = trimmed(dir, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .ok_or_else(|| format!("not a git worktree: {}", dir.display()))?;
    let all = worktrees(root)?;
    if all.first().is_some_and(|w| same_path(&w.path, &top)) {
        return Err("the main worktree is never removed".into());
    }
    let w = all
        .iter()
        .find(|w| same_path(&w.path, &top))
        .ok_or_else(|| format!("{} is not a worktree of this repository", top.display()))?;
    let key = top
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    run_removal(root, removal_of(root, info_of(root, &key, w)))
}

/// Removes the worktree of `key` when it has no uncommitted changes (the branch stays). With
/// `approved`, only if the command is still that one. Uncommitted changes keep it (`removed:
/// false`, with the files) — git itself refuses too if a change lands in between.
pub fn remove(
    root: &Path,
    base: &Path,
    key: &str,
    approved: Option<&str>,
) -> Result<Removal, String> {
    let r = remove_plan(root, base, key)?;
    if let Some(a) = approved {
        if a.trim() != r.command {
            return Err(format!(
                "the worktree changed since the approval: the command is now\n{}",
                r.command
            ));
        }
    }
    run_removal(root, r)
}

fn run_removal(root: &Path, mut r: Removal) -> Result<Removal, String> {
    if !r.dirty.is_empty() {
        return Ok(r);
    }
    let res = if r.command.ends_with(" prune") {
        git(root, &["worktree", "prune"])
    } else {
        git(root, &["worktree", "remove", "--", &r.path])
    };
    match res {
        Ok(_) => {
            r.removed = true;
            Ok(r)
        }
        Err(e) => {
            let dirty = dirty_files(Path::new(&r.path));
            if dirty.is_empty() {
                Err(e)
            } else {
                r.dirty = dirty;
                Ok(r)
            }
        }
    }
}

/// A file of a worktree, read-only: as it was where the branch left the main tree, and as it is now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePair {
    pub path: String,
    /// the absolute path in the worktree (the editor shows it, read-only)
    pub abs: String,
    pub branch: Option<String>,
    pub before: Option<String>,
    pub now: Option<String>,
}

/// Reads `path` (project-relative) of the worktree of `key`. Never writes.
pub fn file(root: &Path, base: &Path, key: &str, path: &str) -> Result<FilePair, String> {
    let w = find(root, base, key)?.ok_or_else(|| format!("there is no Co-Dev worktree for {key}"))?;
    let rel = gitx::check_path(path)?;
    if Path::new(rel)
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(format!("not a path inside the project: {path}"));
    }
    let dir = PathBuf::from(&w.dir);
    let abs = dir.join(rel);
    // a link inside the worktree must not lead out of it
    if abs.exists() && !canon(&abs).starts_with(canon(Path::new(&w.path))) {
        return Err(format!("{path} leads out of the worktree"));
    }
    let now = std::fs::read(&abs)
        .ok()
        .map(|b| String::from_utf8_lossy(&b).to_string());
    let top = Path::new(&w.path);
    let pre = prefix(root);
    let in_repo = if pre.is_empty() {
        rel.to_string()
    } else {
        format!("{pre}/{rel}")
    };
    let before = trimmed(root, &["rev-parse", "HEAD"])
        .and_then(|m| trimmed(top, &["merge-base", "HEAD", &m]))
        .and_then(|fork| git(top, &["show", &format!("{fork}:{in_repo}")]).ok());
    Ok(FilePair {
        path: rel.to_string(),
        abs: abs.display().to_string(),
        branch: w.branch,
        before,
        now,
    })
}

/// Commits everything the worktree of `key` has (new files included) on its branch, after the
/// secret scan (the human's override is the project's, `root`). Returns the short commit.
pub fn commit(root: &Path, base: &Path, key: &str, message: &str) -> Result<String, String> {
    let m = message.trim();
    if m.is_empty() {
        return Err("empty commit message".into());
    }
    let w = find(root, base, key)?.ok_or_else(|| format!("there is no Co-Dev worktree for {key}"))?;
    if w.branch.is_none() {
        return Err(format!(
            "the worktree of {key} is not on a branch (detached HEAD): check out its branch first"
        ));
    }
    let top = Path::new(&w.path);
    git(top, &["add", "-A"])?;
    if trimmed(top, &["diff", "--cached", "--name-only"]).is_none() {
        return Err(format!("the worktree of {key} has nothing to commit"));
    }
    tutor_protect::scan::guard_commit_as(top, root, &tutor_protect::scan::Scope::Staged)?;
    git(top, &["commit", "-m", m])?;
    trimmed(top, &["rev-parse", "--short", "HEAD"])
        .ok_or_else(|| "commit made but HEAD unreadable".into())
}

#[cfg(test)]
mod tests;
