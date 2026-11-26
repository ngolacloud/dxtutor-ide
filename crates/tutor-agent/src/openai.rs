//! Provedor OpenAI-compatível (F8): Chat Completions com tool calls em streaming.
//!
//! Serve o Codex/OpenAI, o Gemini (endpoint OpenAI-compatível da Google) e o Ollama
//! (`/v1/chat/completions`). O histórico canónico do agente está no formato da Anthropic
//! (blocos); aqui converte-se à ida (texto, `tool_calls`, mensagens `tool`) e a resposta
//! volta como blocos `text`/`tool_use` — o loop, as ferramentas, as permissões e as sessões
//! são os mesmos para todos os provedores. O que é só da Anthropic (thinking, cache,
//! compactação, fallbacks, effort) não é enviado.
//!
//! O Ollama vai pela API nativa (`/api/chat`, [`ollama_body`]): o endpoint OpenAI-compatível
//! ignora `options`, e sem `num_ctx` o Ollama usa o contexto pequeno por omissão e corta o
//! início do prompt em silêncio (o system prompt e as ferramentas!) — respostas sem sentido.

use std::collections::BTreeMap;
use std::io::BufRead;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::anthropic::sse::SseLines;
use crate::provider::{
    BlockKind, Provider, ProviderError, Request, Response, StopReason, StreamEvent, Usage,
};
use crate::retry;
use crate::types::{Message, Role};

/// Um provedor OpenAI-compatível.
#[derive(Clone, Debug)]
pub struct Config {
    /// URL completo do endpoint de chat (`…/chat/completions`).
    pub endpoint: String,
    /// `None` para servidores locais sem chave (Ollama).
    pub api_key: Option<String>,
    /// OpenAI usa `max_completion_tokens`; Gemini/Ollama `max_tokens`.
    pub max_tokens_field: &'static str,
    /// Mensagens `system` a meio da conversa vão como `user` marcadas (provedores que só
    /// aceitam `system` no início).
    pub mid_system_as_user: bool,
    /// Remove do schema das ferramentas o que o provedor recusa (`additionalProperties`).
    pub strip_schema: bool,
    /// Tecto de `max_tokens` (os modelos destes provedores têm limites menores).
    pub max_tokens_cap: u32,
    pub read_timeout: Duration,
    pub max_retries: u32,
    /// Ollama: a API nativa (`/api/chat`, NDJSON) em vez da OpenAI-compatível, para poder
    /// mandar `options.num_ctx` ([`ollama_num_ctx`]).
    pub native_ollama: bool,
}

impl Config {
    pub fn openai(api_key: String) -> Self {
        Config {
            endpoint: "https://api.openai.com/v1/chat/completions".into(),
            api_key: Some(api_key),
            max_tokens_field: "max_completion_tokens",
            mid_system_as_user: false,
            strip_schema: false,
            max_tokens_cap: 32_000,
            read_timeout: Duration::from_secs(120),
            max_retries: 4,
            native_ollama: false,
        }
    }
    pub fn gemini(api_key: String) -> Self {
        Config {
            endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
                .into(),
            api_key: Some(api_key),
            max_tokens_field: "max_tokens",
            mid_system_as_user: true,
            strip_schema: true,
            max_tokens_cap: 32_000,
            read_timeout: Duration::from_secs(120),
            max_retries: 4,
            native_ollama: false,
        }
    }
    pub fn ollama(host: &str) -> Self {
        let host = if host.trim().is_empty() {
            "http://localhost:11434"
        } else {
            host.trim().trim_end_matches('/')
        };
        Config {
            endpoint: format!("{host}/api/chat"),
            api_key: None,
            max_tokens_field: "max_tokens",
            mid_system_as_user: true,
            strip_schema: false,
            max_tokens_cap: 16_000,
            read_timeout: Duration::from_secs(300), // modelos locais podem demorar a carregar
            max_retries: 1,
            native_ollama: true,
        }
    }
}

