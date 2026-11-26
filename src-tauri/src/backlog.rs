//! `/backlog` and `/project` (toolset 11): the two tools of a backlog session.
//!
//! - `backlog_propose`: Co-Dev proposes the product backlog. The rules are the Project's
//!   ([`tutor_board::project::backlog::validate`]); a draft with problems goes back to the model, a
//!   good one is written to `.dxtutor/backlog.json` (the project's file: the person reads, edits
//!   and versions it) and shown in the chat. It is not read-only: in Manual the person allows it.
//! - `project_propose`: Co-Dev plans the Project from that file (method, iteration, sprints). It
//!   only reads and checks ([`tutor_board::project::backlog::validate_plan`]); the chat shows the
//!   plan and nothing is created until the person confirms it — `project_create_from_backlog`
//!   (`board.rs`) creates it then, if the file is still the one the plan was made from.
//!
//! What the chat shows comes by the event `backlog://proposal` (`{session, proposal}`).

use std::hash::{DefaultHasher, Hasher};
use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use tutor_agent::{Tool, ToolCtx, ToolOutput};
use tutor_board::project::backlog::{self, Draft, Plan, DRAFT_PATH};

pub const BACKLOG_PROPOSE: &str = "backlog_propose";
pub const PROJECT_PROPOSE: &str = "project_propose";

/// What the chat shows: the draft (and, for `project`, the plan), and the version of the file it
/// came from.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    /// `backlog` (a new draft was saved) or `project` (a plan to confirm).
    pub kind: String,
    pub path: String,
    /// The version of `.dxtutor/backlog.json` (its content), checked again when the person creates.
    pub hash: String,
    pub draft: Draft,
    pub plan: Option<Plan>,
}

pub type Emit = Arc<dyn Fn(&Proposal) + Send + Sync>;

/// The version of the draft file's content (a change detector inside one run of the app).
pub fn content_hash(bytes: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    h.write(bytes);
    format!("{:016x}", h.finish())
}

/// Reads and checks the draft of `root`. `Err` says what to do in words for the model.
pub fn read_draft(root: &Path) -> Result<(Draft, String), String> {
    let path = root.join(DRAFT_PATH);
    let bytes = std::fs::read(&path).map_err(|_| {
        format!("{DRAFT_PATH} does not exist: run /backlog <context> first to draft the backlog")
    })?;
    let draft: Draft = serde_json::from_slice(&bytes)
        .map_err(|e| format!("{DRAFT_PATH} is not a backlog draft: {e}"))?;
    let problems = backlog::validate(&draft);
    if !problems.is_empty() {
        return Err(format!(
            "{DRAFT_PATH} has problems; fix them (or run /backlog again):\n- {}",
            problems.join("\n- ")
        ));
    }
    Ok((draft, content_hash(&bytes)))
}

fn points(d: &Draft) -> u32 {
    d.issues.iter().filter_map(|i| i.points).sum()
}

fn issue_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "ref": {"type": "string", "description": "the issue's id in this backlog, e.g. B1 (letters, digits, - or _)"},
            "title": {"type": "string"},
            "kind": {"type": "string", "enum": ["story", "bug", "task", "spike"]},
            "priority": {"type": "string", "enum": ["high", "medium", "low"]},
            "points": {"type": "integer", "minimum": 0, "maximum": 100},
            "epic": {"type": "string", "description": "the id of one of `epics`"},
            "storyAs": {"type": "string", "description": "story: As <who>"},
            "storyWant": {"type": "string", "description": "story: I want <what>"},
            "storySo": {"type": "string", "description": "story: so that <why>"},
            "description": {"type": "string"},
            "acceptance": {"type": "array", "items": {"type": "string"}, "description": "1–5 criteria, each Given/When/Then (Dado/Quando/Então)"},
            "scope": {"type": "array", "items": {"type": "string"}, "description": "files/folders it changes or creates, relative to the project; globs allowed"},
            "deps": {"type": "array", "items": {"type": "string"}, "description": "refs of the issues that must be done first"},
            "component": {"type": "string", "description": "the Studio component it implements, if any"}
        },
        "required": ["ref", "title", "acceptance", "scope"],
        "additionalProperties": false
    })
}

/// `backlog_propose`.
pub struct BacklogProposeTool {
    pub emit: Emit,
}

