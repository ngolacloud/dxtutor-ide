//! O contrato de um provedor de modelos: um pedido, um stream de eventos, uma resposta.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::types::Message;

/// Profundidade de raciocínio (`output_config.effort`). O loop do agente usa `High`
/// (decisão §11); routing e títulos usam `Low`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    #[default]
    High,
    Xhigh,
    Max,
}

impl Effort {
    pub fn as_str(self) -> &'static str {
        match self {
            Effort::Low => "low",
            Effort::Medium => "medium",
            Effort::High => "high",
            Effort::Xhigh => "xhigh",
            Effort::Max => "max",
        }
    }
}

/// O que o servidor devolve do raciocínio. `Summarized` mostra um resumo na UI em vez
/// de uma pausa muda (o thinking não se desliga nos modelos actuais).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ThinkingDisplay {
    #[default]
    Summarized,
    Omitted,
}

/// Duração das entradas de cache dos breakpoints do system prompt (que cobrem ferramentas +
/// system). `OneHour`: a escrita custa 2× a entrada (contra 1,25× nos 5 min), mas o prefixo
/// sobrevive às pausas de revisão do humano, que passam muitas vezes dos 5 minutos — sem ele,
/// cada pausa reescreve o prefixo inteiro. A cauda da conversa fica sempre nos 5 minutos (a API
/// exige as entradas mais longas antes das mais curtas).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CacheTtl {
    #[default]
    FiveMinutes,
    OneHour,
}

/// Um bloco do system prompt. `cache` marca um breakpoint de prompt caching no fim dele.
#[derive(Debug, Clone, PartialEq)]
pub struct SystemBlock {
    pub text: String,
    pub cache: bool,
}

/// Definição de uma ferramenta. `eager` liga `eager_input_streaming` (entradas grandes —
/// conteúdo de ficheiros — chegam à medida que são geradas; o chamador valida o input
/// contra o schema antes de executar).
#[derive(Debug, Clone, PartialEq)]
pub struct ToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub eager: bool,
}

/// Um pedido ao modelo.
#[derive(Debug, Clone)]
pub struct Request {
    pub model: String,
    pub system: Vec<SystemBlock>,
    pub messages: Vec<Message>,
    /// Ordem determinística: mudar a ordem entre pedidos invalida a cache.
    pub tools: Vec<ToolDef>,
    pub max_tokens: u32,
    pub effort: Effort,
    pub thinking: ThinkingDisplay,
    /// Fallbacks do servidor em caso de recusa (decisão §11: ligados por omissão).
    pub fallbacks: bool,
    /// Só para retomar um `pause_turn`: a última mensagem é o turno pausado do assistente
    /// e é reenviada tal como veio. Fora disso, uma última mensagem do assistente é
    /// prefill e o pedido é recusado.
    pub resume_paused: bool,
    /// Compactação no servidor quando o contexto cresce (beta `compact-2026-01-12`): os
    /// blocos `compaction` devolvidos ficam no histórico e o servidor ignora o que vem antes.
    pub compaction: bool,
    /// TTL dos breakpoints do system prompt ([`CacheTtl`]).
    pub cache_ttl: CacheTtl,
}

impl Request {
    /// Pedido com os valores por omissão do harness v2.
    pub fn new(model: impl Into<String>, messages: Vec<Message>) -> Self {
        Request {
            model: model.into(),
            system: vec![],
            messages,
            tools: vec![],
            max_tokens: 64_000,
            effort: Effort::High,
            thinking: ThinkingDisplay::Summarized,
            fallbacks: true,
            resume_paused: false,
            compaction: true,
            cache_ttl: CacheTtl::FiveMinutes,
        }
    }
}

/// Porque é que o modelo parou.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    EndTurn,
    ToolUse,
    MaxTokens,
    StopSequence,
    PauseTurn,
    Refusal,
    /// O servidor compactou o contexto e pausou (`pause_after_compaction`).
    Compaction,
    Other(String),
}

