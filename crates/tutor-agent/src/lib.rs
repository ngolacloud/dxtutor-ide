//! **tutor-agent** — o harness v2 do Co-Dev (plano: `docs/design/harness-v2.md`).
//!
//! - F0: tipos canónicos da conversa ([`types`]), contrato de um provedor ([`provider`])
//!   e o provedor Anthropic ([`anthropic`]): corpo do pedido, parser SSE completo e
//!   retry com backoff antes do primeiro byte;
//! - F1: o loop do agente ([`agent`]) guiado por `stop_reason`, o contrato das
//!   ferramentas ([`tool`]) e a validação do input contra o schema ([`schema`]).
//! - F2: as ferramentas reais ([`tools`]) — read/glob/grep/edit/write/bash/git e
//!   run_tests/lint — contidas na raiz do projecto ([`sandbox`]);
//! - F3: permissões no backend ([`permissions`]) — classificador de comandos de shell,
//!   regras por projecto, ficheiros protegidos e o modo da modebar;
//! - F5: contexto e sessão — system prompt com as instruções do projecto ([`context`]),
//!   sessões JSONL append-only retomáveis byte a byte ([`session`]), mensagens `system`
//!   a meio da conversa e compactação no servidor.
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
pub mod checkpoint;
pub mod context;
pub mod extensions;
pub mod hooks;
pub mod hunks;
pub mod mcp;
pub mod openai;
pub mod permissions;
pub mod provider;
pub mod redact;
pub mod report;
pub mod retry;
pub mod sandbox;
pub mod schema;
pub mod session;
pub mod tool;
pub mod tools;
pub mod trust;
pub mod types;

pub use agent::{Agent, AgentConfig, AgentError, AgentEvent, Decision, PendingCall, TurnOutcome};
pub use provider::{
    BlockKind, Effort, Provider, ProviderError, Request, Response, StopReason, StreamEvent,
    SystemBlock, ThinkingDisplay, ToolDef, Usage,
};
pub use tool::{Tool, ToolCtx, ToolOutput};
pub use types::{Message, Role, ToolResult, ToolUse, Transcript};
