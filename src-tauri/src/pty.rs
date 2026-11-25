//! Real PTY terminals: embedded xterm.js views talking to live OS shells.
//!
//! Each terminal instance is a pseudo-terminal opened with `portable-pty`, keyed by an id
//! the UI chooses (several instances live side by side, like VS Code's terminal list).
//! A reader thread streams the master's bytes to the webview as `pty://data` events
//! (`{ id, data }`), and when the shell ends a `pty://exit` event carries its real exit
//! code (`{ id, code }`). Keystrokes go back through `pty_write`, resizes through
//! `pty_resize`. This is the user's own shell (`$SHELL` on Unix, PowerShell on Windows),
//! with their rc files, not a one-shot command runner.
//!
//! Shell integration (cwd + exit code of each command, as OSC sequences) is planned by
//! [`crate::shell_integration`]; this module only spawns and pumps bytes.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::shell_integration;

/// A live PTY session. The master is kept for resizing and for asking which process is in
/// the foreground; the writer feeds keystrokes; the killer ends the child on close.
struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    shell: String,
    generation: u64,
}

/// Tauri-managed state: every open terminal instance, by the UI's id.
#[derive(Default)]
pub struct PtyState(Mutex<HashMap<String, Session>>);

static GENERATION: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Serialize)]
struct DataEvent<'a> {
    id: &'a str,
    data: String,
}

#[derive(Clone, Serialize)]
struct ExitEvent<'a> {
    id: &'a str,
    code: i64,
}

/// A shell the user can pick for a new terminal ("bash", "zsh", "pwsh", …).
#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShellProfile {
    pub name: String,
    pub path: String,
    pub default: bool,
}

/// What is running in a terminal right now (for the tab title and the split cwd).
#[derive(Clone, Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PtyInfo {
    pub shell: String,
    pub shell_pid: Option<u32>,
    /// Name of the foreground process ("bash", "cargo", "node", "vim", …).
    pub process: Option<String>,
    /// Working directory of the foreground process, when the OS exposes it.
    pub cwd: Option<String>,
}

/// Split `buf` at the last complete UTF-8 boundary. Returns how many leading bytes form
/// complete characters; the rest is an unfinished multi-byte sequence to carry over to the
/// next read (a 4 KiB read routinely cuts "ç" or a box-drawing glyph in half). An invalid
/// sequence is not carried: it is emitted (lossily) so the stream never stalls.
pub fn utf8_boundary(buf: &[u8]) -> usize {
    match std::str::from_utf8(buf) {
        Ok(_) => buf.len(),
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        Err(_) => buf.len(),
    }
}

/// The default shell of this OS user.
pub fn default_shell() -> String {
    #[cfg(windows)]
    {
        if which("pwsh.exe").is_some() {
            return "pwsh.exe".into();
        }
        "powershell.exe".into()
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "/bin/bash".into())
    }
}

/// Resolve a program name against PATH (absolute/relative paths are checked as-is).
fn which(program: &str) -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(program);
    if p.components().count() > 1 {
        return p.is_file().then(|| p.to_path_buf());
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|d| d.join(program))
            .find(|c| c.is_file())
    })
}

/// Parse `/etc/shells` into profiles: existing executables only, one entry per shell name
/// (the first path wins), the user's `$SHELL` first and marked default. Pure on its inputs.
pub fn shells_from(
    etc_shells: &str,
    user_shell: &str,
    exists: impl Fn(&str) -> bool,
) -> Vec<ShellProfile> {
    let name_of = |p: &str| p.rsplit('/').next().unwrap_or(p).to_string();
    let mut out: Vec<ShellProfile> = Vec::new();
    let mut push = |path: &str, default: bool| {
        let name = name_of(path);
        if name.is_empty() || out.iter().any(|s| s.name == name) || !exists(path) {
            return;
        }
        out.push(ShellProfile {
            name,
            path: path.to_string(),
            default,
        });
    };
    push(user_shell, true);
    for line in etc_shells.lines() {
        let l = line.trim();
        // rbash is the restricted bash (no cd, fixed PATH): useless as a working terminal
        if l.is_empty()
            || l.starts_with('#')
            || l.ends_with("/nologin")
            || l.ends_with("/false")
            || l.ends_with("/rbash")
        {
            continue;
        }
        push(l, false);
    }
    out
}

