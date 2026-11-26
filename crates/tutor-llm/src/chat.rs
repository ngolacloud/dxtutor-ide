//! Minimal local chat via **Ollama** — the one provider usable with no API key, so
//! the Dev Assistant has a real local brain right now. The full multi-provider +
//! streaming + Ask/Edit layer is P4; this is deliberately small and non-streaming.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

const DEFAULT_HOST: &str = "http://localhost:11434";

// ── Provider configuration (keys & Ollama) persisted locally ─────────────────────

/// Provider settings the user enters in the UI, stored at
/// `~/.config/dxtutor/providers.json` (mode 0600). Every field falls back to the
/// matching environment variable when empty, so `export`-based setups keep working.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProvidersConfig {
    pub provider: String,
    pub anthropic_key: String,
    pub anthropic_workspace_id: String,
    pub openai_key: String,
    pub gemini_key: String,
    pub ollama_host: String,
    pub ollama_model: String,
    pub assistant_model: String,
}

fn config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
    Some(PathBuf::from(home).join(".config/dxtutor/providers.json"))
}

/// The API keys of the config and the keychain account each lives under (the same accounts the IDE's
/// `keys.rs` uses, so the assistant, the TUI and the IDE share one place).
fn key_fields(cfg: &mut ProvidersConfig) -> [(&'static str, &mut String); 3] {
    [
        ("llm:claude", &mut cfg.anthropic_key),
        ("llm:codex", &mut cfg.openai_key),
        ("llm:gemini", &mut cfg.gemini_key),
    ]
}

fn read_file(path: Option<&std::path::Path>) -> ProvidersConfig {
    path.and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Load the saved provider settings (empty defaults when absent/unreadable). r23: the API keys live in
/// the OS keychain; a key still in `providers.json` moves there the first time it is read (and leaves
/// the file) — never over one the keychain already has. Without a keychain (no Secret Service, e.g. over
/// SSH) the file keeps them, as before.
pub fn load_config() -> ProvidersConfig {
    load_config_in(
        &tutor_protect::keychain::OsStore::new(),
        config_path().as_deref(),
    )
}

pub fn load_config_in(
    store: &dyn tutor_protect::keychain::Store,
    path: Option<&std::path::Path>,
) -> ProvidersConfig {
    let mut cfg = read_file(path);
    let mut moved = false;
    for (account, field) in key_fields(&mut cfg) {
        match store.get(account) {
            // the keychain has one: it wins; a key left in the file is dropped from it
            Ok(Some(k)) if !k.is_empty() => {
                moved |= !field.is_empty();
                *field = k;
            }
            // the keychain answers but has none: a key in the file moves there
            Ok(_) if !field.is_empty() => moved |= store.set(account, field).is_ok(),
            _ => {}
        }
    }
    if moved {
        if let Some(p) = path {
            let mut file = cfg.clone();
            for (_, f) in key_fields(&mut file) {
                f.clear();
            }
            if let Ok(json) = serde_json::to_string_pretty(&file) {
                let _ = write_private(p, json.as_bytes());
            }
        }
    }
    cfg
}

/// Persist provider settings with owner-only permissions (0600). r23: the API keys go to the OS keychain
/// (an empty key is removed from it) and never into the file; without a keychain, into the file as before.
pub fn save_config(cfg: &ProvidersConfig) -> Result<()> {
    let path = config_path().ok_or_else(|| anyhow::anyhow!("no HOME to store config"))?;
    save_config_in(&tutor_protect::keychain::OsStore::new(), &path, cfg)
}

pub fn save_config_in(
    store: &dyn tutor_protect::keychain::Store,
    path: &std::path::Path,
    cfg: &ProvidersConfig,
) -> Result<()> {
    let mut file = cfg.clone();
    for (account, field) in key_fields(&mut file) {
        let kept = if field.trim().is_empty() {
            store.delete(account)
        } else {
            store.set(account, field.trim())
        };
        if kept.is_ok() {
            field.clear();
        }
    }
    write_private(path, serde_json::to_string_pretty(&file)?.as_bytes()).context("writing config")
}

/// Write a secrets file so it is never readable by other users, not even briefly:
/// the temp file is created with mode 0600 from the start (no umask window before a
/// later chmod), filled, fsynced and atomically renamed over `path`.
pub fn write_private(path: &std::path::Path, contents: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let _ = std::fs::remove_file(&tmp);
    let mut f = opts.open(&tmp)?;
    let res = f.write_all(contents).and_then(|_| f.sync_all());
    drop(f);
    if let Err(e) = res.and_then(|_| std::fs::rename(&tmp, path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

/// What the webview sees in place of a saved key. The real keys never cross the IPC
/// boundary: the UI only needs to know *whether* one is saved, and when it posts the
/// form back with this placeholder the stored key is kept.
pub const KEY_MASK: &str = "••••••••";

impl ProvidersConfig {
    /// A copy safe to hand to the UI: every non-empty key replaced by [`KEY_MASK`].
    pub fn redacted(&self) -> Self {
        let m = |k: &str| {
            if k.is_empty() {
                String::new()
            } else {
                KEY_MASK.to_string()
            }
        };
        Self {
            anthropic_key: m(&self.anthropic_key),
            openai_key: m(&self.openai_key),
            gemini_key: m(&self.gemini_key),
            ..self.clone()
        }
    }

    /// The config to persist from a form the UI posted: keys still equal to
    /// [`KEY_MASK`] keep the value in `stored`; anything else (a new key, or "" to
    /// clear) replaces it.
    pub fn merged_over(mut self, stored: &ProvidersConfig) -> Self {
        let keep = |new: &mut String, old: &str| {
            if new == KEY_MASK {
                *new = old.to_string();
            }
        };
        keep(&mut self.anthropic_key, &stored.anthropic_key);
        keep(&mut self.openai_key, &stored.openai_key);
        keep(&mut self.gemini_key, &stored.gemini_key);
        self
    }
}

/// Strip surrounding whitespace and one layer of wrapping quotes. Keys and IDs
/// pasted from a console/shell often carry a stray quote (e.g. `wrkspc_…"`) that
/// silently invalidates an auth header; credentials never contain surrounding
/// quotes or whitespace legitimately, so this is safe to apply everywhere.
fn clean(s: &str) -> String {
    let t = s.trim();
    let t = t
        .strip_prefix('"')
        .and_then(|x| x.strip_suffix('"'))
        .or_else(|| t.strip_prefix('\'').and_then(|x| x.strip_suffix('\'')))
        .unwrap_or(t);
    t.trim().to_string()
}

/// Config value if set, else the first non-empty environment variable among `envs`.
/// All values are sanitized via [`clean`] so a stray pasted quote can't break auth.
fn cfg_or_env(cfg_val: &str, envs: &[&str]) -> Option<String> {
    let cleaned = clean(cfg_val);
    if !cleaned.is_empty() {
        return Some(cleaned);
    }
    envs.iter().find_map(|k| {
        std::env::var(k)
            .ok()
            .map(|v| clean(&v))
            .filter(|v| !v.is_empty())
    })
}

/// One chat turn. `role` is "system" | "user" | "assistant".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// The assistant's reply plus which model/provider produced it (for provenance), and the
/// token usage the provider reported for the turn (0 when it reported none).
#[derive(Debug, Clone, Serialize)]
pub struct ChatReply {
    pub content: String,
    pub model: String,
    pub provider: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Token usage of one turn, as the provider reports it in its own wire format.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
}

/// Absorb whatever usage a provider's (streamed or one-shot) JSON object carries:
/// - Claude: `message_start.message.usage` (input, incl. cache reads/writes) and the
///   cumulative `message_delta.usage.output_tokens`;
/// - OpenAI: the final chunk's `usage.prompt_tokens`/`completion_tokens` (needs
///   `stream_options.include_usage`);
/// - Gemini: `usageMetadata.promptTokenCount`/`candidatesTokenCount` (cumulative per chunk);
/// - Ollama: the final object's `prompt_eval_count`/`eval_count`.
///
/// Fields a chunk doesn't carry leave the running value untouched.
pub fn absorb_usage(provider: &str, v: &serde_json::Value, u: &mut Usage) {
    let n = |x: &serde_json::Value| x.as_u64();
    match provider {
        "claude" => {
            let usage = v
                .get("message")
                .and_then(|m| m.get("usage"))
                .or_else(|| v.get("usage"));
            if let Some(us) = usage {
                let input = [
                    "input_tokens",
                    "cache_read_input_tokens",
                    "cache_creation_input_tokens",
                ]
                .iter()
                .filter_map(|k| us.get(*k).and_then(n))
                .sum::<u64>();
                if us.get("input_tokens").is_some() {
                    u.input = input;
                }
                if let Some(o) = us.get("output_tokens").and_then(n) {
                    u.output = o;
                }
            }
        }
        "openai" => {
            if let Some(us) = v.get("usage").filter(|x| x.is_object()) {
                if let Some(i) = us.get("prompt_tokens").and_then(n) {
                    u.input = i;
                }
                if let Some(o) = us.get("completion_tokens").and_then(n) {
                    u.output = o;
                }
            }
        }
        "gemini" => {
            if let Some(us) = v.get("usageMetadata") {
                if let Some(i) = us.get("promptTokenCount").and_then(n) {
                    u.input = i;
                }
                if let Some(o) = us.get("candidatesTokenCount").and_then(n) {
                    u.output = o;
                }
            }
        }
        _ => {
            if let Some(i) = v.get("prompt_eval_count").and_then(n) {
                u.input = i;
            }
            if let Some(o) = v.get("eval_count").and_then(n) {
                u.output = o;
            }
        }
    }
}

/// O endereço do Ollama (definições → `OLLAMA_HOST` → `localhost:11434`).
pub fn ollama_host() -> String {
    host()
}

fn host() -> String {
    cfg_or_env(&load_config().ollama_host, &["OLLAMA_HOST"])
        .unwrap_or_else(|| DEFAULT_HOST.to_string())
}

/// What one AI backend can do here, honestly reported so the UI advertises only what
/// actually works. `streaming` means a live-validated token stream exists today.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderInfo {
    pub id: String,
    pub name: String,
    pub available: bool,
    /// Capabilities, honestly reported (RF-AG-06). `streaming`: a live token stream exists.
    /// `cancel`: an in-flight request can be stopped. `tools`: the structured action protocol
    /// (dxedit/dxcode/dxcontinue/dxaction) works through this provider. `context`: the
    /// workspace grounding (tree/active file/selection) is sent.
    pub streaming: bool,
    pub cancel: bool,
    pub tools: bool,
    pub context: bool,
    pub note: String,
    pub models: Vec<String>,
}

/// The AI providers the assistant knows about and whether each is usable right now.
/// Only Ollama is live-validated (local, no key); the others are detected by their
/// API-key env but their streaming adapters are not yet validated (no key to test).
pub fn list_providers() -> Vec<ProviderInfo> {
    let cfg = load_config();
    let models = ollama_models();
    let ollama = ProviderInfo {
        id: "ollama".into(),
        name: "Ollama (local)".into(),
        available: !models.is_empty(),
        streaming: true,
        cancel: true,
        tools: true,
        context: true,
        note: if models.is_empty() {
            "Start Ollama and pull a model, e.g. `ollama pull qwen3`.".into()
        } else {
            "Local — no API key, streams live.".into()
        },
        models,
    };
    // Providers with a real SSE streaming adapter. They stream the moment a key is set;
    // without one they advertise exactly how to enable them. `envs[0]` is the canonical
    // env var named in the hint; any later ones are also accepted as fallbacks.
    let keyed = |id: &str, name: &str, cfg_val: &str, envs: &[&str]| {
        let has = cfg_or_env(cfg_val, envs).is_some();
        ProviderInfo {
            id: id.into(),
            name: name.into(),
            available: has,
            streaming: true,
            cancel: true,
            tools: true,
            context: true,
            note: if has {
                "Key set — streams live.".into()
            } else {
                format!("Set the API key (settings or {}) to enable.", envs[0])
            },
            models: vec![],
        }
    };
    // Claude has a real streaming adapter now; it is usable the moment a key is set.
    let claude_key = cfg_or_env(&cfg.anthropic_key, &["ANTHROPIC_API_KEY"]).is_some();
    let claude = ProviderInfo {
        id: "claude".into(),
        name: "Claude (Anthropic)".into(),
        available: claude_key,
        streaming: true,
        cancel: true,
        tools: true,
        context: true,
        note: if claude_key {
            "Key set — streams via the Messages API.".into()
        } else {
            "Set the Anthropic key (settings or ANTHROPIC_API_KEY); org id alone is not a key."
                .into()
        },
        models: vec![],
    };
    vec![
        ollama,
        claude,
        keyed(
            "openai",
            "OpenAI / Codex",
            &cfg.openai_key,
            &["OPENAI_API_KEY"],
        ),
        keyed(
            "gemini",
            "Gemini (Google)",
            &cfg.gemini_key,
            &["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        ),
        ProviderInfo {
            id: "copilot".into(),
            name: "GitHub Copilot".into(),
            available: false,
            streaming: false,
            cancel: false,
            tools: false,
            context: false,
            note: "Requires GitHub authentication (not wired).".into(),
            models: vec![],
        },
    ]
}

/// Locally-pulled Ollama models (empty when Ollama is down or has none).
pub fn ollama_models() -> Vec<String> {
    let url = format!("{}/api/tags", host());
    let resp = match ureq::get(&url).timeout(Duration::from_secs(3)).call() {
        Ok(r) => r,
        Err(_) => return Vec::new(),
    };
    let v: serde_json::Value = match resp.into_json() {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    v.get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    m.get("name")
                        .and_then(|n| n.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Pick a model: the caller's choice if available, else a Qwen model, else the first.
/// Public so the tool-capable transport in `desktop/src-tauri/src/llm.rs` can reuse the
/// exact same Ollama fallback instead of sending an un-pulled model id (which 404s).
pub fn pick_model(requested: Option<&str>, available: &[String]) -> Option<String> {
    if let Some(m) = requested {
        if available.iter().any(|a| a == m) {
            return Some(m.to_string());
        }
    }
    available
        .iter()
        .find(|a| a.to_lowercase().contains("qwen"))
        .cloned()
        .or_else(|| available.first().cloned())
}

/// Send a chat turn to Ollama (non-streaming) and return the assistant reply.
pub fn ollama_chat(messages: &[ChatMsg], model: Option<&str>) -> Result<ChatReply> {
    let available = ollama_models();
    if available.is_empty() {
        anyhow::bail!(
            "No local Ollama model is available. Start Ollama and pull one, e.g. `ollama pull qwen3`."
        );
    }
    let requested = model
        .map(str::to_string)
        .or_else(|| Some(load_config().ollama_model).filter(|m| !m.is_empty()));
    let model = pick_model(requested.as_deref(), &available)
        .ok_or_else(|| anyhow::anyhow!("no usable Ollama model"))?;

    let url = format!("{}/api/chat", host());
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });

    match ureq::post(&url)
        .timeout(Duration::from_secs(120))
        .send_json(crate::guarded("assistant", body))
    {
        Ok(resp) => {
            let v: serde_json::Value = resp.into_json().context("parsing Ollama reply")?;
            let content = v
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
                .unwrap_or("")
                .to_string();
            let mut u = Usage::default();
            absorb_usage("ollama", &v, &mut u);
            Ok(ChatReply {
                content,
                model,
                provider: "ollama".into(),
                input_tokens: u.input,
                output_tokens: u.output,
            })
        }
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            anyhow::bail!("Ollama returned {code}: {detail}");
        }
        Err(ureq::Error::Transport(t)) => {
            anyhow::bail!("Could not reach Ollama at {}: {t}", host());
        }
    }
}

/// Stream an Ollama chat: `on_delta(chunk)` is called for every token chunk as it
/// arrives. Return `false` from `on_delta` to CANCEL — reading stops and the partial
/// reply is returned. This is the transport the Dev Assistant and "Edit with me" use.
pub fn ollama_chat_stream(
    messages: &[ChatMsg],
    model: Option<&str>,
    mut on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply> {
    let available = ollama_models();
    if available.is_empty() {
        anyhow::bail!(
            "No local Ollama model is available. Start Ollama and pull one, e.g. `ollama pull qwen3`."
        );
    }
    let requested = model
        .map(str::to_string)
        .or_else(|| Some(load_config().ollama_model).filter(|m| !m.is_empty()));
    let model = pick_model(requested.as_deref(), &available)
        .ok_or_else(|| anyhow::anyhow!("no usable Ollama model"))?;

    let url = format!("{}/api/chat", host());
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
        // Ollama defaults num_ctx to 2048 — far too small when the prompt carries a whole
        // code file AND the model must emit a whole file back: the context overflows and the
        // generation is CUT OFF mid-way (looks like a broken stream). Give it room, and don't
        // cap the output (num_predict -1 = generate until the model stops).
        "options": {
            "num_ctx": 16384,
            "num_predict": -1,
        },
    });

    let resp = match ureq::post(&url)
        .timeout(Duration::from_secs(300))
        .send_json(crate::guarded("assistant", body))
    {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            anyhow::bail!("Ollama returned {code}: {detail}");
        }
        Err(ureq::Error::Transport(t)) => {
            anyhow::bail!("Could not reach Ollama at {}: {t}", host());
        }
    };

    // Ollama streams NDJSON: one JSON object per line, each with a partial
    // `message.content`, ending with `{"done": true}`.
    let reader = BufReader::new(resp.into_reader());
    let mut full = String::new();
    let mut usage = Usage::default();
    for line in reader.lines() {
        let line = line.context("reading Ollama stream")?;
        if line.trim().is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Some(delta) = v
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
        {
            if !delta.is_empty() {
                full.push_str(delta);
                if !on_delta(delta) {
                    break; // cancelled by the caller
                }
            }
        }
        if v.get("done").and_then(|d| d.as_bool()).unwrap_or(false) {
            absorb_usage("ollama", &v, &mut usage);
            break;
        }
    }

    Ok(ChatReply {
        content: full,
        model,
        provider: "ollama".into(),
        input_tokens: usage.input,
        output_tokens: usage.output,
    })
}

// ── Claude (Anthropic) streaming ────────────────────────────────────────────────

const ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";

/// Stream a chat from Anthropic's Messages API (SSE, `stream: true`), reading the
/// key + model from the environment. `on_delta(chunk)` is called per text delta;
/// return `false` to cancel. Implemented to the documented SSE shape; validate live
/// with a real `ANTHROPIC_API_KEY` (there is none in CI, so this path is unproven here).
pub fn claude_chat_stream_env(
    messages: &[ChatMsg],
    model: Option<&str>,
    on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply> {
    let cfg = load_config();
    let api_key = cfg_or_env(&cfg.anthropic_key, &["ANTHROPIC_API_KEY"]).ok_or_else(|| {
        anyhow::anyhow!("No Anthropic key — set it in AI settings or ANTHROPIC_API_KEY")
    })?;
    // O modelo escolhido na UI manda (antes era ignorado e caía sempre no haiku-4-5).
    let model = model
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(String::from)
        .or_else(|| cfg_or_env(&cfg.assistant_model, &["DXTUTOR_ASSISTANT_MODEL"]))
        .unwrap_or_else(|| "claude-opus-5-5".to_string());
    // Org-scoped keys need the workspace id in a header.
    let workspace = cfg_or_env(
        &cfg.anthropic_workspace_id,
        &[
            "ANTHROPIC_WORKSPACE_ID",
            "CLAUDE_WORKSPACE_ID",
            "CLAUDE_ORG_ID",
        ],
    );
    claude_chat_stream(messages, &model, &api_key, workspace.as_deref(), on_delta)
}

/// Core Claude streaming call. Anthropic wants the system prompt separate from the
/// `messages` array, and emits SSE events whose `content_block_delta` carries each
/// text chunk in `delta.text`.
pub fn claude_chat_stream(
    messages: &[ChatMsg],
    model: &str,
    api_key: &str,
    workspace_id: Option<&str>,
    mut on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply> {
    let system = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    // Um só pedido em streaming com espaço de sobra. A antiga continuação por *assistant
    // prefill* (reenviar o parcial como última mensagem do assistente) dá 400 nos modelos
    // actuais (Opus 5.5 e família 4.6+) — foi removida (ADR-0003, F4).
    let mut full = String::new();
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 64000,
        "stream": true,
        "messages": msgs,
    });
    // Anthropic rejects an empty `system`; only include it when there is one.
    if !system.trim().is_empty() {
        body["system"] = serde_json::Value::String(system.clone());
    }

    let mut req = ureq::post(ANTHROPIC_ENDPOINT)
        .set("x-api-key", api_key)
        .set("anthropic-version", ANTHROPIC_VERSION)
        .set("content-type", "application/json")
        .timeout(Duration::from_secs(600));
    if let Some(ws) = workspace_id.filter(|w| !w.is_empty()) {
        req = req.set("anthropic-workspace-id", ws); // required for org-scoped keys
    }
    let resp = match req.send_json(crate::guarded("assistant", body)) {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            anyhow::bail!("Anthropic returned {code}: {detail}");
        }
        Err(ureq::Error::Transport(t)) => anyhow::bail!("Could not reach Anthropic: {t}"),
    };

    let reader = BufReader::new(resp.into_reader());
    let mut usage = Usage::default();
    for line in reader.lines() {
        let line = line.context("reading Anthropic SSE")?;
        let data = match line.strip_prefix("data: ") {
            Some(d) => d.trim(),
            None => continue, // `event:` lines and blanks are ignored
        };
        if data == "[DONE]" {
            break;
        }
        let v: serde_json::Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };
        absorb_usage("claude", &v, &mut usage);
        match v.get("type").and_then(|t| t.as_str()) {
            Some("content_block_delta") => {
                if let Some(text) = v
                    .get("delta")
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.as_str())
                {
                    if !text.is_empty() {
                        full.push_str(text);
                        if !on_delta(text) {
                            break; // cancelled
                        }
                    }
                }
            }
            // Erro a meio do stream (overloaded, rate limit…): é um erro, não um fim de turno.
            Some("error") => {
                let e = &v["error"];
                anyhow::bail!(
                    "Anthropic stream error ({}): {}",
                    e["type"].as_str().unwrap_or("error"),
                    e["message"].as_str().unwrap_or("")
                );
            }
            Some("message_stop") => break,
            _ => {}
        }
    }

    Ok(ChatReply {
        content: full,
        model: model.to_string(),
        provider: "claude".into(),
        input_tokens: usage.input,
        output_tokens: usage.output,
    })
}

// ── OpenAI (Chat Completions) streaming ───────────────────────────────────────────

const OPENAI_ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_DEFAULT_MODEL: &str = "gpt-4o-mini";

/// Stream a chat from OpenAI's Chat Completions API (SSE, `stream: true`), reading the
/// key + model from the UI config (falling back to `OPENAI_API_KEY`). `on_delta(chunk)`
/// is called per text delta; return `false` to cancel.
pub fn openai_chat_stream_env(
    messages: &[ChatMsg],
    model: Option<&str>,
    on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply> {
    let cfg = load_config();
    let api_key = cfg_or_env(&cfg.openai_key, &["OPENAI_API_KEY"]).ok_or_else(|| {
        anyhow::anyhow!("No OpenAI key — set it in AI settings or OPENAI_API_KEY")
    })?;
    // Caller's choice wins; else a configured assistant model; else a safe default.
    let model = model
        .map(str::to_string)
        .or_else(|| cfg_or_env(&cfg.assistant_model, &["DXTUTOR_ASSISTANT_MODEL"]))
        .unwrap_or_else(|| OPENAI_DEFAULT_MODEL.to_string());
    openai_chat_stream(messages, &model, &api_key, on_delta)
}

/// Core OpenAI streaming call. OpenAI keeps the system prompt inline in the `messages`
/// array (role `system` is valid), so we pass roles through untouched. Each SSE event
/// carries a chunk in `choices[0].delta.content`; the stream ends with `data: [DONE]`.
pub fn openai_chat_stream(
    messages: &[ChatMsg],
    model: &str,
    api_key: &str,
    mut on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply> {
    let msgs: Vec<serde_json::Value> = messages
        .iter()
        .map(|m| serde_json::json!({ "role": m.role, "content": m.content }))
        .collect();
    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "stream_options": { "include_usage": true },
        "messages": msgs,
    });

    let resp = match ureq::post(OPENAI_ENDPOINT)
        .set("authorization", &format!("Bearer {api_key}"))
        .set("content-type", "application/json")
        .timeout(Duration::from_secs(300))
        .send_json(crate::guarded("assistant", body))
    {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            anyhow::bail!("OpenAI returned {code}: {detail}");
        }
        Err(ureq::Error::Transport(t)) => anyhow::bail!("Could not reach OpenAI: {t}"),
    };

    let reader = BufReader::new(resp.into_reader());
    let mut full = String::new();
    let mut usage = Usage::default();
    for line in reader.lines() {
        let line = line.context("reading OpenAI SSE")?;
        let data = match line.strip_prefix("data: ") {
            Some(d) => d.trim(),
            None => continue, // comments / blanks
        };
        if data == "[DONE]" {
            break;
        }
        let v: serde_json::Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };
        absorb_usage("openai", &v, &mut usage);
        if let Some(text) = v
            .get("choices")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("delta"))
            .and_then(|d| d.get("content"))
            .and_then(|t| t.as_str())
        {
            if !text.is_empty() {
                full.push_str(text);
                if !on_delta(text) {
                    break;
                }
            }
        }
    }

    Ok(ChatReply {
        content: full,
        model: model.to_string(),
        provider: "openai".into(),
        input_tokens: usage.input,
        output_tokens: usage.output,
    })
}

