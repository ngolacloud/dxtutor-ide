//! Ferramentas do fluxo plano → entrega (F6): `todo_write`, `exit_plan` e `task`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::{json, Value};

use super::{coding_tools, ToolsetOptions};
use crate::agent::{Agent, AgentConfig, Decision};
use crate::provider::{Effort, Provider, SystemBlock};
use crate::tool::{Tool, ToolCtx, ToolOutput};
use crate::types::{Message, Transcript};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Todo {
    pub content: String,
    /// `pending` | `in_progress` | `completed`
    pub status: String,
}

/// `todo_write`: substitui a lista de tarefas da sessão (a UI mostra-a como checklist).
pub struct TodoWrite {
    pub todos: Arc<Mutex<Vec<Todo>>>,
}

impl Tool for TodoWrite {
    fn name(&self) -> &str {
        "todo_write"
    }
    fn description(&self) -> &str {
        "Regista o plano de execução como lista de tarefas (substitui a lista inteira). Usa-a \
         em trabalho com vários passos: uma tarefa `in_progress` de cada vez, marca \
         `completed` logo que terminas e verificas cada uma."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "todos": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "content": {"type": "string"},
                            "status": {"enum": ["pending", "in_progress", "completed"]}
                        },
                        "required": ["content", "status"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["todos"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true // só mexe no estado da sessão
    }
    fn mutates_files(&self) -> bool {
        false
    }
    fn run(&self, input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        let list: Vec<Todo> = input["todos"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|t| Todo {
                        content: t["content"].as_str().unwrap_or_default().to_string(),
                        status: t["status"].as_str().unwrap_or("pending").to_string(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let doing = list.iter().filter(|t| t.status == "in_progress").count();
        let done = list.iter().filter(|t| t.status == "completed").count();
        let mut out: Vec<String> = list
            .iter()
            .map(|t| {
                let mark = match t.status.as_str() {
                    "completed" => "[x]",
                    "in_progress" => "[~]",
                    _ => "[ ]",
                };
                format!("{mark} {}", t.content)
            })
            .collect();
        out.push(format!("{done}/{} feitas", list.len()));
        if doing > 1 {
            out.push("aviso: mais de uma tarefa em curso — trabalha numa de cada vez".into());
        }
        *self.todos.lock().unwrap() = list;
        ToolOutput::ok(out.join("\n"))
    }
}

/// `exit_plan`: sai do modo plano com o plano proposto. A política pede sempre aprovação
/// ao humano antes de correr; correr = o plano foi aprovado.
pub struct ExitPlan {
    pub plan_mode: Arc<AtomicBool>,
    /// Toolset 5: the plan also lists its steps with the files and lines each one touches
    /// (the Run view draws them, A3 HARNESS-01).
    pub steps: bool,
    /// Toolset 6 (RF-G08): the plan can be proposed in any mode, and an approved plan lets
    /// the turn change files in Manual and Assist. `None`: toolset ≤ 5 (plan mode only).
    pub approved: Option<Arc<AtomicBool>>,
}

impl Tool for ExitPlan {
    fn name(&self) -> &str {
        "exit_plan"
    }
    fn description(&self) -> &str {
        if self.approved.is_some() {
            return "Apresenta o plano ao humano para aprovação (markdown: objectivo, passos \
                    concretos, como vais verificar, riscos; e em `steps` cada ficheiro com o \
                    intervalo de linhas que vais mexer). Nos modos Manual e Assistido é \
                    obrigatório antes de alterar ficheiros; no modo plano termina-o. Aprovado, \
                    executas só o plano.";
        }
        "No modo plano, apresenta o plano ao humano para aprovação (markdown: objectivo, \
         passos concretos com os ficheiros a mexer, como vais verificar, riscos). Se for \
         aprovado, o modo plano termina e executas o plano."
    }
    fn input_schema(&self) -> Value {
        if !self.steps {
            return json!({
                "type": "object",
                "properties": {"plan": {"type": "string", "description": "o plano em markdown"}},
                "required": ["plan"],
                "additionalProperties": false
            });
        }
        json!({
            "type": "object",
            "properties": {
                "plan": {"type": "string", "description": "o plano em markdown"},
                "steps": {
                    "type": "array",
                    "description": "os passos do plano, cada um com os ficheiros (e linhas, se já as conheces) que vai mexer",
                    "items": {
                        "type": "object",
                        "properties": {
                            "text": {"type": "string"},
                            "files": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "path": {"type": "string"},
                                        "start": {"type": "integer", "minimum": 1},
                                        "end": {"type": "integer", "minimum": 1}
                                    },
                                    "required": ["path"],
                                    "additionalProperties": false
                                }
                            }
                        },
                        "required": ["text"],
                        "additionalProperties": false
                    }
                }
            },
            "required": ["plan"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        false // passa pela aprovação humana
    }
    fn mutates_files(&self) -> bool {
        false
    }
    fn run(&self, _input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        // runs only after the human approved it (the policy always asks for exit_plan)
        if let Some(a) = &self.approved {
            a.store(true, Ordering::SeqCst);
            self.plan_mode.store(false, Ordering::SeqCst);
            return ToolOutput::ok(
                "Plano aprovado pelo humano: executa-o, regista-o com todo_write e verifica cada \
                 passo. O que não estiver no plano não o faças: sugere-o com suggest.",
            );
        }
        if !self.plan_mode.swap(false, Ordering::SeqCst) {
            return ToolOutput::err("não estás em modo plano: executa directamente");
        }
        ToolOutput::ok(
            "Plano aprovado pelo humano. O modo plano terminou: executa o plano, regista-o com \
             todo_write e verifica cada passo.",
        )
    }
}

/// O que um sub-agente precisa para correr.
#[derive(Clone)]
pub struct SubagentSpec {
    pub provider: Arc<dyn Provider>,
    pub model: String,
    pub effort: Effort,
    /// Língua em que o sub-agente responde (a da sessão: a interface quando ela começou).
    pub lang: crate::context::ReplyLang,
}

/// `task`: lança um sub-agente só de leitura, com contexto próprio, e devolve o relatório.
/// É só leitura, por isso vários podem correr em paralelo no mesmo turno.
pub struct Task {
    pub spec: SubagentSpec,
    /// Toolset 5: the sub-agent may take a role (reviewer, tester, architect), each with its
    /// own brief (A3 HARNESS-06). All of them only read.
    pub roles: bool,
}

/// The briefs of the roles (all read-only: a sub-agent runs without asking for approval).
fn role_brief(role: &str) -> &'static str {
    match role {
        "reviewer" => "És o revisor do Co-Dev do dxtutor IDE. Lê as alterações em curso (git_diff, git_status) e o \
código à volta e procura defeitos reais: erros de lógica, casos limite, regressões, riscos de segurança, testes em falta. \
Para cada achado dá o ficheiro e a linha, a gravidade (alta/média/baixa) e porquê. Não inventes problemas; se não encontras \
nada relevante, diz isso. Só tens ferramentas de leitura.",
        "tester" => "És o testador do Co-Dev do dxtutor IDE. Mapeia os testes que existem para o que te pedem (onde estão, \
o que cobrem) e o que fica por testar: casos limite, erros, integrações. Propõe os casos de teste em falta, com o ficheiro \
onde iriam e o que verificam. Não corres comandos: só tens ferramentas de leitura.",
        "architect" => "És o arquitecto do Co-Dev do dxtutor IDE. Mapeia os módulos, as dependências e as fronteiras que \
interessam ao pedido, com caminhos de ficheiros. Propõe até três opções de desenho com as suas consequências e recomenda \
uma, explicando porquê. Não alteras nada: só tens ferramentas de leitura.",
        _ => SUBAGENT_PROMPT,
    }
}

const SUBAGENT_PROMPT: &str = "És um sub-agente de investigação do Co-Dev do dxtutor IDE. \
Tens só ferramentas de leitura (read, glob, grep, git_status, git_diff). Investiga o que te \
pedem no projecto e responde com um relatório curto e factual: o que encontraste, com \
caminhos de ficheiros e números de linha, e o que não conseguiste confirmar. Não proponhas \
alterações que não te pediram.";

impl Tool for Task {
    fn name(&self) -> &str {
        "task"
    }
    fn description(&self) -> &str {
        "Delega uma investigação só de leitura a um sub-agente com contexto próprio (procurar \
         onde algo está implementado, mapear um módulo, recolher factos dispersos). Devolve o \
         relatório dele. Vários `task` no mesmo turno correm em paralelo."
    }
    fn input_schema(&self) -> Value {
        if !self.roles {
            return json!({
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "3-6 palavras"},
                    "prompt": {"type": "string", "description": "o que investigar, com o contexto necessário"}
                },
                "required": ["description", "prompt"],
                "additionalProperties": false
            });
        }
        json!({
            "type": "object",
            "properties": {
                "description": {"type": "string", "description": "3-6 palavras"},
                "prompt": {"type": "string", "description": "o que fazer, com o contexto necessário"},
                "role": {
                    "enum": ["explorer", "reviewer", "tester", "architect"],
                    "description": "explorer (por omissão): investiga; reviewer: revê as alterações em curso; tester: mapeia os testes e o que falta testar; architect: mapeia módulos e propõe opções de desenho"
                }
            },
            "required": ["description", "prompt"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let prompt = input["prompt"].as_str().unwrap_or_default();
        let tools: Vec<Arc<dyn Tool>> = coding_tools(&ToolsetOptions::default())
            .into_iter()
            .filter(|t| t.read_only())
            .collect();
        let mut cfg = AgentConfig::new(self.spec.model.clone());
        cfg.effort = self.spec.effort;
        cfg.max_iterations = 30;
        let role = if self.roles {
            input["role"].as_str().unwrap_or("explorer")
        } else {
            "explorer"
        };
        cfg.system = vec![SystemBlock {
            text: format!("{} {}", role_brief(role), self.spec.lang.reply_rule()),
            cache: true,
        }];
        let child_ctx = ToolCtx {
            root: PathBuf::from(&ctx.root),
            cancel: ctx.cancel.clone(),
        };
        let child = Agent::new(self.spec.provider.clone(), tools, cfg, child_ctx);
        let mut t = Transcript::new();
        let mut usage = (0u64, 0u64);
        let r = child.run_turn(
            &mut t,
            Some(Message::user_text(prompt)),
            &mut |e| {
                if let crate::agent::AgentEvent::Usage { turn, .. } = e {
                    usage = (
                        turn.input_tokens + turn.cache_read_input_tokens,
                        turn.output_tokens,
                    );
                }
            },
            &mut |_| Decision::Allow, // só ferramentas de leitura
        );
        let report = t.last().map(|m| m.text()).unwrap_or_default();
        match r {
            Ok(_) if !report.trim().is_empty() => ToolOutput::ok(format!(
                "{report}\n\n[sub-agente: {} mensagens, {} tokens de entrada, {} de saída]",
                t.len(),
                usage.0,
                usage.1
            )),
            Ok(o) => ToolOutput::err(format!("o sub-agente terminou sem relatório ({o:?})")),
            Err(e) => ToolOutput::err(format!("o sub-agente falhou: {e}")),
        }
    }
}

/// Toolset 6 (RF-G06): when the request is ambiguous or contradicts the architect's rules,
/// the agent asks instead of choosing. Read-only: it records the question; the policy then
/// refuses any change until the human answers in the next message.
pub struct AskHuman {
    pub question: Arc<Mutex<Option<String>>>,
}

impl Tool for AskHuman {
    fn name(&self) -> &str {
        "ask_human"
    }
    fn description(&self) -> &str {
        "Quando o pedido é ambíguo, contradiz as regras do projecto/arquitecto, ou falta uma \
         decisão que é do humano (âmbito, prioridade, abordagem), pergunta em vez de escolher. \
         Depois desta ferramenta não alteres mais nada: termina a resposta; o humano responde \
         na próxima mensagem."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "a pergunta, curta e concreta"},
                "options": {"type": "array", "items": {"type": "string"}, "description": "as opções, se as houver"}
            },
            "required": ["question"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn mutates_files(&self) -> bool {
        false
    }
    fn run(&self, input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        let q = input["question"].as_str().unwrap_or("").trim().to_string();
        if q.is_empty() {
            return ToolOutput::err("a pergunta está vazia");
        }
        let opts: Vec<&str> = input["options"]
            .as_array()
            .map(|a| a.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let text = if opts.is_empty() {
            q
        } else {
            format!("{q} ({})", opts.join(" / "))
        };
        *self.question.lock().unwrap() = Some(text);
        ToolOutput::ok(
            "Pergunta entregue ao humano. Pára aqui: termina a resposta sem mais ferramentas; \
             nada muda até ele responder.",
        )
    }
}

/// Toolset 6 (RF-G02/B05): something outside the request is suggested, never done; the host
/// puts it in the Project inbox, where a human accepts or rejects it.
pub struct Suggest {
    pub suggestions: Arc<Mutex<Vec<(String, String)>>>,
}

impl Tool for Suggest {
    fn name(&self) -> &str {
        "suggest"
    }
    fn description(&self) -> &str {
        "Algo que reparaste fora do pedido (outra correcção, uma melhoria, uma issue nova): não \
         o faças nem o metas neste trabalho — sugere-o. Vai para a caixa de entrada do Project e \
         o humano decide."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "a sugestão numa linha"},
                "why": {"type": "string", "description": "porquê, e onde (ficheiro e linhas)"}
            },
            "required": ["title"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn mutates_files(&self) -> bool {
        false
    }
    fn run(&self, input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        let title = input["title"].as_str().unwrap_or("").trim().to_string();
        if title.is_empty() {
            return ToolOutput::err("a sugestão não tem título");
        }
        let why = input["why"].as_str().unwrap_or("").trim().to_string();
        self.suggestions.lock().unwrap().push((title, why));
        ToolOutput::ok("Sugestão registada na caixa de entrada do Project. Não a implementes.")
    }
}

/// Toolset 7 (RF-B06/G04): the end of an issue. Co-Dev answers every acceptance criterion
/// with met / not met and the proof (a test, a line, an output); the host keeps the table on
/// the issue and sends it to Review. After it the agent changes nothing more — in Auto too.
pub struct FinishIssue {
    pub criteria: Arc<Mutex<Vec<String>>>,
    pub finished: Arc<Mutex<Option<Value>>>,
}

impl Tool for FinishIssue {
    fn name(&self) -> &str {
        "finish_issue"
    }
    fn description(&self) -> &str {
        "No fim de uma issue, responde a cada critério de aceitação: cumprido ou não, com a \
         prova (teste, ficheiro:linha, saída de um comando). A issue passa a Review (o Done é \
         sempre do humano) e não alteras mais nada a seguir."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "criteria": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer", "minimum": 1, "description": "o número do critério (1, 2, …)"},
                            "met": {"type": "boolean"},
                            "evidence": {"type": "string", "description": "a prova: teste, ficheiro:linha, saída"}
                        },
                        "required": ["index", "met", "evidence"],
                        "additionalProperties": false
                    }
                },
                "summary": {"type": "string"}
            },
            "required": ["criteria"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn mutates_files(&self) -> bool {
        false
    }
    fn run(&self, input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        let criteria = self.criteria.lock().unwrap().clone();
        if criteria.is_empty() {
            return ToolOutput::err(
                "este pedido não é uma issue com critérios: não há nada para fechar",
            );
        }
        let given = input["criteria"].as_array().cloned().unwrap_or_default();
        let mut rows: Vec<Option<Value>> = vec![None; criteria.len()];
        for g in &given {
            let i = g["index"].as_u64().unwrap_or(0) as usize;
            if i == 0 || i > criteria.len() {
                return ToolOutput::err(format!("critério {i} não existe (há {})", criteria.len()));
            }
            let evidence = g["evidence"].as_str().unwrap_or("").trim();
            if evidence.is_empty() {
                return ToolOutput::err(format!("o critério {i} precisa de uma prova"));
            }
            rows[i - 1] = Some(json!({
                "index": i,
                "criterion": criteria[i - 1],
                "met": g["met"].as_bool().unwrap_or(false),
                "evidence": evidence,
            }));
        }
        let missing: Vec<String> = rows
            .iter()
            .enumerate()
            .filter(|(_, r)| r.is_none())
            .map(|(i, _)| (i + 1).to_string())
            .collect();
        if !missing.is_empty() {
            return ToolOutput::err(format!(
                "responde a todos os critérios: faltam {}",
                missing.join(", ")
            ));
        }
        let table: Vec<Value> = rows.into_iter().flatten().collect();
        let met = table.iter().filter(|r| r["met"] == true).count();
        *self.finished.lock().unwrap() = Some(json!({
            "criteria": table,
            "summary": input["summary"].as_str().unwrap_or(""),
        }));
        ToolOutput::ok(format!(
            "Registado: {met}/{} critérios cumpridos. A issue passa a Review e o Done é do humano. \
             Termina aqui, sem mais alterações.",
            criteria.len()
        ))
    }
}
