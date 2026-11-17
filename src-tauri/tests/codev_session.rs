//! Teste integrado da fatia «Co-Dev» (Etapa 3 — grupo co-dev).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a fachada Tauri-free da fatia
//! (`codev::*`), sobre um repositório git real (tempdir) — a mesma fronteira que os comandos
//! Tauri (`codev_session_start`, `codev_session_list`, `codev_session_discard`) atravessam,
//! sem o runtime Tauri. Prova que a fatia liga: a regra pura (`policy_for_mode`) + o mecanismo
//! de worktrees isoladas (`codev/<slug>`) → DTO tipado, com o comportamento preservado da
//! versão em `lib.rs`.

use dxtutor_ide_lib::codev;
use std::fs;
use std::path::Path;
use std::process::Command;

/// Corre `git <args>` em `root` e aborta o teste se o git falhar — o setup tem de ser
/// determinístico. Configura identidade e desliga assinatura para correr em CI.
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

/// Cria um repo git real com um commit na branch `main`. Devolve o tempdir (mantido vivo
/// pelo chamador).
fn repo_with_one_commit() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    git(root, &["init", "-q", "-b", "main"]);
    git(root, &["config", "user.name", "t"]);
    git(root, &["config", "user.email", "t@t"]);
    git(root, &["config", "commit.gpgsign", "false"]);
    fs::write(root.join("a.txt"), "um\n").unwrap();
    git(root, &["add", "a.txt"]);
    git(root, &["commit", "-qm", "primeiro"]);
    dir
}

/// Ciclo de vida de uma sessão co-dev sobre um repo real: `session_start` abre uma worktree
/// isolada em `codev/<slug>` a partir de HEAD; `sessions` lista-a; `session_discard` remove a
/// worktree e a branch. Prova que a fatia atravessa o mecanismo real pela fachada `codev::*`.
#[test]
fn session_start_list_and_discard_round_trip_over_a_real_repo() {
    let dir = repo_with_one_commit();
    let root = dir.path();

    // Começa sem sessões abertas.
    assert!(codev::sessions(root).is_empty(), "repo acabado de criar não tem sessões");

    let info = codev::session_start(root, "Minha Tarefa").expect("abrir sessão num repo não falha");
    assert_eq!(info.slug, "minha-tarefa", "o nome vira um slug git-ref-safe");
    assert_eq!(info.branch, "codev/minha-tarefa");
    assert_eq!(info.base, "main", "a sessão parte da branch base actual");
    assert!(Path::new(&info.worktree).is_dir(), "a worktree isolada existe em disco");

    let open = codev::sessions(root);
    assert_eq!(open.len(), 1, "a sessão aberta aparece na listagem");
    assert_eq!(open[0].slug, "minha-tarefa");

    codev::session_discard(root, &info.slug).expect("descartar uma sessão aberta não falha");
    assert!(
        codev::sessions(root).is_empty(),
        "depois do discard a worktree e a branch desapareceram"
    );
}

/// `session_start` num directório que não é um repo git → erro (mensagem histórica estável),
/// como o comando observava. Prova o caminho de falha sem runtime Tauri.
#[test]
fn starting_a_session_outside_a_repo_is_an_error() {
    let dir = tempfile::tempdir().unwrap();

    let err = codev::session_start(dir.path(), "x").unwrap_err();
    assert_eq!(err, "not a git repository", "mensagem de erro preservada da versão em lib.rs");
}

/// A regra `policy_for_mode` atravessa a fronteira do crate: a modebar decide o modo, o
/// desconhecido cai no mais estrito, e a garantia destrutivo-pede-sempre mantém-se. (A
/// cobertura fina está nos testes unitários do caso de uso em `codev.rs`.)
#[test]
fn policy_for_mode_is_reachable_and_fails_closed() {
    assert_eq!(codev::policy_for_mode("auto").mode, "auto");
    assert!(codev::policy_for_mode("auto").chains, "auto encadeia passos");
    assert_eq!(codev::policy_for_mode("desconhecido").mode, "manual", "fail-closed");
    assert!(codev::policy_for_mode("auto").destructive_always_asks, "destrutivo pede sempre");
}
