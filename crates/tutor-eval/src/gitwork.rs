//! The git work of r23 F3 (docs/v2/AUDIT-r23.md §4.3): what the Commit Graph's sidebar needs in one
//! read (branches with their upstream and ahead/behind, remotes, tags, stashes, worktrees,
//! contributors), and — in the next steps — hunk staging, undo snapshots and conflict prediction.
//!
//! Like `gitx`, every function runs the real `git` and parses machine output (`%00`-separated
//! `for-each-ref` formats); nothing is simulated.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;

use crate::gitx::{self, git, Stash, StashOp, Worktree, WorktreeOp};

// ───── refs: the sidebar ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub sha: String,
    /// `origin/main`, when one is set
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    /// the upstream branch no longer exists on the remote
    pub gone: bool,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBranch {
    pub remote: String,
    /// the branch name without the remote (`main` for `origin/main`)
    pub name: String,
    pub sha: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub name: String,
    /// the commit (annotated tags are peeled)
    pub sha: String,
    pub annotated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributor {
    pub name: String,
    pub email: String,
    pub commits: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Refs {
    /// the current branch (`None` when HEAD is detached or the repository has no commit yet)
    pub head: Option<String>,
    pub head_sha: Option<String>,
    pub branches: Vec<Branch>,
    pub remotes: Vec<String>,
    pub remote_branches: Vec<RemoteBranch>,
    pub tags: Vec<Tag>,
    pub stashes: Vec<Stash>,
    pub worktrees: Vec<Worktree>,
    pub contributors: Vec<Contributor>,
}

/// `ahead 2, behind 1` / `ahead 3` / `behind 4` / `gone` / `` → (ahead, behind, gone).
pub fn parse_track(track: &str) -> (u32, u32, bool) {
    let t = track.trim().trim_start_matches('[').trim_end_matches(']');
    if t == "gone" {
        return (0, 0, true);
    }
    let mut ahead = 0;
    let mut behind = 0;
    for part in t.split(',') {
        let mut w = part.split_whitespace();
        match (w.next(), w.next().and_then(|n| n.parse::<u32>().ok())) {
            (Some("ahead"), Some(n)) => ahead = n,
            (Some("behind"), Some(n)) => behind = n,
            _ => {}
        }
    }
    (ahead, behind, false)
}

/// `refs/heads/…` rows: `name\0sha\0upstream\0track\0head-marker`.
pub fn parse_branches(text: &str) -> Vec<Branch> {
    text.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\0').collect();
            if f.len() < 5 || f[0].is_empty() {
                return None;
            }
            let (ahead, behind, gone) = parse_track(f[3]);
            Some(Branch {
                name: f[0].to_string(),
                sha: f[1].to_string(),
                upstream: Some(f[2]).filter(|u| !u.is_empty()).map(str::to_string),
                ahead,
                behind,
                gone,
                current: f[4].trim() == "*",
            })
        })
        .collect()
}

/// `refs/remotes/…` rows: `remote/name\0sha` (the `remote/HEAD` symbolic refs are skipped).
pub fn parse_remote_branches(text: &str, remotes: &[String]) -> Vec<RemoteBranch> {
    text.lines()
        .filter_map(|l| {
            let (full, sha) = l.split_once('\0')?;
            let remote = remotes
                .iter()
                .filter(|r| full.starts_with(&format!("{r}/")))
                .max_by_key(|r| r.len())?;
            let name = &full[remote.len() + 1..];
            if name == "HEAD" || name.is_empty() {
                return None;
            }
            Some(RemoteBranch {
                remote: remote.clone(),
                name: name.to_string(),
                sha: sha.to_string(),
            })
        })
        .collect()
}

/// `refs/tags/…` rows: `name\0object\0peeled` (`peeled` is set for annotated tags).
pub fn parse_tags(text: &str) -> Vec<Tag> {
    text.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\0').collect();
            if f.len() < 3 || f[0].is_empty() {
                return None;
            }
            let annotated = !f[2].is_empty();
            Some(Tag {
                name: f[0].to_string(),
                sha: if annotated { f[2] } else { f[1] }.to_string(),
                annotated,
            })
        })
        .collect()
}

/// `git shortlog -sne` rows: `   12\tAna <ana@x>`, most commits first.
pub fn parse_shortlog(text: &str) -> Vec<Contributor> {
    text.lines()
        .filter_map(|l| {
            let (n, who) = l.trim().split_once('\t')?;
            let commits = n.trim().parse().ok()?;
            let (name, email) = match who.rsplit_once(" <") {
                Some((name, rest)) => (name.trim(), rest.trim_end_matches('>')),
                None => (who.trim(), ""),
            };
            Some(Contributor {
                name: name.to_string(),
                email: email.to_string(),
                commits,
            })
        })
        .collect()
}

