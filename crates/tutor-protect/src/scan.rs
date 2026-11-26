//! The secret scan before a commit (r23 F4a, X03). Every place the app commits asks
//! [`guard_commit`] first: the lines the commit would add are checked against the secret rules
//! (and the values learned from `.env` files), and some files never belong in a repository
//! (`.env`, Terraform state, private keys). The built-in rules always run; gitleaks, when it is
//! installed, adds its rules to a staged scan — the report says which. A blocked commit can go ahead only with a reason
//! ([`allow_once`]: one commit, in that folder, within two minutes), which the caller audits.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::redact::{current, Redactor, MASK};

/// Prefix of the error text a blocked commit returns; the JSON report follows it (the UI parses it).
pub const BLOCKED: &str = "SECRET_SCAN_BLOCKED:";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub file: String,
    /// 0 for a whole file (a forbidden file)
    pub line: u32,
    pub rule: String,
    /// the line with its secrets masked
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    /// `gitleaks + built-in` or `built-in`
    pub tool: String,
    pub files: usize,
    pub findings: Vec<Finding>,
}

/// What a commit would take.
#[derive(Debug, Clone)]
pub enum Scope<'a> {
    /// the index (`git commit`)
    Staged,
    /// the index plus the tracked files' changes (`git commit -a`)
    Tracked,
    /// these paths as they are in the working tree (`git commit --only -- paths`, a lane)
    Paths(&'a [String]),
    /// everything that changed, tracked or new (an agent's `git add … && git commit`)
    WorkingTree,
}

/// A file that never belongs in a repository, and why.
pub fn forbidden(path: &str) -> Option<&'static str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let lower = name.to_ascii_lowercase();
    let example = [".example", ".sample", ".template", ".dist"]
        .iter()
        .any(|s| lower.ends_with(s));
    if (lower == ".env" || lower.starts_with(".env.")) && !example {
        return Some("env-file");
    }
    if lower.ends_with(".tfstate") || lower.ends_with(".tfstate.backup") {
        return Some("terraform-state");
    }
    if [".pem", ".key", ".p12", ".pfx"]
        .iter()
        .any(|s| lower.ends_with(s))
        || lower == "id_rsa"
        || lower == "id_ed25519"
        || lower == "id_ecdsa"
    {
        return Some("private-key-file");
    }
    None
}

/// The findings in the lines a unified diff adds (`git diff -U0`).
pub fn scan_diff(diff: &str, r: &Redactor) -> Vec<Finding> {
    let mut out = vec![];
    let (mut file, mut line) = (String::new(), 0u32);
    for l in diff.lines() {
        if let Some(f) = l.strip_prefix("+++ ") {
            file = f.strip_prefix("b/").unwrap_or(f).to_string();
            continue;
        }
        if let Some(h) = l.strip_prefix("@@ ") {
            // @@ -a,b +c,d @@
            line = h
                .split_whitespace()
                .find(|p| p.starts_with('+'))
                .and_then(|p| p[1..].split(',').next())
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
            continue;
        }
        if l.starts_with('+') && !l.starts_with("+++") {
            let text = &l[1..];
            for rule in r.rules_in(text) {
                out.push(Finding {
                    file: file.clone(),
                    line,
                    rule: rule.into(),
                    preview: preview(r, text),
                });
            }
            line += 1;
        }
    }
    out
}

/// A whole new file's findings (an untracked file has no diff).
pub fn scan_text(file: &str, text: &str, r: &Redactor) -> Vec<Finding> {
    text.lines()
        .enumerate()
        .flat_map(|(i, l)| {
            r.rules_in(l).into_iter().map(move |rule| Finding {
                file: file.to_string(),
                line: i as u32 + 1,
                rule: rule.into(),
                preview: preview(r, l),
            })
        })
        .collect()
}

fn preview(r: &Redactor, line: &str) -> String {
    let m = r.mask(line.trim());
    let m = if m.contains(MASK) {
        m
    } else {
        MASK.to_string()
    };
    m.chars().take(160).collect()
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
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&o.stdout).into_owned())
}

fn to_str(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

fn on_path(tool: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(tool).is_file()))
        .unwrap_or(false)
}

