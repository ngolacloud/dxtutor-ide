//! Model providers. Two wire formats cover the four providers:
//! - Anthropic Messages API (Claude)
//! - OpenAI-compatible chat completions (OpenAI/Codex, Gemini's OpenAI endpoint, Ollama)
//! The UI drives the tool loop; this module sends one request and normalises the answer.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Deserialize, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub input: Value,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub id: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Msg {
    pub role: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(default)]
    pub tool_results: Option<Vec<ToolResult>>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Tool {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "empty_schema")]
    pub input_schema: Value,
}

fn empty_schema() -> Value {
    json!({"type": "object", "properties": {}})
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChatReq {
    /// claude | codex | gemini | ollama (or any other id with an OpenAI-compatible endpoint)
    pub provider: String,
    pub endpoint: String,
    pub model: String,
    #[serde(default)]
    pub system: Option<String>,
    pub messages: Vec<Msg>,
    #[serde(default)]
    pub tools: Vec<Tool>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatResp {
    pub text: String,
    pub tool_calls: Vec<ToolCall>,
    pub stop: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Which pipeline produced this reply. The raw [`chat`] leaves it empty; the governed
    /// entry [`chat_governed`] stamps `"tutor-llm"` so a caller (and the selftest) can prove
    /// the Co-Dev turn went through the tutor brain, not a parallel ungoverned path.
    #[serde(default)]
    pub origin: String,
    /// True when the study tutor contract governed this turn (directive prepended).
    #[serde(default)]
    pub tutored: bool,
}

pub fn is_anthropic(provider: &str) -> bool {
    provider == "claude" || provider == GATEWAY_ANTHROPIC
}

/// The organisation's gateway, as `llm_chat` addresses it once the policy resolved it:
/// the provider id carries the API the gateway speaks.
pub const GATEWAY_ANTHROPIC: &str = "gateway:anthropic";
/// See [`GATEWAY_ANTHROPIC`].
pub const GATEWAY_OPENAI: &str = "gateway:openai";

/// Point a chat request at the organisation's gateway: its URL (never the one the UI sent)
/// and the API it speaks. `req.model` stays the route the UI picked.
pub fn route_to_gateway(req: &mut ChatReq, gateway: &tutor_llm::gateway::GatewaySpec) {
    req.endpoint = gateway.url.trim().trim_end_matches('/').to_string();
    req.provider = match gateway.api {
        tutor_llm::gateway::GatewayApi::Anthropic => GATEWAY_ANTHROPIC,
        tutor_llm::gateway::GatewayApi::Openai => GATEWAY_OPENAI,
    }
    .to_string();
}

pub fn url_for(req: &ChatReq) -> String {
    let ep = req.endpoint.trim_end_matches('/');
    if is_anthropic(&req.provider) {
        if ep.ends_with("/messages") {
            ep.to_string()
        } else {
            format!("{ep}/v1/messages")
        }
    } else if ep.ends_with("/chat/completions") {
        ep.to_string()
    } else if req.provider == "gemini" {
        format!("{ep}/v1beta/openai/chat/completions")
    } else {
        format!("{ep}/v1/chat/completions")
    }
}

pub fn env_key(provider: &str) -> Option<&'static str> {
    match provider {
        "claude" => Some("ANTHROPIC_API_KEY"),
        "codex" => Some("OPENAI_API_KEY"),
        "gemini" => Some("GEMINI_API_KEY"),
        "gateway" => Some("DXTUTOR_GATEWAY_KEY"),
        _ => None,
    }
}

pub fn anthropic_body(req: &ChatReq) -> Value {
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|m| {
            if let Some(rs) = &m.tool_results {
                json!({"role": "user", "content": rs.iter().map(|r| json!({"type": "tool_result", "tool_use_id": r.id, "content": r.content})).collect::<Vec<_>>()})
            } else if let Some(cs) = &m.tool_calls {
                let mut content = Vec::new();
                if let Some(t) = m.text.as_ref().filter(|t| !t.is_empty()) {
                    content.push(json!({"type": "text", "text": t}));
                }
                content.extend(cs.iter().map(|c| json!({"type": "tool_use", "id": c.id, "name": c.name, "input": c.input})));
                json!({"role": "assistant", "content": content})
            } else {
                json!({"role": m.role, "content": m.text.clone().unwrap_or_default()})
            }
        })
        .collect();
    let mut body = json!({"model": req.model, "max_tokens": req.max_tokens.unwrap_or(4096), "messages": messages});
    if let Some(s) = &req.system {
        body["system"] = json!(s);
    }
    if !req.tools.is_empty() {
        body["tools"] = json!(req.tools.iter().map(|t| json!({"name": t.name, "description": t.description, "input_schema": t.input_schema})).collect::<Vec<_>>());
    }
    body
}