/// Open a PTY, spawn `cmd` on its slave, stream its output, and store the session under
/// `id` (replacing a previous one with the same id).
fn spawn_with_command(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
    cmd: CommandBuilder,
    shell: String,
) -> Result<(), String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {e}"))?;

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("could not start {shell}: {e}"))?;
    // The slave is owned by the child now; dropping our handle lets the master see EOF.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("cloning pty reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("taking pty writer failed: {e}"))?;
    let killer = child.clone_killer();
    let pid = child.process_id();
    let generation = GENERATION.fetch_add(1, Ordering::Relaxed);

    state.0.lock().map_err(|_| "pty lock poisoned")?.insert(
        id.clone(),
        Session {
            master: pair.master,
            writer,
            killer,
            pid,
            shell,
            generation,
        },
    );

    // Reader thread: pump PTY bytes (whole UTF-8 characters only) until EOF, then reap the
    // child for its real exit code and drop the session if it is still this generation.
    thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut carry: Vec<u8> = Vec::new();
        // r23 F4a (X04): secrets in the output are masked before they reach the webview
        let mut mask = tutor_protect::stream::Masker::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let cut = utf8_boundary(&carry);
                    if cut == 0 {
                        continue;
                    }
                    let data = mask.push(&String::from_utf8_lossy(&carry[..cut]));
                    carry.drain(..cut);
                    let _ = app.emit("pty://data", DataEvent { id: &id, data });
                }
            }
        }
        if !carry.is_empty() {
            let data = mask.push(&String::from_utf8_lossy(&carry));
            let _ = app.emit("pty://data", DataEvent { id: &id, data });
        }
        let code = child.wait().map(|s| i64::from(s.exit_code())).unwrap_or(-1);
        if let Ok(mut map) = app.state::<PtyState>().0.lock() {
            if map.get(&id).is_some_and(|s| s.generation == generation) {
                map.remove(&id);
            }
        }
        let _ = app.emit("pty://exit", ExitEvent { id: &id, code });
    });
    Ok(())
}

/// Common environment of every terminal: a capable TERM, truecolor, a UTF-8 locale when
/// the app was started without one, and the caller's extra variables (DOCKER_HOST, …).
fn base_env(cmd: &mut CommandBuilder, env: Option<HashMap<String, String>>) {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "dxtutor");
    cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
    if std::env::var_os("LANG").is_none() && std::env::var_os("LC_ALL").is_none() {
        cmd.env("LANG", "C.UTF-8");
    }
    for (k, v) in env.unwrap_or_default() {
        cmd.env(k, v);
    }
}

/// Spawn a terminal instance `id`. With no `command` it is an interactive `shell` (default:
/// the user's own) with shell integration when the shell supports it; with a `command` it
/// runs that line through `sh -c` (`cmd /C` on Windows) on the PTY — a task terminal whose
/// colours and progress bars render exactly as in a real terminal, and whose exit code
/// arrives in `pty://exit`. `cwd` defaults to HOME.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    shell: Option<String>,
    command: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
    let (mut cmd, label) = match command.as_deref().map(str::trim).filter(|c| !c.is_empty()) {
        Some(line) => {
            #[cfg(windows)]
            let mut c = CommandBuilder::new("cmd.exe");
            #[cfg(windows)]
            c.args(["/C", line]);
            #[cfg(not(windows))]
            let mut c = CommandBuilder::new("/bin/sh");
            #[cfg(not(windows))]
            c.args(["-c", line]);
            (c, "task".to_string())
        }
        None => {
            let program = shell
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(default_shell);
            let mut c = CommandBuilder::new(&program);
            if let Some(plan) = shell_integration::plan(&program) {
                c.args(&plan.args);
                for (k, v) in plan.env {
                    c.env(k, v);
                }
            }
            (c, program)
        }
    };
    base_env(&mut cmd, env);
    let dir = cwd
        .filter(|d| std::path::Path::new(d).is_dir())
        .or_else(|| std::env::var("HOME").ok())
        .or_else(|| std::env::var("USERPROFILE").ok());
    if let Some(d) = dir {
        cmd.cwd(d);
    }
    spawn_with_command(app, state, id, rows, cols, cmd, label)
}

/// Spawn a terminal instance INSIDE the persistent devcontainer session for `root`
/// (`<engine> exec -it <session> sh`) on a PTY — a live terminal attached to the container.
/// Errors when no session is running.
#[tauri::command]
pub fn pty_spawn_in_session(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
    root: String,
) -> Result<(), String> {
    let path = std::path::Path::new(&root);
    let name = tutor_eval::session_name(path);
    if !tutor_eval::session_running(&name) {
        return Err("No running session — press Reopen in Container first.".into());
    }
    let (program, args) = tutor_eval::session_shell_command(path);
    let mut cmd = CommandBuilder::new(&program);
    for a in args {
        cmd.arg(a);
    }
    base_env(&mut cmd, None);
    spawn_with_command(
        app,
        state,
        id,
        rows,
        cols,
        cmd,
        format!("{program} (container)"),
    )
}

