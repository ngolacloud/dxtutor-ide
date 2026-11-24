//! Test runs with per-test results (docs/v2/UI-AUDIT.md, item 3 — TEST-01/04/05).
//!
//! Detects the test runners a project really has and runs them asking for their structured
//! output, so every test comes back with its own status, duration and failure message:
//!
//! | runner  | how it runs                                   | what is read                       |
//! |---------|-----------------------------------------------|------------------------------------|
//! | cargo   | `cargo test --no-fail-fast`                   | libtest lines + failure sections   |
//! | go      | `go test -json ./...`                         | the JSON event stream              |
//! | pytest  | `python3 -m pytest --junitxml=<tmp>`          | JUnit XML                          |
//! | unittest| `python3 -m unittest discover -v`             | the verbose result lines           |
//! | vitest  | `node_modules/.bin/vitest run --reporter=json`| the JSON report                    |
//! | jest    | `node_modules/.bin/jest --json`               | the JSON report                    |
//! | maven   | `mvn -q test`                                 | `target/surefire-reports/*.xml`    |
//! | gradle  | `./gradlew test` (or `gradle test`)           | `build/test-results/test/*.xml`    |
//!
//! A runner is never invented: if its tool is not installed (or the JS runner is not in the
//! project's `node_modules`), it is listed as unavailable with the reason. Stable Rust has no
//! JSON test output, so cargo's text lines (a fixed format) are parsed. The parsers are pure
//! and tested on real output samples.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::runner::{configure_cargo_env, run_guarded};

/// Wall-clock cap for one run (the first build can be slow).
pub const RUN_TIMEOUT: Duration = Duration::from_secs(600);
/// Output kept with a run (the tail matters most: summaries and failures).
const MAX_OUTPUT: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunnerKind {
    Cargo,
    Go,
    Pytest,
    Unittest,
    Vitest,
    Jest,
    Maven,
    Gradle,
}

/// A runner found in the project.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runner {
    /// Stable id: `<kind>:<dir>` (dir relative to the root, `.` for the root).
    pub id: String,
    pub kind: RunnerKind,
    pub dir: String,
    /// The command it runs, as the human would type it.
    pub command: String,
    pub available: bool,
    /// Why it is unavailable (tool not installed…).
    pub reason: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Passed,
    Failed,
    Skipped,
}

/// One test's result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseResult {
    /// Stable id across runs (`<runner kind>:<suite>::<name>`).
    pub id: String,
    pub name: String,
    /// Suite, package, module or file it belongs to.
    pub suite: String,
    pub file: Option<String>,
    pub status: Status,
    pub duration_ms: Option<u64>,
    /// Failure message (assertion), when it failed.
    pub message: Option<String>,
    /// The test's own output, when the runner separates it.
    pub output: Option<String>,
}

/// What to run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Scope {
    All,
    /// One test (the `name` the runner addresses: cargo path, go `Test…`, pytest node id…).
    Case {
        name: String,
    },
    /// Only the packages/crates the given changed files belong to (TEST-05).
    Changed {
        files: Vec<String>,
    },
}

/// A finished run.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRunReport {
    pub runner: String,
    pub kind: RunnerKind,
    pub command: String,
    /// The run happened (false: could not start, timed out).
    pub ran: bool,
    /// Every test passed (and something ran).
    pub ok: bool,
    pub duration_ms: u64,
    pub results: Vec<CaseResult>,
    pub output: String,
    /// What the run could not do (timed out, nothing matched the changed files…).
    pub note: String,
}

impl TestRunReport {
    pub fn counts(&self) -> (usize, usize, usize) {
        let c = |s: Status| self.results.iter().filter(|r| r.status == s).count();
        (c(Status::Passed), c(Status::Failed), c(Status::Skipped))
    }
}

// ───── detection ─────

fn on_path(bin: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|p| std::env::split_paths(&p).any(|d| d.join(bin).is_file()))
}

fn read(p: &Path) -> String {
    std::fs::read_to_string(p).unwrap_or_default()
}

fn rel(root: &Path, dir: &Path) -> String {
    let r = dir
        .strip_prefix(root)
        .unwrap_or(dir)
        .to_string_lossy()
        .replace('\\', "/");
    if r.is_empty() {
        ".".into()
    } else {
        r
    }
}

/// Folders worth looking at: the root and its direct children (monorepos keep projects one
/// level down: `ui-app/`, `services/api/`…), skipping vendored and build folders.
fn candidate_dirs(root: &Path) -> Vec<PathBuf> {
    let mut v = vec![root.to_path_buf()];
    if let Ok(rd) = std::fs::read_dir(root) {
        let mut kids: Vec<PathBuf> = rd
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .filter(|p| {
                let n = p
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                !n.starts_with('.')
                    && ![
                        "node_modules",
                        "target",
                        "dist",
                        "build",
                        "vendor",
                        "venv",
                        ".venv",
                    ]
                    .contains(&n.as_str())
            })
            .collect();
        kids.sort();
        v.extend(kids);
    }
    v
}

fn runner(
    root: &Path,
    dir: &Path,
    kind: RunnerKind,
    command: &str,
    available: bool,
    reason: &str,
) -> Runner {
    let d = rel(root, dir);
    Runner {
        id: format!(
            "{}:{d}",
            serde_json::to_value(kind)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default()
        ),
        kind,
        dir: d,
        command: command.into(),
        available,
        reason: if available {
            String::new()
        } else {
            reason.into()
        },
    }
}

