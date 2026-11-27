//! Problems: the real errors and warnings of the open workspace.
//!
//! VS Code fills its Problems view from language servers and task problem matchers. Here
//! the same information comes from the project's own checkers, run with machine-readable
//! output on the user's resolved environment ([`crate::shellenv`]):
//!
//! | project marker          | checker                                            |
//! |-------------------------|----------------------------------------------------|
//! | `Cargo.toml`            | `cargo check --workspace --all-targets --message-format=json` |
//! | `tsconfig.json`         | `tsc --noEmit -p tsconfig.json --pretty false`      |
//! | `go.mod`                | `go vet ./...`                                      |
//! | `pyproject.toml`/…      | `ruff check --output-format=json`                   |
//! | ESLint config           | `eslint -f json .`                                  |
//! | `*.tf` (r23 F4a)        | the built-in IaC rules (`tutor_eval::iacfind`): secrets in arguments and variables |
//!
//! Detection ([`plan`]) and every output parser are pure functions; [`run`] executes the
//! plan in parallel and reports each checker as it finishes. Tauri-free: the command in
//! `commands/panel.rs` adapts it.

use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

/// One diagnostic. `file` is relative to the workspace root, with `/` separators.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub end_line: u32,
    pub end_col: u32,
    /// "error" | "warning" | "info"
    pub severity: String,
    pub message: String,
    pub code: Option<String>,
    pub source: String,
}

/// Output format a checker speaks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    Cargo,
    Tsc,
    GoVet,
    Ruff,
    Eslint,
}

/// One checker to run: program + args in `cwd`.
#[derive(Clone, Debug, PartialEq)]
pub struct Check {
    pub source: &'static str,
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub format: Format,
}

impl Check {
    pub fn command_line(&self) -> String {
        std::iter::once(self.program.as_str())
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// What happened to one checker (shown in the Output "Problems" channel).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReport {
    pub source: String,
    pub command: String,
    pub cwd: String,
    pub exit_code: Option<i32>,
    pub millis: u64,
    pub count: usize,
    /// Set when the checker could not run or its output was not understood.
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub problems: Vec<Problem>,
    pub checks: Vec<CheckReport>,
    /// Markers found for which no checker is installed ("tsc not found", …).
    pub skipped: Vec<String>,
}

const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    ".git",
    "dist",
    "build",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
];

/// Directories under `root` (depth ≤ `depth`) that contain `marker`, skipping build and
/// dependency folders. Sorted, shallowest first.
fn marker_dirs(root: &Path, marker: &str, depth: usize) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, d)) = stack.pop() {
        if dir.join(marker).is_file() {
            out.push(dir.clone());
        }
        if d >= depth {
            continue;
        }
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if e.file_type().is_ok_and(|t| t.is_dir())
                    && !name.starts_with('.')
                    && !SKIP_DIRS.contains(&name.as_str())
                {
                    stack.push((e.path(), d + 1));
                }
            }
        }
    }
    out.sort_by_key(|p| (p.components().count(), p.clone()));
    out
}

/// Keep only directories not nested inside another one of the list (a Cargo workspace or
/// a Go module at the top covers the ones below it).
fn outermost(dirs: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    for d in dirs {
        if !out.iter().any(|o| d.starts_with(o)) {
            out.push(d);
        }
    }
    out
}

/// The nearest `node_modules/.bin/<bin>` from `dir` up to `root`.
fn local_bin(dir: &Path, root: &Path, bin: &str) -> Option<PathBuf> {
    let mut cur = Some(dir);
    while let Some(d) = cur {
        let c = d.join("node_modules").join(".bin").join(bin);
        if c.is_file() {
            return Some(c);
        }
        if d == root {
            break;
        }
        cur = d.parent();
    }
    None
}