pub fn openai_body(req: &ChatReq) -> Value {
    let mut messages = Vec::new();
    if let Some(s) = &req.system {
        messages.push(json!({"role": "system", "content": s}));
    }
    for m in &req.messages {
        if let Some(rs) = &m.tool_results {
            for r in rs {
                messages.push(json!({"role": "tool", "tool_call_id": r.id, "content": r.content}));
            }
        } else if let Some(cs) = &m.tool_calls {
            messages.push(json!({
                "role": "assistant",
                "content": m.text.clone().filter(|t| !t.is_empty()),
                "tool_calls": cs.iter().map(|c| json!({"id": c.id, "type": "function", "function": {"name": c.name, "arguments": c.input.to_string()}})).collect::<Vec<_>>()
            }));
        } else {
            messages.push(json!({"role": m.role, "content": m.text.clone().unwrap_or_default()}));
        }
    }
    let mut body = json!({"model": req.model, "messages": messages});
    if let Some(n) = req.max_tokens {
        body["max_tokens"] = json!(n);
    }
    if !req.tools.is_empty() {
        body["tools"] = json!(req.tools.iter().map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.input_schema}})).collect::<Vec<_>>());
    }
    body
}

pub fn parse_anthropic(v: &Value) -> ChatResp {
    let mut r = ChatResp {
        stop: v["stop_reason"].as_str().unwrap_or("").to_string(),
        ..Default::default()
    };
    for b in v["content"].as_array().into_iter().flatten() {
        match b["type"].as_str() {
            Some("text") => r.text.push_str(b["text"].as_str().unwrap_or("")),
            Some("tool_use") => r.tool_calls.push(ToolCall {
                id: b["id"].as_str().unwrap_or("").into(),
                name: b["name"].as_str().unwrap_or("").into(),
                input: b["input"].clone(),
            }),
            _ => {}
        }
    }
    r.input_tokens = v["usage"]["input_tokens"].as_u64().unwrap_or(0);
    r.output_tokens = v["usage"]["output_tokens"].as_u64().unwrap_or(0);
    r
}

pub fn parse_openai(v: &Value) -> ChatResp {
    let c = &v["choices"][0];
    let m = &c["message"];
    let mut r = ChatResp {
        text: m["content"].as_str().unwrap_or("").to_string(),
        stop: c["finish_reason"].as_str().unwrap_or("").to_string(),
        ..Default::default()
    };
    for (i, t) in m["tool_calls"].as_array().into_iter().flatten().enumerate() {
        let args = &t["function"]["arguments"];
        let input = match args {
            Value::String(s) => serde_json::from_str(s).unwrap_or(json!({})),
            Value::Object(_) => args.clone(),
            _ => json!({}),
        };
        r.tool_calls.push(ToolCall {
            id: t["id"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(|| format!("call_{i}")),
            name: t["function"]["name"].as_str().unwrap_or("").into(),
            input,
        });
    }
    r.input_tokens = v["usage"]["prompt_tokens"].as_u64().unwrap_or(0);
    r.output_tokens = v["usage"]["completion_tokens"].as_u64().unwrap_or(0);
    r
}

/// Resolve the model to actually send to Ollama. Ollama 404s when the requested model
/// isn't pulled, so — only for the local Ollama provider — fall back to an available
/// model (preferring Qwen) exactly like [`tutor_llm::chat::ollama_chat`]. When no model
/// is available (Ollama down/empty) the requested id is kept verbatim so the existing
/// error surfaces unchanged. Other providers never reach here: they keep `req.model`
/// verbatim because they carry an explicit key + model.
fn resolve_ollama_model(requested: &str, available: &[String]) -> String {
    tutor_llm::chat::pick_model(Some(requested), available).unwrap_or_else(|| requested.to_string())
}

/// The `anthropic-workspace-id` header to attach, if a non-empty workspace id is configured.
/// Only org-scoped Anthropic keys need it; a blank/absent id yields no header.
fn anthropic_ws_header(workspace_id: Option<&str>) -> Option<(&'static str, String)> {
    workspace_id
        .map(str::trim)
        .filter(|w| !w.is_empty())
        .map(|w| ("anthropic-workspace-id", w.to_string()))
}

pub async fn chat(
    mut req: ChatReq,
    key: Option<String>,
    workspace_id: Option<String>,
) -> Result<ChatResp, String> {
    let anth = is_anthropic(&req.provider);
    if key.is_none() && env_key(&req.provider).is_some() {
        return Err(format!(
            "No API key for {}. Add it in Settings → Models and providers, or set {}.",
            req.provider,
            env_key(&req.provider).unwrap()
        ));
    }
    if req.provider == "ollama" {
        let available = tutor_llm::chat::ollama_models();
        if !available.is_empty() {
            req.model = resolve_ollama_model(&req.model, &available);
        }
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let mut rb = client.post(url_for(&req));
    let body = if anth {
        anthropic_body(&req)
    } else {
        openai_body(&req)
    };
    if anth {
        rb = rb.header("anthropic-version", "2023-06-01");
        if let Some(k) = &key {
            rb = rb.header("x-api-key", k);
        }
        // Org-scoped keys (sk-ant-usr-…) require the workspace id, exactly like the legacy
        // streaming path in tutor_llm::chat; without it the API rejects the request.
        if let Some((h, v)) = anthropic_ws_header(workspace_id.as_deref()) {
            rb = rb.header(h, v);
        }
    } else if let Some(k) = &key {
        rb = rb.bearer_auth(k);
    }
    // r23 F4a (X02): no secret leaves for the model
    let mut body = body;
    tutor_protect::redact::guard_json("assistant", &mut body);
    let res = rb
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("{}: {e}", req.provider))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let snippet: String = text.chars().take(400).collect();
        return Err(format!("{} returned {status}: {snippet}", req.provider));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("invalid JSON from {}: {e}", req.provider))?;
    Ok(if anth {
        parse_anthropic(&v)
    } else {
        parse_openai(&v)
    })
}

