//! O loop do agente contra um provedor falso guionado (sem rede): cada teste dá a
//! sequência de respostas do "modelo" e verifica o histórico, os eventos, os pedidos
//! enviados e o que as ferramentas fizeram.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tutor_agent::{
    Agent, AgentConfig, AgentError, AgentEvent, Decision, Message, PendingCall, Provider,
    ProviderError, Request, Response, Role, StopReason, StreamEvent, Tool, ToolCtx, ToolOutput,
    Transcript, TurnOutcome, Usage,
};

// ───── provedor guionado ─────

struct Scripted {
    replies: Mutex<VecDeque<Result<Response, ProviderError>>>,
    requests: Mutex<Vec<Request>>,
}

impl Scripted {
    fn new(replies: Vec<Result<Response, ProviderError>>) -> Arc<Self> {
        Arc::new(Scripted {
            replies: Mutex::new(replies.into()),
            requests: Mutex::new(vec![]),
        })
    }
    fn requests(&self) -> Vec<Request> {
        self.requests.lock().unwrap().clone()
    }
}

impl Provider for Scripted {
    fn stream(
        &self,
        req: &Request,
        on_event: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<Response, ProviderError> {
        self.requests.lock().unwrap().push(req.clone());
        if !on_event(StreamEvent::Ping) {
            return Err(ProviderError::Cancelled);
        }
        self.replies
            .lock()
            .unwrap()
            .pop_front()
            .expect("o guião acabou")
    }
}

fn resp(stop: StopReason, content: Vec<Value>) -> Result<Response, ProviderError> {
    Ok(Response {
        id: "msg".into(),
        model: "claude-opus-5-5".into(),
        content,
        stop_reason: stop,
        stop_details: None,
        usage: Usage {
            input_tokens: 10,
            output_tokens: 5,
            ..Default::default()
        },
        invalid_tool_inputs: vec![],
    })
}

fn text(t: &str) -> Value {
    json!({"type": "text", "text": t})
}

fn call(id: &str, name: &str, input: Value) -> Value {
    json!({"type": "tool_use", "id": id, "name": name, "input": input})
}

// ───── ferramentas falsas ─────

type OnRun = Arc<dyn Fn(&ToolCtx) + Send + Sync>;

/// Regista quando correu (para verificar paralelismo/ordem) e devolve o input.
struct Probe {
    name: &'static str,
    ro: bool,
    sleep_ms: u64,
    log: Arc<Mutex<Vec<(String, Instant, Instant)>>>,
    on_run: Option<OnRun>,
}

impl Tool for Probe {
    fn name(&self) -> &str {
        self.name
    }
    fn description(&self) -> &str {
        "sonda"
    }
    fn input_schema(&self) -> Value {
        json!({"type": "object", "properties": {"x": {"type": "string"}}, "required": ["x"], "additionalProperties": false})
    }
    fn read_only(&self) -> bool {
        self.ro
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let t0 = Instant::now();
        std::thread::sleep(Duration::from_millis(self.sleep_ms));
        if let Some(f) = &self.on_run {
            f(ctx);
        }
        self.log
            .lock()
            .unwrap()
            .push((self.name.to_string(), t0, Instant::now()));
        ToolOutput::ok(format!(
            "{}:{}",
            self.name,
            input["x"].as_str().unwrap_or("")
        ))
    }
}

type Log = Arc<Mutex<Vec<(String, Instant, Instant)>>>;

fn probe(name: &'static str, ro: bool, sleep_ms: u64, log: &Log) -> Arc<dyn Tool> {
    Arc::new(Probe {
        name,
        ro,
        sleep_ms,
        log: log.clone(),
        on_run: None,
    })
}

struct Harness {
    agent: Agent,
    provider: Arc<Scripted>,
    cancel: Arc<AtomicBool>,
    sleeps: Arc<Mutex<Vec<Duration>>>,
}

fn harness(replies: Vec<Result<Response, ProviderError>>, tools: Vec<Arc<dyn Tool>>) -> Harness {
    let provider = Scripted::new(replies);
    let cancel = Arc::new(AtomicBool::new(false));
    let sleeps = Arc::new(Mutex::new(vec![]));
    let s2 = sleeps.clone();
    let ctx = ToolCtx {
        root: PathBuf::from("/tmp/ws"),
        cancel: cancel.clone(),
    };
    let agent = Agent::new(
        provider.clone(),
        tools,
        AgentConfig::new("claude-opus-5-5"),
        ctx,
    )
    .with_sleeper(move |d| s2.lock().unwrap().push(d));
    Harness {
        agent,
        provider,
        cancel,
        sleeps,
    }
}

fn run(
    h: &Harness,
    t: &mut Transcript,
    user: Option<&str>,
    approve: &mut dyn FnMut(&PendingCall) -> Decision,
) -> (Result<TurnOutcome, AgentError>, Vec<AgentEvent>) {
    let mut evs = vec![];
    let r = h.agent.run_turn(
        t,
        user.map(Message::user_text),
        &mut |e| evs.push(e),
        approve,
    );
    (r, evs)
}

fn allow(_: &PendingCall) -> Decision {
    Decision::Allow
}

fn results_of(m: &Message) -> Vec<(String, String, bool)> {
    m.content
        .iter()
        .map(|b| {
            (
                b["tool_use_id"].as_str().unwrap().to_string(),
                b["content"].as_str().unwrap().to_string(),
                b["is_error"] == true,
            )
        })
        .collect()
}

// ───── testes ─────

#[test]
fn tool_use_then_result_then_end_turn() {
    let log: Log = Default::default();
    let h = harness(
        vec![
            resp(
                StopReason::ToolUse,
                vec![text("Vou ver."), call("t1", "read", json!({"x": "a.rs"}))],
            ),
            resp(StopReason::EndTurn, vec![text("Feito.")]),
        ],
        vec![probe("read", true, 0, &log)],
    );
    let mut t = Transcript::new();
    let (r, evs) = run(&h, &mut t, Some("lê a.rs"), &mut allow);
    assert_eq!(r.unwrap(), TurnOutcome::Done { truncated: false });

    let roles: Vec<Role> = t.messages().iter().map(|m| m.role).collect();
    assert_eq!(
        roles,
        [Role::User, Role::Assistant, Role::User, Role::Assistant]
    );
    assert_eq!(
        results_of(&t.messages()[2]),
        [("t1".into(), "read:a.rs".into(), false)]
    );
    assert_eq!(t.messages()[3].text(), "Feito.");

    // o segundo pedido levou o tool_result e as definições das ferramentas
    let reqs = h.provider.requests();
    assert_eq!(reqs.len(), 2);
    assert_eq!(reqs[1].messages.len(), 3);
    assert_eq!(reqs[1].tools[0].name, "read");
    assert!(evs
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolStart { name, .. } if name == "read")));
    assert!(evs
        .iter()
        .any(|e| matches!(e, AgentEvent::Usage { turn, .. } if turn.input_tokens == 20)));
    assert!(matches!(evs.last(), Some(AgentEvent::Done { .. })));
}

