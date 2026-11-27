//! Multi Co-Dev, phase 4: the reviewed merge of an issue branch into the default branch.
//!
//! The default branch is the one the project folder has checked out (where the Co-Dev worktrees
//! of phase 3 forked from). Integrating an issue happens in two moves, both with the real `git`:
//!
//! 1. [`prepare`] — the *candidate*: the issue branch merged onto the default branch's tip, computed
//!    without touching either (`git merge-tree --write-tree`, git ≥ 2.38) and recorded as a merge
//!    commit (`git commit-tree`, parents: the default branch's tip, then the issue branch's tip) that
//!    no branch points at yet. A ref (`refs/dxtutor/review/<KEY>`) keeps it from `git gc`. A conflict
//!    gives the files and makes nothing. The candidate is checked out, detached, in a temporary
//!    worktree under the app's data folder, where the mandatory checks and the reviewer run: that
//!    tree is exactly the one that would land.
//! 2. [`integrate`] — the default branch moves to that very commit (`git merge --ff-only`): only
//!    while neither tip moved since the review (else the candidate is not what would land), never a
//!    push, never forced.
//!
//! Nothing here decides whether a change may land: that is the gate (the mandatory checks, the
//! reviewer and the functional approval), which the caller checks right before [`integrate`].

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

use super::codev::{canon, check_key, prefix, q, repo_dir, trimmed};
use crate::gitx::git;

/// Where the candidates are kept from `git gc` (one per issue: the newest review's).
pub const REVIEW_NS: &str = "refs/dxtutor/review/";

/// The two tips a review is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tips {
    /// the default branch: the one the project folder has checked out
    pub target: String,
    /// its tip
    pub base: String,
    /// the issue's branch
    pub branch: String,
    /// its tip
    pub head: String,
}

/// The default branch: the branch the project folder has checked out. Refused: a detached HEAD,
/// a branch with no commit.
pub fn target(root: &Path) -> Result<String, String> {
    let b = trimmed(root, &["symbolic-ref", "--quiet", "--short", "HEAD"]).ok_or(
        "the project folder is not on a branch (detached HEAD): check out the default branch first",
    )?;
    commit_of(root, &format!("refs/heads/{b}"))
        .ok_or_else(|| format!("the branch {b} has no commit yet"))?;
    Ok(b)
}

fn commit_of(root: &Path, refname: &str) -> Option<String> {
    trimmed(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{refname}^{{commit}}"),
        ],
    )
}

fn check_branch(root: &Path, branch: &str) -> Result<(), String> {
    if branch.is_empty()
        || branch.starts_with('-')
        || git(root, &["check-ref-format", "--branch", branch]).is_err()
    {
        return Err(format!("not a branch name: {branch:?}"));
    }
    Ok(())
}

/// The tips now: the default branch's and the issue branch's.
pub fn tips(root: &Path, branch: &str) -> Result<Tips, String> {
    let branch = branch.trim();
    check_branch(root, branch)?;
    let target = target(root)?;
    if target == branch {
        return Err(format!(
            "the project folder has {branch} checked out: there is no other branch to integrate it into"
        ));
    }
    let base = commit_of(root, &format!("refs/heads/{target}"))
        .ok_or_else(|| format!("the branch {target} has no commit"))?;
    let head = commit_of(root, &format!("refs/heads/{branch}"))
        .ok_or_else(|| format!("the branch {branch} does not exist"))?;
    Ok(Tips {
        target,
        base,
        branch: branch.to_string(),
        head,
    })
}

/// How many commits the issue branch has that the default branch does not.
pub fn ahead(root: &Path, t: &Tips) -> Result<u32, String> {
    git(
        root,
        &["rev-list", "--count", &format!("{}..{}", t.base, t.head)],
    )?
    .trim()
    .parse()
    .map_err(|e| format!("git rev-list: {e}"))
}

/// Where the temporary integration worktree of issue `key` lives (`base` is the app's
/// `integration/` folder; one folder per repository, like the Co-Dev worktrees).
pub fn location(root: &Path, base: &Path, key: &str) -> Result<PathBuf, String> {
    Ok(repo_dir(root, base)?.join(check_key(key)?))
}

/// The project folder inside a worktree of the repository whose top is `top`.
fn project_dir(root: &Path, top: &Path) -> PathBuf {
    let pre = prefix(root);
    if pre.is_empty() {
        top.to_path_buf()
    } else {
        top.join(pre)
    }
}

