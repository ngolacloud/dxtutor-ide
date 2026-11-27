//! Fluxo plano → entrega (F6) sem rede: ferramentas de fluxo, sub-agente e checkpoints
//! automáticos no loop.

use std::collections::VecDeque;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tutor_agent::checkpoint::Checkpoints;
use tutor_agent::tools::flow::SubagentSpec;
use tutor_agent::tools::{agent_tools, FlowState, ToolsetOptions};
use tutor_agent::{
    Agent, AgentConfig, AgentEvent, Decision, Effort, Message, Provider, ProviderError, Request,
    Response, StopReason, StreamEvent, ToolCtx, Transcript, Usage,
};

struct Scripted {
    replies: Mutex<VecDeque<Response>>,
    seen: Mutex<Vec<Request>>,
}

impl Provider for Scripted {
    fn stream(
        &self,
        req: &Request,
        _: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<Response, ProviderError> {
        self.seen.lock().unwrap().push(req.clone());
        Ok(self
            .replies
            .lock()
            .unwrap()
            .pop_front()
            .expect("guião acabou"))
    }
}

fn scripted(replies: Vec<Response>) -> Arc<Scripted> {
    Arc::new(Scripted {
        replies: Mutex::new(replies.into()),
        seen: Mutex::new(vec![]),
    })
}

fn step(stop: StopReason, content: Vec<Value>) -> Response {
    Response {
        id: "m".into(),
        model: "claude-opus-5-5".into(),
        content,
        stop_reason: stop,
        stop_details: None,
        usage: Usage {
            input_tokens: 7,
            output_tokens: 3,
            ..Default::default()
        },
        invalid_tool_inputs: vec![],
    }
}

fn tool(id: &str, name: &str, input: Value) -> Value {
    json!({"type": "tool_use", "id": id, "name": name, "input": input})
}

fn text(t: &str) -> Value {
    json!({"type": "text", "text": t})
}

fn ctx(root: &std::path::Path) -> ToolCtx {
    ToolCtx {
        root: root.to_path_buf(),
        cancel: Arc::new(AtomicBool::new(false)),
    }
}

fn names(v: &[Arc<dyn tutor_agent::Tool>]) -> Vec<String> {
    v.iter().map(|t| t.name().to_string()).collect()
}

#[test]
fn toolset_versions_keep_old_sessions_byte_compatible() {
    let fs = FlowState::default();
    let spec = SubagentSpec {
        provider: scripted(vec![]),
        model: "m".into(),
        effort: Effort::Low,
        lang: tutor_agent::context::ReplyLang::Pt,
    };
    let v1 = names(&agent_tools(
        &ToolsetOptions::default(),
        1,
        &fs,
        Some(spec.clone()),
        vec![],
    ));
    let v2 = names(&agent_tools(
        &ToolsetOptions::default(),
        2,
        &fs,
        Some(spec),
        vec![],
    ));
    assert_eq!(
        v1,
        [
            "read",
            "glob",
            "grep",
            "edit",
            "write",
            "bash",
            "git_status",
            "git_diff"
        ]
    );
    assert_eq!(&v2[..8], &v1[..]);
    assert_eq!(&v2[8..], ["todo_write", "exit_plan", "task"]);
    let v3 = names(&agent_tools(
        &ToolsetOptions::default(),
        3,
        &fs,
        None,
        vec![],
    ));
    assert_eq!(&v3[8..], ["todo_write", "exit_plan", "skill"]);
}

#[test]
fn todo_write_replaces_the_list_and_exit_plan_needs_plan_mode() {
    let d = tempfile::tempdir().unwrap();
    let fs = FlowState::default();
    let tools = agent_tools(&ToolsetOptions::default(), 2, &fs, None, vec![]);
    let get = |n: &str| tools.iter().find(|t| t.name() == n).unwrap().clone();

    let todo = get("todo_write");
    assert!(todo.read_only() && !todo.mutates_files());
    let input = json!({"todos": [
        {"content": "ler o lexer", "status": "completed"},
        {"content": "corrigir o ciclo", "status": "in_progress"},
        {"content": "correr os testes", "status": "pending"}
    ]});
    tutor_agent::schema::validate(&todo.input_schema(), &input).unwrap();
    let out = todo.run(&input, &ctx(d.path()));
    assert_eq!(
        out.content,
        "[x] ler o lexer\n[~] corrigir o ciclo\n[ ] correr os testes\n1/3 feitas"
    );
    assert_eq!(fs.todos.lock().unwrap().len(), 3);

    let plan = get("exit_plan");
    assert!(!plan.read_only() && !plan.mutates_files());
    assert!(
        plan.run(&json!({"plan": "x"}), &ctx(d.path())).is_error,
        "fora do modo plano"
    );
    fs.plan_mode.store(true, Ordering::SeqCst);
    let ok = plan.run(&json!({"plan": "1. …"}), &ctx(d.path()));
    assert!(!ok.is_error && ok.content.contains("aprovado"));
    assert!(
        !fs.plan_mode.load(Ordering::SeqCst),
        "o modo plano terminou"
    );
}

#[test]
fn task_runs_a_read_only_subagent_and_returns_its_report() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("lexer.rs"), "fn tokenize() {}\n").unwrap();
    let child = scripted(vec![
        step(
            StopReason::ToolUse,
            vec![tool(
                "g1",
                "grep",
                json!({"pattern": "fn tokenize", "mode": "content"}),
            )],
        ),
        step(
            StopReason::EndTurn,
            vec![text("`tokenize` está em lexer.rs:1.")],
        ),
    ]);
    let spec = SubagentSpec {
        provider: child.clone(),
        model: "claude-opus-5-5".into(),
        effort: Effort::Low,
        lang: tutor_agent::context::ReplyLang::Pt,
    };
    let tools = agent_tools(
        &ToolsetOptions::default(),
        2,
        &FlowState::default(),
        Some(spec),
        vec![],
    );
    let task = tools.iter().find(|t| t.name() == "task").unwrap();
    assert!(task.read_only(), "só leitura: vários correm em paralelo");
    let out = task.run(
        &json!({"description": "onde está tokenize", "prompt": "Encontra tokenize."}),
        &ctx(d.path()),
    );
    assert!(!out.is_error, "{}", out.content);
    assert!(out.content.starts_with("`tokenize` está em lexer.rs:1."));
    assert!(out.content.contains("[sub-agente: 4 mensagens"));
    // o sub-agente só recebeu ferramentas de leitura, e o resultado real do grep
    let seen = child.seen.lock().unwrap();
    let child_tools: Vec<String> = seen[0].tools.iter().map(|t| t.name.clone()).collect();
    assert_eq!(
        child_tools,
        ["read", "glob", "grep", "git_status", "git_diff"]
    );
    let grep_result = &seen[1].messages[2].content[0]["content"];
    assert!(grep_result
        .as_str()
        .unwrap()
        .contains("lexer.rs:1: fn tokenize() {}"));
}

