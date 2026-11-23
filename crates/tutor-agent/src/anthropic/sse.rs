//! Parser do stream SSE da Messages API — puro (linhas in → eventos + resposta out).
//!
//! Dois níveis:
//! - [`SseLines`]: junta as linhas `data:` de um evento SSE até à linha em branco;
//! - [`Accumulator`]: aplica cada evento JSON (`message_start`, `content_block_*`,
//!   `message_delta`, `message_stop`, `ping`, `error`) e reconstrói os blocos.
//!
//! Os blocos são reconstruídos como JSON a partir do `content_block` de abertura, com
//! os deltas aplicados no sítio (`text`, `thinking`, `signature`, `citations`, input das
//! ferramentas) — assim um bloco de tipo desconhecido, ou um campo que o servidor
//! acrescente, volta ao servidor intacto.

use std::collections::BTreeMap;

use serde_json::{json, Value};

use crate::provider::{BlockKind, ProviderError, Response, StopReason, StreamEvent, Usage};

/// Agrupa linhas SSE em eventos. Devolve o `data` de um evento completo.
#[derive(Default)]
pub struct SseLines {
    data: String,
    has_data: bool,
}

impl SseLines {
    pub fn push_line(&mut self, line: &str) -> Option<String> {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.is_empty() {
            if self.has_data {
                self.has_data = false;
                return Some(std::mem::take(&mut self.data));
            }
            return None;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            let rest = rest.strip_prefix(' ').unwrap_or(rest);
            if self.has_data {
                self.data.push('\n');
            }
            self.data.push_str(rest);
            self.has_data = true;
        }
        // `event:`, `id:`, `retry:` e comentários (`:`) não são precisos: o tipo vem no JSON.
        None
    }

    /// Fim do stream: um evento sem linha em branco final ainda conta.
    pub fn finish(&mut self) -> Option<String> {
        if self.has_data {
            self.has_data = false;
            Some(std::mem::take(&mut self.data))
        } else {
            None
        }
    }
}

enum Builder {
    /// text / thinking / redacted_thinking / tipos desconhecidos: o JSON do bloco.
    Block(Value),
    /// tool_use (e afins com input): o bloco de abertura + o JSON parcial acumulado.
    Tool { base: Value, json: String },
}

/// Reconstrói a resposta a partir dos eventos.
#[derive(Default)]
pub struct Accumulator {
    id: String,
    model: String,
    blocks: BTreeMap<usize, Builder>,
    stop_reason: Option<String>,
    stop_details: Option<Value>,
    usage: Usage,
    stopped: bool,
}

/// Tipos de bloco cujo input chega por `input_json_delta`.
fn has_streamed_input(kind: &str) -> bool {
    matches!(kind, "tool_use" | "server_tool_use" | "mcp_tool_use")
}

fn merge_usage(u: &mut Usage, v: &Value) {
    let get = |k: &str| v.get(k).and_then(Value::as_u64);
    if let Some(x) = get("input_tokens") {
        u.input_tokens = x;
    }
    if let Some(x) = get("output_tokens") {
        u.output_tokens = x;
    }
    if let Some(x) = get("cache_read_input_tokens") {
        u.cache_read_input_tokens = x;
    }
    if let Some(x) = get("cache_creation_input_tokens") {
        u.cache_creation_input_tokens = x;
    }
}

fn append_str(block: &mut Value, field: &str, s: &str) {
    let cur = block
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    block[field] = Value::String(cur + s);
}

