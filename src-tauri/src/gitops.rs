//! Caso de uso «SCM / git» — **independente de Tauri** (Etapa 3).
//!
//! Os treze comandos `git_*` de `lib.rs` eram adaptadores finos sobre o *mecanismo*
//! de disco (`tutor_eval::git`, intocado) mas traziam, embutidas no `#[tauri::command]`,
//! algumas **regras** que não são do mecanismo:
//!  - a **página por omissão do histórico** (`git_log` usava o literal `200`);
//!  - o **default de `git_diff`** (sem `staged` → árvore de trabalho vs HEAD);
//!  - e, sobretudo, a forma do **erro**: o git tem DUAS superfícies de falha — a tarefa
//!    bloqueante que nem chega a correr (erro de *join*, com o prefixo histórico
//!    `"git task failed: …"`) e o próprio git que correu e reportou (o seu `stderr`, cru,
//!    sem prefixo, como o `?` sobre o `Result<_, String>` interno já deixava passar).
//!
//! Saem para aqui, num caso de uso que não conhece `spawn_blocking` nem o mapeamento de
//! erro → `String`: fala em [`GitError`] e em contratos nomeados ([`DEFAULT_LOG_LIMIT`]),
//! deixando a fronteira IPC (`commands::git`) ser um adaptador fino, como
//! `review::run_review` ↔ `commands::review`. As operações puramente de leitura e sem
//! regra (`changed_files`/`current_branch`/`show`/`branches`) continuam passagens directas
//! no adaptador — tal como `detect_analyzers` no grupo review — e não ganham camada aqui.

use std::path::Path;
use tutor_eval::git::{self, GitCommit};

/// Número de commits que o histórico (`git_log`) devolve quando o chamador não pede uma
/// contagem. Era o literal `200` dentro do comando; nomeado aqui, a página do histórico
/// passa a ser um contrato e não um número mágico preso no `#[tauri::command]`.
pub const DEFAULT_LOG_LIMIT: usize = 200;

/// Regra de `git_log`: a página pedida, ou [`DEFAULT_LOG_LIMIT`] por omissão.
pub fn log_limit(max: Option<usize>) -> usize {
    max.unwrap_or(DEFAULT_LOG_LIMIT)
}

/// Regra de `git_diff`: sem `staged` explícito, mostra a árvore de trabalho vs HEAD (não o
/// índice) — o default histórico do comando.
pub fn want_staged(staged: Option<bool>) -> bool {
    staged.unwrap_or(false)
}

/// Erro tipado das operações git. Preserva EXACTAMENTE, via `Display`, as duas mensagens
/// que a UI sempre observou: uma falha da tarefa bloqueante mantém o prefixo histórico
/// `"git task failed: …"`; uma falha do próprio git passa o seu `stderr` cru, sem prefixo
/// (como o `?` sobre o `Result<_, String>` interno fazia antes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitError {
    /// A tarefa bloqueante que correria o git falhou a arrancar/juntar (erro de *join*).
    Task(String),
    /// O git correu e reportou um erro — o seu `stderr`, passado cru.
    Git(String),
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GitError::Task(e) => write!(f, "git task failed: {e}"),
            GitError::Git(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for GitError {}

/// Caso de uso «histórico»: aplica a página por omissão e delega o `git log` ao mecanismo.
/// Infalível ao nível do caso de uso (um repo inexistente devolve histórico vazio), tal
/// como o comando antes.
pub fn history(root: &Path, max: Option<usize>) -> Vec<GitCommit> {
    git::log(root, log_limit(max))
}

/// Caso de uso «diff»: aplica o default de `staged` e delega o unified diff ao mecanismo.
/// Só-leitura; vazio quando não há nada a mostrar ou não é um repo.
pub fn diff(root: &Path, file: Option<&str>, staged: Option<bool>) -> String {
    git::diff(root, file, want_staged(staged))
}

// ── Mutações do índice/HEAD: o mecanismo devolve o `stderr` do git como `String`; o caso
// de uso só o veste de `GitError::Git` (a fronteira decide se o decora). ──────────────────

/// Caso de uso «stage»: adiciona `path` ao índice.
pub fn stage(root: &Path, path: &str) -> Result<(), GitError> {
    git::stage(root, path).map_err(GitError::Git)
}

/// Caso de uso «unstage»: retira `path` do índice.
pub fn unstage(root: &Path, path: &str) -> Result<(), GitError> {
    git::unstage(root, path).map_err(GitError::Git)
}

/// Caso de uso «stage all»: adiciona todas as alterações ao índice.
pub fn stage_all(root: &Path) -> Result<(), GitError> {
    git::stage_all(root).map_err(GitError::Git)
}

/// Caso de uso «commit»: grava o índice com `message`.
pub fn commit(root: &Path, message: &str) -> Result<(), GitError> {
    git::commit(root, message).map_err(GitError::Git)
}

/// Caso de uso «checkout»: muda para `branch`.
pub fn checkout(root: &Path, branch: &str) -> Result<(), GitError> {
    git::checkout(root, branch).map_err(GitError::Git)
}

/// Caso de uso «create branch»: cria (e muda para) o ramo `name`.
pub fn create_branch(root: &Path, name: &str) -> Result<(), GitError> {
    git::create_branch(root, name).map_err(GitError::Git)
}

/// Caso de uso «clone»: clona `url` para dentro de `parent_dir` e devolve o caminho do
/// novo repo como `String` (a tradução `PathBuf` → `String` que o comando fazia), para o
/// workspace o poder montar.
/// Caso de uso «planear o clone» (r23 F6): o comando exacto e a pasta, antes da aprovação.
pub fn clone_plan(url: &str, parent_dir: &Path) -> Result<git::ClonePlan, GitError> {
    git::clone_plan(url, parent_dir).map_err(GitError::Git)
}

pub fn clone(url: &str, parent_dir: &Path) -> Result<String, GitError> {
    git::clone_repo(url, parent_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(GitError::Git)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_limit_defaults_to_the_public_page_size() {
        assert_eq!(log_limit(None), DEFAULT_LOG_LIMIT);
        assert_eq!(
            DEFAULT_LOG_LIMIT, 200,
            "página por omissão = contrato histórico"
        );
        assert_eq!(
            log_limit(Some(5)),
            5,
            "uma página explícita ganha ao default"
        );
    }

    #[test]
    fn want_staged_defaults_to_the_working_tree() {
        assert!(
            !want_staged(None),
            "sem staged → árvore de trabalho vs HEAD"
        );
        assert!(want_staged(Some(true)));
        assert!(!want_staged(Some(false)));
    }

    #[test]
    fn git_error_task_wears_the_historical_prefix() {
        // A falha da tarefa bloqueante manteve sempre este prefixo na UI.
        let err = GitError::Task("boom".into());
        assert_eq!(err.to_string(), "git task failed: boom");
    }

    #[test]
    fn git_error_git_passes_stderr_through_verbatim() {
        // O erro do próprio git passa cru — o `Display` não o decora, como o `?` antes.
        let err = GitError::Git("fatal: not a git repository".into());
        assert_eq!(err.to_string(), "fatal: not a git repository");
    }
}