/// H5f (toolset 17): an implementer writes in a worktree of its own; the project does not change, and what it did
/// comes back as a patch (saved in the git dir) that applies on the project.
#[test]
fn an_implementer_writes_in_its_own_worktree_and_returns_a_patch() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path();
    let git = |a: &[&str]| {
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
    git(&["init", "-q", "--initial-branch=main"]);
    std::fs::write(p.join("lib.rs"), "pub fn a() {}\n").unwrap();
    git(&["add", "-A"]);
    git(&["commit", "-q", "-m", "first"]);
    let child = scripted(vec![
        step(
            StopReason::ToolUse,
            vec![tool(
                "w1",
                "write",
                json!({"path": "util.rs", "content": "pub fn b() {}\n"}),
            )],
        ),
        step(StopReason::EndTurn, vec![text("Criei util.rs com b().")]),
    ]);
    let spec = SubagentSpec {
        provider: child.clone(),
        model: "claude-opus-5-5".into(),
        effort: Effort::Low,
        lang: tutor_agent::context::ReplyLang::Pt,
    };
    let fs = FlowState::default();
    let task_of = |v: u32, spec: Option<SubagentSpec>| {
        agent_tools(&ToolsetOptions::default(), v, &fs, spec, vec![])
            .into_iter()
            .find(|t| t.name() == "task")
            .unwrap()
    };
    let task = task_of(17, Some(spec));
    let out = task.run(
        &json!({"description": "util", "prompt": "Cria util.rs com b().", "role": "implementer"}),
        &ctx(p),
    );
    assert!(!out.is_error, "{}", out.content);
    assert!(out.content.starts_with("Criei util.rs com b()."));
    assert!(out.content.contains("O projecto NÃO mudou"));
    assert!(out.content.contains("+pub fn b() {}"));
    // the implementer only had the file tools (no command runs without a human)
    let seen = child.seen.lock().unwrap();
    let child_tools: Vec<String> = seen[0].tools.iter().map(|t| t.name.clone()).collect();
    assert_eq!(
        child_tools,
        [
            "read",
            "glob",
            "grep",
            "edit",
            "write",
            "git_status",
            "git_diff"
        ]
    );
    // the project did not change; the saved patch applies
    assert!(!p.join("util.rs").exists());
    let path = out
        .content
        .lines()
        .find_map(|l| l.strip_prefix("Patch: "))
        .unwrap()
        .to_string();
    assert!(path.contains(".git/dxtutor/patches/"));
    git(&["apply", &path]);
    assert_eq!(
        std::fs::read_to_string(p.join("util.rs")).unwrap(),
        "pub fn b() {}\n"
    );
    // toolset 16 keeps its task: no implementer in the schema
    let dummy = || SubagentSpec {
        provider: scripted(vec![]),
        model: "m".into(),
        effort: Effort::Low,
        lang: tutor_agent::context::ReplyLang::Pt,
    };
    let enum16 = task_of(16, Some(dummy())).input_schema()["properties"]["role"]["enum"].clone();
    let enum17 = task_of(17, Some(dummy())).input_schema()["properties"]["role"]["enum"].clone();
    assert!(!enum16
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r == "implementer"));
    assert!(enum17
        .as_array()
        .unwrap()
        .iter()
        .any(|r| r == "implementer"));
    assert_ne!(
        task_of(16, Some(dummy())).description(),
        task_of(17, Some(dummy())).description()
    );
}