impl Accumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Aplica um evento (o `data` de um evento SSE). `emit` devolve `false` para cancelar.
    pub fn on_data(
        &mut self,
        data: &str,
        emit: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<(), ProviderError> {
        if data.trim() == "[DONE]" {
            return Ok(());
        }
        let ev: Value = serde_json::from_str(data).map_err(|e| {
            ProviderError::Protocol(format!("evento SSE não é JSON ({e}): {}", truncate(data)))
        })?;
        let go = |ok: bool| {
            if ok {
                Ok(())
            } else {
                Err(ProviderError::Cancelled)
            }
        };
        match ev["type"].as_str().unwrap_or("") {
            "message_start" => {
                let m = &ev["message"];
                self.id = m["id"].as_str().unwrap_or_default().to_string();
                self.model = m["model"].as_str().unwrap_or_default().to_string();
                merge_usage(&mut self.usage, &m["usage"]);
                go(emit(StreamEvent::MessageStart {
                    model: self.model.clone(),
                }))?;
                go(emit(StreamEvent::Usage(self.usage)))
            }
            "content_block_start" => {
                let index = index_of(&ev)?;
                let cb = ev["content_block"].clone();
                let kind_s = cb["type"].as_str().unwrap_or("").to_string();
                let kind = match kind_s.as_str() {
                    "text" => BlockKind::Text,
                    "thinking" | "redacted_thinking" => BlockKind::Thinking,
                    "tool_use" => BlockKind::ToolUse {
                        id: cb["id"].as_str().unwrap_or_default().to_string(),
                        name: cb["name"].as_str().unwrap_or_default().to_string(),
                    },
                    other => BlockKind::Other(other.to_string()),
                };
                let b = if has_streamed_input(&kind_s) {
                    Builder::Tool {
                        base: cb,
                        json: String::new(),
                    }
                } else {
                    Builder::Block(cb)
                };
                self.blocks.insert(index, b);
                go(emit(StreamEvent::BlockStart { index, kind }))
            }
            "content_block_delta" => {
                let index = index_of(&ev)?;
                let d = &ev["delta"];
                let Some(b) = self.blocks.get_mut(&index) else {
                    return Err(ProviderError::Protocol(format!(
                        "delta para o bloco {index} que não começou"
                    )));
                };
                match (d["type"].as_str().unwrap_or(""), b) {
                    ("text_delta", Builder::Block(v)) => {
                        let t = d["text"].as_str().unwrap_or("");
                        append_str(v, "text", t);
                        go(emit(StreamEvent::TextDelta {
                            index,
                            text: t.to_string(),
                        }))
                    }
                    ("thinking_delta", Builder::Block(v)) => {
                        let t = d["thinking"].as_str().unwrap_or("");
                        append_str(v, "thinking", t);
                        go(emit(StreamEvent::ThinkingDelta {
                            index,
                            text: t.to_string(),
                        }))
                    }
                    ("signature_delta", Builder::Block(v)) => {
                        // a assinatura tem de voltar intacta com o bloco thinking
                        append_str(v, "signature", d["signature"].as_str().unwrap_or(""));
                        Ok(())
                    }
                    ("citations_delta", Builder::Block(v)) => {
                        if !v["citations"].is_array() {
                            v["citations"] = json!([]);
                        }
                        if let Some(arr) = v["citations"].as_array_mut() {
                            arr.push(d["citation"].clone());
                        }
                        Ok(())
                    }
                    ("input_json_delta", Builder::Tool { json, .. }) => {
                        let p = d["partial_json"].as_str().unwrap_or("");
                        json.push_str(p);
                        go(emit(StreamEvent::ToolInputDelta {
                            index,
                            partial_json: p.to_string(),
                        }))
                    }
                    // deltas de tipos futuros: ignorados (o bloco de abertura fica como veio)
                    _ => Ok(()),
                }
            }
            "content_block_stop" => {
                let index = index_of(&ev)?;
                go(emit(StreamEvent::BlockStop { index }))
            }
            "message_delta" => {
                if let Some(r) = ev["delta"]["stop_reason"].as_str() {
                    self.stop_reason = Some(r.to_string());
                }
                let sd = &ev["delta"]["stop_details"];
                if !sd.is_null() {
                    self.stop_details = Some(sd.clone());
                }
                merge_usage(&mut self.usage, &ev["usage"]);
                go(emit(StreamEvent::Usage(self.usage)))
            }
            "message_stop" => {
                self.stopped = true;
                Ok(())
            }
            "ping" => go(emit(StreamEvent::Ping)),
            "error" => Err(ProviderError::Stream {
                kind: ev["error"]["type"].as_str().unwrap_or("error").to_string(),
                message: ev["error"]["message"].as_str().unwrap_or("").to_string(),
            }),
            _ => Ok(()), // tipos de evento futuros
        }
    }

    /// Fecha o stream e devolve a resposta. Sem `stop_reason` o stream foi cortado: a
    /// resposta parcial **não** é apresentada como completa.
    pub fn finish(self) -> Result<Response, ProviderError> {
        let Some(stop) = self.stop_reason else {
            return Err(ProviderError::Protocol(
                "o stream terminou antes do fim da mensagem (sem stop_reason)".into(),
            ));
        };
        let mut invalid = vec![];
        let content = self
            .blocks
            .into_values()
            .map(|b| match b {
                Builder::Block(v) => v,
                Builder::Tool { mut base, json } => {
                    let parsed = if json.trim().is_empty() {
                        Ok(json!({})) // ferramenta sem parâmetros: não há deltas
                    } else {
                        serde_json::from_str::<Value>(&json)
                    };
                    match parsed {
                        Ok(v) if v.is_object() => base["input"] = v,
                        _ => {
                            // não se reinterpreta: o loop devolve INVALID_JSON ao modelo
                            invalid
                                .push((base["id"].as_str().unwrap_or_default().to_string(), json));
                            base["input"] = json!({});
                        }
                    }
                    base
                }
            })
            .collect();
        Ok(Response {
            id: self.id,
            model: self.model,
            content,
            stop_reason: StopReason::parse(&stop),
            stop_details: self.stop_details,
            usage: self.usage,
            invalid_tool_inputs: invalid,
        })
    }
}

