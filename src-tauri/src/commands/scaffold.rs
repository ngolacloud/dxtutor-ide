//! «New Project»: a new project from one of the Delonix templates (`delonix init -t`), the rules of
//! `tutor_scaffold`. Three commands, all off the UI thread:
//! - `project_templates` — the catalog (languages, frameworks, servers and apps);
//! - `project_new_plan` — where the project goes and what will happen, for the approval dialog;
//!   nothing is written;
//! - `project_new` — writes it (in a folder that must be new or empty), produces the lock file when
//!   the package manager is installed, `git init` on `main` and the commit `chore: scaffold`; recorded
//!   in the audit log of the new project before and with the result.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::AppHandle;
use tutor_scaffold::{self as sc, GitOutcome, Rendered, Request, TemplateInfo};

use crate::board::{record_ide_audit, IdeAudit};

/// How long producing a lock file may take (it resolves dependencies over the network).
const LOCK_TIMEOUT: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectPlan {
    pub dir: String,
    pub template: String,
    pub version: String,
    pub files: usize,
    pub port: String,
    pub tls_port: Option<String>,
    /// What runs, in words: the approval dialog shows it and the audit log keeps it.
    pub command: String,
}

/// The lock file of the template's package manager.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LockOutcome {
    /// The template has none.
    None,
    Generated {
        file: String,
    },
    /// The package manager is not installed: run the command in the project.
    Missing {
        file: String,
        command: String,
    },
    Failed {
        file: String,
        command: String,
        detail: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub dir: String,
    pub template: String,
    pub version: String,
    pub files: usize,
    pub port: String,
    pub health: String,
    /// The template serves TLS: its certificate (`tls/`, git-ignored) is not generated here.
    pub tls_port: Option<String>,
    pub lock: LockOutcome,
    pub git: GitOutcome,
}

fn plan_of(
    parent: &str,
    name: &str,
    template: &str,
    version: Option<&str>,
) -> Result<(PathBuf, Rendered), String> {
    let dir = sc::target_dir(Path::new(parent.trim()), name.trim())?;
    // planning needs no secrets: they are drawn when the project is written
    let r = sc::render(&Request::new(template, name.trim(), version), &mut |n| {
        Ok(vec![0; n])
    })?;
    Ok((dir, r))
}

fn describe(dir: &Path, r: &Rendered) -> String {
    let lock = r
        .lock
        .as_deref()
        .and_then(|l| {
            sc::lock_command(l).map(|(bin, args)| format!(", `{bin} {}` for {l}", args.join(" ")))
        })
        .unwrap_or_default();
    format!(
        "create {} from the Delonix template {}{}: {} files{}, then git init (main) and commit «{}»",
        dir.display(),
        r.template,
        if r.version.is_empty() { String::new() } else { format!(" {}", r.version) },
        r.files.len() + usize::from(r.env.is_some()),
        lock,
        sc::SCAFFOLD_COMMIT
    )
}

/// The New Project catalog.
#[tauri::command]
pub async fn project_templates() -> Result<Vec<TemplateInfo>, String> {
    Ok(sc::catalog())
}

/// Where the project goes and what will happen; writes nothing. Refuses a name, a version or a
/// folder the project cannot use, with the reason.
#[tauri::command]
pub async fn project_new_plan(
    parent: String,
    name: String,
    template: String,
    version: Option<String>,
) -> Result<NewProjectPlan, String> {
    let (dir, r) = plan_of(&parent, &name, &template, version.as_deref())?;
    Ok(NewProjectPlan {
        command: describe(&dir, &r),
        dir: dir.display().to_string(),
        template: r.template.clone(),
        version: r.version.clone(),
        files: r.files.len() + usize::from(r.env.is_some()),
        port: r.port.clone(),
        tls_port: r.tls_port.clone(),
    })
}

/// Creates the project (after the person approved the plan in the UI).
#[tauri::command]
pub async fn project_new(
    app: AppHandle,
    parent: String,
    name: String,
    template: String,
    version: Option<String>,
) -> Result<NewProject, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (dir, plan) = plan_of(&parent, &name, &template, version.as_deref())?;
        let root = dir.display().to_string();
        let label = describe(&dir, &plan);
        let entry = |outcome: Option<&str>, reason: Option<String>| IdeAudit {
            feature: "project".into(),
            action: "new".into(),
            command: label.clone(),
            scope: Some(root.clone()),
            approved: true,
            reason,
            outcome: outcome.map(String::from),
            decided_at: None,
        };
        // an operation that cannot be recorded does not run
        record_ide_audit(&app, &root, &entry(None, None)).map_err(|e| e.message)?;
        let result = create(&dir, &name, &template, version.as_deref());
        let after = match &result {
            Ok(p) => entry(
                Some("ok"),
                Some(format!(
                    "{} files; git: {:?}; lock: {:?}",
                    p.files, p.git, p.lock
                )),
            ),
            Err(e) => entry(Some("failed"), Some(e.clone())),
        };
        let _ = record_ide_audit(&app, &root, &after);
        result
    })
    .await
    .map_err(|e| format!("new project task failed: {e}"))?
}

