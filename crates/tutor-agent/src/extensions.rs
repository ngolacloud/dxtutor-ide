//! Extensões do projecto (F7): slash commands e skills definidos em `.dxtutor/`.
//!
//! - **Comandos**: `.dxtutor/commands/<nome>.md` — o corpo é um prompt; `$ARGUMENTS` é
//!   substituído pelo resto da linha (`/rever src/lexer.rs`). A primeira linha `description:`
//!   (ou a primeira linha de texto) descreve-o.
//! - **Skills**: `.dxtutor/skills/<nome>/SKILL.md` com cabeçalho `name:`/`description:`. O
//!   índice (nome + descrição) entra no system prompt; o conteúdo completo só é lido quando
//!   o modelo o pede com a ferramenta `skill` — contexto gasto só quando é preciso.
//!
//! Os comandos e as skills são texto (prompts), não código: não precisam da confiança que os
//! hooks e os servidores MCP exigem.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::tool::{Tool, ToolCtx, ToolOutput};

pub const COMMANDS_DIR: &str = ".dxtutor/commands";
pub const SKILLS_DIR: &str = ".dxtutor/skills";
const MAX_BODY: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Command {
    pub name: String,
    pub description: String,
    #[serde(skip)]
    pub body: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    #[serde(skip)]
    pub path: PathBuf,
}

fn valid_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 64
        && n.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Separa um cabeçalho `---\nchave: valor\n---` do corpo.
fn front_matter(text: &str) -> (Vec<(String, String)>, String) {
    let t = text.trim_start_matches('\u{feff}');
    if let Some(rest) = t
        .strip_prefix("---\n")
        .or_else(|| t.strip_prefix("---\r\n"))
    {
        if let Some(end) = rest.find("\n---") {
            let head = &rest[..end];
            let body = rest[end + 4..]
                .trim_start_matches(['\r', '\n', '-'])
                .to_string();
            let kv = head
                .lines()
                .filter_map(|l| l.split_once(':'))
                .map(|(k, v)| {
                    (
                        k.trim().to_ascii_lowercase(),
                        v.trim().trim_matches('"').to_string(),
                    )
                })
                .collect();
            return (kv, body);
        }
    }
    (vec![], t.to_string())
}

fn get<'a>(kv: &'a [(String, String)], k: &str) -> Option<&'a str> {
    kv.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str())
}

