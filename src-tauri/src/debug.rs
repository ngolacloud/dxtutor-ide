//! Real step-through debugging driven by `gdb` over its Machine Interface (MI3). A session
//! is a live `gdb` child process we write MI commands to and read records from — breakpoints,
//! run/continue/step, stack and locals all come straight from gdb. No simulation: when gdb
//! is absent the commands fail loudly rather than pretend.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;

/// Where execution stopped (breakpoint hit, step end, or exit).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stop {
    pub stopped: bool,
    pub reason: String,
    pub func: String,
    pub file: String,
    pub line: u32,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Var {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub level: u32,
    pub func: String,
    pub file: String,
    pub line: u32,
}

/// One live gdb/MI session.
struct Session {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<std::process::ChildStdout>,
}

impl Session {
    fn launch(program: &str, cwd: Option<&str>) -> Result<Session, String> {
        if crate::debug::gdb_path().is_none() {
            return Err("gdb not found on PATH — install gdb (or lldb) for step-debugging".into());
        }
        let mut cmd = Command::new("gdb");
        cmd.args(["--interpreter=mi3", "-q", program])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(d) = cwd {
            cmd.current_dir(d);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start gdb: {e}"))?;
        let stdin = child.stdin.take().ok_or("no gdb stdin")?;
        let reader = BufReader::new(child.stdout.take().ok_or("no gdb stdout")?);
        let mut s = Session {
            child,
            stdin,
            reader,
        };
        // Drain the start-up banner up to the first `(gdb)` prompt. The banner carries no
        // result record, so we must NOT wait for one here (that would block forever).
        s.read_until_prompt()?;
        Ok(s)
    }

    /// Send one MI command and read records until the terminating result/stop record. Returns
    /// the collected lines (the `^...` result and any async `*stopped`/`=`/`~` lines).
    fn send(&mut self, cmd: &str) -> Result<Vec<String>, String> {
        writeln!(self.stdin, "{cmd}").map_err(|e| format!("gdb write: {e}"))?;
        self.stdin.flush().map_err(|e| format!("gdb flush: {e}"))?;
        self.read_until_result()
    }

    /// Read until a top-level result record (`^done`/`^error`/`^running`/`^connected`) OR an
    /// execution-stop async record (`*stopped`). Collects every line seen.
    fn read_until_result(&mut self) -> Result<Vec<String>, String> {
        let mut out = Vec::new();
        loop {
            let mut line = String::new();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("gdb read: {e}"))?;
            if n == 0 {
                return Err("gdb closed unexpectedly".into());
            }
            let t = line.trim_end().to_string();
            if t == "(gdb)" || t.is_empty() {
                // prompt: stop only if we already saw a terminal record
                if out.iter().any(|l: &String| is_terminal(l)) {
                    return Ok(out);
                }
                continue;
            }
            let terminal = is_terminal(&t);
            if t.starts_with("^error") {
                out.push(t.clone());
                return Err(mi_field(&t, "msg").unwrap_or_else(|| "gdb error".into()));
            }
            out.push(t);
            if terminal {
                // `*stopped` is terminal for exec commands; `^done`/`^running` for others.
                // After `^running` we keep reading until the matching `*stopped`.
                if out
                    .last()
                    .map(|l| {
                        l.starts_with("*stopped")
                            || l.starts_with("^done")
                            || l.starts_with("^connected")
                    })
                    .unwrap_or(false)
                {
                    return Ok(out);
                }
            }
        }
    }

    /// Read until the `(gdb)` prompt, with no requirement of a result record. Used to drain
    /// the start-up banner (which has none).
    fn read_until_prompt(&mut self) -> Result<Vec<String>, String> {
        let mut out = Vec::new();
        loop {
            let mut line = String::new();
            let n = self
                .reader
                .read_line(&mut line)
                .map_err(|e| format!("gdb read: {e}"))?;
            if n == 0 {
                return Err("gdb closed during start-up".into());
            }
            let t = line.trim_end();
            if t == "(gdb)" {
                return Ok(out);
            }
            if !t.is_empty() {
                out.push(t.to_string());
            }
        }
    }

