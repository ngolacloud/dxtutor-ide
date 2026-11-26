//! O loop do agente: pede ao modelo, executa as ferramentas que ele pede, devolve os
//! resultados, e repete até o modelo terminar o turno (`stop_reason`).
//!
//! Garantias:
//! - o histórico só cresce, e fica **sempre válido** para continuar: um `tool_use` no
//!   histórico tem sempre o seu `tool_result` a seguir (mesmo em cancelamento);
//! - respostas que não se podem usar (recusa, `max_tokens` a meio de uma ferramenta)
//!   **não** entram no histórico — nunca foram enviadas, por isso não é uma edição;
//! - nenhuma ferramenta corre com input inválido, desconhecida ou sem aprovação;
//! - leituras do mesmo turno correm em paralelo; mutações em série, pela ordem pedida;
//! - todos os resultados de um turno voltam numa só mensagem.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::hunks::{
    Check, HunkOp, HunkTracker, LineCount, LineRange, RejectedBy, ValidationStatus,
};
use crate::provider::{
    Effort, Provider, ProviderError, Request, Response, StopReason, StreamEvent, SystemBlock,
    ThinkingDisplay, Usage,
};
use crate::retry;
use crate::schema;
use crate::tool::{Tool, ToolCtx, ToolOutput};
use crate::types::{Message, Role, ToolResult, Transcript};

/// Tamanho máximo de um resultado de ferramenta devolvido ao modelo (as ferramentas de
/// F2 truncam primeiro com critério próprio e dizem como pedir o resto; isto é a rede de
/// segurança do loop, para MCP, sub-agentes e o resto). Cada resultado fica no histórico e é
/// reenviado em todos os pedidos seguintes: ~30k caracteres (~8k tokens) chegam para um
/// excerto útil, e o modelo pede mais quando precisa.
pub const MAX_RESULT_CHARS: usize = 30_000;
/// Repetições de um pedido cujo stream falhou a meio (overloaded, rede).
pub const MID_STREAM_RETRIES: u32 = 2;
/// `max_tokens` usado para repetir uma resposta cortada a meio de uma ferramenta.
pub const MAX_TOKENS_CEILING: u32 = 128_000;

#[derive(Debug, Clone)]
pub struct AgentConfig {
    pub model: String,
    pub system: Vec<SystemBlock>,
    pub effort: Effort,
    pub thinking: ThinkingDisplay,
    pub max_tokens: u32,
    pub fallbacks: bool,
    /// Pedidos ao modelo por turno do utilizador (decisão do plano: 60).
    pub max_iterations: u32,
    /// Compactação no servidor (Claude).
    pub compaction: bool,
}

impl AgentConfig {
    pub fn new(model: impl Into<String>) -> Self {
        let base = Request::new(model, vec![]);
        AgentConfig {
            model: base.model,
            system: vec![],
            effort: base.effort,
            thinking: base.thinking,
            max_tokens: base.max_tokens,
            fallbacks: base.fallbacks,
            max_iterations: 60,
            compaction: base.compaction,
        }
    }
}

/// Uma chamada à espera de decisão.
#[derive(Debug, Clone, Serialize)]
pub struct PendingCall {
    pub id: String,
    pub name: String,
    pub input: Value,
    pub read_only: bool,
    /// O comando de shell que a chamada vai correr (bash, run_tests, lint), para o
    /// classificador de permissões.
    pub command: Option<String>,
    /// The hunks this `edit`/`write` would apply, when the host turned hunks on
    /// ([`Agent::hunks`]); the host may decide them one by one ([`Decision::Hunks`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hunks: Vec<String>,
}

/// A decisão sobre uma chamada (modo de aprovação: F3; aqui é o anfitrião que decide).
#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    Allow,
    Deny(String),
    /// For a call with hunks: apply only `accepted`; the others are rejected, with the
    /// reason in `rejected` when there is one. `provisional`: Auto mode, which validation
    /// may still undo (RF-CODEV-STREAM §5).
    Hunks {
        accepted: Vec<String>,
        rejected: Vec<(String, String)>,
        provisional: bool,
    },
}

