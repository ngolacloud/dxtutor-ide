//! `bash`, `run_tests`/`lint` e o executor de processos que as ferramentas git usam.
//!
//! Cada processo corre no seu **grupo de processos** (Unix). Em timeout ou cancelamento
//! mata-se o grupo inteiro; e mesmo quando termina bem o grupo é morto, para que netos
//! deixados em background (`sleep 999 &`) não segurem os pipes e bloqueiem a leitura —
//! o defeito que a auditoria encontrou no `procs::exec`.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::head_tail;
use crate::tool::{Tool, ToolCtx, ToolOutput};

/// Tecto do timeout que o modelo pode pedir.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(600);
/// Caracteres de stdout e de stderr devolvidos ao modelo (cada um, início + fim).
const OUT_MAX_CHARS: usize = 30_000;
/// Bytes guardados em memória por stream (o resto é descartado ao ler).
const CAPTURE_MAX_BYTES: usize = 4 * 1024 * 1024;

/// Resultado de um processo.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecOutcome {
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

impl ExecOutcome {
    pub fn ok(&self) -> bool {
        self.code == Some(0) && !self.timed_out && !self.cancelled
    }

    /// O texto devolvido ao modelo: estado, stdout e stderr (cortados início + fim).
    pub fn render(&self) -> String {
        let status = if self.cancelled {
            "cancelado pelo utilizador".to_string()
        } else if self.timed_out {
            "excedeu o tempo limite (processo terminado)".to_string()
        } else {
            match self.code {
                Some(c) => format!("exit {c}"),
                None => "terminado por sinal".to_string(),
            }
        };
        let mut s = status;
        if !self.stdout.trim().is_empty() {
            s.push_str("\n--- stdout\n");
            s.push_str(&head_tail(self.stdout.trim_end(), OUT_MAX_CHARS));
        }
        if !self.stderr.trim().is_empty() {
            s.push_str("\n--- stderr\n");
            s.push_str(&head_tail(self.stderr.trim_end(), OUT_MAX_CHARS));
        }
        s
    }
}

fn reader<R: Read + Send + 'static>(mut r: R) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match r.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if buf.len() < CAPTURE_MAX_BYTES {
                        buf.extend_from_slice(&chunk[..n.min(CAPTURE_MAX_BYTES - buf.len())]);
                    }
                }
            }
        }
        let _ = tx.send(buf);
    });
    rx
}

#[cfg(unix)]
fn kill_group(pid: u32) {
    // pid negativo = o grupo inteiro (o filho é líder do seu grupo: process_group(0))
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

/// Corre `cmd` em `root` com timeout e cancelamento, capturando stdout/stderr. O stdin
/// fica vazio (o agente não tem teclado).
pub fn run_process(cmd: Command, root: &Path, timeout: Duration, ctx: &ToolCtx) -> ExecOutcome {
    run_process_io(cmd, root, timeout, ctx, None)
}

/// Como [`run_process`], com um ficheiro como stdin (os hooks recebem o evento em JSON).
pub fn run_process_io(
    mut cmd: Command,
    root: &Path,
    timeout: Duration,
    ctx: &ToolCtx,
    stdin: Option<std::fs::File>,
) -> ExecOutcome {
    match stdin {
        Some(f) => cmd.stdin(f),
        None => cmd.stdin(Stdio::null()),
    };
    cmd.current_dir(root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // nada interactivo nem paginado: o agente não tem teclado
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_PAGER", "cat")
        .env("PAGER", "cat")
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .env("CI", "1");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return ExecOutcome {
                code: None,
                stdout: String::new(),
                stderr: format!("não foi possível arrancar: {e}"),
                timed_out: false,
                cancelled: false,
            }
        }
    };
    let out_rx = reader(child.stdout.take().expect("stdout piped"));
    let err_rx = reader(child.stderr.take().expect("stderr piped"));
    let t0 = Instant::now();
    let (mut timed_out, mut cancelled) = (false, false);
    let code = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code(),
            Ok(None) => {}
            Err(_) => break None,
        }
        if ctx.cancelled() {
            cancelled = true;
        } else if t0.elapsed() >= timeout {
            timed_out = true;
        }
        if cancelled || timed_out {
            #[cfg(unix)]
            kill_group(child.id());
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    // limpa netos em background que ainda segurem os pipes
    #[cfg(unix)]
    kill_group(child.id());
    let grab = |rx: mpsc::Receiver<Vec<u8>>| {
        rx.recv_timeout(Duration::from_secs(2))
            .map(|b| String::from_utf8_lossy(&b).to_string())
            .unwrap_or_default()
    };
    ExecOutcome {
        code,
        stdout: grab(out_rx),
        stderr: grab(err_rx),
        timed_out,
        cancelled,
    }
}

/// `sh -c` (Unix) / `cmd /C` (Windows).
pub fn shell(command: &str) -> Command {
    if cfg!(windows) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    } else {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c
    }
}

pub struct Bash {
    pub default_timeout: Duration,
}

impl Tool for Bash {
    fn name(&self) -> &str {
        "bash"
    }
    fn description(&self) -> &str {
        "Corre um comando de shell na raiz do projecto e devolve o exit code, stdout e stderr. \
         Para builds, testes, linters e git. Não é interactivo (sem stdin). `timeout_secs` até \
         600 (por omissão 120). Prefere read/grep/glob/edit para ler e alterar ficheiros."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout_secs": {"type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT.as_secs()}
            },
            "required": ["command"],
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        false
    }
    fn command_preview(&self, input: &Value) -> Option<String> {
        input["command"].as_str().map(String::from)
    }
    fn run(&self, input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let command = input["command"].as_str().unwrap_or_default();
        if command.trim().is_empty() {
            return ToolOutput::err("comando vazio");
        }
        let timeout = input["timeout_secs"]
            .as_u64()
            .map(Duration::from_secs)
            .unwrap_or(self.default_timeout)
            .min(MAX_TIMEOUT);
        let r = run_process(shell(command), &ctx.root, timeout, ctx);
        ToolOutput {
            is_error: !r.ok(),
            content: r.render(),
        }
    }
}

/// `run_tests` / `lint`: o comando detectado do projecto, sem parâmetros.
pub struct Verify {
    name: &'static str,
    description: String,
    command: String,
}

impl Verify {
    pub fn tests(cmd: &str) -> Self {
        Verify {
            name: "run_tests",
            description: format!("Corre os testes do projecto (`{cmd}`) e devolve o exit code e a saída. Corre-os depois de alterar código e antes de dar a tarefa por feita."),
            command: cmd.to_string(),
        }
    }
    pub fn lint(cmd: &str) -> Self {
        Verify {
            name: "lint",
            description: format!(
                "Corre o lint/typecheck do projecto (`{cmd}`) e devolve o exit code e a saída."
            ),
            command: cmd.to_string(),
        }
    }
}

impl Tool for Verify {
    fn name(&self) -> &str {
        self.name
    }
    fn description(&self) -> &str {
        &self.description
    }
    fn input_schema(&self) -> Value {
        json!({"type": "object", "properties": {}, "additionalProperties": false})
    }
    fn read_only(&self) -> bool {
        false // corre código do projecto
    }
    fn command_preview(&self, _input: &Value) -> Option<String> {
        Some(self.command.clone())
    }
    fn run(&self, _input: &Value, ctx: &ToolCtx) -> ToolOutput {
        let r = run_process(shell(&self.command), &ctx.root, MAX_TIMEOUT, ctx);
        ToolOutput {
            is_error: !r.ok(),
            content: format!("$ {}\n{}", self.command, r.render()),
        }
    }
}
