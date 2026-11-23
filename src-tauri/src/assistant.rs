//! Caso de uso Tauri-free do **Dev-Assistant / providers** (Etapa 3 da reorg).
//!
//! Reúne, sem depender de `tauri`, tudo o que o grupo de comandos `assistant`
//! precisava de decidir:
//!
//! - **Passagens de providers/config** (`ollama_models`/`list_providers`/`load_config`/
//!   `save_config`/`ollama_chat`) — fachada única sobre `tutor_llm::chat`, para `lib.rs`
//!   deixar de lhe tocar directamente e o crate de teste atravessar `crate::assistant`.
//! - **Diagnósticos** (`diagnostics`) — a *regra* que vivia no `#[tauri::command]`:
//!   correr `tutor_eval::diagnostics_for` e mapear para o DTO [`Diagnostic`] (string de
//!   severidade + sugestão offline de `advise`). Tauri-free já era.
//! - **Preparação do stream** (`prepare_stream`) — a *regra* central: aplica a política de
//!   estudo (prepende a directiva de tutor quando `chat_is_tutor`) e **valida o provider**
//!   (só `ollama|claude|openai|gemini` têm adaptador SSE), com erro tipado
//!   [`StreamError`] cujo `Display` reproduz a mensagem histórica. A emissão de eventos
//!   Tauri fica no adaptador.
//! - **Dispatch do stream** (`run_stream`) — escolhe o adaptador SSE do provider e aplana
//!   o erro → `String`. Genérico sobre o sink `FnMut(&str) -> bool` (o `emit` do adaptador
//!   captura a `Window`; aqui é Tauri-free).
//! - **Registo de cancelamento** (`register_cancel`/`remove_cancel`/`cancel`) —
//!   orquestração pura do estado partilhado das streams em voo (como o registo de tarefas
//!   de `crate::agent`), tirado dos estáticos de `lib.rs`.
//!
//! Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

// Fachada da fatia: o crate de teste (`src-tauri/tests/`) só vê `dxtutor_ide_lib`, não
// `tutor_llm`; re-exportamos os tipos do contrato para ele construir/inspeccionar structs
// sem tocar nos crates internos.
pub use tutor_llm::chat::{ChatMsg, ChatReply, ProviderInfo, ProvidersConfig};

// ── Providers / config — passagens finas sobre `tutor_llm::chat` ─────────────────────

/// Os modelos Ollama disponíveis localmente (vazio se nenhum/offline).
pub fn ollama_models() -> Vec<String> {
    tutor_llm::chat::ollama_models()
}

/// Uma volta de chat não-streaming contra o modelo local (Ollama). Erro → `String`.
pub fn ollama_chat(messages: &[ChatMsg], model: Option<&str>) -> Result<ChatReply, String> {
    tutor_llm::chat::ollama_chat(messages, model).map_err(|e| format!("{e}"))
}

/// Os providers de IA e o que cada um sabe fazer agora (Ollama ao vivo; outros gated).
pub fn list_providers() -> Vec<ProviderInfo> {
    tutor_llm::chat::list_providers()
}

/// As definições de IA/providers para o formulário, com cada chave guardada substituída
/// por `KEY_MASK`: o webview sabe que chaves existem, nunca os seus valores (regra de
/// segurança — quem precisa da chave real lê `tutor_llm::chat::load_config` no backend).
pub fn load_config() -> ProvidersConfig {
    tutor_llm::chat::load_config().redacted()
}

/// Persiste as definições de IA/providers em `~/.config/dxtutor/providers.json` (0600).
/// Chaves que o formulário devolve ainda mascaradas mantêm o valor guardado.
pub fn save_config(config: &ProvidersConfig) -> Result<(), String> {
    let merged = config.clone().merged_over(&tutor_llm::chat::load_config());
    tutor_llm::chat::save_config(&merged).map_err(|e| format!("{e}"))
}

// ── Diagnósticos — regra de mapeamento para o DTO ────────────────────────────────────

/// Diagnóstico de compilador/sintaxe para o editor — o material cru do sublinhado
/// vermelho. `suggestion` é a correcção offline baseada em regras (sem IA); `None` quando
/// nenhuma regra bateu.
#[derive(Debug, Serialize)]
pub struct Diagnostic {
    pub line: u32,
    pub col: u32,
    pub severity: String,
    pub message: String,
    pub suggestion: Option<String>,
}

