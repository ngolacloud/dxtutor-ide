//! Caso de uso «rever código» — **independente de Tauri** (Etapa 3).
//!
//! O comando IPC `review_code` tinha embutida uma regra (traduzir o selector de
//! escopo da UI — `"file"`/`"changes"`/`"project"` — num [`ReviewScope`] tipado,
//! rejeitando `"file"` sem caminho) antes de delegar ao motor offline
//! [`tutor_eval::review::review`]. Essa regra sai aqui, para um caso de uso que não
//! conhece o `spawn_blocking` nem o mapeamento de erro → `String`: fala em variantes
//! ([`ReviewError`]) e deixa a fronteira IPC (`commands::review`) ser um adaptador
//! fino, exactamente como `workspace::open_workspace` ↔ `bridge::load_workspace`.
//!
//! `detect_analyzers` e `verify_fix` já são Tauri-free no próprio `tutor_eval`; os
//! seus comandos são passagens directas e não precisam de uma camada aqui.

use std::path::Path;
use tutor_eval::review::{review, ReviewReport, ReviewScope};

/// Erro tipado do caso de uso. A fronteira IPC ainda o mapeia para `String`, mas o
/// caso de uso distingue a regra violada (escopo) do fracasso da análise. O `Display`
/// mantém estáveis as mensagens históricas que a UI já observava.
#[derive(Debug)]
pub enum ReviewError {
    /// Escopo `"file"` pedido sem o caminho que precisa.
    FileScopeNeedsPath,
    /// A passagem de análise falhou (motor offline / E/S).
    Analysis(String),
}

impl std::fmt::Display for ReviewError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Mensagens históricas do comando `review_code`, estáveis na UI.
            ReviewError::FileScopeNeedsPath => write!(f, "file scope needs a path"),
            ReviewError::Analysis(e) => write!(f, "review failed: {e}"),
        }
    }
}

impl std::error::Error for ReviewError {}

/// Traduz o selector de escopo da UI num [`ReviewScope`] tipado. `"file"` exige um
/// caminho; qualquer valor desconhecido cai no projecto inteiro (comportamento
/// histórico — fail-open para o escopo mais largo, nunca um erro).
pub fn parse_scope(scope: &str, path: Option<String>) -> Result<ReviewScope, ReviewError> {
    Ok(match scope {
        "file" => ReviewScope::File(path.ok_or(ReviewError::FileScopeNeedsPath)?),
        "changes" => ReviewScope::WorkingChanges,
        _ => ReviewScope::Project,
    })
}

/// Caso de uso «rever código» — aplica a regra de escopo e delega o trabalho pesado
/// (correr os analisadores locais sobre ficheiros reais) a [`tutor_eval::review::review`],
/// o mecanismo intocado. `version` é devolvido tal-e-qual para a UI descartar um
/// resultado obsoleto. O comando `commands::review::review_code` é só o adaptador
/// fino que corre isto em `spawn_blocking` e mapeia `ReviewError` → `String`.
pub fn run_review(
    root: &Path,
    scope: &str,
    path: Option<String>,
    version: Option<String>,
) -> Result<ReviewReport, ReviewError> {
    let scope = parse_scope(scope, path)?;
    review(root, &scope, version).map_err(|e| ReviewError::Analysis(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_eval::review::ReviewScope;

    #[test]
    fn parse_scope_maps_the_ui_selector() {
        assert!(matches!(
            parse_scope("file", Some("src/main.rs".into())).unwrap(),
            ReviewScope::File(p) if p == "src/main.rs"
        ));
        assert!(matches!(
            parse_scope("changes", None).unwrap(),
            ReviewScope::WorkingChanges
        ));
        // Desconhecido → projecto inteiro (fail-open histórico), sem erro.
        assert!(matches!(parse_scope("whatever", None).unwrap(), ReviewScope::Project));
    }

    #[test]
    fn file_scope_without_path_is_a_typed_error() {
        let err = parse_scope("file", None).unwrap_err();
        assert!(matches!(err, ReviewError::FileScopeNeedsPath));
        // Mensagem histórica preservada para a UI.
        assert_eq!(err.to_string(), "file scope needs a path");
    }

    #[test]
    fn run_review_rejects_file_scope_without_path_before_touching_disk() {
        // Caminho inexistente: se a regra de escopo não cortasse primeiro, a análise
        // é que falharia. Prova que a regra corre antes do mecanismo.
        let err = run_review(Path::new("/nonexistent"), "file", None, None).unwrap_err();
        assert!(matches!(err, ReviewError::FileScopeNeedsPath));
    }

    #[test]
    fn analysis_error_wears_the_historical_prefix() {
        let err = ReviewError::Analysis("boom".into());
        assert_eq!(err.to_string(), "review failed: boom");
    }
}
