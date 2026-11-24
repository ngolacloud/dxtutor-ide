//! The report of a turn (docs/v2/UI-AUDIT.md, item 11, HARNESS-07): what the agent actually
//! did, built only from the turn's events — the commands it ran and how they ended, the
//! files it changed (accepted hunks, with lines added and removed), what was rejected, the
//! validation, the checkpoint and the tokens. Nothing is summarised by a model: every line
//! comes from an event.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::agent::AgentEvent;
use crate::hunks::{RejectedBy, ValidationStatus};
use crate::tools::flow::Todo;

#[derive(Debug, Clone, Default)]
struct FileStat {
    added: usize,
    removed: usize,
    hunks: usize,
}

/// Collects the events of one turn.
#[derive(Debug, Default)]
pub struct TurnLog {
    request: String,
    started: u64,
    commands: Vec<(String, Option<bool>)>,
    tool_ids: BTreeMap<String, usize>,
    reads: usize,
    hunk_path: BTreeMap<String, (String, usize, usize)>,
    files: BTreeMap<String, FileStat>,
    rejected: Vec<(String, RejectedBy, String)>,
    validation: Option<(ValidationStatus, Vec<String>)>,
    checkpoint: Option<u32>,
    tokens: (u64, u64),
    subagents: Vec<String>,
}

fn command_of(name: &str, input: &Value) -> Option<String> {
    match name {
        "bash" => input["command"].as_str().map(str::to_string),
        "run_tests" => Some("run_tests".into()),
        "lint" => Some("lint".into()),
        _ => None,
    }
}

impl TurnLog {
    pub fn new(request: &str, started_ms: u64) -> Self {
        TurnLog {
            request: request.trim().to_string(),
            started: started_ms,
            ..Default::default()
        }
    }

    pub fn observe(&mut self, e: &AgentEvent) {
        match e {
            AgentEvent::ToolStart { id, name, input } => {
                if let Some(c) = command_of(name, input) {
                    self.tool_ids.insert(id.clone(), self.commands.len());
                    self.commands.push((c, None));
                } else if name == "read" || name == "grep" || name == "glob" {
                    self.reads += 1;
                } else if name == "task" {
                    let role = input["role"].as_str().unwrap_or("explorer");
                    let what = input["description"].as_str().unwrap_or("");
                    self.subagents.push(format!("{role}: {what}"));
                }
            }
            AgentEvent::ToolResult { id, is_error, .. } => {
                if let Some(&i) = self.tool_ids.get(id) {
                    self.commands[i].1 = Some(!is_error);
                }
            }
            AgentEvent::HunkStart { hunk, path, .. } => {
                self.hunk_path.insert(hunk.clone(), (path.clone(), 0, 0));
            }
            AgentEvent::HunkEnd { hunk, lines, .. } => {
                if let Some(h) = self.hunk_path.get_mut(hunk) {
                    h.1 = lines.added;
                    h.2 = lines.removed;
                }
            }
            AgentEvent::HunkApplied { hunk, .. } => {
                if let Some((p, a, r)) = self.hunk_path.get(hunk) {
                    let f = self.files.entry(p.clone()).or_default();
                    f.added += a;
                    f.removed += r;
                    f.hunks += 1;
                }
            }
            AgentEvent::HunkRejected { hunk, by, reason } => {
                let path = self
                    .hunk_path
                    .get(hunk)
                    .map(|h| h.0.clone())
                    .unwrap_or_default();
                // a hunk rejected by validation after being applied no longer counts as changed
                if *by == RejectedBy::Validation {
                    if let Some((p, a, r)) = self.hunk_path.get(hunk) {
                        if let Some(f) = self.files.get_mut(p) {
                            f.added = f.added.saturating_sub(*a);
                            f.removed = f.removed.saturating_sub(*r);
                            f.hunks = f.hunks.saturating_sub(1);
                        }
                    }
                }
                self.rejected.push((path, *by, reason.clone()));
            }
            AgentEvent::Validation { status, checks, .. } => {
                if *status != ValidationStatus::Running {
                    let lines = checks
                        .iter()
                        .map(|c| {
                            format!(
                                "`{}` {} {}",
                                c.command,
                                if c.ok { "✓" } else { "✗" },
                                c.summary
                            )
                        })
                        .collect();
                    self.validation = Some((*status, lines));
                }
            }
            AgentEvent::Checkpoint { id, .. } => self.checkpoint = Some(*id),
            AgentEvent::Usage { turn, .. } => {
                self.tokens = (
                    turn.input_tokens
                        + turn.cache_read_input_tokens
                        + turn.cache_creation_input_tokens,
                    turn.output_tokens,
                );
            }
            _ => {}
        }
    }