/// Decide which checkers this workspace needs. `has` says whether a program is on the
/// user's PATH. Returns the checks and the human notes for markers without a checker.
pub fn plan(root: &Path, has: &dyn Fn(&str) -> bool) -> (Vec<Check>, Vec<String>) {
    let mut checks = Vec::new();
    let mut skipped = Vec::new();
    let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();

    let cargo = outermost(marker_dirs(root, "Cargo.toml", 2));
    if !cargo.is_empty() {
        if has("cargo") {
            for dir in cargo {
                checks.push(Check {
                    source: "rustc",
                    program: "cargo".into(),
                    args: s(&[
                        "check",
                        "--workspace",
                        "--all-targets",
                        "--message-format=json",
                    ]),
                    cwd: dir,
                    format: Format::Cargo,
                });
            }
        } else {
            skipped.push("Cargo.toml found but cargo is not on PATH".into());
        }
    }

    for dir in marker_dirs(root, "tsconfig.json", 2) {
        match local_bin(&dir, root, "tsc")
            .map(|p| p.to_string_lossy().into_owned())
            .or_else(|| has("tsc").then(|| "tsc".into()))
        {
            Some(tsc) => checks.push(Check {
                source: "ts",
                program: tsc,
                args: s(&["--noEmit", "-p", "tsconfig.json", "--pretty", "false"]),
                cwd: dir,
                format: Format::Tsc,
            }),
            None => skipped.push(format!(
                "{}: tsconfig.json found but tsc is not installed (npm i -D typescript)",
                rel(root, &dir.join("tsconfig.json"))
            )),
        }
    }

    let gomods = outermost(marker_dirs(root, "go.mod", 2));
    if !gomods.is_empty() {
        if has("go") {
            for dir in gomods {
                checks.push(Check {
                    source: "go vet",
                    program: "go".into(),
                    args: s(&["vet", "./..."]),
                    cwd: dir,
                    format: Format::GoVet,
                });
            }
        } else {
            skipped.push("go.mod found but go is not on PATH".into());
        }
    }

    let python = [
        "pyproject.toml",
        "requirements.txt",
        "setup.py",
        "setup.cfg",
    ]
    .iter()
    .any(|m| root.join(m).is_file());
    if python {
        if has("ruff") {
            checks.push(Check {
                source: "ruff",
                program: "ruff".into(),
                args: s(&["check", "--output-format=json", "--exit-zero", "."]),
                cwd: root.to_path_buf(),
                format: Format::Ruff,
            });
        } else {
            skipped
                .push("Python project found but ruff is not installed (pipx install ruff)".into());
        }
    }

    let eslint_cfg = [
        "eslint.config.js",
        "eslint.config.mjs",
        "eslint.config.cjs",
        "eslint.config.ts",
        ".eslintrc.js",
        ".eslintrc.cjs",
        ".eslintrc.json",
        ".eslintrc.yml",
        ".eslintrc",
    ]
    .iter()
    .any(|m| root.join(m).is_file());
    if eslint_cfg {
        if let Some(bin) = local_bin(root, root, "eslint") {
            checks.push(Check {
                source: "eslint",
                program: bin.to_string_lossy().into_owned(),
                args: eslint_args(
                    &std::fs::read_to_string(root.join("package.json")).unwrap_or_default(),
                ),
                cwd: root.to_path_buf(),
                format: Format::Eslint,
            });
        } else {
            skipped.push("ESLint config found but eslint is not installed in node_modules".into());
        }
    }
    (checks, skipped)
}

/// ESLint's arguments: the scope of the project's own `lint` script when it is a plain
/// `eslint …` invocation (so the Problems view lints what the project lints), else `.`;
/// always with JSON output. Pure.
pub fn eslint_args(package_json: &str) -> Vec<String> {
    let script = serde_json::from_str::<Value>(package_json)
        .ok()
        .and_then(|v| v["scripts"]["lint"].as_str().map(str::to_string))
        .unwrap_or_default();
    let plain = script
        .trim()
        .strip_prefix("eslint ")
        .filter(|rest| !rest.contains(['&', '|', ';', '>', '<', '$', '`', '"', '\'']));
    let mut args: Vec<String> = match plain {
        Some(rest) => rest
            .split_whitespace()
            .filter(|a| {
                !matches!(*a, "-f" | "--format" | "--fix" | "--cache")
                    && !a.starts_with("--format=")
                    && !a.starts_with("--max-warnings")
            })
            .map(str::to_string)
            .collect(),
        None => vec![],
    };
    if !args.iter().any(|a| !a.starts_with('-')) {
        args.push(".".into());
    }
    args.extend(["-f".into(), "json".into()]);
    args
}

