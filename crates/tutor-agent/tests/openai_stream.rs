//! Provedor OpenAI-compatível (F8), sem rede: fixtures SSE no formato de cada API
//! (OpenAI, Gemini compat, Ollama `/v1`), transporte contra um servidor HTTP falso, e o
//! loop do agente com ferramentas reais guiado por esse servidor.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tutor_agent::openai::{self, Config, OpenAiCompat};
use tutor_agent::tools::{coding_tools, ToolsetOptions};
use tutor_agent::{
    Agent, AgentConfig, Decision, Message, Provider, ProviderError, Request, StopReason,
    StreamEvent, ToolCtx, Transcript, TurnOutcome,
};

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

fn parse(
    name: &str,
) -> (
    Result<tutor_agent::Response, ProviderError>,
    Vec<StreamEvent>,
) {
    let mut evs = vec![];
    let r = openai::parse_stream(fixture(name).lines().map(|l| Ok(l.to_string())), &mut |e| {
        evs.push(e);
        true
    });
    (r, evs)
}

#[test]
fn openai_fixture_streams_text_then_a_tool_call() {
    let (r, evs) = parse("openai_tool_calls.sse");
    let r = r.unwrap();
    assert_eq!((r.id.as_str(), r.model.as_str()), ("chatcmpl-1", "gpt-5"));
    assert_eq!(r.stop_reason, StopReason::ToolUse);
    assert_eq!(
        r.content[0],
        json!({"type":"text","text":"Vou criar o ficheiro."})
    );
    assert_eq!(
        r.content[1],
        json!({"type":"tool_use","id":"call_w1","name":"write","input":{"path":"ola.txt","content":"olá\n"}})
    );
    assert_eq!(
        (
            r.usage.input_tokens,
            r.usage.cache_read_input_tokens,
            r.usage.output_tokens
        ),
        (352, 2048, 35)
    );
    // os argumentos chegam aos bocados, como num stream real
    let parts = evs
        .iter()
        .filter(|e| matches!(e, StreamEvent::ToolInputDelta { .. }))
        .count();
    assert_eq!(parts, 2);
}

#[test]
fn gemini_fixture_finish_stop_with_tool_calls_and_empty_ids() {
    let (r, _) = parse("gemini_tool_calls.sse");
    let r = r.unwrap();
    assert_eq!(
        r.stop_reason,
        StopReason::ToolUse,
        "o Gemini diz \"stop\" mesmo a pedir ferramentas"
    );
    assert_eq!(r.content.len(), 2);
    assert_eq!(r.content[0]["name"], "read");
    assert_eq!(r.content[0]["input"], json!({"path":"src/main.rs"}));
    let ids: Vec<&str> = r
        .content
        .iter()
        .map(|b| b["id"].as_str().unwrap())
        .collect();
    assert!(
        ids.iter().all(|i| i.starts_with("call_dx")) && ids[0] != ids[1],
        "ids vazios → gerados e únicos: {ids:?}"
    );
    let (again, _) = parse("gemini_tool_calls.sse");
    assert!(
        !ids.contains(&again.unwrap().content[0]["id"].as_str().unwrap()),
        "e não se repetem noutro pedido"
    );
}

#[test]
fn ollama_fixture_tool_call_in_one_chunk() {
    let (r, _) = parse("ollama_tool_calls.sse");
    let r = r.unwrap();
    assert_eq!(r.stop_reason, StopReason::ToolUse);
    assert!(
        r.content.iter().all(|b| b["type"] != "text"),
        "content vazio não vira bloco"
    );
    assert_eq!(
        r.content[0],
        json!({"type":"tool_use","id":"call_k3","name":"grep","input":{"pattern":"fn main"}})
    );
    assert_eq!(r.usage.input_tokens, 610);
}

// ───── transporte contra um servidor HTTP falso ─────

struct Reply {
    status: u16,
    body: String,
}

fn fake_server(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let seen = Arc::new(Mutex::new(vec![]));
    let seen2 = seen.clone();
    thread::spawn(move || {
        for reply in replies {
            let Ok((mut s, _)) = listener.accept() else {
                return;
            };
            let mut r = BufReader::new(s.try_clone().unwrap());
            let (mut head, mut len) = (String::new(), 0usize);
            loop {
                let mut l = String::new();
                if r.read_line(&mut l).unwrap() == 0 || l == "\r\n" {
                    break;
                }
                if let Some(v) = l.to_ascii_lowercase().strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
                head.push_str(&l);
            }
            let mut body = vec![0u8; len];
            r.read_exact(&mut body).unwrap();
            seen2
                .lock()
                .unwrap()
                .push(head + "\r\n" + &String::from_utf8_lossy(&body));
            let ctype = if reply.status == 200 {
                "text/event-stream"
            } else {
                "application/json"
            };
            let out = format!(
                "HTTP/1.1 {} X\r\nconnection: close\r\ncontent-type: {ctype}\r\n\r\n{}",
                reply.status, reply.body
            );
            let _ = s.write_all(out.as_bytes());
        }
    });
    (url, seen)
}

fn provider(mut cfg: Config, url: String, sleeps: Arc<Mutex<Vec<Duration>>>) -> OpenAiCompat {
    cfg.endpoint = url;
    cfg.read_timeout = Duration::from_secs(5);
    cfg.max_retries = 2;
    OpenAiCompat::new(cfg).with_sleeper(move |d| sleeps.lock().unwrap().push(d))
}

