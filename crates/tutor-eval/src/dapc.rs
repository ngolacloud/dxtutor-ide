//! A Debug Adapter Protocol client (A7, docs/v2/UI-AUDIT.md item 4, DBG-01..03).
//!
//! Drives a real DAP adapter over stdio — `lldb-dap` (LLVM; Rust, C, C++) — the protocol VS Code
//! speaks to every debugger: breakpoints with a condition, a hit count or a log message
//! (logpoints), a function breakpoint on `rust_panic` («stop on panic»), threads, the stack,
//! scopes and variables (expanded on demand, with what changed since the previous stop),
//! watch expressions, continue / step over / into / out / pause, and the program's output.
//!
//! The transport is one reader thread per adapter: it frames `Content-Length` messages, hands
//! each response to the request waiting for it and queues the events, so a `pause` can be sent
//! while another call is waiting for the program to stop. Nothing is simulated: without an
//! adapter `DapSession::launch` fails and says what to install.

use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The adapters spoken over stdio, in order of preference.
pub const STDIO_ADAPTERS: &[&str] = &["lldb-dap", "lldb-vscode"];

/// The first stdio DAP adapter on `PATH`.
pub fn find_adapter() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    STDIO_ADAPTERS.iter().find_map(|a| {
        std::env::split_paths(&path)
            .map(|d| d.join(a))
            .find(|p| p.is_file())
    })
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

type Events = Arc<(Mutex<VecDeque<Value>>, Condvar)>;
type Pending = Arc<Mutex<HashMap<i64, mpsc::Sender<Value>>>>;

/// The program's output and the adapter's console lines, as they come.
pub type OnOutput = Arc<dyn Fn(&str, &str) + Send + Sync>;

/// The wire: requests, responses and events of one adapter process.
pub struct DapClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    seq: AtomicI64,
    pending: Pending,
    events: Events,
    alive: Arc<AtomicBool>,
}