#[test]
fn reads_run_in_parallel_mutations_in_order_results_in_one_message() {
    let log: Log = Default::default();
    let h = harness(
        vec![
            resp(
                StopReason::ToolUse,
                vec![
                    call("a", "ra", json!({"x": "1"})),
                    call("b", "rb", json!({"x": "2"})),
                    call("c", "w", json!({"x": "3"})),
                    call("d", "rd", json!({"x": "4"})),
                ],
            ),
            resp(StopReason::EndTurn, vec![text("ok")]),
        ],
        vec![
            probe("ra", true, 150, &log),
            probe("rb", true, 150, &log),
            probe("w", false, 10, &log),
            probe("rd", true, 10, &log),
        ],
    );
    let mut t = Transcript::new();
    run(&h, &mut t, Some("vai"), &mut allow).0.unwrap();

    let log = log.lock().unwrap();
    let get = |n: &str| log.iter().find(|(x, ..)| x == n).cloned().unwrap();
    let (a, b, w, d) = (get("ra"), get("rb"), get("w"), get("rd"));
    assert!(
        a.1 < b.2 && b.1 < a.2,
        "as leituras ra/rb deviam sobrepor-se"
    );
    assert!(
        w.1 >= a.2 && w.1 >= b.2,
        "a mutação só começa depois das leituras anteriores"
    );
    assert!(d.1 >= w.2, "a leitura seguinte espera pela mutação");

    // uma só mensagem, pela ordem pedida
    let ids: Vec<String> = results_of(&t.messages()[2])
        .into_iter()
        .map(|r| r.0)
        .collect();
    assert_eq!(ids, ["a", "b", "c", "d"]);
}

