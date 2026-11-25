//! The redaction moved to `tutor_protect::redact` (r23 F4a): every outgoing LLM request is filtered
//! by it, and `tutor-llm` (below this crate) needed it too. Re-exported here so the agent's paths
//! (`crate::redact::Redactor`, `tutor_agent::redact::…`) stay as they were.

pub use tutor_protect::redact::*;
