//! Teste integrado da fatia «agente / arquitectura» (Etapa 3 — grupo agent).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a fachada Tauri-free da fatia
//! (`agent::*`), sobre ficheiros e um repositório git reais (tempdir) — a mesma fronteira
//! que os comandos Tauri (`arch_validate`/`arch_scaffold`/`arch_scaffold_preview`,
//! `agent_isolated_patch`, `agent_task_submit`/`status`/`cancel`) atravessam, sem o runtime
//! Tauri. Prova que a fatia liga: a regra do scaffold (erro tipado) + o registo de tarefas
//! cloud-shaped sobre o executor isolado real → DTOs tipados, com o comportamento preservado
//! da versão em `lib.rs`.

use dxtutor_ide_lib::agent;
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

/// Um desenho mínimo válido: um serviço que escreve numa store. Construído pelos tipos de
/// arquitectura re-exportados pela fachada `agent::*` (o crate de teste não vê `tutor_eval`).
fn valid_design() -> agent::Architecture {
    agent::Architecture {
        components: vec![
            agent::Component::new("svc", "Svc", agent::Kind::Service),
            agent::Component::new("db", "Db", agent::Kind::Store),
        ],
        connections: vec![agent::Connection::new(
            "svc",
            "db",
            agent::Relation::Writes,
            "",
        )],
        ..Default::default()
    }
}

/// `arch_scaffold` sobre um desenho válido materializa ficheiros num directório real e nunca
/// sobrescreve; um desenho inválido devolve o erro tipado com a mensagem histórica. Prova a
/// regra do scaffold ligada ao disco pela fachada `agent::*`.
#[test]
fn scaffold_writes_a_valid_design_and_rejects_an_invalid_one() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // `validate` e `scaffold_preview` concordam que o desenho é materializável.
    let arch = valid_design();
    assert!(
        !agent::validate(&arch)
            .iter()
            .any(|f| format!("{:?}", f.severity) == "Error"),
        "o desenho de exemplo não tem erros de validação"
    );
    let preview = agent::scaffold_preview(&arch);
    assert!(
        !preview.is_empty(),
        "a pré-visualização não é vazia: {preview:?}"
    );

    let written = agent::scaffold(root, &arch).expect("desenho válido materializa-se");
    assert!(
        written.iter().any(|p| p.ends_with("ARCHITECTURE.md")),
        "escreveu ARCHITECTURE.md: {written:?}"
    );
    assert!(root.join("ARCHITECTURE.md").is_file());

    // Nunca sobrescreve: segunda passagem não escreve nada de novo.
    assert!(
        agent::scaffold(root, &arch).unwrap().is_empty(),
        "nada é reescrito quando já existe"
    );

    // Desenho inválido (ligação a partir de um componente inexistente = dangling-edge) →
    // erro tipado com a mensagem preservada de `lib.rs`.
    let invalid = agent::Architecture {
        connections: vec![agent::Connection::new(
            "ghost",
            "void",
            agent::Relation::Writes,
            "",
        )],
        ..Default::default()
    };
    let err = agent::scaffold(root, &invalid).unwrap_err();
    assert!(matches!(err, agent::ScaffoldError::InvalidDesign));
    assert_eq!(
        err.to_string(),
        "design has errors — fix them before scaffolding"
    );
}

/// Ciclo de vida de uma tarefa cloud-shaped sobre um repo git real: registar como em
/// execução → correr o executor isolado (`worktree_patch`) → `status` devolve `done` com o
/// patch, sem tocar na working tree → `cancel` esquece o registo. Prova a fatia RF-AG-01
/// (consumida por `bridge.ts`) ponta-a-ponta pela fachada `agent::*`.
#[test]
fn task_lifecycle_runs_the_isolated_executor_over_a_real_repo() {
    let dir = repo_with_one_commit();
    let root = dir.path();

    let id = agent::new_task_id();
    agent::register_running(&id);
    assert_eq!(
        agent::status(&id).unwrap().status,
        "running",
        "estado inicial do ciclo"
    );

    // O executor isolado aplica os `writes` numa worktree de HEAD e devolve o diff.
    agent::run_and_store(&id, root, &[("novo.txt".into(), "conteúdo\n".into())]);
    let done = agent::status(&id).expect("a tarefa está registada");
    assert_eq!(done.status, "done", "a tarefa terminou: {done:?}");
    assert!(
        done.patch.contains("novo.txt"),
        "o patch mostra o ficheiro novo: {}",
        done.patch
    );
    assert!(done.error.is_empty(), "sem erro numa tarefa bem-sucedida");

    // Isolado de verdade: a working tree do repo base não foi tocada.
    assert!(
        !root.join("novo.txt").exists(),
        "o executor isolado não toca na working tree"
    );

    // Collect + cancel: o registo existe e depois desaparece.
    assert!(
        agent::cancel(&id),
        "cancelar uma tarefa existente devolve true"
    );
    assert!(
        agent::status(&id).is_none(),
        "depois do cancel o registo desapareceu"
    );
}

/// `agent_isolated_patch` directo: o executor isolado devolve o diff dos `writes` sobre um
/// repo real, sem registo de tarefa (o caminho que `agent_isolated_patch` veste). Prova a
/// fachada `agent::worktree_patch` re-exportada do mecanismo git.
#[test]
fn isolated_patch_returns_a_diff_without_touching_the_tree() {
    let dir = repo_with_one_commit();
    let root = dir.path();

    let patch = agent::worktree_patch(root, &[("a.txt".into(), "dois\n".into())])
        .expect("aplicar um patch isolado num repo real não falha");
    assert!(
        patch.contains("a.txt"),
        "o diff menciona o ficheiro alterado: {patch}"
    );
    assert_eq!(
        fs::read_to_string(root.join("a.txt")).unwrap(),
        "um\n",
        "a working tree fica intacta"
    );
}