#[test]
fn the_loop_streams_the_subagent_progress_tagged_with_the_task_call() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("lexer.rs"), "fn tokenize() {}\n").unwrap();
    let child = scripted(vec![
        step(
            StopReason::ToolUse,
            vec![tool("g1", "grep", json!({"pattern": "fn tokenize"}))],
        ),
        step(StopReason::EndTurn, vec![text("em lexer.rs:1.")]),
    ]);
    let parent = scripted(vec![
        step(
            StopReason::ToolUse,
            vec![tool(
                "t1",
                "task",
                json!({"description": "onde está tokenize", "prompt": "Encontra tokenize.", "role": "tester"}),
            )],
        ),
        step(StopReason::EndTurn, vec![text("feito")]),
    ]);
    let spec = SubagentSpec {
        provider: child,
        model: "claude-opus-5-5".into(),
        effort: Effort::Low,
        lang: tutor_agent::context::ReplyLang::Pt,
    };
    let opts = ToolsetOptions::default();
    let tools = agent_tools(&opts, 5, &FlowState::default(), Some(spec), vec![]);
    let agent = Agent::new(parent, tools, AgentConfig::new("m"), ctx(d.path()));
    let mut t = Transcript::new();
    let mut evs = vec![];
    agent
        .run_turn(
            &mut t,
            Some(Message::user_text("onde está?")),
            &mut |e| evs.push(e),
            &mut |_| Decision::Allow,
        )
        .unwrap();
    let pos = |f: &dyn Fn(&AgentEvent) -> bool| evs.iter().position(f).expect("evento em falta");
    let start = pos(&|e| matches!(e, AgentEvent::ToolStart { id, .. } if id == "t1"));
    let end = pos(&|e| matches!(e, AgentEvent::ToolResult { id, .. } if id == "t1"));
    let steps: Vec<Value> = evs[start..end]
        .iter()
        .filter(|e| matches!(e, AgentEvent::Subagent { .. }))
        .map(|e| serde_json::to_value(e).unwrap())
        .collect();
    // a forma que a UI lê: {kind: "subagent", call, step: {type, ...}}, entre o início e o fim da chamada
    assert!(steps
        .iter()
        .all(|s| s["kind"] == "subagent" && s["call"] == "t1"));
    let types: Vec<&str> = steps
        .iter()
        .map(|s| s["step"]["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        types,
        ["started", "usage", "tool_start", "tool_result", "usage"]
    );
    assert_eq!(steps[0]["step"]["role"], "tester");
    assert_eq!(steps[2]["step"]["name"], "grep");
    assert_eq!(steps[3]["step"]["is_error"], false);
    // o total do turno do sub-agente: dois pedidos de 7 + 3
    assert_eq!(steps[4]["step"]["turn"]["input_tokens"], 14);
    assert_eq!(steps[4]["step"]["turn"]["output_tokens"], 6);
}