#[test]
fn refusal_is_not_appended_and_no_tool_runs() {
    let log: Log = Default::default();
    let mut refused = resp(
        StopReason::Refusal,
        vec![call("t1", "w", json!({"x": "1"}))],
    )
    .unwrap();
    refused.stop_details = Some(json!({"category": "cyber"}));
    let h = harness(vec![Ok(refused)], vec![probe("w", false, 0, &log)]);
    let mut t = Transcript::new();
    let (r, _) = run(&h, &mut t, Some("faz algo"), &mut allow);
    assert_eq!(
        r.unwrap(),
        TurnOutcome::Refused {
            details: Some(json!({"category": "cyber"}))
        }
    );
    assert_eq!(t.len(), 1, "só a mensagem do utilizador");
    assert!(log.lock().unwrap().is_empty());
}

#[test]
fn max_tokens_mid_tool_retries_once_with_the_ceiling_then_gives_up() {
    let log: Log = Default::default();
    let h = harness(
        vec![
            resp(
                StopReason::MaxTokens,
                vec![call("t1", "w", json!({"x": "meio"}))],
            ),
            resp(StopReason::EndTurn, vec![text("ok")]),
        ],
        vec![probe("w", false, 0, &log)],
    );
    let mut t = Transcript::new();
    assert_eq!(
        run(&h, &mut t, Some("escreve"), &mut allow).0.unwrap(),
        TurnOutcome::Done { truncated: false }
    );
    let reqs = h.provider.requests();
    assert_eq!(reqs[0].max_tokens, 64_000);
    assert_eq!(reqs[1].max_tokens, 128_000);
    assert_eq!(t.len(), 2, "a resposta cortada não entrou no histórico");
    assert!(log.lock().unwrap().is_empty());

    let h = harness(
        vec![
            resp(
                StopReason::MaxTokens,
                vec![call("t1", "w", json!({"x": "a"}))],
            ),
            resp(
                StopReason::MaxTokens,
                vec![call("t1", "w", json!({"x": "b"}))],
            ),
        ],
        vec![probe("w", false, 0, &log)],
    );
    let mut t = Transcript::new();
    assert_eq!(
        run(&h, &mut t, Some("escreve"), &mut allow).0,
        Err(AgentError::MaxTokensExhausted)
    );
    assert_eq!(t.len(), 1);
}

#[test]
fn text_cut_by_max_tokens_is_kept_and_flagged() {
    let h = harness(
        vec![resp(StopReason::MaxTokens, vec![text("muito texto")])],
        vec![],
    );
    let mut t = Transcript::new();
    assert_eq!(
        run(&h, &mut t, Some("explica"), &mut allow).0.unwrap(),
        TurnOutcome::Done { truncated: true }
    );
    assert_eq!(t.len(), 2);
}

