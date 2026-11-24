//! Live hunks through the whole loop (docs/v2/RF-CODEV-STREAM.md): a scripted model
//! streams `edit`/`write` input; the host decides each hunk; only accepted hunks reach
//! the disk, and nothing reaches it before the decision (I1).

use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tutor_agent::provider::BlockKind;
use tutor_agent::tools::{coding_tools, FileState, ToolsetOptions};
use tutor_agent::{
    Agent, AgentConfig, AgentEvent, Decision, Message, PendingCall, Provider, ProviderError,
    Request, Response, StopReason, StreamEvent, ToolCtx, Transcript, TurnOutcome, Usage,
};

/// One model reply: the stream events it sends, then the assembled response.
type Step = (Vec<StreamEvent>, Response);

struct Scripted {
    steps: Mutex<VecDeque<Step>>,
}

impl Provider for Scripted {
    fn stream(
        &self,
        _req: &Request,
        on_event: &mut dyn FnMut(StreamEvent) -> bool,
    ) -> Result<Response, ProviderError> {
        let (evs, resp) = self
            .steps
            .lock()
            .unwrap()
            .pop_front()
            .expect("script ended");
        for e in evs {
            if !on_event(e) {
                return Err(ProviderError::Cancelled);
            }
        }
        Ok(resp)
    }
}

fn response(stop: StopReason, content: Vec<Value>) -> Response {
    Response {
        id: "msg".into(),
        model: "claude-opus-5-5".into(),
        content,
        stop_reason: stop,
        stop_details: None,
        usage: Usage::default(),
        invalid_tool_inputs: vec![],
    }
}

/// A tool call, plain (no streamed input).
fn plain(id: &str, name: &str, input: Value) -> Step {
    (
        vec![],
        response(
            StopReason::ToolUse,
            vec![json!({"type": "tool_use", "id": id, "name": name, "input": input})],
        ),
    )
}

/// A tool call whose input streams in `pieces` (their concatenation is the JSON input).
fn streamed(id: &str, name: &str, pieces: &[&str], stop: StopReason) -> Step {
    let raw: String = pieces.concat();
    let input: Value = serde_json::from_str(&raw).unwrap();
    let mut evs = vec![StreamEvent::BlockStart {
        index: 0,
        kind: BlockKind::ToolUse {
            id: id.into(),
            name: name.into(),
        },
    }];
    evs.extend(pieces.iter().map(|p| StreamEvent::ToolInputDelta {
        index: 0,
        partial_json: p.to_string(),
    }));
    evs.push(StreamEvent::BlockStop { index: 0 });
    (
        evs,
        response(
            stop,
            vec![json!({"type": "tool_use", "id": id, "name": name, "input": input})],
        ),
    )
}

fn end() -> Step {
    (
        vec![],
        response(
            StopReason::EndTurn,
            vec![json!({"type": "text", "text": "ok"})],
        ),
    )
}

fn agent(root: &Path, steps: Vec<Step>) -> Agent {
    let files = Arc::new(FileState::default());
    let tools = coding_tools(&ToolsetOptions {
        files: Some(files.clone()),
        ..Default::default()
    });
    let mut a = Agent::new(
        Arc::new(Scripted {
            steps: Mutex::new(steps.into()),
        }),
        tools,
        AgentConfig::new("claude-opus-5-5"),
        ToolCtx {
            root: root.to_path_buf(),
            cancel: Arc::new(AtomicBool::new(false)),
        },
    );
    a.hunks = Some(files);
    a
}

fn kind(e: &AgentEvent) -> String {
    serde_json::to_value(e).unwrap()["kind"]
        .as_str()
        .unwrap()
        .to_string()
}

fn result_of(t: &Transcript, id: &str) -> (String, bool) {
    for m in t.messages() {
        for b in &m.content {
            if b["tool_use_id"] == id {
                return (
                    b["content"].as_str().unwrap().to_string(),
                    b["is_error"] == true,
                );
            }
        }
    }
    panic!("no result for {id}");
}

#[test]
fn an_accepted_edit_streams_on_its_lines_and_reaches_disk_only_after_the_decision() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("lib.rs");
    std::fs::write(&file, "fn f() {\n    for c in chars {\n    }\n}\n").unwrap();
    let a = agent(
        dir.path(),
        vec![
            plain("r", "read", json!({"path": "lib.rs"})),
            streamed(
                "e",
                "edit",
                &[
                    r#"{"path":"lib.rs","old_string":"for c in chars","#,
                    r#""new_string":"while let Some(c) = chars.next()"}"#,
                ],
                StopReason::ToolUse,
            ),
            end(),
        ],
    );
    let mut t = Transcript::new();
    let mut evs = vec![];
    let mut asked: Vec<Vec<String>> = vec![];
    let f2 = file.clone();
    let out = a
        .run_turn(
            &mut t,
            Some(Message::user_text("fix it")),
            &mut |e| evs.push(e),
            &mut |c: &PendingCall| {
                if c.name == "edit" {
                    // I1: the decision comes before any write
                    assert!(std::fs::read_to_string(&f2)
                        .unwrap()
                        .contains("for c in chars"));
                    asked.push(c.hunks.clone());
                    return Decision::Hunks {
                        accepted: c.hunks.clone(),
                        rejected: vec![],
                        provisional: false,
                    };
                }
                Decision::Allow
            },
        )
        .unwrap();
    assert_eq!(out, TurnOutcome::Done { truncated: false });
    assert_eq!(asked, vec![vec!["e:1".to_string()]]);
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "fn f() {\n    while let Some(c) = chars.next() {\n    }\n}\n"
    );
    let hunk_kinds: Vec<String> = evs
        .iter()
        .map(kind)
        .filter(|k| k.starts_with("hunk_"))
        .collect();
    assert_eq!(hunk_kinds.first().unwrap(), "hunk_start");
    assert_eq!(
        &hunk_kinds[hunk_kinds.len() - 2..],
        ["hunk_end", "hunk_applied"]
    );
    let applied = evs
        .iter()
        .find_map(|e| match e {
            AgentEvent::HunkApplied { provisional, .. } => Some(*provisional),
            _ => None,
        })
        .unwrap();
    assert!(!applied);
    let (msg, err) = result_of(&t, "e");
    assert!(!err && msg.contains("applied 1 of 1"), "{msg}");
}