impl StopReason {
    pub fn parse(s: &str) -> Self {
        match s {
            "end_turn" => StopReason::EndTurn,
            "tool_use" => StopReason::ToolUse,
            "max_tokens" => StopReason::MaxTokens,
            "stop_sequence" => StopReason::StopSequence,
            "pause_turn" => StopReason::PauseTurn,
            "refusal" => StopReason::Refusal,
            "compaction" => StopReason::Compaction,
            other => StopReason::Other(other.to_string()),
        }
    }
}

/// Tokens de um pedido, tal como o servidor os reporta.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    /// Todas as escritas de cache (5 min + 1 h), como o servidor as soma.
    pub cache_creation_input_tokens: u64,
    /// A parte de `cache_creation_input_tokens` escrita com TTL de 1 hora
    /// (`usage.cache_creation.ephemeral_1h_input_tokens`): custa 2× a entrada, não 1,25×.
    pub cache_creation_1h_input_tokens: u64,
}

/// A resposta completa de um pedido.
#[derive(Debug, Clone, PartialEq)]
pub struct Response {
    pub id: String,
    /// O modelo que de facto respondeu (pode diferir do pedido quando houve fallback).
    pub model: String,
    /// Os blocos tal como chegaram — é isto que entra no histórico.
    pub content: Vec<Value>,
    pub stop_reason: StopReason,
    /// Só presente em recusas (`category`, `explanation`).
    pub stop_details: Option<Value>,
    pub usage: Usage,
    /// `(tool_use_id, texto recebido)` das ferramentas cujo input não é JSON válido.
    /// Essas ferramentas **não** devem correr: devolve-se um `tool_result` com erro.
    pub invalid_tool_inputs: Vec<(String, String)>,
}

/// Tipo de bloco que começou no stream.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BlockKind {
    Text,
    Thinking,
    ToolUse { id: String, name: String },
    Other { name: String },
}

/// Eventos em tempo real, para a UI. O callback devolve `false` para cancelar.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    MessageStart {
        model: String,
    },
    BlockStart {
        index: usize,
        kind: BlockKind,
    },
    TextDelta {
        index: usize,
        text: String,
    },
    ThinkingDelta {
        index: usize,
        text: String,
    },
    ToolInputDelta {
        index: usize,
        partial_json: String,
    },
    BlockStop {
        index: usize,
    },
    Usage(Usage),
    /// O servidor mandou um ping: oportunidade de cancelar mesmo sem texto a chegar.
    Ping,
}

/// Falhas de um pedido.
#[derive(Debug, Clone, PartialEq)]
pub enum ProviderError {
    /// O pedido nem saiu (ex.: prefill, histórico vazio).
    InvalidRequest(String),
    /// O servidor respondeu com erro HTTP (depois dos retries, se aplicável).
    Http {
        status: u16,
        kind: String,
        message: String,
    },
    /// Não foi possível falar com o servidor (rede, TLS, timeout de leitura).
    Transport(String),
    /// Evento `error` a meio do stream (ex.: `overloaded_error`). A resposta parcial
    /// **não** é um fim de turno.
    Stream { kind: String, message: String },
    /// O stream acabou sem `message_delta`/`message_stop`, ou trouxe JSON inválido.
    Protocol(String),
    /// O chamador cancelou.
    Cancelled,
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ProviderError::InvalidRequest(m) => write!(f, "pedido inválido: {m}"),
            ProviderError::Http {
                status,
                kind,
                message,
            } => write!(f, "HTTP {status} ({kind}): {message}"),
            ProviderError::Transport(m) => write!(f, "sem ligação ao provedor: {m}"),
            ProviderError::Stream { kind, message } => {
                write!(f, "erro a meio da resposta ({kind}): {message}")
            }
            ProviderError::Protocol(m) => write!(f, "resposta mal formada: {m}"),
            ProviderError::Cancelled => write!(f, "cancelado"),
        }
    }
}

impl std::error::Error for ProviderError {}

/// Um provedor de modelos. Síncrono: cada sessão corre na sua thread.
pub trait Provider: Send + Sync {
    /// Envia o pedido e entrega os eventos à medida que chegam. Devolver `false` no
    /// callback cancela o pedido ([`ProviderError::Cancelled`]).
    fn stream(
        &self,
        req: &Request,
        on_event: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<Response, ProviderError>;
}