#[test]
fn invalid_json_bad_schema_unknown_tool_and_denial_never_run() {
    let log: Log = Default::default();
    let mut r1 = resp(
        StopReason::ToolUse,
        vec![
            call("j", "w", json!({})),
            call("s", "w", json!({"x": 3})),
            call("u", "nao_existe", json!({})),
            call("n", "w", json!({"x": "negada"})),
            call("ok", "w", json!({"x": "sim"})),
        ],
    )
    .unwrap();
    r1.invalid_tool_inputs = vec![("j".into(), "{\"x\": \"cor".into())];
    let h = harness(
        vec![Ok(r1), resp(StopReason::EndTurn, vec![text("ok")])],
        vec![probe("w", false, 0, &log)],
    );
    let mut asked = vec![];
    let mut approve = |p: &PendingCall| {
        asked.push(p.id.clone());
        if p.id == "n" {
            Decision::Deny("não mexas aí".into())
        } else {
            Decision::Allow
        }
    };
    let mut t = Transcript::new();
    run(&h, &mut t, Some("vai"), &mut approve).0.unwrap();

    let res = results_of(&t.messages()[2]);
    assert!(res[0].1.contains("INVALID_JSON") && res[0].2);
    assert!(res[1].1.contains("input.x: esperado string") && res[1].2);
    assert!(res[2].1.contains("ferramenta desconhecida") && res[2].2);
    assert!(res[3].1.contains("não mexas aí") && res[3].2);
    assert_eq!(res[4], ("ok".into(), "w:sim".into(), false));
    // só as chamadas válidas chegam à aprovação; só a aprovada correu
    assert_eq!(asked, ["n", "ok"]);
    assert_eq!(log.lock().unwrap().len(), 1);
}

#[test]
fn cancel_during_tools_keeps_the_transcript_valid() {
    let log: Log = Default::default();
    let cancel_flag: Arc<AtomicBool>;
    let h = {
        let provider = Scripted::new(vec![resp(
            StopReason::ToolUse,
            vec![
                call("a", "w", json!({"x": "1"})),
                call("b", "w2", json!({"x": "2"})),
            ],
        )]);
        let cancel = Arc::new(AtomicBool::new(false));
        cancel_flag = cancel.clone();
        let stopper: OnRun = Arc::new(|ctx: &ToolCtx| ctx.cancel.store(true, Ordering::Relaxed));
        let w: Arc<dyn Tool> = Arc::new(Probe {
            name: "w",
            ro: false,
            sleep_ms: 0,
            log: log.clone(),
            on_run: Some(stopper),
        });
        let ctx = ToolCtx {
            root: PathBuf::from("/tmp/ws"),
            cancel,
        };
        Agent::new(
            provider,
            vec![w, probe("w2", false, 0, &log)],
            AgentConfig::new("m"),
            ctx,
        )
    };
    let mut t = Transcript::new();
    let mut evs = vec![];
    let r = h.run_turn(
        &mut t,
        Some(Message::user_text("vai")),
        &mut |e| evs.push(e),
        &mut allow,
    );
    assert_eq!(r.unwrap(), TurnOutcome::Cancelled);
    assert!(cancel_flag.load(Ordering::Relaxed));
    // o tool_use tem sempre o seu tool_result: a 2.ª chamada foi marcada como cancelada
    let res = results_of(t.last().unwrap());
    assert_eq!(res.len(), 2);
    assert!(!res[0].2);
    assert!(res[1].1.contains("cancelado") && res[1].2);
    assert_eq!(log.lock().unwrap().len(), 1);
}

#[test]
fn cancel_before_the_request_stops_without_calling_the_model() {
    let h = harness(vec![], vec![]);
    h.cancel.store(true, Ordering::Relaxed);
    let mut t = Transcript::new();
    assert_eq!(
        run(&h, &mut t, Some("olá"), &mut allow).0.unwrap(),
        TurnOutcome::Cancelled
    );
    assert!(h.provider.requests().is_empty());
}

#[test]
fn mid_stream_overload_is_retried_with_a_retrying_event() {
    let h = harness(
        vec![
            Err(ProviderError::Stream {
                kind: "overloaded_error".into(),
                message: "Overloaded".into(),
            }),
            resp(StopReason::EndTurn, vec![text("ok")]),
        ],
        vec![],
    );
    let mut t = Transcript::new();
    let (r, evs) = run(&h, &mut t, Some("olá"), &mut allow);
    assert_eq!(r.unwrap(), TurnOutcome::Done { truncated: false });
    assert!(evs
        .iter()
        .any(|e| matches!(e, AgentEvent::Retrying { attempt: 1, .. })));
    assert_eq!(h.sleeps.lock().unwrap().len(), 1);
}

