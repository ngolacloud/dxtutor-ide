//! Teste integrado do caso de uso «SCM / git» (Etapa 3 — grupo git).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`gitops::*`), sobre um
//! repositório git real (tempdir) — a mesma fronteira que os comandos Tauri (`git_log`,
//! `git_changes`, `git_commit`, `git_checkout`, …) atravessam, sem o runtime Tauri. Prova
//! que a fatia liga: regra (página por omissão / default de diff / erro tipado) + mecanismo
//! real → DTO tipado / erro tipado, com o comportamento (e as mensagens) preservados da
//! versão em `lib.rs`.

use dxtutor_ide_lib::gitops::{self, GitError};
use std::fs;
use std::path::Path;
use std::process::Command;

/// Corre `git <args>` em `root` e aborta o teste se o git falhar — o setup tem de ser
/// determinístico. Configura identidade e desliga assinatura/hooks para correr em CI.
fn git(root: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .args(args)
        .current_dir(root)
        .env("GIT_AUTHOR_NAME", "t")
        .env("GIT_AUTHOR_EMAIL", "t@t")
        .env("GIT_COMMITTER_NAME", "t")
        .env("GIT_COMMITTER_EMAIL", "t@t")
        .output()
        .expect("git deve estar disponível");
    assert!(
        ok.status.success(),
        "git {:?} falhou: {}",
        args,
        String::from_utf8_lossy(&ok.stderr)
    );
}

/// Cria um repo git real com dois commits numa branch conhecida. Devolve o tempdir (mantido
/// vivo pelo chamador).
fn repo_with_two_commits() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "user.name", "t"]);
    git(root, &["config", "user.email", "t@t"]);
    git(root, &["config", "commit.gpgsign", "false"]);
    fs::write(root.join("a.txt"), "um\n").unwrap();
    git(root, &["add", "a.txt"]);
    git(root, &["commit", "-qm", "primeiro"]);
    fs::write(root.join("b.txt"), "dois\n").unwrap();
    git(root, &["add", "b.txt"]);
    git(root, &["commit", "-qm", "segundo"]);
    dir
}

/// Histórico sobre um repo real: sem página explícita devolve todos os commits (a página por
/// omissão `DEFAULT_LOG_LIMIT` é grande); com `Some(1)` a regra corta a um só. Prova que a
/// página por omissão é aplicada pelo caso de uso, não pelo comando.
#[test]
fn history_applies_the_default_page_and_respects_an_explicit_limit() {
    let dir = repo_with_two_commits();

    let all = gitops::history(dir.path(), None);
    assert_eq!(
        all.len(),
        2,
        "sem limite → os dois commits (dentro da página por omissão)"
    );

    let one = gitops::history(dir.path(), Some(1));
    assert_eq!(one.len(), 1, "página explícita de 1 ganha ao default");
}

/// Mutação + leitura ligam ao mecanismo real: um ficheiro novo aparece como alteração, o
/// `stage` + `commit` do caso de uso gravam-no, e o histórico cresce. Prova o caminho de
/// escrita com erro tipado (que aqui não dispara).
#[test]
fn stage_and_commit_round_trip_over_a_real_repo() {
    let dir = repo_with_two_commits();
    let root = dir.path();
    fs::write(root.join("c.txt"), "tres\n").unwrap();

    let changes = gitops::history(root, None).len();
    gitops::stage(root, "c.txt").expect("stage de um ficheiro novo não falha");
    gitops::commit(root, "terceiro").expect("commit com algo staged não falha");

    assert_eq!(
        gitops::history(root, None).len(),
        changes + 1,
        "o commit do caso de uso entrou no histórico real"
    );
}

/// Falha do próprio git → erro TIPADO (`GitError::Git`) que passa o `stderr` do git CRU, sem
/// prefixo — exactamente a mensagem que a UI observava via o `?` antes da Etapa 3.
#[test]
fn a_bad_checkout_is_a_typed_git_error_carrying_stderr() {
    let dir = repo_with_two_commits();

    let err = gitops::checkout(dir.path(), "nao-existe").unwrap_err();
    assert!(
        matches!(err, GitError::Git(_)),
        "o git correu e reportou — erro tipado Git"
    );
    // O `Display` passa o stderr cru (sem o prefixo de tarefa), como o comando fazia.
    let msg = err.to_string();
    assert!(
        !msg.starts_with("git task failed:"),
        "stderr do git passa sem prefixo: {msg}"
    );
    assert!(!msg.is_empty(), "o stderr do git não é vazio");
}