#[test]
fn the_loop_checkpoints_once_per_turn_before_the_first_change() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    let g = |args: &[&str]| {
        assert!(Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .unwrap()
            .status
            .success())
    };
    g(&["init", "-q", "-b", "main"]);
    // Identidade local: o checkpoint usa `git commit-tree`, e o runner do CI não tem
    // `user.name`/`user.email` globais.
    g(&["config", "user.name", "t"]);
    g(&["config", "user.email", "t@t"]);
    std::fs::write(root.join("a.txt"), "original\n").unwrap();
    g(&["add", "."]);
    g(&[
        "-c",
        "user.name=t",
        "-c",
        "user.email=t@t",
        "commit",
        "-qm",
        "init",
    ]);

    let provider = scripted(vec![
        // leitura: sem checkpoint
        step(
            StopReason::ToolUse,
            vec![tool("r", "read", json!({"path": "a.txt"}))],
        ),
        // duas alterações no mesmo turno: um só checkpoint
        step(
            StopReason::ToolUse,
            vec![tool(
                "e1",
                "edit",
                json!({"path": "a.txt", "old_string": "original", "new_string": "mudado"}),
            )],
        ),
        step(
            StopReason::ToolUse,
            vec![tool(
                "w",
                "write",
                json!({"path": "novo.txt", "content": "x"}),
            )],
        ),
        step(StopReason::EndTurn, vec![text("feito")]),
    ]);
    let tools = agent_tools(
        &ToolsetOptions::default(),
        2,
        &FlowState::default(),
        None,
        vec![],
    );
    let mut agent = Agent::new(provider, tools, AgentConfig::new("m"), ctx(root));
    agent.checkpoints = Checkpoints::new(root, "sess").map(Arc::new);
    let mut t = Transcript::new();
    let mut evs = vec![];
    agent
        .run_turn(
            &mut t,
            Some(Message::user_text("muda o a.txt")),
            &mut |e| evs.push(e),
            &mut |_| Decision::Allow,
        )
        .unwrap();
    let cps: Vec<&AgentEvent> = evs
        .iter()
        .filter(|e| matches!(e, AgentEvent::Checkpoint { .. }))
        .collect();
    assert_eq!(cps.len(), 1);
    assert!(matches!(cps[0], AgentEvent::Checkpoint { id: 1, label } if label == "muda o a.txt"));
    // o checkpoint vem antes da edição
    let pos_cp = evs
        .iter()
        .position(|e| matches!(e, AgentEvent::Checkpoint { .. }))
        .unwrap();
    let pos_edit = evs
        .iter()
        .position(|e| matches!(e, AgentEvent::ToolStart { name, .. } if name == "edit"))
        .unwrap();
    assert!(pos_cp < pos_edit);

    // e o rewind repõe o estado de antes do turno
    let cps = agent.checkpoints.as_ref().unwrap();
    cps.restore(1).unwrap();
    assert_eq!(
        std::fs::read_to_string(root.join("a.txt")).unwrap(),
        "original\n"
    );
    assert!(!root.join("novo.txt").exists());
}

#[test]
fn sessions_written_before_f6_read_as_toolset_1() {
    let d = tempfile::tempdir().unwrap();
    let line = r#"{"type":"meta","meta":{"id":"old","root":"/p","model":"m","effort":"high","system":[["x",true]],"test_cmd":null,"lint_cmd":null,"compaction":true,"created":1}}"#;
    std::fs::write(d.path().join("old.jsonl"), format!("{line}\n")).unwrap();
    let (meta, _, _) = tutor_agent::session::SessionLog::open(d.path(), "old").unwrap();
    assert_eq!(meta.toolset, 1);
}