#[test]
fn hard_errors_surface_and_the_turn_can_be_continued() {
    let h = harness(
        vec![
            Err(ProviderError::Http {
                status: 401,
                kind: "authentication_error".into(),
                message: "bad key".into(),
            }),
            resp(StopReason::EndTurn, vec![text("agora sim")]),
        ],
        vec![],
    );
    let mut t = Transcript::new();
    let (r, _) = run(&h, &mut t, Some("olá"), &mut allow);
    assert!(matches!(
        r,
        Err(AgentError::Provider(ProviderError::Http {
            status: 401,
            ..
        }))
    ));
    assert_eq!(t.len(), 1);
    // "tentar de novo": continua do mesmo ponto, sem repetir a mensagem do utilizador
    assert_eq!(
        run(&h, &mut t, None, &mut allow).0.unwrap(),
        TurnOutcome::Done { truncated: false }
    );
    assert_eq!(t.len(), 2);
    assert_eq!(
        run(&h, &mut t, None, &mut allow).0,
        Err(AgentError::NothingToContinue)
    );
}

#[test]
fn pause_turn_is_resumed_with_the_paused_assistant_turn_last() {
    let h = harness(
        vec![
            resp(StopReason::PauseTurn, vec![text("a meio")]),
            resp(StopReason::EndTurn, vec![text("fim")]),
        ],
        vec![],
    );
    let mut t = Transcript::new();
    run(&h, &mut t, Some("olá"), &mut allow).0.unwrap();
    let reqs = h.provider.requests();
    assert!(!reqs[0].resume_paused);
    assert!(reqs[1].resume_paused);
    assert_eq!(reqs[1].messages.last().unwrap().role, Role::Assistant);
}

#[test]
fn iteration_limit_leaves_a_continuable_transcript() {
    let log: Log = Default::default();
    let replies = (0..3)
        .map(|i| {
            resp(
                StopReason::ToolUse,
                vec![call(&format!("t{i}"), "r", json!({"x": "."}))],
            )
        })
        .collect();
    let mut h = harness(replies, vec![probe("r", true, 0, &log)]);
    h.agent.cfg.max_iterations = 3;
    let mut t = Transcript::new();
    assert_eq!(
        run(&h, &mut t, Some("vai"), &mut allow).0.unwrap(),
        TurnOutcome::IterationLimit
    );
    assert_eq!(
        t.last().unwrap().role,
        Role::User,
        "termina nos tool_results: pode continuar"
    );
    assert_eq!(log.lock().unwrap().len(), 3);
}

#[test]
fn served_by_reports_a_server_side_fallback() {
    let mut r = resp(StopReason::EndTurn, vec![text("ok")]).unwrap();
    r.model = "claude-opus-4-8".into();
    let h = harness(vec![Ok(r)], vec![]);
    let mut t = Transcript::new();
    let (_, evs) = run(&h, &mut t, Some("olá"), &mut allow);
    assert!(evs.contains(&AgentEvent::ServedBy {
        model: "claude-opus-4-8".into()
    }));
}

#[test]
fn huge_results_are_clipped_keeping_head_and_tail() {
    let big = format!(
        "INICIO{}FIM",
        "x".repeat(tutor_agent::agent::MAX_RESULT_CHARS * 2)
    );
    let out = tutor_agent::agent::clip(big);
    assert!(out.starts_with("INICIO") && out.ends_with("FIM") && out.contains("truncado"));
    assert!(out.chars().count() < tutor_agent::agent::MAX_RESULT_CHARS + 300);
    // a nota diz como pedir menos de cada vez
    assert!(
        out.contains("offset/limit") && out.contains("tail"),
        "{out:.0}"
    );
}