    fn kill(&mut self) {
        let _ = writeln!(self.stdin, "-gdb-exit");
        let _ = self.stdin.flush();
        let _ = self.child.wait();
    }
}

fn is_terminal(line: &str) -> bool {
    line.starts_with("^done")
        || line.starts_with("^error")
        || line.starts_with("^connected")
        || line.starts_with("*stopped")
}

/// Extract a `key="value"` scalar from an MI line (first match). Values are unescaped minimally.
fn mi_field(line: &str, key: &str) -> Option<String> {
    let pat = format!("{key}=\"");
    let start = line.find(&pat)? + pat.len();
    let rest = &line[start..];
    let mut v = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                if let Some(n) = chars.next() {
                    v.push(n);
                }
            }
            '"' => break,
            _ => v.push(c),
        }
    }
    Some(v)
}

/// Parse a `*stopped` (or exit) async record into a Stop.
fn parse_stop(lines: &[String]) -> Stop {
    let stopped = lines.iter().rev().find(|l| l.starts_with("*stopped"));
    let Some(l) = stopped else {
        return Stop::default();
    };
    let reason = mi_field(l, "reason").unwrap_or_default();
    if reason.starts_with("exited") {
        return Stop {
            stopped: true,
            reason: reason.clone(),
            exited: true,
            exit_code: mi_field(l, "exit-code").and_then(|c| {
                c.trim_start_matches("0x")
                    .parse::<i32>()
                    .ok()
                    .or_else(|| i32::from_str_radix(c.trim_start_matches("0x"), 8).ok())
            }),
            ..Default::default()
        };
    }
    Stop {
        stopped: true,
        reason,
        func: mi_field(l, "func").unwrap_or_default(),
        file: mi_field(l, "fullname")
            .or_else(|| mi_field(l, "file"))
            .unwrap_or_default(),
        line: mi_field(l, "line")
            .and_then(|n| n.parse().ok())
            .unwrap_or(0),
        exited: false,
        exit_code: None,
    }
}

/// Parse `^done,variables=[{name="x",value="1"},...]` into a Var list.
fn parse_vars(lines: &[String]) -> Vec<Var> {
    let Some(l) = lines.iter().find(|l| l.contains("variables=[")) else {
        return vec![];
    };
    parse_name_value_list(l)
}

fn parse_name_value_list(l: &str) -> Vec<Var> {
    let mut out = Vec::new();
    // Walk each {...} group; pull name= and value= from it.
    let mut rest = l;
    while let Some(open) = rest.find('{') {
        let close = rest[open..]
            .find('}')
            .map(|c| open + c)
            .unwrap_or(rest.len());
        let group = &rest[open..close];
        if let Some(name) = mi_field(group, "name") {
            out.push(Var {
                name,
                value: mi_field(group, "value").unwrap_or_default(),
            });
        }
        rest = &rest[close.min(rest.len())..];
        if rest.is_empty() {
            break;
        }
        rest = &rest[1.min(rest.len())..];
    }
    out
}

/// Parse `^done,stack=[frame={level="0",func="main",...},...]` into frames.
fn parse_stack(lines: &[String]) -> Vec<Frame> {
    let Some(l) = lines.iter().find(|l| l.contains("stack=[")) else {
        return vec![];
    };
    let mut out = Vec::new();
    let mut rest: &str = l;
    while let Some(open) = rest.find("frame={") {
        let from = open + "frame=".len();
        let close = rest[from..]
            .find('}')
            .map(|c| from + c)
            .unwrap_or(rest.len());
        let g = &rest[from..close];
        out.push(Frame {
            level: mi_field(g, "level")
                .and_then(|n| n.parse().ok())
                .unwrap_or(0),
            func: mi_field(g, "func").unwrap_or_default(),
            file: mi_field(g, "fullname")
                .or_else(|| mi_field(g, "file"))
                .unwrap_or_default(),
            line: mi_field(g, "line")
                .and_then(|n| n.parse().ok())
                .unwrap_or(0),
        });
        rest = &rest[close.min(rest.len())..];
    }
    out
}