/// What a review request runs, for the approval dialog and the audit log. The same tips, folder
/// and checks give the same text (the request runs only if it is still the approved one).
/// `checks`: `(name, command)`, in order.
pub fn request_command(
    root: &Path,
    base: &Path,
    key: &str,
    t: &Tips,
    checks: &[(String, String)],
) -> Result<String, String> {
    let top = location(root, base, key)?;
    let dir = project_dir(root, &top);
    let r = q(&root.display().to_string());
    let mut lines = vec![
        format!(
            "git -C {r} merge-tree --write-tree {} {}   # {} onto {}",
            t.base, t.head, t.branch, t.target
        ),
        format!(
            "git -C {r} commit-tree <tree> -p {} -p {} -m <merge message>",
            t.base, t.head
        ),
        format!(
            "git -C {r} update-ref {REVIEW_NS}{key} <merge commit>",
            key = check_key(key)?
        ),
        format!(
            "git -C {r} worktree add --detach -- {} <merge commit>",
            q(&top.display().to_string())
        ),
    ];
    for (name, command) in checks {
        lines.push(format!(
            "cd {} && {}   # {}",
            q(&dir.display().to_string()),
            command.trim(),
            name.trim()
        ));
    }
    Ok(lines.join("\n"))
}

/// The merge of `head` onto `base`, without touching anything.
#[derive(Debug, Clone, PartialEq)]
pub enum Merge {
    Clean { tree: String },
    Conflict { files: Vec<String> },
}

/// `git merge-tree --write-tree` of the two commits.
pub fn merge_tree(root: &Path, base: &str, head: &str) -> Result<Merge, String> {
    let o = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "merge-tree",
            "--write-tree",
            "--name-only",
            "--no-messages",
            base,
            head,
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("could not start git: {e}"))?;
    let text = String::from_utf8_lossy(&o.stdout).to_string();
    match o.status.code() {
        Some(0) => {
            let tree = text.lines().next().unwrap_or("").trim().to_string();
            if tree.len() < 40 || !tree.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(format!("git merge-tree gave no tree: {text:?}"));
            }
            Ok(Merge::Clean { tree })
        }
        Some(1) if !text.trim().is_empty() => Ok(Merge::Conflict {
            files: super::parse_merge_tree(&text),
        }),
        _ => Err(format!(
            "git merge-tree: {}",
            String::from_utf8_lossy(&o.stderr).trim()
        )),
    }
}

/// A prepared candidate: the merge commit and the temporary worktree where it is checked out.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub tips: Tips,
    /// the tree that would land
    pub tree: String,
    /// the merge commit (parents: `base`, `head`)
    pub commit: String,
    /// the temporary worktree's top
    pub path: String,
    /// the project folder inside it (where the checks and the reviewer run)
    pub dir: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Prepared {
    Ready(Candidate),
    /// the merge conflicts in these files: nothing was made
    Conflict(Vec<String>),
}

/// Makes the candidate of `t` and checks it out in the temporary worktree of `key` (a previous one
/// is removed first). `message` is the merge commit's message.
pub fn prepare(
    root: &Path,
    base: &Path,
    key: &str,
    t: &Tips,
    message: &str,
) -> Result<Prepared, String> {
    let key = check_key(key)?;
    let tree = match merge_tree(root, &t.base, &t.head)? {
        Merge::Conflict { files } => return Ok(Prepared::Conflict(files)),
        Merge::Clean { tree } => tree,
    };
    let message = if message.trim().is_empty() {
        format!("Merge {} into {}", t.branch, t.target)
    } else {
        message.trim().to_string()
    };
    let commit = git(
        root,
        &[
            "commit-tree",
            &tree,
            "-p",
            &t.base,
            "-p",
            &t.head,
            "-m",
            &message,
        ],
    )?
    .trim()
    .to_string();
    git(root, &["update-ref", &format!("{REVIEW_NS}{key}"), &commit])?;
    discard(root, base, key)?;
    let top = location(root, base, key)?;
    let parent = top.parent().ok_or("the integration folder has no parent")?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("could not create {}: {e}", parent.display()))?;
    git(
        root,
        &[
            "worktree",
            "add",
            "--detach",
            "--",
            &top.display().to_string(),
            &commit,
        ],
    )?;
    let dir = project_dir(root, &top);
    Ok(Prepared::Ready(Candidate {
        tips: t.clone(),
        tree,
        commit,
        path: top.display().to_string(),
        dir: dir.display().to_string(),
    }))
}

/// Removes the temporary worktree of `key` (the app's own folder: a detached checkout of the
/// candidate with what the checks built — nothing of anyone's work) and makes git forget it.
pub fn discard(root: &Path, base: &Path, key: &str) -> Result<(), String> {
    let top = location(root, base, key)?;
    let here = canon(&repo_dir(root, base)?);
    if top.exists() {
        // only ever inside this repository's integration folder
        if !canon(&top).starts_with(&here) {
            return Err(format!("{} is not an integration worktree", top.display()));
        }
        std::fs::remove_dir_all(&top)
            .map_err(|e| format!("could not remove {}: {e}", top.display()))?;
    }
    git(root, &["worktree", "prune"])?;
    Ok(())
}

