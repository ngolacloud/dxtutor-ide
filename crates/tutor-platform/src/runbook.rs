//! Runbooks as code (r23 F5a, docs/v2/AUDIT-r23.md §4.5 — RF-BK-R01/R02): `runbooks/*.md`, reviewed and
//! versioned like code; editing the file changes the runner's steps.
//!
//! The grammar: a `# title`, free lines (owner, on-call, `schedule:`…), then steps
//! `## n. title [check|action|decision]`, each with one fenced command block (none for a decision) and
//! an `expect:` line. An expectation in backticks (`` expect: `Synced` ``) or between slashes
//! (`expect: /p95: [0-2]\d\d ms/`) is checked against the output; any other is the human's to judge.
//!
//! The rules ([`policy`]): a `check` runs only when every command in it is read-only (the agent's
//! classifier, plus the infrastructure tools' read verbs); an `action` runs only with an approval
//! (asked by the UI, audited by the backend) and gets Vault's environment for that step only.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Check,
    Action,
    Decision,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub n: u32,
    pub title: String,
    pub kind: Kind,
    pub command: String,
    pub expect: String,
    /// for a check: why it cannot run (not read-only); none when it can
    pub refused: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Runbook {
    /// relative to the project
    pub path: String,
    pub title: String,
    /// the free lines under the title (owner, on-call, cadence)
    pub about: Vec<String>,
    /// `schedule: monthly` (a recurring task for the queue)
    pub schedule: Option<String>,
    pub steps: Vec<Step>,
    /// what the parser could not read (a step without a command, a step number out of order)
    pub problems: Vec<String>,
}

fn heading(l: &str) -> Option<(u32, String, Kind)> {
    let rest = l.strip_prefix("## ")?;
    let (num, rest) = rest.split_once(". ")?;
    let n: u32 = num.trim().parse().ok()?;
    let rest = rest.trim_end();
    let open = rest.rfind('[')?;
    let kind = match rest[open..]
        .trim_end_matches(']')
        .trim_start_matches('[')
        .trim()
    {
        "check" => Kind::Check,
        "action" => Kind::Action,
        "decision" => Kind::Decision,
        _ => return None,
    };
    if !rest.ends_with(']') {
        return None;
    }
    Some((n, rest[..open].trim().to_string(), kind))
}

/// Parses a runbook's text (pure). `root` decides what the read-only classifier sees.
pub fn parse(path: &str, text: &str, root: &Path) -> Runbook {
    let mut rb = Runbook {
        path: path.into(),
        ..Default::default()
    };
    let mut cur: Option<Step> = None;
    let mut in_code = false;
    let mut code_blocks = 0;
    let finish = |rb: &mut Runbook, s: Option<Step>, blocks: u32| {
        if let Some(mut s) = s {
            if s.kind != Kind::Decision && s.command.trim().is_empty() {
                rb.problems.push(format!("step {} has no command", s.n));
            }
            if blocks > 1 {
                rb.problems.push(format!(
                    "step {} has {blocks} command blocks: only the first runs",
                    s.n
                ));
            }
            if s.kind == Kind::Check {
                s.refused = crate::policy::read_only(&s.command, root).err();
            }
            if let Some(prev) = rb.steps.last() {
                if s.n != prev.n + 1 {
                    rb.problems
                        .push(format!("step {} follows step {}", s.n, prev.n));
                }
            }
            rb.steps.push(s);
        }
    };
    for l in text.lines() {
        if !in_code {
            if let Some((n, title, kind)) = heading(l) {
                let prev = cur.take();
                finish(&mut rb, prev, code_blocks);
                code_blocks = 0;
                cur = Some(Step {
                    n,
                    title,
                    kind,
                    command: String::new(),
                    expect: String::new(),
                    refused: None,
                });
                continue;
            }
            if let Some(t) = l.strip_prefix("# ") {
                if rb.title.is_empty() {
                    rb.title = t.trim().into();
                }
                continue;
            }
        }
        if l.trim_start().starts_with("```") {
            in_code = !in_code;
            if in_code {
                code_blocks += 1;
            }
            continue;
        }
        match cur.as_mut() {
            Some(s) if in_code => {
                if code_blocks == 1 {
                    if !s.command.is_empty() {
                        s.command.push('\n');
                    }
                    s.command.push_str(l);
                }
            }
            Some(s) => {
                if let Some(e) = l.trim().strip_prefix("expect:") {
                    s.expect = e.trim().into();
                }
            }
            None => {
                let t = l.trim();
                if let Some(sc) = t.strip_prefix("schedule:") {
                    rb.schedule = Some(sc.trim().into());
                }
                if !t.is_empty() {
                    rb.about.push(t.into());
                }
            }
        }
    }
    let last = cur.take();
    finish(&mut rb, last, code_blocks);
    if rb.title.is_empty() {
        rb.title = path
            .rsplit('/')
            .next()
            .unwrap_or(path)
            .trim_end_matches(".md")
            .into();
    }
    rb
}