/// `path` (absolute or relative to `cwd`) made relative to `root` with `/` separators, or
/// None when it lies outside the workspace (registry crates, node_modules typings, …).
fn to_rel(path: &str, cwd: &Path, root: &Path) -> Option<String> {
    let p = Path::new(path);
    let abs = if p.is_absolute() {
        p.to_path_buf()
    } else {
        cwd.join(p)
    };
    // Normalise `.`/`..` without touching the disk.
    let mut norm = PathBuf::new();
    for c in abs.components() {
        match c {
            Component::ParentDir => {
                norm.pop();
            }
            Component::CurDir => {}
            other => norm.push(other.as_os_str()),
        }
    }
    let r = norm.strip_prefix(root).ok()?;
    let s = r.to_string_lossy().replace('\\', "/");
    (!s.is_empty() && !s.starts_with("node_modules/") && !s.contains("/node_modules/")).then_some(s)
}

fn rel(root: &Path, p: &Path) -> String {
    to_rel(&p.to_string_lossy(), root, root).unwrap_or_else(|| p.to_string_lossy().into_owned())
}

/// `cargo check --message-format=json`: one JSON object per line; keep `compiler-message`
/// errors/warnings with a primary span inside the workspace. Duplicates (a lib and its
/// test target report the same warning) are dropped.
pub fn parse_cargo(stdout: &str, cwd: &Path, root: &Path) -> Vec<Problem> {
    let mut out: Vec<Problem> = Vec::new();
    for line in stdout.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if v["reason"] != "compiler-message" {
            continue;
        }
        let m = &v["message"];
        let severity = match m["level"].as_str().unwrap_or("") {
            "error" | "error: internal compiler error" => "error",
            "warning" => "warning",
            _ => continue,
        };
        let Some(span) = m["spans"]
            .as_array()
            .and_then(|s| s.iter().find(|x| x["is_primary"] == true))
        else {
            continue;
        };
        let Some(file) = span["file_name"]
            .as_str()
            .and_then(|f| to_rel(f, cwd, root))
        else {
            continue;
        };
        let num = |k: &str| span[k].as_u64().unwrap_or(1) as u32;
        let p = Problem {
            file,
            line: num("line_start"),
            col: num("column_start"),
            end_line: num("line_end"),
            end_col: num("column_end"),
            severity: severity.into(),
            message: m["message"].as_str().unwrap_or("").to_string(),
            code: m["code"]["code"].as_str().map(str::to_string),
            source: "rustc".into(),
        };
        if !out.iter().any(|o| {
            o.file == p.file && o.line == p.line && o.col == p.col && o.message == p.message
        }) {
            out.push(p);
        }
    }
    out
}

/// `tsc --pretty false`: `file(line,col): error TS1234: message`, continuation lines
/// indented below it.
pub fn parse_tsc(out: &str, cwd: &Path, root: &Path) -> Vec<Problem> {
    let mut res: Vec<Problem> = Vec::new();
    for line in out.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(last) = res.last_mut() {
                last.message.push('\n');
                last.message.push_str(line.trim_end());
            }
            continue;
        }
        let Some(open) = line.find('(') else { continue };
        let Some(close) = line[open..].find("): ").map(|i| i + open) else {
            continue;
        };
        let pos: Vec<u32> = line[open + 1..close]
            .split(',')
            .filter_map(|n| n.trim().parse().ok())
            .collect();
        if pos.len() != 2 {
            continue;
        }
        let rest = &line[close + 3..];
        let (sev, rest) = if let Some(r) = rest.strip_prefix("error ") {
            ("error", r)
        } else if let Some(r) = rest.strip_prefix("warning ") {
            ("warning", r)
        } else {
            continue;
        };
        let (code, msg) = rest.split_once(": ").unwrap_or(("", rest));
        let Some(file) = to_rel(&line[..open], cwd, root) else {
            continue;
        };
        res.push(Problem {
            file,
            line: pos[0],
            col: pos[1],
            end_line: pos[0],
            end_col: pos[1],
            severity: sev.into(),
            message: msg.to_string(),
            code: (!code.is_empty()).then(|| code.to_string()),
            source: "ts".into(),
        });
    }
    res
}

