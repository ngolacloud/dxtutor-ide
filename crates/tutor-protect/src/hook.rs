//! The pre-commit hook (r23 hardening, docs/v2/NOTAS-r23.md): a commit made in a terminal, outside
//! the app, goes through the same secret scan as the app's commits — the hook runs
//! `dxt secret-scan --staged` (`crates/tutor-cli`), which uses [`crate::scan`] with the same rules.
//! Without `dxt` on the PATH the hook blocks the commit and says why (the scan cannot run).
//!
//! The rules here: the hook goes where git looks for hooks (`git rev-parse --git-path hooks`, so a
//! worktree or `core.hooksPath` is respected); a hook that is not ours is never overwritten; ours is
//! recognised by [`MARKER`]. Installing is the caller's to approve and audit.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

/// The line that marks a hook as ours.
pub const MARKER: &str = "# dxtutor: secret scan before each commit";

/// The hook's text. `sh`, so it runs wherever git runs hooks.
pub fn script() -> String {
    format!(
        r#"#!/bin/sh
{MARKER}
# Installed by dxtutor-ide (Protect: Install the Pre-commit Hook). It runs the same secret scan as the
# app's commits on what this commit takes. Remove this file to stop it.
if ! command -v dxt >/dev/null 2>&1; then
  echo "dxtutor pre-commit: dxt is not on the PATH, so the secret scan cannot run; the commit is blocked." >&2
  echo "Install it once from the dxtutor-ide repository: cargo install --path crates/tutor-cli" >&2
  exit 1
fi
exec dxt secret-scan --staged
"#
    )
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookPlan {
    /// where the hook goes (absolute)
    pub path: String,
    /// `missing` (nothing there), `installed` (ours) or `foreign` (another hook: never overwritten)
    pub state: String,
    /// what would be written
    pub content: String,
}

fn git(root: &Path, args: &[&str]) -> Result<String, String> {
    let o = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !o.status.success() {
        let err = String::from_utf8_lossy(&o.stderr).trim().to_string();
        return Err(if err.contains("not a git repository") {
            format!("{} is not a git repository", root.display())
        } else {
            format!("git {}: {err}", args.join(" "))
        });
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Where git looks for this repository's `pre-commit` hook.
pub fn hook_path(root: &Path) -> Result<PathBuf, String> {
    let dir = git(root, &["rev-parse", "--git-path", "hooks"])?;
    let dir = PathBuf::from(dir);
    // `--git-path` answers relative to the folder git ran in (`-C root`)
    let dir = if dir.is_absolute() {
        dir
    } else {
        root.join(dir)
    };
    Ok(dir.join("pre-commit"))
}

/// What installing would do in `root`.
pub fn plan(root: &Path) -> Result<HookPlan, String> {
    let path = hook_path(root)?;
    let state = match std::fs::read_to_string(&path) {
        Ok(text) if text.contains(MARKER) => "installed",
        Ok(_) => "foreign",
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
        // something is there that cannot be read as text: not ours
        Err(_) => "foreign",
    };
    Ok(HookPlan {
        path: path.to_string_lossy().into_owned(),
        state: state.into(),
        content: script(),
    })
}

/// Writes the hook (executable). Refuses when another hook is there; rewrites ours.
pub fn install(root: &Path) -> Result<HookPlan, String> {
    let p = plan(root)?;
    if p.state == "foreign" {
        return Err(format!(
            "{} already has a pre-commit hook that is not dxtutor's; it is kept. Add `dxt secret-scan --staged` to it by hand.",
            p.path
        ));
    }
    let path = PathBuf::from(&p.path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(&path, &p.content).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(HookPlan {
        state: "installed".into(),
        ..p
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let o = Command::new("git")
            .args(["init", "-q"])
            .current_dir(d.path())
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .output()
            .unwrap();
        assert!(o.status.success());
        d
    }

    #[test]
    fn installs_once_and_never_over_another_hook() {
        let d = repo();
        let p = plan(d.path()).unwrap();
        assert_eq!(p.state, "missing");
        assert!(p.path.ends_with(".git/hooks/pre-commit"), "{}", p.path);
        assert!(p.content.contains("exec dxt secret-scan --staged"));

        let done = install(d.path()).unwrap();
        assert_eq!(done.state, "installed");
        assert_eq!(plan(d.path()).unwrap().state, "installed");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&done.path).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "executable");
        }
        // ours again: rewritten, fine
        install(d.path()).unwrap();

        // someone else's hook: kept
        std::fs::write(&done.path, "#!/bin/sh\nnpx lint-staged\n").unwrap();
        assert_eq!(plan(d.path()).unwrap().state, "foreign");
        let e = install(d.path()).unwrap_err();
        assert!(e.contains("not dxtutor's"), "{e}");
        assert_eq!(
            std::fs::read_to_string(&done.path).unwrap(),
            "#!/bin/sh\nnpx lint-staged\n"
        );
    }

    #[test]
    fn not_a_repository() {
        let d = tempfile::tempdir().unwrap();
        let e = plan(d.path()).unwrap_err();
        assert!(e.contains("not a git repository"), "{e}");
    }
}