/// Everything the Commit Graph's sidebar shows, in one read.
pub fn refs(root: &Path) -> Result<Refs, String> {
    let branches = parse_branches(&git(
        root,
        &["for-each-ref", "--format=%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)", "refs/heads"],
    )?);
    let remotes: Vec<String> = git(root, &["remote"])?
        .lines()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_string)
        .collect();
    let remote_branches = parse_remote_branches(
        &git(
            root,
            &[
                "for-each-ref",
                "--format=%(refname:short)%00%(objectname:short)",
                "refs/remotes",
            ],
        )?,
        &remotes,
    );
    let tags = parse_tags(&git(
        root,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:short)%00%(objectname:short)%00%(*objectname:short)",
            "refs/tags",
        ],
    )?);
    let head_sha = git(root, &["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let head = git(root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && head_sha.is_some());
    let contributors = if head_sha.is_some() {
        parse_shortlog(&git(root, &["shortlog", "-sne", "--all"])?)
    } else {
        Vec::new()
    };
    Ok(Refs {
        head,
        head_sha,
        branches,
        remotes,
        remote_branches,
        tags,
        stashes: gitx::stash(root, &StashOp::List)?.stashes,
        worktrees: gitx::worktree(root, &WorktreeOp::List)?,
        contributors,
    })
}

// ───── hunks: staging part of a file (UI-SCM-10) ─────

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hunk {
    /// stable while the hunk's text is the same (FNV-1a of its header and lines)
    pub id: String,
    /// `@@ -a,b +c,d @@ context`
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// the body, each line with its ` `/`+`/`-`/`\` prefix
    pub lines: Vec<String>,
    pub added: u32,
    pub removed: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHunks {
    pub path: String,
    /// hunks of the index vs HEAD (`true`) or of the working tree vs the index (`false`)
    pub staged: bool,
    pub binary: bool,
    pub hunks: Vec<Hunk>,
}

fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:012x}", h & 0xffff_ffff_ffff)
}

fn range(s: &str) -> (u32, u32) {
    let s = s.trim_start_matches(['-', '+']);
    match s.split_once(',') {
        Some((a, b)) => (a.parse().unwrap_or(0), b.parse().unwrap_or(0)),
        None => (s.parse().unwrap_or(0), 1),
    }
}

/// A one-file unified diff → (the file header up to the first `@@`, the hunks, binary?).
pub fn parse_hunks(diff: &str) -> (String, Vec<Hunk>, bool) {
    let mut header = String::new();
    let mut hunks: Vec<Hunk> = Vec::new();
    let mut binary = false;
    for line in diff.lines() {
        if line.starts_with("@@") {
            let mut parts = line.split_whitespace().skip(1);
            let (os, ol) = range(parts.next().unwrap_or("-0,0"));
            let (ns, nl) = range(parts.next().unwrap_or("+0,0"));
            hunks.push(Hunk {
                id: String::new(),
                header: line.to_string(),
                old_start: os,
                old_lines: ol,
                new_start: ns,
                new_lines: nl,
                lines: vec![],
                added: 0,
                removed: 0,
            });
        } else if let Some(h) = hunks.last_mut() {
            if line.starts_with('+') {
                h.added += 1;
            } else if line.starts_with('-') {
                h.removed += 1;
            }
            h.lines.push(line.to_string());
        } else {
            if line.starts_with("Binary files ") || line == "GIT binary patch" {
                binary = true;
            }
            header.push_str(line);
            header.push('\n');
        }
    }
    for h in &mut hunks {
        h.id = fnv(&format!("{}\n{}", h.header, h.lines.join("\n")));
    }
    (header, hunks, binary)
}

fn diff_of(root: &Path, path: &str, staged: bool) -> Result<String, String> {
    let p = gitx::check_path(path)?;
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", p]);
    git(root, &args)
}

/// The hunks of one file: the working tree's (not staged yet) or the index's (staged).
pub fn hunks(root: &Path, path: &str, staged: bool) -> Result<FileHunks, String> {
    let (_, hunks, binary) = parse_hunks(&diff_of(root, path, staged)?);
    Ok(FileHunks {
        path: path.to_string(),
        staged,
        binary,
        hunks,
    })
}