/// Como acabou um turno.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TurnOutcome {
    /// O modelo terminou. `truncated`: a resposta de texto foi cortada por `max_tokens`.
    Done {
        truncated: bool,
    },
    /// O modelo (e os fallbacks) recusaram. Nada desta resposta entrou no histórico.
    Refused {
        details: Option<Value>,
    },
    Cancelled,
    /// Limite de pedidos atingido; o histórico está pronto para continuar.
    IterationLimit,
}

/// Eventos do loop para a UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentEvent {
    /// Evento em tempo real do modelo (texto, thinking, input de ferramenta…).
    Stream {
        event: StreamEvent,
    },
    /// O stream falhou a meio e o pedido vai ser repetido: a UI descarta o parcial.
    Retrying {
        attempt: u32,
        reason: String,
    },
    /// RF-G07: o humano parou o turno e ficaram ficheiros alterados — o IDE oferece mantê-los ou
    /// descartá-los (voltar ao `checkpoint` do turno).
    StopReview {
        checkpoint: u32,
        files: Vec<String>,
    },
    /// Uma ferramenta vai correr (já validada e aprovada).
    ToolStart {
        id: String,
        name: String,
        input: Value,
    },
    /// O resultado de uma ferramenta (também para recusas, inválidos e cancelamentos).
    ToolResult {
        id: String,
        name: String,
        is_error: bool,
        content: String,
    },
    /// Tokens do último pedido e o total do turno.
    Usage {
        request: Usage,
        turn: Usage,
    },
    /// O modelo que respondeu, quando difere do pedido (fallback do servidor).
    ServedBy {
        model: String,
    },
    /// Checkpoint dos ficheiros tirado antes da primeira alteração deste turno.
    Checkpoint {
        id: u32,
        label: String,
    },
    /// Aviso para o humano (ex.: não foi possível tirar o checkpoint).
    Notice {
        text: String,
    },
    /// The agent asked the human instead of choosing (`ask_human`, RF-G06); sent by the host
    /// when the turn ends. The issue of the turn, if any, is blocked with the question.
    Question {
        text: String,
    },
    /// A hunk of an `edit`/`write` starts streaming (docs/v2/RF-CODEV-STREAM.md §3).
    /// `range` is in the file as it was at `base`; `old` is the text it replaces.
    HunkStart {
        hunk: String,
        call: String,
        path: String,
        op: HunkOp,
        range: LineRange,
        base: Option<String>,
        old: String,
    },
    /// New text for the hunk, in order.
    HunkChunk {
        hunk: String,
        text: String,
    },
    /// The hunk is complete; `text` is the concatenation of its chunks.
    HunkEnd {
        hunk: String,
        text: String,
        lines: LineCount,
    },
    /// The host waits for a decision on these hunks (all of the same call).
    HunkReview {
        call: String,
        hunks: Vec<String>,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        why: Option<String>,
        /// RF-A03/A04: the architect's rules the change breaks — the IDE shows it in red and it is
        /// accepted only after the architect's override with an accepted ADR.
        #[serde(skip_serializing_if = "Vec::is_empty")]
        violations: Vec<crate::conformance::Violation>,
    },
    /// The hunk was written to disk (`provisional`: Auto, pending validation).
    HunkApplied {
        hunk: String,
        provisional: bool,
        fingerprint: String,
    },
    HunkRejected {
        hunk: String,
        by: RejectedBy,
        reason: String,
    },
    /// The file changed before the decision; the hunk was not applied.
    HunkStale {
        hunk: String,
        path: String,
    },
    /// The report of the turn, built from its events (HARNESS-07; emitted by the host
    /// before `done`).
    Report {
        title: String,
        markdown: String,
    },
    /// Validation of the turn's provisional changes (Auto mode; emitted by the host).
    /// `baseline`: the same commands before the first change of the turn.
    Validation {
        status: ValidationStatus,
        checks: Vec<Check>,
        baseline: Vec<Check>,
    },
    Done {
        outcome: TurnOutcome,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub enum AgentError {
    /// Falha do provedor depois dos retries. O histórico termina numa mensagem do
    /// utilizador: chamar [`Agent::run_turn`] com `None` repete a partir daí.
    Provider(ProviderError),
    /// Resposta cortada a meio de uma ferramenta mesmo com o tecto de `max_tokens`.
    MaxTokensExhausted,
    /// `stop_reason` que o loop não sabe tratar.
    UnexpectedStop(String),
    /// `run_turn(None)` com um histórico que não termina no utilizador.
    NothingToContinue,
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentError::Provider(e) => write!(f, "{e}"),
            AgentError::MaxTokensExhausted => write!(
                f,
                "a resposta excedeu o máximo de tokens a meio de uma ferramenta"
            ),
            AgentError::UnexpectedStop(s) => {
                write!(f, "o modelo parou por um motivo desconhecido: {s}")
            }
            AgentError::NothingToContinue => write!(f, "não há nada para continuar"),
        }
    }
}

