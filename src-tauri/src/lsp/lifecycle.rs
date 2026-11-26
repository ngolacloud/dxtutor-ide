// LSP P6 — o que os servidores de linguagem custam à máquina, e como acabam.
//
// * Um servidor acaba como o protocolo pede: `shutdown` (só depois do `initialize`), `exit`, o
//   stdin fechado; se não sair a tempo, é morto com o que arrancou (o seu grupo de processos). O
//   processo é sempre recolhido (`wait`): nada de zombies. Assim ao fechar/trocar de pasta, ao
//   sair da app, nos reinícios do P2 (um `lsp.json` mudou) e nos botões «Restart»/«Stop».
// * Um servidor que morre sozinho sai do mapa e é recolhido pela thread que lia o stdout dele; o
//   pedido seguinte arranca outro.
// * Inactivo: sem documentos abertos e sem uso durante `idleMinutes` (10 por omissão), pára. O
//   pedido seguinte arranca-o de novo, pelo mesmo `get_or_start`: só é entregue depois do
//   `initialize` (a corrida do GOTCHA-arranque não volta). A decisão e a entrega acontecem com o
//   lock do mapa: ou o reaper o tirou antes (e não é encontrado), ou vê-o em uso.
// * Tecto: no máximo `maxServers` (6) ao mesmo tempo; ao passar, pára o menos usado recentemente
//   SEM documentos abertos. Um com documentos abertos nunca é parado: diz-se (`lsp://limit`).
// * O stderr de cada servidor (e o `window/logMessage` de erro/aviso/info) fica num anel limitado,
//   mascarado (`tutor_protect`), com os eventos do ciclo de vida; vai para a UI (`lsp://log`, o canal
//   «Language servers» do Output) e lê-se de novo com `lsp_server_log` (a UI recarrega ao mudar de
//   língua).

use std::collections::VecDeque;
use std::io::Read;
use std::process::ChildStderr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread::JoinHandle;

use super::*;

/// Where a session's events go (the app's `emit`, or a recorder in the tests).
pub(super) type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;

/// The app's events.
pub(super) fn emitter(app: &AppHandle) -> Emit {
    let app = app.clone();
    Arc::new(move |event: &str, payload: Value| {
        let _ = app.emit(event, payload);
    })
}

/// How long a server has to answer `shutdown`.
pub(super) const SHUTDOWN_WAIT: Duration = Duration::from_secs(2);
/// How long it has to exit after `exit` (then it is killed).
pub(super) const EXIT_WAIT: Duration = Duration::from_secs(1);
/// How often idle servers are looked for.
const REAP_EVERY: Duration = Duration::from_secs(30);

/// Why a server stops (the log says it; the UI translates the code).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Reason {
    /// no open document for the idle time
    Idle,
    /// the cap: the least recently used one with no open document
    Limit,
    /// «Stop» in the list of servers
    User,
    /// «Restart» in the list of servers
    Restart,
    /// its folder was closed (or another one opened)
    Folder,
    /// an override file changed how it starts, or removed it
    Config,
    /// the app is closing
    AppExit,
    /// another thread started the same session first
    Replaced,
    /// it never answered `initialize`
    Failed,
}

impl Reason {
    pub(super) fn code(self) -> &'static str {
        match self {
            Reason::Idle => "idle",
            Reason::Limit => "limit",
            Reason::User => "user",
            Reason::Restart => "restart",
            Reason::Folder => "folder",
            Reason::Config => "config",
            Reason::AppExit => "app-exit",
            Reason::Replaced => "replaced",
            Reason::Failed => "failed",
        }
    }
    fn text(self) -> &'static str {
        match self {
            Reason::Idle => "no open file for the idle time",
            Reason::Limit => "too many language servers running",
            Reason::User => "stopped from the list of servers",
            Reason::Restart => "restarting",
            Reason::Folder => "its folder was closed",
            Reason::Config => "its configuration changed",
            Reason::AppExit => "dxtutor is closing",
            Reason::Replaced => "another start won",
            Reason::Failed => "it did not answer initialize",
        }
    }
}

