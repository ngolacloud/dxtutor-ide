//! Ponta-a-ponta sem rede: o loop (F1) com as ferramentas reais (F2) numa pasta
//! temporária, guiado por um "modelo" guionado que faz o ciclo ler → editar →
//! testar → corrigir → testar.

use std::collections::VecDeque;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tutor_agent::tools::{coding_tools, ToolsetOptions};
use tutor_agent::{
    Agent, AgentConfig, AgentEvent, Decision, Message, Provider, ProviderError, Request, Response,
    StopReason, StreamEvent, ToolCtx, Transcript, TurnOutcome, Usage,
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

fn step(stop: StopReason, content: Vec<Value>) -> Response {
    Response {
        id: "m".into(),
        model: "claude-opus-5-5".into(),
        content,
        stop_reason: stop,
        stop_details: None,
        usage: Usage::default(),
        invalid_tool_inputs: vec![],
    }
}

fn tool(id: &str, name: &str, input: Value) -> Value {
    json!({"type": "tool_use", "id": id, "name": name, "input": input})
}

/// O resultado do tool_use `id` no histórico.
fn result_for(t: &Transcript, id: &str) -> (String, bool) {
    for m in t.messages() {
        for b in &m.content {
            if b["type"] == "tool_result" && b["tool_use_id"] == id {
                return (
                    b["content"].as_str().unwrap().to_string(),
                    b["is_error"] == true,
                );
            }
        }
    }
    panic!("sem resultado para {id}");
}

#[test]
fn read_edit_test_fix_test_against_a_real_folder() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("soma.sh"), "echo $((2 - 2))\n").unwrap();
    // "testes": passam quando soma.sh imprime 4
    let test_cmd =
        "test \"$(sh soma.sh)\" = 4 || { echo esperado 4, obtido $(sh soma.sh); exit 1; }";

    let script = vec![
        step(
            StopReason::ToolUse,
            vec![tool("r1", "read", json!({"path": "soma.sh"}))],
        ),
        // primeira tentativa errada (2 * 1 = 2) → testes falham
        step(
            StopReason::ToolUse,
            vec![tool(
                "e1",
                "edit",
                json!({"path": "soma.sh", "old_string": "2 - 2", "new_string": "2 * 1"}),
            )],
        ),
        step(
            StopReason::ToolUse,
            vec![tool("t1", "run_tests", json!({}))],
        ),
        // vê a falha real e corrige
        step(
            StopReason::ToolUse,
            vec![tool(
                "e2",
                "edit",
                json!({"path": "soma.sh", "old_string": "2 * 1", "new_string": "2 + 2"}),
            )],
        ),
        step(
            StopReason::ToolUse,
            vec![tool("t2", "run_tests", json!({}))],
        ),
        step(
            StopReason::EndTurn,
            vec![json!({"type": "text", "text": "Corrigido e verificado."})],
        ),
    ];
    let provider = Arc::new(Scripted {
        replies: Mutex::new(script.into()),
        seen: Mutex::new(vec![]),
    });
    let ctx = ToolCtx {
        root: dir.path().to_path_buf(),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let tools = coding_tools(&ToolsetOptions {
        test_cmd: Some(test_cmd.into()),
        ..Default::default()
    });
    let agent = Agent::new(
        provider.clone(),
        tools,
        AgentConfig::new("claude-opus-5-5"),
        ctx,
    );

    let mut t = Transcript::new();
    let mut evs = vec![];
    let mut asked = vec![];
    let out = agent
        .run_turn(
            &mut t,
            Some(Message::user_text("corrige a soma")),
            &mut |e| evs.push(e),
            &mut |c| {
                asked.push((c.name.clone(), c.read_only));
                Decision::Allow
            },
        )
        .unwrap();
    assert_eq!(out, TurnOutcome::Done { truncated: false });

    // os testes reais falharam primeiro e passaram depois — o modelo viu a saída real
    let (t1, t1_err) = result_for(&t, "t1");
    assert!(t1_err && t1.contains("esperado 4, obtido 2"), "{t1}");
    let (t2, t2_err) = result_for(&t, "t2");
    assert!(!t2_err && t2.contains("exit 0"), "{t2}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("soma.sh")).unwrap(),
        "echo $((2 + 2))\n"
    );

    // o loop pergunta ao anfitrião por cada chamada e diz-lhe se é só leitura
    // (é o anfitrião — codev_agent — que deixa as leituras passar sem perguntar)
    assert!(asked.contains(&("read".to_string(), true)));
    assert_eq!(asked.iter().filter(|(n, ro)| n == "edit" && !ro).count(), 2);
    assert_eq!(
        asked
            .iter()
            .filter(|(n, ro)| n == "run_tests" && !ro)
            .count(),
        2
    );
    // o modelo recebeu as definições das ferramentas reais, por ordem fixa
    let names: Vec<String> = provider.seen.lock().unwrap()[0]
        .tools
        .iter()
        .map(|d| d.name.clone())
        .collect();
    assert_eq!(
        names,
        [
            "read",
            "glob",
            "grep",
            "edit",
            "write",
            "bash",
            "git_status",
            "git_diff",
            "run_tests"
        ]
    );
    assert!(evs.iter().any(
        |e| matches!(e, AgentEvent::ToolResult { name, is_error: true, .. } if name == "run_tests")
    ));
}
