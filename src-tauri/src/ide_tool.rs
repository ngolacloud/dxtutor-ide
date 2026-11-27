//! H3 (docs/v2/AUDIT-harness.md, decision D4): `ide` — ONE tool through which Co-Dev reaches what the IDE knows,
//! with the action chosen by name and decided here. One definition costs one tool in every request (one per
//! action would be dozens, and would change the request prefix whenever an action is added); the built-in skills
//! say which actions fit which work.
//!
//! This phase has only READ actions (the board, an issue, git and GitHub, dependencies, the codebase map, the
//! architect's rules, SLOs, the workspace's projects). Actions that change something come in H4, each with its
//! level: a proposal the human accepts, or the shared approval and the audit log — never silently.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tutor_agent::{Tool, ToolCtx, ToolOutput};

pub const IDE_TOOL: &str = "ide";
const MAX_OUTPUT: usize = 20_000;

/// The actions, with their arguments, for the description and the error of an unknown one.
pub const ACTIONS: &[(&str, &str)] = &[
    ("workspace.projects", "the projects of this workspace, with their test and lint commands"),
    ("project.board", "the Project board: method, sprints, issues by state (args: project? — a project folder of the workspace)"),
    ("project.issue", "one issue: story, criteria, scope, dependencies, readiness, recent activity (args: key, project?)"),
    ("git.refs", "branches with upstream and ahead/behind, remotes, tags, stashes, worktrees"),
    ("git.log", "recent commits (args: n? ≤ 100, path?)"),
    ("gh.prs", "open pull requests on GitHub (args: filter? open|mine|review)"),
    ("gh.runs", "the CI runs of a commit on GitHub (args: sha? — HEAD by default)"),
    ("deps.report", "the dependencies of the project's manifests: outdated, duplicated, risky (offline)"),
    ("codebase.map", "a map of the codebase for onboarding: entry points, modules, where things live"),
    ("arch.conformance", "the repository against the architect's rules (.dxtutor/architecture.toml)"),
    ("slo.status", "the project's SLOs and error budgets from its Prometheus (.dxtutor/slo.json, metrics.json)"),
];

/// `ide`, for one session: `root` is the project's folder (the Project's key), `db` the Project store.
pub struct IdeTool {
    pub root: PathBuf,
    pub db: Option<PathBuf>,
}

fn clip(s: String) -> String {
    if s.len() <= MAX_OUTPUT {
        return s;
    }
    let mut cut = MAX_OUTPUT;
    while !s.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n… (cut at {MAX_OUTPUT} characters: ask for less — e.g. one issue, one project, fewer commits)", &s[..cut])
}

fn pretty<T: serde::Serialize>(v: &T) -> Result<String, String> {
    serde_json::to_string_pretty(v).map_err(|e| e.to_string())
}

fn project_dir(root: &Path, args: &Value) -> Result<PathBuf, String> {
    match args["project"]
        .as_str()
        .map(|p| p.trim().trim_start_matches("./").trim_end_matches('/'))
    {
        None | Some("") | Some(".") => Ok(root.to_path_buf()),
        Some(p) if p.starts_with('/') || p.split('/').any(|s| s == "..") => {
            Err(format!("«{p}» is not a project folder of this workspace"))
        }
        Some(p) => Ok(root.join(p)),
    }
}

impl IdeTool {
    /// The Project of `dir`, if it has one — never created by a read.
    fn project(&self, dir: &Path) -> Result<tutor_board::project::Project, String> {
        let db = self
            .db
            .as_ref()
            .ok_or("the Project store is not available in this session")?;
        let store = tutor_board::project::ProjectStore::open(db)?;
        let key = dir.display().to_string();
        let exists: bool = store
            .conn()
            .query_row("SELECT 1 FROM projects WHERE root = ?1", [&key], |_| {
                Ok(true)
            })
            .unwrap_or(false);
        if !exists {
            return Err(format!("{key} has no Project yet (the human opens it in the Project tab, or /project creates one)"));
        }
        store.load(&key, 0).map_err(|e| e.message)
    }

    fn board(&self, args: &Value) -> Result<String, String> {
        let p = self.project(&project_dir(&self.root, args)?)?;
        let issues: Vec<Value> = p
            .issues
            .iter()
            .take(300)
            .map(|i| {
                json!({
                    "key": i.key, "title": i.title, "kind": i.kind, "state": i.state, "priority": i.priority,
                    "points": i.points, "sprint": i.sprint, "assignee": i.assignee, "blocked": i.blocked,
                    "ready": i.ready, "missing": i.missing.iter().take(3).collect::<Vec<_>>(), "deps": i.deps,
                })
            })
            .collect();
        let sprints: Vec<Value> = p
            .sprints
            .iter()
            .map(|s| json!({"id": s.id, "name": s.name, "state": s.state, "goal": s.goal, "capacity": s.capacity}))
            .collect();
        pretty(&json!({
            "method": p.method, "keyPrefix": p.key_prefix, "wip": p.wip, "dor": p.dor, "dod": p.dod,
            "sprints": sprints, "issues": issues, "inbox": p.inbox.len(),
        }))
    }