/// The runbooks of a project (`runbooks/*.md`), sorted.
pub fn list(root: &Path) -> Vec<Runbook> {
    let dir = root.join("runbooks");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|x| x == "md"))
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
        .iter()
        .filter_map(|p| {
            let rel = format!("runbooks/{}", p.file_name()?.to_string_lossy());
            Some(parse(&rel, &std::fs::read_to_string(p).ok()?, root))
        })
        .collect()
}

/// A runbook of the project by its relative path (only under `runbooks/`).
pub fn load(root: &Path, path: &str) -> Result<Runbook, String> {
    let ok = path.starts_with("runbooks/")
        && path.ends_with(".md")
        && !path.split('/').any(|c| c == ".." || c.is_empty());
    if !ok {
        return Err(format!("not a runbook of this project: {path}"));
    }
    let text = std::fs::read_to_string(root.join(path)).map_err(|e| format!("{path}: {e}"))?;
    Ok(parse(path, &text, root))
}

/// Whether a step may run now (the rule, here, not in the UI): a check only when read-only; an action
/// only with an approval; a decision never runs (the human records it).
pub fn may_run(step: &Step, approved: bool) -> Result<(), String> {
    match step.kind {
        Kind::Check => match &step.refused {
            Some(why) => Err(why.clone()),
            None => Ok(()),
        },
        Kind::Action if approved => Ok(()),
        Kind::Action => Err("an action runs only with an approval".into()),
        Kind::Decision => Err("a decision is recorded by a person, not run".into()),
    }
}

/// Does the output meet a machine-checkable expectation? `None` when the expectation is prose
/// (the human judges it).
pub fn matches(expect: &str, output: &str) -> Option<bool> {
    let e = expect.trim();
    if e.len() >= 2 && e.starts_with('`') && e.ends_with('`') {
        return Some(output.contains(&e[1..e.len() - 1]));
    }
    if e.len() >= 2 && e.starts_with('/') && e.ends_with('/') {
        return regex_lite(&e[1..e.len() - 1], output);
    }
    None
}

/// A `/pattern/` expectation, when it compiles; else it is not machine-checkable. The output's final line break
/// is not part of it (a command's output ends with one: `/^[0-9]+$/` is meant to match `grep -c`'s `3`).
fn regex_lite(pattern: &str, output: &str) -> Option<bool> {
    regex::Regex::new(pattern)
        .ok()
        .map(|r| r.is_match(output.trim_end_matches(['\n', '\r'])))
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StepOutput {
    pub exit_code: i32,
    /// stdout and stderr, secrets masked, the last 20 000 characters
    pub output: String,
    pub matched: Option<bool>,
    pub ms: u64,
}

/// Runs a step's command in the project with `sh -c` (`env`: Vault's, for an action), up to `limit`.
/// The policy is the caller's ([`policy::read_only`] for a check, an approval for an action).
pub fn run(
    cmd: &dyn Fn(&str) -> Command,
    root: &Path,
    step: &Step,
    env: &[(String, String)],
    limit: Duration,
) -> StepOutput {
    let t0 = std::time::Instant::now();
    let mut c = cmd("sh");
    c.arg("-c")
        .arg(&step.command)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (k, v) in env {
        c.env(k, v);
    }
    let mut child = match c.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            return StepOutput {
                exit_code: -1,
                output: e.to_string(),
                ..Default::default()
            }
        }
    };
    // the output is read while it runs (a full pipe would block the child)
    let mut so = child.stdout.take();
    let mut se = child.stderr.take();
    let ro = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(o) = so.as_mut() {
            let _ = std::io::Read::read_to_string(o, &mut s);
        }
        s
    });
    let re = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(o) = se.as_mut() {
            let _ = std::io::Read::read_to_string(o, &mut s);
        }
        s
    });
    let code = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code().unwrap_or(-1),
            Ok(None) if t0.elapsed() > limit => {
                let _ = child.kill();
                let _ = child.wait();
                break -2;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => break -1,
        }
    };
    let mut out = ro.join().unwrap_or_default();
    let err = re.join().unwrap_or_default();
    if !err.trim().is_empty() {
        if !out.is_empty() && !out.ends_with('\n') {
            out.push('\n');
        }
        out.push_str(&err);
    }
    if code == -2 {
        out.push_str(&format!("\n(stopped after {} s)", limit.as_secs()));
    }
    let masked = tutor_protect::redact::current().mask(&out);
    let n = masked.chars().count();
    let output = if n > 20_000 {
        masked.chars().skip(n - 20_000).collect()
    } else {
        masked
    };
    let checkable = matches(&step.expect, "").is_some();
    StepOutput {
        exit_code: code,
        matched: if code == 0 {
            matches(&step.expect, &output)
        } else if checkable {
            Some(false)
        } else {
            None
        },
        output,
        ms: t0.elapsed().as_millis() as u64,
    }
}

#[cfg(test)]
mod tests;