// ── Gemini (Google Generative Language) streaming ─────────────────────────────────

const GEMINI_DEFAULT_MODEL: &str = "gemini-2.0-flash";

/// Stream a chat from Google's Gemini `streamGenerateContent` endpoint (SSE via
/// `?alt=sse`), reading the key + model from the UI config (falling back to
/// `GEMINI_API_KEY`). `on_delta(chunk)` is called per text delta; return `false` to cancel.
pub fn gemini_chat_stream_env(
    messages: &[ChatMsg],
    model: Option<&str>,
    on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply> {
    let cfg = load_config();
    let api_key =
        cfg_or_env(&cfg.gemini_key, &["GEMINI_API_KEY", "GOOGLE_API_KEY"]).ok_or_else(|| {
            anyhow::anyhow!("No Gemini key — set it in AI settings or GEMINI_API_KEY")
        })?;
    let model = model
        .map(str::to_string)
        .or_else(|| cfg_or_env(&cfg.assistant_model, &["DXTUTOR_ASSISTANT_MODEL"]))
        .unwrap_or_else(|| GEMINI_DEFAULT_MODEL.to_string());
    gemini_chat_stream(messages, &model, &api_key, on_delta)
}

/// Core Gemini streaming call. Gemini wants the system prompt in `systemInstruction`
/// (separate from `contents`), uses the role name `model` for assistant turns, and nests
/// text under `contents[].parts[].text`. With `?alt=sse` each event is a `data:` line
/// whose `candidates[0].content.parts[].text` carries the chunk.
pub fn gemini_chat_stream(
    messages: &[ChatMsg],
    model: &str,
    api_key: &str,
    mut on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply> {
    let system = messages
        .iter()
        .filter(|m| m.role == "system")
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let contents: Vec<serde_json::Value> = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|m| {
            // Gemini only knows `user` and `model`; map `assistant` → `model`.
            let role = if m.role == "assistant" {
                "model"
            } else {
                "user"
            };
            serde_json::json!({ "role": role, "parts": [{ "text": m.content }] })
        })
        .collect();
    let mut body = serde_json::json!({ "contents": contents });
    if !system.trim().is_empty() {
        body["systemInstruction"] = serde_json::json!({ "parts": [{ "text": system }] });
    }

    // Key travels in the `x-goog-api-key` header (not the URL) so it never lands in logs.
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse"
    );
    let resp = match ureq::post(&url)
        .set("x-goog-api-key", api_key)
        .set("content-type", "application/json")
        .timeout(Duration::from_secs(300))
        .send_json(crate::guarded("assistant", body))
    {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            anyhow::bail!("Gemini returned {code}: {detail}");
        }
        Err(ureq::Error::Transport(t)) => anyhow::bail!("Could not reach Gemini: {t}"),
    };

    let reader = BufReader::new(resp.into_reader());
    let mut full = String::new();
    let mut usage = Usage::default();
    for line in reader.lines() {
        let line = line.context("reading Gemini SSE")?;
        let data = match line.strip_prefix("data: ") {
            Some(d) => d.trim(),
            None => continue,
        };
        if data.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(_) => continue,
        };
        absorb_usage("gemini", &v, &mut usage);
        if let Some(parts) = v
            .get("candidates")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("content"))
            .and_then(|c| c.get("parts"))
            .and_then(|p| p.as_array())
        {
            for part in parts {
                if let Some(text) = part.get("text").and_then(|t| t.as_str()) {
                    if !text.is_empty() {
                        full.push_str(text);
                        if !on_delta(text) {
                            return Ok(ChatReply {
                                content: full,
                                model: model.to_string(),
                                provider: "gemini".into(),
                                input_tokens: usage.input,
                                output_tokens: usage.output,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(ChatReply {
        content: full,
        model: model.to_string(),
        provider: "gemini".into(),
        input_tokens: usage.input,
        output_tokens: usage.output,
    })
}

#[cfg(test)]
mod usage_tests {
    use super::{absorb_usage, Usage};
    use serde_json::json;

    #[test]
    fn claude_le_a_entrada_com_cache_e_a_saida_cumulativa() {
        let mut u = Usage::default();
        absorb_usage(
            "claude",
            &json!({"type": "message_start", "message": {"usage": {"input_tokens": 12, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 5, "output_tokens": 1}}}),
            &mut u,
        );
        absorb_usage(
            "claude",
            &json!({"type": "content_block_delta", "delta": {"text": "x"}}),
            &mut u,
        );
        absorb_usage(
            "claude",
            &json!({"type": "message_delta", "usage": {"output_tokens": 42}}),
            &mut u,
        );
        assert_eq!(
            u,
            Usage {
                input: 1017,
                output: 42
            }
        );
    }

    #[test]
    fn openai_le_o_chunk_final_e_ignora_usage_nulo() {
        let mut u = Usage::default();
        absorb_usage(
            "openai",
            &json!({"choices": [{"delta": {"content": "x"}}], "usage": null}),
            &mut u,
        );
        absorb_usage(
            "openai",
            &json!({"choices": [], "usage": {"prompt_tokens": 30, "completion_tokens": 7}}),
            &mut u,
        );
        assert_eq!(
            u,
            Usage {
                input: 30,
                output: 7
            }
        );
    }

    #[test]
    fn gemini_e_ollama() {
        let mut g = Usage::default();
        absorb_usage(
            "gemini",
            &json!({"usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 3}}),
            &mut g,
        );
        absorb_usage(
            "gemini",
            &json!({"usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 8}}),
            &mut g,
        );
        assert_eq!(
            g,
            Usage {
                input: 9,
                output: 8
            }
        );
        let mut o = Usage::default();
        absorb_usage(
            "ollama",
            &json!({"done": true, "prompt_eval_count": 26, "eval_count": 290}),
            &mut o,
        );
        assert_eq!(
            o,
            Usage {
                input: 26,
                output: 290
            }
        );
    }

    #[test]
    fn sem_usage_fica_a_zero() {
        let mut u = Usage::default();
        absorb_usage("claude", &json!({"type": "ping"}), &mut u);
        absorb_usage("ollama", &json!({"message": {"content": "x"}}), &mut u);
        assert_eq!(u, Usage::default());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// r23: the API keys move from `providers.json` to the keychain, never over one already there; saving
    /// puts them in the keychain (an emptied one is removed); without a keychain the file keeps them.
    #[test]
    fn keys_move_to_the_keychain() {
        use tutor_protect::keychain::{MemStore, Store};
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("providers.json");
        let file = ProvidersConfig {
            provider: "anthropic".into(),
            anthropic_key: "sk-ant-old".into(),
            openai_key: "sk-open".into(),
            anthropic_workspace_id: "ws".into(),
            ..Default::default()
        };
        std::fs::write(&p, serde_json::to_string(&file).unwrap()).unwrap();
        let store = MemStore::default();
        store.set("llm:claude", "sk-ant-newer").unwrap();
        let cfg = load_config_in(&store, Some(&p));
        assert_eq!(
            (
                cfg.anthropic_key.as_str(),
                cfg.openai_key.as_str(),
                cfg.anthropic_workspace_id.as_str()
            ),
            ("sk-ant-newer", "sk-open", "ws")
        );
        assert_eq!(store.get("llm:codex").unwrap().as_deref(), Some("sk-open"));
        let on_disk = std::fs::read_to_string(&p).unwrap();
        assert!(
            !on_disk.contains("sk-") && on_disk.contains("\"ws\""),
            "{on_disk}"
        );
        // saving: into the keychain, an emptied key removed; the file stays without keys
        save_config_in(
            &store,
            &p,
            &ProvidersConfig {
                openai_key: String::new(),
                gemini_key: "gm-1".into(),
                ..cfg
            },
        )
        .unwrap();
        assert_eq!(
            (
                store.get("llm:codex").unwrap(),
                store.get("llm:gemini").unwrap().as_deref()
            ),
            (None, Some("gm-1"))
        );
        assert!(!std::fs::read_to_string(&p).unwrap().contains("gm-1"));
        // no keychain: the file keeps them, as before
        struct NoKeychain;
        impl Store for NoKeychain {
            fn get(&self, _: &str) -> Result<Option<String>, String> {
                Err("no keychain".into())
            }
            fn set(&self, _: &str, _: &str) -> Result<(), String> {
                Err("no keychain".into())
            }
            fn delete(&self, _: &str) -> Result<(), String> {
                Err("no keychain".into())
            }
        }
        let q = d.path().join("other.json");
        save_config_in(
            &NoKeychain,
            &q,
            &ProvidersConfig {
                anthropic_key: "sk-ant-x".into(),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(
            load_config_in(&NoKeychain, Some(&q)).anthropic_key,
            "sk-ant-x"
        );
    }

    #[test]
    fn redacted_hides_keys_and_merge_keeps_them() {
        let stored = ProvidersConfig {
            anthropic_key: "sk-ant-secret".into(),
            openai_key: "sk-openai".into(),
            gemini_key: String::new(),
            ollama_model: "qwen".into(),
            ..Default::default()
        };
        let ui = stored.redacted();
        assert_eq!(ui.anthropic_key, KEY_MASK);
        assert_eq!(ui.openai_key, KEY_MASK);
        assert_eq!(ui.gemini_key, "");
        assert_eq!(ui.ollama_model, "qwen");
        let json = serde_json::to_string(&ui).unwrap();
        assert!(!json.contains("secret") && !json.contains("sk-openai"));

        // Form posted back untouched: keys survive.
        let back = ui.clone().merged_over(&stored);
        assert_eq!(back.anthropic_key, "sk-ant-secret");
        assert_eq!(back.openai_key, "sk-openai");
        // One key replaced, one cleared.
        let edit = ProvidersConfig {
            gemini_key: "g-new".into(),
            openai_key: String::new(),
            ..ui
        }
        .merged_over(&stored);
        assert_eq!(edit.gemini_key, "g-new");
        assert_eq!(edit.openai_key, "");
        assert_eq!(edit.anthropic_key, "sk-ant-secret");
    }

    #[cfg(unix)]
    #[test]
    fn write_private_is_owner_only_and_atomic() {
        use std::os::unix::fs::PermissionsExt;
        let d = std::env::temp_dir().join(format!("dxtutor-wp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let p = d.join("sub/keys.json");
        write_private(&p, b"one").unwrap();
        write_private(&p, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two");
        assert_eq!(
            std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::read_dir(p.parent().unwrap()).unwrap().count(),
            1,
            "no temp left behind"
        );
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Live end-to-end validation of the P4 streaming path against a running Ollama.
    /// Proves tokens actually stream in and cancellation stops the read. Requires a
    /// local Ollama with a model; run with:
    ///   cargo test -p tutor-llm --lib ollama_stream -- --ignored
    #[test]
    #[ignore = "requires a running Ollama with a model"]
    fn ollama_stream_live_and_cancel() {
        let models = ollama_models();
        assert!(!models.is_empty(), "no local Ollama model to test against");

        // Streaming: at least one chunk arrives and the full reply is non-empty.
        let mut chunks = 0usize;
        let reply = ollama_chat_stream(
            &[ChatMsg {
                role: "user".into(),
                content: "Reply with exactly the word: hi".into(),
            }],
            None,
            |_delta| {
                chunks += 1;
                true
            },
        )
        .expect("stream should succeed");
        assert!(chunks >= 1, "expected at least one streamed chunk");
        assert!(!reply.content.trim().is_empty(), "reply was empty");
        assert_eq!(reply.provider, "ollama");

        // Cancellation: returning false from on_delta must stop the stream cleanly.
        let mut seen = 0usize;
        let partial = ollama_chat_stream(
            &[ChatMsg {
                role: "user".into(),
                content: "Count slowly from 1 to 100, one number per line.".into(),
            }],
            None,
            |_delta| {
                seen += 1;
                seen < 2 // cancel right after the first chunk
            },
        )
        .expect("cancelled stream should still return Ok");
        assert!(
            seen <= 2,
            "cancellation should stop the read almost immediately"
        );
        let _ = partial; // partial content is fine; we only assert it did not hang/err
    }

    /// Live validation of the Claude SSE adapter. Skips cleanly when no key is set, so
    /// it is safe in CI. Run it in a shell that has ANTHROPIC_API_KEY exported:
    ///   cargo test -p tutor-llm --lib claude_stream -- --ignored --nocapture
    #[test]
    #[ignore = "requires ANTHROPIC_API_KEY exported in the environment"]
    fn claude_stream_live() {
        if std::env::var("ANTHROPIC_API_KEY")
            .map(|v| v.is_empty())
            .unwrap_or(true)
        {
            eprintln!("SKIP: ANTHROPIC_API_KEY not set in this environment.");
            return;
        }
        let mut chunks = 0usize;
        let reply = claude_chat_stream_env(
            &[ChatMsg {
                role: "user".into(),
                content: "Reply with exactly the word: hi".into(),
            }],
            None,
            |_delta| {
                chunks += 1;
                true
            },
        )
        .expect("Claude stream should succeed with a valid key");
        assert!(
            chunks >= 1,
            "expected at least one streamed chunk from Claude"
        );
        assert!(!reply.content.trim().is_empty(), "Claude reply was empty");
        assert_eq!(reply.provider, "claude");
        eprintln!(
            "Claude replied ({}): {:?}",
            reply.model,
            reply.content.trim()
        );
    }

    /// Live validation of the Claude SSE adapter via the SAVED config (the exact path
    /// the Dev Assistant takes), not the env. Skips cleanly when no key is configured.
    /// Run it with:
    ///   cargo test -p tutor-llm --lib claude_stream_live_config -- --ignored --nocapture
    #[test]
    #[ignore = "requires a configured Anthropic key in ~/.config/dxtutor/providers.json"]
    fn claude_stream_live_config() {
        let cfg = load_config();
        if cfg_or_env(&cfg.anthropic_key, &["ANTHROPIC_API_KEY"]).is_none() {
            eprintln!("SKIP: no Anthropic key configured.");
            return;
        }
        let mut chunks = 0usize;
        let reply = claude_chat_stream_env(
            &[ChatMsg {
                role: "user".into(),
                content: "Reply with exactly the word: hi".into(),
            }],
            None,
            |_delta| {
                chunks += 1;
                true
            },
        )
        .expect("Claude stream (config) should succeed with a valid configured key");
        assert!(
            chunks >= 1,
            "expected at least one streamed chunk from Claude"
        );
        assert!(!reply.content.trim().is_empty(), "Claude reply was empty");
        assert_eq!(reply.provider, "claude");
        eprintln!(
            "Claude(config) replied ({}): {:?}",
            reply.model,
            reply.content.trim()
        );
    }

    /// Live validation of the OpenAI SSE adapter via config/env. Skips cleanly with no
    /// key. Run it with:
    ///   cargo test -p tutor-llm --lib openai_stream_live -- --ignored --nocapture
    #[test]
    #[ignore = "requires an OpenAI key (AI settings or OPENAI_API_KEY)"]
    fn openai_stream_live() {
        let cfg = load_config();
        if cfg_or_env(&cfg.openai_key, &["OPENAI_API_KEY"]).is_none() {
            eprintln!("SKIP: no OpenAI key configured.");
            return;
        }
        let mut chunks = 0usize;
        let reply = openai_chat_stream_env(
            &[ChatMsg {
                role: "user".into(),
                content: "Reply with exactly the word: hi".into(),
            }],
            None,
            |_delta| {
                chunks += 1;
                true
            },
        )
        .expect("OpenAI stream should succeed with a valid key");
        assert!(
            chunks >= 1,
            "expected at least one streamed chunk from OpenAI"
        );
        assert!(!reply.content.trim().is_empty(), "OpenAI reply was empty");
        assert_eq!(reply.provider, "openai");
        eprintln!(
            "OpenAI replied ({}): {:?}",
            reply.model,
            reply.content.trim()
        );
    }

    /// Live validation of the Gemini SSE adapter via config/env. Skips cleanly with no
    /// key. Run it with:
    ///   cargo test -p tutor-llm --lib gemini_stream_live -- --ignored --nocapture
    #[test]
    #[ignore = "requires a Gemini key (AI settings or GEMINI_API_KEY)"]
    fn gemini_stream_live() {
        let cfg = load_config();
        if cfg_or_env(&cfg.gemini_key, &["GEMINI_API_KEY", "GOOGLE_API_KEY"]).is_none() {
            eprintln!("SKIP: no Gemini key configured.");
            return;
        }
        let mut chunks = 0usize;
        let reply = gemini_chat_stream_env(
            &[ChatMsg {
                role: "user".into(),
                content: "Reply with exactly the word: hi".into(),
            }],
            None,
            |_delta| {
                chunks += 1;
                true
            },
        )
        .expect("Gemini stream should succeed with a valid key");
        assert!(
            chunks >= 1,
            "expected at least one streamed chunk from Gemini"
        );
        assert!(!reply.content.trim().is_empty(), "Gemini reply was empty");
        assert_eq!(reply.provider, "gemini");
        eprintln!(
            "Gemini replied ({}): {:?}",
            reply.model,
            reply.content.trim()
        );
    }
}