/// The scan of what a commit would take.
pub fn scan(root: &Path, scope: &Scope) -> Result<ScanReport, String> {
    let r = current();
    let has_head = git(root, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok();
    let base = if has_head {
        "HEAD"
    } else {
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    }; // the empty tree
    let paths: Vec<String> = match scope {
        Scope::Paths(p) => p.to_vec(),
        _ => vec![],
    };
    let mut diff_args: Vec<String> = vec![
        "diff".into(),
        "-U0".into(),
        "--no-color".into(),
        "--no-ext-diff".into(),
        "--diff-filter=ACMR".into(),
    ];
    match scope {
        Scope::Staged => diff_args.push("--cached".into()),
        Scope::Tracked | Scope::WorkingTree | Scope::Paths(_) => diff_args.push(base.into()),
    }
    if !paths.is_empty() {
        diff_args.push("--".into());
        diff_args.extend(paths.iter().cloned());
    }
    let mut names_args = diff_args.clone();
    names_args.retain(|a| a != "-U0" && a != "--no-color" && a != "--no-ext-diff");
    names_args.insert(1, "--name-only".into());
    let mut files: Vec<String> = git(root, &to_str(&names_args))?
        .lines()
        .map(str::to_string)
        .filter(|l| !l.is_empty())
        .collect();
    let diff = git(root, &to_str(&diff_args))?;
    // new files the commit takes that git does not track yet
    let untracked: Vec<String> = match scope {
        Scope::WorkingTree | Scope::Paths(_) => {
            let mut a = vec!["ls-files", "--others", "--exclude-standard", "--"];
            a.extend(paths.iter().map(String::as_str));
            git(root, &a)?
                .lines()
                .map(str::to_string)
                .filter(|l| !l.is_empty())
                .collect()
        }
        _ => vec![],
    };
    let mut findings = vec![];
    for f in files.iter().chain(untracked.iter()) {
        if let Some(why) = forbidden(f) {
            findings.push(Finding {
                file: f.clone(),
                line: 0,
                rule: why.into(),
                preview: String::new(),
            });
        }
    }
    let tool;
    if on_path("gitleaks") && matches!(scope, Scope::Staged) {
        // gitleaks adds its rules; it does not replace ours (measured: it has no rule for a URL with a
        // password, `postgres://u:p@h`, nor the values learned from `.env` files). A line both flag
        // is reported once, with gitleaks' rule.
        tool = "gitleaks + built-in".to_string();
        let leaks = gitleaks_staged(root)?;
        let seen: std::collections::HashSet<(String, u32)> =
            leaks.iter().map(|f| (f.file.clone(), f.line)).collect();
        findings.extend(leaks);
        findings.extend(
            scan_diff(&diff, &r)
                .into_iter()
                .filter(|f| !seen.contains(&(f.file.clone(), f.line))),
        );
    } else {
        tool = "built-in".to_string();
        findings.extend(scan_diff(&diff, &r));
        for f in &untracked {
            if let Ok(text) = std::fs::read_to_string(root.join(f)) {
                findings.extend(scan_text(f, &text, &r));
            }
        }
    }
    files.extend(untracked);
    Ok(ScanReport {
        tool,
        files: files.len(),
        findings,
    })
}

fn gitleaks_staged(root: &Path) -> Result<Vec<Finding>, String> {
    let report = std::env::temp_dir().join(format!("dxtutor-gitleaks-{}.json", std::process::id()));
    let o = Command::new("gitleaks")
        .args([
            "protect",
            "--staged",
            "--no-banner",
            "--exit-code",
            "0",
            "--report-format",
            "json",
            "--report-path",
        ])
        .arg(&report)
        .current_dir(root)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("gitleaks: {e}"))?;
    let text = std::fs::read_to_string(&report).unwrap_or_default();
    let _ = std::fs::remove_file(&report);
    if !o.status.success() && text.is_empty() {
        return Err(format!(
            "gitleaks failed: {}",
            String::from_utf8_lossy(&o.stderr).trim()
        ));
    }
    let v: serde_json::Value =
        serde_json::from_str(if text.trim().is_empty() { "[]" } else { &text })
            .map_err(|e| format!("gitleaks report: {e}"))?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        .map(|f| Finding {
            file: f["File"].as_str().unwrap_or("").to_string(),
            line: f["StartLine"].as_u64().unwrap_or(0) as u32,
            rule: f["RuleID"].as_str().unwrap_or("gitleaks").to_string(),
            preview: MASK.to_string(),
        })
        .collect())
}

/* ───── the override: one commit, one folder, two minutes, with a reason ───── */

fn allowances() -> &'static Mutex<HashMap<PathBuf, (Instant, String)>> {
    static A: OnceLock<Mutex<HashMap<PathBuf, (Instant, String)>>> = OnceLock::new();
    A.get_or_init(Mutex::default)
}

fn key(root: &Path) -> PathBuf {
    std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
}