/// Corre o runner da linguagem sobre o código e devolve os diagnósticos já no DTO. Nunca
/// julga o exercício. Erro de execução do runner → `String`.
pub fn diagnostics(language: &str, code: &str) -> Result<Vec<Diagnostic>, String> {
    let diags = tutor_eval::diagnostics_for(language, code)
        .map_err(|e| format!("diagnostics failed: {e}"))?;
    Ok(diags
        .into_iter()
        .map(|d| Diagnostic {
            line: d.line,
            col: d.col,
            severity: match d.severity {
                tutor_eval::Severity::Error => "error",
                tutor_eval::Severity::Warning => "warning",
            }
            .to_string(),
            // Sugestão interna baseada em regras — funciona offline, sem IA.
            suggestion: tutor_eval::advise(language, &d),
            message: d.message,
        })
        .collect())
}

// ── Preparação + dispatch do stream ──────────────────────────────────────────────────

/// Os providers com adaptador de streaming SSE. Qualquer outro id falha honestamente em
/// vez de ficar calado.
const STREAMING_PROVIDERS: [&str; 4] = ["ollama", "claude", "openai", "gemini"];

/// Erro tipado da preparação do stream. O `Display` reproduz **exactamente** a mensagem
/// histórica que o `#[tauri::command]` emitia no evento `llm://error`.
#[derive(Debug)]
pub enum StreamError {
    /// O provider pedido não tem adaptador de streaming (fica o id cru para a mensagem).
    UnsupportedProvider(String),
}

impl std::fmt::Display for StreamError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StreamError::UnsupportedProvider(prov) => write!(
                f,
                "The “{prov}” provider has no streaming adapter yet. Use Ollama, Claude, OpenAI or Gemini."
            ),
        }
    }
}

/// O que o adaptador precisa para abrir o stream: a lista de mensagens já com a política
/// aplicada e o provider resolvido (minúsculas, validado).
#[derive(Debug)]
pub struct StreamPrep {
    pub messages: Vec<ChatMsg>,
    pub provider: String,
}

/// Aplica a política de estudo e valida o provider. Em modo tutor-constrained prepende a
/// directiva autoritativa de tutor (camada soft: afasta qualquer provider de entregar a
/// solução). `provider` omisso → `"ollama"`. Erro tipado se o provider não tiver adaptador.
pub fn prepare_stream(
    mode: Option<&str>,
    is_autonomous: bool,
    messages: Vec<ChatMsg>,
    provider: Option<&str>,
) -> Result<StreamPrep, StreamError> {
    use tutor_llm::policy::{policy_for, tutor_directive, Mode};

    let policy = policy_for(Mode::parse(mode.unwrap_or("study")), is_autonomous);
    let messages: Vec<ChatMsg> = if policy.chat_is_tutor {
        let mut m = Vec::with_capacity(messages.len() + 1);
        m.push(ChatMsg {
            role: "system".into(),
            content: tutor_directive().into(),
        });
        m.extend(messages);
        m
    } else {
        messages
    };

    let prov = provider.unwrap_or("ollama").to_string();
    if !STREAMING_PROVIDERS.contains(&prov.as_str()) {
        return Err(StreamError::UnsupportedProvider(prov));
    }
    Ok(StreamPrep {
        messages,
        provider: prov,
    })
}

/// Corre o adaptador SSE do provider resolvido, encaminhando cada token para `on_delta`
/// (devolve `false` para cancelar). Aplana o erro → `String`. Assume `provider` já validado
/// por [`prepare_stream`]; um id não-streaming cai no ramo Ollama (histórico).
pub fn run_stream(
    provider: &str,
    messages: &[ChatMsg],
    model: Option<&str>,
    on_delta: impl FnMut(&str) -> bool,
) -> Result<ChatReply, String> {
    let res = match provider {
        "claude" => tutor_llm::chat::claude_chat_stream_env(messages, model, on_delta),
        "openai" => tutor_llm::chat::openai_chat_stream_env(messages, model, on_delta),
        "gemini" => tutor_llm::chat::gemini_chat_stream_env(messages, model, on_delta),
        _ => tutor_llm::chat::ollama_chat_stream(messages, model, on_delta),
    };
    res.map_err(|e| format!("{e}"))
}

// ── Registo de cancelamento das streams em voo (orquestração pura) ───────────────────

