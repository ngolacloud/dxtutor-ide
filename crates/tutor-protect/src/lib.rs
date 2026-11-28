//! Data protection (r23 F4a, docs/v2/AUDIT-r23.md §4.4 — X02, X03, X04): what keeps a secret from
//! leaving the machine. Tauri-free, shared by every crate that talks to a model, commits or shows
//! a process's output.
//!
//! - [`redact`]: secrets masked before anything is written to disk or sent to a model; every
//!   outgoing LLM request goes through [`redact::guard_json`] / [`redact::guard_body`].
//! - [`scan`]: the secret scan that runs before a commit (gitleaks when installed, else the same
//!   rules), with forbidden files and a one-time, reasoned override.
//! - [`stream`]: masking of a terminal's output as it streams.
//! - [`keychain`]: the OS keychain, where the model keys and the Vault token live (r23 F4c).
//! - [`hook`]: the pre-commit hook that runs the same scan on a commit made in a terminal.

pub mod hook;
#[cfg(feature = "keychain")]
pub mod keychain;
pub mod redact;
pub mod scan;
pub mod stream;