    /// Whether the turn did anything worth a report (changed files, ran commands, rejected).
    pub fn worth_reporting(&self) -> bool {
        self.files.values().any(|f| f.hunks > 0)
            || !self.commands.is_empty()
            || !self.rejected.is_empty()
    }

    /// The report title: the request, shortened.
    pub fn title(&self) -> String {
        let t: String = self
            .request
            .lines()
            .next()
            .unwrap_or("")
            .chars()
            .take(80)
            .collect();
        if t.is_empty() {
            "Co-Dev turn".into()
        } else {
            t
        }
    }

    /// The report in markdown. `todos`: the task list at the end of the turn.
    pub fn markdown(&self, todos: &[Todo], now_ms: u64) -> String {
        let mut out = vec![format!("**Request:** {}", self.title())];
        let secs = now_ms.saturating_sub(self.started) / 1000;
        out.push(format!(
            "**Duration:** {}m{:02}s · **Tokens:** {} in, {} out",
            secs / 60,
            secs % 60,
            self.tokens.0,
            self.tokens.1
        ));
        let changed: Vec<(&String, &FileStat)> =
            self.files.iter().filter(|(_, f)| f.hunks > 0).collect();
        if changed.is_empty() {
            out.push("**Files changed:** none".into());
        } else {
            out.push("**Files changed:**".into());
            for (p, f) in changed {
                out.push(format!(
                    "- `{p}` +{} −{} ({} change(s))",
                    f.added, f.removed, f.hunks
                ));
            }
        }
        if !self.rejected.is_empty() {
            out.push("**Not applied:**".into());
            for (p, by, why) in &self.rejected {
                let by = match by {
                    RejectedBy::Human => "rejected",
                    RejectedBy::Validation => "rolled back by validation",
                    RejectedBy::Cancel => "cancelled",
                };
                out.push(format!(
                    "- `{}` — {by}: {why}",
                    if p.is_empty() { "?" } else { p }
                ));
            }
        }
        if !self.commands.is_empty() {
            out.push("**Commands:**".into());
            for (c, ok) in &self.commands {
                let mark = match ok {
                    Some(true) => "✓",
                    Some(false) => "✗",
                    None => "…",
                };
                out.push(format!("- {mark} `{c}`"));
            }
        }
        if let Some((st, lines)) = &self.validation {
            let st = match st {
                ValidationStatus::Passed => "passed",
                ValidationStatus::Failed => "failed",
                ValidationStatus::Skipped => "skipped",
                ValidationStatus::Running => "running",
            };
            out.push(format!("**Validation:** {st}"));
            out.extend(lines.iter().map(|l| format!("- {l}")));
        }
        if !self.subagents.is_empty() {
            out.push(format!("**Sub-agents:** {}", self.subagents.join("; ")));
        }
        if !todos.is_empty() {
            let done = todos.iter().filter(|t| t.status == "completed").count();
            out.push(format!("**Tasks:** {done} of {} done", todos.len()));
            for t in todos {
                let m = match t.status.as_str() {
                    "completed" => "[x]",
                    "in_progress" => "[~]",
                    _ => "[ ]",
                };
                out.push(format!("- {m} {}", t.content));
            }
        }
        if let Some(cp) = self.checkpoint {
            out.push(format!(
                "**Checkpoint:** #{cp} (the files as they were before this turn)"
            ));
        }
        if self.reads > 0 {
            out.push(format!("**Read/searched:** {} time(s)", self.reads));
        }
        out.join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hunks::{Check, LineCount, LineRange};
    use crate::provider::Usage;
    use serde_json::json;

    #[test]
    fn the_report_comes_only_from_events() {
        let mut l = TurnLog::new("corrige o E0382\nmais detalhe", 1_000);
        let ev = [
            AgentEvent::Checkpoint {
                id: 3,
                label: "x".into(),
            },
            AgentEvent::ToolStart {
                id: "r".into(),
                name: "read".into(),
                input: json!({"path": "a.rs"}),
            },
            AgentEvent::ToolStart {
                id: "b".into(),
                name: "bash".into(),
                input: json!({"command": "cargo test"}),
            },
            AgentEvent::ToolResult {
                id: "b".into(),
                name: "bash".into(),
                is_error: true,
                content: "1 failed".into(),
            },
            AgentEvent::HunkStart {
                hunk: "e:1".into(),
                call: "e".into(),
                path: "src/lib.rs".into(),
                op: crate::hunks::HunkOp::Replace,
                range: LineRange { start: 3, end: 3 },
                base: None,
                old: "a\n".into(),
            },
            AgentEvent::HunkEnd {
                hunk: "e:1".into(),
                text: "b\nc\n".into(),
                lines: LineCount {
                    added: 2,
                    removed: 1,
                },
            },
            AgentEvent::HunkApplied {
                hunk: "e:1".into(),
                provisional: false,
                fingerprint: "f".into(),
            },
            AgentEvent::HunkStart {
                hunk: "e:2".into(),
                call: "e".into(),
                path: "src/lib.rs".into(),
                op: crate::hunks::HunkOp::Replace,
                range: LineRange { start: 9, end: 9 },
                base: None,
                old: "x\n".into(),
            },
            AgentEvent::HunkRejected {
                hunk: "e:2".into(),
                by: RejectedBy::Human,
                reason: "not this".into(),
            },
            AgentEvent::Validation {
                status: ValidationStatus::Passed,
                checks: vec![Check {
                    command: "cargo test".into(),
                    ok: true,
                    summary: "4 passed".into(),
                }],
                baseline: vec![],
            },
            AgentEvent::Usage {
                request: Usage::default(),
                turn: Usage {
                    input_tokens: 100,
                    output_tokens: 20,
                    ..Default::default()
                },
            },
        ];
        ev.iter().for_each(|e| l.observe(e));
        assert!(l.worth_reporting());
        assert_eq!(l.title(), "corrige o E0382");
        let md = l.markdown(
            &[Todo {
                content: "fix".into(),
                status: "completed".into(),
            }],
            66_000,
        );
        assert!(
            md.contains("**Duration:** 1m05s · **Tokens:** 100 in, 20 out"),
            "{md}"
        );
        assert!(md.contains("- `src/lib.rs` +2 −1 (1 change(s))"), "{md}");
        assert!(md.contains("- `src/lib.rs` — rejected: not this"), "{md}");
        assert!(md.contains("- ✗ `cargo test`"), "{md}");
        assert!(
            md.contains("**Validation:** passed\n- `cargo test` ✓ 4 passed"),
            "{md}"
        );
        assert!(md.contains("**Tasks:** 1 of 1 done\n- [x] fix"), "{md}");
        assert!(md.contains("**Checkpoint:** #3"), "{md}");
    }

    #[test]
    fn a_rollback_takes_the_files_back_out_and_a_chat_turn_is_not_worth_a_report() {
        let mut l = TurnLog::new("q", 0);
        l.observe(&AgentEvent::HunkStart {
            hunk: "h".into(),
            call: "c".into(),
            path: "a".into(),
            op: crate::hunks::HunkOp::Replace,
            range: LineRange { start: 1, end: 1 },
            base: None,
            old: "".into(),
        });
        l.observe(&AgentEvent::HunkEnd {
            hunk: "h".into(),
            text: "x\n".into(),
            lines: LineCount {
                added: 1,
                removed: 0,
            },
        });
        l.observe(&AgentEvent::HunkApplied {
            hunk: "h".into(),
            provisional: true,
            fingerprint: "f".into(),
        });
        l.observe(&AgentEvent::HunkRejected {
            hunk: "h".into(),
            by: RejectedBy::Validation,
            reason: "tests broke".into(),
        });
        let md = l.markdown(&[], 0);
        assert!(md.contains("**Files changed:** none"), "{md}");
        assert!(
            md.contains("rolled back by validation: tests broke"),
            "{md}"
        );
        assert!(!TurnLog::new("hi", 0).worth_reporting());
    }
}
