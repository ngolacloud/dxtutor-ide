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

use crate::tool::{Tool, ToolCtx, ToolOutput};

/// Tecto do timeout que o modelo pode pedir.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(600);
/// Caracteres de saída (stdout + stderr) devolvidos ao modelo. Cada resultado fica no
/// histórico e é reenviado em todos os pedidos seguintes; o que importa num comando que falha
/// está quase sempre no fim, por isso o corte guarda sobretudo o fim ([`tail_heavy`]).
pub const OUT_MAX_CHARS: usize = 20_000;
/// A parte do orçamento que o stderr pode usar quando também há stdout.
const ERR_SHARE_CHARS: usize = 10_000;

/// Corta texto longo guardando um quarto do orçamento para o início e três quartos para o fim
/// (onde estão os erros e o resumo), com uma nota que diz como ver o resto.
pub(crate) fn tail_heavy(s: &str, max_chars: usize) -> String {
    let n = s.chars().count();
    if n <= max_chars {
        return s.to_string();
    }
    let head: String = s.chars().take(max_chars / 4).collect();
    let tail: String = s.chars().skip(n - max_chars * 3 / 4).collect();
    format!(
        "{head}\n…[{} de {n} caracteres omitidos do meio; para ver outra parte, corre o comando \
         outra vez filtrando a saída (`| grep -n padrão`, `| tail -n 100`) ou guarda-a num \
         ficheiro e lê-o com `read`/`grep`]…\n{tail}",
        n - max_chars
    )
}
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
        let (out, err) = (self.stdout.trim_end(), self.stderr.trim_end());
        // o stderr (erros) tem a sua parte garantida; o stdout fica com o resto do orçamento
        let (out_len, err_len) = (out.chars().count(), err.chars().count());
        let err_max = ERR_SHARE_CHARS
            .max(OUT_MAX_CHARS.saturating_sub(out_len))
            .min(err_len);
        let out_max = OUT_MAX_CHARS - err_max;
        if !out.trim().is_empty() {
            s.push_str("\n--- stdout\n");
            s.push_str(&tail_heavy(out, out_max));
        }
        if !err.trim().is_empty() {
            s.push_str("\n--- stderr\n");
            s.push_str(&tail_heavy(err, err_max));
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
    /// H1: where commands run (`None`: no sandbox on this machine).
    pub sandbox: Option<std::sync::Arc<crate::os_sandbox::OsSandbox>>,
    /// Toolset 12: the `unsandboxed` parameter is offered.
    pub escape: bool,
}

/// What the model sees appended when a command failed because of the sandbox.
fn with_hint(mut out: ToolOutput) -> ToolOutput {
    if out.is_error {
        if let Some(h) = crate::os_sandbox::hint(&out.content) {
            out.content.push('\n');
            out.content.push_str(h);
        }
    }
    out
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
        let mut s = json!({
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "timeout_secs": {"type": "integer", "minimum": 1, "maximum": MAX_TIMEOUT.as_secs()}
            },
            "required": ["command"],
            "additionalProperties": false
        });
        if self.escape {
            s["properties"]["unsandboxed"] = json!({
                "type": "boolean",
                "description": "Run this one command outside the sandbox (network on, the whole disk writable). The human always approves it: use it only when the sandbox blocked something the task needs."
            });
        }
        s
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
        // r23 F4a (X03): a commit the agent makes passes the secret scan first (all the changes:
        // `git add … && git commit` adds them in the same command); blocked, the human decides
        if tutor_protect::scan::shell_commits(command) {
            if let Err(e) = tutor_protect::scan::guard_commit(
                &ctx.root,
                &tutor_protect::scan::Scope::WorkingTree,
            ) {
                return ToolOutput::err(format!(
                    "{} — remove the secret from the change (use an environment variable or the vault), or leave the commit to the human",
                    tutor_protect::scan::summary(&e)
                ));
            }
        }
        let cmd = match &self.sandbox {
            Some(sb) if !(self.escape && input["unsandboxed"].as_bool() == Some(true)) => {
                sb.wrap(&shell(command))
            }
            _ => shell(command),
        };
        let r = run_process(cmd, &ctx.root, timeout, ctx);
        with_hint(ToolOutput {
            is_error: !r.ok(),
            content: r.render(),
        })
    }
}

/// `run_tests` / `lint`: o comando detectado do projecto, sem parâmetros.
pub struct Verify {
    name: &'static str,
    description: String,
    command: String,
    sandbox: Option<std::sync::Arc<crate::os_sandbox::OsSandbox>>,
}

impl Verify {
    pub fn tests(cmd: &str) -> Self {
        Verify {
            name: "run_tests",
            description: format!("Corre os testes do projecto (`{cmd}`) e devolve o exit code e a saída. Corre-os depois de alterar código e antes de dar a tarefa por feita."),
            command: cmd.to_string(),
            sandbox: None,
        }
    }
    pub fn lint(cmd: &str) -> Self {
        Verify {
            name: "lint",
            description: format!(
                "Corre o lint/typecheck do projecto (`{cmd}`) e devolve o exit code e a saída."
            ),
            command: cmd.to_string(),
            sandbox: None,
        }
    }
    /// H1: run it inside the OS sandbox.
    pub fn sandboxed(
        mut self,
        sandbox: Option<std::sync::Arc<crate::os_sandbox::OsSandbox>>,
    ) -> Self {
        self.sandbox = sandbox;
        self
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
        let cmd = match &self.sandbox {
            Some(sb) => sb.wrap(&shell(&self.command)),
            None => shell(&self.command),
        };
        let r = run_process(cmd, &ctx.root, MAX_TIMEOUT, ctx);
        with_hint(ToolOutput {
            is_error: !r.ok(),
            content: format!("$ {}\n{}", self.command, r.render()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(stdout: String, stderr: String) -> ExecOutcome {
        ExecOutcome {
            code: Some(1),
            stdout,
            stderr,
            timed_out: false,
            cancelled: false,
        }
    }

    #[test]
    fn long_output_keeps_mostly_the_end_where_the_errors_are() {
        let s = format!("INICIO{}error[E0308]: mismatched types", "x".repeat(50_000));
        let c = tail_heavy(&s, 1000);
        assert!(c.starts_with("INICIO"));
        assert!(c.ends_with("error[E0308]: mismatched types"));
        assert!(c.contains("omitidos do meio") && c.contains("tail -n"));
        assert_eq!(tail_heavy("curto", 100), "curto");
    }

    #[test]
    fn the_whole_render_fits_the_budget_and_stderr_keeps_its_share() {
        let r = outcome("o".repeat(60_000), format!("{}FALHOU", "e".repeat(60_000)));
        let s = r.render();
        assert!(s.starts_with("exit 1"));
        // o orçamento total mais as notas e os cabeçalhos
        assert!(
            s.chars().count() < OUT_MAX_CHARS + 800,
            "{}",
            s.chars().count()
        );
        assert!(s.ends_with("FALHOU"));
        // só stderr: fica com o orçamento todo
        let r = outcome(String::new(), "e".repeat(15_000));
        assert!(!r.render().contains("omitidos"));
        // stdout curto: o stderr usa o resto
        let r = outcome("ok".into(), "e".repeat(12_000));
        assert!(!r.render().contains("omitidos"));
    }
}