impl std::error::Error for AgentError {}

type Sleeper = Arc<dyn Fn(Duration) + Send + Sync>;

/// A call whose accepted hunks are applied in place of running `edit`/`write`.
struct HunkJob {
    plan: crate::hunks::Plan,
    accepted: std::collections::HashSet<String>,
    reasons: HashMap<String, String>,
    provisional: bool,
}

/// Estado de um turno partilhado entre os pedidos ao modelo desse turno.
struct TurnState {
    /// O pedido do utilizador que abriu o turno (rótulo do checkpoint).
    label: String,
    /// Já se tirou o checkpoint deste turno?
    checkpointed: bool,
}

pub struct Agent {
    provider: Arc<dyn Provider>,
    tools: Vec<Arc<dyn Tool>>,
    pub cfg: AgentConfig,
    pub ctx: ToolCtx,
    sleep: Sleeper,
    /// Checkpoints dos ficheiros (só em repositórios git).
    pub checkpoints: Option<Arc<crate::checkpoint::Checkpoints>>,
    /// Hooks do projecto (só se o humano confiou neles).
    pub hooks: Option<Arc<crate::hooks::Hooks>>,
    /// Live hunks (RF-CODEV-STREAM): with the tools' read/edit/write state, `edit` and
    /// `write` stream hunks and apply only what is accepted. `None`: they write directly.
    pub hunks: Option<Arc<crate::tools::FileState>>,
}

fn add_usage(t: &mut Usage, u: &Usage) {
    t.input_tokens += u.input_tokens;
    t.output_tokens += u.output_tokens;
    t.cache_read_input_tokens += u.cache_read_input_tokens;
    t.cache_creation_input_tokens += u.cache_creation_input_tokens;
}

/// Corta um resultado demasiado grande, mantendo o início e o fim, e diz ao modelo como
/// pedir menos de cada vez.
pub fn clip(s: String) -> String {
    let n = s.chars().count();
    if n <= MAX_RESULT_CHARS {
        return s;
    }
    let head: String = s.chars().take(MAX_RESULT_CHARS * 4 / 5).collect();
    let tail: String = s.chars().skip(n - MAX_RESULT_CHARS / 5).collect();
    format!(
        "{head}\n…[resultado truncado: {} de {n} caracteres omitidos do meio. Pede menos de cada \
         vez: `read` com offset/limit, `grep` com path/glob ou mode=\"count\", ou filtra a saída do \
         comando (`| tail -n 80`, `| grep erro`)]…\n{tail}",
        n - MAX_RESULT_CHARS
    )
}

impl Agent {
    pub fn new(
        provider: Arc<dyn Provider>,
        tools: Vec<Arc<dyn Tool>>,
        cfg: AgentConfig,
        ctx: ToolCtx,
    ) -> Self {
        Agent {
            provider,
            tools,
            cfg,
            ctx,
            sleep: Arc::new(std::thread::sleep),
            checkpoints: None,
            hooks: None,
            hunks: None,
        }
    }

    /// Substitui a espera entre repetições (testes).
    pub fn with_sleeper(mut self, f: impl Fn(Duration) + Send + Sync + 'static) -> Self {
        self.sleep = Arc::new(f);
        self
    }

    fn cancelled(&self) -> bool {
        self.ctx.cancel.load(Ordering::Relaxed)
    }

    fn request(&self, t: &Transcript, max_tokens: u32, resume_paused: bool) -> Request {
        Request {
            model: self.cfg.model.clone(),
            system: self.cfg.system.clone(),
            messages: t.messages().to_vec(),
            tools: self.tools.iter().map(|x| x.def()).collect(),
            max_tokens,
            effort: self.cfg.effort,
            thinking: self.cfg.thinking,
            fallbacks: self.cfg.fallbacks,
            resume_paused,
            compaction: self.cfg.compaction,
        }
    }

