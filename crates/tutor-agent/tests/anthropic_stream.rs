//! Provedor Anthropic sem rede: o parser contra fixtures SSE (escritas à mão segundo o
//! formato documentado dos eventos) e o transporte contra um servidor HTTP falso local.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::json;
use tutor_agent::anthropic::{self, sse, Anthropic, Config};
use tutor_agent::{Message, Provider, ProviderError, Request, StopReason, StreamEvent};

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
    let text = fixture(name);
    let r = sse::parse_stream(text.lines().map(|l| Ok(l.to_string())), &mut |e| {
        evs.push(e);
        true
    });
    (r, evs)
}

#[test]
fn tool_use_stream_rebuilds_every_block_verbatim() {
    let (r, evs) = parse("tool_use.sse");
    let r = r.unwrap();
    assert_eq!(r.id, "msg_01");
    assert_eq!(r.model, "claude-opus-5-5");
    assert_eq!(r.stop_reason, StopReason::ToolUse);
    assert_eq!(r.usage.input_tokens, 812);
    assert_eq!(r.usage.cache_creation_input_tokens, 2048);
    assert_eq!(r.usage.output_tokens, 94);
    assert!(r.invalid_tool_inputs.is_empty());

    // thinking com a assinatura — tem de voltar ao servidor exactamente assim
    assert_eq!(
        r.content[0],
        json!({"type":"thinking","thinking":"Preciso de ver o lexer primeiro.","signature":"EqQBCkYIBRgCKkB0c2ln"})
    );
    assert_eq!(
        r.content[1],
        json!({"type":"text","text":"Vou ler o lexer."})
    );
    assert_eq!(
        r.content[2]["input"],
        json!({"path":"crates/lexer/src/lib.rs","limit":200})
    );
    // ferramenta sem parâmetros (sem deltas) → input {}
    assert_eq!(r.content[3]["input"], json!({}));

    let m = Message::assistant(r.content.clone());
    let uses = m.tool_uses();
    assert_eq!(
        uses.iter().map(|u| u.name.as_str()).collect::<Vec<_>>(),
        ["read", "git_status"]
    );

    // eventos em tempo real: texto, thinking, input das ferramentas e pings
    let text: String = evs
        .iter()
        .filter_map(|e| {
            if let StreamEvent::TextDelta { text, .. } = e {
                Some(text.as_str())
            } else {
                None
            }
        })
        .collect();
    assert_eq!(text, "Vou ler o lexer.");
    assert!(evs
        .iter()
        .any(|e| matches!(e, StreamEvent::ThinkingDelta { .. })));
    assert!(evs
        .iter()
        .any(|e| matches!(e, StreamEvent::ToolInputDelta { index: 2, .. })));
    assert!(evs.contains(&StreamEvent::Ping));
}

#[test]
fn refusal_carries_details_and_flags_the_cut_tool_input() {
    let (r, _) = parse("refusal.sse");
    let r = r.unwrap();
    assert_eq!(r.stop_reason, StopReason::Refusal);
    assert_eq!(r.stop_details.as_ref().unwrap()["category"], "cyber");
    // o input da ferramenta ficou cortado a meio: marcado como inválido, não executável
    assert_eq!(
        r.invalid_tool_inputs,
        vec![("toolu_09".to_string(), "{\"command\": \"cu".to_string())]
    );
    assert_eq!(r.content[0]["input"], json!({}));
}

#[test]
fn error_event_mid_stream_is_an_error_not_a_finished_answer() {
    let (r, evs) = parse("overloaded_midstream.sse");
    assert_eq!(
        r,
        Err(ProviderError::Stream {
            kind: "overloaded_error".into(),
            message: "Overloaded".into()
        })
    );
    assert!(evs
        .iter()
        .any(|e| matches!(e, StreamEvent::TextDelta { .. })));
}

#[test]
fn stream_cut_before_message_delta_is_a_protocol_error() {
    let (r, _) = parse("cut_short.sse");
    assert!(matches!(r, Err(ProviderError::Protocol(m)) if m.contains("stop_reason")));
}

#[test]
fn fallback_and_unknown_blocks_and_deltas_pass_through() {
    let (r, _) = parse("fallback_and_unknown.sse");
    let r = r.unwrap();
    assert_eq!(r.model, "claude-opus-4-8"); // quem respondeu de facto
    assert_eq!(r.content[0]["type"], "fallback");
    assert_eq!(r.content[0]["from"]["model"], "claude-opus-5-5");
    assert_eq!(r.content[1], json!({"type":"text","text":"Feito."}));
    assert_eq!(r.stop_reason, StopReason::EndTurn);
}

#[test]
fn callback_returning_false_cancels() {
    let text = fixture("tool_use.sse");
    let mut seen = 0;
    let r = sse::parse_stream(text.lines().map(|l| Ok(l.to_string())), &mut |e| {
        seen += 1;
        !matches!(e, StreamEvent::TextDelta { .. })
    });
    assert_eq!(r, Err(ProviderError::Cancelled));
    assert!(seen > 0);
}

// ───── transporte contra um servidor HTTP falso ─────

struct Reply {
    status: u16,
    headers: Vec<(&'static str, &'static str)>,
    body: String,
}