/// Is `commit` still the candidate recorded: that tree, with exactly the parents `base`, `head`?
pub fn verify(root: &Path, commit: &str, tree: &str, base: &str, head: &str) -> bool {
    let tree_now = trimmed(
        root,
        &[
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("{commit}^{{tree}}"),
        ],
    );
    let parents = trimmed(root, &["rev-list", "--parents", "-n", "1", commit]);
    tree_now.as_deref() == Some(tree) && parents == Some(format!("{commit} {base} {head}"))
}

/// The files the candidate changes against the default branch's tip, relative to the project
/// folder (changes outside it are left out).
pub fn changed(root: &Path, base: &str, commit: &str) -> Result<Vec<String>, String> {
    let text = git(
        root,
        &[
            "diff",
            "--name-only",
            "--relative",
            "--no-renames",
            "-z",
            base,
            commit,
        ],
    )?;
    Ok(text
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect())
}

/// The candidate's diff against the default branch's tip (project folder only), cut at
/// `max_chars`; `true` when it was cut.
pub fn diff(
    root: &Path,
    base: &str,
    commit: &str,
    max_chars: usize,
) -> Result<(String, bool), String> {
    let text = git(
        root,
        &[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--relative",
            "-U3",
            base,
            commit,
        ],
    )?;
    if text.chars().count() <= max_chars {
        return Ok((text, false));
    }
    Ok((text.chars().take(max_chars).collect(), true))
}

/// How many lines the project file `rel` has in `commit` (`None`: not a file of it). For the
/// reviewer's evidence: a file it cites must be there, and its lines too.
pub fn file_lines(root: &Path, commit: &str, rel: &str) -> Option<usize> {
    let rel = crate::gitx::check_path(rel).ok()?;
    if Path::new(rel)
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return None;
    }
    let pre = prefix(root);
    let in_repo = if pre.is_empty() {
        rel.to_string()
    } else {
        format!("{pre}/{rel}")
    };
    let kind = trimmed(root, &["cat-file", "-t", &format!("{commit}:{in_repo}")])?;
    if kind != "blob" {
        return None;
    }
    let text = git(root, &["cat-file", "blob", &format!("{commit}:{in_repo}")]).ok()?;
    Some(text.lines().count())
}

/// Does `needle` (literally) appear in a project file of `commit`? For the reviewer's evidence: a
/// test it names must exist in the tree.
pub fn mentions(root: &Path, commit: &str, needle: &str) -> bool {
    let n = needle.trim();
    if n.is_empty() || n.chars().any(|c| c.is_control()) {
        return false;
    }
    let pre = prefix(root);
    let scope = if pre.is_empty() { ".".to_string() } else { pre };
    Command::new("git")
        .arg("-C")
        .arg(root)
        .args(["grep", "-q", "-F", "-e", n, commit, "--", &scope])
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// The exact command that integrates the candidate (for the approval dialog and the audit log).
pub fn integrate_command(root: &Path, commit: &str) -> String {
    format!(
        "git -C {} merge --ff-only {commit}",
        q(&root.display().to_string())
    )
}

/// Moves the default branch to the candidate `commit` (`git merge --ff-only` in the project folder,
/// so its working tree follows) — only while the tips are still `t`; then the candidate's ref goes.
/// Never pushes, never forces: uncommitted changes git would overwrite stop it, and nothing moves.
pub fn integrate(root: &Path, key: &str, t: &Tips, commit: &str) -> Result<String, String> {
    let key = check_key(key)?;
    let now = tips(root, &t.branch)?;
    if now.target != t.target {
        return Err(format!(
            "the project folder is on {} now, not {}: review again",
            now.target, t.target
        ));
    }
    if now.base != t.base {
        return Err(format!("{} moved since the review: review again", t.target));
    }
    if now.head != t.head {
        return Err(format!("{} moved since the review: review again", t.branch));
    }
    if !git(root, &["merge-base", "--is-ancestor", &t.base, commit])
        .map(|_| true)
        .unwrap_or(false)
    {
        return Err(format!("{commit} does not follow {}", t.target));
    }
    git(root, &["merge", "--ff-only", "--no-edit", commit])?;
    let landed = commit_of(root, &format!("refs/heads/{}", t.target));
    if landed.as_deref() != Some(commit) {
        return Err(format!(
            "{} is at {} after the merge, not {commit}",
            t.target,
            landed.unwrap_or_default()
        ));
    }
    let _ = git(root, &["update-ref", "-d", &format!("{REVIEW_NS}{key}")]);
    Ok(commit.to_string())
}

#[cfg(test)]
mod tests;