impl Tool for BacklogProposeTool {
    fn name(&self) -> &str {
        BACKLOG_PROPOSE
    }
    fn description(&self) -> &str {
        "Propose the product backlog of this project: epics and issues, each issue with its \
         story, Given/When/Then criteria, the files it changes or creates (`scope`) and its \
         dependencies. It is checked with the Project's rules; problems come back to you — fix \
         them and call it again. A good backlog is saved to .dxtutor/backlog.json and shown to \
         the human; `/project` then creates the Project from it."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "the product or release, e.g. \"Shop MVP\""},
                "summary": {"type": "string"},
                "epics": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "title": {"type": "string"},
                        "description": {"type": "string"}
                    },
                    "required": ["id", "title"],
                    "additionalProperties": false
                }},
                "issues": {"type": "array", "items": issue_schema()}
            },
            "required": ["title", "issues"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        false
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        match propose_backlog(input, &ctx.root) {
            Ok(p) => {
                (self.emit)(&p);
                let d = &p.draft;
                ToolOutput::ok(format!(
                    "Backlog «{}» saved to {DRAFT_PATH}: {} epics, {} issues, {} points. The human \
                     sees it in the chat; `/project <context>` creates the Project from it.",
                    d.title,
                    d.epics.len(),
                    d.issues.len(),
                    points(d)
                ))
            }
            Err(e) => ToolOutput::err(e),
        }
    }
}

/// Checks the draft and writes it (pretty JSON) to the project's `.dxtutor/backlog.json`.
pub fn propose_backlog(input: &Value, root: &Path) -> Result<Proposal, String> {
    let draft: Draft = serde_json::from_value(input.clone())
        .map_err(|e| format!("the backlog does not match the tool's schema: {e}"))?;
    let problems = backlog::validate(&draft);
    if !problems.is_empty() {
        return Err(format!(
            "the backlog has problems; fix them and call backlog_propose again:\n- {}",
            problems.join("\n- ")
        ));
    }
    let text = serde_json::to_string_pretty(&draft).map_err(|e| e.to_string())? + "\n";
    let path = root.join(DRAFT_PATH);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
    }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &text)
        .and_then(|_| std::fs::rename(&tmp, &path))
        .map_err(|e| format!("could not write {DRAFT_PATH}: {e}"))?;
    Ok(Proposal {
        kind: "backlog".into(),
        path: DRAFT_PATH.into(),
        hash: content_hash(text.as_bytes()),
        draft,
        plan: None,
    })
}

/// `project_propose`.
pub struct ProjectProposeTool {
    pub emit: Emit,
}

impl Tool for ProjectProposeTool {
    fn name(&self) -> &str {
        PROJECT_PROPOSE
    }
    fn description(&self) -> &str {
        "Propose how this folder's Project is set up from .dxtutor/backlog.json: the method, \
         the iteration length, optional Definition of Ready/Done and the sprints in order (each \
         with the refs of its issues; the rest stays in the product backlog). It is checked \
         against the backlog (refs, one sprint per issue, capacity, dependencies first); \
         problems come back to you. Nothing is created until the human confirms it in the chat."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "method": {"type": "string", "enum": ["kanban", "scrum", "xp", "scrumxp"]},
                "iterDays": {"type": "integer", "minimum": 1, "maximum": 60},
                "keyPrefix": {"type": "string", "description": "1–8 letters or digits for the issue keys, e.g. SHOP"},
                "dor": {"type": "array", "items": {"type": "string"}},
                "dod": {"type": "array", "items": {"type": "string"}},
                "sprints": {"type": "array", "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "goal": {"type": "string"},
                        "capacity": {"type": "integer", "minimum": 0},
                        "issues": {"type": "array", "items": {"type": "string"}, "description": "refs from the backlog"}
                    },
                    "required": ["name", "issues"],
                    "additionalProperties": false
                }}
            },
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        match propose_project(input, &ctx.root) {
            Ok(p) => {
                (self.emit)(&p);
                let plan = p.plan.as_ref().expect("a project proposal has a plan");
                let planned: usize = plan.sprints.iter().map(|s| s.issues.len()).sum();
                ToolOutput::ok(format!(
                    "The plan is shown to the human: method {}, {} sprints with {} issues, {} in \
                     the product backlog. Nothing is created until they confirm it in the chat.",
                    plan.method.as_deref().unwrap_or("(the project's)"),
                    plan.sprints.len(),
                    planned,
                    p.draft.issues.len().saturating_sub(planned)
                ))
            }
            Err(e) => ToolOutput::err(e),
        }
    }
}