#[test]
fn events_serialize_for_the_ui() {
    let e = AgentEvent::Stream {
        event: StreamEvent::TextDelta {
            index: 0,
            text: "olá".into(),
        },
    };
    assert_eq!(
        serde_json::to_value(&e).unwrap(),
        json!({"kind": "stream", "event": {"type": "text_delta", "index": 0, "text": "olá"}})
    );
    let d = AgentEvent::Done {
        outcome: TurnOutcome::Done { truncated: false },
    };
    assert_eq!(serde_json::to_value(&d).unwrap()["outcome"]["type"], "done");
}

// ───── H5b: client compaction ─────

fn has_block(m: &Message) -> bool {
    m.content
        .iter()
        .any(|b| b["type"] == tutor_agent::agent::COMPACTION_BLOCK)
}

#[test]
fn a_long_context_is_compacted_on_the_client_and_requests_start_from_the_summary() {
    let log: Log = Default::default();
    let mut h = harness(
        vec![
            resp(
                StopReason::ToolUse,
                vec![call("t1", "read", json!({"x": "a.rs"}))],
            ),
            // the summary (not streamed to the UI, not in the transcript as a message)
            resp(StopReason::EndTurn, vec![text("RESUMO: leu a.rs")]),
            resp(StopReason::EndTurn, vec![text("Feito.")]),
            // the next turn: compacted again (from the person's new message)
            resp(StopReason::EndTurn, vec![text("RESUMO2")]),
            resp(StopReason::EndTurn, vec![text("ok")]),
        ],
        vec![probe("read", true, 0, &log)],
    );
    h.agent.cfg.client_compaction_at = Some(5); // every reply «uses» 10 tokens
    let mut t = Transcript::new();
    let (r, evs) = run(&h, &mut t, Some("lê a.rs"), &mut allow);
    assert_eq!(r.unwrap(), TurnOutcome::Done { truncated: false });
    let reqs = h.provider.requests();
    assert_eq!(reqs.len(), 3);
    // the summary request: what came before the cut (the call and its result stay) + the instruction, no stream
    assert_eq!(reqs[1].messages.len(), 1);
    assert_eq!(reqs[1].messages[0].content.len(), 2);
    assert!(reqs[1].messages[0].content[1]["text"]
        .as_str()
        .unwrap()
        .contains("about to be compacted"));
    // the request after it: the summary, then the call and its result as they were
    let m = &reqs[2].messages;
    assert_eq!(m.len(), 3);
    assert!(m[0]
        .text()
        .starts_with("<summary of the conversation so far>\nRESUMO: leu a.rs"));
    assert_eq!(m[1].role, Role::Assistant);
    assert_eq!(m[2].role, Role::User);
    assert!(
        reqs.iter()
            .all(|r| r.messages.iter().all(|m| !has_block(m))),
        "the block never reaches a provider"
    );
    // the transcript only grows: the answer carries the compaction
    assert_eq!(t.len(), 4);
    assert!(has_block(&t.messages()[3]));
    assert_eq!(t.messages()[3].content[0]["keep_from"], 1);
    assert_eq!(t.messages()[3].text(), "Feito.");
    assert!(evs
        .iter()
        .any(|e| matches!(e, AgentEvent::Notice { text } if text.contains("contexto compactado"))));

    // a new turn: compacted again from the person's message — the summary goes in that message
    let (r, _) = run(&h, &mut t, Some("e agora?"), &mut allow);
    assert_eq!(r.unwrap(), TurnOutcome::Done { truncated: false });
    let reqs = h.provider.requests();
    assert_eq!(reqs.len(), 5);
    let m = &reqs[4].messages;
    assert_eq!(m.len(), 1);
    assert!(m[0].content[0]["text"]
        .as_str()
        .unwrap()
        .contains("RESUMO2"));
    assert_eq!(m[0].content[1]["text"], "e agora?");
    // the second summary was made from the first one's view (cumulative), never from the raw start
    assert!(reqs[3].messages[0].text().contains("RESUMO: leu a.rs"));
    assert_eq!(t.messages()[5].content[0]["keep_from"], 4);
}

