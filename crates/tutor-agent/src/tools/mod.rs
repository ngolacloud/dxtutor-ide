//! As ferramentas do agente (F2): ficheiros, pesquisa, shell, verificação e git.
//!
//! Todas correm dentro da raiz do projecto ([`crate::sandbox`]) e limitam o que
//! devolvem ao modelo. O [`FileState`] é partilhado entre `read`, `edit` e `write`
//! da mesma sessão: só se edita ou sobrescreve um ficheiro que o agente leu, e que
//! não mudou desde então.

mod exec;
pub mod flow;
mod fs;
mod git;
mod search;

use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::tool::Tool;

pub use exec::{run_process, run_process_io, shell, ExecOutcome, MAX_TIMEOUT};
pub(crate) use fs::{check_fresh, edit_check, write_check};

/// Impressão digital do conteúdo de cada ficheiro tal como o agente o viu pela última vez.
#[derive(Default, Debug)]
pub struct FileState {
    seen: Mutex<HashMap<PathBuf, u64>>,
}

impl FileState {
    pub fn fingerprint(bytes: &[u8]) -> u64 {
        let mut h = std::collections::hash_map::DefaultHasher::new();
        bytes.hash(&mut h);
        h.finish()
    }
    pub fn record(&self, p: &std::path::Path, bytes: &[u8]) {
        self.seen
            .lock()
            .unwrap()
            .insert(p.to_path_buf(), Self::fingerprint(bytes));
    }
    pub fn seen(&self, p: &std::path::Path) -> Option<u64> {
        self.seen.lock().unwrap().get(p).copied()
    }
}

/// Opções do conjunto de ferramentas de uma sessão.
#[derive(Debug, Clone)]
pub struct ToolsetOptions {
    /// Comando de testes detectado do projecto (`run_tests`); sem ele a ferramenta não existe.
    pub test_cmd: Option<String>,
    /// Comando de lint/typecheck detectado (`lint`); idem.
    pub lint_cmd: Option<String>,
    /// Timeout por omissão do `bash` (o modelo pode pedir até [`exec::MAX_TIMEOUT`]).
    pub bash_timeout: Duration,
    /// The read/edit/write state to share with the host (live hunks, RF-CODEV-STREAM);
    /// `None` creates a private one.
    pub files: Option<Arc<FileState>>,
    /// The toolset version whose tool descriptions to use (a session keeps the one it started
    /// with; [`agent_tools`] sets it). Sub-agents and the TUI/CLI use the current one.
    pub version: u32,
    /// Toolset 9: this session works on a Project issue, so it gets `finish_issue` (the other
    /// sessions do not pay for a tool they never use).
    pub issue: bool,
}

impl Default for ToolsetOptions {
    fn default() -> Self {
        ToolsetOptions {
            test_cmd: None,
            lint_cmd: None,
            bash_timeout: Duration::from_secs(120),
            files: None,
            version: TOOLSET_VERSION,
            issue: false,
        }
    }
}

/// As ferramentas de programação, por ordem fixa (mudar a ordem invalida a cache).
pub fn coding_tools(opts: &ToolsetOptions) -> Vec<Arc<dyn Tool>> {
    let state = opts.files.clone().unwrap_or_default();
    let mut v: Vec<Arc<dyn Tool>> = vec![
        Arc::new(fs::Read {
            state: state.clone(),
            v9: opts.version >= 9,
        }),
        Arc::new(search::Glob),
        Arc::new(search::Grep),
        Arc::new(fs::Edit {
            state: state.clone(),
        }),
        Arc::new(fs::Write { state }),
        Arc::new(exec::Bash {
            default_timeout: opts.bash_timeout,
        }),
        Arc::new(git::GitStatus),
        Arc::new(git::GitDiff),
    ];
    if let Some(c) = opts.test_cmd.as_ref().filter(|c| !c.trim().is_empty()) {
        v.push(Arc::new(exec::Verify::tests(c.trim())));
    }
    if let Some(c) = opts.lint_cmd.as_ref().filter(|c| !c.trim().is_empty()) {
        v.push(Arc::new(exec::Verify::lint(c.trim())));
    }
    v
}