fn create(
    dir: &Path,
    name: &str,
    template: &str,
    version: Option<&str>,
) -> Result<NewProject, String> {
    let r = sc::render(
        &Request::new(template, name.trim(), version),
        &mut sc::os_random,
    )?;
    let files = sc::write(dir, &r)?;
    // the lock goes into the first commit, produced against the version just written (as Delonix)
    let lock = make_lock(dir, r.lock.as_deref());
    let git = sc::git_init(dir, &|| crate::shellenv::command("git"));
    Ok(NewProject {
        dir: dir.display().to_string(),
        template: r.template,
        version: r.version,
        files,
        port: r.port,
        health: r.health,
        tls_port: r.tls_port,
        lock,
        git,
    })
}

fn on_path(bin: &str) -> bool {
    crate::shellenv::get()
        .get("PATH")
        .is_some_and(|p| std::env::split_paths(p).any(|d| d.join(bin).is_file()))
}

fn make_lock(dir: &Path, lock: Option<&str>) -> LockOutcome {
    let Some(file) = lock else {
        return LockOutcome::None;
    };
    let Some((bin, args)) = sc::lock_command(file) else {
        return LockOutcome::None;
    };
    let command = format!("{bin} {}", args.join(" "));
    let file = file.to_string();
    if !on_path(bin) {
        return LockOutcome::Missing { file, command };
    }
    let log = std::env::temp_dir().join(format!(
        "dxtutor-lock-{}-{}.log",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let spawned = std::fs::File::create(&log).and_then(|err| {
        crate::shellenv::command(bin)
            .args(args)
            .current_dir(dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(err)
            .spawn()
    });
    let mut child = match spawned {
        Ok(c) => c,
        Err(e) => {
            let _ = std::fs::remove_file(&log);
            return LockOutcome::Failed {
                file,
                command,
                detail: e.to_string(),
            };
        }
    };
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if start.elapsed() < LOCK_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(200))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let stderr = std::fs::read_to_string(&log).unwrap_or_default();
    let _ = std::fs::remove_file(&log);
    match status {
        Some(s) if s.success() && dir.join(&file).exists() => LockOutcome::Generated { file },
        Some(_) => LockOutcome::Failed {
            file,
            command,
            detail: stderr
                .lines()
                .rev()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("")
                .trim()
                .chars()
                .take(300)
                .collect(),
        },
        None => LockOutcome::Failed {
            file,
            command,
            detail: format!("took more than {} s", LOCK_TIMEOUT.as_secs()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plan_says_where_and_what_and_refuses_what_cannot_be() {
        let parent = tempfile::tempdir().unwrap();
        let p = parent.path().display().to_string();
        let (dir, r) = plan_of(&p, "shop", "rust", None).unwrap();
        assert_eq!(dir, parent.path().join("shop"));
        let d = describe(&dir, &r);
        assert!(d.contains("from the Delonix template rust 1.90"), "{d}");
        assert!(
            d.contains("`cargo generate-lockfile` for Cargo.lock"),
            "{d}"
        );
        assert!(d.ends_with("commit «chore: scaffold»"), "{d}");
        assert!(plan_of(&p, "Shop", "rust", None).is_err());
        assert!(plan_of(&p, "shop", "rust", Some("2.0")).is_err());
        assert!(plan_of("relative", "shop", "rust", None).is_err());
        assert!(
            !parent.path().join("shop").exists(),
            "planning writes nothing"
        );
    }

    #[test]
    fn a_missing_package_manager_is_said_with_its_command() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(make_lock(d.path(), None), LockOutcome::None);
        assert_eq!(make_lock(d.path(), Some("yarn.lock")), LockOutcome::None);
        if !on_path("composer") {
            assert_eq!(
                make_lock(d.path(), Some("composer.lock")),
                LockOutcome::Missing {
                    file: "composer.lock".into(),
                    command: "composer update --no-install --no-interaction --no-progress".into()
                }
            );
        }
    }
}
