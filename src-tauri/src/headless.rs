//! H6a (docs/v2/AUDIT-harness.md §6): `dxtutor-ide agent -p "<request>"` — the Co-Dev without a window, like
//! `claude -p` or `codex exec`, for scripts and CI. It is the SAME harness as the IDE (`codev_agent::start`/`send`:
//! tools, permission policy and the project's rules, OS sandbox, hooks and MCP the person trusted, the Project store and
//! the audit log, the saved sessions — a headless conversation can be resumed in the IDE and back).
//!
//! Nobody is at the keyboard: an approved plan goes ahead; anything else the policy asks is refused with the reason
//! (the turn goes on without it), and an `ask_human` question is answered once with «decide yourself». What may run
//! without asking is what the person's rules allow (`.dxtutor/permissions.json`, the user's) and the mode (`--mode`,
//! `auto` by default: a dangerous command still asks — and is refused here).
//!
//! ```text
//! dxtutor-ide agent -p "fix the failing test" [--cwd DIR] [--provider claude] [--model M] [--effort high]
//!                   [--mode auto|assist|manual] [--resume ID] [--plan] [--output text|json|stream-json]
//! echo "explain src/lib.rs" | dxtutor-ide agent
//! dxtutor-ide agent review [--base origin/develop] [--post 42]
//! ```
//! H6b: `review` reads the branch's changes since it left the base (`base...HEAD`) in a read-only run (the plan mode,
//! where not even a plan is approved) against the project's rules, and answers with Summary / Findings / Verdict;
//! `--post N` comments it on PR N with `gh` (the CI's `codev-review` workflow does that on each PR, when the repository
//! has a model key).
//! Exit codes: 0 the turn finished; 1 it could not run (no key, no folder, provider error); 2 usage; 3 it stopped
//! before finishing (iteration limit, refusal, cancelled).

use std::io::{IsTerminal, Read, Write};
use std::path::PathBuf;

use serde_json::{json, Value};
use tutor_agent::{AgentEvent, TurnOutcome};

use crate::codev_agent::{self, StartSpec};

const NO_HUMAN: &str =
    "No human is available (headless run). Decide yourself, choosing the most reasonable \
option, and finish the task.";

const USAGE: &str =
    "usage: dxtutor-ide agent [-p] <request> [--cwd DIR] [--provider claude|codex|gemini|ollama] \
[--model M] [--effort low|medium|high|xhigh|max] [--mode auto|assist|manual] [--resume ID] [--plan] \
[--output text|json|stream-json]   (without a request, it is read from stdin)\n\
       dxtutor-ide agent review [--base REF] [--post PR] [the options above]";

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Args {
    pub prompt: Option<String>,
    pub cwd: Option<PathBuf>,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub mode: String,
    pub resume: Option<String>,
    pub output: String,
    /// read-only: the plan mode, and here not even a plan is approved (`--plan`; a review always)
    pub plan: bool,
    /// H6b, `review`: the base the branch is compared with, and the PR to comment on
    pub base: Option<String>,
    pub post: Option<u64>,
}

/// The arguments after `agent`.
pub fn parse(args: &[String]) -> Result<Args, String> {
    let mut a = Args {
        mode: "auto".into(),
        output: "text".into(),
        ..Default::default()
    };
    let mut i = 0;
    let mut loose = vec![];
    while i < args.len() {
        let k = args[i].as_str();
        let mut value = |name: &str| -> Result<String, String> {
            i += 1;
            args.get(i)
                .cloned()
                .ok_or_else(|| format!("{name} needs a value"))
        };
        match k {
            "-p" | "--print" | "--prompt" => a.prompt = Some(value(k)?),
            "--cwd" | "-C" => a.cwd = Some(PathBuf::from(value(k)?)),
            "--provider" => a.provider = Some(value(k)?),
            "--model" => a.model = Some(value(k)?),
            "--effort" => a.effort = Some(value(k)?),
            "--mode" => a.mode = value(k)?,
            "--resume" => a.resume = Some(value(k)?),
            "--output" | "--output-format" => a.output = value(k)?,
            "--plan" | "--read-only" => a.plan = true,
            "--base" => a.base = Some(value(k)?),
            "--post" => {
                let v = value(k)?;
                a.post = Some(
                    v.parse()
                        .map_err(|_| format!("--post needs a PR number, not {v}"))?,
                )
            }
            "-h" | "--help" => return Err(USAGE.into()),
            s if s.starts_with('-') && s.len() > 1 => {
                return Err(format!("unknown option {s}\n{USAGE}"))
            }
            s => loose.push(s.to_string()),
        }
        i += 1;
    }
    if a.prompt.is_none() && !loose.is_empty() {
        a.prompt = Some(loose.join(" "));
    }
    if !matches!(a.mode.as_str(), "auto" | "assist" | "manual") {
        return Err(format!("--mode is auto, assist or manual (not {})", a.mode));
    }
    if !matches!(a.output.as_str(), "text" | "json" | "stream-json") {
        return Err(format!(
            "--output is text, json or stream-json (not {})",
            a.output
        ));
    }
    Ok(a)
}