fn read_message(r: &mut impl BufRead) -> Option<Value> {
    let mut len: Option<usize> = None;
    loop {
        let mut line = String::new();
        if r.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let l = line.trim_end();
        if l.is_empty() {
            if len.is_some() {
                break;
            }
            continue;
        }
        if let Some(v) = l.strip_prefix("Content-Length:") {
            len = v.trim().parse().ok();
        }
    }
    let mut buf = vec![0u8; len?];
    r.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

/// Frames one message for the wire.
pub fn frame(v: &Value) -> Vec<u8> {
    let body = v.to_string();
    let mut out = format!("Content-Length: {}\r\n\r\n", body.len()).into_bytes();
    out.extend_from_slice(body.as_bytes());
    out
}

impl DapClient {
    pub fn spawn(
        adapter: &Path,
        cwd: Option<&Path>,
        on_output: Option<OnOutput>,
    ) -> Result<DapClient, String> {
        DapClient::spawn_cmd(&[adapter.display().to_string()], cwd, on_output)
    }

    /// Starts an adapter from a command line — `lldb-dap`, or one that runs it elsewhere
    /// (`docker exec -i <container> lldb-dap`, `kubectl exec -i <pod> -- lldb-dap`).
    pub fn spawn_cmd(
        argv: &[String],
        cwd: Option<&Path>,
        on_output: Option<OnOutput>,
    ) -> Result<DapClient, String> {
        let (prog, rest) = argv.split_first().ok_or("empty adapter command")?;
        let mut cmd = Command::new(prog);
        cmd.args(rest);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(d) = cwd {
            cmd.current_dir(d);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", argv.join(" ")))?;
        let stdin = child.stdin.take().ok_or("adapter has no stdin")?;
        let stdout = child.stdout.take().ok_or("adapter has no stdout")?;
        let pending: Pending = Arc::default();
        let events: Events = Arc::new((Mutex::new(VecDeque::new()), Condvar::new()));
        let alive = Arc::new(AtomicBool::new(true));
        {
            let (pending, events, alive) = (pending.clone(), events.clone(), alive.clone());
            std::thread::spawn(move || {
                let mut r = BufReader::new(stdout);
                while let Some(m) = read_message(&mut r) {
                    match m["type"].as_str() {
                        Some("response") => {
                            let id = m["request_seq"].as_i64().unwrap_or(-1);
                            if let Some(tx) = pending.lock().ok().and_then(|mut p| p.remove(&id)) {
                                let _ = tx.send(m);
                            }
                        }
                        Some("event") => {
                            if m["event"] == "output" {
                                if let Some(f) = &on_output {
                                    f(
                                        m["body"]["category"].as_str().unwrap_or("console"),
                                        m["body"]["output"].as_str().unwrap_or(""),
                                    );
                                }
                                continue;
                            }
                            let (q, cv) = &*events;
                            if let Ok(mut q) = q.lock() {
                                q.push_back(m);
                                cv.notify_all();
                            }
                        }
                        _ => {}
                    }
                }
                // the adapter went away: wake whoever waits
                alive.store(false, Ordering::SeqCst);
                if let Ok(mut p) = pending.lock() {
                    p.clear();
                }
                let (q, cv) = &*events;
                if let Ok(mut q) = q.lock() {
                    q.push_back(json!({"type": "event", "event": "terminated", "body": {"adapterGone": true}}));
                    cv.notify_all();
                }
            });
        }
        Ok(DapClient {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            seq: AtomicI64::new(1),
            pending,
            events,
            alive,
        })
    }

    fn send(&self, command: &str, arguments: Value) -> Result<mpsc::Receiver<Value>, String> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err("the debug adapter has exited".into());
        }
        let seq = self.seq.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        self.pending.lock().map_err(|_| "dap lock")?.insert(seq, tx);
        let msg =
            json!({"seq": seq, "type": "request", "command": command, "arguments": arguments});
        let mut w = self.stdin.lock().map_err(|_| "dap lock")?;
        w.write_all(&frame(&msg))
            .and_then(|_| w.flush())
            .map_err(|e| format!("write to adapter: {e}"))?;
        Ok(rx)
    }

    /// Sends a request and waits for its response; the response's `body` or the adapter's message.
    pub fn request(&self, command: &str, arguments: Value) -> Result<Value, String> {
        let rx = self.send(command, arguments)?;
        let m = rx
            .recv_timeout(REQUEST_TIMEOUT)
            .map_err(|_| format!("the debug adapter did not answer `{command}`"))?;
        response_body(command, m)
    }

    /// Sends a request without waiting (its response is read and dropped).
    pub fn request_later(
        &self,
        command: &str,
        arguments: Value,
    ) -> Result<mpsc::Receiver<Value>, String> {
        self.send(command, arguments)
    }

    /// Waits for the first queued event that `pred` accepts (and removes it); `None` waits forever.
    pub fn wait_event(
        &self,
        pred: impl Fn(&Value) -> bool,
        timeout: Option<Duration>,
    ) -> Result<Value, String> {
        let (q, cv) = &*self.events;
        let deadline = timeout.map(|t| Instant::now() + t);
        let mut g = q.lock().map_err(|_| "dap lock")?;
        loop {
            if let Some(i) = g.iter().position(&pred) {
                return Ok(g.remove(i).unwrap_or(Value::Null));
            }
            if let Some(i) = g.iter().position(|e| e["event"] == "terminated") {
                // nothing else will come
                let e = g[i].clone();
                if pred(&e) {
                    g.remove(i);
                }
                return Ok(e);
            }
            g = match deadline {
                None => cv.wait(g).map_err(|_| "dap lock")?,
                Some(d) => {
                    let now = Instant::now();
                    if now >= d {
                        return Err("timed out waiting for the debug adapter".into());
                    }
                    cv.wait_timeout(g, d - now).map_err(|_| "dap lock")?.0
                }
            };
        }
    }

    /// Drops the queued events `pred` accepts (stale ones, before the program is resumed).
    pub fn drain(&self, pred: impl Fn(&Value) -> bool) -> usize {
        let (q, _) = &*self.events;
        let Ok(mut g) = q.lock() else { return 0 };
        let before = g.len();
        g.retain(|e| !pred(e));
        before - g.len()
    }

    pub fn kill(&self) {
        if let Ok(mut c) = self.child.lock() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

fn response_body(command: &str, m: Value) -> Result<Value, String> {
    if m["success"].as_bool().unwrap_or(false) {
        Ok(m["body"].clone())
    } else {
        let msg = m["body"]["error"]["format"]
            .as_str()
            .or(m["message"].as_str())
            .unwrap_or("failed");
        Err(format!("{command}: {msg}"))
    }
}

impl Drop for DapClient {
    fn drop(&mut self) {
        self.kill();
    }
}

// ───── the session ─────

/// A source breakpoint as the human set it in the gutter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointSpec {
    pub line: u32,
    /// stop only when this expression is true
    #[serde(default)]
    pub condition: Option<String>,
    /// stop on the n-th hit (adapter syntax, e.g. `3`)
    #[serde(default)]
    pub hit_condition: Option<String>,
    /// a logpoint: print this (with `{expr}`) instead of stopping
    #[serde(default)]
    pub log_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BreakpointState {
    pub line: u32,
    pub verified: bool,
    pub message: Option<String>,
}

/// Where the program stopped (the same shape as the gdb driver's `Stop`).
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DapStop {
    pub stopped: bool,
    pub reason: String,
    pub func: String,
    pub file: String,
    pub line: u32,
    pub exited: bool,
    pub exit_code: Option<i32>,
    /// the thread that stopped
    pub thread: Option<i64>,
    /// the adapter's explanation (an exception's text…)
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapThread {
    pub id: i64,
    pub name: String,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DapFrame {
    pub level: u32,
    pub id: i64,
    pub func: String,
    pub file: String,
    pub line: u32,
}

/// A variable (or a scope, or a watch result). `reference` > 0 has children.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VarNode {
    pub name: String,
    pub value: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub reference: i64,
    /// its value differs from the previous stop (same function, same path)
    pub changed: bool,
    /// a stable path for the diff and the watch (`frame-func/scope/a.b`)
    pub path: String,
    /// where its bytes are, for `read_memory` (adapters that support memory references)
    pub memory_reference: Option<String>,
}

/// An exception filter the adapter offers (`setExceptionBreakpoints`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExceptionFilter {
    pub filter: String,
    pub label: String,
    pub default: bool,
}

/// What this adapter can do, from its `initialize` answer (r23 F2): the UI shows a control only
/// when the adapter has it, and says why otherwise.
#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionCaps {
    pub step_back: bool,
    pub data_breakpoints: bool,
    pub read_memory: bool,
    pub restart_frame: bool,
    pub exception_filters: Vec<ExceptionFilter>,
}

impl SessionCaps {
    pub fn from_initialize(b: &Value) -> SessionCaps {
        let on = |k: &str| b[k].as_bool().unwrap_or(false);
        SessionCaps {
            step_back: on("supportsStepBack"),
            data_breakpoints: on("supportsDataBreakpoints"),
            read_memory: on("supportsReadMemoryRequest"),
            restart_frame: on("supportsRestartFrame"),
            exception_filters: b["exceptionBreakpointFilters"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|f| {
                            Some(ExceptionFilter {
                                filter: f["filter"].as_str()?.to_string(),
                                label: f["label"].as_str().unwrap_or("").to_string(),
                                default: f["default"].as_bool().unwrap_or(false),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}

/// A data breakpoint (a watchpoint): stop when the bytes of a variable are written (or read).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataBreakpoint {
    pub data_id: String,
    /// what the adapter calls it (`watch p.x`…)
    pub description: String,
    /// `write`, `read` or `readWrite`
    pub access_type: String,
    pub verified: bool,
    pub message: Option<String>,
}

/// What to watch: a variable `name` inside the container `reference` (a scope or a parent
/// variable), or an expression in frame `frame` when there is no container.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTarget {
    pub frame: u32,
    #[serde(default)]
    pub reference: Option<i64>,
    pub name: String,
    #[serde(default)]
    pub access_type: Option<String>,
}

/// Bytes read from the program (`readMemory`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryBlock {
    pub address: String,
    pub bytes: Vec<u8>,
    pub unreadable: u64,
}

/// Standard base64 (what DAP uses for memory), without a dependency.
pub fn base64_decode(s: &str) -> Result<Vec<u8>, String> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let clean: Vec<u8> = s
        .bytes()
        .filter(|c| !c.is_ascii_whitespace() && *c != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut n = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            n |= val(*c).ok_or("memory: not base64")? << (18 - 6 * i);
        }
        let bytes = [(n >> 16) as u8, (n >> 8) as u8, n as u8];
        out.extend_from_slice(&bytes[..chunk.len().saturating_sub(1)]);
    }
    Ok(out)
}

#[derive(Default)]
struct Snapshots {
    prev: HashMap<String, String>,
    cur: HashMap<String, String>,
    /// variablesReference → its path (for the children's paths)
    paths: HashMap<i64, String>,
}

pub struct DapSession {
    client: DapClient,
    caps: SessionCaps,
    data_bps: Mutex<Vec<DataBreakpoint>>,
    breakpoints: Mutex<HashMap<String, Vec<BreakpointSpec>>>,
    functions: Mutex<Vec<String>>,
    configured: AtomicBool,
    thread: Mutex<Option<i64>>,
    frames: Mutex<Vec<DapFrame>>,
    snaps: Mutex<Snapshots>,
    /// the folder the program runs in (relative breakpoint paths are resolved against it)
    cwd: Option<PathBuf>,
    pub adapter: String,
    /// attached to a process that was already running: stopping detaches instead of killing it
    attached: bool,
}

fn stop_from(e: &Value) -> DapStop {
    match e["event"].as_str() {
        Some("exited") => DapStop {
            exited: true,
            exit_code: e["body"]["exitCode"].as_i64().map(|c| c as i32),
            reason: "exited".into(),
            ..Default::default()
        },
        Some("terminated") => DapStop {
            exited: true,
            reason: "terminated".into(),
            ..Default::default()
        },
        _ => DapStop {
            stopped: true,
            reason: e["body"]["reason"]
                .as_str()
                .unwrap_or("stopped")
                .to_string(),
            thread: e["body"]["threadId"].as_i64(),
            description: e["body"]["text"]
                .as_str()
                .or(e["body"]["description"].as_str())
                .map(String::from),
            ..Default::default()
        },
    }
}

const STOP_EVENTS: &[&str] = &["stopped", "exited", "terminated"];
fn is_stop(e: &Value) -> bool {
    STOP_EVENTS.iter().any(|s| e["event"] == *s)
}

impl DapSession {
    /// Starts the adapter and the program (it runs at `run`, after the breakpoints are set).
    pub fn launch(
        program: &str,
        args: &[String],
        cwd: Option<&str>,
        on_output: Option<OnOutput>,
    ) -> Result<DapSession, String> {
        let adapter = find_adapter()
            .ok_or("no DAP adapter on PATH — install lldb-dap (LLVM) for step-debugging")?;
        let name = adapter
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        DapSession::start(
            &[adapter.display().to_string()],
            name,
            cwd,
            on_output,
            "launch",
            json!({"program": program, "args": args, "cwd": cwd.unwrap_or("."), "stopOnEntry": false}),
            false,
        )
    }

    /// Attaches to the running process `pid` through the adapter `argv` (local `lldb-dap`, or one run
    /// inside a container or pod with `docker exec -i` / `kubectl exec -i`). The process keeps running
    /// until a breakpoint (set before `run`) is hit; stopping the session detaches.
    /// `source_map` = (where the program was built, where that source is here) — e.g. (`/app`, the
    /// project folder) for a binary built inside a container.
    pub fn attach(
        argv: &[String],
        pid: u32,
        cwd: Option<&str>,
        on_output: Option<OnOutput>,
        source_map: Option<(String, String)>,
    ) -> Result<DapSession, String> {
        let name = argv.join(" ");
        let mut args = json!({"pid": pid});
        if let Some((from, to)) = source_map {
            args["sourceMap"] = json!([[from, to]]);
        }
        DapSession::start(argv, name, cwd, on_output, "attach", args, true)
    }

    fn start(
        argv: &[String],
        adapter: String,
        cwd: Option<&str>,
        on_output: Option<OnOutput>,
        request: &str,
        args: Value,
        attached: bool,
    ) -> Result<DapSession, String> {
        let client =
            DapClient::spawn_cmd(argv, cwd.filter(|_| !attached).map(Path::new), on_output)?;
        let init = client.request(
            "initialize",
            json!({"clientID": "dxtutor", "clientName": "dxtutor IDE", "adapterID": "lldb-dap", "linesStartAt1": true, "columnsStartAt1": true, "pathFormat": "path", "supportsVariableType": true, "supportsMemoryReferences": true, "supportsRunInTerminalRequest": false}),
        )?;
        let caps = SessionCaps::from_initialize(&init);
        let pending = client.request_later(request, args)?;
        // an attach that fails (ptrace refused, no such pid) answers before any `initialized`
        let first = client.wait_event(|e| e["event"] == "initialized", Some(REQUEST_TIMEOUT));
        if first.is_err()
            || first
                .as_ref()
                .map(|e| e["event"] == "terminated")
                .unwrap_or(false)
        {
            let why = pending
                .recv_timeout(Duration::from_secs(2))
                .ok()
                .and_then(|m| response_body(request, m).err())
                .unwrap_or_else(|| format!("the adapter did not start the {request}"));
            client.kill();
            return Err(why);
        }
        // an attach that fails (no such pid, ptrace refused) can answer after `initialized`: wait a little
        // for its answer before calling the session ready
        let pending = if attached {
            match pending.recv_timeout(Duration::from_secs(3)) {
                Ok(m) => {
                    if let Err(e) = response_body(request, m) {
                        client.kill();
                        return Err(e);
                    }
                    None
                }
                Err(_) => None,
            }
        } else {
            Some(pending)
        };
        let s = DapSession {
            client,
            caps,
            data_bps: Mutex::default(),
            breakpoints: Mutex::default(),
            functions: Mutex::default(),
            configured: AtomicBool::new(false),
            thread: Mutex::new(None),
            frames: Mutex::default(),
            snaps: Mutex::default(),
            cwd: cwd.map(PathBuf::from),
            adapter,
            attached,
        };
        // the launch response may come before or after configurationDone: keep it for `run`
        if let Some(p) = pending {
            std::thread::spawn(move || {
                let _ = p.recv_timeout(Duration::from_secs(120));
            });
        }
        Ok(s)
    }

    /// Replaces the breakpoints of `file` (absolute path) and says which the adapter accepted.
    pub fn set_breakpoints(
        &self,
        file: &str,
        specs: &[BreakpointSpec],
    ) -> Result<Vec<BreakpointState>, String> {
        self.breakpoints
            .lock()
            .map_err(|_| "dap lock")?
            .insert(file.to_string(), specs.to_vec());
        self.send_breakpoints(file, specs)
    }

    /// Sends a file's breakpoints to the adapter without keeping them as the human's.
    fn send_breakpoints(
        &self,
        file: &str,
        specs: &[BreakpointSpec],
    ) -> Result<Vec<BreakpointState>, String> {
        let bps: Vec<Value> = specs
            .iter()
            .map(|b| {
                let mut v = json!({"line": b.line});
                if let Some(c) = b.condition.as_deref().filter(|c| !c.trim().is_empty()) {
                    v["condition"] = json!(c);
                }
                if let Some(h) = b.hit_condition.as_deref().filter(|c| !c.trim().is_empty()) {
                    v["hitCondition"] = json!(h);
                }
                if let Some(m) = b.log_message.as_deref().filter(|c| !c.trim().is_empty()) {
                    v["logMessage"] = json!(m);
                }
                v
            })
            .collect();
        let body = self.client.request("setBreakpoints", json!({"source": {"path": file}, "breakpoints": bps, "lines": specs.iter().map(|b| b.line).collect::<Vec<_>>()}))?;
        Ok(body["breakpoints"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .zip(specs)
            .map(|(r, s)| BreakpointState {
                line: r["line"].as_u64().map(|l| l as u32).unwrap_or(s.line),
                verified: r["verified"].as_bool().unwrap_or(false),
                message: r["message"].as_str().map(String::from),
            })
            .collect())
    }

    /// A path the adapter can match against the debug info: relative ones join the session's folder.
    fn absolute(&self, file: &str) -> String {
        match &self.cwd {
            Some(d) if !Path::new(file).is_absolute() => d.join(file).display().to_string(),
            _ => file.to_string(),
        }
    }

    /// Adds a plain breakpoint on `line` of `file`, keeping the file's others.
    pub fn add_breakpoint(&self, file: &str, line: u32) -> Result<BreakpointState, String> {
        let abs = file.to_string();
        let file = abs.as_str();
        let mut list = self
            .breakpoints
            .lock()
            .map_err(|_| "dap lock")?
            .get(file)
            .cloned()
            .unwrap_or_default();
        if !list.iter().any(|b| b.line == line) {
            list.push(BreakpointSpec {
                line,
                ..Default::default()
            });
        }
        let states = self.set_breakpoints(file, &list)?;
        let i = list.iter().position(|b| b.line == line).unwrap_or(0);
        states
            .get(i)
            .cloned()
            .ok_or_else(|| "the adapter did not answer for that breakpoint".to_string())
    }

    /// Function breakpoints (e.g. `rust_panic` to stop when a Rust program panics).
    pub fn set_function_breakpoints(&self, names: &[String]) -> Result<usize, String> {
        *self.functions.lock().map_err(|_| "dap lock")? = names.to_vec();
        let body = self.client.request(
            "setFunctionBreakpoints",
            json!({"breakpoints": names.iter().map(|n| json!({"name": n})).collect::<Vec<_>>()}),
        )?;
        Ok(body["breakpoints"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter(|b| b["verified"].as_bool().unwrap_or(false))
                    .count()
            })
            .unwrap_or(0))
    }

    fn after_stop(&self, e: &Value) -> Result<DapStop, String> {
        let mut st = stop_from(e);
        if st.stopped {
            *self.thread.lock().map_err(|_| "dap lock")? = st.thread;
            {
                let mut s = self.snaps.lock().map_err(|_| "dap lock")?;
                s.prev = std::mem::take(&mut s.cur);
                s.paths.clear();
            }
            let frames = self.load_frames(st.thread)?;
            if let Some(f) = frames.first() {
                st.func = f.func.clone();
                st.file = f.file.clone();
                st.line = f.line;
            }
        }
        Ok(st)
    }

    fn wait_stop(&self) -> Result<DapStop, String> {
        let e = self.client.wait_event(is_stop, None)?;
        let st = self.after_stop(&e)?;
        if st.exited {
            // drop the `terminated` that follows `exited`
            let _ = self.client.wait_event(
                |e| e["event"] == "terminated",
                Some(Duration::from_millis(300)),
            );
        }
        Ok(st)
    }

    /// Lets the program run (the first time: configuration done) until it stops or ends.
    pub fn run(&self) -> Result<DapStop, String> {
        if !self.configured.swap(true, Ordering::SeqCst) {
            self.client.drain(|e| e["event"] == "stopped");
            self.client.request("configurationDone", json!({}))?;
            return self.wait_stop();
        }
        self.resume("continue")
    }

    fn current_thread(&self) -> Result<i64, String> {
        if let Some(t) = *self.thread.lock().map_err(|_| "dap lock")? {
            return Ok(t);
        }
        Ok(self.threads()?.first().map(|t| t.id).unwrap_or(1))
    }

    fn resume(&self, command: &str) -> Result<DapStop, String> {
        let t = self.current_thread()?;
        // a stop still queued is from before this resume (an adapter can repeat `stopped`, one per
        // thread): reading it as this step's stop would put every later stop one behind
        self.client.drain(|e| e["event"] == "stopped");
        self.client.request(command, json!({"threadId": t}))?;
        self.wait_stop()
    }

    pub fn cont(&self) -> Result<DapStop, String> {
        self.run()
    }
    /// `over` = next, `into` = stepIn, `out` = stepOut.
    pub fn step(&self, kind: &str) -> Result<DapStop, String> {
        match kind {
            "into" => self.resume("stepIn"),
            "out" => self.resume("stepOut"),
            _ => self.resume("next"),
        }
    }
    /// Asks a running program to stop; the call waiting in `run`/`cont` returns the stop.
    pub fn pause(&self) -> Result<(), String> {
        let t = self.current_thread()?;
        self.client
            .request_later("pause", json!({"threadId": t}))
            .map(|_| ())
    }

    pub fn threads(&self) -> Result<Vec<DapThread>, String> {
        let cur = *self.thread.lock().map_err(|_| "dap lock")?;
        let body = self.client.request("threads", json!({}))?;
        Ok(body["threads"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .map(|t| {
                let id = t["id"].as_i64().unwrap_or(0);
                DapThread {
                    id,
                    name: t["name"].as_str().unwrap_or("").to_string(),
                    current: Some(id) == cur,
                }
            })
            .collect())
    }

    fn load_frames(&self, thread: Option<i64>) -> Result<Vec<DapFrame>, String> {
        let t = match thread {
            Some(t) => t,
            None => self.current_thread()?,
        };
        let body = self.client.request(
            "stackTrace",
            json!({"threadId": t, "startFrame": 0, "levels": 40}),
        )?;
        let frames: Vec<DapFrame> = body["stackFrames"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .enumerate()
            .map(|(i, f)| DapFrame {
                level: i as u32,
                id: f["id"].as_i64().unwrap_or(0),
                func: f["name"].as_str().unwrap_or("").to_string(),
                file: f["source"]["path"].as_str().unwrap_or("").to_string(),
                line: f["line"].as_u64().unwrap_or(0) as u32,
            })
            .collect();
        *self.frames.lock().map_err(|_| "dap lock")? = frames.clone();
        Ok(frames)
    }

    /// The stack of a thread (the stopped one by default).
    pub fn stack(&self, thread: Option<i64>) -> Result<Vec<DapFrame>, String> {
        if let Some(t) = thread {
            if Some(t) != *self.thread.lock().map_err(|_| "dap lock")? {
                *self.thread.lock().map_err(|_| "dap lock")? = Some(t);
                return self.load_frames(Some(t));
            }
        }
        let f = self.frames.lock().map_err(|_| "dap lock")?.clone();
        if f.is_empty() {
            self.load_frames(thread)
        } else {
            Ok(f)
        }
    }

    fn frame_at(&self, level: u32) -> Result<DapFrame, String> {
        self.frames
            .lock()
            .map_err(|_| "dap lock")?
            .get(level as usize)
            .cloned()
            .ok_or_else(|| "no such frame (is the program stopped?)".to_string())
    }

    fn node(&self, snaps: &mut Snapshots, parent: &str, v: &Value) -> VarNode {
        let name = v["name"].as_str().unwrap_or("").to_string();
        let value = v["value"]
            .as_str()
            .or(v["result"].as_str())
            .unwrap_or("")
            .to_string();
        let reference = v["variablesReference"].as_i64().unwrap_or(0);
        let memory_reference = v["memoryReference"].as_str().map(String::from);
        let path = if parent.is_empty() {
            name.clone()
        } else {
            format!("{parent}.{name}")
        };
        let changed = snaps.prev.get(&path).map(|p| *p != value).unwrap_or(false);
        snaps.cur.insert(path.clone(), value.clone());
        if reference > 0 {
            snaps.paths.insert(reference, path.clone());
        }
        VarNode {
            name,
            value,
            ty: v["type"].as_str().unwrap_or("").to_string(),
            reference,
            changed,
            path,
            memory_reference,
        }
    }

    /// The scopes of a frame (`reference` = None) or the children of a variable/scope.
    pub fn variables(&self, level: u32, reference: Option<i64>) -> Result<Vec<VarNode>, String> {
        match reference {
            None => {
                let f = self.frame_at(level)?;
                let body = self.client.request("scopes", json!({"frameId": f.id}))?;
                let mut s = self.snaps.lock().map_err(|_| "dap lock")?;
                let base = f.func.clone();
                Ok(body["scopes"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(|sc| {
                        let mut v = sc.clone();
                        v["value"] = json!("");
                        self.node(&mut s, &base, &v)
                    })
                    .collect())
            }
            Some(r) => {
                let body = self
                    .client
                    .request("variables", json!({"variablesReference": r}))?;
                let mut s = self.snaps.lock().map_err(|_| "dap lock")?;
                let parent = s.paths.get(&r).cloned().unwrap_or_default();
                Ok(body["variables"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
                    .iter()
                    .map(|v| self.node(&mut s, &parent, v))
                    .collect())
            }
        }
    }

    /// The locals of a frame, flat (the gdb driver's `locals`).
    pub fn locals(&self, level: u32) -> Result<Vec<VarNode>, String> {
        let scopes = self.variables(level, None)?;
        let first = scopes
            .iter()
            .find(|s| s.name.to_lowercase().contains("local"))
            .or(scopes.first())
            .cloned();
        match first {
            Some(s) if s.reference > 0 => self.variables(level, Some(s.reference)),
            _ => Ok(vec![]),
        }
    }

    /// A watch expression in a frame; `context` is `watch` (default), `repl` (the debug console)
    /// or `hover`. The adapter may run code to answer (lldb calls functions): the UI says so.
    pub fn evaluate(&self, expression: &str, level: u32) -> Result<VarNode, String> {
        self.evaluate_in(expression, level, "watch")
    }

    pub fn evaluate_in(
        &self,
        expression: &str,
        level: u32,
        context: &str,
    ) -> Result<VarNode, String> {
        let context = match context {
            "repl" | "hover" => context,
            _ => "watch",
        };
        let f = self.frame_at(level)?;
        let body = self.client.request(
            "evaluate",
            json!({"expression": expression, "frameId": f.id, "context": context}),
        )?;
        let mut s = self.snaps.lock().map_err(|_| "dap lock")?;
        let mut v = body.clone();
        v["name"] = json!(expression);
        Ok(self.node(&mut s, &format!("watch:{}", f.func), &v))
    }

    /// What this adapter can do (its `initialize` answer).
    pub fn caps(&self) -> SessionCaps {
        self.caps.clone()
    }

    /// Run to `line` of `file`: a temporary breakpoint there (the file's own stay), continue, and
    /// take the temporary one away again wherever the program stops.
    /// `file` is given as the breakpoints are (`set_breakpoints`): the same key finds the file's own
    /// breakpoints, and the adapter resolves it the same way (not joined to the session's folder: a
    /// test runs in its package's folder, not the project's).
    pub fn run_to(&self, file: &str, line: u32) -> Result<DapStop, String> {
        let abs = file.to_string();
        let mine = self
            .breakpoints
            .lock()
            .map_err(|_| "dap lock")?
            .get(&abs)
            .cloned()
            .unwrap_or_default();
        let temp = !mine.iter().any(|b| {
            b.line == line
                && b.condition.is_none()
                && b.log_message.is_none()
                && b.hit_condition.is_none()
        });
        if temp {
            let mut with = mine.clone();
            with.retain(|b| b.line != line);
            with.push(BreakpointSpec {
                line,
                ..Default::default()
            });
            let states = self.send_breakpoints(&abs, &with)?;
            let ok = states.iter().any(|s| s.line == line && s.verified);
            if !ok {
                let _ = self.send_breakpoints(&abs, &mine);
                return Err(format!("line {line} has no code to stop at"));
            }
        }
        let st = self.cont();
        if temp {
            let _ = self.send_breakpoints(&abs, &mine);
        }
        st
    }

    /// Restart the frame at `level` (only adapters that support it).
    pub fn restart_frame(&self, level: u32) -> Result<DapStop, String> {
        if !self.caps.restart_frame {
            return Err(format!("{} cannot restart a frame", self.adapter));
        }
        let f = self.frame_at(level)?;
        self.client.drain(|e| e["event"] == "stopped");
        self.client
            .request("restartFrame", json!({"frameId": f.id}))?;
        self.wait_stop()
    }

    /// Adds a data breakpoint (`add`) and/or removes one by its id (`remove`); returns the list.
    pub fn data_breakpoints(
        &self,
        add: Option<DataTarget>,
        remove: Option<&str>,
    ) -> Result<Vec<DataBreakpoint>, String> {
        if !self.caps.data_breakpoints {
            return Err(format!("{} has no data breakpoints", self.adapter));
        }
        let mut list = self.data_bps.lock().map_err(|_| "dap lock")?.clone();
        if let Some(id) = remove {
            list.retain(|d| d.data_id != id);
        }
        if let Some(t) = add {
            let mut args = json!({"name": t.name});
            match t.reference.filter(|r| *r > 0) {
                Some(r) => args["variablesReference"] = json!(r),
                None => args["frameId"] = json!(self.frame_at(t.frame)?.id),
            }
            let info = self.client.request("dataBreakpointInfo", args)?;
            let Some(data_id) = info["dataId"].as_str().map(String::from) else {
                return Err(info["description"]
                    .as_str()
                    .unwrap_or("the adapter cannot watch that")
                    .to_string());
            };
            let offered: Vec<String> = info["accessTypes"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            let want = t.access_type.unwrap_or_else(|| "write".into());
            let access = if offered.is_empty() || offered.contains(&want) {
                want
            } else {
                offered[0].clone()
            };
            if !list.iter().any(|d| d.data_id == data_id) {
                list.push(DataBreakpoint {
                    data_id,
                    description: info["description"].as_str().unwrap_or(&t.name).to_string(),
                    access_type: access,
                    verified: false,
                    message: None,
                });
            }
        }
        let body = self.client.request(
            "setDataBreakpoints",
            json!({"breakpoints": list.iter().map(|d| json!({"dataId": d.data_id, "accessType": d.access_type})).collect::<Vec<_>>()}),
        )?;
        let states = body["breakpoints"].as_array().cloned().unwrap_or_default();
        for (d, r) in list.iter_mut().zip(states.iter()) {
            d.verified = r["verified"].as_bool().unwrap_or(false);
            d.message = r["message"].as_str().map(String::from);
        }
        *self.data_bps.lock().map_err(|_| "dap lock")? = list.clone();
        Ok(list)
    }

    /// Reads `count` bytes at `memory_reference` + `offset` (adapters with `readMemory`).
    pub fn read_memory(
        &self,
        memory_reference: &str,
        offset: i64,
        count: u32,
    ) -> Result<MemoryBlock, String> {
        if !self.caps.read_memory {
            return Err(format!("{} cannot read memory", self.adapter));
        }
        let body = self.client.request(
            "readMemory",
            json!({"memoryReference": memory_reference, "offset": offset, "count": count.min(4096)}),
        )?;
        Ok(MemoryBlock {
            address: body["address"]
                .as_str()
                .unwrap_or(memory_reference)
                .to_string(),
            bytes: base64_decode(body["data"].as_str().unwrap_or(""))?,
            unreadable: body["unreadableBytes"].as_u64().unwrap_or(0),
        })
    }

    /// The exception filters on (`setExceptionBreakpoints`): only ids the adapter offered.
    pub fn set_exception_filters(&self, filters: &[String]) -> Result<Vec<String>, String> {
        let known: Vec<String> = filters
            .iter()
            .filter(|f| self.caps.exception_filters.iter().any(|x| &x.filter == *f))
            .cloned()
            .collect();
        self.client
            .request("setExceptionBreakpoints", json!({"filters": known}))?;
        Ok(known)
    }

    pub fn stop(&self) {
        let _ = self
            .client
            .request_later("disconnect", json!({"terminateDebuggee": !self.attached}));
        std::thread::sleep(Duration::from_millis(100));
        self.client.kill();
    }
}

impl Drop for DapSession {
    fn drop(&mut self) {
        self.client.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_and_reads_messages() {
        let v = json!({"seq": 1, "type": "event", "event": "stopped", "body": {"reason": "breakpoint", "threadId": 7}});
        let bytes = frame(&v);
        assert!(String::from_utf8_lossy(&bytes).starts_with("Content-Length: "));
        let mut r = std::io::Cursor::new([bytes.clone(), bytes].concat());
        assert_eq!(read_message(&mut r), Some(v.clone()));
        assert_eq!(read_message(&mut r), Some(v.clone()));
        assert_eq!(read_message(&mut r), None);
        let st = stop_from(&v);
        assert!(st.stopped && st.thread == Some(7) && st.reason == "breakpoint");
        assert!(
            stop_from(&json!({"event": "exited", "body": {"exitCode": 3}})).exit_code == Some(3)
        );
    }

    #[test]
    fn decodes_base64_and_reads_caps() {
        assert_eq!(base64_decode("AQID/w==").unwrap(), vec![1, 2, 3, 255]);
        assert_eq!(base64_decode("aGk=").unwrap(), b"hi".to_vec());
        assert!(base64_decode("@@").is_err());
        let c = SessionCaps::from_initialize(
            &json!({"supportsDataBreakpoints": true, "exceptionBreakpointFilters": [{"filter": "cpp_throw", "label": "C++ Throw"}]}),
        );
        assert!(c.data_breakpoints && !c.step_back && !c.restart_frame && !c.read_memory);
        assert_eq!(c.exception_filters[0].filter, "cpp_throw");
    }

    /// r23 F2: what the adapter says it can do, the console (repl), run to a line, a data
    /// breakpoint that stops on the write, the bytes of a variable, and the exception filters.
    #[test]
    fn real_session_extras_with_lldb_dap() {
        if find_adapter().is_none() || Command::new("cc").arg("--version").output().is_err() {
            eprintln!("skipped: no lldb-dap or cc on PATH");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("t.c");
        std::fs::write(
            &src,
            "#include <stdio.h>\nint main(void) {\n  int total = 0;\n  int seen = 0;\n  for (int i = 0; i < 5; i++) {\n    total += i;\n  }\n  seen = total + 1;\n  printf(\"%d %d\\n\", total, seen);\n  return 0;\n}\n",
        )
        .unwrap();
        let bin = d.path().join("t");
        assert!(Command::new("cc")
            .args(["-g", "-O0", "-o"])
            .arg(&bin)
            .arg(&src)
            .status()
            .unwrap()
            .success());
        // the program runs in another folder than its source (a test runs in its package's folder)
        let run_dir = d.path().join("run");
        std::fs::create_dir(&run_dir).unwrap();
        let s = DapSession::launch(
            bin.to_str().unwrap(),
            &[],
            Some(run_dir.to_str().unwrap()),
            None,
        )
        .unwrap();
        let caps = s.caps();
        assert!(caps.data_breakpoints && caps.read_memory, "{caps:?}");
        let file = src.to_str().unwrap();
        s.set_breakpoints(
            file,
            &[BreakpointSpec {
                line: 3,
                ..Default::default()
            }],
        )
        .unwrap();
        let st = s.run().unwrap();
        assert_eq!(st.line, 3, "{st:?}");
        // the console evaluates in the frame
        // (lldb-dap answers the console in lldb's own format: `(int) $0 = 3`)
        assert!(s
            .evaluate_in("1 + 2", 0, "repl")
            .unwrap()
            .value
            .ends_with("= 3"));
        // run to line 8: stops there, and the temporary breakpoint is gone afterwards
        // the path as the UI sends breakpoints, not joined to the run folder
        let at = s.run_to("t.c", 8).unwrap();
        assert_eq!(at.line, 8, "{at:?}");
        assert_eq!(
            s.locals(0)
                .unwrap()
                .iter()
                .find(|v| v.name == "total")
                .unwrap()
                .value,
            "10"
        );
        // a line without code is refused
        assert!(s.run_to(file, 1).is_err());
        // a data breakpoint on `seen`: the next continue stops on its write
        let locals_scope = s
            .variables(0, None)
            .unwrap()
            .into_iter()
            .find(|x| x.name.to_lowercase().contains("local"))
            .unwrap();
        let seen = s
            .locals(0)
            .unwrap()
            .into_iter()
            .find(|v| v.name == "seen")
            .unwrap();
        let list = s
            .data_breakpoints(
                Some(DataTarget {
                    frame: 0,
                    reference: Some(locals_scope.reference),
                    name: "seen".into(),
                    access_type: None,
                }),
                None,
            )
            .unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].verified, "{list:?}");
        // the bytes of `seen` (an int, 0 before the write)
        if let Some(m) = seen.memory_reference.as_deref() {
            let mem = s.read_memory(m, 0, 4).unwrap();
            assert_eq!(mem.bytes, vec![0, 0, 0, 0], "{mem:?}");
        }
        let hit = s.cont().unwrap();
        assert!(hit.stopped, "{hit:?}");
        // lldb-dap reports a watchpoint as reason `breakpoint`, description `watchpoint N`, on the
        // line after the write
        assert!(
            hit.description
                .as_deref()
                .unwrap_or("")
                .contains("watchpoint"),
            "{hit:?}"
        );
        assert_eq!(hit.line, 9);
        let cleared = s.data_breakpoints(None, Some(&list[0].data_id)).unwrap();
        assert!(cleared.is_empty());
        // exception filters: only the ones the adapter offers are sent
        let on = s
            .set_exception_filters(&["cpp_throw".into(), "nope".into()])
            .unwrap();
        assert_eq!(on, vec!["cpp_throw".to_string()]);
        let end = s.cont().unwrap();
        assert!(end.exited, "{end:?}");
        s.stop();
    }

    /// A real session against lldb-dap: compiles a small C program with `-g`, stops at a
    /// breakpoint, reads and expands variables, sees what changed after a step, evaluates a
    /// watch, honours a condition and a logpoint, and runs to the end with its exit code.
    #[test]
    fn real_session_with_lldb_dap() {
        if find_adapter().is_none() || Command::new("cc").arg("--version").output().is_err() {
            eprintln!("skipped: no lldb-dap or cc on PATH");
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("t.c");
        std::fs::write(
            &src,
            "#include <stdio.h>\nstruct P { int x; int y; };\nint add(int a, int b) {\n  int s = a + b;\n  return s;\n}\nint main(void) {\n  struct P p = {1, 2};\n  int total = 0;\n  for (int i = 0; i < 5; i++) {\n    total = add(total, i);\n  }\n  p.x = total;\n  printf(\"total=%d\\n\", total);\n  return total == 10 ? 7 : 1;\n}\n",
        )
        .unwrap();
        let bin = d.path().join("t");
        assert!(Command::new("cc")
            .args(["-g", "-O0", "-o"])
            .arg(&bin)
            .arg(&src)
            .status()
            .unwrap()
            .success());
        let out: Arc<Mutex<String>> = Arc::default();
        let sink = out.clone();
        let s = DapSession::launch(
            bin.to_str().unwrap(),
            &[],
            Some(d.path().to_str().unwrap()),
            Some(Arc::new(move |_c: &str, t: &str| {
                sink.lock().unwrap().push_str(t)
            })),
        )
        .unwrap();
        let file = src.to_str().unwrap();
        // line 11 (total = add(...)) only when i == 3; a logpoint on line 4
        let bps = s
            .set_breakpoints(
                file,
                &[
                    BreakpointSpec {
                        line: 11,
                        condition: Some("i == 3".into()),
                        ..Default::default()
                    },
                    BreakpointSpec {
                        line: 4,
                        log_message: Some("adding {a}+{b}".into()),
                        ..Default::default()
                    },
                ],
            )
            .unwrap();
        assert_eq!(bps.len(), 2);
        let st = s.run().unwrap();
        assert!(st.stopped, "{st:?}");
        assert_eq!(st.line, 11);
        assert_eq!(st.func, "main");
        let locals = s.locals(0).unwrap();
        let get = |v: &[VarNode], n: &str| {
            v.iter()
                .find(|x| x.name == n)
                .cloned()
                .unwrap_or_else(|| panic!("no {n} in {v:?}"))
        };
        assert_eq!(get(&locals, "i").value, "3");
        assert_eq!(get(&locals, "total").value, "3");
        let p = get(&locals, "p");
        assert!(p.reference > 0);
        let kids = s.variables(0, Some(p.reference)).unwrap();
        assert_eq!(get(&kids, "y").value, "2");
        assert_eq!(s.evaluate("total * 2", 0).unwrap().value, "6");
        assert!(!s.threads().unwrap().is_empty());
        // step over the call: total changes and is flagged
        let st2 = s.step("over").unwrap();
        assert!(st2.stopped);
        let after = s.locals(0).unwrap();
        let total = get(&after, "total");
        assert_eq!(total.value, "6");
        assert!(total.changed);
        assert!(!get(&after, "p").changed);
        // remove the breakpoints and run to the end
        s.set_breakpoints(file, &[]).unwrap();
        let end = s.cont().unwrap();
        assert!(end.exited, "{end:?}");
        assert_eq!(end.exit_code, Some(7));
        let printed = out.lock().unwrap().clone();
        assert!(printed.contains("adding 0+0"), "logpoint output: {printed}");
        s.stop();
    }
}
