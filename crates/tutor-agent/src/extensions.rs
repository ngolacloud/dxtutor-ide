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
        // H5b: the host answers it (`COMPACT_COMMAND_LINE`); listed so the person finds it
        Command {
            name: "compact".into(),
            description: "Summarize the conversation so far to free the context (Claude does it on the server)"
                .into(),
            body: String::new(),
            builtin: true,
        },
    ]
}

/// H5b: `/compact` — handled by the host (the conversation is summarized now), never expanded into a prompt.
pub const COMPACT_COMMAND_LINE: &str = "/compact";

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
    /// Comes with the IDE (H3); a project skill with the same name wins.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub builtin: bool,
    #[serde(skip)]
    pub body: Option<&'static str>,
}

/// H3: the skills that come with the IDE — each says which `ide` actions fit a kind of work, and what never to do
/// without the human. `(name, description, body)`.
pub const BUILTIN_SKILLS: &[(&str, &str, &str)] = &[
    ("workspace", "Know this workspace's projects and work inside one (boundaries, commands)",
     "# Workspace\n\n1. `ide` action `workspace.projects` lists the projects (path, language, test and lint commands).\n2. Work inside the project of the request: its folder, its commands (run them from its folder), its AGENTS.md/CLAUDE.md.\n3. A change in another project needs the human's approval — say why it is needed before you ask.\n4. `.dxtutor/workspace.json` declares or excludes projects; it is the human's file: propose changes, do not write it.\n"),
    ("project-board", "Read the Project board: sprint status, what is blocked, what is Ready, one issue in detail",
     "# Project board\n\n1. `ide` action `project.board` (args `project` for another project of the workspace): method, sprints, issues by state, WIP limits, DoR/DoD.\n2. `project.issue` with `key`: the story, criteria, scope, dependencies, what it lacks to be Ready, recent activity.\n3. Answer from the data: count by state, name blocked issues and why, issues over WIP, what keeps an issue from Ready (the `missing` list). Never invent a status.\n4. You do not move or edit issues: the human does it in the Project tab; an issue you work on ends with `finish_issue`. Suggest new work with `suggest` (it goes to the Project inbox).\n"),
    ("source-control", "Branches, recent commits, pull requests and CI status of this repository",
     "# Source control\n\n1. `ide` actions: `git.refs` (branches, ahead/behind, worktrees, stashes), `git.log` (args `n`, `path`), `gh.prs` (`filter`: open, mine, review), `gh.runs` (`sha`, HEAD by default).\n2. For «why is CI red?»: `gh.runs` for the commit, then read the failing job's step with the test or build output you can reproduce locally (`run_tests`).\n3. Never push, force-push, merge, rebase a shared branch or delete a branch: say the exact command and leave it to the human.\n4. `gh` may be missing or not signed in: say so, do not guess PR or CI state.\n"),
    ("dependencies", "Outdated, duplicated or risky dependencies of the project's manifests",
     "# Dependencies\n\n1. `ide` action `deps.report` reads the manifests and lock files (offline).\n2. Report what matters: security-relevant packages, major versions behind, duplicates; with the manifest and line.\n3. Upgrade one dependency at a time, run the tests after each, and stop on the first failure. Never upgrade everything in one change.\n4. Work outside the request goes to the Project inbox with `suggest`.\n"),
    ("architecture", "Check the code against the architect's rules and explain or fix the violations",
     "# Architecture\n\n1. `ide` action `arch.conformance` checks the repository against `.dxtutor/architecture.toml` (layers, allowed libraries, naming).\n2. Explain each violation with file:line and the rule; fix it inside the request's scope.\n3. A deliberate deviation needs an accepted ADR: you may draft it under docs/adr (status proposed); only the architect accepts it.\n4. Never edit `.dxtutor/architecture.toml` yourself.\n"),
    ("codebase-onboarding", "A guided tour of an unfamiliar codebase: entry points, modules, where things live",
     "# Codebase onboarding\n\n1. `ide` action `codebase.map`: entry points, modules and their roles.\n2. Then read the 3–5 files that matter most (entry point, main domain module, a test) with `read` by excerpts (`outline` first).\n3. Answer as a short tour: what the system does, how a request flows, where to change X, how to run the tests. Cite paths.\n"),
    ("sre-slo", "The project's SLOs, error budgets and burn rate from its Prometheus",
     "# SLOs\n\n1. `ide` action `slo.status`: each SLO with its objective, window, the error budget left and the burn rate (from `.dxtutor/slo.json` and the Prometheus in `.dxtutor/metrics.json`).\n2. «not connected» or no requests means there is no number: say that, never estimate one.\n3. A spent budget is a reason to stop risky changes; say which SLO and how much is left.\n4. You never change the metrics configuration or the token: that is the human's (the Ops tab).\n"),
    // H4 (toolset 14): Platform, SRE and DevOps. Each says the level of what it uses; an older conversation answers
    // «unknown action» for these, and then the person starts a new one.
    ("incidents", "Investigate a production incident: open it, gather evidence and metrics, run the runbook checks, rank causes, draft the postmortem",
     "# Incidents\n\n(Needs the IDE actions of toolset 14: if `ide` answers «unknown action», this conversation is older — tell the person to start a new one.)\n\n1. `ide` `incident.list`; to start one, `incident.open` with `title` and `severity` (SEV-1 worst … SEV-4) — the person approves it.\n2. `incident.metrics` (`id`) checks each SLO before and since it opened. Without a metrics source, record it with `incident.add` kind `not-checked` and the reason.\n3. Find the runbook (`runbook.list`) and run its checks in order with `runbook.check` (`path`, `step`, the same `run` for all). A machine expectation says `matched`; a prose one you judge, and say so.\n4. Record what you learn with `incident.add`: `evidence` (a fact, with where it came from), `checked` (a check run and its result), `not-checked` (with why), `note` (your ranked causes, most likely first, each with the evidence for and against). Never present a hypothesis as a cause.\n5. `incident.show` gives the timeline and the confidence; without a metrics source it stays «low» — say it.\n6. Draft the postmortem with `write` at `docs/postmortems/<INC-n>.md` (it is a proposal the person reviews): summary, impact, timeline (from the incident's events, with times), causes with evidence, what went well, what did not, actions with owners left blank.\n7. Never yours: running an action step, mitigating or resolving the incident, rolling back, scaling, changing the cluster. Say the exact command and why; the commander decides.\n"),
    ("runbooks", "Find and run a runbook's checks (runbooks/*.md) and judge their results",
     "# Runbooks\n\n(Needs the IDE actions of toolset 14.)\n\n1. `ide` `runbook.list`: each runbook with its steps — `check` (read-only), `action`, `decision` — and why a check cannot run.\n2. `runbook.show` (`path`) for one; `runbook.check` (`path`, `step`, `run`) runs ONE check and records it in the runbook's runs.\n3. A check runs at once only when the runbook is the reviewed one (committed, unchanged, pushed); otherwise the person is asked first. A check whose command is not read-only never runs.\n4. Action and decision steps are the person's (Ops → Runbooks): say which step, its command and what you expect from it.\n5. Writing or fixing a runbook is a normal file change under `runbooks/` (`## n. title [check|action|decision]`, one fenced command, `expect:` with `` `text` `` or `/regex/` for a machine check); it runs at once only after it is reviewed and pushed.\n"),
    ("platform-queue", "The person's Platform queue: what is theirs to do now and why",
     "# Platform queue\n\n(Needs the IDE actions of toolset 14.)\n\n1. `ide` `queue.items`: review requests, blocking IaC findings in files they changed, runbooks due, incidents they command, their failed deploys — each with why it is theirs and one action.\n2. Help with one item at a time: for a review request, `gh.prs` and read the diff; for an IaC finding, the file and the rule; for a due runbook, its checks (skill `runbooks`).\n3. Marking an item done or handing it over is the person's (Platform → My queue): it is verified against the real state, never by your word.\n"),
    ("iac-pipeline", "Infrastructure as code: the .tf folders, a plan, drift, and the findings to fix",
     "# IaC\n\n(Needs the IDE actions of toolset 14.)\n\n1. `ide` `iac.dirs` lists the folders with `.tf` files.\n2. `iac.plan` (`dir`, `refreshOnly` true for drift) runs `init` + `plan` with the person's credentials — the person approves each one. Read the diff by resource and attribute; name what is replaced and why.\n3. Fix findings in the `.tf` files inside the request's scope (a secret from `var.` or a literal is an error; a secret variable needs `sensitive = true`).\n4. Never apply, import, `state rm`, `force-unlock` or `taint`: applying is the reviewed plan's, from Ops → IaC, by the person. `moved` and `import` blocks you may draft in the `.tf` files.\n"),
    ("kubernetes-ops", "A Kubernetes namespace's state, a deployment's rollout history, and what to do about a bad rollout",
     "# Kubernetes\n\n(Needs the IDE actions of toolset 14.)\n\n1. `ide` `kube.state` (`context`, `namespace`): pods, services, deployments and events — with the person's kubeconfig. `kube.history` (`context`, `namespace`, `deployment`): the revisions, newest first.\n2. Read restarts, `CrashLoopBackOff`, `ImagePullBackOff`, failed probes and the events; compare the image and revision with the history.\n3. Scaling, restarting, rolling back or deleting is the person's: give the exact `kubectl` command (with `--context` and `-n`), what it will do and how to check it worked.\n"),
    ("guided-deploy", "Plan a deploy to staging or production and explain what blocks it",
     "# Guided deploy\n\n(Needs the IDE actions of toolset 14.)\n\n1. `ide` `deploy.plan` (`env`, `context`, `namespace`; for production also `stagingContext`, `stagingNamespace`) — the person approves it: it runs the preflight checks.\n2. Explain each check that failed, is not installed or not connected, and how to fix it; production needs a second approver (a merged PR) and has no waiver for that.\n3. The rollout is never yours: it runs from Infra → Promote/Redeploy, approved by the person. Secrets come from Vault and never reach you.\n"),
];

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
                builtin: false,
                body: None,
            })
        })
        .collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