    /// Um pedido ao modelo, com repetição se o stream falhar a meio.
    fn ask(
        &self,
        req: &Request,
        events: &mut dyn FnMut(AgentEvent),
        mut tracker: Option<&mut HunkTracker>,
    ) -> Result<Response, ProviderError> {
        let mut attempt = 0;
        loop {
            let cancel = self.ctx.cancel.clone();
            let r = self.provider.stream(req, &mut |e| {
                if let Some(t) = tracker.as_deref_mut() {
                    t.on_stream(&e, events);
                }
                events(AgentEvent::Stream { event: e });
                !cancel.load(Ordering::Relaxed)
            });
            let retryable = match &r {
                Err(ProviderError::Stream { kind, .. }) => {
                    matches!(
                        kind.as_str(),
                        "overloaded_error" | "api_error" | "rate_limit_error"
                    )
                }
                Err(ProviderError::Transport(_)) | Err(ProviderError::Protocol(_)) => true,
                _ => false,
            };
            if !retryable || attempt >= MID_STREAM_RETRIES || self.cancelled() {
                return r;
            }
            let reason = r.err().map(|e| e.to_string()).unwrap_or_default();
            if let Some(t) = tracker.as_deref_mut() {
                t.discard(
                    RejectedBy::Cancel,
                    "the response was interrupted and is being repeated",
                    events,
                );
            }
            attempt += 1;
            events(AgentEvent::Retrying { attempt, reason });
            (self.sleep)(retry::backoff(attempt - 1, None));
        }
    }

    /// Corre um turno: acrescenta `user` (se houver) e conversa com o modelo até ele
    /// terminar. `approve` decide cada chamada de ferramenta, pela ordem pedida.
    pub fn run_turn(
        &self,
        transcript: &mut Transcript,
        user: Option<Message>,
        events: &mut dyn FnMut(AgentEvent),
        approve: &mut dyn FnMut(&PendingCall) -> Decision,
    ) -> Result<TurnOutcome, AgentError> {
        match user {
            Some(m) => transcript.push(m),
            None if matches!(
                transcript.last().map(|m| m.role),
                Some(Role::User | Role::System)
            ) => {}
            None => return Err(AgentError::NothingToContinue),
        }
        let by_name: HashMap<&str, &Arc<dyn Tool>> =
            self.tools.iter().map(|t| (t.name(), t)).collect();
        let mut turn = Usage::default();
        let mut resume_paused = false;
        let mut max_tokens = self.cfg.max_tokens;
        // checkpoint: no máximo um por turno, antes da primeira alteração de ficheiros
        let label = transcript
            .messages()
            .iter()
            .rev()
            .find(|m| m.role == Role::User && !m.text().trim().is_empty())
            .map(|m| m.text())
            .unwrap_or_default();
        let mut turn_state = TurnState {
            label,
            checkpointed: false,
        };
        let mut tracker = self
            .hunks
            .as_ref()
            .map(|f| HunkTracker::new(&self.ctx.root, f.clone()));

        for _ in 0..self.cfg.max_iterations {
            if self.cancelled() {
                return Ok(self.finish(TurnOutcome::Cancelled, events, &mut tracker));
            }
            let req = self.request(transcript, max_tokens, resume_paused);
            resume_paused = false;
            let resp = match self.ask(&req, events, tracker.as_mut()) {
                Ok(r) => r,
                Err(ProviderError::Cancelled) => {
                    return Ok(self.finish(TurnOutcome::Cancelled, events, &mut tracker))
                }
                Err(e) => {
                    drop_hunks(&mut tracker, "the request to the model failed", events);
                    return Err(AgentError::Provider(e));
                }
            };
            add_usage(&mut turn, &resp.usage);
            events(AgentEvent::Usage {
                request: resp.usage,
                turn,
            });
            if !resp.model.is_empty() && resp.model != self.cfg.model {
                events(AgentEvent::ServedBy {
                    model: resp.model.clone(),
                });
            }
            let has_tools = resp.content.iter().any(|b| b["type"] == "tool_use");

            match resp.stop_reason {
                StopReason::Refusal => {
                    // pode trazer um tool_use cortado: não entra no histórico, nada corre
                    let details = resp.stop_details.clone();
                    return Ok(self.finish(TurnOutcome::Refused { details }, events, &mut tracker));
                }
                StopReason::MaxTokens if has_tools => {
                    drop_hunks(&mut tracker, "the response was cut short", events);
                    if max_tokens >= MAX_TOKENS_CEILING {
                        return Err(AgentError::MaxTokensExhausted);
                    }
                    max_tokens = MAX_TOKENS_CEILING; // repete com mais espaço, sem anexar
                    continue;
                }
                StopReason::MaxTokens => {
                    transcript.push(Message::assistant(resp.content));
                    return Ok(self.finish(
                        TurnOutcome::Done { truncated: true },
                        events,
                        &mut tracker,
                    ));
                }
                StopReason::EndTurn | StopReason::StopSequence => {
                    transcript.push(Message::assistant(resp.content));
                    return Ok(self.finish(
                        TurnOutcome::Done { truncated: false },
                        events,
                        &mut tracker,
                    ));
                }
                StopReason::PauseTurn | StopReason::Compaction => {
                    transcript.push(Message::assistant(resp.content));
                    resume_paused = true;
                    continue;
                }
                StopReason::ToolUse => {
                    let invalid: HashMap<String, String> =
                        resp.invalid_tool_inputs.iter().cloned().collect();
                    let msg = Message::assistant(resp.content);
                    let calls = msg.tool_uses();
                    transcript.push(msg);
                    let results = self.run_tools(
                        &calls,
                        &invalid,
                        &by_name,
                        events,
                        approve,
                        &mut turn_state,
                        tracker.as_mut(),
                    );
                    transcript.push(Message::tool_results(&results));
                    if self.cancelled() {
                        return Ok(self.finish(TurnOutcome::Cancelled, events, &mut tracker));
                    }
                    max_tokens = self.cfg.max_tokens;
                }
                StopReason::Other(s) => {
                    drop_hunks(&mut tracker, "the model stopped unexpectedly", events);
                    return Err(AgentError::UnexpectedStop(s));
                }
            }
        }
        Ok(self.finish(TurnOutcome::IterationLimit, events, &mut tracker))
    }

