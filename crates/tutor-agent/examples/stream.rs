//! Smoke test manual contra a API real — **gasta tokens**; não corre no CI.
//!
//!   cargo run -p tutor-agent --example stream -- "Explica o que é um lexer numa frase."
//!
//! A chave vem de `ANTHROPIC_API_KEY` ou das Definições da IDE
//! (`~/.config/dxtutor/providers.json`). O modelo pode ser trocado com `DXT_MODEL`.

use std::io::Write;

use tutor_agent::anthropic::{self, Anthropic, Config};
use tutor_agent::{Message, Provider, Request, StreamEvent};

fn main() {
    let prompt = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    let prompt = if prompt.trim().is_empty() {
        "Diz olá numa frase curta.".to_string()
    } else {
        prompt
    };
    let key = std::env::var("ANTHROPIC_API_KEY")
        .ok()
        .filter(|k| !k.trim().is_empty())
        .unwrap_or_else(|| tutor_llm::chat::load_config().anthropic_key);
    if key.trim().is_empty() {
        eprintln!("Sem chave: define ANTHROPIC_API_KEY ou guarda-a nas Definições da IDE.");
        std::process::exit(2);
    }
    let model = std::env::var("DXT_MODEL").unwrap_or_else(|_| anthropic::DEFAULT_MODEL.to_string());
    let provider = Anthropic::new(Config::new(key.trim()));
    let req = Request::new(model, vec![Message::user_text(prompt)]);

    let mut out = std::io::stdout();
    let r = provider.stream(&req, &mut |e| {
        match e {
            StreamEvent::ThinkingDelta { text, .. } => {
                let _ = write!(out, "\x1b[2m{text}\x1b[0m");
            }
            StreamEvent::TextDelta { text, .. } => {
                let _ = write!(out, "{text}");
            }
            _ => {}
        }
        let _ = out.flush();
        true
    });
    println!();
    match r {
        Ok(r) => eprintln!(
            "\n— {} · stop={:?} · in={} out={} cache_read={} cache_write={}",
            r.model,
            r.stop_reason,
            r.usage.input_tokens,
            r.usage.output_tokens,
            r.usage.cache_read_input_tokens,
            r.usage.cache_creation_input_tokens
        ),
        Err(e) => {
            eprintln!("\nerro: {e}");
            std::process::exit(1);
        }
    }
}
