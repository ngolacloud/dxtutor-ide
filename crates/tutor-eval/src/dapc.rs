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
        let mut cmd = Command::new(adapter);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(d) = cwd {
            cmd.current_dir(d);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start {}: {e}", adapter.display()))?;
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
    breakpoints: Mutex<HashMap<String, Vec<BreakpointSpec>>>,
    functions: Mutex<Vec<String>>,
    configured: AtomicBool,
    thread: Mutex<Option<i64>>,
    frames: Mutex<Vec<DapFrame>>,
    snaps: Mutex<Snapshots>,
    /// the folder the program runs in (relative breakpoint paths are resolved against it)
    cwd: Option<PathBuf>,
    pub adapter: String,
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
        let client = DapClient::spawn(&adapter, cwd.map(Path::new), on_output)?;
        client.request(
            "initialize",
            json!({"clientID": "dxtutor", "clientName": "dxtutor IDE", "adapterID": "lldb-dap", "linesStartAt1": true, "columnsStartAt1": true, "pathFormat": "path", "supportsVariableType": true, "supportsRunInTerminalRequest": false}),
        )?;
        let launch = client.request_later("launch", json!({"program": program, "args": args, "cwd": cwd.unwrap_or("."), "stopOnEntry": false}))?;
        client.wait_event(|e| e["event"] == "initialized", Some(REQUEST_TIMEOUT))?;
        let s = DapSession {
            client,
            breakpoints: Mutex::default(),
            functions: Mutex::default(),
            configured: AtomicBool::new(false),
            thread: Mutex::new(None),
            frames: Mutex::default(),
            snaps: Mutex::default(),
            cwd: cwd.map(PathBuf::from),
            adapter: adapter
                .file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_default(),
        };
        // the launch response may come before or after configurationDone: keep it for `run`
        std::thread::spawn(move || {
            let _ = launch.recv_timeout(Duration::from_secs(120));
        });
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
        let abs = self.absolute(file);
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

    /// A watch expression in a frame.
    pub fn evaluate(&self, expression: &str, level: u32) -> Result<VarNode, String> {
        let f = self.frame_at(level)?;
        let body = self.client.request(
            "evaluate",
            json!({"expression": expression, "frameId": f.id, "context": "watch"}),
        )?;
        let mut s = self.snaps.lock().map_err(|_| "dap lock")?;
        let mut v = body.clone();
        v["name"] = json!(expression);
        Ok(self.node(&mut s, &format!("watch:{}", f.func), &v))
    }

    pub fn stop(&self) {
        let _ = self
            .client
            .request_later("disconnect", json!({"terminateDebuggee": true}));
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