#[cfg(unix)]
#[test]
fn project_hooks_block_give_feedback_and_run_at_stop() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path();
    std::fs::create_dir_all(root.join(".dxtutor")).unwrap();
    std::fs::write(
        root.join(".dxtutor/hooks.json"),
        r#"{"pre_tool":[{"match":"bash","command":"echo 'bash proibido neste projecto' >&2; exit 2"}],
            "post_tool":[{"match":"write","command":"echo \"lembra-te de formatar $DXTUTOR_FILE\" >&2; exit 2"}],
            "stop":[{"command":"echo fim-do-turno"}]}"#,
    )
    .unwrap();
    let provider = scripted(vec![
        step(
            StopReason::ToolUse,
            vec![
                tool("b", "bash", json!({"command": "touch nao.txt"})),
                tool("w", "write", json!({"path": "sim.txt", "content": "ok"})),
            ],
        ),
        step(StopReason::EndTurn, vec![text("feito")]),
    ]);
    let tools = agent_tools(
        &ToolsetOptions::default(),
        3,
        &FlowState::default(),
        None,
        vec![],
    );
    let mut agent = Agent::new(provider.clone(), tools, AgentConfig::new("m"), ctx(root));
    agent.hooks = tutor_agent::hooks::Hooks::load(root).unwrap().map(Arc::new);
    let mut t = Transcript::new();
    let mut evs = vec![];
    agent
        .run_turn(
            &mut t,
            Some(Message::user_text("vai")),
            &mut |e| evs.push(e),
            &mut |_| Decision::Allow,
        )
        .unwrap();
    assert!(
        !root.join("nao.txt").exists(),
        "o hook pre_tool bloqueou o bash"
    );
    assert!(root.join("sim.txt").exists());
    let results = &provider.seen.lock().unwrap()[1].messages[2].content;
    assert_eq!(results[0]["is_error"], true);
    assert!(results[0]["content"]
        .as_str()
        .unwrap()
        .contains("bloqueado por um hook do projecto: bash proibido"));
    assert!(results[1]["content"]
        .as_str()
        .unwrap()
        .ends_with("[hook do projecto] lembra-te de formatar sim.txt"));
    assert!(evs
        .iter()
        .any(|e| matches!(e, AgentEvent::Notice { text } if text == "hook stop: fim-do-turno")));
}

#[test]
fn toolset_5_adds_plan_steps_and_subagent_roles_and_keeps_4_as_it_was() {
    let fs = FlowState::default();
    let spec = SubagentSpec {
        provider: scripted(vec![]),
        model: "m".into(),
        effort: Effort::Low,
        lang: tutor_agent::context::ReplyLang::Pt,
    };
    let schema = |v: u32, name: &str| -> Value {
        agent_tools(
            &ToolsetOptions::default(),
            v,
            &fs,
            Some(spec.clone()),
            vec![],
        )
        .into_iter()
        .find(|t| t.name() == name)
        .unwrap()
        .input_schema()
    };
    // version 4 sessions resume byte for byte
    assert_eq!(
        schema(4, "exit_plan")["properties"]
            .as_object()
            .unwrap()
            .len(),
        1
    );
    assert!(schema(4, "task")["properties"].get("role").is_none());
    // version 5: steps with files and lines; roles
    let plan = schema(5, "exit_plan");
    assert_eq!(
        plan["properties"]["steps"]["items"]["properties"]["files"]["items"]["required"],
        json!(["path"])
    );
    assert_eq!(plan["required"], json!(["plan"]));
    assert_eq!(
        schema(5, "task")["properties"]["role"]["enum"],
        json!(["explorer", "reviewer", "tester", "architect"])
    );
}