    fn finish(
        &self,
        outcome: TurnOutcome,
        events: &mut dyn FnMut(AgentEvent),
        tracker: &mut Option<HunkTracker>,
    ) -> TurnOutcome {
        // no hunk outlives its turn: the UI must not wait on one
        let reason = match &outcome {
            TurnOutcome::Cancelled => "stopped by the user",
            TurnOutcome::Refused { .. } => "the model refused the response",
            _ => "the turn ended before the change was decided",
        };
        drop_hunks(tracker, reason, events);
        if let (Some(h), TurnOutcome::Done { .. }) = (&self.hooks, &outcome) {
            for text in h.stop() {
                events(AgentEvent::Notice { text });
            }
        }
        events(AgentEvent::Done {
            outcome: outcome.clone(),
        });
        outcome
    }

    /// Valida, pede aprovação e executa as chamadas de um turno. Devolve um resultado
    /// por chamada, pela ordem original.
    #[allow(clippy::too_many_arguments)]
    fn run_tools(
        &self,
        calls: &[crate::types::ToolUse],
        invalid: &HashMap<String, String>,
        by_name: &HashMap<&str, &Arc<dyn Tool>>,
        events: &mut dyn FnMut(AgentEvent),
        approve: &mut dyn FnMut(&PendingCall) -> Decision,
        turn: &mut TurnState,
        mut tracker: Option<&mut HunkTracker>,
    ) -> Vec<ToolResult> {
        // 1) validação + aprovação (sequencial: a UI pergunta uma de cada vez)
        let mut out: Vec<Option<ToolOutput>> = vec![None; calls.len()];
        let mut runnable: Vec<(usize, Arc<dyn Tool>)> = vec![];
        let mut ran = vec![false; calls.len()];
        // calls whose accepted hunks are applied instead of running the tool
        let mut hunk_jobs: HashMap<usize, HunkJob> = HashMap::new();
        for (i, c) in calls.iter().enumerate() {
            if self.cancelled() {
                out[i] = Some(ToolOutput::err("cancelado pelo utilizador antes de correr"));
                continue;
            }
            if let Some(raw) = invalid.get(&c.id) {
                out[i] = Some(ToolOutput::err(json!({ "INVALID_JSON": raw }).to_string()));
                continue;
            }
            let Some(tool) = by_name.get(c.name.as_str()) else {
                out[i] = Some(ToolOutput::err(format!(
                    "ferramenta desconhecida: {}",
                    c.name
                )));
                continue;
            };
            if let Err(e) = schema::validate(&tool.input_schema(), &c.input) {
                out[i] = Some(ToolOutput::err(format!("input inválido: {e}")));
                continue;
            }
            // live hunks: the call's plan (same checks as the tool) before asking
            let plan = match tracker
                .as_deref_mut()
                .and_then(|t| t.take_plan(&c.id, &c.name, &c.input, events))
            {
                Some(Err(e)) => {
                    out[i] = Some(ToolOutput::err(e));
                    continue;
                }
                Some(Ok(p)) => Some(p),
                None => None,
            };
            let pending = PendingCall {
                id: c.id.clone(),
                name: c.name.clone(),
                input: c.input.clone(),
                read_only: tool.read_only(),
                command: tool.command_preview(&c.input),
                hunks: plan.as_ref().map(|p| p.ids()).unwrap_or_default(),
            };
            let allowed: Result<(), String> = match (approve(&pending), plan) {
                (Decision::Deny(why), plan) => {
                    if let (Some(p), Some(t)) = (&plan, tracker.as_deref_mut()) {
                        let by = if self.cancelled() {
                            RejectedBy::Cancel
                        } else {
                            RejectedBy::Human
                        };
                        t.reject(p, by, &why, events);
                    }
                    Err(why)
                }
                (Decision::Allow, Some(plan)) => {
                    let accepted = plan.ids().into_iter().collect();
                    hunk_jobs.insert(
                        i,
                        HunkJob {
                            plan,
                            accepted,
                            reasons: HashMap::new(),
                            provisional: false,
                        },
                    );
                    Ok(())
                }
                (Decision::Allow, None) => Ok(()),
                (
                    Decision::Hunks {
                        accepted,
                        rejected,
                        provisional,
                    },
                    Some(plan),
                ) => {
                    hunk_jobs.insert(
                        i,
                        HunkJob {
                            plan,
                            accepted: accepted.into_iter().collect(),
                            reasons: rejected.into_iter().collect(),
                            provisional,
                        },
                    );
                    Ok(())
                }
                // a per-hunk answer for a call without hunks: all or nothing
                (
                    Decision::Hunks {
                        accepted, rejected, ..
                    },
                    None,
                ) => {
                    if accepted.is_empty() {
                        Err(rejected
                            .into_iter()
                            .next()
                            .map(|(_, r)| r)
                            .unwrap_or_else(|| "recusado".into()))
                    } else {
                        Ok(())
                    }
                }
            };
            match allowed {
                Ok(()) => {
                    // hooks pre_tool do projecto: podem bloquear (exit 2)
                    let blocked = match &self.hooks {
                        Some(h) => {
                            let (outcome, notes) = h.pre_tool(&c.name, &c.input);
                            for text in notes {
                                events(AgentEvent::Notice { text });
                            }
                            match outcome {
                                crate::hooks::PreOutcome::Block(why) => Some(why),
                                crate::hooks::PreOutcome::Allow => None,
                            }
                        }
                        None => None,
                    };
                    match blocked {
                        Some(why) => {
                            if let (Some(job), Some(t)) =
                                (hunk_jobs.remove(&i), tracker.as_deref_mut())
                            {
                                t.reject(&job.plan, RejectedBy::Validation, &why, events);
                            }
                            out[i] = Some(ToolOutput::err(format!(
                                "bloqueado por um hook do projecto: {why}"
                            )));
                        }
                        None => runnable.push((i, Arc::clone(tool))),
                    }
                }
                Err(why) => {
                    out[i] = Some(ToolOutput::err(format!(
                        "o humano não autorizou esta chamada: {why}"
                    )));
                }
            }
        }

        // 2) execução: grupos consecutivos de leituras em paralelo, mutações em série
        let mut k = 0;
        while k < runnable.len() {
            if self.cancelled() {
                for (i, _) in &runnable[k..] {
                    out[*i] = Some(ToolOutput::err("cancelado pelo utilizador antes de correr"));
                }
                break;
            }
            let ro = runnable[k].1.read_only();
            let end = if ro {
                runnable[k..]
                    .iter()
                    .position(|(_, t)| !t.read_only())
                    .map(|p| k + p)
                    .unwrap_or(runnable.len())
            } else {
                k + 1
            };
            if !turn.checkpointed && runnable[k..end].iter().any(|(_, t)| t.mutates_files()) {
                turn.checkpointed = true;
                if let Some(cps) = &self.checkpoints {
                    match cps.snapshot(&turn.label) {
                        Ok(cp) => events(AgentEvent::Checkpoint {
                            id: cp.id,
                            label: cp.label,
                        }),
                        Err(e) => events(AgentEvent::Notice {
                            text: format!("não foi possível criar o checkpoint: {e}"),
                        }),
                    }
                }
            }
            for (i, t) in &runnable[k..end] {
                events(AgentEvent::ToolStart {
                    id: calls[*i].id.clone(),
                    name: t.name().to_string(),
                    input: calls[*i].input.clone(),
                });
            }
            let group = &runnable[k..end];
            let job = if group.len() == 1 {
                hunk_jobs.remove(&group[0].0)
            } else {
                None
            };
            let results: Vec<ToolOutput> = if let (Some(job), Some(files)) = (job, &self.hunks) {
                let r = crate::hunks::apply(
                    &job.plan,
                    &job.accepted,
                    &job.reasons,
                    job.provisional,
                    files,
                    &self.ctx.root,
                    events,
                );
                if let Some(t) = tracker.as_deref_mut() {
                    t.settle(&job.plan);
                }
                vec![r]
            } else if group.len() == 1 {
                vec![group[0].1.run(&calls[group[0].0].input, &self.ctx)]
            } else {
                std::thread::scope(|s| {
                    let hs: Vec<_> = group
                        .iter()
                        .map(|(i, t)| {
                            let input = &calls[*i].input;
                            let ctx = &self.ctx;
                            s.spawn(move || t.run(input, ctx))
                        })
                        .collect();
                    hs.into_iter()
                        .map(|h| {
                            h.join()
                                .unwrap_or_else(|_| ToolOutput::err("a ferramenta falhou (panic)"))
                        })
                        .collect()
                })
            };
            for ((i, _), r) in group.iter().zip(results) {
                out[*i] = Some(r);
                ran[*i] = true;
            }
            k = end;
        }

        // calls that did not get to run (cancelled): their hunks are rejected
        if let Some(t) = tracker {
            t.discard(RejectedBy::Cancel, "the call did not run", events);
        }

        calls
            .iter()
            .zip(out)
            .zip(ran)
            .map(|((c, o), ran)| {
                let mut o = o.unwrap_or_else(|| ToolOutput::err("não executada"));
                // hooks post_tool do projecto: feedback (exit 2) vai junto do resultado
                if let (true, Some(h)) = (ran, &self.hooks) {
                    let (feedback, notes) = h.post_tool(&c.name, &c.input, &o.content, o.is_error);
                    for text in notes {
                        events(AgentEvent::Notice { text });
                    }
                    if let Some(fb) = feedback {
                        o.content.push_str(&format!("\n\n[hook do projecto] {fb}"));
                    }
                }
                let content = clip(o.content);
                events(AgentEvent::ToolResult {
                    id: c.id.clone(),
                    name: c.name.clone(),
                    is_error: o.is_error,
                    content: content.clone(),
                });
                ToolResult {
                    tool_use_id: c.id.clone(),
                    content,
                    is_error: o.is_error,
                }
            })
            .collect()
    }
}

/// Rejects every hunk still open (`by: cancel`).
fn drop_hunks(tracker: &mut Option<HunkTracker>, reason: &str, events: &mut dyn FnMut(AgentEvent)) {
    if let Some(t) = tracker.as_mut() {
        t.discard(RejectedBy::Cancel, reason, events);
    }
}

/// Atalho para hosts: cancela uma sessão (o loop pára no próximo ponto de verificação).
pub fn cancel(flag: &AtomicBool) {
    flag.store(true, Ordering::Relaxed);
}
