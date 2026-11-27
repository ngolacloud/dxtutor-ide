//! O contrato de uma ferramenta do agente. As ferramentas reais chegam em F2.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;

use crate::provider::{ToolDef, Usage};

/// O que uma ferramenta recebe além do input.
#[derive(Clone)]
pub struct ToolCtx {
    /// Raiz do projecto aberto: as ferramentas nunca saem dela.
    pub root: PathBuf,
    /// Cancelamento da sessão: ferramentas longas (bash, testes) devem consultá-lo.
    pub cancel: Arc<AtomicBool>,
}

impl ToolCtx {
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }
}

/// O resultado de uma ferramenta, tal como volta ao modelo.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolOutput {
    pub content: String,
    pub is_error: bool,
}

impl ToolOutput {
    pub fn ok(content: impl Into<String>) -> Self {
        ToolOutput {
            content: content.into(),
            is_error: false,
        }
    }
    pub fn err(content: impl Into<String>) -> Self {
        ToolOutput {
            content: content.into(),
            is_error: true,
        }
    }
}

/// Uma ferramenta. `read_only` diz se é segura para correr em paralelo com outras do
/// mesmo turno (leituras, pesquisas); as que mudam alguma coisa correm em série, pela
/// ordem em que o modelo as pediu.
pub trait Tool: Send + Sync {
    fn name(&self) -> &str;
    fn description(&self) -> &str;
    fn input_schema(&self) -> Value;
    fn read_only(&self) -> bool;
    /// H4: whether THIS call only reads — for a tool whose actions differ (`ide`: reads run, the actions that
    /// change a record go to the approval). By default, the tool's [`Tool::read_only`].
    fn read_only_for(&self, _input: &Value) -> bool {
        self.read_only()
    }
    /// Pode alterar ficheiros do projecto? (antes da primeira destas num turno, o loop cria
    /// um checkpoint). Por omissão: tudo o que não é só leitura.
    fn mutates_files(&self) -> bool {
        !self.read_only()
    }
    /// Entradas grandes (conteúdo de ficheiros): liga `eager_input_streaming`.
    fn eager_input(&self) -> bool {
        false
    }
    /// O comando de shell que esta chamada vai correr, se correr algum (bash, testes,
    /// lint) — é o que o classificador de permissões avalia.
    fn command_preview(&self, _input: &Value) -> Option<String> {
        None
    }
    /// Corre com um input **já validado** contra [`Tool::input_schema`].
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput;

    /// Esta ferramenta conta o que vai fazendo enquanto corre ([`Tool::run_observed`])? O loop
    /// só então a corre numa thread e passa o progresso à UI em tempo real (o `task`).
    fn reports_progress(&self) -> bool {
        false
    }
    /// Como [`Tool::run`], mas a ferramenta pode contar o que vai fazendo (`progress`): o loop
    /// embrulha cada passo num [`crate::agent::AgentEvent::Subagent`] com o id da chamada.
    /// Por omissão, ignora-o.
    fn run_observed(
        &self,
        input: &Value,
        ctx: &ToolCtx,
        _progress: &(dyn Fn(SubagentStep) + Sync),
    ) -> ToolOutput {
        self.run(input, ctx)
    }

    fn def(&self) -> ToolDef {
        ToolDef {
            name: self.name().to_string(),
            description: self.description().to_string(),
            input_schema: self.input_schema(),
            eager: self.eager_input(),
        }
    }
}

/// Um passo de um sub-agente (`task`) enquanto corre: o mapa de agentes da UI mostra-o (o que
/// pediu, que ferramentas correu, quantos tokens gastou). O relatório final continua a ser o
/// resultado da chamada (`tool_result`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SubagentStep {
    /// Começou, com este papel (explorer, reviewer, tester, architect).
    Started { role: String },
    /// Vai correr uma ferramenta (só leitura).
    ToolStart {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        id: String,
        name: String,
        is_error: bool,
    },
    /// Tokens acumulados do sub-agente até aqui (o total do seu turno).
    Usage { turn: Usage },
}
