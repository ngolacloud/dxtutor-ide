//! `git_status` e `git_diff` — só leitura, sem shell (argumentos fixos, `--` antes de caminhos).

use std::process::Command;
use std::time::Duration;

use serde_json::{json, Value};

use super::exec::run_process;
use crate::sandbox;
use crate::tool::{Tool, ToolCtx, ToolOutput};

fn git(args: &[&str], ctx: &ToolCtx) -> ToolOutput {
    let mut c = Command::new("git");
    c.args(args);
    let r = run_process(c, &ctx.root, Duration::from_secs(30), ctx);
    if r.ok() {
        let out = r.stdout.trim_end();
        ToolOutput::ok(if out.is_empty() {
            "(sem alterações)".to_string()
        } else {
            super::head_tail(out, 60_000)
        })
    } else {
        ToolOutput::err(r.render())
    }
}

pub struct GitStatus;

impl Tool for GitStatus {
    fn name(&self) -> &str {
        "git_status"
    }
    fn description(&self) -> &str {
        "Estado do repositório git: ramo actual e ficheiros alterados, staged e por seguir."
    }
    fn input_schema(&self) -> Value {
        json!({"type": "object", "properties": {}, "additionalProperties": false})
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, _input: &Value, ctx: &ToolCtx) -> ToolOutput {
        git(
            &[
                "status",
                "--porcelain=v1",
                "--branch",
                "--untracked-files=normal",
            ],
            ctx,
        )
    }
}

pub struct GitDiff;

impl Tool for GitDiff {
    fn name(&self) -> &str {
        "git_diff"
    }
    fn description(&self) -> &str {
        "Diff das alterações por commitar (ou só das staged com `staged: true`), opcionalmente \
         limitado a um caminho."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {"staged": {"type": "boolean"}, "path": {"type": "string"}},
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let mut args = vec!["diff", "--no-color", "--no-ext-diff"];
        if input["staged"].as_bool().unwrap_or(false) {
            args.push("--staged");
        }
        let rel;
        if let Some(p) = input["path"].as_str().filter(|p| !p.trim().is_empty()) {
            match sandbox::resolve(&ctx.root, p) {
                Ok(abs) => rel = sandbox::rel(&ctx.root, &abs),
                Err(e) => return ToolOutput::err(e),
            }
            args.push("--");
            args.push(&rel);
        }
        git(&args, ctx)
    }
}
