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
pub use tutor_eval::arch::mermaid::MermaidImport;
pub use tutor_eval::arch::{Architecture, Component, Connection, Finding, Kind, Relation};
pub use tutor_eval::git::worktree_patch;

// ── Arquitectura (Architecture Studio) ──────────────────────────────────────────────

/// Valida um System Design: corre as regras estruturais sobre os componentes/ligações
/// desenhados e devolve os achados (erros primeiro). Puro, sem E/S — delega a
/// `Architecture::validate` (o mecanismo).
pub fn validate(arch: &Architecture) -> Vec<Finding> {
    arch.validate()
}

/// Exporta um desenho para Mermaid `graph TB` (com os metadados `%% dxt:` que tornam a
/// ida e volta exacta). Puro — delega a `arch::mermaid::to_mermaid`.
pub fn export_mermaid(arch: &Architecture) -> String {
    tutor_eval::arch::mermaid::to_mermaid(arch)
}

/// Importa um `graph`/`flowchart` Mermaid para o modelo, com os avisos do que não veio tal
/// e qual. Erro só quando a fonte não é um flowchart. Puro — delega a
/// `arch::mermaid::from_mermaid`.
pub fn import_mermaid(source: &str) -> Result<MermaidImport, String> {
    tutor_eval::arch::mermaid::from_mermaid(source)
}

// ── Proposta de desenho pelo agente (Studio, F6) ─────────────────────────────────────

/// Uma proposta de desenho do agente do Co-Dev, tal como a UI a recebe (evento
/// `arch://proposal`): o modelo do Studio e os achados da validação.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchProposal {
    pub title: String,
    pub arch: Architecture,
    pub findings: Vec<Finding>,
}

/// Um desenho com mais componentes do que isto não é um diagrama que se leia.
pub const MAX_PROPOSAL_COMPONENTS: usize = 200;

/// O nome da ferramenta (o anfitrião injecta-a a partir do conjunto versão 4).
pub const ARCH_PROPOSE: &str = "arch_propose";

/// `arch_propose`: o agente propõe um desenho ao humano no Studio de arquitectura. Valida-o
/// com as regras do Studio (`arch_validate`) e devolve os achados ao modelo, para ele
/// corrigir e propor de novo. **Não escreve nada no disco**: a proposta aparece no Studio
/// por cima do desenho actual e só o substitui quando o humano carrega em «Accept».
/// `emit` entrega a proposta à UI (no Tauri, o evento `arch://proposal`).
pub struct ArchProposeTool {
    pub emit: std::sync::Arc<dyn Fn(&ArchProposal) + Send + Sync>,
}

const KINDS: [&str; 18] = [
    "service", "store", "broker", "consumer", "relay", "gateway", "cli", "process", "daemon",
    "runtime", "socket", "state", "kernel", "external", "client", "worker", "port", "adapter",
];

impl tutor_agent::Tool for ArchProposeTool {
    fn name(&self) -> &str {
        ARCH_PROPOSE
    }
    fn description(&self) -> &str {
        "Propose an architecture diagram to the human in the Architecture Studio (use it when \
         they ask you to design, draw or compare an architecture). The design is validated \
         with the Studio's rules and the findings come back to you: fix the errors and \
         propose again. Nothing is written to disk; the human accepts or discards the \
         proposal in the Studio. Groups are nested boundaries (host, plane, node, module, \
         layer, boundary); views are at most two side-by-side panels (\"known system\" on \
         the left, ours on the right), each listing its root groups. Arrows: style control \
         (default), data (client requests) or optional; label only when the meaning is not \
         obvious. Put in `source` the file or crate where each box and arrow is confirmed; \
         a panel marked strict warns about anything without a source."
    }
    fn input_schema(&self) -> serde_json::Value {
        let kinds: Vec<&str> = KINDS.to_vec();
        serde_json::json!({
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short title shown to the human, e.g. \"Delonix vs Docker\"."},
                "architecture": {
                    "type": "object",
                    "properties": {
                        "components": {"type": "array", "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "name": {"type": "string", "description": "1–2 words; a second line after \\n is allowed"},
                                "kind": {"type": "string", "enum": kinds},
                                "group": {"type": "string", "description": "id of the group it lives in"},
                                "code": {"type": "string", "description": "optional mini code block, e.g. \"delonix run nginx\""},
                                "source": {"type": "string", "description": "file or crate where it is confirmed"},
                                "outbox": {"type": "boolean"}
                            },
                            "required": ["id", "name", "kind"]
                        }},
                        "connections": {"type": "array", "items": {
                            "type": "object",
                            "properties": {
                                "from": {"type": "string"},
                                "to": {"type": "string"},
                                "style": {"type": "string", "enum": ["control", "data", "optional"]},
                                "protocol": {"type": "string", "enum": ["grpc", "http", "unix-socket", "fork-exec", "syscall", "fs", "ssh", "event"]},
                                "label": {"type": "string"},
                                "relation": {"type": "string", "enum": ["writes", "reads", "publishes", "consumes", "routes-to"], "description": "only for event-driven designs"},
                                "event": {"type": "string"},
                                "source": {"type": "string"}
                            },
                            "required": ["from", "to"]
                        }},
                        "groups": {"type": "array", "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "label": {"type": "string"},
                                "kind": {"type": "string", "enum": ["host", "plane", "node", "module", "layer", "boundary"]},
                                "parent": {"type": "string"},
                                "style": {"type": "string", "enum": ["dashed", "solid"]},
                                "source": {"type": "string"}
                            },
                            "required": ["id", "label", "kind"]
                        }},
                        "views": {"type": "array", "maxItems": 2, "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "title": {"type": "string"},
                                "color": {"type": "string", "description": "#rrggbb"},
                                "roots": {"type": "array", "items": {"type": "string"}},
                                "daemonless": {"type": "boolean"},
                                "strict": {"type": "boolean"}
                            },
                            "required": ["id", "title", "roots"]
                        }}
                    },
                    "required": ["components"]
                }
            },
            "required": ["title", "architecture"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(
        &self,
        input: &serde_json::Value,
        _ctx: &tutor_agent::ToolCtx,
    ) -> tutor_agent::ToolOutput {
        match proposal_from_input(input) {
            Ok(p) => {
                (self.emit)(&p);
                tutor_agent::ToolOutput::ok(proposal_summary(&p))
            }
            Err(e) => tutor_agent::ToolOutput::err(e),
        }
    }
}

