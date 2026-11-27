//! H0 (docs/v2/AUDIT-harness.md): measures the Co-Dev harness on real tasks, headless.
//!
//! A task is a folder of `evals/tasks/` with:
//! - `task.json` — `{id, title, language, category, prompt, check, test?, timeout?}`: `prompt` is the
//!   request as a person would type it, `check` the acceptance command (exit 0 = solved), `test` the
//!   project's own test command the agent gets as `run_tests`;
//! - `repo/` — the project as the agent finds it;
//! - `hidden/` — the acceptance tests, copied in only AFTER the agent finished (over anything the
//!   agent wrote with the same name), so it cannot read or bend them;
//! - `solution/` — a reference solution (files over `repo/`): `verify` proves each task is sound —
//!   `repo + hidden` fails the check and `repo + solution + hidden` passes it — with no model.
//!
//! A run uses the SAME harness as the IDE (`codev_agent::start`/`send`: tools, policy, system prompt,
//! project instructions) in Auto mode, in a fresh git repository per task. Nobody is at the keyboard:
//! the plan is approved, anything the policy still asks about is refused with a reason, and a question
//! (`ask_human`) is answered once with «decide yourself». The result per task: solved or not, turns,
//! requests, tokens (input, output, cache read/write), cost in dollars (when the model is priced),
//! seconds and tool calls; and the totals.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tutor_agent::{AgentEvent, TurnOutcome};

use crate::codev_agent::{self, StartSpec};

/// One task of the suite.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub language: String,
    /// `bugfix`, `feature`, `refactor`, `test`, `devops`…
    pub category: String,
    pub prompt: String,
    /// The acceptance command, run in the project after the hidden tests are copied in.
    pub check: String,
    /// The project's own test command (the agent's `run_tests`).
    #[serde(default)]
    pub test: Option<String>,
    /// Seconds the check may take (default 300).
    #[serde(default)]
    pub timeout: Option<u64>,
    #[serde(skip)]
    pub dir: PathBuf,
}

/// The answer to a question the agent asks during an evaluation (there is no human).
pub const NO_HUMAN: &str =
    "No human is available during this evaluation. Decide yourself, choosing the \
most reasonable option, and finish the task.";