/// The idle time (`None`: never stop an idle server) and the cap, from the user's `lsp.json`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Limits {
    pub idle: Option<Duration>,
    pub max: usize,
}

impl Limits {
    pub(super) fn of(r: &lspconf::Resources) -> Limits {
        Limits {
            idle: (r.idle_minutes > 0).then(|| Duration::from_secs(r.idle_minutes * 60)),
            max: r.max_servers.max(1),
        }
    }
    /// What the user's file says now.
    pub(super) fn current() -> Limits {
        Limits::of(&effective(None).resources)
    }
}

// ── the log ─────────────────────────────────────────────────────────────────────────────────────

/// Lines kept per server (the oldest go first).
pub(super) const LOG_LINES: usize = 500;
/// A longer line is cut (a stack trace on one line, a JSON dump).
pub(super) const LOG_LINE_CHARS: usize = 2000;
/// At most this much text per server (whichever of the two limits comes first).
pub(super) const LOG_BYTES: usize = 256 * 1024;
/// Logs kept (live servers and the last ones that stopped, so a crash can still be read).
const LOG_KEPT: usize = 48;

/// One line of a server's log.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// increasing over every log: the UI joins what it read with what it hears by this
    pub seq: u64,
    /// milliseconds since the epoch
    pub at: i64,
    pub key: String,
    /// the server's label (`rust-analyzer`)
    pub server: String,
    pub root: String,
    /// `stderr`, `log` (`window/logMessage`) or `event` (started, stopped, …: see `code`)
    pub kind: &'static str,
    /// masked; in English for an event (the UI words it from `code` and `detail`)
    pub text: String,
    pub code: Option<&'static str>,
    pub detail: Value,
}

struct Ring {
    lines: VecDeque<LogLine>,
    /// the text the lines hold
    bytes: usize,
    touched: Instant,
}

fn rings() -> &'static Mutex<HashMap<String, Ring>> {
    static R: OnceLock<Mutex<HashMap<String, Ring>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

static SEQ: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Who writes to a log (cloned out of the session, so a reader thread needs no lock).
#[derive(Clone)]
pub(super) struct Source {
    key: String,
    server: String,
    root: String,
    emit: Emit,
}

impl Source {
    fn of(session: &Arc<Mutex<Session>>) -> Option<Source> {
        let g = session.lock().ok()?;
        Some(Source {
            key: g.key.clone(),
            server: g.label.clone(),
            root: g.root.clone(),
            emit: g.emit.clone(),
        })
    }

    /// Keep these lines in the server's log and send them to the UI (`lsp://log`).
    fn write(
        &self,
        kind: &'static str,
        texts: Vec<String>,
        code: Option<&'static str>,
        detail: Value,
    ) {
        if texts.is_empty() {
            return;
        }
        let at = now_ms();
        let lines: Vec<LogLine> = texts
            .into_iter()
            .map(|t| LogLine {
                seq: SEQ.fetch_add(1, Ordering::Relaxed) + 1,
                at,
                key: self.key.clone(),
                server: self.server.clone(),
                root: self.root.clone(),
                kind,
                text: clip(&t),
                code,
                detail: detail.clone(),
            })
            .collect();
        {
            let mut r = rings().lock().unwrap();
            let ring = r.entry(self.key.clone()).or_insert_with(|| Ring {
                lines: VecDeque::new(),
                bytes: 0,
                touched: Instant::now(),
            });
            ring.touched = Instant::now();
            for l in &lines {
                ring.bytes += l.text.len();
                ring.lines.push_back(l.clone());
            }
            while ring.lines.len() > LOG_LINES || ring.bytes > LOG_BYTES {
                match ring.lines.pop_front() {
                    Some(old) => ring.bytes -= old.text.len(),
                    None => break,
                }
            }
            while r.len() > LOG_KEPT {
                let oldest = r
                    .iter()
                    .min_by_key(|(_, x)| x.touched)
                    .map(|(k, _)| k.clone());
                match oldest {
                    Some(k) => r.remove(&k),
                    None => break,
                };
            }
        }
        (self.emit)("lsp://log", json!({ "lines": lines }));
    }