#[test]
fn toolset_6_adds_ask_human_and_suggest_at_the_end_and_keeps_5_as_it_was() {
    let fs = FlowState::default();
    let tools = |v: u32| agent_tools(&ToolsetOptions::default(), v, &fs, None, vec![]);
    let n5 = names(&tools(5));
    let n6 = names(&tools(6));
    // the toolset 5 prefix stays byte for byte; the new tools come last
    assert_eq!(&n6[..n5.len()], &n5[..]);
    assert_eq!(
        &n6[n5.len()..],
        &["ask_human".to_string(), "suggest".to_string()]
    );
    let desc = |v: u32| {
        tools(v)
            .into_iter()
            .find(|t| t.name() == "exit_plan")
            .unwrap()
            .description()
            .to_string()
    };
    assert!(
        desc(5).starts_with("No modo plano"),
        "toolset 5 keeps its description"
    );
    assert!(desc(6).contains("Manual e Assistido"));
    let c = ctx(std::path::Path::new("/tmp"));
    let t6 = tools(6);
    let find = |n: &str| t6.iter().find(|t| t.name() == n).unwrap().clone();
    // exit_plan outside plan mode: an approved plan for the turn (not an error any more)
    assert!(!find("exit_plan").run(&json!({"plan": "p"}), &c).is_error);
    assert!(fs.plan_approved.load(Ordering::SeqCst));
    // ask_human records the question (with the options); suggest goes to the list
    assert!(find("ask_human").read_only());
    assert!(
        !find("ask_human")
            .run(&json!({"question": "A ou B?", "options": ["A", "B"]}), &c)
            .is_error
    );
    assert_eq!(
        fs.question.lock().unwrap().as_deref(),
        Some("A ou B? (A / B)")
    );
    assert!(
        find("ask_human")
            .run(&json!({"question": " "}), &c)
            .is_error
    );
    assert!(
        !find("suggest")
            .run(&json!({"title": "Renomear go()", "why": "src/p.rs:12"}), &c)
            .is_error
    );
    assert_eq!(
        fs.suggestions.lock().unwrap().as_slice(),
        &[("Renomear go()".to_string(), "src/p.rs:12".to_string())]
    );
}

#[test]
fn toolset_7_finish_issue_answers_every_criterion_and_keeps_6_as_it_was() {
    let fs = FlowState::default();
    let tools = |v: u32| agent_tools(&ToolsetOptions::default(), v, &fs, None, vec![]);
    let (n6, n7) = (names(&tools(6)), names(&tools(7)));
    assert_eq!(&n7[..n6.len()], &n6[..]);
    assert_eq!(&n7[n6.len()..], &["finish_issue".to_string()]);
    let c = ctx(std::path::Path::new("/tmp"));
    let t7 = tools(7);
    let finish = t7.iter().find(|t| t.name() == "finish_issue").unwrap();
    // not an issue: nothing to close
    assert!(finish.run(&json!({"criteria": []}), &c).is_error);
    *fs.criteria.lock().unwrap() = vec![
        "Dado A quando B então C".into(),
        "Dado D quando E então F".into(),
    ];
    let r = finish.run(
        &json!({"criteria": [{"index": 1, "met": true, "evidence": "test a"}]}),
        &c,
    );
    assert!(
        r.is_error && r.content.contains("faltam 2"),
        "{}",
        r.content
    );
    assert!(finish.run(&json!({"criteria": [{"index": 1, "met": true, "evidence": " "}, {"index": 2, "met": true, "evidence": "x"}]}), &c).is_error);
    let r = finish.run(&json!({"criteria": [{"index": 2, "met": false, "evidence": "falta o caso E"}, {"index": 1, "met": true, "evidence": "test a"}], "summary": "s"}), &c);
    assert!(!r.is_error && r.content.contains("1/2"), "{}", r.content);
    let done = fs.finished.lock().unwrap().clone().unwrap();
    assert_eq!(done["criteria"][0]["criterion"], "Dado A quando B então C");
    assert_eq!(done["criteria"][1]["met"], false);
}

#[test]
fn toolset_8_adds_edit_lines_at_the_end_and_it_writes_only_its_lines() {
    let fs = FlowState::default();
    let tools = |v: u32| agent_tools(&ToolsetOptions::default(), v, &fs, None, vec![]);
    let (n7, n8) = (names(&tools(7)), names(&tools(8)));
    assert_eq!(&n8[..n7.len()], &n7[..]);
    assert_eq!(&n8[n7.len()..], &["edit_lines".to_string()]);
    // without live hunks (TUI/CLI) it writes directly, after a read, with the anchor
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("a.rs"), "fn a() {}\nfn b() {}\nfn c() {}\n").unwrap();
    let c = ctx(d.path());
    let t8 = tools(8);
    let find = |n: &str| t8.iter().find(|t| t.name() == n).unwrap().clone();
    assert!(!find("read").run(&json!({"path": "a.rs"}), &c).is_error);
    let r = find("edit_lines").run(&json!({"path": "a.rs", "start": 2, "end": 2, "new_text": "fn b() { todo!() }", "anchor": "fn b() {}"}), &c);
    assert!(!r.is_error, "{}", r.content);
    assert_eq!(
        std::fs::read_to_string(d.path().join("a.rs")).unwrap(),
        "fn a() {}\nfn b() { todo!() }\nfn c() {}\n"
    );
    // the file changed since the read: refused
    let r = find("edit_lines").run(
        &json!({"path": "a.rs", "start": 1, "end": 1, "new_text": "x", "anchor": "fn a() {}"}),
        &c,
    );
    assert!(
        !r.is_error,
        "the tool's own write keeps the state fresh: {}",
        r.content
    );
    std::fs::write(d.path().join("a.rs"), "changed by the human\n").unwrap();
    let r = find("edit_lines").run(
        &json!({"path": "a.rs", "start": 1, "end": 1, "new_text": "y", "anchor": "x"}),
        &c,
    );
    assert!(r.is_error);
}