/// Reads every `<dir>/*/task.json`, sorted by id. A task without `repo/` or `hidden/` is an error.
pub fn load_tasks(dir: &Path) -> Result<Vec<Task>, String> {
    let rd = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let mut out = vec![];
    for e in rd.flatten() {
        let p = e.path();
        let f = p.join("task.json");
        if !f.is_file() {
            continue;
        }
        let text = std::fs::read_to_string(&f).map_err(|e| format!("{}: {e}", f.display()))?;
        let mut t: Task =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", f.display()))?;
        if p.file_name().and_then(|n| n.to_str()) != Some(t.id.as_str()) {
            return Err(format!("{}: the id must be the folder's name", f.display()));
        }
        for sub in ["repo", "hidden"] {
            if !p.join(sub).is_dir() {
                return Err(format!("{}: no {sub}/", p.display()));
            }
        }
        if t.prompt.trim().is_empty() || t.check.trim().is_empty() {
            return Err(format!("{}: prompt and check are required", f.display()));
        }
        t.dir = p;
        out.push(t);
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    for e in std::fs::read_dir(from)
        .map_err(|e| format!("{}: {e}", from.display()))?
        .flatten()
    {
        let src = e.path();
        let dst = to.join(e.file_name());
        if src.is_dir() {
            std::fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
            copy_tree(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst).map_err(|e| format!("{}: {e}", src.display()))?;
        }
    }
    Ok(())
}

fn git(dir: &Path, args: &[&str]) -> bool {
    crate::shellenv::command("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "dxtutor-eval")
        .env("GIT_AUTHOR_EMAIL", "eval@dxtutor.invalid")
        .env("GIT_COMMITTER_NAME", "dxtutor-eval")
        .env("GIT_COMMITTER_EMAIL", "eval@dxtutor.invalid")
        .output()
        .is_ok_and(|o| o.status.success())
}

/// A fresh project for a task: `repo/` (and `solution/` over it), a git repository with one commit
/// (checkpoints need git) and the eval author as its user.
pub fn prepare(t: &Task, into: &Path, with_solution: bool) -> Result<PathBuf, String> {
    let dir = into.join(&t.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    copy_tree(&t.dir.join("repo"), &dir)?;
    if with_solution {
        let s = t.dir.join("solution");
        if !s.is_dir() {
            return Err(format!("{}: no solution/", t.id));
        }
        copy_tree(&s, &dir)?;
    }
    let ok = git(&dir, &["init", "-q", "--initial-branch=main"])
        && git(&dir, &["config", "user.name", "dxtutor-eval"])
        && git(&dir, &["config", "user.email", "eval@dxtutor.invalid"])
        && git(&dir, &["add", "-A"])
        && git(&dir, &["commit", "-q", "-m", "task"]);
    if !ok {
        return Err(format!("{}: git init failed", t.id));
    }
    Ok(dir)
}

/// Copies `hidden/` in and runs the check: `(passed, the end of its output, seconds)`.
pub fn check(t: &Task, dir: &Path) -> Result<(bool, String, f64), String> {
    copy_tree(&t.dir.join("hidden"), dir)?;
    let start = Instant::now();
    let limit = Duration::from_secs(t.timeout.unwrap_or(300));
    let log = dir.join(".dxtutor-eval-check.log");
    let out = std::fs::File::create(&log).map_err(|e| e.to_string())?;
    let err = out.try_clone().map_err(|e| e.to_string())?;
    let mut child = crate::shellenv::command("sh")
        .arg("-c")
        .arg(&t.check)
        .current_dir(dir)
        .stdin(std::process::Stdio::null())
        .stdout(out)
        .stderr(err)
        .spawn()
        .map_err(|e| format!("{}: {e}", t.check))?;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if start.elapsed() < limit => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let text = std::fs::read_to_string(&log).unwrap_or_default();
    let _ = std::fs::remove_file(&log);
    let tail: String = {
        let lines: Vec<&str> = text.lines().collect();
        lines[lines.len().saturating_sub(15)..].join("\n")
    };
    let secs = start.elapsed().as_secs_f64();
    match status {
        Some(s) => Ok((s.success(), tail, secs)),
        None => Ok((
            false,
            format!("check timed out after {} s\n{tail}", limit.as_secs()),
            secs,
        )),
    }
}

/// Is the task sound? `repo + hidden` must fail the check; `repo + solution + hidden` must pass it.
pub fn verify(t: &Task, scratch: &Path) -> Result<(), String> {
    let base = prepare(t, &scratch.join("base"), false)?;
    let (passed, out, _) = check(t, &base)?;
    if passed {
        return Err(format!(
            "{}: the unsolved project already passes the check",
            t.id
        ));
    }
    let sol = prepare(t, &scratch.join("solution"), true)?;
    let (passed, out2, _) = check(t, &sol)?;
    if !passed {
        return Err(format!(
            "{}: the reference solution fails the check:\n{out2}\n(unsolved:\n{out})",
            t.id
        ));
    }
    Ok(())
}

/// How a run is configured.
#[derive(Debug, Clone)]
pub struct RunConfig {
    pub provider: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    /// Where the provider keys are (`keys.json`), besides the keychain and the environment.
    pub key_dir: PathBuf,
    /// Where the projects and the sessions of the run go.
    pub scratch: PathBuf,
    /// Follow-up turns after a question (`ask_human`).
    pub max_followups: u32,
}

/// The tokens of a run, summed over its requests.
#[derive(Debug, Clone, Default, Serialize, PartialEq)]
pub struct Tokens {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
}

/// What one task gave.
#[derive(Debug, Clone, Serialize)]
pub struct TaskResult {
    pub id: String,
    pub language: String,
    pub category: String,
    pub solved: bool,
    /// `done`, `iteration_limit`, `refused`, `cancelled` or `error: …` (the last turn).
    pub outcome: String,
    pub turns: u32,
    pub requests: u32,
    pub tokens: Tokens,
    /// `None` when the model has no price in `tutor_agent::cost`.
    pub cost_usd: Option<f64>,
    pub agent_seconds: f64,
    pub check_seconds: f64,
    pub tools: BTreeMap<String, u32>,
    /// Approvals the policy asked for and the run refused (nobody to say yes).
    pub refused: u32,
    /// The notices the session gave (e.g. «no OS sandbox on this machine»).
    pub notices: Vec<String>,
    /// H1: the agent's commands ran in the OS sandbox (no notice said otherwise).
    pub sandboxed: bool,
    pub check_output: String,
}

fn outcome_name(o: &Result<TurnOutcome, String>) -> String {
    match o {
        Ok(TurnOutcome::Done { .. }) => "done".into(),
        Ok(TurnOutcome::IterationLimit) => "iteration_limit".into(),
        Ok(TurnOutcome::Refused { .. }) => "refused".into(),
        Ok(TurnOutcome::Cancelled) => "cancelled".into(),
        Err(e) => format!("error: {e}"),
    }
}

/// Runs one task with the IDE's harness and checks it.
pub fn run_task(t: &Task, cfg: &RunConfig) -> TaskResult {
    let mut r = TaskResult {
        id: t.id.clone(),
        language: t.language.clone(),
        category: t.category.clone(),
        solved: false,
        outcome: String::new(),
        turns: 0,
        requests: 0,
        tokens: Tokens::default(),
        cost_usd: None,
        agent_seconds: 0.0,
        check_seconds: 0.0,
        tools: BTreeMap::new(),
        refused: 0,
        notices: vec![],
        sandboxed: false,
        check_output: String::new(),
    };
    let dir = match prepare(t, &cfg.scratch.join("projects"), false) {
        Ok(d) => d,
        Err(e) => {
            r.outcome = format!("error: {e}");
            return r;
        }
    };
    let spec = StartSpec {
        root: dir.display().to_string(),
        model: cfg.model.clone(),
        effort: cfg.effort.clone(),
        test_cmd: t.test.clone(),
        mode: Some("auto".into()),
        provider: Some(cfg.provider.clone()),
        sessions_base: Some(cfg.scratch.join("sessions")),
        host_tools_v8: vec![std::sync::Arc::new(crate::codeintel::OutlineTool)],
        ollama_host: Some(tutor_llm::chat::ollama_host()),
        lang: Some("en".into()),
        ..Default::default()
    };
    let key_dir = cfg.key_dir.clone();
    let id = match codev_agent::start(
        spec,
        &|p| crate::keys::resolve(&key_dir, p),
        crate::keys::anthropic_workspace_id(),
    ) {
        Ok(id) => id,
        Err(e) => {
            r.outcome = format!("error: {e}");
            return r;
        }
    };
    let model = codev_agent::resolve_model(&cfg.provider, cfg.model.as_deref());
    let started = Instant::now();
    let mut text = Some(t.prompt.clone());
    let mut cost = 0.0;
    let mut priced = true;
    loop {
        let mut question = false;
        let sid = id.clone();
        let mut refused = 0;
        let res = codev_agent::send(
            &id,
            text.take(),
            Some(tutor_agent::permissions::Origin {
                kind: tutor_agent::permissions::OriginKind::Chat,
                issue: None,
                by: String::new(),
                scope: vec![],
                template: None,
            }),
            &mut |e| match e {
                AgentEvent::Usage { request, .. } => {
                    r.requests += 1;
                    r.tokens.input += request.input_tokens;
                    r.tokens.output += request.output_tokens;
                    r.tokens.cache_read += request.cache_read_input_tokens;
                    r.tokens.cache_write += request.cache_creation_input_tokens;
                    match tutor_agent::cost::cost_usd(&model, &request) {
                        Some(c) => cost += c,
                        None => priced = false,
                    }
                }
                AgentEvent::ToolStart { name, .. } => *r.tools.entry(name).or_default() += 1,
                AgentEvent::Question { .. } => question = true,
                AgentEvent::Notice { text } => r.notices.push(text),
                _ => {}
            },
            &mut |req| {
                // nobody at the keyboard: the plan goes ahead; anything else the policy asks is refused
                let allow = req.call.name == "exit_plan";
                if !allow {
                    refused += 1;
                }
                codev_agent::approve(
                    &sid,
                    &req.call.id,
                    allow,
                    (!allow).then(|| format!("{} (refused: {})", NO_HUMAN, req.reason)),
                    false,
                );
            },
        );
        r.turns += 1;
        r.refused += refused;
        r.outcome = outcome_name(&res);
        if !(question && res.is_ok() && r.turns <= cfg.max_followups) {
            break;
        }
        text = Some(NO_HUMAN.to_string());
    }
    r.agent_seconds = started.elapsed().as_secs_f64();
    r.sandboxed = !r
        .notices
        .iter()
        .any(|n| n.contains("sem sandbox") || n.contains("sandbox desligada"));
    r.cost_usd = priced.then_some(cost);
    codev_agent::close(&id);
    match check(t, &dir) {
        Ok((ok, out, secs)) => {
            r.solved = ok;
            r.check_output = out;
            r.check_seconds = secs;
        }
        Err(e) => r.check_output = e,
    }
    r
}

/// The totals of a run.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Summary {
    pub tasks: usize,
    pub solved: usize,
    pub rate: f64,
    pub tokens: Tokens,
    pub cost_usd: Option<f64>,
    pub agent_seconds: f64,
    pub by_language: BTreeMap<String, (usize, usize)>,
    pub by_category: BTreeMap<String, (usize, usize)>,
}

pub fn summarize(rs: &[TaskResult]) -> Summary {
    let mut s = Summary {
        tasks: rs.len(),
        cost_usd: Some(0.0),
        ..Default::default()
    };
    for r in rs {
        s.solved += usize::from(r.solved);
        s.tokens.input += r.tokens.input;
        s.tokens.output += r.tokens.output;
        s.tokens.cache_read += r.tokens.cache_read;
        s.tokens.cache_write += r.tokens.cache_write;
        s.agent_seconds += r.agent_seconds;
        s.cost_usd = match (s.cost_usd, r.cost_usd) {
            (Some(a), Some(b)) => Some(a + b),
            _ => None,
        };
        for (map, key) in [
            (&mut s.by_language, &r.language),
            (&mut s.by_category, &r.category),
        ] {
            let e = map.entry(key.clone()).or_default();
            e.0 += usize::from(r.solved);
            e.1 += 1;
        }
    }
    s.rate = if s.tasks == 0 {
        0.0
    } else {
        s.solved as f64 / s.tasks as f64
    };
    s
}

/// The report in Markdown (the JSON has every field).
pub fn markdown(model: &str, rs: &[TaskResult], s: &Summary) -> String {
    let money = |c: Option<f64>| c.map_or("—".to_string(), |v| format!("${v:.2}"));
    let mut out = format!(
        "# Co-Dev harness evaluation\n\nModel: `{model}` · {} of {} solved ({:.0} %) · tokens in {} / out {} / cache read {} / cache write {} · cost {} · {:.0} s of agent time\n\n",
        s.solved,
        s.tasks,
        s.rate * 100.0,
        s.tokens.input,
        s.tokens.output,
        s.tokens.cache_read,
        s.tokens.cache_write,
        money(s.cost_usd),
        s.agent_seconds
    );
    let sandboxed = rs.iter().filter(|r| r.sandboxed).count();
    out.push_str(&format!(
        "Commands in the OS sandbox: {sandboxed} of {} tasks.\n\n",
        rs.len()
    ));
    out.push_str("| Task | Lang | Kind | Solved | Outcome | Turns | Requests | Out tokens | Cost | Seconds | Refused |\n|---|---|---|---|---|---|---|---|---|---|---|\n");
    for r in rs {
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {:.0} | {} |\n",
            r.id,
            r.language,
            r.category,
            if r.solved { "✅" } else { "✗" },
            r.outcome,
            r.turns,
            r.requests,
            r.tokens.output,
            money(r.cost_usd),
            r.agent_seconds,
            r.refused
        ));
    }
    out.push_str("\n| Language | Solved |\n|---|---|\n");
    for (k, (a, b)) in &s.by_language {
        out.push_str(&format!("| {k} | {a}/{b} |\n"));
    }
    out.push_str("\n| Kind | Solved |\n|---|---|\n");
    for (k, (a, b)) in &s.by_category {
        out.push_str(&format!("| {k} | {a}/{b} |\n"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suite() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../evals/tasks")
    }

    #[test]
    fn the_suite_has_at_least_thirty_well_formed_tasks_in_several_languages() {
        let ts = load_tasks(&suite()).unwrap();
        assert!(ts.len() >= 30, "{} tasks", ts.len());
        for t in &ts {
            assert!(t.dir.join("solution").is_dir(), "{}: no solution/", t.id);
        }
        let langs: std::collections::BTreeSet<&str> =
            ts.iter().map(|t| t.language.as_str()).collect();
        assert!(langs.len() >= 4, "{langs:?}");
    }

    #[test]
    fn a_result_set_is_summed_by_language_and_kind() {
        let r = |id: &str, lang: &str, solved: bool, cost: Option<f64>| TaskResult {
            id: id.into(),
            language: lang.into(),
            category: "bugfix".into(),
            solved,
            outcome: "done".into(),
            turns: 1,
            requests: 3,
            tokens: Tokens {
                input: 10,
                output: 5,
                cache_read: 2,
                cache_write: 1,
            },
            cost_usd: cost,
            agent_seconds: 2.0,
            check_seconds: 1.0,
            tools: BTreeMap::new(),
            refused: 0,
            notices: vec![],
            sandboxed: true,
            check_output: String::new(),
        };
        let rs = vec![
            r("a", "rust", true, Some(0.5)),
            r("b", "rust", false, Some(0.25)),
            r("c", "go", true, Some(0.25)),
        ];
        let s = summarize(&rs);
        assert_eq!((s.solved, s.tasks), (2, 3));
        assert_eq!(s.by_language["rust"], (1, 2));
        assert_eq!(s.cost_usd, Some(1.0));
        assert_eq!(s.tokens.output, 15);
        let md = markdown("m", &rs, &s);
        assert!(md.contains("2 of 3 solved (67 %)"), "{md}");
        let s2 = summarize(&[r("a", "rust", true, None)]);
        assert_eq!(s2.cost_usd, None, "an unpriced model gives no total");
    }
}
