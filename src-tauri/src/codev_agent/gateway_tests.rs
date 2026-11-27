//! The organisation's gateway as the Co-Dev's provider: what is built, and what goes on the
//! wire to a real (local) server in each API.

use std::io::{Read, Write};
use std::net::TcpListener;

use tutor_agent::provider::Request;
use tutor_agent::types::Message;
use tutor_llm::gateway::{GatewayApi, GatewaySpec};

use super::*;

fn spec(url: &str, api: GatewayApi) -> GatewaySpec {
    GatewaySpec {
        url: url.into(),
        api,
    }
}

/// Serve one request from a local socket; return what was asked.
fn serve_once(
    status_line: &'static str,
    body: &'static str,
) -> (String, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let handle = std::thread::spawn(move || {
        let (mut sock, _) = listener.accept().unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let n = sock.read(&mut chunk).unwrap();
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf).to_string();
            if let Some(end) = text.find("\r\n\r\n") {
                let len = text[..end]
                    .lines()
                    .find_map(|l| {
                        l.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .map(|v| v.trim().parse::<usize>().unwrap_or(0))
                    })
                    .unwrap_or(0);
                if buf.len() >= end + 4 + len {
                    break;
                }
            }
            if n == 0 {
                break;
            }
        }
        let reply = format!(
            "{status_line}\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        sock.write_all(reply.as_bytes()).unwrap();
        String::from_utf8_lossy(&buf).to_string()
    });
    (url, handle)
}

#[test]
fn the_gateway_provider_needs_a_gateway_and_a_key() {
    let gw = spec("https://ai.example.org", GatewayApi::Anthropic);
    assert!(make_provider("gateway", Some("k".into()), None, None, Some(&gw)).is_ok());
    assert!(make_provider("gateway", Some("k".into()), None, None, None).is_err());
    let err = make_provider("gateway", None, None, None, Some(&gw))
        .err()
        .unwrap();
    assert!(err.contains("DXTUTOR_GATEWAY_KEY"), "{err}");
    assert!(PROVIDERS.contains(&"gateway"));
    assert_eq!(
        default_model("gateway"),
        "",
        "a route, never a guessed model"
    );
    let f = provider_features("gateway");
    assert!(f.tools && !f.thinking && !f.compaction && !f.server_fallbacks && !f.effort);
    assert_eq!(client_compaction_at("gateway"), Some(150_000));
    assert!(features_notice("gateway", "support-chat")
        .unwrap()
        .contains("Gateway da organização"));
}

#[test]
fn an_anthropic_gateway_gets_the_gateway_key_the_route_and_no_betas() {
    let sse = "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"model\":\"support-chat\",\"usage\":{\"input_tokens\":3}}}\n\n\
               event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n\
               event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Olá\"}}\n\n\
               event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n\
               event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":1}}\n\n\
               event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
    let (url, server) = serve_once("HTTP/1.1 200 OK", sse);
    let provider = gateway_provider(&spec(&url, GatewayApi::Anthropic), "sk-gw-desk".into());
    let mut req = Request::new("support-chat", vec![Message::user_text("oi")]);
    // what the agent sends for the gateway: the extras off (provider_features)
    req.fallbacks = false;
    req.compaction = false;
    let resp = provider.stream(&req, &mut |_| true).unwrap();
    assert!(format!("{resp:?}").contains("Olá"), "{resp:?}");
    let asked = server.join().unwrap();
    let lower = asked.to_ascii_lowercase();
    assert!(asked.starts_with("POST /v1/messages "), "{asked}");
    assert!(lower.contains("x-api-key: sk-gw-desk"), "{asked}");
    assert!(
        !lower.contains("anthropic-beta"),
        "no betas to a gateway: {asked}"
    );
    assert!(!lower.contains("anthropic-workspace-id"));
    assert!(asked.contains("\"model\":\"support-chat\""));
}

#[test]
fn an_openai_gateway_gets_a_bearer_and_max_tokens() {
    let sse = "data: {\"model\":\"support-chat\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Olá\"},\"finish_reason\":\"stop\"}]}\n\n\
               data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1}}\n\ndata: [DONE]\n\n";
    let (url, server) = serve_once("HTTP/1.1 200 OK", sse);
    let provider = gateway_provider(&spec(&url, GatewayApi::Openai), "sk-gw-desk".into());
    let req = Request::new("support-chat", vec![Message::user_text("oi")]);
    provider.stream(&req, &mut |_| true).unwrap();
    let asked = server.join().unwrap();
    assert!(asked.starts_with("POST /v1/chat/completions "), "{asked}");
    assert!(
        asked
            .to_ascii_lowercase()
            .contains("authorization: bearer sk-gw-desk"),
        "{asked}"
    );
    assert!(asked.contains("\"max_tokens\""), "{asked}");
    assert!(!asked.contains("max_completion_tokens"));
}