/// Flags de cancelamento das streams LLM em voo, indexadas por request id.
static LLM_CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    LLM_CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Regista uma stream em voo e devolve a sua flag partilhada (`false` = continua). O
/// adaptador consulta-a dentro do sink de tokens; [`cancel`] põe-na a `true`.
pub fn register_cancel(request_id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    cancels()
        .lock()
        .unwrap()
        .insert(request_id.to_string(), flag.clone());
    flag
}

/// Esquece a stream (ao terminar/falhar). Idempotente.
pub fn remove_cancel(request_id: &str) {
    cancels().lock().unwrap().remove(request_id);
}

/// Cancela uma stream em voo (o botão Stop / interrupção). Sem efeito se o id for
/// desconhecido.
pub fn cancel(request_id: &str) {
    if let Some(flag) = cancels().lock().unwrap().get(request_id) {
        flag.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(role: &str, content: &str) -> ChatMsg {
        ChatMsg {
            role: role.into(),
            content: content.into(),
        }
    }

    #[test]
    fn study_mode_prepends_the_tutor_directive() {
        // Modo estudo + passo autónomo → chat tutor-constrained: entra uma system no topo.
        let prep = prepare_stream(
            Some("study"),
            true,
            vec![msg("user", "resolve-me isto")],
            Some("ollama"),
        )
        .expect("ollama é válido");
        assert_eq!(prep.provider, "ollama");
        assert_eq!(prep.messages.len(), 2);
        assert_eq!(prep.messages[0].role, "system");
        assert_eq!(prep.messages[1].content, "resolve-me isto");
    }

    #[test]
    fn project_mode_leaves_the_messages_untouched() {
        // Modo project (não tutor-constrained, `Mode::Project`) → mensagens intactas, sem
        // system prepended.
        let prep = prepare_stream(
            Some("project"),
            true,
            vec![msg("user", "olá")],
            Some("claude"),
        )
        .expect("claude é válido");
        assert_eq!(prep.provider, "claude");
        assert_eq!(prep.messages.len(), 1);
        assert_eq!(prep.messages[0].role, "user");
    }

    #[test]
    fn missing_provider_defaults_to_ollama() {
        let prep = prepare_stream(Some("project"), true, vec![msg("user", "x")], None)
            .expect("omisso → ollama");
        assert_eq!(prep.provider, "ollama");
    }

    #[test]
    fn unsupported_provider_is_a_typed_error_with_the_historical_message() {
        let err = prepare_stream(Some("project"), true, vec![msg("user", "x")], Some("grok"))
            .expect_err("grok não tem adaptador");
        match &err {
            StreamError::UnsupportedProvider(p) => assert_eq!(p, "grok"),
        }
        // A mensagem exacta que o evento llm://error carregava.
        assert_eq!(
            err.to_string(),
            "The “grok” provider has no streaming adapter yet. Use Ollama, Claude, OpenAI or Gemini."
        );
    }

    #[test]
    fn cancel_registry_registers_flags_and_cancels_by_id() {
        let id = "req-assistant-test-001";
        let flag = register_cancel(id);
        assert!(!flag.load(Ordering::Relaxed), "nasce não-cancelada");
        cancel(id);
        assert!(flag.load(Ordering::Relaxed), "cancel() põe a flag a true");
        remove_cancel(id);
        // Depois de removida, cancelar um id desconhecido é um no-op (não entra em pânico).
        cancel(id);
    }

    #[test]
    fn diagnostics_maps_broken_js_to_error_severities() {
        // JS é o runner offline/rápido (motor embebido): código partido → ≥1 diagnóstico,
        // tudo com severidade de string bem-formada.
        let diags = diagnostics("js", "let x = ;").expect("runner JS corre offline");
        assert!(
            !diags.is_empty(),
            "JS sintacticamente inválido dá diagnóstico"
        );
        for d in &diags {
            assert!(
                d.severity == "error" || d.severity == "warning",
                "severidade string bem-formada, veio {:?}",
                d.severity
            );
        }
    }

    #[test]
    fn diagnostics_of_valid_js_is_empty() {
        let diags = diagnostics("js", "const x = 1;").expect("runner JS corre offline");
        assert!(
            diags.is_empty(),
            "JS válido não tem diagnósticos, veio {diags:?}"
        );
    }
}