    fn event(&self, code: &'static str, text: String, detail: Value) {
        self.write("event", vec![text], Some(code), detail);
    }
}

/// A line cut to [`LOG_LINE_CHARS`] (on a character boundary).
fn clip(s: &str) -> String {
    match s.char_indices().nth(LOG_LINE_CHARS) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// The log of one server (`Some(key)`) or of all of them, oldest first.
pub(super) fn log_of(key: Option<&str>) -> Vec<LogLine> {
    let r = rings().lock().unwrap();
    let mut out: Vec<LogLine> = r
        .iter()
        .filter(|(k, _)| key.is_none_or(|want| want == k.as_str()))
        .flat_map(|(_, ring)| ring.lines.iter().cloned())
        .collect();
    out.sort_by_key(|l| l.seq);
    out
}

/// The valid UTF-8 at the front of `carry`, taken out of it; an unfinished character at the end
/// waits for the next read, an invalid byte becomes `�`.
fn take_utf8(carry: &mut Vec<u8>) -> String {
    let mut out = String::new();
    loop {
        match std::str::from_utf8(carry) {
            Ok(s) => {
                out.push_str(s);
                carry.clear();
                return out;
            }
            Err(e) => {
                let ok = e.valid_up_to();
                out.push_str(std::str::from_utf8(&carry[..ok]).unwrap_or_default());
                match e.error_len() {
                    None => {
                        carry.drain(..ok);
                        return out; // the end of a character comes in the next read
                    }
                    Some(n) => {
                        out.push('\u{FFFD}');
                        carry.drain(..ok + n);
                    }
                }
            }
        }
    }
}

/// The lines of a stream, masked as they come: whole lines are returned, an unfinished one waits
/// (cut at [`LOG_LINE_CHARS`]).
#[derive(Default)]
pub(super) struct Lines {
    carry: Vec<u8>,
    partial: String,
    masker: tutor_protect::stream::Masker,
}

impl Lines {
    pub(super) fn new() -> Lines {
        Lines {
            masker: tutor_protect::stream::Masker::holding(),
            ..Lines::default()
        }
    }

    pub(super) fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        self.carry.extend_from_slice(bytes);
        let text = take_utf8(&mut self.carry);
        let masked = self.masker.push(&text);
        self.split(masked)
    }

    /// What is left (the stream ended).
    pub(super) fn finish(&mut self) -> Vec<String> {
        let rest = String::from_utf8_lossy(&std::mem::take(&mut self.carry)).to_string();
        let mut masked = self.masker.push(&rest);
        masked.push_str(&self.masker.flush());
        let mut out = self.split(masked);
        let last = std::mem::take(&mut self.partial);
        if !last.trim().is_empty() {
            out.push(last);
        }
        out
    }

    fn split(&mut self, masked: String) -> Vec<String> {
        self.partial.push_str(&masked);
        let mut out = Vec::new();
        while let Some(i) = self.partial.find('\n') {
            let line: String = self.partial.drain(..=i).collect();
            out.push(line.trim_end_matches(['\n', '\r']).to_string());
        }
        if self.partial.chars().count() > LOG_LINE_CHARS {
            out.push(std::mem::take(&mut self.partial));
        }
        out
    }
}

/// Read a server's stderr into its log, on a thread of its own, until the server ends.
pub(super) fn read_stderr(session: &Arc<Mutex<Session>>, mut err: ChildStderr) {
    let Some(src) = Source::of(session) else {
        return;
    };
    thread::spawn(move || {
        let mut lines = Lines::new();
        let mut buf = [0u8; 8192];
        loop {
            match err.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => src.write("stderr", lines.push(&buf[..n]), None, Value::Null),
            }
        }
        src.write("stderr", lines.finish(), None, Value::Null);
    });
}

/// A `window/logMessage`: errors, warnings and info go to the log (type 4, «log», is the server's
/// chatter and stays out).
pub(super) fn log_message(session: &Arc<Mutex<Session>>, params: &Value) {
    let level = params["type"].as_u64().unwrap_or(4);
    if level > 3 {
        return;
    }
    let Some(src) = Source::of(session) else {
        return;
    };
    let tag = ["", "error", "warning", "info"][level as usize];
    let text = tutor_protect::redact::current().mask(params["message"].as_str().unwrap_or(""));
    let lines = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| format!("[{tag}] {l}"))
        .collect();
    src.write("log", lines, None, Value::Null);
}