#[test]
fn toolset_9_offers_finish_issue_only_to_issue_sessions_and_keeps_8_as_it_was() {
    let fs = FlowState::default();
    let tools = |v: u32, issue: bool| {
        agent_tools(
            &ToolsetOptions {
                issue,
                ..Default::default()
            },
            v,
            &fs,
            None,
            vec![],
        )
    };
    // toolset 8: finish_issue for everyone and the old descriptions, issue or not
    assert_eq!(names(&tools(8, false)), names(&tools(8, true)));
    assert!(names(&tools(8, false)).contains(&"finish_issue".to_string()));
    let desc = |v: u32, name: &str| {
        tools(v, false)
            .into_iter()
            .find(|t| t.name() == name)
            .unwrap()
            .description()
            .to_string()
    };
    assert!(desc(8, "edit_lines").starts_with("A forma principal"));
    assert!(!desc(8, "read").contains("500"));
    // toolset 9: the same tools in the same order, minus finish_issue outside an issue
    let (n8, n9, n9i) = (
        names(&tools(8, false)),
        names(&tools(9, false)),
        names(&tools(9, true)),
    );
    assert_eq!(
        n9i, n8,
        "an issue session keeps every tool, in the same order"
    );
    let mut without = n8.clone();
    without.retain(|n| n != "finish_issue");
    assert_eq!(n9, without);
    // one preferred edit tool, and read by excerpts
    assert!(!desc(9, "edit_lines").contains("forma principal"));
    assert!(desc(9, "edit_lines").contains("prefere `edit`"));
    assert!(desc(9, "read").contains("500 linhas") && desc(9, "read").contains("outline"));
    // toolset 10 (Board B): the same tools in the same order; finish_issue answers the DoD too,
    // and a toolset 9 session keeps the old schema byte for byte
    assert_eq!(names(&tools(10, true)), n9i);
    assert_eq!(names(&tools(10, false)), n9);
    let schema = |v: u32| {
        tools(v, true)
            .into_iter()
            .find(|t| t.name() == "finish_issue")
            .unwrap()
            .input_schema()
    };
    assert!(schema(9)["properties"].get("dod").is_none());
    assert!(schema(10)["properties"]["dod"].is_object());
    // toolset 11: the backlog tools are the host's, only in backlog sessions — the core is the same
    assert_eq!(names(&tools(11, true)), n9i);
    assert_eq!(names(&tools(11, false)), n9);
    assert_eq!(schema(11), schema(10));
    // toolset 12 (H1): the same tools; only `bash` gains `unsandboxed`, and 11 keeps its schema
    assert_eq!(names(&tools(12, true)), n9i);
    let bash = |v: u32| {
        tools(v, false)
            .into_iter()
            .find(|t| t.name() == "bash")
            .unwrap()
            .input_schema()
    };
    assert!(bash(11)["properties"].get("unsandboxed").is_none());
    assert_eq!(bash(12)["properties"]["unsandboxed"]["type"], "boolean");
    // toolset 13 (H3): `ide` is the host's — the core tools and schemas stay as in 12
    assert_eq!(names(&tools(13, true)), n9i);
    assert_eq!(bash(13), bash(12));
    // toolset 14 (H4): only the host's `ide` grows — the core tools and schemas stay as in 13
    assert_eq!(names(&tools(14, true)), n9i);
    assert_eq!(bash(14), bash(13));
    // toolset 15 (H5a): + `web_fetch` at the very end — 14's prefix stays byte for byte
    let mut n15 = n9i.clone();
    n15.push("web_fetch".to_string());
    assert_eq!(names(&tools(15, true)), n15);
    assert_eq!(bash(15), bash(14));
    // toolset 16 (H5c): the same tools; only `read`'s description says images come back — 15 keeps its own
    assert_eq!(names(&tools(16, true)), n15);
    let read = |v: u32| {
        tools(v, false)
            .into_iter()
            .find(|t| t.name() == "read")
            .unwrap()
    };
    assert_eq!(read(16).input_schema(), read(15).input_schema());
    assert!(
        !read(15).description().contains("imagem") && read(16).description().contains("imagem")
    );
    // an image read: an image back in 16, «binary» in 15
    let d = tempfile::tempdir().unwrap();
    std::fs::write(
        d.path().join("shot.png"),
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2],
    )
    .unwrap();
    let c = ctx(d.path());
    let o16 = read(16).run(&json!({"path": "shot.png"}), &c);
    assert!(
        !o16.is_error && o16.images.len() == 1 && o16.images[0].media_type == "image/png",
        "{}",
        o16.content
    );
    let o15 = read(15).run(&json!({"path": "shot.png"}), &c);
    assert!(o15.is_error && o15.images.is_empty());
    // toolset 17 (H5f): the same tools; only `task` gains the implementer (its test is above)
    assert_eq!(names(&tools(17, true)), n15);
    assert_eq!(tutor_agent::tools::TOOLSET_VERSION, 17);
}

