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
    /// Comes with the IDE (`/backlog`, `/project`); a project command with the same name wins.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub builtin: bool,
}

/// `/backlog <contexto>`: o Co-Dev investiga a pasta e propõe o backlog (`backlog_propose`).
pub const BACKLOG_COMMAND: &str = "backlog";
/// `/project <contexto>`: o Co-Dev propõe o Project a partir do backlog (`project_propose`).
pub const PROJECT_COMMAND: &str = "project";

const BACKLOG_BODY: &str = "Build the product backlog of this project and propose it with the `backlog_propose` tool.

Context from the human: $ARGUMENTS

1. Investigate first, read-only: the README and docs, the manifests (package.json, Cargo.toml, pyproject.toml, go.mod…), the source tree (`glob`, `grep`, `outline`), the tests, any architecture (`*.arch.json`, docs/architecture, .dxtutor/architecture.toml) and the current `.dxtutor/backlog.json` if there is one. An empty folder is fine: then the backlog comes from the context alone, and the scopes are the paths the code will have.
2. Group the work in epics. Each issue is small (1 to 8 points), as independent as it can be, and says WHERE it lives in the code:
   - `scope`: the real files or folders it changes or creates, relative to the project (globs such as `src/orders/**` are allowed). A file that does not exist yet is listed with the path it will have.
   - `acceptance`: 1 to 5 criteria, each in Given/When/Then (Dado/Quando/Então in Portuguese).
   - a story has `storyAs`, `storyWant` and `storySo`; a bug, a task or a spike says what and why in `description`.
   - `deps`: the refs of the issues that must be done first (no cycles). When the context names a Studio component, put it in `component`.
3. Write the titles, stories and criteria in the language the human writes in; keep paths and code identifiers as they are.
4. Call `backlog_propose` once with the whole backlog. If it returns problems, fix them and call it again. Change no other file.
5. End with a short summary and the next step: `/project <context>` (method, sprint length, capacity, team) creates the Project from it.";

const PROJECT_BODY: &str = "Create this folder's Project (the IDE's board) from the backlog in `.dxtutor/backlog.json`, and propose it with the `project_propose` tool.

Context from the human: $ARGUMENTS

1. Read `.dxtutor/backlog.json`. If it does not exist, tell the human to run `/backlog <context>` first, and stop.
2. From the context, choose the method (`kanban`, `scrum`, `xp` or `scrumxp`; Kanban when nothing is said) and the iteration length in days. Except for Kanban, plan the sprints in order: each with a name, a goal and the refs of its issues — dependencies first, then by priority. When the human gives a capacity or a velocity, no sprint goes over it. Issues in no sprint stay in the product backlog.
3. Add a Definition of Ready or of Done only when the context asks for one.
4. Call `project_propose` once; if it returns problems, fix them and call it again. Nothing is created until the human confirms it in the chat.
5. Summarise the plan in a few lines.";

/// Os comandos que vêm com o IDE.
pub fn builtin_commands() -> Vec<Command> {
    vec![
        Command {
            name: BACKLOG_COMMAND.into(),
            description: "Co-Dev drafts the product backlog from this folder and your context"
                .into(),
            body: BACKLOG_BODY.into(),
            builtin: true,
        },
        Command {
            name: PROJECT_COMMAND.into(),
            description: "Co-Dev plans the Project (method, sprints) from .dxtutor/backlog.json"
                .into(),
            body: PROJECT_BODY.into(),
            builtin: true,
        },
    ]
}

/// Os comandos do projecto e, depois, os do IDE que o projecto não substitui.
pub fn all_commands(root: &Path) -> Vec<Command> {
    let mut v = commands(root);
    let own: Vec<String> = v.iter().map(|c| c.name.clone()).collect();
    v.extend(
        builtin_commands()
            .into_iter()
            .filter(|c| !own.contains(&c.name)),
    );
    v
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
                builtin: false,
            })
        })
        .collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

/// Expande `/nome argumentos` num comando do projecto (ou, sem um com esse nome, do IDE).
/// `None` se não for um comando.
pub fn expand(root: &Path, input: &str) -> Option<(String, String)> {
    let rest = input.trim_start().strip_prefix('/')?;
    let (name, args) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    let cmd = all_commands(root).into_iter().find(|c| c.name == name)?;
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
    fn the_ide_commands_expand_unless_the_project_has_its_own() {
        let d = tempfile::tempdir().unwrap();
        let (name, prompt) = expand(d.path(), "/backlog a shop with orders").unwrap();
        assert_eq!(name, "backlog");
        assert!(prompt.contains("Context from the human: a shop with orders"));
        assert!(prompt.contains("`backlog_propose`"));
        assert!(expand(d.path(), "/project scrum, 2 weeks")
            .unwrap()
            .1
            .contains("`project_propose`"));
        let all = all_commands(d.path());
        assert!(all.iter().all(|c| c.builtin));
        put(
            d.path(),
            ".dxtutor/commands/backlog.md",
            "Our own: $ARGUMENTS",
        );
        assert_eq!(expand(d.path(), "/backlog x").unwrap().1, "Our own: x");
        let all = all_commands(d.path());
        assert_eq!(all.iter().filter(|c| c.name == "backlog").count(), 1);
        assert!(!all.iter().find(|c| c.name == "backlog").unwrap().builtin);
        assert!(commands(d.path()).iter().all(|c| !c.builtin));
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
