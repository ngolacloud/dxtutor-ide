//! **tutor-agent** — o harness v2 do Co-Dev (plano: `docs/design/harness-v2.md`).
//!
//! - F0: tipos canónicos da conversa ([`types`]), contrato de um provedor ([`provider`])
//!   e o provedor Anthropic ([`anthropic`]): corpo do pedido, parser SSE completo e
//!   retry com backoff antes do primeiro byte;
//! - F1: o loop do agente ([`agent`]) guiado por `stop_reason`, o contrato das
//!   ferramentas ([`tool`]) e a validação do input contra o schema ([`schema`]).
//!   As ferramentas reais chegam em F2; as permissões em F3.
//!
//! Invariantes que este crate garante por construção:
//! - **histórico append-only** ([`types::Transcript`] não tem remoção nem edição): o
//!   *preserved thinking* dos modelos actuais invalida blocos `thinking` quando o
//!   histórico anterior é alterado;
//! - **blocos do assistente devolvidos tal como vieram** ([`types::Message`] guarda o
//!   JSON de cada bloco, sem o reinterpretar), incluindo tipos que este crate não conhece;
//! - **sem assistant prefill**: um pedido cuja última mensagem é do assistente é
//!   recusado antes de sair ([`anthropic::body`]) — dá 400 nos modelos actuais.

pub mod agent;
pub mod anthropic;
pub mod provider;
pub mod retry;
pub mod schema;
pub mod tool;
pub mod types;

pub use agent::{Agent, AgentConfig, AgentError, AgentEvent, Decision, PendingCall, TurnOutcome};
pub use provider::{
    BlockKind, Effort, Provider, ProviderError, Request, Response, StopReason, StreamEvent,
    SystemBlock, ThinkingDisplay, ToolDef, Usage,
};
pub use tool::{Tool, ToolCtx, ToolOutput};
pub use types::{Message, Role, ToolResult, ToolUse, Transcript};