/// Lê e valida a entrada da ferramenta (sem efeitos).
pub fn proposal_from_input(input: &serde_json::Value) -> Result<ArchProposal, String> {
    let title = input["title"].as_str().unwrap_or("").trim().to_string();
    if title.is_empty() {
        return Err("a proposal needs a `title`".into());
    }
    let arch: Architecture = serde_json::from_value(input["architecture"].clone())
        .map_err(|e| format!("the architecture does not match the Studio model: {e}"))?;
    if arch.components.is_empty() {
        return Err("a proposal needs at least one component".into());
    }
    if arch.components.len() > MAX_PROPOSAL_COMPONENTS {
        return Err(format!(
            "{} components is too many for a readable diagram (at most {MAX_PROPOSAL_COMPONENTS}): split it",
            arch.components.len()
        ));
    }
    let findings = arch.validate();
    Ok(ArchProposal {
        title,
        arch,
        findings,
    })
}

/// O que volta ao modelo: o que foi mostrado e os achados, um por linha.
pub fn proposal_summary(p: &ArchProposal) -> String {
    use tutor_eval::arch::Severity;
    let errors = p
        .findings
        .iter()
        .filter(|f| f.severity == Severity::Error)
        .count();
    let warnings = p.findings.len() - errors;
    let mut out = format!(
        "Proposal «{}» is shown in the Architecture Studio ({} components, {} arrows, {} groups, {} panels). \
         The human accepts or discards it there; nothing was written to disk.\n",
        p.title,
        p.arch.components.len(),
        p.arch.connections.len(),
        p.arch.groups.len(),
        p.arch.views.len()
    );
    if p.findings.is_empty() {
        out.push_str("Validation: no findings.");
    } else {
        out.push_str(&format!(
            "Validation: {errors} error(s), {warnings} warning(s) — fix them and propose again:\n"
        ));
        for f in &p.findings {
            let sev = if f.severity == Severity::Error {
                "error"
            } else {
                "warning"
            };
            out.push_str(&format!("- {sev} {}: {}\n", f.rule, f.message));
        }
    }
    out
}

/// Extensões que o Studio pode exportar para a pasta do projecto.
pub const EXPORT_EXTENSIONS: &[&str] = &["svg", "png", "mmd", "md", "json"];