/// The IDE's folders, as the app has them (`ao.ngolacloud.dxtutor-ide`): the keys' and the Project store's.
fn config_dir() -> PathBuf {
    std::env::var_os("DXTUTOR_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let base = std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config")
                });
            base.join("ao.ngolacloud.dxtutor-ide")
        })
}

fn data_dir() -> PathBuf {
    std::env::var_os("DXTUTOR_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let base = std::env::var_os("XDG_DATA_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".local/share")
                });
            base.join("ao.ngolacloud.dxtutor-ide")
        })
}

/// What a run ends with (the `json` output, and the last line of `stream-json`).
#[derive(Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub session_id: String,
    /// `done`, `iteration_limit`, `refused`, `cancelled` or `error: …`
    pub outcome: String,
    /// the last answer of the Co-Dev
    pub result: String,
    pub requests: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    /// `None`: the model has no price here
    pub cost_usd: Option<f64>,
    /// calls the policy asked about and nobody could approve
    pub refused: Vec<String>,
    pub notices: Vec<String>,
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

/// The exit code of an outcome.
pub fn exit_code(outcome: &str) -> i32 {
    match outcome {
        "done" => 0,
        o if o.starts_with("error") => 1,
        _ => 3,
    }
}

/// Runs one request headless; `emit` receives each event (for `stream-json`).
pub fn run(a: &Args, prompt: &str, emit: &mut dyn FnMut(&Value)) -> Outcome {
    let mut out = Outcome::default();
    let root = match a.cwd.clone().map(Ok).unwrap_or_else(std::env::current_dir) {
        Ok(r) => match r.canonicalize() {
            Ok(c) => c,
            Err(e) => {
                out.outcome = format!("error: {}: {e}", r.display());
                return out;
            }
        },
        Err(e) => {
            out.outcome = format!("error: {e}");
            return out;
        }
    };
    // the project's own test and lint commands (the root project of the workspace)
    let ws = tutor_agent::workspace::detect(&root);
    let here = ws.projects.iter().find(|p| p.path == ".");
    let db = data_dir().join("board.sqlite3");
    let db = db
        .parent()
        .is_some_and(|d| std::fs::create_dir_all(d).is_ok())
        .then_some(db);
    let lang = std::env::var("LANG")
        .ok()
        .filter(|l| l.starts_with("pt"))
        .map(|_| "pt".to_string())
        .unwrap_or_else(|| "en".to_string());
    let provider = a.provider.clone().unwrap_or_else(|| "claude".into());
    let spec = StartSpec {
        root: root.display().to_string(),
        model: a.model.clone(),
        effort: a.effort.clone(),
        test_cmd: here.and_then(|p| p.test.clone()),
        lint_cmd: here.and_then(|p| p.lint.clone()),
        mode: Some(a.mode.clone()),
        resume: a.resume.clone(),
        provider: Some(provider.clone()),
        host_tools_v8: vec![std::sync::Arc::new(crate::codeintel::OutlineTool)],
        host_tools_v13: vec![std::sync::Arc::new(crate::ide_tool::IdeTool {
            root: root.clone(),
            db: db.clone(),
            ops: false,
        })],
        host_tools_v14: vec![std::sync::Arc::new(crate::ide_tool::IdeTool {
            root: root.clone(),
            db: db.clone(),
            ops: true,
        })],
        trust_store: tutor_agent::trust::default_store(),
        user_mcp: tutor_agent::mcp::user_config(),
        ollama_host: Some(tutor_llm::chat::ollama_host()),
        change_log: db,
        lang: Some(lang),
        ..Default::default()
    };
    let key_dir = config_dir();
    let id = match codev_agent::start(
        spec,
        &|p| crate::keys::resolve(&key_dir, p),
        crate::keys::anthropic_workspace_id(),
    ) {
        Ok(id) => id,
        Err(e) => {
            out.outcome = format!("error: {e}");
            return out;
        }
    };
    out.session_id = id.clone();
    if a.plan {
        if let Err(e) = codev_agent::set_plan(&id, true) {
            out.outcome = format!("error: {e}");
            codev_agent::close(&id);
            return out;
        }
    }
    let read_only = a.plan;
    let model = codev_agent::resolve_model(&provider, a.model.as_deref());
    let (mut cost, mut priced) = (0.0, true);
    let mut text = Some(prompt.to_string());
    let mut answered_once = false;
    let res = loop {
        let mut question = false;
        let sid = id.clone();
        let mut refused = vec![];
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
            &mut |e| {
                if let Ok(v) = serde_json::to_value(&e) {
                    emit(&json!({"type": "event", "event": v}));
                }
                match e {
                    AgentEvent::Usage { request, .. } => {
                        out.requests += 1;
                        out.input_tokens += request.input_tokens;
                        out.output_tokens += request.output_tokens;
                        out.cache_read_tokens += request.cache_read_input_tokens;
                        out.cache_write_tokens += request.cache_creation_input_tokens;
                        match tutor_agent::cost::cost_usd(&model, &request) {
                            Some(c) => cost += c,
                            None => priced = false,
                        }
                    }
                    AgentEvent::Question { .. } => question = true,
                    AgentEvent::Notice { text } => out.notices.push(text),
                    _ => {}
                }
            },
            &mut |req| {
                // nobody at the keyboard: the plan goes ahead (never in a read-only run); anything else the
                // policy asks is refused
                let allow = req.call.name == "exit_plan" && !read_only;
                if !allow {
                    refused.push(format!("{}: {}", req.call.name, req.reason));
                }
                codev_agent::approve(
                    &sid,
                    &req.call.id,
                    allow,
                    (!allow).then(|| format!("{NO_HUMAN} (refused: {})", req.reason)),
                    false,
                );
            },
        );
        out.refused.extend(refused);
        if question && res.is_ok() && !answered_once {
            answered_once = true;
            text = Some(NO_HUMAN.to_string());
            continue;
        }
        break res;
    };
    out.outcome = outcome_name(&res);
    out.cost_usd = priced.then_some(cost);
    out.result = codev_agent::history(&id)
        .ok()
        .and_then(|h| {
            h.into_iter()
                .rev()
                .find(|m| m.role == "assistant")
                .map(|m| m.text)
        })
        .unwrap_or_default();
    codev_agent::close(&id);
    out
}

