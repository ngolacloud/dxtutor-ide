//! Multi Co-Dev, phase 5: pushing an issue branch for a pull request — and nothing else.
//!
//! The rules (here, with the real `git`):
//! - only an issue branch: never the default branch (the one the project folder has checked out),
//!   never the remote's default branch (its `HEAD`), never `main`/`master`/`trunk`;
//! - never forced: no `--force`, no `+` refspec, and a push that would not be a fast-forward of what
//!   the remote has is refused before git is asked (git would refuse it too);
//! - never to a remote branch dxtutor did not create: when the remote already has the branch, the
//!   caller must know it pushed it there first (the Project remembers the branches it created);
//! - exactly the reviewed commit (`<sha>:refs/heads/<branch>`), never whatever the branch points at
//!   when it runs;
//! - never asks for credentials (`GIT_TERMINAL_PROMPT=0`, ssh in batch mode, no askpass): a remote
//!   that needs a login fails and says so.

use std::path::Path;

use serde::Serialize;

use super::codev::{q, trimmed};
use crate::gitx::{self, git};

/// Branch names that are never pushed, whatever the remote says its default is.
pub const NEVER: [&str; 3] = ["main", "master", "trunk"];

/// What a push of the issue branch would do, for the approval dialog and the audit log.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushPlan {
    pub remote: String,
    /// the remote's push URL (the key of the branches dxtutor created)
    pub url: String,
    pub branch: String,
    /// the commit that is pushed
    pub head: String,
    /// the remote has the branch already (at `remote_head`)
    pub exists: bool,
    pub remote_head: Option<String>,
    /// the exact command
    pub command: String,
}

fn check_branch(root: &Path, branch: &str) -> Result<(), String> {
    if branch.is_empty()
        || branch.starts_with('-')
        || branch.starts_with('+')
        || branch.contains(':')
        || git(root, &["check-ref-format", "--branch", branch]).is_err()
    {
        return Err(format!("not a branch name: {branch:?}"));
    }
    Ok(())
}

fn check_sha(sha: &str) -> Result<(), String> {
    if sha.len() == 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(format!("not a full commit hash: {sha:?}"))
    }
}

/// The remote the default branch tracks (`branch.<target>.remote`), else `origin`, else the only
/// remote. No remote: refused.
pub fn remote_for(root: &Path, target: &str) -> Result<String, String> {
    let remotes: Vec<String> = git(root, &["remote"])?
        .lines()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_string)
        .collect();
    if remotes.is_empty() {
        return Err("this repository has no remote to push to".into());
    }
    if let Some(r) = trimmed(
        root,
        &["config", "--get", &format!("branch.{target}.remote")],
    ) {
        if remotes.contains(&r) {
            return Ok(r);
        }
    }
    if remotes.iter().any(|r| r == "origin") {
        return Ok("origin".into());
    }
    if remotes.len() == 1 {
        return Ok(remotes[0].clone());
    }
    Err(format!(
        "{target} tracks no remote and there is no origin among {}: set the upstream of {target}",
        remotes.join(", ")
    ))
}

fn net_env() -> Vec<(&'static str, String)> {
    let ssh = std::env::var("GIT_SSH_COMMAND").unwrap_or_else(|_| "ssh -o BatchMode=yes".into());
    vec![
        ("GIT_SSH_COMMAND", ssh),
        ("SSH_ASKPASS_REQUIRE", "never".into()),
        ("GIT_ASKPASS", "".into()),
        ("GCM_INTERACTIVE", "never".into()),
    ]
}

fn net(root: &Path, args: &[&str]) -> Result<String, String> {
    let env = net_env();
    let e: Vec<(&str, &str)> = env.iter().map(|(k, v)| (*k, v.as_str())).collect();
    gitx::run(root, args, &e)
}

/// The remote's default branch (what its `HEAD` points at), when it says.
pub fn remote_default(root: &Path, remote: &str) -> Result<Option<String>, String> {
    let out = net(root, &["ls-remote", "--symref", "--", remote, "HEAD"])?;
    Ok(out.lines().find_map(|l| {
        l.strip_prefix("ref: refs/heads/")
            .and_then(|r| r.split('\t').next())
            .map(|b| b.trim().to_string())
    }))
}