/// `go vet` / Go compiler: `path.go:line:col: message` (package headers start with `#`).
pub fn parse_go_vet(out: &str, cwd: &Path, root: &Path) -> Vec<Problem> {
    let mut res = Vec::new();
    for raw in out.lines() {
        let line = raw.trim_start_matches("vet: ");
        if line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(4, ':');
        let (Some(f), Some(l), Some(c), Some(msg)) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (Ok(l), Ok(c)) = (l.parse::<u32>(), c.parse::<u32>()) else {
            continue;
        };
        if !f.ends_with(".go") {
            continue;
        }
        let Some(file) = to_rel(f, cwd, root) else {
            continue;
        };
        res.push(Problem {
            file,
            line: l,
            col: c,
            end_line: l,
            end_col: c,
            severity: "warning".into(),
            message: msg.trim().to_string(),
            code: None,
            source: "go vet".into(),
        });
    }
    res
}

/// `ruff check --output-format=json`: an array of findings with absolute filenames.
pub fn parse_ruff(out: &str, cwd: &Path, root: &Path) -> Result<Vec<Problem>, String> {
    let v: Value =
        serde_json::from_str(out.trim()).map_err(|e| format!("unexpected ruff output: {e}"))?;
    Ok(v.as_array()
        .into_iter()
        .flatten()
        .filter_map(|f| {
            let file = to_rel(f["filename"].as_str()?, cwd, root)?;
            let n = |o: &Value, k: &str| o[k].as_u64().unwrap_or(1) as u32;
            let code = f["code"].as_str().map(str::to_string);
            let syntax = code.is_none() || code.as_deref().is_some_and(|c| c.starts_with("E9"));
            Some(Problem {
                file,
                line: n(&f["location"], "row"),
                col: n(&f["location"], "column"),
                end_line: n(&f["end_location"], "row"),
                end_col: n(&f["end_location"], "column"),
                severity: if syntax { "error" } else { "warning" }.into(),
                message: f["message"].as_str().unwrap_or("").to_string(),
                code,
                source: "ruff".into(),
            })
        })
        .collect())
}

/// `eslint -f json`: one entry per file, each with its messages (severity 2 = error).
pub fn parse_eslint(out: &str, root: &Path) -> Result<Vec<Problem>, String> {
    let v: Value =
        serde_json::from_str(out.trim()).map_err(|e| format!("unexpected eslint output: {e}"))?;
    let mut res = Vec::new();
    for f in v.as_array().into_iter().flatten() {
        let Some(file) = f["filePath"].as_str().and_then(|p| to_rel(p, root, root)) else {
            continue;
        };
        for m in f["messages"].as_array().into_iter().flatten() {
            let n = |k: &str, d: u64| m[k].as_u64().unwrap_or(d) as u32;
            let (line, col) = (n("line", 1), n("column", 1));
            res.push(Problem {
                file: file.clone(),
                line,
                col,
                end_line: n("endLine", line as u64),
                end_col: n("endColumn", col as u64),
                severity: if m["severity"].as_u64() == Some(2) {
                    "error"
                } else {
                    "warning"
                }
                .into(),
                message: m["message"].as_str().unwrap_or("").to_string(),
                code: m["ruleId"].as_str().map(str::to_string),
                source: "eslint".into(),
            });
        }
    }
    Ok(res)
}

/// Parse a finished checker's output.
pub fn parse(
    check: &Check,
    root: &Path,
    stdout: &str,
    stderr: &str,
) -> Result<Vec<Problem>, String> {
    match check.format {
        Format::Cargo => Ok(parse_cargo(stdout, &check.cwd, root)),
        Format::Tsc => Ok(parse_tsc(stdout, &check.cwd, root)),
        Format::GoVet => Ok(parse_go_vet(stderr, &check.cwd, root)),
        Format::Ruff => parse_ruff(stdout, &check.cwd, root),
        Format::Eslint => parse_eslint(stdout, root),
    }
}

const CHECK_TIMEOUT: Duration = Duration::from_secs(600);

