//! Caso de uso «agente / arquitectura» — **independente de Tauri** (Etapa 3).
//!
//! Sétimo grupo saído de `lib.rs`. Reúne duas naturezas, ambas Tauri-free:
//!
//!  - **Arquitectura (Architecture Studio).** `arch_validate`/`arch_scaffold_preview`
//!    eram passagens puras ao mecanismo `tutor_eval::arch` (`Architecture::validate`/
//!    `scaffold`); re-exportam-se aqui como [`validate`]/[`scaffold_preview`]. O
//!    `arch_scaffold` trazia, embutida no `#[tauri::command]`, uma **regra**: um desenho
//!    inválido (scaffold vazio) **não** se materializa — e nunca sobrescreve ficheiros
//!    existentes. Essa regra isola-se em [`scaffold`] com erro tipado [`ScaffoldError`]
//!    (design inválido vs E/S), exactamente como `gitops::GitError`/`testexec::TestError`.
//!
//!  - **API de tarefa cloud-shaped (RF-AG-01).** O ciclo submit → status → collect sobre
//!    o executor isolado local (`worktree_patch`) é **orquestração pura**: um registo de
//!    tarefas ([`AgentTask`]) com transições `running → done|error`, geração de id e
//!    cancelamento. Vivia preso em estáticos de `lib.rs`; vem para aqui
//!    ([`new_task_id`]/[`register_running`]/[`run_and_store`]/[`status`]/[`cancel`]), sem
//!    o `spawn_blocking` do Tauri — o adaptador IPC só agenda o worker. O executor
//!    isolado (`worktree_patch`, o mecanismo git intocado) re-exporta-se como fachada da
//!    fatia, para que o crate de teste atravesse `crate::agent` sem ver `tutor_eval`.
//!
//! A fronteira IPC (`commands::agent`) fica um adaptador fino, como
//! `workspace::open_workspace` ↔ `bridge::load_workspace`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

// Mecanismos puros re-exportados como fachada da fatia (sem Tauri). Os tipos de
// arquitectura acompanham para que o adaptador IPC e o teste integrado atravessem a
// mesma fronteira `crate::agent` sem `tutor_eval` exposto.
pub use tutor_eval::arch::{Architecture, Component, Connection, Finding, Kind, Relation};
pub use tutor_eval::git::worktree_patch;

// ── Arquitectura (Architecture Studio) ──────────────────────────────────────────────

/// Valida um System Design: corre as regras estruturais sobre os componentes/ligações
/// desenhados e devolve os achados (erros primeiro). Puro, sem E/S — delega a
/// `Architecture::validate` (o mecanismo).
pub fn validate(arch: &Architecture) -> Vec<Finding> {
    arch.validate()
}

/// Pré-visualiza o scaffold de um desenho SEM escrever: os pares `(relPath, content)` que
/// [`scaffold`] escreveria. Vazio se o desenho for inválido (mesma regra do scaffold).
/// Delega a `Architecture::scaffold`.
pub fn scaffold_preview(arch: &Architecture) -> Vec<(String, String)> {
    arch.scaffold()
}

/// Porque é que o scaffold de um System Design pode falhar. A **regra** que vivia dentro
/// do `#[tauri::command]`: um desenho inválido não se materializa; o resto é E/S de disco.
#[derive(Debug)]
pub enum ScaffoldError {
    /// O desenho tem erros (scaffold vazio) — corrigir antes de materializar.
    InvalidDesign,
    /// Falha de E/S ao criar directórios / escrever ficheiros.
    Io(String),
}

impl std::fmt::Display for ScaffoldError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Mensagens preservadas EXACTAMENTE da versão em `lib.rs` (contrato observado pela UI).
        match self {
            ScaffoldError::InvalidDesign => {
                write!(f, "design has errors — fix them before scaffolding")
            }
            ScaffoldError::Io(e) => write!(f, "{e}"),
        }
    }
}

/// Gera um scaffold de projecto a partir de um System Design VÁLIDO: uma pasta por
/// componente vivo + `ARCHITECTURE.md` sob `root` (nunca sobrescrevendo ficheiros
/// existentes). Devolve os caminhos relativos escritos. [`ScaffoldError::InvalidDesign`]
/// se o desenho for inválido (scaffold vazio) — a regra. I/O de disco: correr num worker.
pub fn scaffold(root: &Path, arch: &Architecture) -> Result<Vec<String>, ScaffoldError> {
    let files = arch.scaffold();
    if files.is_empty() {
        return Err(ScaffoldError::InvalidDesign);
    }
    let mut written = Vec::new();
    for (rel, content) in files {
        let p = root.join(&rel);
        if p.exists() {
            continue; // never overwrite an existing file
        }
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| ScaffoldError::Io(e.to_string()))?;
        }
        std::fs::write(&p, content).map_err(|e| ScaffoldError::Io(e.to_string()))?;
        written.push(rel);
    }
    Ok(written)
}

// ── API de tarefa cloud-shaped (RF-AG-01) ───────────────────────────────────────────
// Submit → status → collect sobre o executor isolado LOCAL (`worktree_patch`). Local
// hoje; a mesma API é a que um backend remoto exporia, por isso a UI já fala a forma
// cloud. Honestamente local: sem rede, sem credenciais. Orquestração PURA — sem Tauri.

/// Registo de uma tarefa delegada: o seu id, estado e resultado (patch/erro).
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub status: String, // "running" | "done" | "error"
    pub patch: String,
    pub error: String,
}

