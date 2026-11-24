//! Live edit hunks (docs/v2/RF-CODEV-STREAM.md).
//!
//! When the host turns them on ([`crate::agent::Agent::hunks`]), `edit` and `write` no
//! longer write straight to disk:
//!
//! 1. while the model streams the tool input, the [`HunkTracker`] reads the JSON as it
//!    arrives ([`FieldReader`]), works out which lines the call replaces and streams the
//!    new text as `hunk_start` / `hunk_chunk` / `hunk_end` events;
//! 2. the call waits for a decision per hunk (the host asks the human, or applies
//!    provisionally in Auto);
//! 3. [`apply`] writes **only** the accepted hunks, after checking the file is still the
//!    one the hunks were computed on (I1, I5).
//!
//! Every hunk covers whole lines. A `write` over an existing file becomes one hunk per
//! changed block of lines, so equal lines are never touched (I2).

use std::collections::{HashMap, HashSet};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;

use crate::agent::AgentEvent;
use crate::provider::{BlockKind, StreamEvent};
use crate::sandbox;
use crate::tool::ToolOutput;
use crate::tools::{check_fresh, edit_check, write_check, FileState};

// ───── incremental reader of a streamed JSON object ─────

/// What [`FieldReader::feed`] found in the latest piece of JSON. Only top-level fields of
/// the object are reported; nested values arrive whole as [`FieldEvent::Scalar`].
#[derive(Debug, Clone, PartialEq)]
pub enum FieldEvent {
    /// A string field started (its opening quote arrived).
    Start(String),
    /// Decoded text of a string field, in order.
    Chunk(String, String),
    /// A string field is complete.
    End(String),
    /// A non-string field is complete (raw JSON text).
    Scalar(String, String),
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
enum Esc {
    #[default]
    None,
    Backslash,
    Unicode(u32, u8),
}

/// Decodes the body of a JSON string one character at a time, keeping escapes that are
/// split across pieces (`\`, `\u00`, a surrogate pair split in two escapes).
#[derive(Debug, Default)]
struct Unescape {
    esc: Esc,
    high: Option<u32>,
}

impl Unescape {
    /// Feeds one character; decoded text goes to `out`. `true` on the closing quote.
    fn feed(&mut self, c: char, out: &mut String) -> bool {
        match self.esc {
            Esc::None => match c {
                '\\' => {
                    self.esc = Esc::Backslash;
                    false
                }
                '"' => {
                    self.flush_high(out);
                    true
                }
                _ => {
                    self.flush_high(out);
                    out.push(c);
                    false
                }
            },
            Esc::Backslash => {
                self.esc = Esc::None;
                let d = match c {
                    'n' => '\n',
                    't' => '\t',
                    'r' => '\r',
                    'b' => '\u{8}',
                    'f' => '\u{c}',
                    'u' => {
                        self.esc = Esc::Unicode(0, 0);
                        return false;
                    }
                    other => other, // '"', '\\', '/'
                };
                self.flush_high(out);
                out.push(d);
                false
            }
            Esc::Unicode(v, n) => {
                let Some(d) = c.to_digit(16) else {
                    // malformed escape: drop it and read the character normally
                    self.esc = Esc::None;
                    return self.feed(c, out);
                };
                let v = v * 16 + d;
                if n < 3 {
                    self.esc = Esc::Unicode(v, n + 1);
                    return false;
                }
                self.esc = Esc::None;
                match v {
                    0xD800..=0xDBFF => {
                        self.flush_high(out);
                        self.high = Some(v);
                    }
                    0xDC00..=0xDFFF => match self.high.take() {
                        Some(h) => out.push(
                            char::from_u32(0x10000 + ((h - 0xD800) << 10) + (v - 0xDC00))
                                .unwrap_or('\u{FFFD}'),
                        ),
                        None => out.push('\u{FFFD}'),
                    },
                    _ => {
                        self.flush_high(out);
                        out.push(char::from_u32(v).unwrap_or('\u{FFFD}'));
                    }
                }
                false
            }
        }
    }

    /// A high surrogate not followed by a low one becomes U+FFFD.
    fn flush_high(&mut self, out: &mut String) {
        if self.high.take().is_some() {
            out.push('\u{FFFD}');
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum St {
    Begin,
    ExpectKey,
    Key,
    AfterKey,
    ExpectValue,
    Str,
    Other,
    AfterValue,
    Done,
}

/// Reads a JSON object that arrives in pieces (the `partial_json` of a tool input) and
/// reports its top-level fields as soon as they can be read. Keys may come in any order.
/// Input cut short simply stops producing events.
#[derive(Debug)]
pub struct FieldReader {
    st: St,
    key: String,
    un: Unescape,
    raw: String,
    depth: usize,
    raw_str: bool,
    raw_esc: bool,
}

impl Default for FieldReader {
    fn default() -> Self {
        FieldReader {
            st: St::Begin,
            key: String::new(),
            un: Unescape::default(),
            raw: String::new(),
            depth: 0,
            raw_str: false,
            raw_esc: false,
        }
    }
}

impl FieldReader {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, piece: &str) -> Vec<FieldEvent> {
        let mut ev = vec![];
        let mut chunk = String::new();
        for c in piece.chars() {
            match self.st {
                St::Begin => {
                    if c == '{' {
                        self.st = St::ExpectKey;
                    } else if !c.is_whitespace() {
                        self.st = St::Done;
                    }
                }
                St::ExpectKey => match c {
                    '"' => {
                        self.key.clear();
                        self.un = Unescape::default();
                        self.st = St::Key;
                    }
                    '}' => self.st = St::Done,
                    _ => {}
                },
                St::Key => {
                    if self.un.feed(c, &mut self.key) {
                        self.st = St::AfterKey;
                    }
                }
                St::AfterKey => {
                    if c == ':' {
                        self.st = St::ExpectValue;
                    }
                }
                St::ExpectValue => match c {
                    '"' => {
                        self.un = Unescape::default();
                        ev.push(FieldEvent::Start(self.key.clone()));
                        self.st = St::Str;
                    }
                    c if c.is_whitespace() => {}
                    c => {
                        self.raw.clear();
                        self.raw.push(c);
                        self.depth = usize::from(c == '{' || c == '[');
                        self.raw_str = false;
                        self.raw_esc = false;
                        self.st = St::Other;
                    }
                },
                St::Str => {
                    if self.un.feed(c, &mut chunk) {
                        if !chunk.is_empty() {
                            ev.push(FieldEvent::Chunk(
                                self.key.clone(),
                                std::mem::take(&mut chunk),
                            ));
                        }
                        ev.push(FieldEvent::End(self.key.clone()));
                        self.st = St::AfterValue;
                    }
                }
                St::Other => {
                    if self.raw_str {
                        if self.raw_esc {
                            self.raw_esc = false;
                        } else if c == '\\' {
                            self.raw_esc = true;
                        } else if c == '"' {
                            self.raw_str = false;
                        }
                        self.raw.push(c);
                        continue;
                    }
                    match c {
                        '"' => {
                            self.raw_str = true;
                            self.raw.push(c);
                        }
                        '{' | '[' => {
                            self.depth += 1;
                            self.raw.push(c);
                        }
                        '}' | ']' if self.depth > 0 => {
                            self.depth -= 1;
                            self.raw.push(c);
                        }
                        ',' | '}' if self.depth == 0 => {
                            ev.push(FieldEvent::Scalar(
                                self.key.clone(),
                                self.raw.trim().to_string(),
                            ));
                            self.st = if c == ',' { St::ExpectKey } else { St::Done };
                        }
                        _ => self.raw.push(c),
                    }
                }
                St::AfterValue => match c {
                    ',' => self.st = St::ExpectKey,
                    '}' => self.st = St::Done,
                    _ => {}
                },
                St::Done => break,
            }
        }
        if self.st == St::Str && !chunk.is_empty() {
            ev.push(FieldEvent::Chunk(self.key.clone(), chunk));
        }
        ev
    }
}

// ───── hunks ─────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum HunkOp {
    Replace,
    Insert,
    Delete,
    Create,
}

/// Lines `start..=end` (1-based) of the file as it was when the hunk was computed. An
/// insert has `end = start - 1`: the new lines go before line `start`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LineRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LineCount {
    pub added: usize,
    pub removed: usize,
}

/// Who turned a hunk down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectedBy {
    Human,
    Validation,
    Cancel,
}

