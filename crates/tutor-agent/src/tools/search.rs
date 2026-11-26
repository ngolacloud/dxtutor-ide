//! `glob` e `grep`, sobre o motor do ripgrep (`ignore`): respeitam `.gitignore`,
//! saltam `.git`, binários e ficheiros enormes.

use ignore::overrides::OverrideBuilder;
use ignore::WalkBuilder;
use regex::RegexBuilder;
use serde_json::{json, Value};

use super::looks_binary;
use crate::sandbox;
use crate::tool::{Tool, ToolCtx, ToolOutput};

const GLOB_MAX: usize = 500;
const GREP_MAX_FILES: usize = 300;
/// Linhas devolvidas em `mode: "content"`; o resto conta-se (o total vai na nota), para o
/// modelo saber se vale a pena restringir ou pedir a contagem por ficheiro.
const GREP_MAX_LINES: usize = 150;
const GREP_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;

/// Percorre `base` (dentro da raiz) e devolve os ficheiros que batem com `globs`.
fn walk(ctx: &ToolCtx, base: &str, globs: &[&str]) -> Result<Vec<std::path::PathBuf>, String> {
    let dir = if base.trim().is_empty() {
        sandbox::resolve(&ctx.root, ".")?
    } else {
        sandbox::resolve(&ctx.root, base)?
    };
    if !dir.is_dir() {
        return Err(format!("{base} não é uma pasta"));
    }
    let mut ob = OverrideBuilder::new(&dir);
    for g in globs.iter().filter(|g| !g.trim().is_empty()) {
        ob.add(g).map_err(|e| format!("padrão inválido {g}: {e}"))?;
    }
    let ov = ob.build().map_err(|e| e.to_string())?;
    let mut out = vec![];
    for ent in WalkBuilder::new(&dir)
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .require_git(false)
        .overrides(ov)
        .filter_entry(|e| e.file_name() != ".git")
        .build()
    {
        if ctx.cancelled() {
            return Err("cancelado".into());
        }
        let Ok(ent) = ent else { continue };
        if ent.file_type().is_some_and(|t| t.is_file()) {
            out.push(ent.into_path());
        }
    }
    out.sort();
    Ok(out)
}

pub struct Glob;

impl Tool for Glob {
    fn name(&self) -> &str {
        "glob"
    }
    fn description(&self) -> &str {
        "Lista ficheiros do projecto que batem com um padrão glob (ex.: `**/*.rs`, \
         `src/**/test_*.py`), respeitando o .gitignore. `path` restringe a uma subpasta."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {"pattern": {"type": "string"}, "path": {"type": "string"}},
            "required": ["pattern"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let pattern = input["pattern"].as_str().unwrap_or_default();
        let base = input["path"].as_str().unwrap_or("");
        match walk(ctx, base, &[pattern]) {
            Err(e) => ToolOutput::err(e),
            Ok(files) if files.is_empty() => {
                ToolOutput::ok(format!("nenhum ficheiro bate com {pattern}"))
            }
            Ok(files) => {
                let n = files.len();
                let mut out: Vec<String> = files
                    .iter()
                    .take(GLOB_MAX)
                    .map(|p| sandbox::rel(&ctx.root, p))
                    .collect();
                if n > GLOB_MAX {
                    out.push(format!(
                        "…[{} ficheiros a mais; restringe o padrão]",
                        n - GLOB_MAX
                    ));
                }
                ToolOutput::ok(out.join("\n"))
            }
        }
    }
}

pub struct Grep;

impl Tool for Grep {
    fn name(&self) -> &str {
        "grep"
    }
    fn description(&self) -> &str {
        "Procura uma expressão regular (sintaxe Rust/ripgrep) nos ficheiros do projecto. \
         `mode`: \"files\" (por omissão, só os ficheiros), \"content\" (linhas com número) \
         ou \"count\". `glob` filtra ficheiros (ex.: `*.ts`), `path` restringe a uma subpasta."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "path": {"type": "string"},
                "glob": {"type": "string"},
                "mode": {"enum": ["files", "content", "count"]},
                "ignore_case": {"type": "boolean"}
            },
            "required": ["pattern"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let pattern = input["pattern"].as_str().unwrap_or_default();
        let re = match RegexBuilder::new(pattern)
            .case_insensitive(input["ignore_case"].as_bool().unwrap_or(false))
            .build()
        {
            Ok(r) => r,
            Err(e) => return ToolOutput::err(format!("expressão inválida: {e}")),
        };
        let mode = input["mode"].as_str().unwrap_or("files");
        let globs: Vec<&str> = input["glob"].as_str().into_iter().collect();
        let files = match walk(ctx, input["path"].as_str().unwrap_or(""), &globs) {
            Ok(f) => f,
            Err(e) => return ToolOutput::err(e),
        };
        let mut out: Vec<String> = vec![];
        // `shown_*`: o que entra na resposta; `total_*`: tudo o que bateu (a nota diz quanto ficou de fora)
        let (mut shown_files, mut shown_lines) = (0usize, 0usize);
        let (mut total_files, mut total_lines) = (0usize, 0usize);
        for p in files {
            if ctx.cancelled() {
                return ToolOutput::err("cancelado");
            }
            if std::fs::metadata(&p)
                .map(|m| m.len() > GREP_MAX_FILE_BYTES)
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(bytes) = std::fs::read(&p) else {
                continue;
            };
            if looks_binary(&bytes) {
                continue;
            }
            let text = String::from_utf8_lossy(&bytes);
            let hits: Vec<(usize, &str)> = text
                .lines()
                .enumerate()
                .filter(|(_, l)| re.is_match(l))
                .collect();
            if hits.is_empty() {
                continue;
            }
            total_files += 1;
            total_lines += hits.len();
            if shown_files >= GREP_MAX_FILES || (mode == "content" && shown_lines >= GREP_MAX_LINES)
            {
                continue; // só conta
            }
            shown_files += 1;
            let rel = sandbox::rel(&ctx.root, &p);
            match mode {
                "content" => {
                    for (i, l) in hits {
                        if shown_lines >= GREP_MAX_LINES {
                            break;
                        }
                        let l: String = l.chars().take(300).collect();
                        out.push(format!("{rel}:{}: {}", i + 1, l.trim_end()));
                        shown_lines += 1;
                    }
                }
                "count" => out.push(format!("{rel}: {}", hits.len())),
                _ => out.push(rel),
            }
        }
        if out.is_empty() {
            return ToolOutput::ok(format!("sem resultados para /{pattern}/"));
        }
        let cut = match mode {
            "content" => shown_lines < total_lines,
            _ => shown_files < total_files,
        };
        if cut {
            let shown = if mode == "content" {
                format!("{shown_lines} de {total_lines} linhas")
            } else {
                format!("{shown_files} de {total_files} ficheiros")
            };
            out.push(format!(
                "…[mostradas {shown} ({total_lines} linhas em {total_files} ficheiros no total); \
                 restringe com path/glob ou uma expressão mais precisa, ou usa mode=\"count\" \
                 para ver onde se concentram]"
            ));
        }
        ToolOutput::ok(out.join("\n"))
    }
}