/// Lets the next commit in `root` go ahead despite the findings (the caller audits the reason).
pub fn allow_once(root: &Path, reason: &str) -> Result<(), String> {
    if reason.trim().is_empty() {
        return Err("a reason is required to commit despite the secret scan".into());
    }
    allowances()
        .lock()
        .map_err(|_| "scan lock")?
        .insert(key(root), (Instant::now(), reason.trim().to_string()));
    Ok(())
}

fn take_allowance(root: &Path) -> Option<String> {
    let mut a = allowances().lock().ok()?;
    let (at, why) = a.remove(&key(root))?;
    (at.elapsed() < Duration::from_secs(120)).then_some(why)
}

/// Before a commit: `Ok(None)` clean, `Ok(Some(reason))` allowed despite findings (the override
/// was used), `Err(text)` blocked — the text starts with [`BLOCKED`] and carries the JSON report.
pub fn guard_commit(root: &Path, scope: &Scope) -> Result<Option<String>, String> {
    let report = scan(root, scope)?;
    if report.findings.is_empty() {
        return Ok(None);
    }
    if let Some(why) = take_allowance(root) {
        return Ok(Some(why));
    }
    Err(format!(
        "{BLOCKED}{}",
        serde_json::to_string(&report).unwrap_or_default()
    ))
}

/// A blocked commit's error as a line a person (or an agent) reads: the findings, never the
/// secrets. Other errors come back as they are.
pub fn summary(err: &str) -> String {
    let Some(json) = err.strip_prefix(BLOCKED) else {
        return err.to_string();
    };
    let Ok(r) = serde_json::from_str::<serde_json::Value>(json) else {
        return "the secret scan blocked the commit".into();
    };
    let items: Vec<String> = r["findings"]
        .as_array()
        .into_iter()
        .flatten()
        .take(8)
        .map(|f| {
            let line = f["line"].as_u64().unwrap_or(0);
            format!(
                "{}{} ({})",
                f["file"].as_str().unwrap_or("?"),
                if line > 0 {
                    format!(":{line}")
                } else {
                    String::new()
                },
                f["rule"].as_str().unwrap_or("?")
            )
        })
        .collect();
    format!(
        "the secret scan ({}) blocked the commit: {}",
        r["tool"].as_str().unwrap_or("built-in"),
        items.join(", ")
    )
}

/// Is this command line a `git commit` (the app's `exec git …`, an agent's shell command)? Skips
/// git's global options (`-C dir`, `-c k=v`, `--git-dir=…`).
pub fn is_git_commit(args: &[String]) -> bool {
    let mut i = 0;
    while i < args.len() {
        let a = args[i].as_str();
        if a == "-C" || a == "-c" || a == "--git-dir" || a == "--work-tree" || a == "--namespace" {
            i += 2;
            continue;
        }
        if a.starts_with('-') {
            i += 1;
            continue;
        }
        return a == "commit";
    }
    false
}

/// The scope of a `git commit` from its arguments (`-a`/`--all` take the tracked changes).
pub fn commit_scope(args: &[String]) -> Scope<'static> {
    let short_with_a = |a: &str| {
        a.starts_with('-')
            && !a.starts_with("--")
            && a.len() > 1
            && a[1..].chars().all(|c| c.is_ascii_alphabetic())
            && a[1..].contains('a')
    };
    if args.iter().any(|a| a == "--all" || short_with_a(a)) {
        Scope::Tracked
    } else {
        Scope::Staged
    }
}