#[test]
fn a_write_over_an_existing_file_applies_only_the_accepted_block() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("a.txt");
    std::fs::write(&file, "1\n2\n3\n4\n5\n").unwrap();
    let a = agent(
        dir.path(),
        vec![
            plain("r", "read", json!({"path": "a.txt"})),
            streamed(
                "w",
                "write",
                &[
                    r#"{"path":"a.txt","content":"one\n2\n3\n"#,
                    r#"4\nfive\n"}"#,
                ],
                StopReason::ToolUse,
            ),
            end(),
        ],
    );
    let mut t = Transcript::new();
    let mut evs = vec![];
    a.run_turn(
        &mut t,
        Some(Message::user_text("rename")),
        &mut |e| evs.push(e),
        &mut |c: &PendingCall| {
            if c.name == "write" {
                assert_eq!(c.hunks, ["w:1", "w:2"]);
                return Decision::Hunks {
                    accepted: vec!["w:2".into()],
                    rejected: vec![("w:1".into(), "keep the digit".into())],
                    provisional: true,
                };
            }
            Decision::Allow
        },
    )
    .unwrap();
    // I2: only the accepted block changed; the rest of the file is untouched
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "1\n2\n3\n4\nfive\n"
    );
    let (msg, err) = result_of(&t, "w");
    assert!(!err, "{msg}");
    assert!(
        msg.contains("applied 1 of 2") && msg.contains("keep the digit"),
        "{msg}"
    );
    let rejected = serde_json::to_value(
        evs.iter()
            .find(|e| matches!(e, AgentEvent::HunkRejected { .. }))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(rejected["hunk"], "w:1");
    assert_eq!(rejected["by"], "human");
    assert!(evs.iter().any(|e| matches!(
        e,
        AgentEvent::HunkApplied {
            provisional: true,
            ..
        }
    )));
}

#[test]
fn a_denied_edit_leaves_the_file_and_rejects_its_hunks() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("x.rs");
    std::fs::write(&file, "a\n").unwrap();
    let a = agent(
        dir.path(),
        vec![
            plain("r", "read", json!({"path": "x.rs"})),
            streamed(
                "e",
                "edit",
                &[r#"{"path":"x.rs","old_string":"a","new_string":"b"}"#],
                StopReason::ToolUse,
            ),
            end(),
        ],
    );
    let mut t = Transcript::new();
    let mut evs = vec![];
    a.run_turn(
        &mut t,
        Some(Message::user_text("go")),
        &mut |e| evs.push(e),
        &mut |c: &PendingCall| {
            if c.name == "edit" {
                Decision::Deny("not this approach".into())
            } else {
                Decision::Allow
            }
        },
    )
    .unwrap();
    assert_eq!(std::fs::read_to_string(&file).unwrap(), "a\n");
    let r = serde_json::to_value(
        evs.iter()
            .find(|e| matches!(e, AgentEvent::HunkRejected { .. }))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(r["by"], "human");
    assert_eq!(r["reason"], "not this approach");
    assert!(result_of(&t, "e").1);
}

#[test]
fn hunks_of_a_refused_response_are_rejected_before_done() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("x.rs"), "a\n").unwrap();
    let a = agent(
        dir.path(),
        vec![
            plain("r", "read", json!({"path": "x.rs"})),
            streamed(
                "e",
                "edit",
                &[r#"{"path":"x.rs","old_string":"a","new_string":"b"}"#],
                StopReason::Refusal,
            ),
        ],
    );
    let mut t = Transcript::new();
    let mut evs = vec![];
    let out = a
        .run_turn(
            &mut t,
            Some(Message::user_text("go")),
            &mut |e| evs.push(e),
            &mut |_: &PendingCall| Decision::Allow,
        )
        .unwrap();
    assert!(matches!(out, TurnOutcome::Refused { .. }));
    let ks: Vec<String> = evs.iter().map(kind).collect();
    let rejected = ks.iter().position(|k| k == "hunk_rejected").unwrap();
    let done = ks.iter().position(|k| k == "done").unwrap();
    assert!(rejected < done, "{ks:?}");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("x.rs")).unwrap(),
        "a\n"
    );
}

#[test]
fn an_edit_the_tool_would_refuse_fails_without_asking() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("x.rs"), "a\n").unwrap();
    // not read first: the tool's freshness rule refuses it, before any approval
    let a = agent(
        dir.path(),
        vec![
            streamed(
                "e",
                "edit",
                &[r#"{"path":"x.rs","old_string":"a","new_string":"b"}"#],
                StopReason::ToolUse,
            ),
            end(),
        ],
    );
    let mut t = Transcript::new();
    let mut asked = 0;
    a.run_turn(
        &mut t,
        Some(Message::user_text("go")),
        &mut |_| {},
        &mut |_: &PendingCall| {
            asked += 1;
            Decision::Allow
        },
    )
    .unwrap();
    assert_eq!(asked, 0);
    let (msg, err) = result_of(&t, "e");
    assert!(err && msg.contains("lê o ficheiro com `read`"), "{msg}");
}