fn git(root: &std::path::Path, args: &[&str]) -> Result<String, String> {
    let o = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&o.stdout).to_string())
}

const REVIEW_DIFF_MAX: usize = 80_000;

/// H6b: the request of a review — the branch's changes since it left `base` (`base...HEAD`), and how to answer.
pub fn review_prompt(root: &std::path::Path, base: Option<&str>) -> Result<String, String> {
    let base = match base {
        Some(b) => b.to_string(),
        None => ["origin/HEAD", "origin/develop", "origin/main", "main"]
            .iter()
            .find(|b| git(root, &["rev-parse", "--verify", "--quiet", b]).is_ok())
            .map(|b| b.to_string())
            .ok_or("no base to compare with: pass --base <ref>")?,
    };
    let range = format!("{base}...HEAD");
    let stat = git(root, &["diff", "--stat", &range])?;
    if stat.trim().is_empty() {
        return Err(format!("nothing to review: no changes in {range}"));
    }
    let log = git(
        root,
        &[
            "log",
            "--oneline",
            "--no-decorate",
            &format!("{base}..HEAD"),
        ],
    )?;
    let mut diff = git(root, &["diff", "--no-color", &range])?;
    if diff.len() > REVIEW_DIFF_MAX {
        let mut cut = REVIEW_DIFF_MAX;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
        diff.push_str("\n… (the diff goes on: read the changed files for the rest)");
    }
    Ok(format!(
        "Review the changes of this branch against {base} as this project's reviewer. You only read: nothing is \
changed and no plan is approved.\n\n\
Check them against the project's own rules (its CLAUDE.md/AGENTS.md instructions above; `ide` action \
`arch.conformance` for the architect's rules when the project has them) and look for real defects: logic errors, \
edge cases, regressions, security risks (secrets, injection, permissions), missing or weakened tests, broken \
invariants. Read the changed files around each change before judging it; do not report style the tools would fix, \
and do not invent problems — if you find none that matter, say so.\n\n\
Answer in Markdown, exactly with these sections:\n\
## Summary — two or three sentences on what the change does.\n\
## Findings — one line each: `- **high|medium|low** `path:line` — the problem — why it matters — the fix`.\n\
## Verdict — `approve` or `request changes`, and why in one sentence.\n\n\
Commits:\n{log}\nFiles:\n{stat}\n```diff\n{diff}\n```"
    ))
}

