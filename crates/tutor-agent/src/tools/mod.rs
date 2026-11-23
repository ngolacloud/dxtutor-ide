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

pub use exec::{run_process, ExecOutcome};

/// Impressão digital do conteúdo de cada ficheiro tal como o agente o viu pela última vez.
#[derive(Default)]
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
}

impl Default for ToolsetOptions {
    fn default() -> Self {
        ToolsetOptions {
            test_cmd: None,
            lint_cmd: None,
            bash_timeout: Duration::from_secs(120),
        }
    }
}

/// As ferramentas de programação, por ordem fixa (mudar a ordem invalida a cache).
pub fn coding_tools(opts: &ToolsetOptions) -> Vec<Arc<dyn Tool>> {
    let state = Arc::new(FileState::default());
    let mut v: Vec<Arc<dyn Tool>> = vec![
        Arc::new(fs::Read {
            state: state.clone(),
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
/// *preserved thinking* recusa-o). 1 = F2–F5; 2 = + todo_write/exit_plan/task (F6).
pub const TOOLSET_VERSION: u32 = 2;

/// O estado partilhado entre as ferramentas de fluxo e a sessão.
#[derive(Clone, Default)]
pub struct FlowState {
    /// Modo plano: a política recusa alterações; `exit_plan` desliga-o quando aprovado.
    pub plan_mode: Arc<std::sync::atomic::AtomicBool>,
    pub todos: Arc<Mutex<Vec<flow::Todo>>>,
}

/// O conjunto de ferramentas de uma sessão, na versão `version`, por ordem fixa.
pub fn agent_tools(
    opts: &ToolsetOptions,
    version: u32,
    flow_state: &FlowState,
    subagent: Option<flow::SubagentSpec>,
) -> Vec<Arc<dyn Tool>> {
    let mut v = coding_tools(opts);
    if version >= 2 {
        v.push(Arc::new(flow::TodoWrite {
            todos: flow_state.todos.clone(),
        }));
        v.push(Arc::new(flow::ExitPlan {
            plan_mode: flow_state.plan_mode.clone(),
        }));
        if let Some(spec) = subagent {
            v.push(Arc::new(flow::Task { spec }));
        }
    }
    v
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