/// The project's skills and then the IDE's that the project does not replace (H3).
pub fn all_skills(root: &Path) -> Vec<Skill> {
    let mut v = skills(root);
    let own: Vec<String> = v.iter().map(|s| s.name.clone()).collect();
    v.extend(
        BUILTIN_SKILLS
            .iter()
            .filter(|(n, _, _)| !own.iter().any(|o| o == n))
            .map(|(name, description, body)| Skill {
                name: name.to_string(),
                description: description.to_string(),
                path: PathBuf::new(),
                builtin: true,
                body: Some(body),
            }),
    );
    v
}

/// O índice das skills para o system prompt (vazio se não houver).
pub fn skills_index(root: &Path) -> Option<String> {
    let s = all_skills(root);
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
        let all = all_skills(&ctx.root);
        let Some(s) = all.iter().find(|s| s.name == name) else {
            let names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
            return ToolOutput::err(format!(
                "skill desconhecida: {name} (disponíveis: {})",
                names.join(", ")
            ));
        };
        if let Some(body) = s.body {
            return ToolOutput::ok(body);
        }
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
    fn the_ide_skills_come_with_the_ide_and_a_project_skill_replaces_one() {
        let d = tempfile::tempdir().unwrap();
        let idx = skills_index(d.path()).unwrap();
        for (name, _, body) in BUILTIN_SKILLS {
            assert!(idx.contains(&format!("- {name}: ")), "{name}");
            assert!(
                body.contains("`ide`"),
                "{name} says which ide actions to use"
            );
        }
        let ctx = ToolCtx {
            root: d.path().to_path_buf(),
            cancel: Default::default(),
        };
        let out = SkillTool.run(&json!({"name": "project-board"}), &ctx);
        assert!(
            !out.is_error && out.content.contains("project.board"),
            "{}",
            out.content
        );
        put(
            d.path(),
            ".dxtutor/skills/project-board/SKILL.md",
            "---\nname: project-board\ndescription: Ours\n---\nOur own board rules.",
        );
        let all = all_skills(d.path());
        assert_eq!(all.iter().filter(|s| s.name == "project-board").count(), 1);
        assert!(
            !all.iter()
                .find(|s| s.name == "project-board")
                .unwrap()
                .builtin
        );
        assert!(SkillTool
            .run(&json!({"name": "project-board"}), &ctx)
            .content
            .contains("Our own board rules"));
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
            .contains("disponíveis: migracoes, workspace, project-board"));
        // without project skills the IDE's are still there (H3)
        assert!(skills_index(&d.path().join("nada"))
            .unwrap()
            .contains("- workspace: "));
    }
}