fn index_of(ev: &Value) -> Result<usize, ProviderError> {
    ev["index"].as_u64().map(|i| i as usize).ok_or_else(|| {
        ProviderError::Protocol(format!("evento sem index: {}", truncate(&ev.to_string())))
    })
}

fn truncate(s: &str) -> String {
    if s.chars().count() > 200 {
        s.chars().take(200).collect::<String>() + "…"
    } else {
        s.to_string()
    }
}

/// Corre um stream SSE completo (texto) pelo parser — usado pelo transporte e pelos testes.
pub fn parse_stream<I: IntoIterator<Item = std::io::Result<String>>>(
    lines: I,
    emit: &mut dyn FnMut(StreamEvent) -> bool,
) -> Result<Response, ProviderError> {
    let mut sse = SseLines::default();
    let mut acc = Accumulator::new();
    for line in lines {
        let line = line.map_err(|e| {
            if matches!(
                e.kind(),
                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
            ) {
                ProviderError::Transport(
                    "o servidor deixou de enviar dados (timeout de leitura)".into(),
                )
            } else {
                ProviderError::Transport(format!("leitura do stream: {e}"))
            }
        })?;
        if let Some(data) = sse.push_line(&line) {
            acc.on_data(&data, emit)?;
        }
    }
    if let Some(data) = sse.finish() {
        acc.on_data(&data, emit)?;
    }
    acc.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_lines_join_multiline_data_and_ignore_event_lines() {
        let mut s = SseLines::default();
        assert_eq!(s.push_line("event: ping"), None);
        assert_eq!(s.push_line("data: {\"a\":"), None);
        assert_eq!(s.push_line("data: 1}"), None);
        assert_eq!(s.push_line(""), Some("{\"a\":\n1}".to_string()));
        assert_eq!(s.push_line(""), None);
        assert_eq!(s.push_line(": comentário"), None);
        assert_eq!(s.push_line("data:sem-espaço\r"), None);
        assert_eq!(s.finish(), Some("sem-espaço".to_string()));
    }
}
