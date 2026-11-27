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
//!                   [--mode auto|assist|manual] [--resume ID] [--output text|json|stream-json]
//! echo "explain src/lib.rs" | dxtutor-ide agent
//! ```
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
[--model M] [--effort low|medium|high|xhigh|max] [--mode auto|assist|manual] [--resume ID] \
[--output text|json|stream-json]   (without a request, it is read from stdin)";

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
                // nobody at the keyboard: the plan goes ahead; anything else the policy asks is refused
                let allow = req.call.name == "exit_plan";
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

/// `dxtutor-ide agent …`: `None` when the arguments are not for it (the app starts as usual).
pub fn from_args(args: &[String]) -> Option<i32> {
    if args.get(1).map(String::as_str) != Some("agent") {
        return None;
    }
    let mut a = match parse(&args[2..]) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{e}");
            return Some(2);
        }
    };
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