/// Run a chat turn through the tutor brain. The governance in [`tutor_llm::policy`]
/// decides the system prompt from the active mode (study ⇒ the tutor directive leads;
/// project ⇒ full pair-programming) exactly as `assistant_chat_stream` does, then the
/// provider is called and the reply stamped with its provenance. This is the single
/// entry the desktop Co-Dev uses, so it is governed instead of being a generic LLM path.
/// The tool-capable request/response transport (which `tutor_llm` deliberately lacks)
/// stays here in [`chat`]; only the governance moves into the brain crate.
pub async fn chat_governed(
    mut req: ChatReq,
    key: Option<String>,
    mode: tutor_llm::policy::Mode,
    workspace_id: Option<String>,
) -> Result<ChatResp, String> {
    let governed = tutor_llm::policy::govern_chat(mode, req.system.as_deref());
    req.system = governed.system;
    let mut resp = chat(req, key, workspace_id).await?;
    resp.origin = "tutor-llm".into();
    resp.tutored = governed.tutored;
    Ok(resp)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(provider: &str, endpoint: &str) -> ChatReq {
        ChatReq {
            provider: provider.into(),
            endpoint: endpoint.into(),
            model: "m".into(),
            system: Some("be brief".into()),
            messages: vec![
                Msg {
                    role: "user".into(),
                    text: Some("read README".into()),
                    tool_calls: None,
                    tool_results: None,
                },
                Msg {
                    role: "assistant".into(),
                    text: Some("ok".into()),
                    tool_calls: Some(vec![ToolCall {
                        id: "t1".into(),
                        name: "read_file".into(),
                        input: json!({"path": "README.md"}),
                    }]),
                    tool_results: None,
                },
                Msg {
                    role: "user".into(),
                    text: None,
                    tool_calls: None,
                    tool_results: Some(vec![ToolResult {
                        id: "t1".into(),
                        content: "# hi".into(),
                    }]),
                },
            ],
            tools: vec![Tool {
                name: "read_file".into(),
                description: "Reads a file".into(),
                input_schema: json!({"type": "object"}),
            }],
            max_tokens: Some(100),
        }
    }

    #[test]
    fn urls_per_provider() {
        assert_eq!(
            url_for(&req("claude", "https://api.anthropic.com/")),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            url_for(&req("codex", "https://api.openai.com")),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            url_for(&req("gemini", "https://generativelanguage.googleapis.com")),
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        );
        assert_eq!(
            url_for(&req("ollama", "http://localhost:11434")),
            "http://localhost:11434/v1/chat/completions"
        );
        assert_eq!(
            url_for(&req("ollama", "http://h:1/v1/chat/completions")),
            "http://h:1/v1/chat/completions"
        );
    }

    #[test]
    fn anthropic_body_maps_tool_use_and_results() {
        let b = anthropic_body(&req("claude", "x"));
        assert_eq!(b["system"], "be brief");
        assert_eq!(b["messages"][1]["content"][1]["type"], "tool_use");
        assert_eq!(b["messages"][1]["content"][1]["input"]["path"], "README.md");
        assert_eq!(b["messages"][2]["content"][0]["type"], "tool_result");
        assert_eq!(b["messages"][2]["content"][0]["tool_use_id"], "t1");
        assert_eq!(b["tools"][0]["input_schema"]["type"], "object");
    }

    #[test]
    fn openai_body_maps_tool_calls_and_tool_messages() {
        let b = openai_body(&req("codex", "x"));
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(
            b["messages"][2]["tool_calls"][0]["function"]["arguments"],
            "{\"path\":\"README.md\"}"
        );
        assert_eq!(b["messages"][3]["role"], "tool");
        assert_eq!(b["messages"][3]["tool_call_id"], "t1");
        assert_eq!(b["tools"][0]["type"], "function");
    }

    #[test]
    fn ollama_falls_back_to_available_model_preferring_qwen() {
        let available = vec![
            "llama3.2:latest".to_string(),
            "qwen3:8b".to_string(),
            "gemma3:27b".to_string(),
        ];
        // UI default not pulled ⇒ pick an available model, preferring Qwen.
        assert_eq!(
            resolve_ollama_model("qwen2.5-coder:14b", &available),
            "qwen3:8b"
        );
        // Requested model present ⇒ kept as-is.
        assert_eq!(
            resolve_ollama_model("llama3.2:latest", &available),
            "llama3.2:latest"
        );
        // Nothing available ⇒ keep the request verbatim so the usual error surfaces.
        assert_eq!(
            resolve_ollama_model("qwen2.5-coder:14b", &[]),
            "qwen2.5-coder:14b"
        );
    }

    #[test]
    fn anthropic_workspace_header_only_when_configured() {
        assert_eq!(
            anthropic_ws_header(Some("wrkspc_019")),
            Some(("anthropic-workspace-id", "wrkspc_019".to_string()))
        );
        // Trimmed, and blank/None yield no header.
        assert_eq!(
            anthropic_ws_header(Some("  wrkspc_019  ")),
            Some(("anthropic-workspace-id", "wrkspc_019".to_string()))
        );
        assert_eq!(anthropic_ws_header(Some("   ")), None);
        assert_eq!(anthropic_ws_header(None), None);
    }

    #[test]
    fn parses_both_formats() {
        let a = parse_anthropic(
            &json!({"content": [{"type": "text", "text": "Hi"}, {"type": "tool_use", "id": "x", "name": "run_tests", "input": {"package": "lexer"}}], "stop_reason": "tool_use", "usage": {"input_tokens": 10, "output_tokens": 5}}),
        );
        assert_eq!(a.text, "Hi");
        assert_eq!(a.tool_calls[0].input["package"], "lexer");
        assert_eq!((a.input_tokens, a.output_tokens), (10, 5));
        let o = parse_openai(
            &json!({"choices": [{"message": {"content": null, "tool_calls": [{"id": "c1", "type": "function", "function": {"name": "read_file", "arguments": "{\"path\":\"a\"}"}}]}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}),
        );
        assert_eq!(o.text, "");
        assert_eq!(o.tool_calls[0].name, "read_file");
        assert_eq!(o.tool_calls[0].input["path"], "a");
        assert_eq!(o.stop, "tool_calls");
    }

    #[test]
    fn a_chat_to_the_gateway_uses_its_url_and_its_api() {
        let mut req: ChatReq = serde_json::from_value(serde_json::json!({
            "provider": "gateway", "endpoint": "https://evil.example", "model": "support-chat",
            "messages": [{"role": "user", "content": "oi"}]
        }))
        .unwrap();
        let gw = tutor_llm::gateway::GatewaySpec {
            url: "https://ai.example.org/".into(),
            api: tutor_llm::gateway::GatewayApi::Anthropic,
        };
        route_to_gateway(&mut req, &gw);
        assert_eq!(
            url_for(&req),
            "https://ai.example.org/v1/messages",
            "the UI's endpoint is ignored"
        );
        assert!(is_anthropic(&req.provider));
        assert_eq!(req.model, "support-chat");
        let gw = tutor_llm::gateway::GatewaySpec {
            url: "https://ai.example.org".into(),
            api: tutor_llm::gateway::GatewayApi::Openai,
        };
        route_to_gateway(&mut req, &gw);
        assert_eq!(url_for(&req), "https://ai.example.org/v1/chat/completions");
        assert!(!is_anthropic(&req.provider));
        assert_eq!(env_key("gateway"), Some("DXTUTOR_GATEWAY_KEY"));
    }
}