/// Servidor local que responde às ligações pela ordem de `replies` e guarda os pedidos.
fn fake_server(replies: Vec<Reply>) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1/messages", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(vec![]));
    let seen2 = seen.clone();
    thread::spawn(move || {
        for reply in replies {
            let Ok((mut s, _)) = listener.accept() else {
                return;
            };
            // lê cabeçalhos + corpo (content-length) antes de responder
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut head = String::new();
            let mut len = 0usize;
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
            let mut out = format!("HTTP/1.1 {} X\r\nconnection: close\r\n", reply.status);
            for (k, v) in &reply.headers {
                out.push_str(&format!("{k}: {v}\r\n"));
            }
            out.push_str("\r\n");
            out.push_str(&reply.body);
            let _ = s.write_all(out.as_bytes());
        }
    });
    (url, seen)
}

fn provider(url: String, sleeps: Arc<Mutex<Vec<Duration>>>) -> Anthropic {
    let mut c = Config::new("sk-test");
    c.endpoint = url;
    c.read_timeout = Duration::from_secs(5);
    c.max_retries = 3;
    Anthropic::new(c).with_sleeper(move |d| sleeps.lock().unwrap().push(d))
}

fn request() -> Request {
    Request::new(anthropic::DEFAULT_MODEL, vec![Message::user_text("olá")])
}

const OVERLOADED: &str =
    r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#;

#[test]
fn retries_529_and_429_then_streams() {
    let ok = Reply {
        status: 200,
        headers: vec![("content-type", "text/event-stream")],
        body: fixture("tool_use.sse"),
    };
    let (url, seen) = fake_server(vec![
        Reply {
            status: 529,
            headers: vec![],
            body: OVERLOADED.into(),
        },
        Reply {
            status: 429,
            headers: vec![("retry-after", "2")],
            body: "{}".into(),
        },
        ok,
    ]);
    let sleeps = Arc::new(Mutex::new(vec![]));
    let r = provider(url, sleeps.clone())
        .stream(&request(), &mut |_| true)
        .unwrap();
    assert_eq!(r.stop_reason, StopReason::ToolUse);
    let sleeps = sleeps.lock().unwrap();
    assert_eq!(sleeps.len(), 2);
    assert_eq!(sleeps[1], Duration::from_secs(2), "retry-after respeitado");

    // o pedido levou a versão, o beta e o corpo do harness v2
    let reqs = seen.lock().unwrap();
    assert_eq!(reqs.len(), 3);
    let first = reqs[0].to_ascii_lowercase();
    assert!(first.contains("anthropic-version: 2026-10-21"));
    assert!(first.contains("anthropic-beta: server-side-fallback-2026-07-01"));
    assert!(first.contains("x-api-key: sk-test"));
    assert!(reqs[0].contains("\"model\":\"claude-opus-5-5\""));
    assert!(reqs[0].contains("\"stream\":true"));
}

#[test]
fn does_not_retry_client_errors_or_when_the_server_says_no() {
    let (url, seen) = fake_server(vec![Reply {
        status: 400,
        headers: vec![],
        body: r#"{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}"#.into(),
    }]);
    let sleeps = Arc::new(Mutex::new(vec![]));
    let r = provider(url, sleeps.clone()).stream(&request(), &mut |_| true);
    assert_eq!(
        r,
        Err(ProviderError::Http {
            status: 400,
            kind: "invalid_request_error".into(),
            message: "bad".into()
        })
    );
    assert!(sleeps.lock().unwrap().is_empty());
    assert_eq!(seen.lock().unwrap().len(), 1);

    let (url, _) = fake_server(vec![Reply {
        status: 503,
        headers: vec![("x-should-retry", "false")],
        body: OVERLOADED.into(),
    }]);
    let sleeps = Arc::new(Mutex::new(vec![]));
    let r = provider(url, sleeps.clone()).stream(&request(), &mut |_| true);
    assert!(matches!(r, Err(ProviderError::Http { status: 503, .. })));
    assert!(sleeps.lock().unwrap().is_empty());
}

#[test]
fn gives_up_after_max_retries_with_the_last_error() {
    let replies = (0..4)
        .map(|_| Reply {
            status: 529,
            headers: vec![],
            body: OVERLOADED.into(),
        })
        .collect();
    let (url, seen) = fake_server(replies);
    let sleeps = Arc::new(Mutex::new(vec![]));
    let r = provider(url, sleeps.clone()).stream(&request(), &mut |_| true);
    assert!(
        matches!(r, Err(ProviderError::Http { status: 529, ref kind, .. }) if kind == "overloaded_error")
    );
    assert_eq!(seen.lock().unwrap().len(), 4); // 1 + 3 retries
    assert_eq!(sleeps.lock().unwrap().len(), 3);
}

#[test]
fn connection_refused_is_retried_then_reported_as_transport() {
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port(); // fecha logo
    let sleeps = Arc::new(Mutex::new(vec![]));
    let r = provider(
        format!("http://127.0.0.1:{port}/v1/messages"),
        sleeps.clone(),
    )
    .stream(&request(), &mut |_| true);
    assert!(matches!(r, Err(ProviderError::Transport(_))), "{r:?}");
    assert_eq!(sleeps.lock().unwrap().len(), 3);
}

#[test]
fn prefill_never_leaves_the_machine() {
    let (url, seen) = fake_server(vec![]);
    let mut req = request();
    req.messages.push(Message::assistant(vec![
        json!({"type":"text","text":"Claro"}),
    ]));
    let r = provider(url, Arc::new(Mutex::new(vec![]))).stream(&req, &mut |_| true);
    assert!(matches!(r, Err(ProviderError::InvalidRequest(_))));
    assert!(seen.lock().unwrap().is_empty());
}