/// One block of changed whole lines.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub op: HunkOp,
    pub range: LineRange,
    /// The lines replaced, with their line endings (empty for insert/create).
    pub old: String,
    /// The lines that take their place.
    pub new: String,
}

impl Change {
    pub fn lines(&self) -> LineCount {
        LineCount {
            added: self.new.lines().count(),
            removed: self.old.lines().count(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hunk {
    pub id: String,
    pub change: Change,
}

/// What one `edit`/`write` call would do to its file.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub call: String,
    /// Path relative to the project root.
    pub path: String,
    pub abs: PathBuf,
    /// Fingerprint of the file the hunks were computed on; `None` = the file does not
    /// exist yet.
    pub base: Option<u64>,
    pub hunks: Vec<Hunk>,
}

impl Plan {
    pub fn ids(&self) -> Vec<String> {
        self.hunks.iter().map(|h| h.id.clone()).collect()
    }
}

/// The fingerprint as it travels in events (`base`, `fingerprint`): opaque hex.
pub fn fingerprint_hex(fp: u64) -> String {
    format!("{fp:016x}")
}

/// Line number (1-based) of the byte at `i`.
fn line_of(text: &str, i: usize) -> usize {
    text[..i].matches('\n').count() + 1
}

/// Last line number covered by `lines` (whole lines) starting at line `start`.
fn last_line(start: usize, lines: &str) -> usize {
    start
        + lines
            .strip_suffix('\n')
            .unwrap_or(lines)
            .matches('\n')
            .count()
}

fn line_start(text: &str, i: usize) -> usize {
    text[..i].rfind('\n').map_or(0, |p| p + 1)
}

/// End (exclusive, after the line ending) of the line holding the byte before `j`.
fn line_end(text: &str, j: usize) -> usize {
    if text[..j].ends_with('\n') {
        j
    } else {
        text[j..].find('\n').map_or(text.len(), |p| j + p + 1)
    }
}

/// The hunks of replacing `old` at the byte offsets `occ` (ascending, not overlapping):
/// each occurrence widens to whole lines, and occurrences sharing a line share a hunk.
pub fn edit_changes(text: &str, old: &str, new: &str, occ: &[usize]) -> Vec<Change> {
    let mut groups: Vec<(usize, usize, Vec<usize>)> = vec![];
    for &i in occ {
        let ls = line_start(text, i);
        let le = line_end(text, i + old.len());
        match groups.last_mut() {
            Some(g) if ls < g.1 => {
                g.1 = g.1.max(le);
                g.2.push(i);
            }
            _ => groups.push((ls, le, vec![i])),
        }
    }
    groups
        .into_iter()
        .map(|(ls, le, is)| {
            let mut out = String::new();
            let mut at = ls;
            for i in is {
                out.push_str(&text[at..i]);
                out.push_str(new);
                at = i + old.len();
            }
            out.push_str(&text[at..le]);
            let start = line_of(text, ls);
            let region = &text[ls..le];
            Change {
                op: if out.is_empty() {
                    HunkOp::Delete
                } else {
                    HunkOp::Replace
                },
                range: LineRange {
                    start,
                    end: last_line(start, region),
                },
                old: region.to_string(),
                new: out,
            }
        })
        .collect()
}

/// One hunk per block of lines that differs between `old` and `new` (Myers line diff).
pub fn diff_changes(old: &str, new: &str) -> Vec<Change> {
    let a: Vec<&str> = old.split_inclusive('\n').collect();
    let b: Vec<&str> = new.split_inclusive('\n').collect();
    let region = |o: Range<usize>, n: Range<usize>| {
        let old = a[o.clone()].concat();
        let new = b[n].concat();
        let (op, range) = if old.is_empty() {
            (
                HunkOp::Insert,
                LineRange {
                    start: o.start + 1,
                    end: o.start,
                },
            )
        } else {
            (
                if new.is_empty() {
                    HunkOp::Delete
                } else {
                    HunkOp::Replace
                },
                LineRange {
                    start: o.start + 1,
                    end: o.end,
                },
            )
        };
        Change {
            op,
            range,
            old,
            new,
        }
    };
    let mut out = vec![];
    let mut cur: Option<(Range<usize>, Range<usize>)> = None;
    for op in similar::capture_diff_slices(similar::Algorithm::Myers, &a, &b) {
        let (tag, o, n) = op.as_tag_tuple();
        if tag == similar::DiffTag::Equal {
            if let Some((o, n)) = cur.take() {
                out.push(region(o, n));
            }
            continue;
        }
        cur = Some(match cur.take() {
            Some((po, pn)) => (po.start..o.end, pn.start..n.end),
            None => (o, n),
        });
    }
    if let Some((o, n)) = cur {
        out.push(region(o, n));
    }
    out
}

/// The hunks of an `edit` call, with the same checks (and messages) as the tool.
pub fn plan_edit(
    files: &FileState,
    root: &Path,
    input: &Value,
) -> Result<(PathBuf, Option<u64>, Vec<Change>), String> {
    let (abs, cur, text, _) = edit_check(files, root, input)?;
    let old = input["old_string"].as_str().unwrap_or_default();
    let new = input["new_string"].as_str().unwrap_or_default();
    let all = input["replace_all"].as_bool().unwrap_or(false);
    let occ: Vec<usize> = text
        .match_indices(old)
        .map(|(i, _)| i)
        .take(if all { usize::MAX } else { 1 })
        .collect();
    Ok((
        abs,
        Some(FileState::fingerprint(&cur)),
        edit_changes(&text, old, new, &occ),
    ))
}

/// The hunks of a `write` call: a new file is one `create` hunk; an existing file is
/// diffed line by line against what is on disk.
pub fn plan_write(
    files: &FileState,
    root: &Path,
    input: &Value,
) -> Result<(PathBuf, Option<u64>, Vec<Change>), String> {
    let (abs, cur) = write_check(files, root, input)?;
    let content = input["content"].as_str().unwrap_or_default();
    Ok(match cur {
        None => (
            abs,
            None,
            vec![Change {
                op: HunkOp::Create,
                range: LineRange { start: 1, end: 0 },
                old: String::new(),
                new: content.to_string(),
            }],
        ),
        Some(cur) => {
            let text = String::from_utf8_lossy(&cur);
            (
                abs,
                Some(FileState::fingerprint(&cur)),
                diff_changes(&text, content),
            )
        }
    })
}

/// Byte offset where each line starts, plus the length of the text.
fn line_offsets(text: &str) -> Vec<usize> {
    let mut v = vec![0];
    v.extend(text.match_indices('\n').map(|(i, _)| i + 1));
    if *v.last().unwrap() != text.len() {
        v.push(text.len());
    }
    v
}

fn span(off: &[usize], r: LineRange) -> Option<Range<usize>> {
    let lines = off.len() - 1;
    if r.start == 0 || r.start - 1 > lines || r.end > lines || r.end + 1 < r.start {
        return None;
    }
    let s = off[r.start - 1];
    Some(s..if r.end < r.start { s } else { off[r.end] })
}

fn describe(r: LineRange) -> String {
    match r.end.cmp(&r.start) {
        std::cmp::Ordering::Less => format!("before line {}", r.start),
        std::cmp::Ordering::Equal => format!("line {}", r.start),
        std::cmp::Ordering::Greater => format!("lines {}–{}", r.start, r.end),
    }
}

/// Applies disjoint `changes` to `text`. Each change's old text must be exactly where its
/// range says, or nothing is applied.
pub fn splice(text: &str, changes: &[&Change]) -> Result<String, String> {
    let off = line_offsets(text);
    let mut spans = Vec::with_capacity(changes.len());
    for c in changes {
        let sp = span(&off, c.range)
            .filter(|sp| text[sp.clone()] == c.old)
            .ok_or_else(|| format!("{} no longer hold the proposed text", describe(c.range)))?;
        spans.push((sp, *c));
    }
    // from the end, so earlier offsets stay valid; at the same offset, the replacement
    // goes before the insert (an insert lands before the replaced lines)
    spans.sort_by(|(a, _), (b, _)| b.start.cmp(&a.start).then(b.end.cmp(&a.end)));
    let mut out = text.to_string();
    let mut prev = usize::MAX;
    for (sp, c) in spans {
        if sp.end > prev {
            return Err("the changes overlap".into());
        }
        out.replace_range(sp.clone(), &c.new);
        prev = sp.start;
    }
    Ok(out)
}

/// Moves a change to where its old lines are now, when they are there exactly once (the
/// file changed elsewhere since the hunk was computed).
fn relocate(text: &str, c: &Change) -> Option<Change> {
    if c.old.is_empty() {
        return None;
    }
    let mut found = None;
    let mut from = 0;
    while let Some(p) = text[from..].find(&c.old) {
        let i = from + p;
        let end = i + c.old.len();
        let whole = (i == 0 || text.as_bytes()[i - 1] == b'\n')
            && (c.old.ends_with('\n') || end == text.len());
        if whole {
            if found.is_some() {
                return None;
            }
            found = Some(i);
        }
        from = i + text[i..].chars().next().map_or(1, char::len_utf8);
    }
    let i = found?;
    let start = line_of(text, i);
    Some(Change {
        range: LineRange {
            start,
            end: last_line(start, &c.old),
        },
        ..c.clone()
    })
}

/// Writes the accepted hunks of `plan` and reports each hunk's fate as events.
///
/// - The file must still be the one the hunks were computed on (`base`). If it changed,
///   each accepted hunk moves to where its old lines are now, when that is unambiguous;
///   otherwise the accepted hunks are `stale` and nothing is written (I5).
/// - Hunks not in `accepted` are rejected with the reason in `reasons` (I1).
/// - `provisional` marks the writes of Auto mode, which validation may still undo.
pub fn apply(
    plan: &Plan,
    accepted: &HashSet<String>,
    reasons: &HashMap<String, String>,
    provisional: bool,
    files: &FileState,
    root: &Path,
    events: &mut dyn FnMut(AgentEvent),
) -> ToolOutput {
    let path = &plan.path;
    if plan.hunks.is_empty() {
        return ToolOutput::ok(format!("{path}: no changes (the content is the same)"));
    }
    let reason_of = |h: &Hunk| {
        reasons
            .get(&h.id)
            .cloned()
            .unwrap_or_else(|| "not accepted".into())
    };
    let reject_all = |events: &mut dyn FnMut(AgentEvent), hs: &[&Hunk]| {
        for h in hs {
            events(AgentEvent::HunkRejected {
                hunk: h.id.clone(),
                by: RejectedBy::Human,
                reason: reason_of(h),
            });
        }
    };
    let (yes, no): (Vec<&Hunk>, Vec<&Hunk>) =
        plan.hunks.iter().partition(|h| accepted.contains(&h.id));
    let refused = |hs: &[&Hunk]| {
        hs.iter()
            .map(|h| format!("{} ({})", describe(h.change.range), reason_of(h)))
            .collect::<Vec<_>>()
            .join("; ")
    };
    if yes.is_empty() {
        reject_all(events, &no);
        return ToolOutput::err(format!(
            "{path}: the human rejected the change, nothing was written: {}",
            refused(&no)
        ));
    }
    let stale = |events: &mut dyn FnMut(AgentEvent), why: &str| {
        for h in &yes {
            events(AgentEvent::HunkStale {
                hunk: h.id.clone(),
                path: path.clone(),
            });
        }
        reject_all(events, &no);
        ToolOutput::err(format!(
            "{path} changed before the change was applied ({why}); nothing was written: read \
             it again and redo the change"
        ))
    };

    // the file as it is now, and the accepted changes placed on it
    let (current, changes, foreign) = match plan.base {
        None => {
            if plan.abs.exists() {
                return stale(events, "the file was created meanwhile");
            }
            (
                String::new(),
                yes.iter().map(|h| h.change.clone()).collect(),
                false,
            )
        }
        Some(base) => {
            let Ok(bytes) = std::fs::read(&plan.abs) else {
                return stale(events, "it can no longer be read");
            };
            let fp = FileState::fingerprint(&bytes);
            let text = String::from_utf8_lossy(&bytes).to_string();
            if fp == base {
                (text, yes.iter().map(|h| h.change.clone()).collect(), false)
            } else {
                let moved: Option<Vec<Change>> =
                    yes.iter().map(|h| relocate(&text, &h.change)).collect();
                let Some(moved) = moved else {
                    return stale(events, "someone edited the same lines");
                };
                // the agent itself may have changed the file (an earlier call this turn)
                let foreign = files.seen(&plan.abs) != Some(fp);
                (text, moved, foreign)
            }
        }
    };
    let refs: Vec<&Change> = changes.iter().collect();
    let updated = match splice(&current, &refs) {
        Ok(u) => u,
        Err(e) => return stale(events, &e),
    };
    if let Some(dir) = plan.abs.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            return ToolOutput::err(format!("{path}: {e}"));
        }
        if let Err(e) = sandbox::ensure_within(root, dir) {
            return ToolOutput::err(e);
        }
    }
    if let Err(e) = std::fs::write(&plan.abs, updated.as_bytes()) {
        return ToolOutput::err(format!("{path}: {e}"));
    }
    if !foreign {
        files.record(&plan.abs, updated.as_bytes());
    }
    let fingerprint = fingerprint_hex(FileState::fingerprint(updated.as_bytes()));
    for h in &yes {
        events(AgentEvent::HunkApplied {
            hunk: h.id.clone(),
            provisional,
            fingerprint: fingerprint.clone(),
        });
    }
    reject_all(events, &no);

    let mut msg = if plan.base.is_none() {
        format!("{path}: created ({} lines)", updated.lines().count())
    } else {
        let at: Vec<String> = yes.iter().map(|h| describe(h.change.range)).collect();
        format!(
            "{path}: applied {} of {} change(s) ({})",
            yes.len(),
            plan.hunks.len(),
            at.join(", ")
        )
    };
    if !no.is_empty() {
        msg.push_str(&format!(
            ". Not applied, rejected by the human: {}. The file has only the applied changes",
            refused(&no)
        ));
    }
    if foreign {
        msg.push_str(
            ". The file also has changes you have not seen: read it again before changing it further",
        );
    }
    ToolOutput::ok(msg)
}

// ───── validation (Auto mode, RF-CODEV-STREAM §5) ─────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ValidationStatus {
    Running,
    Passed,
    Failed,
    Skipped,
}