// ── start and end ───────────────────────────────────────────────────────────────────────────────

/// A server started: its log says so.
pub(super) fn started(session: &Arc<Mutex<Session>>) {
    let Some(src) = Source::of(session) else {
        return;
    };
    let pid = session.lock().ok().and_then(|g| g.pid);
    src.event(
        "started",
        format!("started (pid {})", pid.unwrap_or(0)),
        json!({ "pid": pid }),
    );
}

/// Take a session out of the map (if it is still the one under `key`).
pub(super) fn detach(map: &SessionMap, key: &str, s: &Arc<Mutex<Session>>) {
    if let Ok(mut m) = map.lock() {
        if m.get(key).is_some_and(|x| Arc::ptr_eq(x, s)) {
            m.remove(key);
        }
    }
}

/// How a server ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Ended {
    /// it exited (with this code, if it has one)
    Exited(Option<i32>),
    /// it did not exit in time and was killed
    Killed,
}

/// Has the process exited? It is NOT reaped: while it is a zombie its pid (and process group id)
/// cannot be reused, so killing what is left of the group stays safe.
#[cfg(target_os = "linux")]
fn has_exited(pid: u32) -> bool {
    // SAFETY: `waitid` writes only into `info`, which lives on this stack frame.
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    let r = unsafe {
        libc::waitid(
            libc::P_PID,
            pid as libc::id_t,
            &mut info,
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    };
    // -1: not our child any more (reaped); 0 with no pid: still running
    r != 0 || unsafe { info.si_pid() } != 0
}

/// Kill a process group (the server and whatever it started).
#[cfg(unix)]
fn kill_group(pid: u32) {
    // SAFETY: a plain syscall; a negative pid names the process group the server leads.
    unsafe {
        libc::kill(-(pid as libc::pid_t), libc::SIGKILL);
    }
}

/// Wait up to `wait` for the process to exit; then kill what is left of its process group (all of
/// it when it did not exit) and reap it.
pub(super) fn reap(child: &mut Child, wait: Duration) -> Ended {
    let deadline = Instant::now() + wait;
    let pid = child.id();
    let exited = loop {
        #[cfg(target_os = "linux")]
        if has_exited(pid) {
            break true;
        }
        #[cfg(not(target_os = "linux"))]
        if let Ok(Some(st)) = child.try_wait() {
            return Ended::Exited(st.code());
        }
        if Instant::now() >= deadline {
            break false;
        }
        thread::sleep(Duration::from_millis(20));
    };
    #[cfg(unix)]
    kill_group(pid);
    if !exited {
        let _ = child.kill();
    }
    let code = child.wait().ok().and_then(|s| s.code());
    if exited {
        Ended::Exited(code)
    } else {
        Ended::Killed
    }
}

/// Shut a session's server down the way the protocol asks — `shutdown` (only after `initialize`),
/// then `exit` and its stdin closed — and reap it; killed with what it started when it does not
/// exit in time. Requests in flight fail at once; nothing new is sent to it. Blocking (at most
/// [`SHUTDOWN_WAIT`] + [`EXIT_WAIT`] and a little). Only the first call does anything.
pub(super) fn shutdown(session: &Arc<Mutex<Session>>, reason: Reason) {
    let (child, handshaken) = {
        let Ok(mut g) = session.lock() else {
            return;
        };
        if g.stopping {
            return;
        }
        g.stopping = true;
        g.pending.clear();
        g.initialized = true; // nobody waits for an `initialize` that will not come
        (g.child.take(), g.handshaken)
    };
    let src = Source::of(session);
    let Some(mut child) = child else {
        return;
    };
    let mut answered = false;
    if handshaken {
        let (tx, rx) = channel();
        let sent = session
            .lock()
            .map(|mut g| {
                g.next_id += 1;
                let id = g.next_id;
                g.pending.insert(id, tx);
                let msg =
                    json!({ "jsonrpc": "2.0", "id": id, "method": "shutdown", "params": null });
                g.stdin
                    .as_mut()
                    .is_some_and(|si| write_msg(si, &msg).is_ok())
            })
            .unwrap_or(false);
        answered = sent && rx.recv_timeout(SHUTDOWN_WAIT).is_ok();
    }
    if let Ok(mut g) = session.lock() {
        if let Some(si) = g.stdin.as_mut() {
            let _ = write_msg(si, &json!({ "jsonrpc": "2.0", "method": "exit" }));
        }
        g.stdin = None; // EOF: a server that missed `exit` sees its input end
        g.pending.clear();
    }
    let ended = reap(&mut child, EXIT_WAIT);
    if let Ok(mut g) = session.lock() {
        g.pid = None;
    }
    if let Some(src) = src {
        let (code, how) = match ended {
            Ended::Exited(_) if !handshaken || answered => ("stopped", "it exited"),
            Ended::Exited(_) => ("stopped", "it exited without answering shutdown"),
            Ended::Killed => ("killed", "it did not exit in time and was killed"),
        };
        src.event(
            code,
            format!("stopped: {} — {how}", reason.text()),
            json!({ "reason": reason.code(), "answered": answered, "exitCode": match ended { Ended::Exited(c) => json!(c), Ended::Killed => Value::Null } }),
        );
        (src.emit)("lsp://servers", json!({}));
    }
}

/// The thread reading a server's stdout saw it close. Stopped on purpose: nothing to do. Otherwise
/// the server died: out of the map (the next request starts another one), reaped, and said.
pub(super) fn reader_ended(map: &SessionMap, session: &Arc<Mutex<Session>>) {
    let (child, key) = {
        let Ok(mut g) = session.lock() else {
            return;
        };
        if g.stopping {
            return;
        }
        g.stopping = true;
        g.pending.clear();
        g.initialized = true;
        g.stdin = None;
        (g.child.take(), g.key.clone())
    };
    detach(map, &key, session);
    let ended = child.map(|mut c| reap(&mut c, EXIT_WAIT));
    if let Ok(mut g) = session.lock() {
        g.pid = None;
    }
    if let Some(src) = Source::of(session) {
        let code = match ended {
            Some(Ended::Exited(c)) => c,
            _ => None,
        };
        src.event(
            "crashed",
            match code {
                Some(c) => format!("exited unexpectedly (code {c}); it starts again when needed"),
                None => "exited unexpectedly; it starts again when needed".to_string(),
            },
            json!({ "exitCode": code }),
        );
        (src.emit)("lsp://servers", json!({}));
    }
}

/// A session to stop, and why.
pub(super) type Stop = (Arc<Mutex<Session>>, Reason);

/// Shut these down, each on a thread of its own (the handles let a caller wait).
fn shutdown_each(stops: Vec<Stop>) -> Vec<JoinHandle<()>> {
    stops
        .into_iter()
        .map(|(s, why)| thread::spawn(move || shutdown(&s, why)))
        .collect()
}

// ── idle servers and the cap ────────────────────────────────────────────────────────────────────

/// Sessions to stop now, taken out of the map (under its lock — see the module notes): the idle
/// ones (no open document and unused for `limits.idle`), then, while more than `limits.max` are
/// left, the least recently used with no open document. Never `keep` (the one just started) nor
/// one still starting. The second value: how many still run over the cap (each one left has open
/// documents), when it is still over.
pub(super) fn select_stops(
    map: &SessionMap,
    now: Instant,
    limits: Limits,
    keep: Option<&str>,
) -> (Vec<Stop>, Option<usize>) {
    let Ok(mut m) = map.lock() else {
        return (Vec::new(), None);
    };
    // the ones that may stop: (key, last used, already taken)
    let mut info: Vec<(String, Instant, bool)> = Vec::new();
    let mut live = 0usize;
    for (k, s) in m.iter() {
        let Ok(g) = s.lock() else { continue };
        if g.stopping {
            continue;
        }
        live += 1;
        let stoppable = g.initialized && g.open.is_empty() && keep != Some(k.as_str());
        if stoppable {
            info.push((k.clone(), g.last_used, false));
        }
    }
    let mut stops = Vec::new();
    if let Some(idle) = limits.idle {
        for (k, last, taken) in info.iter_mut() {
            if now.saturating_duration_since(*last) >= idle {
                if let Some(s) = m.remove(k.as_str()) {
                    stops.push((s, Reason::Idle));
                    live -= 1;
                    *taken = true;
                }
            }
        }
    }
    info.retain(|(_, _, taken)| !taken);
    info.sort_by_key(|(_, last, _)| *last);
    let mut lru = info.into_iter();
    while live > limits.max {
        let Some((k, _, _)) = lru.next() else { break };
        if let Some(s) = m.remove(&k) {
            stops.push((s, Reason::Limit));
            live -= 1;
        }
    }
    let over = (live > limits.max).then_some(live);
    (stops, over)
}

/// Apply the idle time and the cap now: the sessions [`select_stops`] picks are shut down on
/// threads of their own (the handles let a caller wait). With `say_over`, a cap that cannot be met
/// (every server left has open files) is said: in the log of `keep` and as `lsp://limit`.
pub(super) fn enforce(
    map: &SessionMap,
    emit: &Emit,
    limits: Limits,
    keep: Option<&str>,
    say_over: bool,
) -> Vec<JoinHandle<()>> {
    let (stops, over) = select_stops(map, Instant::now(), limits, keep);
    if let (Some(running), true) = (over, say_over) {
        let servers: Vec<String> = map
            .lock()
            .map(|m| {
                m.values()
                    .filter_map(|s| s.lock().ok().map(|g| g.label.clone()))
                    .collect()
            })
            .unwrap_or_default();
        let src = keep.and_then(|k| map.lock().ok()?.get(k).cloned());
        let detail = json!({ "running": running, "max": limits.max, "servers": servers });
        if let Some(src) = src.as_ref().and_then(Source::of) {
            src.event(
                "over-limit",
                format!(
                    "{running} language servers are running (the limit is {}); none was stopped because each has open files",
                    limits.max
                ),
                detail.clone(),
            );
        }
        emit("lsp://limit", detail);
    }
    shutdown_each(stops)
}

/// Every 30 s, the idle servers stop (and the cap is applied again, if it was lowered).
pub(super) fn spawn_reaper(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(REAP_EVERY);
        let map = app.state::<LspState>().0.clone();
        enforce(&map, &emitter(&app), Limits::current(), None, false);
    });
}