/// H6b: `dxtutor-ide agent review` — a read-only review of the branch; with `--post N`, the answer becomes a comment
/// on PR N (`gh pr comment`).
fn review(mut a: Args) -> i32 {
    a.plan = true;
    let root = a
        .cwd
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let prompt = match review_prompt(&root, a.base.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let out = run(&a, &prompt, &mut |_| {});
    for n in &out.notices {
        eprintln!("· {n}");
    }
    if out.outcome != "done" {
        eprintln!("the review did not finish: {}", out.outcome);
        return exit_code(&out.outcome);
    }
    let model = codev_agent::resolve_model(
        a.provider.as_deref().unwrap_or("claude"),
        a.model.as_deref(),
    );
    let body = format!(
        "{}\n\n---\n_Co-Dev review (`dxtutor-ide agent review`, {model}): advisory; read-only, nothing was changed._",
        out.result.trim()
    );
    if a.output == "json" {
        println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default());
    } else {
        println!("{body}");
    }
    if let Some(pr) = a.post {
        let mut child = match std::process::Command::new("gh")
            .args(["pr", "comment", &pr.to_string(), "--body-file", "-"])
            .current_dir(&root)
            .stdin(std::process::Stdio::piped())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("gh: {e}");
                return 1;
            }
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(body.as_bytes());
        }
        match child.wait() {
            Ok(s) if s.success() => {}
            _ => {
                eprintln!("the review was not posted on PR {pr}");
                return 1;
            }
        }
    }
    0
}

