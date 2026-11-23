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
    };
    let v1 = names(&agent_tools(
        &ToolsetOptions::default(),
        1,
        &fs,
        Some(spec.clone()),
    ));
    let v2 = names(&agent_tools(&ToolsetOptions::default(), 2, &fs, Some(spec)));
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
}

#[test]
fn todo_write_replaces_the_list_and_exit_plan_needs_plan_mode() {
    let d = tempfile::tempdir().unwrap();
    let fs = FlowState::default();
    let tools = agent_tools(&ToolsetOptions::default(), 2, &fs, None);
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
    };
    let tools = agent_tools(
        &ToolsetOptions::default(),
        2,
        &FlowState::default(),
        Some(spec),
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
    let tools = agent_tools(&ToolsetOptions::default(), 2, &FlowState::default(), None);
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
