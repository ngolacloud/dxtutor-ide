//! Caso de uso «missões» — **independente de Tauri** (Etapa 3, 13º grupo).
//!
//! Os quatro comandos de execução (`run_drill`, `run_measured`, `compile_pipeline`,
//! `trace_execution`) correm programas COMPLETOS e devolvem a saída real + telemetria do
//! kernel / IRs do compilador / trace passo-a-passo. Toda a *regra* de execução já vive em
//! `tutor_eval` (runner, medição `wait4`/`rusage`, pipeline do toolchain, tracer) — por isso
//! os adaptadores (`commands::missions`) são passagens finas sobre essa crate, que já é
//! Tauri-free: fazem `spawn_blocking` (compilar/correr é trabalho bloqueante longo — nunca na
//! thread da janela) e mapeiam o erro → `String` com as mesmas mensagens que `lib.rs` emitia.
//!
//! A única regra que NÃO estava isolada era o **despacho de linguagem** do `run_drill` (Go
//! via `go run`, tudo o resto pelo caminho Rust): extrai-se aqui como [`drill_language`], uma
//! função PURA e testável sem toolchain, para o adaptador decidir o runner sem embutir a
//! regra no `#[tauri::command]`. Os DTOs (`RunDto`, `MeasuredRunDto`, …) ficam em `lib.rs`
//! `pub(crate)`, partilhados como fronteira de serialização para o webview.

/// Qual runner serve um drill, decidido só pela linguagem declarada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrillLang {
    /// Go: compila+corre via `go run` (com `go mod tidy` para resolver imports).
    Go,
    /// Rust (e tudo o resto, por omissão): caminho `rustc`/snippet.
    Rust,
}

/// Classifica a linguagem de um drill no runner a usar. `"go"`/`"golang"`
/// (sem distinção de maiúsculas, tolerante a espaços) → [`DrillLang::Go`]; qualquer outra
/// coisa → [`DrillLang::Rust`] — o mesmo contrato que o `match` que vivia em `lib.rs`.
pub fn drill_language(language: &str) -> DrillLang {
    match language.trim().to_ascii_lowercase().as_str() {
        "go" | "golang" => DrillLang::Go,
        _ => DrillLang::Rust,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drill_language_dispatches_go_vs_rust() {
        assert_eq!(drill_language("go"), DrillLang::Go);
        assert_eq!(drill_language("golang"), DrillLang::Go);
        assert_eq!(drill_language("  GoLang \n"), DrillLang::Go); // trim + case-insensitive
        assert_eq!(drill_language("rust"), DrillLang::Rust);
        assert_eq!(drill_language("python"), DrillLang::Rust); // tudo o resto → Rust
        assert_eq!(drill_language(""), DrillLang::Rust);
    }
}
