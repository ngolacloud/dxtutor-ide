//! Comandos IPC do Dev-Assistant / providers — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::assistant`.
//!
//! Nenhuma regra de negócio vive aqui. `assistant_models`/`list_providers`/
//! `get_providers_config`/`save_providers_config`/`get_diagnostics` são passagens ao caso
//! de uso. `assistant_chat` veste o `spawn_blocking` (o HTTP bloqueante nunca trava a
//! janela) e o prefixo histórico `"assistant task failed: …"`. `assistant_chat_stream`
//! fica dono do que é **infra Tauri** — a emissão dos eventos `llm://token|done|error` e a
//! thread — enquanto a *regra* (política de estudo + validação do provider) e o *dispatch*
//! do adaptador SSE ficam no caso de uso; `assistant_cancel` encaminha para o registo de
//! cancelamento. Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3 — mesmos
//! nomes, args, contratos serde, eventos e mensagens.

use crate::assistant::{self, ChatMsg, ChatReply, Diagnostic, ProviderInfo, ProvidersConfig};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};

/// Dev Assistant: the locally-available Ollama models (empty if none/offline).
#[tauri::command]
pub async fn assistant_models() -> Vec<String> {
    assistant::ollama_models()
}

/// Dev Assistant: send a chat turn to the local model (Ollama) and return the reply.
/// Non-streaming; runs off the UI thread because the HTTP call is blocking.
#[tauri::command]
pub async fn assistant_chat(
    messages: Vec<ChatMsg>,
    model: Option<String>,
) -> Result<ChatReply, String> {
    tauri::async_runtime::spawn_blocking(move || {
        assistant::ollama_chat(&messages, model.as_deref())
    })
    .await
    .map_err(|e| format!("assistant task failed: {e}"))?
}

/// The AI providers and what each can do right now (Ollama live; others gated).
#[tauri::command]
pub async fn list_providers() -> Vec<ProviderInfo> {
    assistant::list_providers()
}

/// The saved AI/provider settings for the settings form — keys come back masked.
#[tauri::command]
pub async fn get_providers_config() -> ProvidersConfig {
    assistant::load_config()
}

/// Persist AI/provider settings to `~/.config/dxtutor/providers.json` (mode 0600).
#[tauri::command]
pub async fn save_providers_config(config: ProvidersConfig) -> Result<(), String> {
    assistant::save_config(&config)
}

/// Compiler/syntax diagnostics for the current code — the raw material for the red
/// underline. The runner is chosen by the phase's language (Rust via `cargo check`, JS via
/// the embedded engine). Never judges the exercise.
#[tauri::command]
pub async fn get_diagnostics(step_id: String, code: String) -> Result<Vec<Diagnostic>, String> {
    let language = crate::study::step_language(&step_id);
    assistant::diagnostics(&language, &code)
}

/// Stream a Dev-Assistant chat turn. Emits `llm://token` {requestId, delta} per token
/// chunk, then `llm://done` {requestId, model, inputTokens, outputTokens} (the usage the
/// provider reported; 0 when none) or `llm://error` {requestId, error}.
/// Returns immediately; the stream runs on a thread (the pty.rs pattern). Cancel it
/// mid-flight with `assistant_cancel(requestId)` — the Stop button.
#[tauri::command]
pub fn assistant_chat_stream(
    app: tauri::AppHandle,
    messages: Vec<ChatMsg>,
    provider: Option<String>,
    model: Option<String>,
    request_id: String,
    mode: Option<String>,
    step_id: Option<String>,
) {
    // P0-2: o backend — não a webview — decide a política a partir do modo + passo activos.
    // A regra (política de estudo + validação do provider) vive no caso de uso; aqui só se
    // resolve se o passo é autónomo (lookup de curso, em `crate::study`) e se emitem os
    // eventos Tauri.
    let is_autonomous = crate::study::step_is_autonomous(step_id.as_deref());
    let prep = match assistant::prepare_stream(
        mode.as_deref(),
        is_autonomous,
        messages,
        provider.as_deref(),
    ) {
        Ok(prep) => prep,
        Err(e) => {
            // Provider sem adaptador SSE: falha honesta pelo canal de erro, como antes.
            let _ = app.emit(
                "llm://error",
                serde_json::json!({ "requestId": request_id, "error": e.to_string() }),
            );
            return;
        }
    };

    let flag = assistant::register_cancel(&request_id);
    std::thread::spawn(move || {
        let emit_app = app.clone();
        let rid = request_id.clone();
        // One cancel-aware token sink shared by every provider branch.
        let emit = |delta: &str| -> bool {
            if flag.load(Ordering::Relaxed) {
                return false; // cancelled via the Stop button
            }
            let _ = emit_app.emit(
                "llm://token",
                serde_json::json!({ "requestId": rid, "delta": delta }),
            );
            true
        };
        // The model-call policy decides here, off the UI thread (it reads files): a refused
        // provider never streams; the gateway's URL and key come from the policy.
        let gateway = (|| -> Result<Option<(tutor_llm::gateway::GatewaySpec, String)>, String> {
            if prep.provider == "gateway" {
                let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
                return crate::llm_policy::gateway_with_key(&dir, None).map(Some);
            }
            let host = tutor_llm::chat::ollama_host();
            crate::llm_policy::check(&prep.provider, Some(&host), None).map(|_| None)
        })();
        let res = match &gateway {
            Err(e) => Err(e.clone()),
            Ok(gw) => assistant::run_stream(
                &prep.provider,
                &prep.messages,
                model.as_deref(),
                gw.as_ref().map(|(g, k)| (g, k.as_str())),
                emit,
            ),
        };
        assistant::remove_cancel(&request_id);
        match res {
            Ok(reply) => {
                let _ = app.emit(
                    "llm://done",
                    serde_json::json!({ "requestId": request_id, "model": reply.model, "inputTokens": reply.input_tokens, "outputTokens": reply.output_tokens }),
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "llm://error",
                    serde_json::json!({ "requestId": request_id, "error": format!("{e}") }),
                );
            }
        }
    });
}

/// Cancel an in-flight streaming request (the Stop button / interrupt).
#[tauri::command]
pub fn assistant_cancel(request_id: String) {
    assistant::cancel(&request_id);
}