#[test]
fn retries_429_and_sends_bearer_key_and_openai_body() {
    let (url, seen) = fake_server(vec![
        Reply {
            status: 429,
            body: r#"{"error":{"message":"Rate limit","type":"requests"}}"#.into(),
        },
        Reply {
            status: 200,
            body: fixture("openai_text.sse"),
        },
    ]);
    let sleeps = Arc::new(Mutex::new(vec![]));
    let p = provider(Config::openai("sk-oai".into()), url, sleeps.clone());
    let r = p
        .stream(
            &Request::new("gpt-5", vec![Message::user_text("olá")]),
            &mut |_| true,
        )
        .unwrap();
    assert_eq!(r.stop_reason, StopReason::EndTurn);
    assert_eq!(sleeps.lock().unwrap().len(), 1);
    let reqs = seen.lock().unwrap();
    let first = reqs[0].to_ascii_lowercase();
    assert!(first.contains("authorization: bearer sk-oai"));
    assert!(!first.contains("x-api-key") && !first.contains("anthropic-"));
    assert!(reqs[0].contains("\"max_completion_tokens\":32000"));
    assert!(reqs[0].contains("\"stream\":true"));
}

#[test]
fn ollama_without_key_and_models_without_tools_are_recognised() {
    let (url, seen) = fake_server(vec![Reply {
        status: 400,
        body: r#"{"error":{"message":"registry.ollama.ai/library/gemma2:2b does not support tools","type":"api_error"}}"#
            .into(),
    }]);
    let p = provider(
        Config::ollama("http://x"),
        url,
        Arc::new(Mutex::new(vec![])),
    );
    let e = p
        .stream(
            &Request::new("gemma2:2b", vec![Message::user_text("olá")]),
            &mut |_| true,
        )
        .unwrap_err();
    assert!(
        matches!(e, ProviderError::Http { status: 400, .. }),
        "{e:?}"
    );
    assert!(openai::is_tools_unsupported(&e));
    assert!(
        !seen.lock().unwrap()[0]
            .to_ascii_lowercase()
            .contains("authorization:"),
        "o Ollama não leva chave"
    );
}

#[test]
fn gemini_error_array_shape_is_read() {
    let (url, _) = fake_server(vec![Reply {
        status: 400,
        body:
            r#"[{"error":{"code":400,"message":"API key not valid","status":"INVALID_ARGUMENT"}}]"#
                .into(),
    }]);
    let p = provider(
        Config::gemini("k".into()),
        url,
        Arc::new(Mutex::new(vec![])),
    );
    match p.stream(
        &Request::new("gemini-2.5-pro", vec![Message::user_text("x")]),
        &mut |_| true,
    ) {
        Err(ProviderError::Http { kind, message, .. }) => {
            assert_eq!(kind, "INVALID_ARGUMENT");
            assert_eq!(message, "API key not valid");
        }
        other => panic!("{other:?}"),
    }
}

/// O loop do agente — o mesmo dos testes da Anthropic — com o provedor OpenAI: pede uma
/// ferramenta real (`write`), recebe o resultado como mensagem `tool` e termina.
#[test]
fn agent_loop_runs_real_tools_through_an_openai_compatible_server() {
    let dir = tempfile::tempdir().unwrap();
    let (url, seen) = fake_server(vec![
        Reply {
            status: 200,
            body: fixture("openai_tool_calls.sse"),
        },
        Reply {
            status: 200,
            body: fixture("openai_text.sse"),
        },
    ]);
    let p = Arc::new(provider(
        Config::openai("sk".into()),
        url,
        Arc::new(Mutex::new(vec![])),
    ));
    let ctx = ToolCtx {
        root: dir.path().to_path_buf(),
        cancel: Arc::new(AtomicBool::new(false)),
    };
    let agent = Agent::new(
        p,
        coding_tools(&ToolsetOptions::default()),
        AgentConfig::new("gpt-5"),
        ctx,
    );
    let mut t = Transcript::new();
    let out = agent
        .run_turn(
            &mut t,
            Some(Message::user_text("cria ola.txt")),
            &mut |_| {},
            &mut |_| Decision::Allow,
        )
        .unwrap();
    assert_eq!(out, TurnOutcome::Done { truncated: false });
    assert_eq!(
        std::fs::read_to_string(dir.path().join("ola.txt")).unwrap(),
        "olá\n"
    );

    // o 2.º pedido levou a chamada e o resultado no formato Chat Completions
    let reqs = seen.lock().unwrap();
    let body: Value = serde_json::from_str(reqs[1].split("\r\n\r\n").nth(1).unwrap()).unwrap();
    let msgs = body["messages"].as_array().unwrap();
    let asst = msgs.iter().find(|m| m["role"] == "assistant").unwrap();
    assert_eq!(asst["tool_calls"][0]["id"], "call_w1");
    assert_eq!(asst["tool_calls"][0]["function"]["name"], "write");
    let tool = msgs.iter().find(|m| m["role"] == "tool").unwrap();
    assert_eq!(tool["tool_call_id"], "call_w1");
    assert!(body["tools"]
        .as_array()
        .unwrap()
        .iter()
        .any(|t| t["function"]["name"] == "edit"));
    assert!(body.get("thinking").is_none() && body.get("cache_control").is_none());
    // e a resposta final ficou no histórico canónico
    assert_eq!(t.messages().last().unwrap().text(), "Criado: ola.txt.");
}
