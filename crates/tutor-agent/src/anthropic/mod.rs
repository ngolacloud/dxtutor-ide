//! Provedor Anthropic (Messages API por HTTP directo — Rust não tem SDK oficial).
//!
//! - [`body`] e [`headers`]: puros, testados sem rede;
//! - [`Anthropic::stream`]: POST em streaming, com retry **antes do primeiro byte**
//!   (429/529/5xx/ligação; respeita `retry-after` e `x-should-retry`), e o parser SSE
//!   de [`sse`].

pub mod sse;

use std::io::BufRead;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::provider::{Provider, ProviderError, Request, Response, StreamEvent, ThinkingDisplay};
use crate::retry;
use crate::types::Role;

pub const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
/// Versão da API. A `2026-10-21` rejeita `temperature`/`top_p`/`top_k` — não os enviamos.
pub const API_VERSION: &str = "2026-10-21";
/// Beta dos fallbacks do servidor em caso de recusa (`fallbacks: "default"`).
pub const BETA_FALLBACKS: &str = "server-side-fallback-2026-07-01";
/// Modelo por omissão do Co-Dev.
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";

/// O corpo JSON do pedido. Recusa, antes de sair, pedidos que a API rejeitaria.
pub fn body(req: &Request) -> Result<Value, ProviderError> {
    let first = req
        .messages
        .first()
        .ok_or_else(|| ProviderError::InvalidRequest("conversa vazia".into()))?;
    if first.role != Role::User {
        return Err(ProviderError::InvalidRequest(
            "a primeira mensagem tem de ser do utilizador".into(),
        ));
    }
    if req.messages.last().map(|m| m.role) == Some(Role::Assistant) {
        return Err(ProviderError::InvalidRequest(
            "a última mensagem é do assistente (prefill): os modelos actuais respondem 400".into(),
        ));
    }
    if req.model.trim().is_empty() {
        return Err(ProviderError::InvalidRequest("modelo em falta".into()));
    }

    let mut b = json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "stream": true,
        "messages": req.messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
        "thinking": {
            "type": "adaptive",
            "display": match req.thinking { ThinkingDisplay::Summarized => "summarized", ThinkingDisplay::Omitted => "omitted" },
        },
        "output_config": { "effort": req.effort.as_str() },
        // cache automática no fim da conversa (os breakpoints do system prompt vão nos blocos)
        "cache_control": { "type": "ephemeral" },
    });

    if !req.system.is_empty() {
        b["system"] = Value::Array(
            req.system
                .iter()
                .map(|s| {
                    let mut blk = json!({ "type": "text", "text": s.text });
                    if s.cache {
                        blk["cache_control"] = json!({ "type": "ephemeral" });
                    }
                    blk
                })
                .collect(),
        );
    }
    if !req.tools.is_empty() {
        b["tools"] = Value::Array(
            req.tools
                .iter()
                .map(|t| {
                    let mut d = json!({ "name": t.name, "description": t.description, "input_schema": t.input_schema });
                    if t.eager {
                        d["eager_input_streaming"] = Value::Bool(true);
                    }
                    d
                })
                .collect(),
        );
    }
    if req.fallbacks {
        b["fallbacks"] = json!("default");
    }
    Ok(b)
}

/// Configuração do transporte.
#[derive(Clone)]
pub struct Config {
    pub api_key: String,
    /// Necessário para chaves de organização com vários workspaces.
    pub workspace_id: Option<String>,
    pub endpoint: String,
    /// Tempo máximo sem receber bytes (o servidor manda `ping` regularmente).
    pub read_timeout: Duration,
    pub max_retries: u32,
}

impl Config {
    pub fn new(api_key: impl Into<String>) -> Self {
        Config {
            api_key: api_key.into(),
            workspace_id: None,
            endpoint: ENDPOINT.to_string(),
            read_timeout: Duration::from_secs(60),
            max_retries: 4,
        }
    }
}

/// Os cabeçalhos do pedido.
pub fn headers(cfg: &Config, req: &Request) -> Vec<(&'static str, String)> {
    let mut h = vec![
        ("x-api-key", cfg.api_key.clone()),
        ("anthropic-version", API_VERSION.to_string()),
        ("content-type", "application/json".to_string()),
        ("accept", "text/event-stream".to_string()),
    ];
    if req.fallbacks {
        h.push(("anthropic-beta", BETA_FALLBACKS.to_string()));
    }
    if let Some(ws) = cfg.workspace_id.as_deref().filter(|w| !w.trim().is_empty()) {
        h.push(("anthropic-workspace-id", ws.trim().to_string()));
    }
    h
}

type Sleeper = Arc<dyn Fn(Duration) + Send + Sync>;

/// O provedor Anthropic.
pub struct Anthropic {
    cfg: Config,
    agent: ureq::Agent,
    sleep: Sleeper,
}