/// The result of one validation command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Check {
    pub command: String,
    pub ok: bool,
    /// The last meaningful line of the output (or why it did not finish).
    pub summary: String,
}

/// Runs each command in the project root (same shell and limits as `run_tests`/`lint`).
pub fn run_checks(commands: &[String], ctx: &crate::tool::ToolCtx) -> Vec<Check> {
    commands
        .iter()
        .map(|c| {
            let r = crate::tools::run_process(
                crate::tools::shell(c),
                &ctx.root,
                crate::tools::MAX_TIMEOUT,
                ctx,
            );
            let summary = if r.cancelled {
                "cancelled".to_string()
            } else if r.timed_out {
                "timed out".to_string()
            } else {
                let out = format!("{}\n{}", r.stdout, r.stderr);
                let line = out
                    .lines()
                    .rev()
                    .map(str::trim)
                    .find(|l| !l.is_empty())
                    .unwrap_or("")
                    .to_string();
                let line: String = line.chars().take(200).collect();
                match r.code {
                    Some(0) => line,
                    Some(code) if line.is_empty() => format!("exit {code}"),
                    Some(code) => format!("exit {code}: {line}"),
                    None => "killed".to_string(),
                }
            };
            Check {
                command: c.clone(),
                ok: r.ok(),
                summary,
            }
        })
        .collect()
}