fn gdb_path() -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join("gdb"))
        .find(|p| p.is_file())
}

// ── Session registry (managed by Tauri) ─────────────────────────────────────────────

#[derive(Default)]
pub struct DebugSessions(Mutex<HashMap<String, Session>>);

impl DebugSessions {
    fn with<R>(
        &self,
        id: &str,
        f: impl FnOnce(&mut Session) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut map = self.0.lock().map_err(|_| "debug lock poisoned")?;
        let s = map.get_mut(id).ok_or("no such debug session")?;
        f(s)
    }
}

/// The honest capability gate for the UI (reuses the detector in tutor_eval).
pub fn available() -> bool {
    gdb_path().is_some()
}

/// What the host can really do for debugging (DAP detection). Fachada Tauri-free da fatia:
/// o grupo `debug` passa a atravessar `crate::debug` por inteiro — adaptador IPC e teste
/// integrado alcançam a detecção sem ver `tutor_eval` directamente. Detecta, não arranca nada.
pub use tutor_eval::dap::DebugCapability;
pub fn capabilities() -> DebugCapability {
    tutor_eval::dap::detect_debug_adapter()
}

/// Core driver API — thin wrappers the Tauri commands call. Pure enough to unit-test with a
/// real gdb (the test compiles a tiny program and drives it).
pub mod driver {
    use super::*;

    pub fn launch(
        sessions: &DebugSessions,
        id: String,
        program: String,
        cwd: Option<String>,
    ) -> Result<(), String> {
        let s = Session::launch(&program, cwd.as_deref())?;
        sessions.0.lock().map_err(|_| "debug lock")?.insert(id, s);
        Ok(())
    }

    pub fn set_break(
        sessions: &DebugSessions,
        id: &str,
        file: &str,
        line: u32,
    ) -> Result<u32, String> {
        sessions.with(id, |s| {
            let out = s.send(&format!("-break-insert {file}:{line}"))?;
            let n = out
                .iter()
                .find_map(|l| mi_field(l, "number"))
                .and_then(|n| n.parse().ok())
                .unwrap_or(0);
            Ok(n)
        })
    }

    pub fn run(sessions: &DebugSessions, id: &str) -> Result<Stop, String> {
        sessions.with(id, |s| Ok(parse_stop(&s.send("-exec-run")?)))
    }
    pub fn cont(sessions: &DebugSessions, id: &str) -> Result<Stop, String> {
        sessions.with(id, |s| Ok(parse_stop(&s.send("-exec-continue")?)))
    }
    pub fn step(sessions: &DebugSessions, id: &str, into: bool) -> Result<Stop, String> {
        let cmd = if into { "-exec-step" } else { "-exec-next" };
        sessions.with(id, |s| Ok(parse_stop(&s.send(cmd)?)))
    }
    pub fn locals(sessions: &DebugSessions, id: &str) -> Result<Vec<Var>, String> {
        sessions.with(id, |s| {
            Ok(parse_vars(
                &s.send("-stack-list-variables --simple-values")?,
            ))
        })
    }
    pub fn stack(sessions: &DebugSessions, id: &str) -> Result<Vec<Frame>, String> {
        sessions.with(id, |s| Ok(parse_stack(&s.send("-stack-list-frames")?)))
    }
    pub fn stop(sessions: &DebugSessions, id: &str) -> Result<(), String> {
        let mut map = sessions.0.lock().map_err(|_| "debug lock")?;
        if let Some(mut s) = map.remove(id) {
            s.kill();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mi_field_unescapes_and_finds() {
        let l = r#"*stopped,reason="breakpoint-hit",frame={func="add",line="3",file="t.c"}"#;
        assert_eq!(mi_field(l, "reason").as_deref(), Some("breakpoint-hit"));
        assert_eq!(mi_field(l, "func").as_deref(), Some("add"));
        assert_eq!(mi_field(l, "line").as_deref(), Some("3"));
    }

    #[test]
    fn capabilities_are_honest_and_consistent_with_available() {
        // Detecção determinística a partir do PATH; nunca entra em pânico e a nota nunca é vazia.
        let cap = capabilities();
        assert!(
            !cap.note.is_empty(),
            "a nota de capacidade explica sempre o estado"
        );
        // `available()` (gdb na PATH) e o motor detectado pela DAP coincidem: se há gdb, o
        // detector vê um motor; a fatia inteira é alcançável sem driver nem tauri::State.
        if available() {
            assert!(
                cap.engine.is_some(),
                "com gdb na PATH o detector tem de reportar um motor: {cap:?}"
            );
        }
    }

    #[test]
    fn registry_rejects_unknown_sessions_without_a_debugger() {
        // Sem gdb/sessão lançada, o registo falha em alto e bom som nos comandos que exigem
        // uma sessão — a mesma mensagem que o adaptador IPC aplanava para `String`.
        let sessions = DebugSessions::default();
        assert_eq!(
            driver::set_break(&sessions, "ghost", "t.c", 1).unwrap_err(),
            "no such debug session"
        );
        assert_eq!(
            driver::run(&sessions, "ghost").unwrap_err(),
            "no such debug session"
        );
        // `stop` numa sessão inexistente é benigno (remove None → Ok), como antes.
        assert!(driver::stop(&sessions, "ghost").is_ok());
    }

    #[test]
    fn parses_vars_and_frames() {
        let v = parse_name_value_list(
            r#"^done,variables=[{name="a",value="2"},{name="b",value="40"}]"#,
        );
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].name, "a");
        assert_eq!(v[1].value, "40");
        let f = parse_stack(&[r#"^done,stack=[frame={level="0",func="add",file="t.c",line="3"},frame={level="1",func="main",file="t.c",line="7"}]"#.to_string()]);
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].func, "add");
        assert_eq!(f[1].func, "main");
    }