impl Anthropic {
    pub fn new(cfg: Config) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(cfg.read_timeout)
            .build();
        Anthropic {
            cfg,
            agent,
            sleep: Arc::new(std::thread::sleep),
        }
    }

    /// Substitui a espera entre tentativas (testes).
    pub fn with_sleeper(mut self, f: impl Fn(Duration) + Send + Sync + 'static) -> Self {
        self.sleep = Arc::new(f);
        self
    }

    /// Envia o POST, repetindo falhas antes do primeiro byte. Devolve a resposta HTTP 200.
    fn send(&self, req: &Request, body: &str) -> Result<ureq::Response, ProviderError> {
        let mut attempt = 0u32;
        loop {
            let mut r = self.agent.post(&self.cfg.endpoint);
            for (k, v) in headers(&self.cfg, req) {
                r = r.set(k, &v);
            }
            let (err, retry_after) = match r.send_string(body) {
                Ok(resp) => return Ok(resp),
                Err(ureq::Error::Status(status, resp)) => {
                    let should = retry::should_retry(status, resp.header("x-should-retry"));
                    let after = retry::parse_retry_after(resp.header("retry-after"));
                    let text = resp.into_string().unwrap_or_default();
                    let (kind, message) = api_error(&text);
                    let e = ProviderError::Http {
                        status,
                        kind,
                        message,
                    };
                    if !should {
                        return Err(e);
                    }
                    (e, after)
                }
                Err(ureq::Error::Transport(t)) => (ProviderError::Transport(t.to_string()), None),
            };
            if attempt >= self.cfg.max_retries {
                return Err(err);
            }
            (self.sleep)(retry::backoff(attempt, retry_after));
            attempt += 1;
        }
    }
}

/// `(tipo, mensagem)` do corpo de erro da API (`{"type":"error","error":{…}}`).
fn api_error(text: &str) -> (String, String) {
    match serde_json::from_str::<Value>(text) {
        Ok(v) if v["error"].is_object() => (
            v["error"]["type"].as_str().unwrap_or("error").to_string(),
            v["error"]["message"].as_str().unwrap_or("").to_string(),
        ),
        _ => ("error".to_string(), text.chars().take(300).collect()),
    }
}

impl Provider for Anthropic {
    fn stream(
        &self,
        req: &Request,
        on_event: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<Response, ProviderError> {
        let b = body(req)?;
        let resp = self.send(req, &b.to_string())?;
        let reader = std::io::BufReader::new(resp.into_reader());
        sse::parse_stream(reader.lines(), on_event)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{Effort, SystemBlock, ToolDef};
    use crate::types::Message;

    fn req() -> Request {
        let mut r = Request::new(DEFAULT_MODEL, vec![Message::user_text("olá")]);
        r.system = vec![
            SystemBlock {
                text: "núcleo".into(),
                cache: false,
            },
            SystemBlock {
                text: "projecto".into(),
                cache: true,
            },
        ];
        r.tools = vec![
            ToolDef {
                name: "read".into(),
                description: "lê".into(),
                input_schema: json!({"type":"object"}),
                eager: false,
            },
            ToolDef {
                name: "write".into(),
                description: "escreve".into(),
                input_schema: json!({"type":"object"}),
                eager: true,
            },
        ];
        r
    }

    #[test]
    fn body_has_the_v2_defaults_and_nothing_the_api_rejects() {
        let b = body(&req()).unwrap();
        assert_eq!(b["model"], "claude-opus-5-5");
        assert_eq!(b["max_tokens"], 64000);
        assert_eq!(b["stream"], true);
        assert_eq!(
            b["thinking"],
            json!({"type":"adaptive","display":"summarized"})
        );
        assert_eq!(b["output_config"]["effort"], "high");
        assert_eq!(b["cache_control"]["type"], "ephemeral");
        assert_eq!(b["fallbacks"], "default");
        for k in ["temperature", "top_p", "top_k"] {
            assert!(b.get(k).is_none(), "{k} não pode ir no pedido");
        }
        // breakpoint só no bloco marcado; ordem das ferramentas preservada
        assert!(b["system"][0].get("cache_control").is_none());
        assert_eq!(b["system"][1]["cache_control"]["type"], "ephemeral");
        assert_eq!(b["tools"][0]["name"], "read");
        assert!(b["tools"][0].get("eager_input_streaming").is_none());
        assert_eq!(b["tools"][1]["eager_input_streaming"], true);
    }

    #[test]
    fn body_refuses_prefill_and_bad_conversations() {
        let mut r = req();
        r.messages.push(Message::assistant(vec![
            json!({"type":"text","text":"Claro, aqui"}),
        ]));
        assert!(matches!(body(&r), Err(ProviderError::InvalidRequest(m)) if m.contains("prefill")));
        let mut r = req();
        r.messages.clear();
        assert!(body(&r).is_err());
        let mut r = req();
        r.messages = vec![Message::assistant(vec![])];
        assert!(body(&r).is_err());
    }

    #[test]
    fn effort_display_and_fallbacks_are_configurable() {
        let mut r = req();
        r.effort = Effort::Low;
        r.thinking = ThinkingDisplay::Omitted;
        r.fallbacks = false;
        let b = body(&r).unwrap();
        assert_eq!(b["output_config"]["effort"], "low");
        assert_eq!(b["thinking"]["display"], "omitted");
        assert!(b.get("fallbacks").is_none());
        let h = headers(&Config::new("k"), &r);
        assert!(!h.iter().any(|(k, _)| *k == "anthropic-beta"));
    }

    #[test]
    fn headers_carry_version_beta_and_workspace() {
        let mut c = Config::new("sk-test");
        c.workspace_id = Some(" ws_1 ".into());
        let h = headers(&c, &req());
        let get = |k: &str| h.iter().find(|(n, _)| *n == k).map(|(_, v)| v.clone());
        assert_eq!(get("anthropic-version").as_deref(), Some("2026-10-21"));
        assert_eq!(get("anthropic-beta").as_deref(), Some(BETA_FALLBACKS));
        assert_eq!(get("anthropic-workspace-id").as_deref(), Some("ws_1"));
        assert_eq!(get("x-api-key").as_deref(), Some("sk-test"));
    }

    #[test]
    fn api_error_bodies_are_parsed() {
        assert_eq!(
            api_error(
                r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#
            ),
            ("overloaded_error".into(), "Overloaded".into())
        );
        assert_eq!(api_error("<html>bad gateway</html>").0, "error");
    }
}