// ── documents, folders, the app ─────────────────────────────────────────────────────────────────

/// The editor closed `path` (its tab, or the file was deleted or renamed): forgotten, and
/// `didClose` goes to every session that has it open. How many sessions heard it.
pub(super) fn close_document(map: &SessionMap, path: &str) -> usize {
    docs().lock().unwrap().remove(path);
    let uri = path_to_uri(path);
    let sessions: Vec<Arc<Mutex<Session>>> = map
        .lock()
        .map(|m| m.values().cloned().collect())
        .unwrap_or_default();
    let mut told = 0;
    for s in sessions {
        let had = s.lock().map(|mut g| g.open.remove(&uri)).unwrap_or(false);
        if had
            && session_notify(
                &s,
                "textDocument/didClose",
                json!({ "textDocument": { "uri": uri } }),
            )
            .is_ok()
        {
            told += 1;
        }
    }
    told
}

/// Is `path` the folder `root` or inside it?
fn under(path: &str, root: &str) -> bool {
    let root = root.trim_end_matches('/');
    path == root || path.starts_with(&format!("{root}/"))
}

/// The folder `root` was closed (or another one opened in its place): its servers are shut down
/// (in parallel; the handles let a caller wait), its documents and its override files forgotten.
pub(super) fn close_folder(map: &SessionMap, root: &str) -> Vec<JoinHandle<()>> {
    let root = root.trim_end_matches('/').to_string();
    workspace_roots().lock().unwrap().remove(&root);
    conf().lock().unwrap().cache.remove(&root);
    docs().lock().unwrap().retain(|p, _| !under(p, &root));
    let stops: Vec<Stop> = match map.lock() {
        Ok(mut m) => {
            let keys: Vec<String> = m
                .iter()
                .filter(|(k, s)| {
                    let project = s.lock().ok().and_then(|g| g.project.clone());
                    project.as_deref() == Some(root.as_str())
                        || split_key(k).is_some_and(|(_, r)| under(r, &root))
                })
                .map(|(k, _)| k.clone())
                .collect();
            keys.iter()
                .filter_map(|k| m.remove(k))
                .map(|s| (s, Reason::Folder))
                .collect()
        }
        Err(_) => Vec::new(),
    };
    shutdown_each(stops)
}