/// `dxtutor-ide agent …`: `None` when the arguments are not for it (the app starts as usual).
pub fn from_args(args: &[String]) -> Option<i32> {
    if args.get(1).map(String::as_str) != Some("agent") {
        return None;
    }
    let is_review = args.get(2).map(String::as_str) == Some("review");
    let rest = if is_review { &args[3..] } else { &args[2..] };
    let mut a = match parse(rest) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return Some(2);
        }
    };
    if is_review {
        return Some(review(a));
    }
    if a.prompt.is_none() && !std::io::stdin().is_terminal() {
        let mut s = String::new();
        if std::io::stdin().read_to_string(&mut s).is_ok() && !s.trim().is_empty() {
            a.prompt = Some(s);
        }
    }
    let Some(prompt) = a.prompt.clone().filter(|p| !p.trim().is_empty()) else {
        eprintln!("{USAGE}");
        return Some(2);
    };
    let stream = a.output == "stream-json";
    let stdout = std::io::stdout();
    let out = run(&a, &prompt, &mut |v| {
        if stream {
            let mut o = stdout.lock();
            let _ = writeln!(o, "{v}");
            let _ = o.flush();
        }
    });
    match a.output.as_str() {
        "json" => println!("{}", serde_json::to_string_pretty(&out).unwrap_or_default()),
        "stream-json" => {
            println!("{}", json!({"type": "result", "result": out}))
        }
        _ => {
            for n in &out.notices {
                eprintln!("· {n}");
            }
            for r in &out.refused {
                eprintln!("✗ refused (no human): {r}");
            }
            if out.outcome.starts_with("error") {
                eprintln!("{}", out.outcome);
            } else {
                println!("{}", out.result.trim_end());
                if out.outcome != "done" {
                    eprintln!("stopped: {}", out.outcome);
                }
            }
        }
    }
    Some(exit_code(&out.outcome))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn arguments() {
        let a = parse(&s(&[
            "-p", "fix it", "--cwd", "/x", "--model", "m", "--output", "json",
        ]))
        .unwrap();
        assert_eq!(a.prompt.as_deref(), Some("fix it"));
        assert_eq!(a.cwd, Some(PathBuf::from("/x")));
        assert_eq!((a.mode.as_str(), a.output.as_str()), ("auto", "json"));
        let b = parse(&s(&["explain", "src/lib.rs", "--mode", "manual"])).unwrap();
        assert_eq!(b.prompt.as_deref(), Some("explain src/lib.rs"));
        assert_eq!(b.mode, "manual");
        assert!(parse(&s(&["--mode", "yolo"])).is_err());
        assert!(parse(&s(&["--output", "xml"])).is_err());
        assert!(parse(&s(&["--frobnicate"]))
            .unwrap_err()
            .contains("unknown option"));
        assert!(parse(&s(&["-p"])).unwrap_err().contains("needs a value"));
        let r = parse(&s(&["--base", "origin/develop", "--post", "42", "--plan"])).unwrap();
        assert_eq!(
            (r.base.as_deref(), r.post, r.plan),
            (Some("origin/develop"), Some(42), true)
        );
        assert!(parse(&s(&["--post", "x"])).is_err());
        assert_eq!(exit_code("done"), 0);
        assert_eq!(exit_code("error: no key"), 1);
        assert_eq!(exit_code("iteration_limit"), 3);
        // not for us: the app starts
        assert_eq!(from_args(&s(&["dxtutor-ide"])), None);
        assert_eq!(from_args(&s(&["dxtutor-ide", "--foo"])), None);
        assert_eq!(
            from_args(&s(&["dxtutor-ide", "agent", "--mode", "x"])),
            Some(2)
        );
    }

    /// H6b: the review's request — the branch's commits, files and diff since the base; nothing to review is said.
    #[test]
    fn the_review_prompt_holds_the_branch_changes() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        let g = |a: &[&str]| {
            let o = std::process::Command::new("git")
                .arg("-C")
                .arg(p)
                .args(a)
                .env("GIT_AUTHOR_NAME", "t")
                .env("GIT_AUTHOR_EMAIL", "t@e")
                .env("GIT_COMMITTER_NAME", "t")
                .env("GIT_COMMITTER_EMAIL", "t@e")
                .output()
                .unwrap();
            assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
        };
        g(&["init", "-q", "--initial-branch=main"]);
        std::fs::write(p.join("a.rs"), "fn a() {}\n").unwrap();
        g(&["add", "-A"]);
        g(&["commit", "-q", "-m", "base"]);
        assert!(review_prompt(p, Some("main"))
            .unwrap_err()
            .contains("nothing to review"));
        g(&["checkout", "-q", "-b", "feat"]);
        std::fs::write(p.join("a.rs"), "fn a() { unsafe_thing() }\n").unwrap();
        g(&["commit", "-qam", "make a unsafe"]);
        let q = review_prompt(p, Some("main")).unwrap();
        assert!(q.contains("against main") && q.contains("make a unsafe") && q.contains("a.rs"));
        assert!(q.contains("+fn a() { unsafe_thing() }"));
        assert!(q.contains("## Findings") && q.contains("## Verdict"));
        // no base given: the first that exists (here `main`)
        assert!(review_prompt(p, None).unwrap().contains("against main"));
    }

    /// A folder that does not exist: said, exit 1, no session, no event.
    #[test]
    fn a_missing_folder_fails_before_anything_starts() {
        let a = Args {
            cwd: Some(PathBuf::from("/nonexistent/dxtutor-headless-test")),
            mode: "auto".into(),
            output: "json".into(),
            ..Default::default()
        };
        let mut events = 0;
        let out = run(&a, "hello", &mut |_| events += 1);
        assert!(out.outcome.starts_with("error"), "{}", out.outcome);
        assert_eq!(exit_code(&out.outcome), 1);
        assert!(out.session_id.is_empty());
        assert_eq!(events, 0);
    }
}
