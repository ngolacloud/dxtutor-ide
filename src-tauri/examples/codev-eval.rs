//! H0: measures the Co-Dev harness on the task suite (`evals/tasks/`), headless, with the IDE's own
//! harness (`dxtutor_ide_lib::eval`).
//!
//! ```text
//! cargo run -p dxtutor-ide --example codev-eval -- verify [--only id,id]
//! cargo run -p dxtutor-ide --example codev-eval -- run [--only id,id] [--provider claude] [--model M]
//!                                                     [--effort high] [--out evals/results] [--followups 1]
//! ```
//! `verify` needs no model: each task's unsolved project must fail its check and the reference
//! solution must pass it. `run` spends tokens: the keys come from the keychain, the app's `keys.json`
//! (`DXTUTOR_CONFIG_DIR`, by default `~/.config/ao.ngolacloud.dxtutor-ide`) or the environment.

use std::path::PathBuf;

use dxtutor_ide_lib::eval;

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

fn main() {
    // the sandbox's network bridge (H1b) is this same binary when an allowlist is in use
    if let Some(code) = tutor_agent::net_proxy::bridge_main() {
        std::process::exit(code);
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let tasks_dir = arg(&args, "--tasks")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("evals/tasks"));
    let mut tasks = match eval::load_tasks(&tasks_dir) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if let Some(only) = arg(&args, "--only") {
        let ids: Vec<&str> = only.split(',').map(str::trim).collect();
        tasks.retain(|t| ids.contains(&t.id.as_str()));
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let scratch = std::env::temp_dir().join(format!("dxtutor-eval-{stamp}"));
    match args.first().map(String::as_str) {
        Some("verify") => {
            let mut bad = 0;
            for t in &tasks {
                match eval::verify(t, &scratch.join(&t.id)) {
                    Ok(()) => println!("ok    {}", t.id),
                    Err(e) => {
                        bad += 1;
                        println!("FAIL  {e}");
                    }
                }
            }
            println!("{} tasks, {} unsound", tasks.len(), bad);
            let _ = std::fs::remove_dir_all(&scratch);
            std::process::exit(i32::from(bad > 0));
        }
        Some("run") => {
            let provider = arg(&args, "--provider").unwrap_or_else(|| "claude".into());
            let model = arg(&args, "--model");
            let cfg = eval::RunConfig {
                provider: provider.clone(),
                model: model.clone(),
                effort: arg(&args, "--effort"),
                key_dir: std::env::var_os("DXTUTOR_CONFIG_DIR")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| {
                        PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
                            .join(".config/ao.ngolacloud.dxtutor-ide")
                    }),
                scratch: scratch.clone(),
                max_followups: arg(&args, "--followups")
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(1),
            };
            let model = dxtutor_ide_lib::codev_agent::resolve_model(&provider, model.as_deref());
            let mut results = vec![];
            for t in &tasks {
                eprintln!("… {}", t.id);
                let r = eval::run_task(t, &cfg);
                eprintln!(
                    "{} {} — {} · {} requests · {} out tokens · {}",
                    if r.solved { "✅" } else { "✗ " },
                    r.id,
                    r.outcome,
                    r.requests,
                    r.tokens.output,
                    r.cost_usd.map_or("—".into(), |c| format!("${c:.3}"))
                );
                results.push(r);
            }
            let s = eval::summarize(&results);
            let out = arg(&args, "--out")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.join("evals/results"));
            let _ = std::fs::create_dir_all(&out);
            let base = out.join(format!("{stamp}-{}", model.replace(['/', ':'], "-")));
            let json = serde_json::json!({ "model": model, "provider": provider, "summary": s, "results": results });
            let _ = std::fs::write(
                base.with_extension("json"),
                serde_json::to_string_pretty(&json).unwrap(),
            );
            let md = eval::markdown(&model, &results, &s);
            let _ = std::fs::write(base.with_extension("md"), &md);
            println!("{md}\nprojects and sessions kept in {}", scratch.display());
        }
        _ => {
            eprintln!("usage: codev-eval verify|run [--only id,id] [--provider P] [--model M] [--effort E] [--out DIR]");
            std::process::exit(2);
        }
    }
}