/// Shut every server down and wait for them (in parallel: a few seconds at most).
pub(super) fn stop_all(map: &SessionMap, reason: Reason) {
    let all: Vec<Stop> = match map.lock() {
        Ok(mut m) => m.drain().map(|(_, s)| (s, reason)).collect(),
        Err(_) => Vec::new(),
    };
    for h in shutdown_each(all) {
        let _ = h.join();
    }
}

/// The app is closing: every language server is shut down and reaped before it goes.
pub fn shutdown_all(app: &AppHandle) {
    let map = app.state::<LspState>().0.clone();
    stop_all(&map, Reason::AppExit);
}

// ── the list of servers ─────────────────────────────────────────────────────────────────────────

/// A live server, as the list shows it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub key: String,
    /// the server id (`rust`)
    pub server: String,
    pub label: String,
    pub root: String,
    /// the open folder whose override files made it
    pub project: Option<String>,
    pub pid: Option<u32>,
    /// `starting` (before `initialize` answered), `indexing` or `ready`
    pub state: &'static str,
    /// the documents open in it (absolute paths)
    pub documents: Vec<String>,
    /// since it was last used
    pub idle_secs: u64,
    /// when it stops for being idle (no open document and an idle time set)
    pub stops_in_secs: Option<u64>,
    pub uptime_secs: u64,
    /// resident memory of the server and the processes it started, in KiB (Linux)
    pub memory_kib: Option<u64>,
}