/// Escreve uma exportação do Studio (SVG, PNG, Mermaid, ficheiro do desenho) em `rel`,
/// DENTRO de `root` (o mesmo confinamento do `write_file`: sem `..`, sem caminhos
/// absolutos, sem sair por symlinks) e só com uma das [`EXPORT_EXTENSIONS`]. Cria as
/// pastas que faltarem e substitui um ficheiro existente (a UI confirma antes). Devolve o
/// caminho relativo escrito.
pub fn save_export(root: &Path, rel: &str, bytes: &[u8]) -> Result<String, String> {
    let ext = Path::new(rel)
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !EXPORT_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!(
            "`{rel}`: the Studio only exports {}",
            EXPORT_EXTENSIONS.join(", ")
        ));
    }
    // confinamento ANTES de criar pastas (como `workspace::write`): um symlink dentro do
    // projecto não pode servir para criar nada fora dele
    let p = crate::workspace::safe_join(root, rel)?;
    crate::workspace::ensure_within(root, &p)?;
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("{rel}: {e}"))?;
    }
    std::fs::write(&p, bytes).map_err(|e| format!("{rel}: {e}"))?;
    Ok(rel.to_string())
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
    fn arch_propose_validates_emits_and_never_writes() {
        use std::sync::{Arc, Mutex};
        use tutor_agent::Tool;
        let got: Arc<Mutex<Vec<ArchProposal>>> = Arc::default();
        let sink = got.clone();
        let tool = ArchProposeTool {
            emit: Arc::new(move |p| sink.lock().unwrap().push(p.clone())),
        };
        assert_eq!(tool.name(), "arch_propose");
        assert!(tool.read_only() && !tool.mutates_files());
        let dir = tempfile::tempdir().unwrap();
        let ctx = tutor_agent::ToolCtx {
            root: dir.path().to_path_buf(),
            cancel: Arc::default(),
        };
        let input = serde_json::json!({
            "title": "Delonix vs Docker",
            "architecture": {
                "components": [
                    {"id": "cli", "name": "delonix", "kind": "cli", "group": "host", "code": "delonix run nginx"},
                    {"id": "dockerd", "name": "dockerd", "kind": "daemon", "group": "host"}
                ],
                "connections": [{"from": "cli", "to": "dockerd", "protocol": "unix-socket"}],
                "groups": [{"id": "host", "label": "Host", "kind": "host"}],
                "views": [{"id": "delonix", "title": "Delonix", "roots": ["host"], "daemonless": true}]
            }
        });
        let out = tool.run(&input, &ctx);
        assert!(!out.is_error, "{}", out.content);
        // a validação real correu e o achado voltou ao modelo
        assert!(
            out.content
                .contains("Proposal «Delonix vs Docker» is shown"),
            "{}",
            out.content
        );
        assert!(
            out.content.contains("warning daemonless-claim"),
            "{}",
            out.content
        );
        let p = &got.lock().unwrap()[0];
        assert_eq!(
            p.arch.components[0].code.as_deref(),
            Some("delonix run nginx")
        );
        assert_eq!(p.findings[0].rule, "daemonless-claim");
        // nada no disco
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        // o JSON que a UI recebe
        let js = serde_json::to_value(p).unwrap();
        assert_eq!(js["title"], "Delonix vs Docker");
        assert_eq!(js["findings"][0]["severity"], "warning");
    }

    #[test]
    fn arch_propose_rejects_bad_input_without_emitting() {
        use std::sync::{atomic::AtomicUsize, Arc};
        let n = Arc::new(AtomicUsize::new(0));
        let c = n.clone();
        let tool = ArchProposeTool {
            emit: Arc::new(move |_| {
                c.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }),
        };
        let ctx = tutor_agent::ToolCtx {
            root: std::env::temp_dir(),
            cancel: Arc::default(),
        };
        use tutor_agent::Tool;
        for bad in [
            serde_json::json!({"title": "", "architecture": {"components": [{"id": "a", "name": "a", "kind": "cli"}]}}),
            serde_json::json!({"title": "x", "architecture": {"components": []}}),
            serde_json::json!({"title": "x", "architecture": {"components": [{"id": "a", "name": "a", "kind": "spaceship"}]}}),
        ] {
            assert!(tool.run(&bad, &ctx).is_error);
        }
        assert_eq!(n.load(std::sync::atomic::Ordering::SeqCst), 0);
        let many: Vec<_> = (0..201)
            .map(|i| serde_json::json!({"id": format!("c{i}"), "name": "c", "kind": "process"}))
            .collect();
        let r = proposal_from_input(
            &serde_json::json!({"title": "x", "architecture": {"components": many}}),
        );
        assert!(r.unwrap_err().contains("too many"));
    }

    #[test]
    fn save_export_writes_inside_the_project_only() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let rel = save_export(root, "docs/architecture/d.png", &[0x89, b'P', b'N', b'G'])
            .expect("escreve dentro da pasta");
        assert_eq!(rel, "docs/architecture/d.png");
        assert_eq!(
            std::fs::read(root.join("docs/architecture/d.png")).unwrap(),
            [0x89, b'P', b'N', b'G']
        );
        // substitui (a UI confirma antes)
        save_export(root, "docs/architecture/d.png", b"x").unwrap();
        assert_eq!(
            std::fs::read(root.join("docs/architecture/d.png")).unwrap(),
            b"x"
        );
        // fora da pasta, absoluto, ou extensão que não é de exportação: recusado
        assert!(save_export(root, "../fora.svg", b"x").is_err());
        assert!(save_export(root, "/tmp/abs.svg", b"x").is_err());
        assert!(save_export(root, "docs/run.sh", b"x").is_err());
        assert!(save_export(root, "docs/noext", b"x").is_err());
        assert!(!root.join("docs/run.sh").exists());
    }

    #[test]
    fn mermaid_facade_round_trips_and_rejects_non_flowcharts() {
        // O que arch_export_mermaid devolve, arch_import_mermaid traz de volta tal e qual.
        let arch = valid_design();
        let back = import_mermaid(&export_mermaid(&arch)).expect("o export é um flowchart");
        assert!(back.warnings.is_empty(), "{:?}", back.warnings);
        assert_eq!(
            serde_json::to_string(&back.arch).unwrap(),
            serde_json::to_string(&arch).unwrap()
        );
        assert!(import_mermaid("sequenceDiagram\n  A->>B: hi").is_err());
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
