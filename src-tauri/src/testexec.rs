//! Caso de uso «correr testes e ficheiros» — **independente de Tauri** (Etapa 3).
//!
//! O grupo de comandos de execução — os testes (`run_test`/`run_all_tests`/
//! `run_tests`/`list_tests`) e o ficheiro do Explorer (`run_path`) — tinha, embutidas
//! nos `#[tauri::command]` de `lib.rs`, três regras que não são do *mecanismo* de
//! execução (compilar/correr, que vive em `tutor_eval`/`crate::fsops`, intocado):
//!  - o **despacho por língua** de `run_test` (`go`/`python`/rust → runner certo);
//!  - a **escolha sessão-de-contentor-vs-host** de `run_tests`, com o erro tipado
//!    «projecto sem comando de teste conhecido» e o DTO do resultado; e
//!  - a **tradução dos argumentos** de `run_path` (string → `argv`).
//!
//! Saem para aqui, num caso de uso que não conhece `spawn_blocking` nem o mapeamento
//! de erro → `String`: fala em variantes ([`TestError`]) e deixa a fronteira IPC
//! (`commands::tests`) ser um adaptador fino, como `review::run_review` ↔
//! `commands::review`. `list_tests`/`run_all_tests` são passagens directas (sem regra)
//! e não ganham camada aqui, tal como `detect_analyzers` no grupo review.

use std::path::Path;
use std::process::Command;
use tutor_eval::testnav::TestRun;

/// Qual toolchain corre um teste individual (`run_test`). A UI manda `lang` como
/// string livre; a regra traduz nas variantes suportadas, com **Rust** como recurso
/// histórico para `None`/desconhecido (o comportamento que `lib.rs` já tinha).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TestLang {
    Rust,
    Go,
    Python,
}

impl TestLang {
    /// Traduz o selector de língua da UI. Desconhecido/`None` → Rust (fail-open histórico).
    pub fn from_ui(lang: Option<&str>) -> Self {
        match lang {
            Some("go") => TestLang::Go,
            Some("python") => TestLang::Python,
            _ => TestLang::Rust,
        }
    }
}

/// Caso de uso «correr um teste»: despacha pela língua e delega ao runner do mecanismo
/// (`tutor_eval::testnav`, intocado). Infalível ao nível do caso de uso — um teste que
/// não corre devolve `TestRun { ran: false, .. }`, exactamente como antes.
pub fn run_one(root: &Path, path: &str, lang: Option<&str>) -> TestRun {
    match TestLang::from_ui(lang) {
        TestLang::Go => tutor_eval::testnav::run_go_test(root, path),
        TestLang::Python => tutor_eval::testnav::run_python_test(root, path),
        TestLang::Rust => tutor_eval::testnav::run_test(root, path),
    }
}

/// Resultado de correr a suite inteira de um projecto (`run_tests`), com o comando que
/// correu — para o passo «verify» do agente citar evidência real (RF-AG-02). O contrato
/// serde (camelCase) é idêntico ao DTO `TestRun` que vivia em `lib.rs`; só o nome do tipo
/// Rust muda (para não colidir com `tutor_eval::testnav::TestRun` no adaptador).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuiteRun {
    pub command: String,
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Erro tipado do caso de uso da suite. A fronteira IPC ainda o mapeia para `String`, mas
/// o caso de uso distingue a regra violada (projecto sem comando) do fracasso da execução.
/// O `Display` mantém estáveis as mensagens históricas que a UI já observava.
#[derive(Debug)]
pub enum TestError {
    /// O projecto não tem um comando de teste conhecido (sem `Cargo.toml`/`go.mod`/…).
    NoTestCommand,
    /// Falha ao arrancar/correr a suite (no host ou na sessão de contentor).
    Exec(String),
}

impl std::fmt::Display for TestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Mensagens históricas do comando `run_tests`, estáveis na UI.
            TestError::NoTestCommand => write!(f, "No known test command for this project."),
            TestError::Exec(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for TestError {}

/// Caso de uso «correr a suite do projecto»: escolhe o comando de teste pelo marcador do
/// projecto e corre-o **dentro da sessão de contentor** quando uma está viva (a sua
/// toolchain), senão **no host**. A escolha é a regra; o `cargo test`/`go test`/… é o
/// mecanismo. Comportamento e mensagens idênticos aos do `run_tests` em `lib.rs`.
pub fn run_project_suite(root: &Path) -> Result<SuiteRun, TestError> {
    let cmd = tutor_eval::project_test_command(root).ok_or(TestError::NoTestCommand)?;
    let name = tutor_eval::session_name(root);
    if tutor_eval::session_running(&name) {
        let out = tutor_eval::session_exec(&name, &format!("cd /work && {cmd}"))
            .map_err(|e| TestError::Exec(e.to_string()))?;
        Ok(SuiteRun {
            command: cmd.into(),
            ok: out.ok,
            stdout: out.stdout,
            stderr: out.stderr,
        })
    } else {
        let out = Command::new("sh")
            .arg("-lc")
            .arg(cmd)
            .current_dir(root)
            .output()
            .map_err(|e| TestError::Exec(format!("could not start tests: {e}")))?;
        Ok(SuiteRun {
            command: cmd.into(),
            ok: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }
}

/// Regra de `run_path`: traduz os argumentos opcionais (uma string como `"add 2 3"`) no
/// `argv` passado ao programa. Divide em espaços em branco; vazio quando não há argumentos
/// — para que uma CLI possa ser realmente exercitada, não só corrida sem argumentos.
pub fn split_args(args: Option<&str>) -> Vec<String> {
    args.unwrap_or_default()
        .split_whitespace()
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lang_maps_the_ui_selector() {
        assert_eq!(TestLang::from_ui(Some("go")), TestLang::Go);
        assert_eq!(TestLang::from_ui(Some("python")), TestLang::Python);
        assert_eq!(TestLang::from_ui(Some("rust")), TestLang::Rust);
        // Desconhecido e ausente caem em Rust (fail-open histórico).
        assert_eq!(TestLang::from_ui(Some("haskell")), TestLang::Rust);
        assert_eq!(TestLang::from_ui(None), TestLang::Rust);
    }

    #[test]
    fn no_test_command_is_a_typed_error_with_the_historical_message() {
        // Pasta sem marcador de projecto → regra corta antes de correr nada.
        let dir = tempfile::tempdir().unwrap();
        let err = run_project_suite(dir.path()).unwrap_err();
        assert!(matches!(err, TestError::NoTestCommand));
        assert_eq!(err.to_string(), "No known test command for this project.");
    }

    #[test]
    fn exec_error_is_passed_through_verbatim() {
        // A fronteira já observava a mensagem crua de execução; o `Display` não a decora.
        let err = TestError::Exec("could not start tests: boom".into());
        assert_eq!(err.to_string(), "could not start tests: boom");
    }

    #[test]
    fn split_args_tokenizes_on_whitespace() {
        assert_eq!(split_args(Some("  add   2 3 ")), vec!["add", "2", "3"]);
        assert!(split_args(None).is_empty());
        assert!(split_args(Some("   ")).is_empty());
    }
}