/// Os comandos do projecto, por nome.
pub fn commands(root: &Path) -> Vec<Command> {
    let Ok(rd) = std::fs::read_dir(root.join(COMMANDS_DIR)) else {
        return vec![];
    };
    let mut v: Vec<Command> = rd
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .filter_map(|p| {
            let name = p.file_stem()?.to_string_lossy().to_string();
            if !valid_name(&name) {
                return None;
            }
            let text = std::fs::read_to_string(&p).ok()?;
            let (kv, body) = front_matter(&text);
            let description = get(&kv, "description")
                .map(String::from)
                .or_else(|| {
                    body.lines()
                        .find(|l| !l.trim().is_empty())
                        .map(|l| l.trim_start_matches('#').trim().to_string())
                })
                .unwrap_or_default();
            Some(Command {
                name,
                description: description.chars().take(160).collect(),
                body: body.chars().take(MAX_BODY).collect(),
            })
        })
        .collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

/// Expande `/nome argumentos` num comando do projecto. `None` se não for um comando dele.
pub fn expand(root: &Path, input: &str) -> Option<(String, String)> {
    let rest = input.trim_start().strip_prefix('/')?;
    let (name, args) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    let cmd = commands(root).into_iter().find(|c| c.name == name)?;
    let args = args.trim();
    let prompt = if cmd.body.contains("$ARGUMENTS") {
        cmd.body.replace("$ARGUMENTS", args)
    } else if args.is_empty() {
        cmd.body.clone()
    } else {
        format!("{}\n\n{args}", cmd.body.trim_end())
    };
    Some((cmd.name, prompt))
}

/// As skills do projecto, por nome.
pub fn skills(root: &Path) -> Vec<Skill> {
    let Ok(rd) = std::fs::read_dir(root.join(SKILLS_DIR)) else {
        return vec![];
    };
    let mut v: Vec<Skill> = rd
        .filter_map(Result::ok)
        .map(|e| e.path().join("SKILL.md"))
        .filter(|p| p.is_file())
        .filter_map(|p| {
            let dir = p.parent()?.file_name()?.to_string_lossy().to_string();
            let (kv, _) = front_matter(&std::fs::read_to_string(&p).ok()?);
            let name = get(&kv, "name").unwrap_or(&dir).to_string();
            if !valid_name(&name) {
                return None;
            }
            let description = get(&kv, "description")
                .unwrap_or("")
                .chars()
                .take(300)
                .collect();
            Some(Skill {
                name,
                description,
                path: p,
            })
        })
        .collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

/// O índice das skills para o system prompt (vazio se não houver).
pub fn skills_index(root: &Path) -> Option<String> {
    let s = skills(root);
    (!s.is_empty()).then(|| {
        let list: Vec<String> = s
            .iter()
            .map(|k| format!("- {}: {}", k.name, k.description))
            .collect();
        format!(
            "Skills do projecto (instruções especializadas; lê a que se aplicar com a ferramenta \
             `skill` antes de começar essa tarefa):\n{}",
            list.join("\n")
        )
    })
}

/// `skill`: devolve o conteúdo de uma skill do projecto.
pub struct SkillTool;

impl Tool for SkillTool {
    fn name(&self) -> &str {
        "skill"
    }
    fn description(&self) -> &str {
        "Lê as instruções completas de uma skill do projecto (as disponíveis estão listadas no \
         system prompt). Usa-a antes de uma tarefa a que a skill se aplique."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let name = input["name"].as_str().unwrap_or_default();
        let all = skills(&ctx.root);
        let Some(s) = all.iter().find(|s| s.name == name) else {
            let names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
            return ToolOutput::err(format!(
                "skill desconhecida: {name} (disponíveis: {})",
                names.join(", ")
            ));
        };
        match std::fs::read_to_string(&s.path) {
            Ok(text) => {
                let others: Vec<String> = s
                    .path
                    .parent()
                    .and_then(|d| std::fs::read_dir(d).ok())
                    .map(|rd| {
                        rd.filter_map(Result::ok)
                            .map(|e| e.file_name().to_string_lossy().to_string())
                            .filter(|n| n != "SKILL.md")
                            .collect()
                    })
                    .unwrap_or_default();
                let mut out: String = text.chars().take(MAX_BODY).collect();
                if !others.is_empty() {
                    out.push_str(&format!(
                        "\n\n(ficheiros de apoio em {SKILLS_DIR}/{}: {})",
                        name,
                        others.join(", ")
                    ));
                }
                ToolOutput::ok(out)
            }
            Err(e) => ToolOutput::err(format!("{name}: {e}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn commands_expand_arguments() {
        let d = tempfile::tempdir().unwrap();
        put(
            d.path(),
            ".dxtutor/commands/rever.md",
            "---\ndescription: Revê um ficheiro\n---\nRevê $ARGUMENTS como sénior: bugs primeiro.",
        );
        put(
            d.path(),
            ".dxtutor/commands/testes.md",
            "# Corre e corrige os testes\nCorre os testes e corrige o que falhar.",
        );
        put(d.path(), ".dxtutor/commands/mau nome.md", "x");
        let c = commands(d.path());
        assert_eq!(
            c.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(),
            ["rever", "testes"]
        );
        assert_eq!(c[0].description, "Revê um ficheiro");
        assert_eq!(c[1].description, "Corre e corrige os testes");
        assert_eq!(
            expand(d.path(), "/rever src/a.rs").unwrap().1,
            "Revê src/a.rs como sénior: bugs primeiro."
        );
        assert_eq!(
            expand(d.path(), "/testes só o lexer").unwrap().1,
            "# Corre e corrige os testes\nCorre os testes e corrige o que falhar.\n\nsó o lexer"
        );
        assert!(expand(d.path(), "/nao-existe x").is_none());
        assert!(expand(d.path(), "sem barra").is_none());
    }

    #[test]
    fn skills_index_and_tool() {
        let d = tempfile::tempdir().unwrap();
        put(d.path(), ".dxtutor/skills/migracoes/SKILL.md", "---\nname: migracoes\ndescription: Como escrever migrações SQL\n---\n1. Nunca apagar colunas.");
        put(
            d.path(),
            ".dxtutor/skills/migracoes/exemplo.sql",
            "ALTER ...",
        );
        put(d.path(), ".dxtutor/skills/vazia/README.md", "sem SKILL.md");
        let idx = skills_index(d.path()).unwrap();
        assert!(idx.contains("- migracoes: Como escrever migrações SQL"));
        assert!(!idx.contains("vazia"));
        let ctx = ToolCtx {
            root: d.path().to_path_buf(),
            cancel: Default::default(),
        };
        let out = SkillTool.run(&json!({"name": "migracoes"}), &ctx);
        assert!(
            out.content.contains("Nunca apagar colunas") && out.content.contains("exemplo.sql")
        );
        assert!(SkillTool
            .run(&json!({"name": "x"}), &ctx)
            .content
            .contains("disponíveis: migracoes"));
        assert!(skills_index(&d.path().join("nada")).is_none());
    }
}