/// Versão do conjunto de ferramentas gravada com cada sessão: retomar uma sessão usa o
/// conjunto com que ela começou (mudar as ferramentas muda o prefixo do pedido, e o
/// *preserved thinking* recusa-o). 1 = F2–F5; 2 = + todo_write/exit_plan/task (F6);
/// 3 = + skill e as ferramentas injectadas pelo anfitrião (lsp_diagnostics, MCP) (F7);
/// 4 = + as ferramentas do anfitrião da versão 4 (`arch_propose`, Studio de arquitectura);
/// 5 = `exit_plan` com passos e ficheiros, `task` com papéis (A3: HARNESS-01/06);
/// 6 = + `ask_human`/`suggest`; 7 = + `finish_issue`; 8 = + `edit_lines`;
/// 9 = conjuntos por tipo de sessão (`finish_issue` só nas issues, `arch_propose` só nas
/// sessões de arquitectura — o anfitrião decide) e as descrições de `read`/`edit_lines` que
/// poupam tokens (ler por excertos, uma só ferramenta de edição preferida);
/// 10 = `finish_issue` responde também a cada item da Definition of Done (Board B: o anfitrião
/// dá a DoD do projecto; o Project verifica-a antes da Review).
pub const TOOLSET_VERSION: u32 = 10;

/// O estado partilhado entre as ferramentas de fluxo e a sessão.
#[derive(Clone, Default)]
pub struct FlowState {
    /// Modo plano: a política recusa alterações; `exit_plan` desliga-o quando aprovado.
    pub plan_mode: Arc<std::sync::atomic::AtomicBool>,
    pub todos: Arc<Mutex<Vec<flow::Todo>>>,
    /// Toolset 6 (RF-G08): the human approved a plan in this turn (`exit_plan`); the host
    /// clears it at each new request.
    pub plan_approved: Arc<std::sync::atomic::AtomicBool>,
    /// Toolset 6 (RF-G06): the question the agent asked the human in this turn (`ask_human`).
    pub question: Arc<Mutex<Option<String>>>,
    /// Toolset 6 (RF-G02/B05): what the agent suggested outside the request (`suggest`):
    /// `(title, why)`, taken by the host to the Project inbox.
    pub suggestions: Arc<Mutex<Vec<(String, String)>>>,
    /// Toolset 7 (RF-B06): the acceptance criteria of the issue this turn works on (set by
    /// the host); `finish_issue` must answer each one.
    pub criteria: Arc<Mutex<Vec<String>>>,
    /// Toolset 7: the table `finish_issue` answered; the issue is over for the agent (in Auto
    /// too, RF-G04) and the host sends it to Review.
    pub finished: Arc<Mutex<Option<serde_json::Value>>>,
    /// Toolset 10 (Board B): the project's Definition of Done (set by the host with the
    /// criteria); `finish_issue` answers each item.
    pub dod: Arc<Mutex<Vec<String>>>,
}

