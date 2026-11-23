//! **tutor-agent** — o harness v2 do Co-Dev (plano: `docs/design/harness-v2.md`).
//!
//! F0 (este estado): os tipos canónicos da conversa ([`types`]), o contrato de um
//! provedor de modelos ([`provider`]) e o provedor Anthropic ([`anthropic`]): corpo do
//! pedido, parser SSE completo (texto, thinking, `input_json_delta`, usage, erros a meio)
//! e retry com backoff antes do primeiro byte. O loop do agente chega em F1.
//!
//! Invariantes que este crate garante por construção:
//! - **histórico append-only** ([`types::Transcript`] não tem remoção nem edição): o
//!   *preserved thinking* dos modelos actuais invalida blocos `thinking` quando o
//!   histórico anterior é alterado;
//! - **blocos do assistente devolvidos tal como vieram** ([`types::Message`] guarda o
//!   JSON de cada bloco, sem o reinterpretar), incluindo tipos que este crate não conhece;
//! - **sem assistant prefill**: um pedido cuja última mensagem é do assistente é
//!   recusado antes de sair ([`anthropic::body`]) — dá 400 nos modelos actuais.

pub mod anthropic;
pub mod provider;
pub mod retry;
pub mod types;

pub use provider::{
    BlockKind, Effort, Provider, ProviderError, Request, Response, StopReason, StreamEvent,
    SystemBlock, ThinkingDisplay, ToolDef, Usage,
};
pub use types::{Message, Role, ToolResult, ToolUse, Transcript};