/// The test runners the project has. A Cargo workspace member below the root is covered by
/// the root's `cargo test` and is not listed again.
pub fn detect_runners(root: &Path) -> Vec<Runner> {
    let mut out = vec![];
    let root_is_cargo = root.join("Cargo.toml").is_file();
    for dir in candidate_dirs(root) {
        let is_root = dir == root;
        if dir.join("Cargo.toml").is_file() && (is_root || !root_is_cargo) {
            out.push(runner(
                root,
                &dir,
                RunnerKind::Cargo,
                "cargo test --no-fail-fast",
                on_path("cargo"),
                "cargo is not installed",
            ));
        }
        if dir.join("go.mod").is_file() {
            out.push(runner(
                root,
                &dir,
                RunnerKind::Go,
                "go test -json ./...",
                on_path("go"),
                "go is not installed",
            ));
        }
        let pkg = read(&dir.join("package.json"));
        if !pkg.is_empty() {
            let has = |n: &str| pkg.contains(&format!("\"{n}\""));
            if has("vitest") {
                let ok = dir.join("node_modules/.bin/vitest").is_file();
                out.push(runner(
                    root,
                    &dir,
                    RunnerKind::Vitest,
                    "vitest run --reporter=json",
                    ok,
                    "vitest is not installed in node_modules (run npm install)",
                ));
            } else if has("jest") {
                let ok = dir.join("node_modules/.bin/jest").is_file();
                out.push(runner(
                    root,
                    &dir,
                    RunnerKind::Jest,
                    "jest --json",
                    ok,
                    "jest is not installed in node_modules (run npm install)",
                ));
            }
        }
        let py_cfg = [
            read(&dir.join("pyproject.toml")),
            read(&dir.join("pytest.ini")),
            read(&dir.join("setup.cfg")),
            read(&dir.join("tox.ini")),
        ]
        .concat();
        let py_tests = dir.join("tests").is_dir() || dir.join("test").is_dir();
        let has_py = dir.join("pyproject.toml").is_file()
            || dir.join("setup.py").is_file()
            || dir.join("requirements.txt").is_file();
        if has_py && (py_cfg.contains("pytest") || py_tests) {
            if py_cfg.contains("pytest") {
                let ok = on_path("python3")
                    && Command::new("python3")
                        .args(["-c", "import pytest"])
                        .output()
                        .is_ok_and(|o| o.status.success());
                out.push(runner(
                    root,
                    &dir,
                    RunnerKind::Pytest,
                    "python3 -m pytest",
                    ok,
                    "pytest is not installed for python3",
                ));
            } else {
                out.push(runner(
                    root,
                    &dir,
                    RunnerKind::Unittest,
                    "python3 -m unittest discover -v",
                    on_path("python3"),
                    "python3 is not installed",
                ));
            }
        }
        if dir.join("pom.xml").is_file() {
            out.push(runner(
                root,
                &dir,
                RunnerKind::Maven,
                "mvn -q test",
                on_path("mvn"),
                "maven (mvn) is not installed",
            ));
        } else if dir.join("build.gradle").is_file() || dir.join("build.gradle.kts").is_file() {
            let wrapper = dir.join("gradlew").is_file();
            let cmd = if wrapper {
                "./gradlew test"
            } else {
                "gradle test"
            };
            out.push(runner(
                root,
                &dir,
                RunnerKind::Gradle,
                cmd,
                wrapper || on_path("gradle"),
                "gradle is not installed and the project has no gradlew",
            ));
        }
    }
    out
}

// ───── parsers (pure) ─────

fn clip(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let mut cut = s.len() - max;
    while !s.is_char_boundary(cut) {
        cut += 1;
    }
    format!("…{}", &s[cut..])
}