fn apply_cached(root: &Path, patch: &str, reverse: bool) -> Result<(), String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(root)
        .args(["apply", "--cached", "--whitespace=nowarn"]);
    if reverse {
        cmd.arg("--reverse");
    }
    cmd.arg("-");
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("LC_ALL", "C");
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start git: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(patch.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Stages (or, with `unstage`, takes back out of the index) the hunks `ids` of `path`: a patch of
/// just those hunks, with the file's own header, through `git apply --cached [--reverse]`. The ids
/// come from [`hunks`]; one that no longer exists (the file changed) refuses the whole call.
/// Returns the file's hunks on the side they came from, after the change.
pub fn stage_hunks(
    root: &Path,
    path: &str,
    ids: &[String],
    unstage: bool,
) -> Result<FileHunks, String> {
    if ids.is_empty() {
        return Err("no hunk chosen".into());
    }
    let (header, all, binary) = parse_hunks(&diff_of(root, path, unstage)?);
    if binary {
        return Err(format!("{path} is binary: stage the whole file"));
    }
    let chosen: Vec<&Hunk> = all.iter().filter(|h| ids.contains(&h.id)).collect();
    if chosen.len() != ids.len() {
        return Err("the file changed since the hunks were read: read them again".into());
    }
    let mut patch = header;
    for h in chosen {
        patch.push_str(&h.header);
        patch.push('\n');
        for l in &h.lines {
            patch.push_str(l);
            patch.push('\n');
        }
    }
    apply_cached(root, &patch, unstage)?;
    hunks(root, path, unstage)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn g(d: &Path, a: &[&str]) {
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
    }
    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        g(d.path(), &["init", "-q", "-b", "main"]);
        g(d.path(), &["config", "user.name", "Ana"]);
        g(d.path(), &["config", "user.email", "ana@example.com"]);
        g(d.path(), &["config", "commit.gpgsign", "false"]);
        g(d.path(), &["config", "tag.gpgsign", "false"]);
        d
    }
    fn commit(d: &Path, file: &str, text: &str, msg: &str) {
        std::fs::write(d.join(file), text).unwrap();
        g(d, &["add", file]);
        g(d, &["commit", "-q", "-m", msg]);
    }

    #[test]
    fn the_parsers_read_git_machine_output() {
        assert_eq!(parse_track("[ahead 2, behind 1]"), (2, 1, false));
        assert_eq!(parse_track("ahead 3"), (3, 0, false));
        assert_eq!(parse_track("[gone]"), (0, 0, true));
        assert_eq!(parse_track(""), (0, 0, false));
        let b = parse_branches(
            "main\0abc1234\0origin/main\0[behind 2]\0*\nfeature/x\0def5678\0\0\0 \n",
        );
        assert_eq!(b[0].upstream.as_deref(), Some("origin/main"));
        assert_eq!(
            (
                b[0].behind,
                b[0].current,
                b[1].current,
                b[1].upstream.is_none()
            ),
            (2, true, false, true)
        );
        let r = parse_remote_branches(
            "origin/HEAD\0abc\norigin/main\0abc\nup/stream/feat\0def\n",
            &["origin".into(), "up/stream".into()],
        );
        assert_eq!(
            r.iter()
                .map(|x| format!("{}:{}", x.remote, x.name))
                .collect::<Vec<_>>(),
            vec!["origin:main", "up/stream:feat"]
        );
        let t = parse_tags("v1.0\0aaa\0bbb\nlight\0ccc\0\n");
        assert_eq!(
            (t[0].sha.as_str(), t[0].annotated, t[1].sha.as_str()),
            ("bbb", true, "ccc")
        );
        let c = parse_shortlog("    12\tAna Lima <ana@x.ao>\n     3\tBot\n");
        assert_eq!(
            (
                c[0].name.as_str(),
                c[0].email.as_str(),
                c[0].commits,
                c[1].email.as_str()
            ),
            ("Ana Lima", "ana@x.ao", 12, "")
        );
    }

    #[test]
    fn refs_reads_a_real_repository_with_a_remote() {
        let origin = repo();
        commit(origin.path(), "a.txt", "a\n", "feat: a");
        let d = tempfile::tempdir().unwrap();
        g(
            d.path(),
            &["clone", "-q", &origin.path().display().to_string(), "w"],
        );
        let w = d.path().join("w");
        g(&w, &["config", "user.name", "Rui"]);
        g(&w, &["config", "user.email", "rui@example.com"]);
        g(&w, &["config", "commit.gpgsign", "false"]);
        g(&w, &["config", "tag.gpgsign", "false"]);
        commit(&w, "b.txt", "b\n", "feat: b");
        g(&w, &["tag", "-a", "v0.1", "-m", "first"]);
        g(&w, &["branch", "feature/x"]);
        std::fs::write(w.join("a.txt"), "changed\n").unwrap();
        g(&w, &["stash", "push", "-q", "-m", "wip"]);
        let r = refs(&w).unwrap();
        assert_eq!(r.head.as_deref(), Some("main"));
        let main = r.branches.iter().find(|b| b.name == "main").unwrap();
        assert_eq!(
            (
                main.upstream.as_deref(),
                main.ahead,
                main.behind,
                main.current
            ),
            (Some("origin/main"), 1, 0, true)
        );
        assert!(r
            .branches
            .iter()
            .any(|b| b.name == "feature/x" && !b.current));
        assert_eq!(r.remotes, vec!["origin"]);
        assert_eq!(
            r.remote_branches
                .iter()
                .map(|b| b.name.as_str())
                .collect::<Vec<_>>(),
            vec!["main"]
        );
        assert_eq!(r.tags[0].name, "v0.1");
        assert!(r.tags[0].annotated);
        assert_eq!(Some(r.tags[0].sha.clone()), r.head_sha);
        assert_eq!(r.stashes.len(), 1);
        assert_eq!(r.worktrees.len(), 1);
        let names: Vec<&str> = r.contributors.iter().map(|c| c.name.as_str()).collect();
        assert!(
            names.contains(&"Ana") && names.contains(&"Rui"),
            "{names:?}"
        );
    }

    #[test]
    fn staging_one_hunk_leaves_the_other_and_unstaging_takes_it_back() {
        let d = repo();
        let body: String = (1..=30).map(|i| format!("line {i}\n")).collect();
        commit(d.path(), "f.txt", &body, "feat: f");
        let changed = body
            .replace("line 2\n", "line two\n")
            .replace("line 28\n", "line twenty-eight\n");
        std::fs::write(d.path().join("f.txt"), &changed).unwrap();
        let un = hunks(d.path(), "f.txt", false).unwrap();
        assert_eq!(un.hunks.len(), 2);
        assert_eq!((un.hunks[0].added, un.hunks[0].removed), (1, 1));
        let first = un.hunks[0].id.clone();
        assert_eq!(
            hunks(d.path(), "f.txt", false).unwrap().hunks[0].id,
            first,
            "the id is stable"
        );
        let left = stage_hunks(d.path(), "f.txt", std::slice::from_ref(&first), false).unwrap();
        assert_eq!(left.hunks.len(), 1);
        assert!(left.hunks[0]
            .lines
            .iter()
            .any(|l| l == "+line twenty-eight"));
        let st = hunks(d.path(), "f.txt", true).unwrap();
        assert_eq!(st.hunks.len(), 1);
        assert!(st.hunks[0].lines.iter().any(|l| l == "+line two"));
        g(d.path(), &["commit", "-q", "-m", "fix: only line two"]);
        let committed = git(d.path(), &["show", "HEAD:f.txt"]).unwrap();
        assert!(
            committed.contains("line two\n") && committed.contains("line 28\n"),
            "only the staged hunk is committed"
        );
        // the other hunk: stage it, then take it back out
        let id = hunks(d.path(), "f.txt", false).unwrap().hunks[0].id.clone();
        stage_hunks(d.path(), "f.txt", std::slice::from_ref(&id), false).unwrap();
        let sid = hunks(d.path(), "f.txt", true).unwrap().hunks[0].id.clone();
        let back = stage_hunks(d.path(), "f.txt", &[sid], true).unwrap();
        assert!(back.hunks.is_empty());
        assert_eq!(hunks(d.path(), "f.txt", false).unwrap().hunks.len(), 1);
        assert!(stage_hunks(d.path(), "f.txt", &["nope".into()], false)
            .unwrap_err()
            .contains("changed"));
        assert!(stage_hunks(d.path(), "-x", &[id], false).is_err());
    }

    #[test]
    fn parse_hunks_keeps_the_header_and_no_newline_markers() {
        let (h, hs, bin) = parse_hunks("diff --git a/x b/x\nindex 1..2 100644\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n");
        assert!(h.starts_with("diff --git") && h.ends_with("+++ b/x\n"));
        assert_eq!(
            (
                hs.len(),
                hs[0].old_start,
                hs[0].old_lines,
                hs[0].lines.len(),
                bin
            ),
            (1, 1, 1, 3, false)
        );
        assert!(parse_hunks("diff --git a/i b/i\nBinary files a/i and b/i differ\n").2);
    }

    #[test]
    fn refs_of_an_empty_repository_has_no_head() {
        let d = repo();
        let r = refs(d.path()).unwrap();
        assert_eq!((r.head, r.head_sha), (None, None));
        assert!(r.branches.is_empty() && r.contributors.is_empty());
    }
}