#[test]
fn read_gives_500_lines_by_default_and_says_how_to_get_more() {
    let fs = FlowState::default();
    let tools = agent_tools(&ToolsetOptions::default(), 9, &fs, None, vec![]);
    let read = tools.iter().find(|t| t.name() == "read").unwrap();
    let d = tempfile::tempdir().unwrap();
    let text: String = (1..=1200).map(|i| format!("linha {i}\n")).collect();
    std::fs::write(d.path().join("big.txt"), text).unwrap();
    let c = ctx(d.path());
    let r = read.run(&json!({"path": "big.txt"}), &c);
    assert!(!r.is_error);
    assert!(r.content.contains("linha 500\n") && !r.content.contains("linha 501\n"));
    assert!(
        r.content.contains("offset=501") && r.content.contains("outline"),
        "{}",
        r.content
    );
    // an explicit limit still goes up to 2000
    let r = read.run(&json!({"path": "big.txt", "limit": 1200}), &c);
    assert!(r.content.contains("linha 1200\n"));
}

#[test]
fn a_session_rewritten_to_a_prefix_reopens_with_it() {
    let d = tempfile::tempdir().unwrap();
    let meta = tutor_agent::session::SessionMeta {
        id: "s1".into(),
        root: "/p".into(),
        model: "m".into(),
        effort: "high".into(),
        system: vec![("x".into(), true)],
        test_cmd: None,
        lint_cmd: None,
        compaction: true,
        created: 1,
        toolset: 5,
        ..serde_json::from_value(json!({"id":"s1","root":"/p","model":"m","effort":"high","system":[],"test_cmd":null,"lint_cmd":null,"compaction":true,"created":1})).unwrap()
    };
    let mut log = tutor_agent::session::SessionLog::create(d.path(), &meta).unwrap();
    let mut t = Transcript::new();
    for q in ["um", "dois", "três"] {
        t.push(Message::user_text(q));
    }
    log.sync(&t).unwrap();
    let cut = t.truncated(1);
    log.rewrite(&cut).unwrap();
    let (m2, t2, mut log2) = tutor_agent::session::SessionLog::open(d.path(), "s1").unwrap();
    assert_eq!(m2.toolset, 5);
    assert_eq!(t2.len(), 1);
    assert_eq!(t2.messages()[0].text(), "um");
    // and it keeps appending after the rewrite
    let mut t3 = t2.clone();
    t3.push(Message::user_text("quatro"));
    log2.sync(&t3).unwrap();
    assert_eq!(
        tutor_agent::session::SessionLog::open(d.path(), "s1")
            .unwrap()
            .1
            .len(),
        2
    );
    assert!(!d.path().join("s1.jsonl.tmp").exists());
}