/// "Nothing broke": no command that passed before the changes fails after them. A command
/// that already failed may keep failing (the turn may be fixing something else).
pub fn broke(baseline: &[Check], after: &[Check]) -> Vec<Check> {
    after
        .iter()
        .filter(|a| {
            !a.ok
                && baseline
                    .iter()
                    .find(|b| b.command == a.command)
                    .is_none_or(|b| b.ok)
        })
        .cloned()
        .collect()
}

// ───── tracker: from the model's stream to hunk events ─────

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Edit,
    Write,
}

impl Kind {
    fn of(name: &str) -> Option<Kind> {
        match name {
            "edit" => Some(Kind::Edit),
            "write" => Some(Kind::Write),
            _ => None,
        }
    }
}

/// The hunk being written live, while the tool input streams.
#[derive(Debug)]
struct Stream {
    id: String,
    range: LineRange,
    old: String,
    base: Option<u64>,
    /// Everything sent so far in `hunk_chunk` events.
    sent: String,
    /// How much of the streamed field (`new_string`/`content`) is already in `sent`.
    taken: usize,
}

#[derive(Debug)]
struct Live {
    call: String,
    kind: Kind,
    reader: FieldReader,
    raw: String,
    fields: HashMap<String, String>,
    done: HashSet<String>,
    stream: Option<Stream>,
    /// Not streamable live (several occurrences, existing file for `write`, a check
    /// failed): the hunks come out when the block ends.
    deferred: bool,
}

/// Follows the model's stream and turns `edit`/`write` calls into hunk events. Lives for
/// one turn; the agent asks it for each call's [`Plan`] before deciding the call.
pub struct HunkTracker {
    root: PathBuf,
    root_c: PathBuf,
    files: Arc<FileState>,
    live: HashMap<usize, Live>,
    /// Calls whose block ended, with the hunk still streaming (finalised later).
    ended: HashMap<String, (Kind, Option<Stream>)>,
    plans: HashMap<String, Result<Plan, String>>,
    /// Hunks announced and not settled yet (applied, rejected or stale).
    open: Vec<String>,
    seq: HashMap<String, usize>,
}