/// Forward keystrokes (or pasted text) from xterm to terminal `id`.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "pty lock poisoned")?;
    let session = map.get_mut(&id).ok_or("terminal is not running")?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|e| format!("pty write failed: {e}"))
}

/// Resize terminal `id` when its view changes size.
#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|_| "pty lock poisoned")?;
    if let Some(session) = map.get(&id) {
        session
            .master
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("pty resize failed: {e}"))?;
    }
    Ok(())
}

/// Kill terminal `id` (the trash button). The reader thread then emits its `pty://exit`.
/// Returns false when no such terminal was running.
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: String) -> bool {
    let session = state.0.lock().ok().and_then(|mut m| m.remove(&id));
    session.is_some()
}

/// The shells this machine offers for a new terminal (the "+ ▾" profile menu).
#[tauri::command]
pub fn pty_shells() -> Vec<ShellProfile> {
    #[cfg(windows)]
    {
        let mut out = Vec::new();
        for (name, exe) in [
            ("PowerShell", "pwsh.exe"),
            ("Windows PowerShell", "powershell.exe"),
            ("Command Prompt", "cmd.exe"),
        ] {
            if which(exe).is_some() {
                let default = out.is_empty();
                out.push(ShellProfile {
                    name: name.into(),
                    path: exe.into(),
                    default,
                });
            }
        }
        out
    }
    #[cfg(not(windows))]
    {
        let etc = std::fs::read_to_string("/etc/shells").unwrap_or_default();
        shells_from(&etc, &default_shell(), |p| which(p).is_some())
    }
}

/// What terminal `id` is running now: its shell, and the foreground process with its cwd
/// (Linux reads `/proc`; elsewhere the process name comes from `ps` and cwd stays unknown).
#[tauri::command]
pub fn pty_info(state: State<'_, PtyState>, id: String) -> Result<PtyInfo, String> {
    let map = state.0.lock().map_err(|_| "pty lock poisoned")?;
    let s = map.get(&id).ok_or("terminal is not running")?;
    let mut info = PtyInfo {
        shell: s.shell.clone(),
        shell_pid: s.pid,
        ..Default::default()
    };
    #[cfg(unix)]
    {
        let fg = s.master.process_group_leader().map(|p| p as u32).or(s.pid);
        drop(map);
        if let Some(pid) = fg {
            info.process = process_name(pid);
            info.cwd = process_cwd(pid);
        }
    }
    Ok(info)
}

#[cfg(unix)]
fn process_name(pid: u32) -> Option<String> {
    if let Ok(s) = std::fs::read_to_string(format!("/proc/{pid}/comm")) {
        return Some(s.trim().to_string()).filter(|s| !s.is_empty());
    }
    let out = std::process::Command::new("ps")
        .args(["-o", "comm=", "-p", &pid.to_string()])
        .output()
        .ok()?;
    let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let base = name
        .rsplit('/')
        .next()
        .unwrap_or(&name)
        .trim_start_matches('-')
        .to_string();
    Some(base).filter(|s| !s.is_empty())
}

#[cfg(unix)]
fn process_cwd(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

impl Drop for Session {
    fn drop(&mut self) {
        // Closing a terminal ends its shell (and, through the hang-up, its job tree).
        let _ = self.killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_boundary_carries_a_split_character() {
        let s = "olá ç".as_bytes();
        // "ç" is two bytes; cut after its first byte.
        let cut = &s[..s.len() - 1];
        assert_eq!(utf8_boundary(cut), s.len() - 2);
        assert_eq!(utf8_boundary(s), s.len());
    }

    #[test]
    fn utf8_boundary_does_not_stall_on_invalid_bytes() {
        let bad = [b'a', 0xff, b'b'];
        assert_eq!(utf8_boundary(&bad), bad.len());
    }

    #[test]
    fn shells_from_puts_the_user_shell_first_and_dedupes_by_name() {
        let etc = "# comment\n/bin/sh\n/bin/bash\n/usr/bin/rbash\n/usr/bin/bash\n/usr/bin/zsh\n/usr/sbin/nologin\n/usr/bin/fish\n";
        let got = shells_from(etc, "/usr/bin/zsh", |p| p != "/usr/bin/fish");
        let names: Vec<&str> = got.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["zsh", "sh", "bash"]);
        assert!(got[0].default && !got[1].default);
        assert_eq!(got[2].path, "/bin/bash");
    }
}