/// Run one checker to completion (bounded), returning its problems and report.
fn run_one(check: &Check, root: &Path) -> (Vec<Problem>, CheckReport) {
    let started = Instant::now();
    let mut report = CheckReport {
        source: check.source.into(),
        command: check.command_line(),
        cwd: rel(root, &check.cwd),
        exit_code: None,
        millis: 0,
        count: 0,
        error: None,
    };
    let child = crate::shellenv::command(&check.program)
        .args(&check.args)
        .current_dir(&check.cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => {
            report.error = Some(format!("could not start {}: {e}", check.program));
            return (vec![], report);
        }
    };
    // Drain both pipes on threads so a chatty checker never blocks on a full pipe.
    let drain = |p: Option<Box<dyn std::io::Read + Send>>| {
        std::thread::spawn(move || {
            let mut s = Vec::new();
            if let Some(mut r) = p {
                let _ = r.read_to_end(&mut s);
            }
            String::from_utf8_lossy(&s).into_owned()
        })
    };
    let out_t = drain(
        child
            .stdout
            .take()
            .map(|r| Box::new(r) as Box<dyn std::io::Read + Send>),
    );
    let err_t = drain(
        child
            .stderr
            .take()
            .map(|r| Box::new(r) as Box<dyn std::io::Read + Send>),
    );
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if started.elapsed() < CHECK_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let stdout = out_t.join().unwrap_or_default();
    let stderr = err_t.join().unwrap_or_default();
    report.millis = started.elapsed().as_millis() as u64;
    report.exit_code = status.and_then(|s| s.code());
    if status.is_none() {
        report.error = Some(format!("timed out after {}s", CHECK_TIMEOUT.as_secs()));
        return (vec![], report);
    }
    match parse(check, root, &stdout, &stderr) {
        Ok(p) => {
            report.count = p.len();
            // A checker that failed without any parsable finding failed to RUN (bad config,
            // missing deps): surface its stderr instead of claiming "no problems".
            if p.is_empty()
                && report.exit_code.is_some_and(|c| c != 0)
                && check.format != Format::Ruff
            {
                let tail: String = stderr
                    .lines()
                    .rev()
                    .take(6)
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n");
                let tail = if tail.trim().is_empty() {
                    stdout
                        .lines()
                        .rev()
                        .take(6)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("\n")
                } else {
                    tail
                };
                report.error = Some(tail.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .or(Some(format!(
                        "exited with code {}",
                        report.exit_code.unwrap_or(-1)
                    )));
            }
            (p, report)
        }
        Err(e) => {
            report.error = Some(e);
            (vec![], report)
        }
    }
}

/// Run every checker of the workspace in parallel. `on_check` is called as each one
/// finishes (for live progress); the result has all problems sorted by file and line.
pub fn run(root: &Path, on_start: impl Fn(&Check), on_check: impl Fn(&CheckReport)) -> ScanResult {
    let (checks, skipped) = plan(root, &crate::shellenv::has);
    let (tx, rx) = mpsc::channel();
    for check in checks {
        on_start(&check);
        let tx = tx.clone();
        let root = root.to_path_buf();
        std::thread::spawn(move || {
            let _ = tx.send(run_one(&check, &root));
        });
    }
    drop(tx);
    let mut problems = Vec::new();
    let mut reports = Vec::new();
    for (p, r) in rx {
        on_check(&r);
        problems.extend(p);
        reports.push(r);
    }
    // r23 F4a (P03/C03): the IaC files' own findings (a secret in an argument is an error)
    if let Some((p, r)) = iac_findings(root) {
        on_check(&r);
        problems.extend(p);
        reports.push(r);
    }
    problems
        .sort_by(|a, b| (a.file.as_str(), a.line, a.col).cmp(&(b.file.as_str(), b.line, b.col)));
    ScanResult {
        problems,
        checks: reports,
        skipped,
    }
}

/// The built-in rules over the project's `.tf` files, as Problems (none without `.tf` files).
pub fn iac_findings(root: &Path) -> Option<(Vec<Problem>, CheckReport)> {
    let t0 = Instant::now();
    if tutor_eval::iacfind::tf_files(root).is_empty() {
        return None;
    }
    let found = tutor_eval::iacfind::scan_root(root);
    let problems: Vec<Problem> = found
        .into_iter()
        .map(|f| Problem {
            file: f.file,
            line: f.line,
            col: f.col,
            end_line: f.line,
            end_col: f.end_col,
            severity: f.severity,
            message: f.message,
            code: Some(f.rule),
            source: "dxtutor-iac".into(),
        })
        .collect();
    let report = CheckReport {
        source: "dxtutor-iac".into(),
        command: "built-in IaC rules (*.tf)".into(),
        cwd: root.display().to_string(),
        exit_code: Some(0),
        millis: t0.elapsed().as_millis() as u64,
        count: problems.len(),
        error: None,
    };
    Some((problems, report))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tf_files_bring_their_findings() {
        let d = tempfile::tempdir().unwrap();
        assert!(iac_findings(d.path()).is_none());
        std::fs::create_dir_all(d.path().join("infra")).unwrap();
        std::fs::write(
            d.path().join("infra/db.tf"),
            "resource \"aws_db_instance\" \"db\" {\n  password = var.x\n}\n",
        )
        .unwrap();
        let (p, r) = iac_findings(d.path()).unwrap();
        assert_eq!(r.count, 1);
        assert_eq!(
            (
                p[0].file.as_str(),
                p[0].line,
                p[0].severity.as_str(),
                p[0].code.as_deref()
            ),
            ("infra/db.tf", 2, "error", Some("secret-argument"))
        );
    }

    fn root() -> PathBuf {
        PathBuf::from("/w")
    }

    #[test]
    fn cargo_messages_become_problems_inside_the_workspace_only() {
        let lines = [
            r#"{"reason":"compiler-artifact","target":{}}"#,
            r#"{"reason":"compiler-message","message":{"level":"warning","message":"unused variable: `x`","code":{"code":"unused_variables"},"spans":[{"file_name":"src/lib.rs","line_start":3,"line_end":3,"column_start":9,"column_end":10,"is_primary":true}]}}"#,
            r#"{"reason":"compiler-message","message":{"level":"warning","message":"unused variable: `x`","code":{"code":"unused_variables"},"spans":[{"file_name":"src/lib.rs","line_start":3,"line_end":3,"column_start":9,"column_end":10,"is_primary":true}]}}"#,
            r#"{"reason":"compiler-message","message":{"level":"error","message":"mismatched types","code":{"code":"E0308"},"spans":[{"file_name":"/home/u/.cargo/registry/x.rs","line_start":1,"line_end":1,"column_start":1,"column_end":2,"is_primary":true}]}}"#,
            r#"{"reason":"compiler-message","message":{"level":"error","message":"aborting due to 1 previous error","code":null,"spans":[]}}"#,
        ]
        .join("\n");
        let p = parse_cargo(&lines, &root(), &root());
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].file, "src/lib.rs");
        assert_eq!((p[0].line, p[0].col, p[0].end_col), (3, 9, 10));
        assert_eq!(p[0].severity, "warning");
        assert_eq!(p[0].code.as_deref(), Some("unused_variables"));
    }

    #[test]
    fn tsc_lines_with_continuations() {
        let out = "src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\n  Details here.\nsrc/b.ts(1,1): warning TS6133: 'x' is declared but never used.\nrandom line\n";
        let p = parse_tsc(out, Path::new("/w/ui"), &root());
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].file, "ui/src/a.ts");
        assert_eq!((p[0].line, p[0].col), (12, 5));
        assert_eq!(p[0].code.as_deref(), Some("TS2322"));
        assert!(p[0].message.ends_with("Details here."));
        assert_eq!(p[1].severity, "warning");
    }

    #[test]
    fn go_vet_skips_headers_and_resolves_dot_paths() {
        let out = "# example.com/m\n./main.go:7:2: fmt.Printf format %d has arg s of wrong type string\nvet: ../other/x.go:1:1: outside\n";
        let p = parse_go_vet(out, Path::new("/w/svc"), &root());
        assert_eq!(p.len(), 2);
        assert_eq!(p[0].file, "svc/main.go");
        assert_eq!(p[1].file, "other/x.go");
    }

    #[test]
    fn ruff_and_eslint_json() {
        let ruff = r#"[{"filename":"/w/app/x.py","location":{"row":2,"column":1},"end_location":{"row":2,"column":7},"code":"F401","message":"`os` imported but unused"},{"filename":"/w/app/y.py","location":{"row":1,"column":5},"end_location":{"row":1,"column":6},"code":null,"message":"SyntaxError"}]"#;
        let p = parse_ruff(ruff, &root(), &root()).unwrap();
        assert_eq!(p[0].file, "app/x.py");
        assert_eq!(p[0].severity, "warning");
        assert_eq!(p[1].severity, "error");
        let es = r#"[{"filePath":"/w/src/a.ts","messages":[{"line":4,"column":2,"severity":2,"message":"no-undef","ruleId":"no-undef"}]},{"filePath":"/w/node_modules/z.js","messages":[{"line":1,"column":1,"severity":1,"message":"x"}]}]"#;
        let p = parse_eslint(es, &root()).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(
            (p[0].file.as_str(), p[0].severity.as_str(), p[0].end_line),
            ("src/a.ts", "error", 4)
        );
        assert!(parse_eslint("Oops", &root()).is_err());
    }

    #[test]
    fn eslint_follows_the_projects_lint_script() {
        assert_eq!(
            eslint_args(r#"{"scripts":{"lint":"eslint ui-app/src"}}"#),
            ["ui-app/src", "-f", "json"]
        );
        assert_eq!(
            eslint_args(r#"{"scripts":{"lint":"eslint --fix src --max-warnings=0"}}"#),
            ["src", "-f", "json"]
        );
        assert_eq!(
            eslint_args(r#"{"scripts":{"lint":"eslint src && tsc"}}"#),
            [".", "-f", "json"]
        );
        assert_eq!(
            eslint_args(r#"{"scripts":{"lint":"next lint"}}"#),
            [".", "-f", "json"]
        );
        assert_eq!(eslint_args("not json"), [".", "-f", "json"]);
    }

    #[test]
    fn plan_detects_projects_and_reports_missing_tools() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        std::fs::write(r.join("Cargo.toml"), "[workspace]").unwrap();
        std::fs::create_dir_all(r.join("crates/a")).unwrap();
        std::fs::write(r.join("crates/a/Cargo.toml"), "[package]").unwrap();
        std::fs::create_dir_all(r.join("ui")).unwrap();
        std::fs::write(r.join("ui/tsconfig.json"), "{}").unwrap();
        std::fs::create_dir_all(r.join("node_modules/.bin")).unwrap();
        std::fs::write(r.join("node_modules/.bin/tsc"), "").unwrap();
        std::fs::write(r.join("pyproject.toml"), "").unwrap();
        let (checks, skipped) = plan(r, &|p| p == "cargo");
        let sources: Vec<&str> = checks.iter().map(|c| c.source).collect();
        assert_eq!(
            sources,
            ["rustc", "ts"],
            "a nested crate is covered by the workspace"
        );
        assert_eq!(checks[1].cwd, r.join("ui"));
        assert!(checks[1].program.ends_with("node_modules/.bin/tsc"));
        assert_eq!(skipped.len(), 1);
        assert!(skipped[0].contains("ruff"));
    }
}

/// Prova manual contra este repositório (corre os checkers a sério, demora):
/// `cargo test -p dxtutor-ide --lib problems::smoke -- --ignored --nocapture`
#[cfg(test)]
mod smoke {
    #[test]
    #[ignore]
    fn scan_this_repo() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let r = super::run(
            root,
            |c| eprintln!("start {} in {}", c.command_line(), c.cwd.display()),
            |r| eprintln!("done  {r:?}"),
        );
        eprintln!("skipped: {:?}", r.skipped);
        for p in r.problems.iter().take(15) {
            eprintln!(
                "{} {}:{}:{} {} [{}]",
                p.severity, p.file, p.line, p.col, p.message, p.source
            );
        }
        eprintln!("total {}", r.problems.len());
        assert!(!r.checks.is_empty());
    }
}
