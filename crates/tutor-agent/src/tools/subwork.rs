//! H5f (docs/v2/AUDIT-harness.md §3, P2 item 9): the workspace of a sub-agent that writes (`task` with the role
//! `implementer`, toolset 17). It never touches the project: it works in a temporary git worktree made from a
//! SNAPSHOT of the project as it is now (HEAD plus the uncommitted changes and the new files git does not ignore —
//! built with a private index, so the person's index and stash never change), and what it changed comes back as a
//! patch saved under the repository's git dir (`dxtutor/patches/`, readable by the agent's sandbox). The worktree
//! is removed at the end. Keeping the changes is the parent's decision, through the normal approvals.

use std::path::{Path, PathBuf};
use std::process::Command;

fn git(dir: &Path, args: &[&str], index: Option<&Path>) -> Result<String, String> {
    let mut c = Command::new("git");
    c.arg("-C").arg(dir).args(args);
    // a commit of our own needs an identity, whatever the machine has configured
    c.env("GIT_AUTHOR_NAME", "dxtutor")
        .env("GIT_AUTHOR_EMAIL", "dxtutor@localhost")
        .env("GIT_COMMITTER_NAME", "dxtutor")
        .env("GIT_COMMITTER_EMAIL", "dxtutor@localhost");
    if let Some(i) = index {
        c.env("GIT_INDEX_FILE", i);
    }
    let o = c.output().map_err(|e| format!("git: {e}"))?;
    if !o.status.success() {
        return Err(format!(
            "git {}: {}",
            args.first().unwrap_or(&""),
            String::from_utf8_lossy(&o.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim_end().to_string())
}

/// A sub-agent's worktree: where it works and the commit its changes are measured against.
pub struct SubWork {
    pub dir: PathBuf,
    pub base: String,
    project: PathBuf,
}

/// What a sub-agent changed: the patch (empty: nothing), its summary (`git diff --stat`) and where it was saved.
pub struct Changes {
    pub patch: String,
    pub stat: String,
    pub saved: Option<PathBuf>,
}

impl SubWork {
    /// The snapshot of `project` and a detached worktree on it.
    pub fn start(project: &Path) -> Result<SubWork, String> {
        let head = git(project, &["rev-parse", "--verify", "HEAD"], None)
            .map_err(|_| "the implementer needs a git repository with a commit".to_string())?;
        let index = super::unique_temp("dxtutor-subagent-index", "idx");
        let snap = (|| {
            git(project, &["read-tree", &head], Some(&index))?;
            git(project, &["add", "-A"], Some(&index))?;
            let tree = git(project, &["write-tree"], Some(&index))?;
            git(
                project,
                &[
                    "commit-tree",
                    &tree,
                    "-p",
                    &head,
                    "-m",
                    "dxtutor: sub-agent snapshot",
                ],
                None,
            )
        })();
        let _ = std::fs::remove_file(&index);
        let base = snap?;
        let dir = super::unique_temp("dxtutor-subagent", "wt");
        git(
            project,
            &[
                "worktree",
                "add",
                "--detach",
                &dir.display().to_string(),
                &base,
            ],
            None,
        )?;
        Ok(SubWork {
            dir,
            base,
            project: project.to_path_buf(),
        })
    }

    /// What changed in the worktree since the snapshot (new files included), saved as a patch in the git dir.
    pub fn changes(&self, id: &str) -> Result<Changes, String> {
        git(&self.dir, &["add", "-A"], None)?;
        let patch = git(
            &self.dir,
            &["diff", "--cached", "--binary", &self.base],
            None,
        )?;
        if patch.trim().is_empty() {
            return Ok(Changes {
                patch,
                stat: String::new(),
                saved: None,
            });
        }
        let stat = git(&self.dir, &["diff", "--cached", "--stat", &self.base], None)?;
        let common = git(&self.project, &["rev-parse", "--git-common-dir"], None)?;
        let common = if Path::new(&common).is_absolute() {
            PathBuf::from(common)
        } else {
            self.project.join(common)
        };
        let dir = common.join("dxtutor").join("patches");
        std::fs::create_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let file = dir.join(format!("{id}.patch"));
        std::fs::write(&file, format!("{patch}\n"))
            .map_err(|e| format!("{}: {e}", file.display()))?;
        Ok(Changes {
            patch,
            stat,
            saved: Some(file),
        })
    }
}

impl Drop for SubWork {
    /// The worktree goes (its changes are in the patch); the snapshot commit is left to git's garbage collection.
    fn drop(&mut self) {
        let _ = git(
            &self.project,
            &[
                "worktree",
                "remove",
                "--force",
                &self.dir.display().to_string(),
            ],
            None,
        );
        let _ = std::fs::remove_dir_all(&self.dir);
        let _ = git(&self.project, &["worktree", "prune"], None);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_snapshot_with_the_uncommitted_changes_and_a_patch_of_what_changed() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        git(p, &["init", "-q", "--initial-branch=main"], None).unwrap();
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        git(p, &["add", "-A"], None).unwrap();
        git(p, &["commit", "-q", "-m", "first"], None).unwrap();
        // the person's work in progress: a change, a new file, an ignored file, something staged
        std::fs::write(p.join("a.txt"), "one\ntwo\n").unwrap();
        std::fs::write(p.join("new.txt"), "new\n").unwrap();
        std::fs::write(p.join(".gitignore"), "secret.env\n").unwrap();
        std::fs::write(p.join("secret.env"), "K=1\n").unwrap();
        let staged_before = git(p, &["diff", "--cached", "--name-only"], None).unwrap();
        let w = SubWork::start(p).unwrap();
        assert_eq!(
            std::fs::read_to_string(w.dir.join("a.txt")).unwrap(),
            "one\ntwo\n"
        );
        assert!(w.dir.join("new.txt").exists());
        assert!(!w.dir.join("secret.env").exists(), "ignored files stay out");
        // the person's index did not change
        assert_eq!(
            git(p, &["diff", "--cached", "--name-only"], None).unwrap(),
            staged_before
        );
        // the sub-agent's work
        std::fs::write(w.dir.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        std::fs::write(w.dir.join("b.txt"), "bee\n").unwrap();
        let c = w.changes("t1").unwrap();
        assert!(
            c.stat.contains("a.txt") && c.stat.contains("b.txt"),
            "{}",
            c.stat
        );
        let saved = c.saved.clone().unwrap();
        assert!(saved.starts_with(p.join(".git/dxtutor/patches")));
        let dir = w.dir.clone();
        drop(w);
        assert!(!dir.exists(), "the worktree is removed");
        assert!(!git(p, &["worktree", "list"], None)
            .unwrap()
            .contains("dxtutor-subagent"));
        // the project did not change; the patch applies on it
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "one\ntwo\n"
        );
        assert!(!p.join("b.txt").exists());
        git(p, &["apply", &saved.display().to_string()], None).unwrap();
        assert_eq!(
            std::fs::read_to_string(p.join("a.txt")).unwrap(),
            "one\ntwo\nthree\n"
        );
        assert_eq!(std::fs::read_to_string(p.join("b.txt")).unwrap(), "bee\n");
        // nothing changed: no patch
        let w = SubWork::start(p).unwrap();
        assert!(w.changes("t2").unwrap().saved.is_none());
        // no repository: said
        let e = tempfile::tempdir().unwrap();
        assert!(SubWork::start(e.path())
            .err()
            .unwrap()
            .contains("git repository"));
    }
}