/// Does a shell command line contain a `git commit` (an agent's `git add … && git commit -m …`)?
pub fn shell_commits(command: &str) -> bool {
    command.split(['&', ';', '|', '\n']).any(|part| {
        let words: Vec<String> = part.split_whitespace().map(str::to_string).collect();
        words
            .iter()
            .position(|w| w == "git" || w.ends_with("/git"))
            .map(|i| is_git_commit(&words[i + 1..]))
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let g = |a: &[&str]| {
            assert!(
                Command::new("git")
                    .arg("-C")
                    .arg(d.path())
                    .args(a)
                    .output()
                    .unwrap()
                    .status
                    .success(),
                "{a:?}"
            )
        };
        g(&["init", "-q"]);
        g(&["config", "user.email", "t@x"]);
        g(&["config", "user.name", "t"]);
        std::fs::write(d.path().join("app.rs"), "fn main() {}\n").unwrap();
        g(&["add", "."]);
        g(&["commit", "-qm", "init"]);
        d
    }

    #[test]
    fn rules_files_and_command_lines() {
        assert_eq!(forbidden("deploy/.env"), Some("env-file"));
        assert_eq!(forbidden(".env.example"), None);
        assert_eq!(
            forbidden("infra/terraform.tfstate"),
            Some("terraform-state")
        );
        assert_eq!(forbidden("certs/server.key"), Some("private-key-file"));
        assert_eq!(forbidden("src/main.rs"), None);
        let a = |s: &str| s.split_whitespace().map(String::from).collect::<Vec<_>>();
        assert!(is_git_commit(&a("commit -m x")));
        assert!(is_git_commit(&a("-C /w -c user.name=x commit --amend")));
        assert!(!is_git_commit(&a("commit-tree abc")));
        assert!(!is_git_commit(&a("log --grep commit")));
        assert!(matches!(commit_scope(&a("commit -am x")), Scope::Tracked));
        assert!(matches!(commit_scope(&a("commit -m x")), Scope::Staged));
        assert!(shell_commits("git add -A && git commit -m 'feat: x'"));
        assert!(!shell_commits("git log --oneline | grep commit"));
        let d = "diff --git a/c.rs b/c.rs\n+++ b/c.rs\n@@ -0,0 +3,2 @@\n+let url = \"postgres://u:p@h/db\";\n+let ok = 1;\n";
        let f = scan_diff(d, &Redactor::new());
        assert_eq!(
            f,
            vec![Finding {
                file: "c.rs".into(),
                line: 3,
                rule: "url-credentials".into(),
                preview: "let url = \"postgres://u:••••@h/db\";".into()
            }]
        );
    }

    /// r23 F4 acceptance: a commit containing `postgres://u:p@h` is blocked; a reason lets one through.
    #[test]
    fn a_commit_with_a_secret_is_blocked() {
        let d = repo();
        let root = d.path();
        std::fs::write(
            root.join("db.rs"),
            "const URL: &str = \"postgres://u:p@h/app\";\n",
        )
        .unwrap();
        assert!(Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["add", "db.rs"])
            .status()
            .unwrap()
            .success());
        let e = guard_commit(root, &Scope::Staged).unwrap_err();
        assert!(e.starts_with(BLOCKED), "{e}");
        let report: serde_json::Value = serde_json::from_str(&e[BLOCKED.len()..]).unwrap();
        assert_eq!(report["findings"][0]["file"], "db.rs");
        assert_eq!(report["findings"][0]["line"], 1);
        assert!(
            !e.contains("u:p@"),
            "the report never carries the secret: {e}"
        );
        assert!(allow_once(root, " ").is_err());
        allow_once(root, "test fixture, not a real database").unwrap();
        assert_eq!(
            guard_commit(root, &Scope::Staged).unwrap().as_deref(),
            Some("test fixture, not a real database")
        );
        // the override is used once
        assert!(guard_commit(root, &Scope::Staged).is_err());
        // a clean change passes; a .env never does; an untracked file counts in the working tree
        std::fs::write(root.join("db.rs"), "const URL: &str = env!(\"DB_URL\");\n").unwrap();
        assert!(Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["add", "db.rs"])
            .status()
            .unwrap()
            .success());
        assert_eq!(guard_commit(root, &Scope::Staged).unwrap(), None);
        std::fs::write(root.join(".env"), "PORT=1\n").unwrap();
        assert!(guard_commit(root, &Scope::Staged).is_ok());
        assert!(guard_commit(root, &Scope::WorkingTree)
            .unwrap_err()
            .contains("env-file"));
        assert!(guard_commit(root, &Scope::Paths(&["db.rs".into()])).is_ok());
    }

    /// Measured with gitleaks 8.30: it has no rule for a URL with a password. With gitleaks
    /// installed, our rules still run, and a line both flag is reported once.
    #[test]
    fn gitleaks_adds_to_our_rules() {
        if !on_path("gitleaks") {
            eprintln!("skipped: no gitleaks");
            return;
        }
        let d = repo();
        let root = d.path();
        std::fs::write(
            root.join("db.rs"),
            "const URL: &str = \"postgres://app:s3cr3tP4ss@db.internal:5432/app\";\nconst K: &str = \"AKIAQ3EGUPP4XMPLE7ZK\";\n",
        )
        .unwrap();
        assert!(Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["add", "db.rs"])
            .status()
            .unwrap()
            .success());
        let r = scan(root, &Scope::Staged).unwrap();
        assert_eq!(r.tool, "gitleaks + built-in");
        let at: Vec<(u32, &str)> = r
            .findings
            .iter()
            .map(|f| (f.line, f.rule.as_str()))
            .collect();
        assert!(at.contains(&(1, "url-credentials")), "{at:?}");
        assert!(at.iter().any(|(l, _)| *l == 2), "{at:?}");
        assert_eq!(at.iter().filter(|(l, _)| *l == 2).count(), 1, "{at:?}");
        assert!(r.findings.iter().all(|f| !f.preview.contains("s3cr3tP4ss")));
    }
}