/// Where the remote has `branch` now (`None`: it does not have it).
pub fn remote_head(root: &Path, remote: &str, branch: &str) -> Result<Option<String>, String> {
    let out = net(
        root,
        &[
            "ls-remote",
            "--heads",
            "--",
            remote,
            &format!("refs/heads/{branch}"),
        ],
    )?;
    Ok(out.lines().find_map(|l| {
        let (sha, name) = l.split_once('\t')?;
        (name.trim() == format!("refs/heads/{branch}")).then(|| sha.trim().to_string())
    }))
}

/// The exact push command.
pub fn push_command(root: &Path, remote: &str, head: &str, branch: &str) -> String {
    format!(
        "git -C {} push --porcelain -- {} {head}:refs/heads/{}",
        q(&root.display().to_string()),
        q(remote),
        q(branch)
    )
}

/// The push of `branch` at `head` for a pull request into `target` (the project folder's branch).
/// `ours(url, branch)`: dxtutor created that branch on that remote. Refused: the default branch, the
/// remote's default, the names in [`NEVER`], a remote branch dxtutor did not create, and a push that
/// would not be a fast-forward.
pub fn plan(
    root: &Path,
    target: &str,
    branch: &str,
    head: &str,
    ours: &dyn Fn(&str, &str) -> bool,
) -> Result<PushPlan, String> {
    let branch = branch.trim();
    check_branch(root, branch)?;
    check_sha(head)?;
    if branch == target.trim() {
        return Err(format!(
            "{branch} is the default branch (the project folder's): dxtutor only pushes issue branches"
        ));
    }
    if NEVER.contains(&branch) {
        return Err(format!("dxtutor never pushes {branch}"));
    }
    let remote = remote_for(root, target)?;
    let url = trimmed(root, &["remote", "get-url", "--push", "--", &remote])
        .ok_or_else(|| format!("the remote {remote} has no URL"))?;
    if remote_default(root, &remote)?.as_deref() == Some(branch) {
        return Err(format!(
            "{branch} is the default branch of {remote}: dxtutor only pushes issue branches"
        ));
    }
    let now = remote_head(root, &remote, branch)?;
    if let Some(sha) = &now {
        if !ours(&url, branch) {
            return Err(format!(
                "{remote} already has {branch} and dxtutor did not create it: push it yourself, or use another branch"
            ));
        }
        if sha != head {
            let known = trimmed(root, &["cat-file", "-t", sha]).as_deref() == Some("commit");
            let ff = known && git(root, &["merge-base", "--is-ancestor", sha, head]).is_ok();
            if !ff {
                return Err(format!(
                    "{remote}/{branch} is at {sha}, which {head} does not follow: dxtutor never force-pushes"
                ));
            }
        }
    }
    Ok(PushPlan {
        command: push_command(root, &remote, head, branch),
        remote,
        url,
        branch: branch.to_string(),
        head: head.to_string(),
        exists: now.is_some(),
        remote_head: now,
    })
}

/// Runs the push of `p` — only if it is still the command `expected` — and checks the remote has
/// exactly `p.head` afterwards. Never forced.
pub fn push(root: &Path, p: &PushPlan, expected: &str) -> Result<(), String> {
    let command = push_command(root, &p.remote, &p.head, &p.branch);
    if command != expected.trim() || command != p.command {
        return Err(format!(
            "the push changed since it was approved: it is now\n{command}"
        ));
    }
    check_sha(&p.head)?;
    let refspec = format!("{}:refs/heads/{}", p.head, p.branch);
    if refspec.starts_with('+') || p.branch.starts_with('+') {
        return Err("dxtutor never force-pushes".into());
    }
    net(root, &["push", "--porcelain", "--", &p.remote, &refspec])?;
    let landed = remote_head(root, &p.remote, &p.branch)?;
    if landed.as_deref() != Some(p.head.as_str()) {
        return Err(format!(
            "{}/{} is at {} after the push, not {}",
            p.remote,
            p.branch,
            landed.unwrap_or_else(|| "nothing".into()),
            p.head
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests;