fn strip(schema: &Value) -> Value {
    match schema {
        Value::Object(m) => Value::Object(
            m.iter()
                .filter(|(k, _)| k.as_str() != "additionalProperties")
                .map(|(k, v)| (k.clone(), strip(v)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(strip).collect()),
        v => v.clone(),
    }
}

fn text_of(m: &Message) -> String {
    m.content
        .iter()
        .filter(|b| b["type"] == "text")
        .filter_map(|b| b["text"].as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

/// O histórico canónico (blocos Anthropic) em mensagens Chat Completions.
pub fn wire_messages(req: &Request, cfg: &Config) -> Vec<Value> {
    let mut out = vec![];
    let system: Vec<&str> = req.system.iter().map(|s| s.text.as_str()).collect();
    if !system.is_empty() {
        out.push(json!({ "role": "system", "content": system.join("\n\n") }));
    }
    for m in &req.messages {
        match m.role {
            Role::System => {
                if cfg.mid_system_as_user {
                    out.push(json!({ "role": "user", "content": format!("<system-note>{}</system-note>", text_of(m)) }));
                } else {
                    out.push(json!({ "role": "system", "content": text_of(m) }));
                }
            }
            Role::User => {
                // resultados de ferramentas → uma mensagem `tool` por resultado
                for b in m.content.iter().filter(|b| b["type"] == "tool_result") {
                    let content = match &b["content"] {
                        Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    let content = if b["is_error"] == true {
                        format!("ERRO: {content}")
                    } else {
                        content
                    };
                    out.push(json!({ "role": "tool", "tool_call_id": b["tool_use_id"], "content": content }));
                }
                let t = text_of(m);
                if !t.is_empty() {
                    out.push(json!({ "role": "user", "content": t }));
                }
            }
            Role::Assistant => {
                let t = text_of(m);
                let calls: Vec<Value> = m
                    .tool_uses()
                    .into_iter()
                    .map(|u| json!({ "id": u.id, "type": "function", "function": { "name": u.name, "arguments": u.input.to_string() } }))
                    .collect();
                let mut msg = json!({ "role": "assistant", "content": if t.is_empty() { Value::Null } else { Value::String(t) } });
                if !calls.is_empty() {
                    msg["tool_calls"] = Value::Array(calls);
                }
                // um turno só com thinking (sem texto nem ferramentas) não se envia
                if !msg["content"].is_null() || msg.get("tool_calls").is_some() {
                    out.push(msg);
                }
            }
        }
    }
    out
}

/// O corpo do pedido.
pub fn body(req: &Request, cfg: &Config) -> Result<Value, ProviderError> {
    if req.messages.is_empty() {
        return Err(ProviderError::InvalidRequest("conversa vazia".into()));
    }
    let mut b = json!({
        "model": req.model,
        "messages": wire_messages(req, cfg),
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    b[cfg.max_tokens_field] = json!(req.max_tokens.min(cfg.max_tokens_cap));
    if !req.tools.is_empty() {
        b["tools"] = Value::Array(
            req.tools
                .iter()
                .map(|t| {
                    let params = if cfg.strip_schema { strip(&t.input_schema) } else { t.input_schema.clone() };
                    json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": params } })
                })
                .collect(),
        );
    }
    Ok(b)
}

/// O contexto mínimo pedido ao Ollama (o por omissão dele é pequeno de mais para o system
/// prompt, as ferramentas e um ficheiro).
pub const OLLAMA_MIN_CTX: u32 = 16_384;
/// O tecto do contexto pedido ao Ollama (a memória do KV cache cresce com ele).
pub const OLLAMA_MAX_CTX: u32 = 131_072;
/// Espaço reservado para a resposta no cálculo do contexto.
const OLLAMA_OUTPUT_RESERVE: u32 = 8_192;

/// O `num_ctx` a pedir ao Ollama para um prompt de `prompt_bytes` bytes: uma estimativa
/// prudente dos tokens (3 bytes por token) mais a reserva da resposta, arredondada à potência
/// de 2 seguinte entre [`OLLAMA_MIN_CTX`] e [`OLLAMA_MAX_CTX`]. Por degraus e não exacto: mudar
/// o `num_ctx` obriga o Ollama a recarregar o modelo, por isso uma sessão muda-o poucas vezes
/// (16k → 32k → 64k → 128k) e nunca para baixo enquanto a conversa cresce.
pub fn ollama_num_ctx(prompt_bytes: usize) -> u32 {
    let needed = (prompt_bytes / 3) as u64 + OLLAMA_OUTPUT_RESERVE as u64;
    let mut ctx = OLLAMA_MIN_CTX as u64;
    while ctx < needed && ctx < OLLAMA_MAX_CTX as u64 {
        ctx *= 2;
    }
    ctx as u32
}

/// O corpo do pedido à API nativa do Ollama (`/api/chat`). As mensagens são as mesmas do
/// formato OpenAI com o que a API nativa pede diferente: os argumentos das tool calls como
/// objecto (não texto) e o nome da ferramenta nas mensagens `tool`.
pub fn ollama_body(req: &Request, cfg: &Config) -> Result<Value, ProviderError> {
    if req.messages.is_empty() {
        return Err(ProviderError::InvalidRequest("conversa vazia".into()));
    }
    let names: std::collections::HashMap<String, String> = req
        .messages
        .iter()
        .flat_map(|m| m.tool_uses())
        .map(|u| (u.id, u.name))
        .collect();
    let mut messages = wire_messages(req, cfg);
    for m in messages.iter_mut() {
        if m["content"].is_null() {
            m["content"] = json!("");
        }
        if let Some(calls) = m.get_mut("tool_calls").and_then(Value::as_array_mut) {
            for c in calls {
                let args = c["function"]["arguments"].as_str().unwrap_or("{}");
                c["function"]["arguments"] =
                    serde_json::from_str::<Value>(args).unwrap_or_else(|_| json!({}));
            }
        }
        if m["role"] == "tool" {
            if let Some(n) = m["tool_call_id"].as_str().and_then(|id| names.get(id)) {
                m["tool_name"] = json!(n);
            }
        }
    }
    let tools: Vec<Value> = req
        .tools
        .iter()
        .map(|t| json!({ "type": "function", "function": { "name": t.name, "description": t.description, "parameters": t.input_schema } }))
        .collect();
    let prompt_bytes = serde_json::to_string(&messages).map_or(0, |s| s.len())
        + serde_json::to_string(&tools).map_or(0, |s| s.len());
    let mut b = json!({
        "model": req.model,
        "messages": messages,
        "stream": true,
        "options": {
            "num_ctx": ollama_num_ctx(prompt_bytes),
            "num_predict": req.max_tokens.min(cfg.max_tokens_cap),
        },
    });
    if !tools.is_empty() {
        b["tools"] = Value::Array(tools);
    }
    Ok(b)
}

/// Traduz cada linha NDJSON da API nativa do Ollama para o chunk equivalente do formato OpenAI,
/// para o mesmo [`Accumulator`] reconstruir a resposta (texto, tool calls, uso, fim).
#[derive(Default)]
struct OllamaLines {
    calls: u64,
}

impl OllamaLines {
    fn translate(&mut self, line: &str) -> Result<Option<String>, ProviderError> {
        let line = line.trim();
        if line.is_empty() {
            return Ok(None);
        }
        let v: Value = serde_json::from_str(line)
            .map_err(|e| ProviderError::Protocol(format!("linha do Ollama não é JSON ({e})")))?;
        if let Some(e) = v.get("error").filter(|e| !e.is_null()) {
            return Err(ProviderError::Stream {
                kind: "error".into(),
                message: e
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| e.to_string()),
            });
        }
        let msg = &v["message"];
        let mut delta = json!({});
        if let Some(t) = msg["content"].as_str().filter(|t| !t.is_empty()) {
            delta["content"] = json!(t);
        }
        let calls: Vec<Value> = msg["tool_calls"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| {
                let i = self.calls;
                self.calls += 1;
                let args = match &c["function"]["arguments"] {
                    Value::String(s) => s.clone(),
                    Value::Null => "{}".into(),
                    other => other.to_string(),
                };
                json!({ "index": i, "id": c["id"].as_str().unwrap_or(""), "type": "function",
                        "function": { "name": c["function"]["name"], "arguments": args } })
            })
            .collect();
        if !calls.is_empty() {
            delta["tool_calls"] = Value::Array(calls);
        }
        let done = v["done"].as_bool().unwrap_or(false);
        let mut chunk = json!({
            "id": "ollama",
            "model": v["model"].as_str().unwrap_or(""),
            "choices": [{ "index": 0, "delta": delta, "finish_reason": if done {
                json!(if v["done_reason"] == "length" { "length" } else { "stop" })
            } else { Value::Null } }],
        });
        if done {
            chunk["usage"] = json!({
                "prompt_tokens": v["prompt_eval_count"].as_u64().unwrap_or(0),
                "completion_tokens": v["eval_count"].as_u64().unwrap_or(0),
            });
        }
        Ok(Some(chunk.to_string()))
    }
}

/// Corre um stream NDJSON completo da API nativa do Ollama (transporte e testes).
pub fn parse_ollama_stream<I: IntoIterator<Item = std::io::Result<String>>>(
    lines: I,
    emit: &mut dyn FnMut(StreamEvent) -> bool,
) -> Result<Response, ProviderError> {
    let mut tr = OllamaLines::default();
    let mut acc = Accumulator::default();
    for line in lines {
        let line = line.map_err(|e| ProviderError::Transport(format!("leitura do stream: {e}")))?;
        if let Some(chunk) = tr.translate(&line)? {
            acc.on_data(&chunk, emit)?;
        }
    }
    acc.finish()
}

/// Reconstrói a resposta a partir dos chunks do stream.
#[derive(Default)]
pub struct Accumulator {
    id: String,
    model: String,
    text: String,
    text_started: bool,
    /// índice → (id, nome, argumentos acumulados)
    tools: BTreeMap<u64, (String, String, String)>,
    finish: Option<String>,
    usage: Usage,
}

impl Accumulator {
    pub fn on_data(
        &mut self,
        data: &str,
        emit: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<(), ProviderError> {
        let data = data.trim();
        if data == "[DONE]" || data.is_empty() {
            return Ok(());
        }
        let v: Value = serde_json::from_str(data)
            .map_err(|e| ProviderError::Protocol(format!("chunk não é JSON ({e})")))?;
        let go = |ok: bool| {
            if ok {
                Ok(())
            } else {
                Err(ProviderError::Cancelled)
            }
        };
        if let Some(e) = v.get("error").filter(|e| !e.is_null()) {
            return Err(ProviderError::Stream {
                kind: e["type"]
                    .as_str()
                    .or(e["code"].as_str())
                    .unwrap_or("error")
                    .to_string(),
                message: e["message"].as_str().unwrap_or("").to_string(),
            });
        }
        if self.id.is_empty() {
            self.id = v["id"].as_str().unwrap_or_default().to_string();
            self.model = v["model"].as_str().unwrap_or_default().to_string();
            go(emit(StreamEvent::MessageStart {
                model: self.model.clone(),
            }))?;
        }
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            let prompt = u["prompt_tokens"].as_u64().unwrap_or(0);
            let cached = u["prompt_tokens_details"]["cached_tokens"]
                .as_u64()
                .unwrap_or(0);
            self.usage = Usage {
                input_tokens: prompt.saturating_sub(cached),
                output_tokens: u["completion_tokens"].as_u64().unwrap_or(0),
                cache_read_input_tokens: cached,
                cache_creation_input_tokens: 0,
                cache_creation_1h_input_tokens: 0,
            };
            go(emit(StreamEvent::Usage(self.usage)))?;
        }
        let Some(ch) = v["choices"].as_array().and_then(|a| a.first()) else {
            return Ok(());
        };
        let d = &ch["delta"];
        if let Some(t) = d["content"].as_str().filter(|t| !t.is_empty()) {
            if !self.text_started {
                self.text_started = true;
                go(emit(StreamEvent::BlockStart {
                    index: 0,
                    kind: BlockKind::Text,
                }))?;
            }
            self.text.push_str(t);
            go(emit(StreamEvent::TextDelta {
                index: 0,
                text: t.to_string(),
            }))?;
        }
        for tc in d["tool_calls"].as_array().into_iter().flatten() {
            let idx = tc["index"].as_u64().unwrap_or(self.tools.len() as u64);
            let fresh = !self.tools.contains_key(&idx);
            let e = self.tools.entry(idx).or_default();
            if let Some(id) = tc["id"].as_str() {
                e.0 = id.to_string();
            }
            if let Some(n) = tc["function"]["name"].as_str() {
                e.1.push_str(n);
            }
            let (id, name) = (e.0.clone(), e.1.clone());
            if let Some(a) = tc["function"]["arguments"].as_str() {
                e.2.push_str(a);
            }
            let block = idx as usize + 1; // o bloco 0 é o texto
            if fresh {
                go(emit(StreamEvent::BlockStart {
                    index: block,
                    kind: BlockKind::ToolUse { id, name },
                }))?;
            }
            if let Some(a) = tc["function"]["arguments"]
                .as_str()
                .filter(|a| !a.is_empty())
            {
                go(emit(StreamEvent::ToolInputDelta {
                    index: block,
                    partial_json: a.to_string(),
                }))?;
            }
        }
        if let Some(f) = ch["finish_reason"].as_str() {
            self.finish = Some(f.to_string());
        }
        Ok(())
    }

    pub fn finish(self) -> Result<Response, ProviderError> {
        let Some(finish) = self.finish else {
            return Err(ProviderError::Protocol(
                "o stream terminou antes do fim da resposta (sem finish_reason)".into(),
            ));
        };
        let mut content = vec![];
        if !self.text.is_empty() {
            content.push(json!({ "type": "text", "text": self.text }));
        }
        let mut invalid = vec![];
        let has_tools = !self.tools.is_empty();
        for (id, name, args) in self.tools.into_values() {
            let id = if id.is_empty() {
                // únicos no processo: dois pedidos do mesmo turno não podem repetir ids
                format!("call_dx{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
            } else {
                id
            };
            let input = if args.trim().is_empty() {
                json!({})
            } else {
                match serde_json::from_str::<Value>(&args) {
                    Ok(v) if v.is_object() => v,
                    _ => {
                        invalid.push((id.clone(), args));
                        json!({})
                    }
                }
            };
            content.push(json!({ "type": "tool_use", "id": id, "name": name, "input": input }));
        }
        let stop = match finish.as_str() {
            // alguns provedores (Gemini) dizem "stop" mesmo quando pedem ferramentas
            _ if has_tools && finish != "length" && finish != "content_filter" => {
                StopReason::ToolUse
            }
            "stop" => StopReason::EndTurn,
            "tool_calls" | "function_call" => StopReason::ToolUse,
            "length" => StopReason::MaxTokens,
            "content_filter" => StopReason::Refusal,
            other => StopReason::Other(other.to_string()),
        };
        Ok(Response {
            id: self.id,
            model: self.model,
            content,
            stop_reason: stop,
            stop_details: None,
            usage: self.usage,
            invalid_tool_inputs: invalid,
        })
    }
}

/// Corre um stream completo pelo parser (transporte e testes).
pub fn parse_stream<I: IntoIterator<Item = std::io::Result<String>>>(
    lines: I,
    emit: &mut dyn FnMut(StreamEvent) -> bool,
) -> Result<Response, ProviderError> {
    let mut sse = SseLines::default();
    let mut acc = Accumulator::default();
    for line in lines {
        let line = line.map_err(|e| ProviderError::Transport(format!("leitura do stream: {e}")))?;
        if let Some(data) = sse.push_line(&line) {
            acc.on_data(&data, emit)?;
        }
    }
    if let Some(data) = sse.finish() {
        acc.on_data(&data, emit)?;
    }
    acc.finish()
}

/// Ids para tool calls que chegam sem id (o Gemini compat manda-os vazios).
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

type Sleeper = Arc<dyn Fn(Duration) + Send + Sync>;

pub struct OpenAiCompat {
    cfg: Config,
    agent: ureq::Agent,
    sleep: Sleeper,
}

impl OpenAiCompat {
    pub fn new(cfg: Config) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(cfg.read_timeout)
            .build();
        OpenAiCompat {
            cfg,
            agent,
            sleep: Arc::new(std::thread::sleep),
        }
    }

    pub fn with_sleeper(mut self, f: impl Fn(Duration) + Send + Sync + 'static) -> Self {
        self.sleep = Arc::new(f);
        self
    }

    fn send(&self, body: &str) -> Result<ureq::Response, ProviderError> {
        // r23 F4a (X02): no secret leaves for the model (once, before the retries)
        let body = &tutor_protect::redact::guard_body("codev", body);
        let mut attempt = 0;
        loop {
            let mut r = self
                .agent
                .post(&self.cfg.endpoint)
                .set("content-type", "application/json")
                .set("accept", "text/event-stream");
            if let Some(k) = self.cfg.api_key.as_deref().filter(|k| !k.trim().is_empty()) {
                r = r.set("authorization", &format!("Bearer {}", k.trim()));
            }
            let (err, after) = match r.send_string(body) {
                Ok(resp) => return Ok(resp),
                Err(ureq::Error::Status(status, resp)) => {
                    let should = retry::should_retry(status, resp.header("x-should-retry"));
                    let after = retry::parse_retry_after(resp.header("retry-after"));
                    let text = resp.into_string().unwrap_or_default();
                    // OpenAI/Ollama: {"error":{"message","type"}}; Gemini compat: [{"error":{…}}]
                    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                    let e = if v.is_array() {
                        v[0]["error"].clone()
                    } else {
                        v["error"].clone()
                    };
                    let message = e["message"]
                        .as_str()
                        .map(String::from)
                        .or_else(|| e.as_str().map(String::from))
                        .unwrap_or_else(|| text.chars().take(300).collect());
                    let kind = e["type"]
                        .as_str()
                        .or(e["status"].as_str())
                        .unwrap_or("error")
                        .to_string();
                    let err = ProviderError::Http {
                        status,
                        kind,
                        message,
                    };
                    if !should {
                        return Err(err);
                    }
                    (err, after)
                }
                Err(ureq::Error::Transport(t)) => (ProviderError::Transport(t.to_string()), None),
            };
            if attempt >= self.cfg.max_retries {
                return Err(err);
            }
            (self.sleep)(retry::backoff(attempt, after));
            attempt += 1;
        }
    }
}

impl Provider for OpenAiCompat {
    fn stream(
        &self,
        req: &Request,
        on_event: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<Response, ProviderError> {
        if self.cfg.native_ollama {
            let b = ollama_body(req, &self.cfg)?;
            let resp = self.send(&b.to_string())?;
            let reader = std::io::BufReader::new(resp.into_reader());
            return parse_ollama_stream(reader.lines(), on_event);
        }
        let b = body(req, &self.cfg)?;
        let resp = self.send(&b.to_string())?;
        let reader = std::io::BufReader::new(resp.into_reader());
        parse_stream(reader.lines(), on_event)
    }
}

/// O modelo não suporta ferramentas? (Ollama responde 400 com esta mensagem para modelos
/// sem tool calling — a UI recua para o modo de texto.)
pub fn is_tools_unsupported(e: &ProviderError) -> bool {
    match e {
        ProviderError::Http { message, .. } | ProviderError::Stream { message, .. } => {
            let m = message.to_ascii_lowercase();
            m.contains("does not support tools")
                || m.contains("tools are not supported")
                || m.contains("tool use is not supported")
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::{SystemBlock, ToolDef};
    use crate::types::ToolResult;

    fn req() -> Request {
        let mut r = Request::new("gpt-4.1", vec![Message::user_text("lê a.rs")]);
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
        r.tools = vec![ToolDef {
            name: "read".into(),
            description: "lê".into(),
            input_schema: json!({"type":"object","properties":{"path":{"type":"string"}},"additionalProperties":false}),
            eager: true,
        }];
        r.messages.push(Message::assistant(vec![
            json!({"type":"thinking","thinking":"x","signature":"s"}),
            json!({"type":"text","text":"Vou ler."}),
            json!({"type":"tool_use","id":"t1","name":"read","input":{"path":"a.rs"}}),
        ]));
        r.messages.push(Message::tool_results(&[ToolResult {
            tool_use_id: "t1".into(),
            content: "fn main() {}".into(),
            is_error: false,
        }]));
        r.messages.push(Message::system("Modo: Auto."));
        r
    }

    #[test]
    fn transcript_maps_to_chat_completions() {
        let cfg = Config::openai("k".into());
        let b = body(&req(), &cfg).unwrap();
        let m = b["messages"].as_array().unwrap();
        assert_eq!(
            m[0],
            json!({"role":"system","content":"núcleo\n\nprojecto"})
        );
        assert_eq!(m[1], json!({"role":"user","content":"lê a.rs"}));
        assert_eq!(m[2]["role"], "assistant");
        assert_eq!(
            m[2]["content"], "Vou ler.",
            "o thinking não vai para estes provedores"
        );
        assert_eq!(
            m[2]["tool_calls"][0],
            json!({"id":"t1","type":"function","function":{"name":"read","arguments":"{\"path\":\"a.rs\"}"}})
        );
        assert_eq!(
            m[3],
            json!({"role":"tool","tool_call_id":"t1","content":"fn main() {}"})
        );
        assert_eq!(m[4], json!({"role":"system","content":"Modo: Auto."}));
        assert_eq!(b["max_completion_tokens"], 32000);
        assert_eq!(
            b["tools"][0]["function"]["parameters"]["additionalProperties"],
            false
        );
        for k in [
            "thinking",
            "cache_control",
            "output_config",
            "fallbacks",
            "context_management",
        ] {
            assert!(b.get(k).is_none(), "{k} é só da Anthropic");
        }
    }

    #[test]
    fn gemini_and_ollama_variants() {
        let g = body(&req(), &Config::gemini("k".into())).unwrap();
        assert!(g["tools"][0]["function"]["parameters"]
            .get("additionalProperties")
            .is_none());
        assert_eq!(
            g["messages"][4],
            json!({"role":"user","content":"<system-note>Modo: Auto.</system-note>"})
        );
        assert_eq!(g["max_tokens"], 32000);
        let o = Config::ollama("http://box:11434/");
        assert_eq!(o.endpoint, "http://box:11434/api/chat");
        assert!(o.api_key.is_none() && o.native_ollama);
        assert_eq!(
            Config::ollama("").endpoint,
            "http://localhost:11434/api/chat"
        );
    }

    #[test]
    fn ollama_goes_native_with_num_ctx_object_arguments_and_tool_names() {
        let o = Config::ollama("http://box:11434/");
        let b = ollama_body(&req(), &o).unwrap();
        // o contexto vai sempre: o do Ollama por omissão corta o prompt em silêncio
        assert_eq!(b["options"]["num_ctx"], OLLAMA_MIN_CTX);
        assert_eq!(b["options"]["num_predict"], 16000);
        assert_eq!(b["stream"], true);
        let m = b["messages"].as_array().unwrap();
        assert_eq!(
            m[0],
            json!({"role":"system","content":"núcleo\n\nprojecto"})
        );
        assert_eq!(
            m[2]["tool_calls"][0]["function"]["arguments"],
            json!({"path":"a.rs"}),
            "na API nativa os argumentos são um objecto"
        );
        assert_eq!(m[3]["role"], "tool");
        assert_eq!(m[3]["tool_name"], "read");
        assert_eq!(m[3]["content"], "fn main() {}");
        assert_eq!(
            m[4],
            json!({"role":"user","content":"<system-note>Modo: Auto.</system-note>"})
        );
        assert_eq!(b["tools"][0]["function"]["name"], "read");
        for k in ["max_tokens", "stream_options"] {
            assert!(b.get(k).is_none(), "{k} é do endpoint OpenAI");
        }
        // um prompt grande pede mais contexto, por degraus
        let mut big = req();
        big.messages[0] = Message::user_text("x".repeat(90_000));
        assert_eq!(ollama_body(&big, &o).unwrap()["options"]["num_ctx"], 65_536);
    }

    #[test]
    fn ollama_num_ctx_grows_in_powers_of_two_and_has_a_ceiling() {
        assert_eq!(ollama_num_ctx(0), 16_384);
        assert_eq!(ollama_num_ctx(24_000), 16_384); // ~8k tokens + 8k de resposta
        assert_eq!(ollama_num_ctx(25_000), 32_768);
        assert_eq!(ollama_num_ctx(100_000), 65_536);
        assert_eq!(ollama_num_ctx(10_000_000), OLLAMA_MAX_CTX);
    }

    #[test]
    fn ollama_ndjson_stream_becomes_blocks_and_usage() {
        let lines = [
            r#"{"model":"qwen3","message":{"role":"assistant","content":"Vou "},"done":false}"#,
            r#"{"model":"qwen3","message":{"role":"assistant","content":"ler."},"done":false}"#,
            r#"{"model":"qwen3","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"read","arguments":{"path":"a.rs"}}}]},"done":false}"#,
            r#"{"model":"qwen3","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":5000,"eval_count":42}"#,
        ];
        let r =
            parse_ollama_stream(lines.iter().map(|l| Ok(l.to_string())), &mut |_| true).unwrap();
        assert_eq!(r.stop_reason, StopReason::ToolUse);
        assert_eq!(r.content[0], json!({"type":"text","text":"Vou ler."}));
        assert_eq!(r.content[1]["name"], "read");
        assert_eq!(r.content[1]["input"], json!({"path":"a.rs"}));
        assert!(r.content[1]["id"].as_str().unwrap().starts_with("call_dx"));
        assert_eq!((r.usage.input_tokens, r.usage.output_tokens), (5000, 42));
        // texto só, cortado por num_predict
        let lines = [
            r#"{"model":"qwen3","message":{"role":"assistant","content":"abc"},"done":false}"#,
            r#"{"model":"qwen3","message":{"role":"assistant","content":""},"done":true,"done_reason":"length","prompt_eval_count":1,"eval_count":1}"#,
        ];
        let r =
            parse_ollama_stream(lines.iter().map(|l| Ok(l.to_string())), &mut |_| true).unwrap();
        assert_eq!(r.stop_reason, StopReason::MaxTokens);
        // um erro a meio do stream
        let e = parse_ollama_stream(
            [Ok(
                r#"{"error":"model runner has unexpectedly stopped"}"#.to_string()
            )],
            &mut |_| true,
        )
        .unwrap_err();
        assert!(
            matches!(e, ProviderError::Stream { ref message, .. } if message.contains("unexpectedly")),
            "{e:?}"
        );
    }

    fn feed(chunks: &[&str]) -> (Result<Response, ProviderError>, Vec<StreamEvent>) {
        let mut evs = vec![];
        let text: String = chunks.iter().map(|c| format!("data: {c}\n\n")).collect();
        let r = parse_stream(text.lines().map(|l| Ok(l.to_string())), &mut |e| {
            evs.push(e);
            true
        });
        (r, evs)
    }

    #[test]
    fn streamed_text_and_tool_calls_become_blocks() {
        let (r, evs) = feed(&[
            r#"{"id":"c1","model":"gpt-4.1","choices":[{"index":0,"delta":{"role":"assistant","content":"Vou "}}]}"#,
            r#"{"id":"c1","model":"gpt-4.1","choices":[{"index":0,"delta":{"content":"ler."}}]}"#,
            r#"{"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"read","arguments":""}}]}}]}"#,
            r#"{"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]}}]}"#,
            r#"{"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.rs\"}"}},{"index":1,"id":"call_b","function":{"name":"git_status","arguments":"{}"}}]}}]}"#,
            r#"{"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}"#,
            r#"{"id":"c1","choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":1000}}}"#,
            "[DONE]",
        ]);
        let r = r.unwrap();
        assert_eq!(r.stop_reason, StopReason::ToolUse);
        assert_eq!(r.content[0], json!({"type":"text","text":"Vou ler."}));
        assert_eq!(
            r.content[1],
            json!({"type":"tool_use","id":"call_a","name":"read","input":{"path":"a.rs"}})
        );
        assert_eq!(r.content[2]["name"], "git_status");
        assert_eq!(
            r.usage,
            Usage {
                input_tokens: 200,
                output_tokens: 40,
                cache_read_input_tokens: 1000,
                cache_creation_input_tokens: 0,
                cache_creation_1h_input_tokens: 0
            }
        );
        assert!(evs.contains(&StreamEvent::BlockStart {
            index: 1,
            kind: BlockKind::ToolUse {
                id: "call_a".into(),
                name: "read".into()
            }
        }));
        assert!(evs
            .iter()
            .any(|e| matches!(e, StreamEvent::ToolInputDelta { index: 1, .. })));
    }

    #[test]
    fn finish_reasons_quirks_and_errors() {
        // Gemini: "stop" com tool calls conta como ToolUse; id em falta é gerado
        let (r, _) = feed(&[
            r#"{"id":"g","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"read","arguments":"{\"path\":\"x\"}"}}]},"finish_reason":"stop"}]}"#,
        ]);
        let r = r.unwrap();
        assert_eq!(r.stop_reason, StopReason::ToolUse);
        assert!(r.content[0]["id"].as_str().unwrap().starts_with("call_dx"));
        let (r, _) = feed(&[
            r#"{"id":"x","choices":[{"delta":{"content":"meio"},"finish_reason":"length"}]}"#,
        ]);
        assert_eq!(r.unwrap().stop_reason, StopReason::MaxTokens);
        let (r, _) = feed(&[
            r#"{"id":"x","choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"edit","arguments":"{\"path\":"}}]},"finish_reason":"tool_calls"}]}"#,
        ]);
        assert_eq!(
            r.unwrap().invalid_tool_inputs,
            vec![("c".to_string(), "{\"path\":".to_string())]
        );
        let (r, _) = feed(&[r#"{"id":"x","choices":[{"delta":{"content":"a meio"}}]}"#]);
        assert!(
            matches!(r, Err(ProviderError::Protocol(_))),
            "sem finish_reason = cortado"
        );
        let (r, _) = feed(&[r#"{"error":{"message":"rate limited","type":"rate_limit_error"}}"#]);
        assert!(matches!(r, Err(ProviderError::Stream { kind, .. }) if kind == "rate_limit_error"));
        assert!(is_tools_unsupported(&ProviderError::Http {
            status: 400,
            kind: "x".into(),
            message: "registry.ollama.ai/library/gemma:2b does not support tools".into()
        }));
    }
}