/// cargo test (libtest, stable): `test path ... ok|FAILED|ignored` lines, and the
/// `---- path stdout ----` sections with each failure's output. The `Running <target>`
/// lines name the suite (crate or integration test binary).
pub fn parse_libtest(text: &str) -> Vec<CaseResult> {
    let mut suite = String::new();
    let mut out: Vec<CaseResult> = vec![];
    let mut fail_out: BTreeMap<String, String> = BTreeMap::new();
    let mut cur_fail: Option<String> = None;
    for line in text.lines() {
        let t = line.trim_start();
        if let Some(rest) = t.strip_prefix("Running ") {
            // "Running unittests src/lib.rs (target/debug/deps/x-hash)" / "Running tests/a.rs (…)"
            let target = rest
                .split(" (")
                .next()
                .unwrap_or(rest)
                .trim_start_matches("unittests ")
                .trim();
            suite = target.to_string();
            cur_fail = None;
            continue;
        }
        if t.starts_with("Doc-tests ") {
            suite = t.to_string();
            continue;
        }
        if let Some(rest) = t.strip_prefix("---- ") {
            if let Some(name) = rest
                .strip_suffix(" stdout ----")
                .or_else(|| rest.strip_suffix(" stderr ----"))
            {
                cur_fail = Some(format!("{suite}::{name}"));
                continue;
            }
        }
        if t == "failures:" || t.starts_with("test result:") {
            cur_fail = None;
        }
        if let Some(k) = &cur_fail {
            let e = fail_out.entry(k.clone()).or_default();
            e.push_str(line);
            e.push('\n');
            continue;
        }
        if let Some(rest) = t.strip_prefix("test ") {
            if let Some((name, verdict)) = rest.rsplit_once(" ... ") {
                let status = match verdict.trim() {
                    "ok" => Status::Passed,
                    v if v.starts_with("FAILED") => Status::Failed,
                    v if v.starts_with("ignored") => Status::Skipped,
                    _ => continue,
                };
                // doc tests: "src/lib.rs - add (line 3)"
                let name = name.trim().to_string();
                out.push(CaseResult {
                    id: format!("cargo:{suite}::{name}"),
                    name: name.clone(),
                    suite: suite.clone(),
                    file: None,
                    status,
                    duration_ms: None,
                    message: None,
                    output: None,
                });
            }
        }
    }
    for c in out.iter_mut().filter(|c| c.status == Status::Failed) {
        if let Some(o) = fail_out.get(&format!("{}::{}", c.suite, c.name)) {
            c.message = o
                .lines()
                .find(|l| l.contains("panicked at") || l.contains("assertion"))
                .map(|l| l.trim().to_string())
                .or_else(|| {
                    o.lines()
                        .find(|l| !l.trim().is_empty())
                        .map(|l| l.trim().to_string())
                });
            c.output = Some(clip(o, 8 * 1024));
        }
    }
    out
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct GoEvent {
    action: String,
    #[serde(default)]
    package: String,
    #[serde(default)]
    test: Option<String>,
    #[serde(default)]
    elapsed: Option<f64>,
    #[serde(default)]
    output: Option<String>,
}

/// `go test -json`: one JSON event per line; a test ends with `pass`, `fail` or `skip`.
pub fn parse_go_json(text: &str) -> Vec<CaseResult> {
    let mut outputs: BTreeMap<(String, String), String> = BTreeMap::new();
    let mut out = vec![];
    for line in text.lines() {
        let Ok(e) = serde_json::from_str::<GoEvent>(line) else {
            continue;
        };
        let Some(test) = e.test.clone() else { continue };
        let key = (e.package.clone(), test.clone());
        match e.action.as_str() {
            "output" => {
                if let Some(o) = &e.output {
                    outputs.entry(key).or_default().push_str(o);
                }
            }
            "pass" | "fail" | "skip" => {
                let status = match e.action.as_str() {
                    "pass" => Status::Passed,
                    "fail" => Status::Failed,
                    _ => Status::Skipped,
                };
                let o = outputs.remove(&key).unwrap_or_default();
                let message = (status == Status::Failed).then(|| {
                    o.lines()
                        .map(str::trim)
                        .find(|l| {
                            !l.is_empty() && !l.starts_with("=== RUN") && !l.starts_with("--- FAIL")
                        })
                        .unwrap_or("")
                        .to_string()
                });
                let file = message
                    .as_deref()
                    .and_then(|m| m.split(':').next())
                    .filter(|f| f.ends_with(".go"))
                    .map(String::from);
                out.push(CaseResult {
                    id: format!("go:{}::{test}", e.package),
                    name: test,
                    suite: e.package,
                    file,
                    status,
                    duration_ms: e.elapsed.map(|s| (s * 1000.0).round() as u64),
                    message,
                    output: (!o.is_empty()).then(|| clip(&o, 8 * 1024)),
                });
            }
            _ => {}
        }
    }
    out
}

fn unescape_xml(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#10;", "\n")
        .replace("&amp;", "&")
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let pat = format!(" {name}=");
    let i = tag.find(&pat)? + pat.len();
    let q = tag[i..].chars().next()?;
    if q != '"' && q != '\'' {
        return None;
    }
    let rest = &tag[i + 1..];
    let end = rest.find(q)?;
    Some(unescape_xml(&rest[..end]))
}

/// JUnit XML (pytest `--junitxml`, maven surefire, gradle): `<testcase name classname time>`
/// with an optional `<failure>`/`<error>` (message + text) or `<skipped>`.
pub fn parse_junit(xml: &str, kind: &str) -> Vec<CaseResult> {
    let mut out = vec![];
    let mut rest = xml;
    while let Some(i) = rest.find("<testcase") {
        rest = &rest[i..];
        let Some(open_end) = rest.find('>') else {
            break;
        };
        let open = &rest[..open_end];
        let self_closing = open.ends_with('/');
        let body_end = if self_closing {
            open_end + 1
        } else {
            rest.find("</testcase>")
                .map(|e| e + "</testcase>".len())
                .unwrap_or(open_end + 1)
        };
        let body = &rest[open_end + 1..body_end.max(open_end + 1)];
        let name = attr(open, "name").unwrap_or_default();
        let suite = attr(open, "classname").unwrap_or_default();
        let file = attr(open, "file");
        let duration_ms = attr(open, "time")
            .and_then(|t| t.parse::<f64>().ok())
            .map(|s| (s * 1000.0).round() as u64);
        let fail = ["<failure", "<error"]
            .iter()
            .find_map(|t| body.find(t).map(|p| &body[p..]));
        let (status, message, output) = if let Some(f) = fail {
            let tag_end = f.find('>').unwrap_or(f.len());
            let tag = &f[..tag_end];
            let msg = attr(tag, "message");
            let text = if tag.ends_with('/') {
                String::new()
            } else {
                let after = &f[tag_end + 1..];
                let close = after
                    .find("</failure>")
                    .or_else(|| after.find("</error>"))
                    .unwrap_or(after.len());
                unescape_xml(
                    after[..close]
                        .trim_start_matches("<![CDATA[")
                        .trim_end_matches("]]>"),
                )
            };
            let message = msg.or_else(|| {
                text.lines()
                    .find(|l| !l.trim().is_empty())
                    .map(|l| l.trim().to_string())
            });
            (
                Status::Failed,
                message,
                (!text.trim().is_empty()).then(|| clip(&text, 8 * 1024)),
            )
        } else if body.contains("<skipped") {
            (Status::Skipped, attr(body, "message"), None)
        } else {
            (Status::Passed, None, None)
        };
        out.push(CaseResult {
            id: format!("{kind}:{suite}::{name}"),
            name,
            suite,
            file,
            status,
            duration_ms,
            message,
            output,
        });
        rest = &rest[body_end.min(rest.len())..];
        if body_end == 0 {
            break;
        }
    }
    out
}

/// vitest `--reporter=json` and jest `--json` share the jest report shape.
pub fn parse_jest_json(json: &str, kind: &str, root: &Path) -> Vec<CaseResult> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(json) else {
        return vec![];
    };
    let mut out = vec![];
    for file in v["testResults"].as_array().cloned().unwrap_or_default() {
        let path = file["name"].as_str().unwrap_or("").to_string();
        let shown = Path::new(&path)
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or(path.clone());
        for a in file["assertionResults"]
            .as_array()
            .cloned()
            .unwrap_or_default()
        {
            let name = a["fullName"]
                .as_str()
                .or(a["title"].as_str())
                .unwrap_or("")
                .to_string();
            let status = match a["status"].as_str().unwrap_or("") {
                "passed" => Status::Passed,
                "failed" => Status::Failed,
                _ => Status::Skipped,
            };
            let fails: Vec<String> = a["failureMessages"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .iter()
                .filter_map(|m| m.as_str().map(String::from))
                .collect();
            let text = fails.join("\n");
            out.push(CaseResult {
                id: format!("{kind}:{shown}::{name}"),
                name,
                suite: shown.clone(),
                file: Some(shown.clone()),
                status,
                duration_ms: a["duration"].as_f64().map(|d| d.round() as u64),
                message: text
                    .lines()
                    .find(|l| !l.trim().is_empty())
                    .map(|l| l.trim().to_string()),
                output: (!text.is_empty()).then(|| clip(&text, 8 * 1024)),
            });
        }
    }
    out
}

/// `python -m unittest -v`: `test_x (pkg.mod.Class.test_x) ... ok|FAIL|ERROR|skipped`, and the
/// `FAIL: test_x (…)` sections with the traceback.
pub fn parse_unittest(text: &str) -> Vec<CaseResult> {
    let mut out = vec![];
    let mut sections: BTreeMap<String, String> = BTreeMap::new();
    let mut cur: Option<String> = None;
    for line in text.lines() {
        if let Some(rest) = line
            .strip_prefix("FAIL: ")
            .or_else(|| line.strip_prefix("ERROR: "))
        {
            cur = Some(rest.trim().to_string());
            continue;
        }
        if line.starts_with("======") || line.starts_with("Ran ") {
            if line.starts_with("Ran ") {
                cur = None;
            }
            continue;
        }
        if let Some(k) = &cur {
            if !line.starts_with("------") {
                let e = sections.entry(k.clone()).or_default();
                e.push_str(line);
                e.push('\n');
            }
            continue;
        }
        if let Some((head, verdict)) = line.rsplit_once(" ... ") {
            let status = match verdict.trim() {
                "ok" => Status::Passed,
                "FAIL" | "ERROR" => Status::Failed,
                v if v.starts_with("skipped") => Status::Skipped,
                _ => continue,
            };
            let (name, suite) = match head.split_once(" (") {
                Some((n, s)) => (n.trim().to_string(), s.trim_end_matches(')').to_string()),
                None => (head.trim().to_string(), String::new()),
            };
            out.push(CaseResult {
                id: format!("unittest:{suite}::{name}"),
                name,
                suite,
                file: None,
                status,
                duration_ms: None,
                message: None,
                output: None,
            });
        }
    }
    for c in out.iter_mut().filter(|c| c.status == Status::Failed) {
        if let Some(t) = sections
            .iter()
            .find(|(k, _)| k.starts_with(&format!("{} (", c.name)))
            .map(|(_, v)| v)
        {
            c.message = t
                .lines()
                .rev()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .map(String::from);
            c.output = Some(clip(t, 8 * 1024));
        }
    }
    out
}

// ───── running ─────

/// The Cargo package a changed file belongs to (nearest `Cargo.toml` with a `[package]`).
fn cargo_package_of(root: &Path, file: &str) -> Option<String> {
    let mut d = root.join(file);
    while d.pop() {
        if !d.starts_with(root) {
            return None;
        }
        let toml = read(&d.join("Cargo.toml"));
        if let Some(i) = toml.find("[package]") {
            return toml[i..].lines().find_map(|l| {
                let l = l.trim();
                l.strip_prefix("name").map(|r| {
                    r.trim_start()
                        .trim_start_matches('=')
                        .trim()
                        .trim_matches('"')
                        .to_string()
                })
            });
        }
    }
    None
}

/// The Go package dirs (relative to the module dir) of the changed `.go` files.
fn go_packages_of(module_dir: &Path, root: &Path, files: &[String]) -> Vec<String> {
    let mut v: Vec<String> = files
        .iter()
        .filter(|f| f.ends_with(".go"))
        .filter_map(|f| root.join(f).parent().map(Path::to_path_buf))
        .filter_map(|d| {
            d.strip_prefix(module_dir)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"))
        })
        .map(|p| {
            if p.is_empty() {
                "./".to_string()
            } else {
                format!("./{p}")
            }
        })
        .collect();
    v.sort();
    v.dedup();
    v
}

fn base_env(cmd: &mut Command, kind: RunnerKind) {
    match kind {
        RunnerKind::Cargo => configure_cargo_env(cmd),
        RunnerKind::Pytest | RunnerKind::Unittest => {
            cmd.env("PYTHONDONTWRITEBYTECODE", "1");
        }
        _ => {}
    }
    cmd.env("CI", "1")
        .env("NO_COLOR", "1")
        .env("FORCE_COLOR", "0");
}

/// Runs a runner on a scope and reads its per-test results. Never panics; a run that could
/// not start or timed out comes back with `ran: false` and the reason in `note`.
pub fn run(root: &Path, r: &Runner, scope: &Scope) -> TestRunReport {
    let dir = if r.dir == "." {
        root.to_path_buf()
    } else {
        root.join(&r.dir)
    };
    let scratch = match tempfile::tempdir() {
        Ok(d) => d,
        Err(e) => return fail(r, String::new(), format!("scratch: {e}")),
    };
    let report = scratch.path().join("report");
    let rel_files: Vec<String> = match scope {
        Scope::Changed { files } => files
            .iter()
            .filter_map(|f| {
                let p = root.join(f);
                p.strip_prefix(&dir)
                    .ok()
                    .map(|x| x.to_string_lossy().replace('\\', "/"))
            })
            .collect(),
        _ => vec![],
    };
    if let Scope::Changed { files } = scope {
        if rel_files.is_empty() && !files.is_empty() {
            let mut rep = fail(
                r,
                String::new(),
                "no changed file belongs to this project".into(),
            );
            rep.ran = true;
            rep.ok = true;
            return rep;
        }
    }
    let (prog, args): (String, Vec<String>) = match r.kind {
        RunnerKind::Cargo => {
            let mut a = vec!["test".to_string(), "--no-fail-fast".into()];
            match scope {
                Scope::Case { name } => a.extend([name.clone(), "--".into(), "--exact".into()]),
                Scope::Changed { files } => {
                    let mut pk: Vec<String> = files
                        .iter()
                        .filter_map(|f| cargo_package_of(root, f))
                        .collect();
                    pk.sort();
                    pk.dedup();
                    if pk.is_empty() {
                        let mut rep = fail(
                            r,
                            String::new(),
                            "no changed file belongs to a Cargo package".into(),
                        );
                        rep.ran = true;
                        rep.ok = true;
                        return rep;
                    }
                    for p in pk {
                        a.extend(["-p".into(), p]);
                    }
                }
                Scope::All => {}
            }
            ("cargo".into(), a)
        }
        RunnerKind::Go => {
            let mut a = vec!["test".to_string(), "-json".into()];
            match scope {
                Scope::Case { name } => a.extend([
                    "-run".into(),
                    format!("^{}$", regex_escape(name)),
                    "./...".into(),
                ]),
                Scope::Changed { files } => {
                    let pk = go_packages_of(&dir, root, files);
                    if pk.is_empty() {
                        let mut rep = fail(r, String::new(), "no changed Go file".into());
                        rep.ran = true;
                        rep.ok = true;
                        return rep;
                    }
                    a.extend(pk);
                }
                Scope::All => a.push("./...".into()),
            }
            ("go".into(), a)
        }
        RunnerKind::Pytest => {
            let mut a = vec![
                "-m".to_string(),
                "pytest".into(),
                "-q".into(),
                format!("--junitxml={}", report.display()),
            ];
            if let Scope::Case { name } = scope {
                a.push(name.clone());
            }
            ("python3".into(), a)
        }
        RunnerKind::Unittest => {
            let a = match scope {
                Scope::Case { name } => vec![
                    "-m".to_string(),
                    "unittest".into(),
                    "-v".into(),
                    name.clone(),
                ],
                _ => vec![
                    "-m".to_string(),
                    "unittest".into(),
                    "discover".into(),
                    "-v".into(),
                ],
            };
            ("python3".into(), a)
        }
        RunnerKind::Vitest => {
            let mut a = vec![
                "run".to_string(),
                "--reporter=json".into(),
                format!("--outputFile={}", report.display()),
            ];
            match scope {
                Scope::Case { name } => a.extend(["-t".into(), name.clone()]),
                Scope::Changed { .. } => a.extend(
                    /* vitest filters test files by substring: `src/a` matches `src/a.test.ts` */
                    rel_files
                        .iter()
                        .map(|f| f.replace(".ts", "").replace(".js", "")),
                ),
                Scope::All => {}
            }
            (
                dir.join("node_modules/.bin/vitest").display().to_string(),
                a,
            )
        }
        RunnerKind::Jest => {
            let mut a = vec![
                "--json".to_string(),
                format!("--outputFile={}", report.display()),
            ];
            match scope {
                Scope::Case { name } => a.extend(["-t".into(), name.clone()]),
                Scope::Changed { .. } => {
                    a.push("--findRelatedTests".into());
                    a.extend(rel_files.iter().cloned());
                }
                Scope::All => {}
            }
            (dir.join("node_modules/.bin/jest").display().to_string(), a)
        }
        RunnerKind::Maven => {
            let mut a = vec!["-q".to_string(), "test".into()];
            if let Scope::Case { name } = scope {
                a.push(format!("-Dtest={name}"));
            }
            ("mvn".into(), a)
        }
        RunnerKind::Gradle => {
            let mut a = vec!["test".to_string()];
            if let Scope::Case { name } = scope {
                a.extend(["--tests".into(), name.clone()]);
            }
            let prog = if dir.join("gradlew").is_file() {
                dir.join("gradlew").display().to_string()
            } else {
                "gradle".into()
            };
            (prog, a)
        }
    };
    let shown = format!(
        "{} {}",
        Path::new(&prog)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(prog.clone()),
        args.iter()
            .map(
                |a| if a.starts_with("--junitxml=") || a.starts_with("--outputFile=") {
                    a.split('=').next().unwrap_or("").to_string() + "=<report>"
                } else {
                    a.clone()
                }
            )
            .collect::<Vec<_>>()
            .join(" ")
    );
    if !r.available {
        return fail(r, shown, r.reason.clone());
    }
    // the JUnit reports of maven/gradle from an earlier run must not be read as this run's
    let junit_dir = match r.kind {
        RunnerKind::Maven => Some(dir.join("target/surefire-reports")),
        RunnerKind::Gradle => Some(dir.join("build/test-results/test")),
        _ => None,
    };
    let since = std::time::SystemTime::now();
    let mut cmd = Command::new(&prog);
    cmd.args(&args).current_dir(&dir);
    base_env(&mut cmd, r.kind);
    let started = Instant::now();
    let res = run_guarded(cmd, scratch.path(), "testrun", RUN_TIMEOUT, None);
    let duration_ms = started.elapsed().as_millis() as u64;
    let o = match res {
        Ok(o) => o,
        Err(e) => return fail(r, shown, format!("could not start: {e}")),
    };
    let combined = format!("{}{}", o.stdout, o.stderr);
    if o.timed_out {
        let mut rep = fail(
            r,
            shown,
            format!("timed out after {}s", RUN_TIMEOUT.as_secs()),
        );
        rep.output = clip(&combined, MAX_OUTPUT);
        return rep;
    }
    let results = match r.kind {
        RunnerKind::Cargo => parse_libtest(&combined),
        RunnerKind::Go => parse_go_json(&o.stdout),
        RunnerKind::Pytest => parse_junit(&read(&report), "pytest"),
        RunnerKind::Unittest => parse_unittest(&o.stderr),
        RunnerKind::Vitest => parse_jest_json(&read(&report), "vitest", &dir),
        RunnerKind::Jest => parse_jest_json(&read(&report), "jest", &dir),
        RunnerKind::Maven | RunnerKind::Gradle => {
            let kind = if r.kind == RunnerKind::Maven {
                "maven"
            } else {
                "gradle"
            };
            let mut v = vec![];
            if let Some(d) = &junit_dir {
                if let Ok(rd) = std::fs::read_dir(d) {
                    for e in rd.filter_map(Result::ok) {
                        let p = e.path();
                        let fresh = e
                            .metadata()
                            .and_then(|m| m.modified())
                            .is_ok_and(|t| t >= since);
                        if fresh && p.extension().is_some_and(|x| x == "xml") {
                            v.extend(parse_junit(&read(&p), kind));
                        }
                    }
                }
            }
            v
        }
    };
    let exit_ok = o.status.is_some_and(|s| s.success());
    let failed = results.iter().any(|c| c.status == Status::Failed);
    let note = if results.is_empty() {
        if exit_ok {
            "the runner finished but reported no tests".into()
        } else {
            "the runner failed before reporting tests (see the output)".into()
        }
    } else {
        String::new()
    };
    TestRunReport {
        runner: r.id.clone(),
        kind: r.kind,
        command: shown,
        ran: true,
        ok: exit_ok && !failed && !results.is_empty(),
        duration_ms,
        results,
        output: clip(&combined, MAX_OUTPUT),
        note,
    }
}

fn regex_escape(s: &str) -> String {
    s.chars()
        .map(|c| {
            if "\\.+*?()|[]{}^$".contains(c) {
                format!("\\{c}")
            } else {
                c.to_string()
            }
        })
        .collect()
}

fn fail(r: &Runner, command: String, note: String) -> TestRunReport {
    TestRunReport {
        runner: r.id.clone(),
        kind: r.kind,
        command,
        ran: false,
        ok: false,
        duration_ms: 0,
        results: vec![],
        output: String::new(),
        note,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIBTEST: &str = "   Compiling lexer v0.1.0 (/p/lexer)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 1.20s
     Running unittests src/lib.rs (target/debug/deps/lexer-abc123)

running 3 tests
test tests::numbers ... ok
test tests::moved ... FAILED
test tests::slow ... ignored, needs a fixture

failures:

---- tests::moved stdout ----

thread 'tests::moved' panicked at src/lib.rs:20:9:
assertion `left == right` failed
  left: 1
 right: 2
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace


failures:
    tests::moved

test result: FAILED. 1 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running tests/api.rs (target/debug/deps/api-def456)

running 1 test
test health ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
";

    #[test]
    fn libtest_lines_and_failure_sections() {
        let r = parse_libtest(LIBTEST);
        let st: Vec<(&str, &str, Status)> = r
            .iter()
            .map(|c| (c.suite.as_str(), c.name.as_str(), c.status))
            .collect();
        assert_eq!(
            st,
            [
                ("src/lib.rs", "tests::numbers", Status::Passed),
                ("src/lib.rs", "tests::moved", Status::Failed),
                ("src/lib.rs", "tests::slow", Status::Skipped),
                ("tests/api.rs", "health", Status::Passed),
            ]
        );
        assert_eq!(
            r[1].message.as_deref(),
            Some("thread 'tests::moved' panicked at src/lib.rs:20:9:")
        );
        assert!(r[1].output.as_deref().unwrap().contains("right: 2"));
        assert_eq!(r[0].id, "cargo:src/lib.rs::tests::numbers");
    }

    #[test]
    fn go_json_events() {
        let text = r#"{"Action":"run","Package":"ex/lexer","Test":"TestNumbers"}
{"Action":"output","Package":"ex/lexer","Test":"TestNumbers","Output":"=== RUN   TestNumbers\n"}
{"Action":"pass","Package":"ex/lexer","Test":"TestNumbers","Elapsed":0.01}
{"Action":"run","Package":"ex/lexer","Test":"TestMoved"}
{"Action":"output","Package":"ex/lexer","Test":"TestMoved","Output":"    lexer_test.go:14: got 1, want 2\n"}
{"Action":"output","Package":"ex/lexer","Test":"TestMoved","Output":"--- FAIL: TestMoved (0.00s)\n"}
{"Action":"fail","Package":"ex/lexer","Test":"TestMoved","Elapsed":0}
{"Action":"skip","Package":"ex/lexer","Test":"TestSlow","Elapsed":0}
{"Action":"fail","Package":"ex/lexer","Elapsed":0.2}
not json
"#;
        let r = parse_go_json(text);
        assert_eq!(r.len(), 3);
        assert_eq!(
            (r[0].name.as_str(), r[0].status, r[0].duration_ms),
            ("TestNumbers", Status::Passed, Some(10))
        );
        assert_eq!(r[1].status, Status::Failed);
        assert_eq!(
            r[1].message.as_deref(),
            Some("lexer_test.go:14: got 1, want 2")
        );
        assert_eq!(r[1].file.as_deref(), Some("lexer_test.go"));
        assert_eq!(r[2].status, Status::Skipped);
    }

    #[test]
    fn junit_from_pytest_and_surefire() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest" tests="4">
<testcase classname="tests.test_api" name="test_ok" file="tests/test_api.py" time="0.012" />
<testcase classname="tests.test_api" name="test_bad" time="0.5"><failure message="assert 1 == 2">def test_bad():
&gt;       assert 1 == 2
E       assert 1 == 2</failure></testcase>
<testcase classname="tests.test_api" name="test_err" time="0"><error message="ZeroDivisionError: division by zero"/></testcase>
<testcase classname="tests.test_api" name="test_skip" time="0"><skipped message="no db" type="pytest.skip"/></testcase>
</testsuite></testsuites>"#;
        let r = parse_junit(xml, "pytest");
        let st: Vec<(&str, Status)> = r.iter().map(|c| (c.name.as_str(), c.status)).collect();
        assert_eq!(
            st,
            [
                ("test_ok", Status::Passed),
                ("test_bad", Status::Failed),
                ("test_err", Status::Failed),
                ("test_skip", Status::Skipped)
            ]
        );
        assert_eq!(r[0].duration_ms, Some(12));
        assert_eq!(r[0].file.as_deref(), Some("tests/test_api.py"));
        assert_eq!(r[1].message.as_deref(), Some("assert 1 == 2"));
        assert!(r[1]
            .output
            .as_deref()
            .unwrap()
            .contains(">       assert 1 == 2"));
        assert_eq!(
            r[2].message.as_deref(),
            Some("ZeroDivisionError: division by zero")
        );
        assert_eq!(r[3].message.as_deref(), Some("no db"));
        assert_eq!(r[1].id, "pytest:tests.test_api::test_bad");
    }

    #[test]
    fn jest_and_vitest_json() {
        let json = r#"{"numTotalTests":2,"testResults":[{"name":"/p/src/a.test.ts","assertionResults":[
          {"fullName":"sum adds","status":"passed","duration":3},
          {"fullName":"sum fails","status":"failed","duration":5,"failureMessages":["AssertionError: expected 3 to be 4\n    at /p/src/a.test.ts:9:20"]},
          {"fullName":"sum later","status":"pending","failureMessages":[]}]}]}"#;
        let r = parse_jest_json(json, "vitest", Path::new("/p"));
        assert_eq!(r.len(), 3);
        assert_eq!(
            (r[0].file.as_deref(), r[0].status),
            (Some("src/a.test.ts"), Status::Passed)
        );
        assert_eq!(
            r[1].message.as_deref(),
            Some("AssertionError: expected 3 to be 4")
        );
        assert_eq!(r[2].status, Status::Skipped);
        assert!(parse_jest_json("not json", "jest", Path::new("/")).is_empty());
    }

    #[test]
    fn unittest_verbose() {
        let text = "test_ok (tests.test_m.T.test_ok) ... ok
test_bad (tests.test_m.T.test_bad) ... FAIL
test_skip (tests.test_m.T.test_skip) ... skipped 'later'

======================================================================
FAIL: test_bad (tests.test_m.T.test_bad)
----------------------------------------------------------------------
Traceback (most recent call last):
  File \"tests/test_m.py\", line 9, in test_bad
    self.assertEqual(1, 2)
AssertionError: 1 != 2

----------------------------------------------------------------------
Ran 3 tests in 0.001s
";
        let r = parse_unittest(text);
        assert_eq!(
            r.iter().map(|c| c.status).collect::<Vec<_>>(),
            [Status::Passed, Status::Failed, Status::Skipped]
        );
        assert_eq!(r[1].message.as_deref(), Some("AssertionError: 1 != 2"));
        assert_eq!(r[1].suite, "tests.test_m.T.test_bad");
    }

    #[test]
    fn detection_lists_real_runners_and_never_invents_one() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        std::fs::write(
            root.join("Cargo.toml"),
            "[workspace]\nmembers = [\"crates/a\"]\n",
        )
        .unwrap();
        std::fs::create_dir_all(root.join("web/node_modules/.bin")).unwrap();
        std::fs::write(
            root.join("web/package.json"),
            r#"{"devDependencies":{"vitest":"^1"}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("api")).unwrap();
        std::fs::write(
            root.join("api/package.json"),
            r#"{"devDependencies":{"jest":"^29"}}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("svc")).unwrap();
        std::fs::write(root.join("svc/pom.xml"), "<project/>").unwrap();
        let rs = detect_runners(root);
        let ids: Vec<&str> = rs.iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, ["cargo:.", "jest:api", "maven:svc", "vitest:web"]);
        let jest = rs.iter().find(|r| r.kind == RunnerKind::Jest).unwrap();
        assert!(!jest.available);
        assert!(jest.reason.contains("node_modules"));
        assert!(
            !rs.iter()
                .find(|r| r.kind == RunnerKind::Vitest)
                .unwrap()
                .available,
            "no vitest binary in node_modules/.bin"
        );
    }

    #[test]
    fn changed_files_map_to_their_cargo_package_and_go_package() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        std::fs::create_dir_all(root.join("crates/lexer/src")).unwrap();
        std::fs::write(
            root.join("crates/lexer/Cargo.toml"),
            "[package]\nname = \"lexer\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        assert_eq!(
            cargo_package_of(root, "crates/lexer/src/lib.rs").as_deref(),
            Some("lexer")
        );
        assert_eq!(cargo_package_of(root, "README.md"), None);
        let files = vec![
            "svc/internal/auth/token.go".to_string(),
            "svc/main.go".into(),
            "svc/README.md".into(),
        ];
        assert_eq!(
            go_packages_of(&root.join("svc"), root, &files),
            ["./", "./internal/auth"]
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_real_cargo_project_runs_with_per_test_results() {
        if !on_path("cargo") {
            eprintln!("cargo is not on PATH: skipped");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(
            root.join("Cargo.toml"),
            "[package]\nname = \"probe_tests\"\nversion = \"0.1.0\"\nedition = \"2021\"\n",
        )
        .unwrap();
        std::fs::write(
            root.join("src/lib.rs"),
            "#[cfg(test)]\nmod tests {\n    #[test]\n    fn passes() {}\n    #[test]\n    fn fails() { assert_eq!(1, 2, \"one is not two\"); }\n}\n",
        )
        .unwrap();
        let rs = detect_runners(root);
        let r = rs.iter().find(|r| r.kind == RunnerKind::Cargo).unwrap();
        let rep = run(root, r, &Scope::All);
        assert!(rep.ran, "{}", rep.note);
        assert!(!rep.ok);
        let by: BTreeMap<&str, Status> = rep
            .results
            .iter()
            .map(|c| (c.name.as_str(), c.status))
            .collect();
        assert_eq!(by.get("tests::passes"), Some(&Status::Passed));
        assert_eq!(by.get("tests::fails"), Some(&Status::Failed));
        let f = rep
            .results
            .iter()
            .find(|c| c.name == "tests::fails")
            .unwrap();
        assert!(
            f.output.as_deref().unwrap_or("").contains("one is not two"),
            "{:?}",
            f.output
        );
        let one = run(
            root,
            r,
            &Scope::Case {
                name: "tests::passes".into(),
            },
        );
        assert!(one.ok, "{}", one.output);
        assert_eq!(one.results.len(), 1);
    }
}
