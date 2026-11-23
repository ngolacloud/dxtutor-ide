//! O contrato de uma ferramenta do agente. As ferramentas reais chegam em F2.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::Value;

use crate::provider::ToolDef;

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

    fn def(&self) -> ToolDef {
        ToolDef {
            name: self.name().to_string(),
            description: self.description().to_string(),
            input_schema: self.input_schema(),
            eager: self.eager_input(),
        }
    }
}
