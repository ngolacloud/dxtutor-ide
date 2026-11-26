//! `dxt secret-scan` — the app's secret scan (`tutor_protect::scan`, same rules, gitleaks when it
//! is installed) on what a commit in this repository would take. The pre-commit hook the app
//! installs (`tutor_protect::hook`) runs `dxt secret-scan --staged`: a commit made in a terminal is
//! checked like the app's. Findings are printed masked, never the secret.
//!
//! Exit code: 0 clean, 1 findings (the commit is blocked), 2 the scan could not run.

use std::path::PathBuf;
use std::process::Command;

use tutor_protect::scan::{scan, Scope};

pub const HELP: &str = "\
dxt secret-scan — the secret scan before a commit (the same rules as the dxtutor-ide app)

  dxt secret-scan [--staged]   what `git commit` would take (the index) — what the hook runs
  dxt secret-scan --all        what `git commit -a` would take
  dxt secret-scan --working    every change, tracked or new

Runs in the git repository of the current folder. The secret values of the repository's `.env`
files are checked too. Exit code: 0 clean, 1 findings, 2 the scan could not run.";

pub fn run(args: &[String]) -> i32 {
    let mut scope = Scope::Staged;
    for a in args {
        match a.as_str() {
            "--staged" | "--cached" => scope = Scope::Staged,
            "--all" | "-a" => scope = Scope::Tracked,
            "--working" => scope = Scope::WorkingTree,
            "-h" | "--help" | "help" => {
                println!("{HELP}");
                return 0;
            }
            other => {
                eprintln!("dxt secret-scan: unknown option {other}\n\n{HELP}");
                return 2;
            }
        }
    }
    let root = match toplevel() {
        Ok(r) => r,
        Err(e) => {
            eprintln!("dxt secret-scan: {e}");
            return 2;
        }
    };
    tutor_protect::redact::learn_root(&root);
    let report = match scan(&root, &scope) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("dxt secret-scan: the scan could not run: {e}");
            return 2;
        }
    };
    if report.findings.is_empty() {
        eprintln!(
            "dxtutor secret scan ({}): {} file(s), no secrets.",
            report.tool, report.files
        );
        return 0;
    }
    eprintln!(
        "dxtutor secret scan ({}): {} problem(s) — the commit is blocked.",
        report.tool,
        report.findings.len()
    );
    for f in &report.findings {
        let at = if f.line > 0 {
            format!("{}:{}", f.file, f.line)
        } else {
            f.file.clone()
        };
        if f.preview.is_empty() {
            eprintln!("  {at}  ({})", f.rule);
        } else {
            eprintln!("  {at}  ({})  {}", f.rule, f.preview);
        }
    }
    eprintln!(
        "Remove the secret (an environment variable or the vault), stage the change and commit again."
    );
    1
}

fn toplevel() -> Result<PathBuf, String> {
    let o = Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !o.status.success() {
        return Err("not inside a git repository".into());
    }
    Ok(PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()))
}
