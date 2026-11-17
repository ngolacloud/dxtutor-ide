//! Teste integrado da fatia «assistant / providers» (Etapa 3 — grupo assistant).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a fachada Tauri-free da fatia
//! (`assistant::*`) — a mesma fronteira que os comandos Tauri (`assistant_models`,
//! `assistant_chat`, `list_providers`, `get_providers_config`, `save_providers_config`,
//! `assistant_chat_stream`, `assistant_cancel`, `get_diagnostics`) atravessam, sem o
//! runtime Tauri. Prova que a fatia liga: a regra da preparação do stream (política de
//! estudo + validação de provider, erro tipado), o registo de cancelamento e o mapeamento
//! de diagnósticos → DTOs tipados, com o comportamento preservado da versão em `lib.rs`.
//!
//! Não bate na rede: usa só a preparação/validação (offline) e o runner de diagnósticos JS
//! (motor embebido). O `run_stream`/`ollama_chat` reais fariam HTTP — não se exercitam aqui.

use dxtutor_ide_lib::assistant::{self, ChatMsg, StreamError};
use std::sync::atomic::Ordering;

fn msg(role: &str, content: &str) -> ChatMsg {
    ChatMsg {
        role: role.into(),
        content: content.into(),
    }
}

#[test]
fn study_mode_prepends_tutor_directive_and_validates_provider() {
    // Modo estudo + passo autónomo → chat tutor-constrained: entra uma system no topo e o
    // provider válido resolve-se em minúsculas.
    let prep = assistant::prepare_stream(
        Some("study"),
        true,
        vec![msg("user", "dá-me a solução")],
        Some("claude"),
    )
    .expect("claude tem adaptador SSE");
    assert_eq!(prep.provider, "claude");
    assert_eq!(prep.messages.len(), 2, "a directiva de tutor foi prepended");
    assert_eq!(prep.messages[0].role, "system");
    assert_eq!(prep.messages[1].content, "dá-me a solução");

    // Omisso → ollama; modo project (não tutor-constrained) não prepende nada.
    let open = assistant::prepare_stream(Some("project"), true, vec![msg("user", "oi")], None)
        .expect("omisso → ollama");
    assert_eq!(open.provider, "ollama");
    assert_eq!(open.messages.len(), 1);
}

#[test]
fn unsupported_provider_is_a_typed_error_with_the_historical_message() {
    let err = assistant::prepare_stream(Some("codev"), true, vec![msg("user", "x")], Some("grok"))
        .expect_err("grok não tem adaptador SSE");
    match &err {
        StreamError::UnsupportedProvider(p) => assert_eq!(p, "grok"),
    }
    // A string exacta que o evento `llm://error` carregava no `lib.rs`.
    assert_eq!(
        err.to_string(),
        "The “grok” provider has no streaming adapter yet. Use Ollama, Claude, OpenAI or Gemini."
    );
}

#[test]
fn cancel_registry_registers_flags_and_cancels_by_id() {
    let id = "req-assistant-integ-77";
    let flag = assistant::register_cancel(id);
    assert!(!flag.load(Ordering::Relaxed), "nasce não-cancelada");
    assistant::cancel(id);
    assert!(flag.load(Ordering::Relaxed), "cancel() põe a flag a true");
    assistant::remove_cancel(id);
    // Removida: cancelar um id desconhecido é no-op (não entra em pânico).
    assistant::cancel(id);
}

#[test]
fn diagnostics_maps_js_runner_output_to_dtos() {
    // JS é o runner offline/rápido (motor embebido): código partido → ≥1 diagnóstico com
    // severidade de string bem-formada; código válido → vazio.
    let broken = assistant::diagnostics("js", "let x = ;").expect("runner JS corre offline");
    assert!(!broken.is_empty(), "JS inválido produz diagnóstico");
    for d in &broken {
        assert!(
            d.severity == "error" || d.severity == "warning",
            "severidade bem-formada, veio {:?}",
            d.severity
        );
    }

    let clean = assistant::diagnostics("js", "const x = 1;").expect("runner JS corre offline");
    assert!(clean.is_empty(), "JS válido não tem diagnósticos, veio {clean:?}");
}