/// The live servers and the limits they run under (`lsp_servers`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServersView {
    pub servers: Vec<ServerInfo>,
    /// 0: an idle server never stops
    pub idle_minutes: u64,
    pub max_servers: usize,
}

pub(super) fn list(map: &SessionMap, limits: Limits) -> ServersView {
    let now = Instant::now();
    let sessions: Vec<Arc<Mutex<Session>>> = map
        .lock()
        .map(|m| m.values().cloned().collect())
        .unwrap_or_default();
    let open_docs: Vec<String> = docs().lock().unwrap().keys().cloned().collect();
    let tree = memory::Tree::read();
    let mut servers: Vec<ServerInfo> = sessions
        .iter()
        .filter_map(|s| {
            let g = s.lock().ok()?;
            if g.stopping {
                return None;
            }
            let (server, _) = split_key(&g.key)?;
            let mut documents: Vec<String> = open_docs
                .iter()
                .filter(|p| g.open.contains(&path_to_uri(p)))
                .cloned()
                .collect();
            documents.sort();
            let idle = now.saturating_duration_since(g.last_used);
            Some(ServerInfo {
                key: g.key.clone(),
                server: server.to_string(),
                label: g.label.clone(),
                root: g.root.clone(),
                project: g.project.clone(),
                pid: g.pid,
                state: if !g.initialized {
                    "starting"
                } else if g.ready {
                    "ready"
                } else {
                    "indexing"
                },
                stops_in_secs: limits
                    .idle
                    .filter(|_| g.open.is_empty() && g.initialized)
                    .map(|d| d.saturating_sub(idle).as_secs()),
                documents,
                idle_secs: idle.as_secs(),
                uptime_secs: now.saturating_duration_since(g.started).as_secs(),
                memory_kib: g.pid.and_then(|p| tree.rss_kib(p)),
            })
        })
        .collect();
    servers.sort_by(|a, b| (&a.root, &a.label).cmp(&(&b.root, &b.label)));
    ServersView {
        servers,
        idle_minutes: limits.idle.map(|d| d.as_secs() / 60).unwrap_or(0),
        max_servers: limits.max,
    }
}