    fn issue(&self, args: &Value) -> Result<String, String> {
        let key = args["key"]
            .as_str()
            .map(str::trim)
            .filter(|k| !k.is_empty())
            .ok_or("project.issue needs `key`")?;
        let dir = project_dir(&self.root, args)?;
        let p = self.project(&dir)?;
        let i = p
            .issues
            .iter()
            .find(|i| i.key == key)
            .ok_or_else(|| format!("{key} is not an issue of this Project"))?;
        let db = self
            .db
            .as_ref()
            .ok_or("the Project store is not available")?;
        let detail = tutor_board::project::ProjectStore::open(db)?
            .detail(&dir.display().to_string(), key)
            .map_err(|e| e.message)?;
        let activity: Vec<Value> = detail
            .activity
            .iter()
            .take(10)
            .map(|a| json!({"at": a.at, "actor": a.actor, "kind": a.kind, "from": a.from, "to": a.to, "note": a.note}))
            .collect();
        pretty(&json!({"issue": i, "activity": activity, "changeSets": detail.change_sets.len()}))
    }
}

fn git_log(root: &Path, args: &Value) -> Result<String, String> {
    let n = args["n"].as_u64().unwrap_or(20).clamp(1, 100).to_string();
    let mut c = crate::shellenv::command("git");
    c.arg("-C")
        .arg(root)
        .args(["log", "--date=short", "--format=%h %ad %an %s", "-n", &n]);
    if let Some(p) = args["path"].as_str().filter(|p| !p.trim().is_empty()) {
        if p.starts_with('/') || p.split('/').any(|s| s == "..") {
            return Err(format!("«{p}» is not inside the project"));
        }
        c.args(["--", p]);
    }
    let o = c.output().map_err(|e| format!("git: {e}"))?;
    if !o.status.success() {
        return Err(String::from_utf8_lossy(&o.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&o.stdout).into_owned())
}

fn head(root: &Path) -> Result<String, String> {
    let o = crate::shellenv::command("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

impl Tool for IdeTool {
    fn name(&self) -> &str {
        IDE_TOOL
    }
    fn description(&self) -> &str {
        "Read what the IDE knows about this project, by action: workspace.projects, project.board, project.issue, \
         git.refs, git.log, gh.prs, gh.runs, deps.report, codebase.map, arch.conformance, slo.status. Every action \
         here only reads. The built-in skills say which actions fit which work; load one with `skill` first."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ACTIONS.iter().map(|a| a.0).collect::<Vec<_>>()},
                "args": {"type": "object", "description": "the action's arguments (see the skill), e.g. {\"key\": \"SHOP-12\"}"}
            },
            "required": ["action"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let action = input["action"].as_str().unwrap_or_default();
        let args = input.get("args").cloned().unwrap_or_else(|| json!({}));
        let work = &ctx.root; // the folder the session works in (a worktree in Multi Co-Dev)
        let r: Result<String, String> = match action {
            "workspace.projects" => pretty(&tutor_agent::workspace::detect(&self.root)),
            "project.board" => self.board(&args),
            "project.issue" => self.issue(&args),
            "git.refs" => tutor_eval::gitwork::refs(work).and_then(|r| pretty(&r)),
            "git.log" => git_log(work, &args),
            "gh.prs" => {
                let f = match args["filter"].as_str().unwrap_or("open") {
                    "mine" => tutor_eval::gh::PrFilter::Mine,
                    "review" => tutor_eval::gh::PrFilter::Review,
                    _ => tutor_eval::gh::PrFilter::Open,
                };
                tutor_eval::gh::prs(work, f).and_then(|p| pretty(&p))
            }
            "gh.runs" => {
                let sha = match args["sha"].as_str().filter(|s| !s.trim().is_empty()) {
                    Some(s) => Ok(s.trim().to_string()),
                    None => head(work),
                };
                sha.and_then(|s| tutor_eval::gh::runs_for(work, &s))
                    .and_then(|r| pretty(&r))
            }
            "deps.report" => pretty(&tutor_eval::deps::report(work, false)),
            "codebase.map" => pretty(&tutor_eval::onboard::map(work)),
            "arch.conformance" => match tutor_agent::conformance::scan(work) {
                Ok(None) => Ok("no architect's rules here (.dxtutor/architecture.toml)".into()),
                Ok(Some(v)) if v.is_empty() => {
                    Ok("the repository follows the architect's rules: no violations".into())
                }
                Ok(Some(v)) => pretty(&v),
                Err(e) => Err(e),
            },
            "slo.status" => pretty(&tutor_platform::metrics::overview(
                crate::commands::metrics::store(),
                &self.root,
            )),
            other => Err(format!(
                "unknown action «{other}». Actions:\n{}",
                ACTIONS
                    .iter()
                    .map(|(a, d)| format!("- {a}: {d}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            )),
        };
        match r {
            Ok(s) => ToolOutput::ok(clip(s)),
            Err(e) => ToolOutput::err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_board::project::{Op, ProjectStore};

    fn ctx(root: &Path) -> ToolCtx {
        ToolCtx {
            root: root.to_path_buf(),
            cancel: Default::default(),
        }
    }

    #[test]
    fn the_board_and_an_issue_are_read_and_a_folder_without_a_project_is_not_created() {
        let d = tempfile::tempdir().unwrap();
        let db = d.path().join("board.sqlite3");
        let root = d.path().join("shop");
        std::fs::create_dir_all(root.join("services/orders")).unwrap();
        let key = root.display().to_string();
        let mut st = ProjectStore::open(&db).unwrap();
        st.apply(
            &key,
            "ana",
            1,
            Op::CreateIssue {
                title: "Pay an order".into(),
                kind: "story".into(),
                priority: "high".into(),
                points: Some(3),
                epic: "Checkout".into(),
                description: String::new(),
                acceptance: vec!["Given a cart, when I pay, then it is saved".into()],
                sprint: None,
                reason: None,
            },
        )
        .unwrap();
        let tool = IdeTool {
            root: root.clone(),
            db: Some(db.clone()),
        };
        assert!(tool.read_only());
        let out = tool.run(&json!({"action": "project.board"}), &ctx(&root));
        assert!(!out.is_error, "{}", out.content);
        let v: Value = serde_json::from_str(&out.content).unwrap();
        assert_eq!(v["issues"][0]["title"], "Pay an order");
        assert_eq!(v["method"], "kanban");
        let key0 = v["issues"][0]["key"].as_str().unwrap().to_string();
        let out = tool.run(
            &json!({"action": "project.issue", "args": {"key": key0}}),
            &ctx(&root),
        );
        assert!(
            out.content.contains("Given a cart") && out.content.contains("\"activity\""),
            "{}",
            out.content
        );
        // another project of the workspace with no Project: said, and nothing is created
        let out = tool.run(
            &json!({"action": "project.board", "args": {"project": "services/orders"}}),
            &ctx(&root),
        );
        assert!(
            out.is_error && out.content.contains("has no Project yet"),
            "{}",
            out.content
        );
        let n: i64 = ProjectStore::open(&db)
            .unwrap()
            .conn()
            .query_row("SELECT COUNT(*) FROM projects", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let out = tool.run(
            &json!({"action": "project.board", "args": {"project": "../x"}}),
            &ctx(&root),
        );
        assert!(out.is_error);
    }

    #[test]
    fn git_and_the_workspace_are_read_and_an_unknown_action_lists_the_others() {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        let git = |a: &[&str]| {
            std::process::Command::new("git")
                .arg("-C")
                .arg(r)
                .args(a)
                .env("GIT_AUTHOR_NAME", "t")
                .env("GIT_AUTHOR_EMAIL", "t@e")
                .env("GIT_COMMITTER_NAME", "t")
                .env("GIT_COMMITTER_EMAIL", "t@e")
                .output()
                .unwrap()
        };
        git(&["init", "-q", "--initial-branch=main"]);
        std::fs::write(r.join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();
        git(&["add", "-A"]);
        git(&["commit", "-q", "-m", "first commit"]);
        let tool = IdeTool {
            root: r.to_path_buf(),
            db: None,
        };
        let log = tool.run(&json!({"action": "git.log", "args": {"n": 5}}), &ctx(r));
        assert!(log.content.contains("first commit"), "{}", log.content);
        let refs = tool.run(&json!({"action": "git.refs"}), &ctx(r));
        assert!(
            !refs.is_error && refs.content.contains("main"),
            "{}",
            refs.content
        );
        let ws = tool.run(&json!({"action": "workspace.projects"}), &ctx(r));
        assert!(
            ws.content.contains("\"language\": \"rust\""),
            "{}",
            ws.content
        );
        let bad = tool.run(&json!({"action": "deploy.now"}), &ctx(r));
        assert!(
            bad.is_error && bad.content.contains("- project.board:"),
            "{}",
            bad.content
        );
        let none = tool.run(&json!({"action": "project.board"}), &ctx(r));
        assert!(none.is_error && none.content.contains("not available"));
    }
}