impl HunkTracker {
    pub fn new(root: &Path, files: Arc<FileState>) -> Self {
        HunkTracker {
            root: root.to_path_buf(),
            root_c: std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf()),
            files,
            live: HashMap::new(),
            ended: HashMap::new(),
            plans: HashMap::new(),
            open: vec![],
            seq: HashMap::new(),
        }
    }

    fn next_id(&mut self, call: &str) -> String {
        let n = self.seq.entry(call.to_string()).or_insert(0);
        *n += 1;
        format!("{call}:{n}")
    }

    fn rel(&self, abs: &Path) -> String {
        abs.strip_prefix(&self.root_c)
            .unwrap_or(abs)
            .to_string_lossy()
            .replace('\\', "/")
    }

    /// Feeds one stream event.
    pub fn on_stream(&mut self, e: &StreamEvent, events: &mut dyn FnMut(AgentEvent)) {
        match e {
            StreamEvent::BlockStart {
                index,
                kind: BlockKind::ToolUse { id, name },
            } => {
                if let Some(kind) = Kind::of(name) {
                    self.live.insert(
                        *index,
                        Live {
                            call: id.clone(),
                            kind,
                            reader: FieldReader::new(),
                            raw: String::new(),
                            fields: HashMap::new(),
                            done: HashSet::new(),
                            stream: None,
                            deferred: false,
                        },
                    );
                }
            }
            StreamEvent::ToolInputDelta {
                index,
                partial_json,
            } => {
                let Some(mut l) = self.live.remove(index) else {
                    return;
                };
                l.raw.push_str(partial_json);
                for fe in l.reader.feed(partial_json) {
                    match fe {
                        FieldEvent::Chunk(k, t) => l.fields.entry(k).or_default().push_str(&t),
                        FieldEvent::End(k) => {
                            l.done.insert(k);
                        }
                        FieldEvent::Start(_) | FieldEvent::Scalar(..) => {}
                    }
                }
                self.try_start(&mut l, events);
                self.pump(&mut l, events);
                self.live.insert(*index, l);
            }
            StreamEvent::BlockStop { index } => {
                let Some(l) = self.live.remove(index) else {
                    return;
                };
                self.ended.insert(l.call.clone(), (l.kind, l.stream));
                if let Ok(input) = serde_json::from_str::<Value>(&l.raw) {
                    self.finalize(&l.call, &input, events);
                }
            }
            _ => {}
        }
    }

    /// Opens the live hunk once enough of the input is known.
    fn try_start(&mut self, l: &mut Live, events: &mut dyn FnMut(AgentEvent)) {
        if l.stream.is_some() || l.deferred || !l.done.contains("path") {
            return;
        }
        let given = l.fields.get("path").cloned().unwrap_or_default();
        let Ok(abs) = sandbox::resolve(&self.root, &given) else {
            l.deferred = true;
            return;
        };
        let (op, range, old, base, prefix) = match l.kind {
            Kind::Edit => {
                if !l.done.contains("old_string") {
                    return;
                }
                let old_s = l.fields.get("old_string").cloned().unwrap_or_default();
                let Ok(cur) = check_fresh(&self.files, &abs, &given) else {
                    l.deferred = true;
                    return;
                };
                let text = String::from_utf8_lossy(&cur).to_string();
                let occ: Vec<usize> = text.match_indices(&old_s).map(|(i, _)| i).collect();
                if old_s.is_empty() || occ.len() != 1 {
                    l.deferred = true;
                    return;
                }
                let i = occ[0];
                let c = edit_changes(&text, &old_s, "", &occ).remove(0);
                let prefix = text[line_start(&text, i)..i].to_string();
                (
                    HunkOp::Replace,
                    c.range,
                    c.old,
                    Some(FileState::fingerprint(&cur)),
                    prefix,
                )
            }
            Kind::Write => {
                if abs.exists() {
                    l.deferred = true;
                    return;
                }
                (
                    HunkOp::Create,
                    LineRange { start: 1, end: 0 },
                    String::new(),
                    None,
                    String::new(),
                )
            }
        };
        let id = self.next_id(&l.call);
        events(AgentEvent::HunkStart {
            hunk: id.clone(),
            call: l.call.clone(),
            path: self.rel(&abs),
            op,
            range,
            base: base.map(fingerprint_hex),
            old: old.clone(),
        });
        if !prefix.is_empty() {
            events(AgentEvent::HunkChunk {
                hunk: id.clone(),
                text: prefix.clone(),
            });
        }
        self.open.push(id.clone());
        l.stream = Some(Stream {
            id,
            range,
            old,
            base,
            sent: prefix,
            taken: 0,
        });
    }

    /// Sends the new text that arrived since the last chunk.
    fn pump(&mut self, l: &mut Live, events: &mut dyn FnMut(AgentEvent)) {
        let field = match l.kind {
            Kind::Edit => "new_string",
            Kind::Write => "content",
        };
        let (Some(s), Some(text)) = (l.stream.as_mut(), l.fields.get(field)) else {
            return;
        };
        if text.len() > s.taken {
            let piece = text[s.taken..].to_string();
            s.taken = text.len();
            s.sent.push_str(&piece);
            events(AgentEvent::HunkChunk {
                hunk: s.id.clone(),
                text: piece,
            });
        }
    }

    /// Computes the call's authoritative plan from its complete input, closes the live
    /// hunk (or replaces it, if the final plan differs) and announces the other hunks.
    fn finalize(&mut self, call: &str, input: &Value, events: &mut dyn FnMut(AgentEvent)) {
        let Some((kind, stream)) = self.ended.remove(call) else {
            return;
        };
        let planned = match kind {
            Kind::Edit => plan_edit(&self.files, &self.root, input),
            Kind::Write => plan_write(&self.files, &self.root, input),
        };
        let (abs, base, changes) = match planned {
            Ok(p) => p,
            Err(e) => {
                if let Some(s) = stream {
                    self.settle_ids(std::slice::from_ref(&s.id));
                    events(AgentEvent::HunkRejected {
                        hunk: s.id,
                        by: RejectedBy::Validation,
                        reason: e.clone(),
                    });
                }
                self.plans.insert(call.to_string(), Err(e));
                return;
            }
        };
        let path = self.rel(&abs);
        let mut hunks = vec![];
        let mut rest = changes.into_iter().peekable();
        if let Some(s) = stream {
            let fits = rest.peek().is_some_and(|c| {
                c.range == s.range && c.old == s.old && base == s.base && c.new.starts_with(&s.sent)
            });
            if fits {
                let c = rest.next().unwrap();
                if c.new.len() > s.sent.len() {
                    events(AgentEvent::HunkChunk {
                        hunk: s.id.clone(),
                        text: c.new[s.sent.len()..].to_string(),
                    });
                }
                events(AgentEvent::HunkEnd {
                    hunk: s.id.clone(),
                    text: c.new.clone(),
                    lines: c.lines(),
                });
                hunks.push(Hunk {
                    id: s.id,
                    change: c,
                });
            } else {
                self.settle_ids(std::slice::from_ref(&s.id));
                events(AgentEvent::HunkRejected {
                    hunk: s.id,
                    by: RejectedBy::Cancel,
                    reason: "replaced: the change was recomputed from the complete input".into(),
                });
            }
        }
        for c in rest {
            let id = self.next_id(call);
            events(AgentEvent::HunkStart {
                hunk: id.clone(),
                call: call.to_string(),
                path: path.clone(),
                op: c.op,
                range: c.range,
                base: base.map(fingerprint_hex),
                old: c.old.clone(),
            });
            if !c.new.is_empty() {
                events(AgentEvent::HunkChunk {
                    hunk: id.clone(),
                    text: c.new.clone(),
                });
            }
            events(AgentEvent::HunkEnd {
                hunk: id.clone(),
                text: c.new.clone(),
                lines: c.lines(),
            });
            self.open.push(id.clone());
            hunks.push(Hunk { id, change: c });
        }
        self.plans.insert(
            call.to_string(),
            Ok(Plan {
                call: call.to_string(),
                path,
                abs,
                base,
                hunks,
            }),
        );
    }

    /// The plan of an `edit`/`write` call (computed now if the stream did not finish it);
    /// `None` for other tools.
    pub fn take_plan(
        &mut self,
        call: &str,
        name: &str,
        input: &Value,
        events: &mut dyn FnMut(AgentEvent),
    ) -> Option<Result<Plan, String>> {
        let kind = Kind::of(name)?;
        if !self.plans.contains_key(call) {
            self.ended.entry(call.to_string()).or_insert((kind, None));
            self.finalize(call, input, events);
        }
        self.plans.remove(call)
    }

    fn settle_ids(&mut self, ids: &[String]) {
        self.open.retain(|o| !ids.contains(o));
    }

    /// The plan's hunks were applied or rejected (their events are out).
    pub fn settle(&mut self, plan: &Plan) {
        self.settle_ids(&plan.ids());
    }

    /// Rejects the hunks of `plan` (the call was denied or blocked) and settles them.
    pub fn reject(
        &mut self,
        plan: &Plan,
        by: RejectedBy,
        reason: &str,
        events: &mut dyn FnMut(AgentEvent),
    ) {
        for h in &plan.hunks {
            events(AgentEvent::HunkRejected {
                hunk: h.id.clone(),
                by,
                reason: reason.to_string(),
            });
        }
        self.settle(plan);
    }

    /// The response was thrown away (retry, refusal, cancel) or its calls did not run:
    /// every hunk still open is rejected, and the tracker starts clean.
    pub fn discard(&mut self, by: RejectedBy, reason: &str, events: &mut dyn FnMut(AgentEvent)) {
        for id in std::mem::take(&mut self.open) {
            events(AgentEvent::HunkRejected {
                hunk: id,
                by,
                reason: reason.to_string(),
            });
        }
        self.live.clear();
        self.ended.clear();
        self.plans.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn read_all(pieces: &[&str]) -> Vec<FieldEvent> {
        let mut r = FieldReader::new();
        pieces.iter().flat_map(|p| r.feed(p)).collect()
    }

    /// The concatenated text of a field.
    fn field(ev: &[FieldEvent], key: &str) -> String {
        ev.iter()
            .filter_map(|e| match e {
                FieldEvent::Chunk(k, t) if k == key => Some(t.as_str()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn reader_streams_string_fields_in_order() {
        let ev = read_all(&[
            r#"{"path": "src/a.rs", "old_str"#,
            r#"ing": "let x = 1;", "new_string": "let x"#,
            r#" = 2;\n", "replace_all": false}"#,
        ]);
        assert_eq!(field(&ev, "path"), "src/a.rs");
        assert_eq!(field(&ev, "old_string"), "let x = 1;");
        assert_eq!(field(&ev, "new_string"), "let x = 2;\n");
        assert!(ev.contains(&FieldEvent::End("old_string".into())));
        assert!(ev.contains(&FieldEvent::Scalar("replace_all".into(), "false".into())));
        // new_string came in two chunks, one per piece
        let chunks = ev
            .iter()
            .filter(|e| matches!(e, FieldEvent::Chunk(k, _) if k == "new_string"))
            .count();
        assert_eq!(chunks, 2);
    }

    #[test]
    fn reader_accepts_keys_out_of_order() {
        let ev = read_all(&[r#"{"new_string":"b","old_string":"a","path":"x"}"#]);
        let order: Vec<&FieldEvent> = ev
            .iter()
            .filter(|e| matches!(e, FieldEvent::End(_)))
            .collect();
        assert_eq!(
            order,
            vec![
                &FieldEvent::End("new_string".into()),
                &FieldEvent::End("old_string".into()),
                &FieldEvent::End("path".into())
            ]
        );
    }

    #[test]
    fn reader_decodes_escapes_split_across_pieces() {
        // \n split after the backslash, é split in the middle, a surrogate pair
        // (U+1F600) split between its two escapes, and an escaped quote
        let ev = read_all(&[
            r#"{"content":"a\"#,
            r#"nb \u00"#,
            r#"e9 \ud83d"#,
            r#"\ude00 \"q\" \\ \/ \t"}"#,
        ]);
        assert_eq!(field(&ev, "content"), "a\nb é 😀 \"q\" \\ / \t");
        assert!(ev.contains(&FieldEvent::End("content".into())));
    }

    #[test]
    fn reader_matches_serde_on_awkward_text() {
        let text = "fn main() {\n\tprintln!(\"{}\", \"ã\\\\\");\n}\r\n🦀 \u{7f}";
        let raw = serde_json::to_string(&json!({"path": "p", "content": text})).unwrap();
        // feed one byte-boundary-safe character at a time
        let mut r = FieldReader::new();
        let mut ev = vec![];
        for c in raw.chars() {
            ev.extend(r.feed(&c.to_string()));
        }
        assert_eq!(field(&ev, "content"), text);
    }

    #[test]
    fn reader_lone_surrogate_becomes_replacement_char() {
        let ev = read_all(&[r#"{"content":"x\ud83dy"}"#]);
        assert_eq!(field(&ev, "content"), "x\u{FFFD}y");
    }

    #[test]
    fn reader_stops_quietly_on_truncated_input() {
        let ev = read_all(&[r#"{"path":"a.rs","new_string":"half"#]);
        assert_eq!(field(&ev, "path"), "a.rs");
        assert_eq!(field(&ev, "new_string"), "half");
        assert!(!ev.contains(&FieldEvent::End("new_string".into())));
    }

    #[test]
    fn reader_skips_nested_values() {
        let ev = read_all(&[r#"{"opts":{"a":[1,"}",{"b":"]"}]},"path":"z"}"#]);
        assert!(ev.contains(&FieldEvent::Scalar(
            "opts".into(),
            r#"{"a":[1,"}",{"b":"]"}]}"#.into()
        )));
        assert_eq!(field(&ev, "path"), "z");
    }

    #[test]
    fn edit_change_widens_to_whole_lines() {
        let text = "fn a() {\n    for c in chars {\n    }\n}\n";
        let i = text.find("for c in chars").unwrap();
        let c = edit_changes(
            text,
            "for c in chars",
            "while let Some(c) = chars.next()",
            &[i],
        );
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].range, LineRange { start: 2, end: 2 });
        assert_eq!(c[0].old, "    for c in chars {\n");
        assert_eq!(c[0].new, "    while let Some(c) = chars.next() {\n");
        assert_eq!(
            c[0].lines(),
            LineCount {
                added: 1,
                removed: 1
            }
        );
    }

    #[test]
    fn edit_change_at_start_and_end_of_file_without_final_newline() {
        let text = "first\nmiddle\nlast";
        let c = edit_changes(text, "first", "FIRST", &[0]);
        assert_eq!(c[0].range, LineRange { start: 1, end: 1 });
        let i = text.find("last").unwrap();
        let c = edit_changes(text, "last", "LAST\nmore", &[i]);
        assert_eq!(c[0].range, LineRange { start: 3, end: 3 });
        assert_eq!(c[0].old, "last");
        assert_eq!(c[0].new, "LAST\nmore");
        assert_eq!(splice(text, &[&c[0]]).unwrap(), "first\nmiddle\nLAST\nmore");
    }

    #[test]
    fn edit_change_keeps_crlf_line_endings() {
        let text = "a\r\nb = 1\r\nc\r\n";
        let i = text.find("1").unwrap();
        let c = edit_changes(text, "1", "2", &[i]);
        assert_eq!(c[0].range, LineRange { start: 2, end: 2 });
        assert_eq!(c[0].old, "b = 1\r\n");
        assert_eq!(c[0].new, "b = 2\r\n");
    }

    #[test]
    fn edit_change_spanning_lines_and_deleting_lines() {
        let text = "a\nb\nc\nd\n";
        let i = text.find("b\nc\n").unwrap();
        let c = edit_changes(text, "b\nc\n", "", &[i]);
        assert_eq!(c[0].op, HunkOp::Delete);
        assert_eq!(c[0].range, LineRange { start: 2, end: 3 });
        assert_eq!(splice(text, &[&c[0]]).unwrap(), "a\nd\n");
    }

    #[test]
    fn replace_all_gives_one_hunk_per_line_group() {
        let text = "x = foo(foo)\ny\nfoo\n";
        let occ: Vec<usize> = text.match_indices("foo").map(|(i, _)| i).collect();
        let c = edit_changes(text, "foo", "bar", &occ);
        assert_eq!(c.len(), 2, "two occurrences on line 1 share a hunk");
        assert_eq!(c[0].range, LineRange { start: 1, end: 1 });
        assert_eq!(c[0].new, "x = bar(bar)\n");
        assert_eq!(c[1].range, LineRange { start: 3, end: 3 });
        let all: Vec<&Change> = c.iter().collect();
        assert_eq!(splice(text, &all).unwrap(), text.replace("foo", "bar"));
    }

    #[test]
    fn diff_touches_only_changed_lines() {
        let old = "a\nb\nc\nd\ne\n";
        let new = "a\nB\nc\nd\nx\ne\n";
        let c = diff_changes(old, new);
        assert_eq!(c.len(), 2);
        assert_eq!(
            (c[0].op, c[0].range, c[0].old.as_str(), c[0].new.as_str()),
            (
                HunkOp::Replace,
                LineRange { start: 2, end: 2 },
                "b\n",
                "B\n"
            )
        );
        assert_eq!(
            (c[1].op, c[1].range, c[1].new.as_str()),
            (HunkOp::Insert, LineRange { start: 5, end: 4 }, "x\n")
        );
        let all: Vec<&Change> = c.iter().collect();
        assert_eq!(splice(old, &all).unwrap(), new);
        assert!(diff_changes(old, old).is_empty());
    }

    #[test]
    fn diff_insert_at_end_and_delete() {
        let c = diff_changes("a\nb\n", "a\n");
        assert_eq!(
            (c[0].op, c[0].range),
            (HunkOp::Delete, LineRange { start: 2, end: 2 })
        );
        let c = diff_changes("a\n", "a\nb\n");
        assert_eq!(
            (c[0].op, c[0].range),
            (HunkOp::Insert, LineRange { start: 2, end: 1 })
        );
        assert_eq!(splice("a\n", &[&c[0]]).unwrap(), "a\nb\n");
    }

    #[test]
    fn splice_refuses_text_that_moved() {
        let c = Change {
            op: HunkOp::Replace,
            range: LineRange { start: 2, end: 2 },
            old: "b\n".into(),
            new: "B\n".into(),
        };
        assert!(splice("a\nX\nb\n", &[&c]).is_err());
    }

    #[test]
    fn relocate_finds_unique_whole_lines_only() {
        let c = Change {
            op: HunkOp::Replace,
            range: LineRange { start: 2, end: 2 },
            old: "b\n".into(),
            new: "B\n".into(),
        };
        let moved = relocate("new\na\nb\n", &c).unwrap();
        assert_eq!(moved.range, LineRange { start: 3, end: 3 });
        assert!(relocate("b\nb\n", &c).is_none(), "ambiguous");
        assert!(relocate("ab\n", &c).is_none(), "not a whole line");
        // overlapping candidates are both seen
        let two = Change {
            old: "x\nx\n".into(),
            ..c.clone()
        };
        assert!(relocate("x\nx\nx\n", &two).is_none());
    }

    // ── plan + apply against a real folder ──

    struct Ws {
        dir: tempfile::TempDir,
        files: Arc<FileState>,
    }

    impl Ws {
        fn new() -> Self {
            Ws {
                dir: tempfile::tempdir().unwrap(),
                files: Arc::new(FileState::default()),
            }
        }
        fn root(&self) -> &Path {
            self.dir.path()
        }
        fn put(&self, rel: &str, text: &str) {
            std::fs::write(self.root().join(rel), text).unwrap();
        }
        /// Writes and marks as read by the agent.
        fn seen(&self, rel: &str, text: &str) {
            self.put(rel, text);
            let p = sandbox::resolve(self.root(), rel).unwrap();
            self.files.record(&p, text.as_bytes());
        }
        fn get(&self, rel: &str) -> String {
            std::fs::read_to_string(self.root().join(rel)).unwrap()
        }
        fn plan(&self, kind: &str, input: Value) -> Plan {
            let (abs, base, changes) = match kind {
                "edit" => plan_edit(&self.files, self.root(), &input),
                _ => plan_write(&self.files, self.root(), &input),
            }
            .unwrap();
            Plan {
                call: "t".into(),
                path: "f".into(),
                abs,
                base,
                hunks: changes
                    .into_iter()
                    .enumerate()
                    .map(|(n, change)| Hunk {
                        id: format!("t:{}", n + 1),
                        change,
                    })
                    .collect(),
            }
        }
        fn apply(&self, plan: &Plan, accept: &[&str]) -> (ToolOutput, Vec<AgentEvent>) {
            let mut ev = vec![];
            let acc: HashSet<String> = accept.iter().map(|s| s.to_string()).collect();
            let mut reasons = HashMap::new();
            reasons.insert("t:2".to_string(), "not this".to_string());
            let out = apply(
                plan,
                &acc,
                &reasons,
                false,
                &self.files,
                self.root(),
                &mut |e| ev.push(e),
            );
            (out, ev)
        }
    }

    #[test]
    fn plan_uses_the_tool_checks_and_messages() {
        let ws = Ws::new();
        ws.put("f", "a\n");
        let err = plan_edit(
            &ws.files,
            ws.root(),
            &json!({"path": "f", "old_string": "a", "new_string": "b"}),
        )
        .unwrap_err();
        assert!(err.contains("lê o ficheiro com `read`"), "{err}");
        ws.seen("f", "a\na\n");
        let err = plan_edit(
            &ws.files,
            ws.root(),
            &json!({"path": "f", "old_string": "a", "new_string": "b"}),
        )
        .unwrap_err();
        assert!(err.contains("aparece 2 vezes"), "{err}");
    }

    #[test]
    fn accepting_one_of_three_hunks_writes_only_that_one() {
        let ws = Ws::new();
        ws.seen("f", "1\n2\n3\n4\n5\n6\n7\n");
        let plan = ws.plan(
            "write",
            json!({"path": "f", "content": "one\n2\n3\nfour\n5\n6\nseven\n"}),
        );
        assert_eq!(plan.hunks.len(), 3);
        let (out, ev) = ws.apply(&plan, &["t:3"]);
        assert!(!out.is_error, "{}", out.content);
        assert_eq!(ws.get("f"), "1\n2\n3\n4\n5\n6\nseven\n");
        assert!(out.content.contains("applied 1 of 3"), "{}", out.content);
        assert!(out.content.contains("line 4 (not this)"), "{}", out.content);
        let applied: Vec<&AgentEvent> = ev
            .iter()
            .filter(|e| matches!(e, AgentEvent::HunkApplied { .. }))
            .collect();
        assert_eq!(applied.len(), 1);
        let rejected = ev
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    AgentEvent::HunkRejected {
                        by: RejectedBy::Human,
                        ..
                    }
                )
            })
            .count();
        assert_eq!(rejected, 2);
        // the agent's view follows what it wrote: a further edit needs no new read
        let p = sandbox::resolve(ws.root(), "f").unwrap();
        assert_eq!(
            ws.files.seen(&p),
            Some(FileState::fingerprint(ws.get("f").as_bytes()))
        );
    }

    #[test]
    fn rejecting_everything_writes_nothing() {
        let ws = Ws::new();
        ws.seen("f", "a\n");
        let plan = ws.plan(
            "edit",
            json!({"path": "f", "old_string": "a", "new_string": "b"}),
        );
        let (out, _) = ws.apply(&plan, &[]);
        assert!(out.is_error);
        assert_eq!(ws.get("f"), "a\n");
    }

    #[test]
    fn a_human_edit_on_the_same_lines_makes_the_hunk_stale() {
        let ws = Ws::new();
        ws.seen("f", "a\nb\nc\n");
        let plan = ws.plan(
            "edit",
            json!({"path": "f", "old_string": "b", "new_string": "B"}),
        );
        ws.put("f", "a\nb!\nc\n");
        let (out, ev) = ws.apply(&plan, &["t:1"]);
        assert!(out.is_error);
        assert!(out
            .content
            .contains("changed before the change was applied"));
        assert!(matches!(ev[0], AgentEvent::HunkStale { .. }));
        assert_eq!(ws.get("f"), "a\nb!\nc\n");
    }

    #[test]
    fn a_human_edit_elsewhere_moves_the_hunk_and_asks_for_a_new_read() {
        let ws = Ws::new();
        ws.seen("f", "a\nb\nc\n");
        let plan = ws.plan(
            "edit",
            json!({"path": "f", "old_string": "c", "new_string": "C"}),
        );
        ws.put("f", "new line\na\nb\nc\n");
        let (out, _) = ws.apply(&plan, &["t:1"]);
        assert!(!out.is_error, "{}", out.content);
        assert_eq!(ws.get("f"), "new line\na\nb\nC\n");
        assert!(out.content.contains("read it again"));
        // the human's change was not seen by the agent: its next edit must re-read
        let p = sandbox::resolve(ws.root(), "f").unwrap();
        assert_ne!(
            ws.files.seen(&p),
            Some(FileState::fingerprint(ws.get("f").as_bytes()))
        );
    }

    #[test]
    fn create_is_stale_when_the_file_appears_meanwhile() {
        let ws = Ws::new();
        let plan = ws.plan("write", json!({"path": "sub/new.rs", "content": "x\n"}));
        assert_eq!(plan.hunks[0].change.op, HunkOp::Create);
        let (out, _) = ws.apply(&plan, &["t:1"]);
        assert!(!out.is_error, "{}", out.content);
        assert_eq!(ws.get("sub/new.rs"), "x\n");
        let plan = Plan { base: None, ..plan };
        let (out, ev) = ws.apply(&plan, &["t:1"]);
        assert!(out.is_error);
        assert!(matches!(ev[0], AgentEvent::HunkStale { .. }));
    }

    // ── tracker ──

    fn stream_call(
        t: &mut HunkTracker,
        id: &str,
        name: &str,
        pieces: &[&str],
        ev: &mut Vec<AgentEvent>,
    ) {
        let mut push = |e| ev.push(e);
        t.on_stream(
            &StreamEvent::BlockStart {
                index: 1,
                kind: BlockKind::ToolUse {
                    id: id.into(),
                    name: name.into(),
                },
            },
            &mut push,
        );
        for p in pieces {
            t.on_stream(
                &StreamEvent::ToolInputDelta {
                    index: 1,
                    partial_json: p.to_string(),
                },
                &mut push,
            );
        }
        t.on_stream(&StreamEvent::BlockStop { index: 1 }, &mut push);
    }

    fn kinds(ev: &[AgentEvent]) -> Vec<String> {
        ev.iter()
            .map(|e| {
                serde_json::to_value(e).unwrap()["kind"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }

    #[test]
    fn tracker_streams_an_edit_live_on_its_lines() {
        let ws = Ws::new();
        ws.seen("lib.rs", "fn f() {\n    for c in chars {\n    }\n}\n");
        let mut t = HunkTracker::new(ws.root(), ws.files.clone());
        let mut ev = vec![];
        stream_call(
            &mut t,
            "toolu_1",
            "edit",
            &[
                r#"{"path":"lib.rs","old_string":"for c in chars","#,
                r#""new_string":"while let Some(c) "#,
                r#"= chars.next()"}"#,
            ],
            &mut ev,
        );
        assert_eq!(
            kinds(&ev),
            [
                "hunk_start",
                "hunk_chunk",
                "hunk_chunk",
                "hunk_chunk",
                "hunk_chunk",
                "hunk_end"
            ]
        );
        let start = serde_json::to_value(&ev[0]).unwrap();
        assert_eq!(start["hunk"], "toolu_1:1");
        assert_eq!(start["path"], "lib.rs");
        assert_eq!(start["op"], "replace");
        assert_eq!(start["range"], json!({"start": 2, "end": 2}));
        assert_eq!(start["old"], "    for c in chars {\n");
        // prefix, two pieces of new_string, then the rest of the line at the end
        let chunks: Vec<String> = ev
            .iter()
            .filter_map(|e| match e {
                AgentEvent::HunkChunk { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect();
        assert_eq!(
            chunks,
            ["    ", "while let Some(c) ", "= chars.next()", " {\n"]
        );
        let AgentEvent::HunkEnd { text, lines, .. } = ev.last().unwrap() else {
            panic!()
        };
        assert_eq!(text, &chunks.concat());
        assert_eq!(
            *lines,
            LineCount {
                added: 1,
                removed: 1
            }
        );
        // nothing touched the disk
        assert_eq!(
            ws.get("lib.rs"),
            "fn f() {\n    for c in chars {\n    }\n}\n"
        );
        let plan = t
            .take_plan("toolu_1", "edit", &json!({}), &mut |_| {})
            .unwrap()
            .unwrap();
        assert_eq!(plan.ids(), ["toolu_1:1"]);
    }

    #[test]
    fn tracker_waits_for_old_string_when_keys_come_out_of_order() {
        let ws = Ws::new();
        ws.seen("a.txt", "x\ny\n");
        let mut t = HunkTracker::new(ws.root(), ws.files.clone());
        let mut ev = vec![];
        stream_call(
            &mut t,
            "c",
            "edit",
            &[
                r#"{"new_string":"Y","path":"a.txt","#,
                r#""old_string":"y"}"#,
            ],
            &mut ev,
        );
        assert_eq!(
            kinds(&ev),
            ["hunk_start", "hunk_chunk", "hunk_chunk", "hunk_end"]
        );
        let AgentEvent::HunkEnd { text, .. } = ev.last().unwrap() else {
            panic!()
        };
        assert_eq!(text, "Y\n");
    }

    #[test]
    fn tracker_streams_a_new_file_and_defers_an_existing_one() {
        let ws = Ws::new();
        let mut t = HunkTracker::new(ws.root(), ws.files.clone());
        let mut ev = vec![];
        stream_call(
            &mut t,
            "w1",
            "write",
            &[r#"{"path":"n.rs","content":"a\n"#, r#"b\n"}"#],
            &mut ev,
        );
        assert_eq!(
            kinds(&ev),
            ["hunk_start", "hunk_chunk", "hunk_chunk", "hunk_end"]
        );
        assert_eq!(serde_json::to_value(&ev[0]).unwrap()["op"], "create");
        assert!(!ws.root().join("n.rs").exists());

        ws.seen("e.rs", "1\n2\n3\n");
        let mut ev = vec![];
        stream_call(
            &mut t,
            "w2",
            "write",
            &[r#"{"path":"e.rs","content":"1\n"#, r#"two\n3\n"}"#],
            &mut ev,
        );
        // nothing while streaming; one hunk for the one changed line at the end
        assert_eq!(kinds(&ev), ["hunk_start", "hunk_chunk", "hunk_end"]);
        let start = serde_json::to_value(&ev[0]).unwrap();
        assert_eq!(start["range"], json!({"start": 2, "end": 2}));
        assert_eq!(start["old"], "2\n");
    }

    #[test]
    fn tracker_retracts_a_live_hunk_the_tool_would_refuse() {
        let ws = Ws::new();
        ws.seen("a", "k\n");
        let mut t = HunkTracker::new(ws.root(), ws.files.clone());
        let mut ev = vec![];
        stream_call(
            &mut t,
            "c",
            "edit",
            &[r#"{"path":"a","old_string":"k","new_string":"k"}"#],
            &mut ev,
        );
        assert_eq!(kinds(&ev).last().unwrap(), "hunk_rejected");
        let last = serde_json::to_value(ev.last().unwrap()).unwrap();
        assert_eq!(last["by"], "validation");
        let plan = t.take_plan("c", "edit", &json!({}), &mut |_| {}).unwrap();
        assert!(plan.unwrap_err().contains("iguais"));
    }

    #[test]
    fn tracker_discard_rejects_open_hunks() {
        let ws = Ws::new();
        ws.seen("a", "k\n");
        let mut t = HunkTracker::new(ws.root(), ws.files.clone());
        let mut ev = vec![];
        let mut push = |e| ev.push(e);
        t.on_stream(
            &StreamEvent::BlockStart {
                index: 0,
                kind: BlockKind::ToolUse {
                    id: "c".into(),
                    name: "edit".into(),
                },
            },
            &mut push,
        );
        t.on_stream(
            &StreamEvent::ToolInputDelta {
                index: 0,
                partial_json: r#"{"path":"a","old_string":"k","new_string":"K"#.into(),
            },
            &mut push,
        );
        t.discard(RejectedBy::Cancel, "stopped", &mut push);
        assert_eq!(kinds(&ev), ["hunk_start", "hunk_chunk", "hunk_rejected"]);
        assert!(t.take_plan("c", "read", &json!({}), &mut |_| {}).is_none());
    }

    fn check(command: &str, ok: bool) -> Check {
        Check {
            command: command.into(),
            ok,
            summary: String::new(),
        }
    }

    #[test]
    fn broke_counts_only_checks_that_passed_before() {
        let base = [check("test", true), check("lint", false)];
        assert!(broke(&base, &[check("test", true), check("lint", false)]).is_empty());
        let b = broke(&base, &[check("test", false), check("lint", false)]);
        assert_eq!(b, [check("test", false)]);
        // a command with no baseline counts as having passed
        assert_eq!(broke(&[], &[check("new", false)]).len(), 1);
    }

    #[test]
    fn run_checks_reports_exit_and_last_line() {
        let ws = Ws::new();
        let ctx = crate::tool::ToolCtx {
            root: ws.root().to_path_buf(),
            cancel: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        };
        let r = run_checks(
            &[
                "echo one; echo 4 passed".into(),
                "echo boom >&2; exit 3".into(),
            ],
            &ctx,
        );
        assert!(r[0].ok);
        assert_eq!(r[0].summary, "4 passed");
        assert!(!r[1].ok);
        assert_eq!(r[1].summary, "exit 3: boom");
    }

    #[test]
    fn other_tools_are_ignored() {
        let ws = Ws::new();
        let mut t = HunkTracker::new(ws.root(), ws.files.clone());
        let mut ev = vec![];
        stream_call(&mut t, "b", "bash", &[r#"{"command":"ls"}"#], &mut ev);
        assert!(ev.is_empty());
        assert!(t.take_plan("b", "bash", &json!({}), &mut |_| {}).is_none());
    }
}