/// The session under `key`, or why there is none.
fn live(map: &SessionMap, key: &str) -> Result<Arc<Mutex<Session>>, String> {
    map.lock()
        .map_err(|_| "lsp map lock")?
        .get(key)
        .cloned()
        .ok_or_else(|| "that language server is not running any more".to_string())
}

/// «Stop»: shut it down now (it starts again when a file of its language needs it).
pub(super) fn stop_key(map: &SessionMap, key: &str) -> Result<(), String> {
    let s = live(map, key)?;
    detach(map, key, &s);
    shutdown(&s, Reason::User);
    Ok(())
}

/// «Restart»: shut it down and start it again from its current entry, with the open documents.
pub(super) fn restart_key(map: &SessionMap, emit: &Emit, key: &str) -> Result<(), String> {
    let s = live(map, key)?;
    let project = s.lock().map_err(|_| "lsp lock")?.project.clone();
    let (server_id, root) = split_key(key).ok_or("not a session key")?;
    let eff = effective(project.as_deref());
    let server = eff
        .registry
        .server(server_id)
        .cloned()
        .ok_or_else(|| format!("no language server `{server_id}` any more"))?;
    let lang = Lang::of(&server, project, eff.clone());
    detach(map, key, &s);
    shutdown(&s, Reason::Restart);
    restart(map, emit, key, root, &lang);
    match map.lock().map_err(|_| "lsp map lock")?.get(key) {
        Some(_) => Ok(()),
        None => Err(format!(
            "{} did not start again (not installed, or waiting for an approval)",
            server.label
        )),
    }
}

/// Resident memory from `/proc` (Linux; nothing elsewhere).
mod memory {
    use std::collections::HashMap;

    /// Each process's parent and resident memory, read once for a whole list.
    #[derive(Default)]
    pub struct Tree {
        children: HashMap<u32, Vec<u32>>,
        rss: HashMap<u32, u64>,
    }

    impl Tree {
        #[cfg(target_os = "linux")]
        pub fn read() -> Tree {
            let mut t = Tree::default();
            let Ok(dir) = std::fs::read_dir("/proc") else {
                return t;
            };
            for e in dir.flatten() {
                let Some(pid) = e.file_name().to_str().and_then(|n| n.parse::<u32>().ok()) else {
                    continue;
                };
                // /proc/<pid>/stat: `pid (comm) state ppid …` — comm may hold spaces and `)`
                let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
                    continue;
                };
                let ppid = stat
                    .rsplit_once(')')
                    .and_then(|(_, rest)| rest.split_whitespace().nth(1))
                    .and_then(|p| p.parse::<u32>().ok());
                if let Some(pp) = ppid {
                    t.children.entry(pp).or_default().push(pid);
                }
                if let Ok(status) = std::fs::read_to_string(format!("/proc/{pid}/status")) {
                    if let Some(kib) = status
                        .lines()
                        .find_map(|l| l.strip_prefix("VmRSS:"))
                        .and_then(|v| v.split_whitespace().next())
                        .and_then(|v| v.parse::<u64>().ok())
                    {
                        t.rss.insert(pid, kib);
                    }
                }
            }
            t
        }

        #[cfg(not(target_os = "linux"))]
        pub fn read() -> Tree {
            Tree::default()
        }

        /// The resident memory of `pid` and every process under it, in KiB.
        pub fn rss_kib(&self, pid: u32) -> Option<u64> {
            let mut total = *self.rss.get(&pid)?;
            let mut stack: Vec<u32> = self.children.get(&pid).cloned().unwrap_or_default();
            let mut seen = std::collections::HashSet::from([pid]);
            while let Some(p) = stack.pop() {
                if !seen.insert(p) {
                    continue;
                }
                total += self.rss.get(&p).copied().unwrap_or(0);
                stack.extend(self.children.get(&p).cloned().unwrap_or_default());
            }
            Some(total)
        }
    }
}

#[cfg(test)]
mod tests;