static AGENT_TASKS: OnceLock<Mutex<HashMap<String, AgentTask>>> = OnceLock::new();
fn tasks() -> &'static Mutex<HashMap<String, AgentTask>> {
    AGENT_TASKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Gera um id de tarefa único no processo (`task-<pid>-<seq>`), monotónico.
pub fn new_task_id() -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    format!(
        "task-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// Regista a tarefa `id` como em execução (estado inicial do ciclo), antes de o worker
/// correr o executor isolado.
pub fn register_running(id: &str) {
    tasks().lock().unwrap().insert(
        id.to_string(),
        AgentTask {
            id: id.to_string(),
            status: "running".into(),
            patch: String::new(),
            error: String::new(),
        },
    );
}

/// Corre o executor isolado (`worktree_patch`) sobre `root`/`writes` e grava o resultado
/// da tarefa `id`: `done` com o patch, ou `error` com a mensagem. A transição que fecha o
/// ciclo submit → collect.
pub fn run_and_store(id: &str, root: &Path, writes: &[(String, String)]) {
    let rec = match worktree_patch(root, writes) {
        Ok(patch) => AgentTask {
            id: id.to_string(),
            status: "done".into(),
            patch,
            error: String::new(),
        },
        Err(e) => AgentTask {
            id: id.to_string(),
            status: "error".into(),
            patch: String::new(),
            error: e,
        },
    };
    tasks().lock().unwrap().insert(id.to_string(), rec);
}

/// Estado + resultado de uma tarefa submetida (collect). `None` quando o id é desconhecido.
pub fn status(id: &str) -> Option<AgentTask> {
    tasks().lock().unwrap().get(id).cloned()
}

/// Cancela/esquece uma tarefa (remove o registo). Devolve se existia.
pub fn cancel(id: &str) -> bool {
    tasks().lock().unwrap().remove(id).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tutor_eval::arch::{Component, Connection, Kind, Relation, Severity};

    /// Um desenho mínimo válido: um serviço que escreve numa store. `scaffold`/`validate`
    /// têm de o aceitar (sem erros de validação, scaffold não-vazio).
    fn valid_design() -> Architecture {
        Architecture {
            components: vec![
                Component::new("svc", "Svc", Kind::Service),
                Component::new("db", "Db", Kind::Store),
            ],
            connections: vec![Connection::new("svc", "db", Relation::Writes, "")],
            ..Default::default()
        }
    }

    #[test]
    fn scaffold_preview_matches_scaffold_payload() {
        // A pré-visualização é exactamente o que o scaffold escreveria (mesmo mecanismo).
        let arch = valid_design();
        let preview = scaffold_preview(&arch);
        assert!(
            !preview.is_empty(),
            "um desenho válido tem scaffold não-vazio: {preview:?}"
        );
        assert!(
            preview
                .iter()
                .any(|(rel, _)| rel.ends_with("ARCHITECTURE.md")),
            "o scaffold inclui ARCHITECTURE.md: {preview:?}"
        );
    }

    #[test]
    fn scaffold_writes_a_valid_design_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let written = scaffold(root, &valid_design()).expect("desenho válido materializa-se");
        assert!(!written.is_empty(), "escreveu ficheiros: {written:?}");
        assert!(
            root.join("ARCHITECTURE.md").is_file(),
            "ARCHITECTURE.md foi escrito"
        );

        // Segunda passagem: tudo já existe → nada de novo escrito (nunca sobrescreve).
        let again = scaffold(root, &valid_design()).expect("segunda passagem não falha");
        assert!(
            again.is_empty(),
            "nada é reescrito quando já existe: {again:?}"
        );
    }

    /// Um desenho inválido: uma ligação a partir de um componente inexistente (dangling-edge
    /// = achado de gravidade Error), que torna `is_valid()` falso → scaffold vazio.
    fn invalid_design() -> Architecture {
        Architecture {
            connections: vec![Connection::new("ghost", "void", Relation::Writes, "")],
            ..Default::default()
        }
    }

    #[test]
    fn scaffold_of_an_invalid_design_is_a_typed_error() {
        let dir = tempfile::tempdir().unwrap();
        let arch = invalid_design();
        // Pré-condição: o desenho tem um erro de validação (scaffold vazio).
        assert!(
            arch.validate()
                .iter()
                .any(|f| f.severity == Severity::Error),
            "o desenho é inválido"
        );
        // A regra dispara o erro tipado em vez de materializar nada.
        let err = scaffold(dir.path(), &arch).unwrap_err();
        assert!(
            matches!(err, ScaffoldError::InvalidDesign),
            "design inválido → InvalidDesign"
        );
        // A mensagem é a histórica, preservada da versão em lib.rs.
        assert_eq!(
            err.to_string(),
            "design has errors — fix them before scaffolding"
        );
    }

    #[test]
    fn task_ids_are_unique() {
        let a = new_task_id();
        let b = new_task_id();
        assert_ne!(a, b, "a sequência torna cada id único: {a} vs {b}");
    }

    #[test]
    fn task_lifecycle_registers_runs_and_cancels() {
        // O ciclo cloud-shaped como estado puro: running → (visível por status) → cancel.
        let id = new_task_id();
        assert!(status(&id).is_none(), "id novo ainda não tem registo");

        register_running(&id);
        let st = status(&id).expect("depois de registar há estado");
        assert_eq!(st.status, "running", "o estado inicial do ciclo é running");

        assert!(cancel(&id), "cancelar uma tarefa existente devolve true");
        assert!(
            status(&id).is_none(),
            "depois do cancel o registo desapareceu"
        );
        assert!(!cancel(&id), "cancelar duas vezes devolve false");
    }
}