/// Reads the draft and checks the plan against it (writes nothing).
pub fn propose_project(input: &Value, root: &Path) -> Result<Proposal, String> {
    let (draft, hash) = read_draft(root)?;
    let plan: Plan = serde_json::from_value(input.clone())
        .map_err(|e| format!("the plan does not match the tool's schema: {e}"))?;
    let problems = backlog::validate_plan(&draft, &plan);
    if !problems.is_empty() {
        return Err(format!(
            "the plan has problems; fix them and call project_propose again:\n- {}",
            problems.join("\n- ")
        ));
    }
    Ok(Proposal {
        kind: "project".into(),
        path: DRAFT_PATH.into(),
        hash,
        draft,
        plan: Some(plan),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn input() -> Value {
        json!({
            "title": "Shop",
            "epics": [{"id": "E1", "title": "Orders"}],
            "issues": [
                {"ref": "B1", "title": "Place an order", "points": 3, "epic": "E1",
                 "storyAs": "a customer", "storyWant": "to order", "storySo": "I get my goods",
                 "acceptance": ["Given a cart, when I pay, then the order is saved"],
                 "scope": ["src/orders/new.rs"]},
                {"ref": "B2", "title": "List orders", "kind": "task", "points": 2,
                 "acceptance": ["Given orders, when I open the list, then I see them"],
                 "scope": ["src/orders/list.rs"], "deps": ["B1"]}
            ]
        })
    }

    fn ctx(root: &Path) -> ToolCtx {
        ToolCtx {
            root: root.to_path_buf(),
            cancel: Default::default(),
        }
    }

    #[test]
    fn backlog_propose_saves_a_good_draft_and_emits_it() {
        let d = tempfile::tempdir().unwrap();
        let seen: Arc<Mutex<Vec<Proposal>>> = Default::default();
        let s = seen.clone();
        let tool = BacklogProposeTool {
            emit: Arc::new(move |p| s.lock().unwrap().push(p.clone())),
        };
        assert!(!tool.read_only());
        let out = tool.run(&input(), &ctx(d.path()));
        assert!(!out.is_error, "{}", out.content);
        assert!(
            out.content.contains("2 issues, 5 points"),
            "{}",
            out.content
        );
        let saved = std::fs::read(d.path().join(DRAFT_PATH)).unwrap();
        let p = &seen.lock().unwrap()[0];
        assert_eq!(p.kind, "backlog");
        assert_eq!(p.hash, content_hash(&saved));
        assert_eq!(
            read_draft(d.path()).unwrap(),
            (p.draft.clone(), p.hash.clone())
        );
    }

    #[test]
    fn backlog_propose_returns_the_problems_and_writes_nothing() {
        let d = tempfile::tempdir().unwrap();
        let tool = BacklogProposeTool {
            emit: Arc::new(|_| panic!("nothing to show")),
        };
        let mut bad = input();
        bad["issues"][0]["acceptance"] = json!(["it works"]);
        let out = tool.run(&bad, &ctx(d.path()));
        assert!(out.is_error);
        assert!(
            out.content.contains("«it works» is not in Given/When/Then"),
            "{}",
            out.content
        );
        let out = tool.run(
            &json!({"title": "x", "issues": [], "oops": 1}),
            &ctx(d.path()),
        );
        assert!(
            out.is_error && out.content.contains("schema"),
            "{}",
            out.content
        );
        assert!(!d.path().join(DRAFT_PATH).exists());
    }

    #[test]
    fn project_propose_reads_the_draft_and_checks_the_plan() {
        let d = tempfile::tempdir().unwrap();
        let tool = ProjectProposeTool {
            emit: Arc::new(|_| {}),
        };
        assert!(tool.read_only());
        let plan = json!({"method": "scrum", "iterDays": 14, "sprints": [{"name": "Sprint 1", "issues": ["B1", "B2"]}]});
        let out = tool.run(&plan, &ctx(d.path()));
        assert!(
            out.is_error && out.content.contains("run /backlog"),
            "{}",
            out.content
        );
        propose_backlog(&input(), d.path()).unwrap();
        let p = propose_project(&plan, d.path()).unwrap();
        assert_eq!(p.kind, "project");
        assert_eq!(p.plan.unwrap().sprints[0].issues, ["B1", "B2"]);
        let out = tool.run(&plan, &ctx(d.path()));
        assert!(
            out.content
                .contains("1 sprints with 2 issues, 0 in the product backlog"),
            "{}",
            out.content
        );
        let late = json!({"method": "scrum", "sprints": [{"name": "S1", "issues": ["B2"]}]});
        let out = tool.run(&late, &ctx(d.path()));
        assert!(
            out.is_error && out.content.contains("dependency «B1» is in no sprint"),
            "{}",
            out.content
        );
    }
}