#[test]
fn compact_now_summarizes_everything_and_claude_is_left_to_the_server() {
    let mut h = harness(
        vec![
            resp(StopReason::EndTurn, vec![text("Olá.")]),
            resp(StopReason::EndTurn, vec![text("RESUMO TOTAL")]),
            resp(StopReason::EndTurn, vec![text("continua")]),
        ],
        vec![],
    );
    let mut t = Transcript::new();
    run(&h, &mut t, Some("olá"), &mut allow).0.unwrap();
    // Claude (client compaction off): said, nothing changes
    let mut evs = vec![];
    h.agent.compact_now(&mut t, &mut |e| evs.push(e)).unwrap();
    assert_eq!(t.len(), 2);
    assert!(evs
        .iter()
        .any(|e| matches!(e, AgentEvent::Notice { text } if text.contains("no servidor"))));
    // another provider: the whole conversation becomes the summary
    h.agent.cfg.client_compaction_at = Some(1_000_000);
    let mut evs = vec![];
    h.agent.compact_now(&mut t, &mut |e| evs.push(e)).unwrap();
    assert_eq!(t.len(), 3);
    assert!(has_block(&t.messages()[2]));
    assert!(matches!(evs.last(), Some(AgentEvent::Done { .. })));
    run(&h, &mut t, Some("e depois?"), &mut allow).0.unwrap();
    let last = h.provider.requests().pop().unwrap();
    // [summary, the compaction's own note, the new message]
    assert_eq!(last.messages.len(), 3);
    assert!(last.messages[0].text().contains("RESUMO TOTAL"));
    assert_eq!(last.messages[2].text(), "e depois?");
    // right after a compaction: nothing to compact (no request)
    let n = h.provider.requests().len();
    let mut u = Transcript::new();
    for m in t.messages().iter().take(3) {
        u.push(m.clone());
    }
    let mut evs = vec![];
    h.agent.compact_now(&mut u, &mut |e| evs.push(e)).unwrap();
    assert_eq!(u.len(), 3);
    assert_eq!(h.provider.requests().len(), n);
    assert!(evs
        .iter()
        .any(|e| matches!(e, AgentEvent::Notice { text } if text == "nada a compactar")));
}

// ───── H5d: pre_tool hooks before the human ─────

#[cfg(unix)]
#[test]
fn a_pre_tool_hook_blocks_before_the_human_is_asked_and_its_advice_reaches_the_policy() {
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
    std::fs::write(
        d.path().join(".dxtutor/hooks.json"),
        r#"{"pre_tool":[{"match":"write","command":"echo '{\"decision\":\"deny\",\"reason\":\"use edit\"}'"},
                        {"match":"read","command":"echo '{\"decision\":\"allow\",\"reason\":\"reads are fine\"}'"}]}"#,
    )
    .unwrap();
    let log: Log = Default::default();
    let mut h = harness(
        vec![
            resp(
                StopReason::ToolUse,
                vec![
                    call("w", "write", json!({"x": "a.rs"})),
                    call("r", "read", json!({"x": "b.rs"})),
                ],
            ),
            resp(StopReason::EndTurn, vec![text("ok")]),
        ],
        vec![probe("write", false, 0, &log), probe("read", true, 0, &log)],
    );
    h.agent.hooks = Some(Arc::new(
        tutor_agent::hooks::Hooks::load(d.path()).unwrap().unwrap(),
    ));
    let mut t = Transcript::new();
    let mut asked: Vec<PendingCall> = vec![];
    let (r, _) = run(&h, &mut t, Some("muda"), &mut |c| {
        asked.push(c.clone());
        Decision::Allow
    });
    r.unwrap();
    // the write never reached the human; the read did, with the hook's advice
    assert_eq!(
        asked.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        ["read"]
    );
    assert_eq!(
        asked[0].hook,
        Some(tutor_agent::agent::HookAdvice::Allow {
            reason: "reads are fine".into()
        })
    );
    let res = results_of(&t.messages()[2]);
    assert_eq!(res[0].0, "w");
    assert!(
        res[0].2
            && res[0]
                .1
                .contains("bloqueado por um hook do projecto: use edit")
    );
    assert_eq!(res[1], ("r".into(), "read:b.rs".into(), false));
}