/// O conjunto de ferramentas de uma sessão, na versão `version`, por ordem fixa.
pub fn agent_tools(
    opts: &ToolsetOptions,
    version: u32,
    flow_state: &FlowState,
    subagent: Option<flow::SubagentSpec>,
    extras: Vec<Arc<dyn Tool>>,
) -> Vec<Arc<dyn Tool>> {
    // the edit tools share one file state (what was read, and when)
    let state = opts.files.clone().unwrap_or_default();
    let opts = &ToolsetOptions {
        files: Some(state.clone()),
        version,
        ..opts.clone()
    };
    let mut v = coding_tools(opts);
    if version >= 2 {
        v.push(Arc::new(flow::TodoWrite {
            todos: flow_state.todos.clone(),
        }));
        v.push(Arc::new(flow::ExitPlan {
            plan_mode: flow_state.plan_mode.clone(),
            steps: version >= 5,
            approved: (version >= 6).then(|| flow_state.plan_approved.clone()),
        }));
        if let Some(spec) = subagent {
            v.push(Arc::new(flow::Task {
                spec,
                roles: version >= 5,
            }));
        }
    }
    if version >= 3 {
        v.push(Arc::new(crate::extensions::SkillTool));
        v.extend(extras); // pela ordem que o anfitrião der (determinística por sessão)
    }
    // toolset 6 (docs/v2/RF-DELONIX-PLANO.md F1.7/F1.10): at the end, so the toolset 5
    // prefix stays byte for byte
    if version >= 6 {
        v.push(Arc::new(flow::AskHuman {
            question: flow_state.question.clone(),
        }));
        v.push(Arc::new(flow::Suggest {
            suggestions: flow_state.suggestions.clone(),
        }));
    }
    // toolset 7 (F4.5): the end of an issue, after the toolset 6 tools; from toolset 9 only in
    // the sessions that work on an issue
    if version >= 7 && (version < 9 || opts.issue) {
        v.push(Arc::new(flow::FinishIssue {
            criteria: flow_state.criteria.clone(),
            finished: flow_state.finished.clone(),
            dod: (version >= 10).then(|| flow_state.dod.clone()),
        }));
    }
    // toolset 8 (F2.1): line edits anchored on the lines' text
    if version >= 8 {
        v.push(Arc::new(fs::EditLines {
            state,
            v9: version >= 9,
        }));
    }
    v
}

/// Um caminho temporário único por chamada (pid + contador + nanossegundos): ficheiros
/// usados por operações em paralelo nunca colidem.
pub fn unique_temp(prefix: &str, ext: &str) -> std::path::PathBuf {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let ns = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{prefix}-{}-{n}-{ns}.{ext}", std::process::id()))
}

/// Corta texto longo mantendo início e fim, com um aviso do que se omitiu.
pub(crate) fn head_tail(s: &str, max_chars: usize) -> String {
    let n = s.chars().count();
    if n <= max_chars {
        return s.to_string();
    }
    let head: String = s.chars().take(max_chars * 2 / 3).collect();
    let tail: String = s.chars().skip(n - max_chars / 3).collect();
    format!("{head}\n…[{} caracteres omitidos]…\n{tail}", n - max_chars)
}

/// Heurística de binário: um NUL nos primeiros 8 KB.
pub(crate) fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8192).any(|&b| b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toolset_order_is_fixed_and_verify_tools_are_optional() {
        let names = |o: &ToolsetOptions| {
            coding_tools(o)
                .iter()
                .map(|t| t.name().to_string())
                .collect::<Vec<_>>()
        };
        let base = names(&ToolsetOptions::default());
        assert_eq!(
            base,
            [
                "read",
                "glob",
                "grep",
                "edit",
                "write",
                "bash",
                "git_status",
                "git_diff"
            ]
        );
        let full = names(&ToolsetOptions {
            test_cmd: Some("cargo test".into()),
            lint_cmd: Some(" ".into()),
            ..Default::default()
        });
        assert_eq!(full.last().unwrap(), "run_tests");
        assert_eq!(full.len(), base.len() + 1);
    }

    #[test]
    fn read_only_flags_and_eager_inputs() {
        for t in coding_tools(&ToolsetOptions {
            test_cmd: Some("x".into()),
            lint_cmd: Some("y".into()),
            ..Default::default()
        }) {
            let ro = matches!(
                t.name(),
                "read" | "glob" | "grep" | "git_status" | "git_diff"
            );
            assert_eq!(t.read_only(), ro, "{}", t.name());
            assert_eq!(
                t.eager_input(),
                matches!(t.name(), "edit" | "write"),
                "{}",
                t.name()
            );
            // schemas fechados: o validador recusa propriedades inventadas
            assert_eq!(
                t.input_schema()["additionalProperties"],
                false,
                "{}",
                t.name()
            );
        }
    }

    #[test]
    fn head_tail_keeps_both_ends() {
        let s = format!("A{}Z", "x".repeat(1000));
        let c = head_tail(&s, 100);
        assert!(c.starts_with('A') && c.ends_with('Z') && c.contains("omitidos"));
        assert_eq!(head_tail("curto", 100), "curto");
    }
}