    // Live gdb test: compile a tiny C program, break in `add`, run, and read a parameter.
    // Ignored when gdb or cc are absent so CI without them stays green.
    #[test]
    fn live_gdb_breakpoint_reads_real_state() {
        if gdb_path().is_none() || which("cc").is_none() {
            eprintln!("skipping: gdb/cc not on PATH");
            return;
        }
        let dir = std::env::temp_dir().join(format!("dxdbg-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let src = dir.join("t.c");
        std::fs::write(
            &src,
            "int add(int a,int b){int s=a+b;return s;}\nint main(){return add(2,40);}\n",
        )
        .unwrap();
        let bin = dir.join("t");
        let ok = Command::new("cc")
            .args(["-g", "-O0", "-o"])
            .arg(&bin)
            .arg(&src)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(ok, "cc must compile the test program");

        let sessions = DebugSessions::default();
        driver::launch(&sessions, "t".into(), bin.to_string_lossy().into(), None).unwrap();
        let bp = driver::set_break(&sessions, "t", &src.to_string_lossy(), 1).unwrap();
        assert!(bp >= 1, "breakpoint number");
        let stop = driver::run(&sessions, "t").unwrap();
        assert!(
            stop.stopped && !stop.exited,
            "should stop at the breakpoint: {stop:?}"
        );
        assert_eq!(stop.func, "add", "stopped in add");
        let vars = driver::locals(&sessions, "t").unwrap();
        // `a` and `b` are the parameters; gdb reports them with their real values.
        assert!(
            vars.iter().any(|v| v.name == "a" && v.value == "2"),
            "a=2 among {vars:?}"
        );
        assert!(
            vars.iter().any(|v| v.name == "b" && v.value == "40"),
            "b=40 among {vars:?}"
        );
        let frames = driver::stack(&sessions, "t").unwrap();
        assert!(
            frames.iter().any(|f| f.func == "main"),
            "main in the backtrace: {frames:?}"
        );
        driver::stop(&sessions, "t").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn which(tool: &str) -> Option<std::path::PathBuf> {
        let path = std::env::var_os("PATH")?;
        std::env::split_paths(&path)
            .map(|d| d.join(tool))
            .find(|p| p.is_file())
    }
}
