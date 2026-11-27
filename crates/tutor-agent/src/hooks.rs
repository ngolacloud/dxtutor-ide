//! Hooks do projecto (F7): comandos de shell que correm em momentos do loop.
//!
//! `.dxtutor/hooks.json` (só corre se o humano confiou nele — [`crate::trust`]):
//! ```json
//! { "pre_tool":  [{ "match": "bash|write", "command": "./scripts/guard.sh" }],
//!   "post_tool": [{ "match": "edit|write", "command": "npx prettier --write \"$DXTUTOR_FILE\"" }],
//!   "stop":      [{ "command": "notify-send 'Co-Dev terminou'" }] }
//! ```
//! - Cada hook recebe no stdin um JSON com o evento (`event`, `tool`, `input`, e no
//!   `post_tool` também `result`/`is_error`), corre na raiz do projecto, com timeout.
//! - `pre_tool`: exit **2** bloqueia a chamada (o stderr vai ao modelo como razão); outro
//!   código ≠ 0 só gera um aviso. Corre antes de o humano ser perguntado (H5d, abaixo).
//! - `post_tool`: exit **2** acrescenta o stderr ao resultado que o modelo vê (feedback).
//! - `stop`: corre no fim de cada turno; a saída aparece como aviso.
//! - `match`: expressão regular sobre o nome da ferramenta (vazio = todas).
//!
//! H5d (docs/v2/AUDIT-harness.md §3, P2 item 10):
//! - `pre_tool` corre ANTES de o humano ser perguntado (para cada chamada válida). Com exit 0, o stdout pode
//!   ser JSON `{"decision": "allow"|"ask"|"deny", "reason": "…"}`: `deny` bloqueia como o exit 2; `ask` obriga a
//!   perguntar ao humano (mesmo no Auto); `allow` dispensa a pergunta — mas nunca uma perigosa nem uma recusa da
//!   política (`permissions::Policy::decide`).
//! - `session_start` (payload `{event, source: "new"|"resume"}`): o stdout (exit 0) entra na conversa como nota
//!   do operador no primeiro pedido.
//! - `prompt_submit` (payload `{event, prompt}`): exit 2 bloqueia o pedido (o stderr vai ao humano, nada vai ao
//!   modelo); com exit 0 o stdout segue como nota do operador junto do pedido.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::tool::ToolCtx;
use crate::tools::run_process_io;

pub const HOOKS_FILE: &str = ".dxtutor/hooks.json";
const TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Deserialize)]
struct HookDef {
    #[serde(default, rename = "match")]
    matcher: String,
    command: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct HookFile {
    #[serde(default)]
    pre_tool: Vec<HookDef>,
    #[serde(default)]
    post_tool: Vec<HookDef>,
    #[serde(default)]
    stop: Vec<HookDef>,
    #[serde(default)]
    session_start: Vec<HookDef>,
    #[serde(default)]
    prompt_submit: Vec<HookDef>,
}

struct Compiled {
    re: Option<Regex>,
    command: String,
}

pub struct Hooks {
    root: PathBuf,
    pre: Vec<Compiled>,
    post: Vec<Compiled>,
    stop: Vec<Compiled>,
    session_start: Vec<Compiled>,
    prompt_submit: Vec<Compiled>,
    /// H1: the hooks run inside the project's OS sandbox, like the agent's commands.
    sandbox: Option<Arc<crate::os_sandbox::OsSandbox>>,
}

/// O resultado de um hook `pre_tool`.
#[derive(Debug, Clone, PartialEq)]
pub enum PreOutcome {
    /// no opinion: the policy decides
    Allow,
    Block(String),
    /// H5d: the human must decide this one (every mode)
    Ask(String),
    /// H5d: no need to ask the human (never over a dangerous ask or a refusal of the policy)
    Approve(String),
}

/// H5d: the result of the `prompt_submit` hooks.
#[derive(Debug, Clone, PartialEq)]
pub enum PromptOutcome {
    /// the request goes on, with the hooks' output (if any) as an operator note
    Allow(Option<String>),
    Block(String),
}

/// A hook's stdout as a `{decision, reason}` (exit 0), if it is one.
fn decision(stdout: &str) -> Option<(String, String)> {
    let v: Value = serde_json::from_str(stdout.trim()).ok()?;
    let d = v["decision"].as_str()?.to_ascii_lowercase();
    Some((d, v["reason"].as_str().unwrap_or_default().to_string()))
}

fn compile(defs: Vec<HookDef>) -> Result<Vec<Compiled>, String> {
    defs.into_iter()
        .map(|d| {
            let re = if d.matcher.trim().is_empty() || d.matcher == "*" {
                None
            } else {
                Some(
                    Regex::new(&format!("^(?:{})$", d.matcher))
                        .map_err(|e| format!("match inválido «{}»: {e}", d.matcher))?,
                )
            };
            Ok(Compiled {
                re,
                command: d.command,
            })
        })
        .collect()
}

impl Hooks {
    /// H1: run the hooks inside the project's OS sandbox.
    pub fn sandboxed(mut self, sandbox: Option<Arc<crate::os_sandbox::OsSandbox>>) -> Self {
        self.sandbox = sandbox;
        self
    }

    /// Lê `.dxtutor/hooks.json`. `Ok(None)` se não existir.
    pub fn load(root: &Path) -> Result<Option<Self>, String> {
        let Ok(text) = std::fs::read_to_string(root.join(HOOKS_FILE)) else {
            return Ok(None);
        };
        let f: HookFile = serde_json::from_str(&text).map_err(|e| format!("{HOOKS_FILE}: {e}"))?;
        Ok(Some(Hooks {
            root: root.to_path_buf(),
            pre: compile(f.pre_tool)?,
            post: compile(f.post_tool)?,
            stop: compile(f.stop)?,
            session_start: compile(f.session_start)?,
            prompt_submit: compile(f.prompt_submit)?,
            sandbox: None,
        }))
    }

    fn run(
        &self,
        h: &Compiled,
        payload: &Value,
        file: Option<&str>,
    ) -> (Option<i32>, String, String) {
        let mut c = if cfg!(windows) {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&h.command);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg("-c").arg(&h.command);
            c
        };
        c.env("DXTUTOR_EVENT", payload["event"].as_str().unwrap_or(""));
        c.env("DXTUTOR_TOOL", payload["tool"].as_str().unwrap_or(""));
        c.env("DXTUTOR_FILE", file.unwrap_or(""));
        c.env("DXTUTOR_PAYLOAD", payload.to_string());
        let ctx = ToolCtx {
            root: self.root.clone(),
            cancel: Arc::new(AtomicBool::new(false)),
        };
        // o JSON vai por stdin via ficheiro temporário (run_process não liga stdin a pipes)
        let tmp = crate::tools::unique_temp("dxtutor-hook", "json");
        let _ = std::fs::write(&tmp, payload.to_string());
        let c = match &self.sandbox {
            Some(sb) => sb.wrap(&c),
            None => c,
        };
        let r = run_process_io(c, &self.root, TIMEOUT, &ctx, std::fs::File::open(&tmp).ok());
        let _ = std::fs::remove_file(&tmp);
        (r.code, r.stdout, r.stderr)
    }

    fn matching<'a>(
        list: &'a [Compiled],
        tool: &'a str,
    ) -> impl Iterator<Item = &'a Compiled> + 'a {
        list.iter()
            .filter(move |h| h.re.as_ref().is_none_or(|re| re.is_match(tool)))
    }

    /// Antes de o humano ser perguntado (H5d). Um `deny`/exit 2 ganha logo; depois um `ask` ganha a um `allow`.
    /// Devolve também avisos (hooks que falharam sem bloquear).
    pub fn pre_tool(&self, tool: &str, input: &Value) -> (PreOutcome, Vec<String>) {
        let payload = json!({ "event": "pre_tool", "tool": tool, "input": input });
        let mut notes = vec![];
        let mut verdict = PreOutcome::Allow;
        for h in Self::matching(&self.pre, tool) {
            let (code, out, err) = self.run(h, &payload, input["path"].as_str());
            match code {
                Some(0) => match decision(&out) {
                    Some((d, why)) if d == "deny" || d == "block" => {
                        return (PreOutcome::Block(why), notes)
                    }
                    Some((d, why)) if d == "ask" => verdict = PreOutcome::Ask(why),
                    Some((d, why)) if d == "allow" && verdict == PreOutcome::Allow => {
                        verdict = PreOutcome::Approve(why)
                    }
                    _ => {}
                },
                Some(2) => return (PreOutcome::Block(err.trim().to_string()), notes),
                c => notes.push(format!(
                    "hook pre_tool «{}» terminou com {c:?}: {}",
                    h.command,
                    err.trim()
                )),
            }
        }
        (verdict, notes)
    }

    /// H5d: when a session starts (`new`) or is resumed (`resume`): the hooks' output for the conversation, and
    /// notices of the ones that failed.
    pub fn session_start(&self, source: &str) -> (Option<String>, Vec<String>) {
        let payload = json!({ "event": "session_start", "source": source });
        let (mut context, mut notes) = (vec![], vec![]);
        for h in &self.session_start {
            let (code, out, err) = self.run(h, &payload, None);
            match code {
                Some(0) if !out.trim().is_empty() => context.push(out.trim().to_string()),
                Some(0) => {}
                c => notes.push(format!(
                    "hook session_start «{}» terminou com {c:?}: {}",
                    h.command,
                    err.trim()
                )),
            }
        }
        ((!context.is_empty()).then(|| context.join("\n\n")), notes)
    }

    /// H5d: when the person sends a request, before it reaches the model.
    pub fn prompt_submit(&self, prompt: &str) -> (PromptOutcome, Vec<String>) {
        let payload = json!({ "event": "prompt_submit", "prompt": prompt });
        let (mut context, mut notes) = (vec![], vec![]);
        for h in &self.prompt_submit {
            let (code, out, err) = self.run(h, &payload, None);
            match code {
                Some(2) => return (PromptOutcome::Block(err.trim().to_string()), notes),
                Some(0) if !out.trim().is_empty() => context.push(out.trim().to_string()),
                Some(0) => {}
                c => notes.push(format!(
                    "hook prompt_submit «{}» terminou com {c:?}: {}",
                    h.command,
                    err.trim()
                )),
            }
        }
        (
            PromptOutcome::Allow((!context.is_empty()).then(|| context.join("\n\n"))),
            notes,
        )
    }

    /// Depois de uma chamada. Devolve feedback para o modelo (exit 2) e avisos.
    pub fn post_tool(
        &self,
        tool: &str,
        input: &Value,
        result: &str,
        is_error: bool,
    ) -> (Option<String>, Vec<String>) {
        let payload = json!({ "event": "post_tool", "tool": tool, "input": input, "result": result, "is_error": is_error });
        let (mut feedback, mut notes) = (vec![], vec![]);
        for h in Self::matching(&self.post, tool) {
            let (code, _out, err) = self.run(h, &payload, input["path"].as_str());
            match code {
                Some(0) => {}
                Some(2) => feedback.push(err.trim().to_string()),
                c => notes.push(format!(
                    "hook post_tool «{}» terminou com {c:?}: {}",
                    h.command,
                    err.trim()
                )),
            }
        }
        ((!feedback.is_empty()).then(|| feedback.join("\n")), notes)
    }

    /// No fim do turno. Devolve as linhas de saída para mostrar como aviso.
    pub fn stop(&self) -> Vec<String> {
        let payload = json!({ "event": "stop" });
        self.stop
            .iter()
            .filter_map(|h| {
                let (code, out, err) = self.run(h, &payload, None);
                let text = if code == Some(0) {
                    out
                } else {
                    format!("{err}{out}")
                };
                let text = text.trim();
                (!text.is_empty()).then(|| format!("hook stop: {text}"))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hooks(json: &str) -> (tempfile::TempDir, Hooks) {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(d.path().join(HOOKS_FILE), json).unwrap();
        let h = Hooks::load(d.path()).unwrap().unwrap();
        (d, h)
    }

    #[cfg(unix)]
    #[test]
    fn pre_tool_blocks_on_exit_2_and_reads_the_payload() {
        let (_d, h) = hooks(
            r#"{"pre_tool":[{"match":"bash","command":"grep -q 'rm ' && { echo 'proibido apagar' >&2; exit 2; } || exit 0"},
                            {"match":"edit|write","command":"exit 7"}]}"#,
        );
        assert_eq!(
            h.pre_tool("bash", &json!({"command": "rm a.txt"})).0,
            PreOutcome::Block("proibido apagar".into())
        );
        assert_eq!(
            h.pre_tool("bash", &json!({"command": "ls"})).0,
            PreOutcome::Allow
        );
        assert_eq!(
            h.pre_tool("read", &json!({"path": "a"})),
            (PreOutcome::Allow, vec![]),
            "match não bate"
        );
        let (o, notes) = h.pre_tool("edit", &json!({"path": "a"}));
        assert_eq!(o, PreOutcome::Allow, "≠ 2 não bloqueia");
        assert_eq!(notes.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn post_tool_feedback_env_and_stop() {
        let (d, h) = hooks(
            r#"{"post_tool":[{"match":"write","command":"echo \"formata $DXTUTOR_FILE\" >&2; exit 2"}],
                "stop":[{"command":"echo terminou-$DXTUTOR_EVENT"}]}"#,
        );
        let (fb, _) = h.post_tool("write", &json!({"path": "src/a.rs"}), "criado", false);
        assert_eq!(fb.as_deref(), Some("formata src/a.rs"));
        assert_eq!(h.post_tool("read", &json!({}), "x", false), (None, vec![]));
        assert_eq!(h.stop(), vec!["hook stop: terminou-stop"]);
        drop(d);
    }

    #[cfg(unix)]
    #[test]
    fn pre_tool_decides_before_the_human_and_the_new_events() {
        let (_d, h) = hooks(
            r#"{"pre_tool":[{"match":"read","command":"echo '{\"decision\":\"allow\",\"reason\":\"leituras ok\"}'"},
                            {"match":"bash","command":"echo '{\"decision\":\"ask\",\"reason\":\"revê o comando\"}'"},
                            {"match":"bash|write","command":"grep -q secret && echo '{\"decision\":\"deny\",\"reason\":\"nada de segredos\"}' || echo ok"}],
                "session_start":[{"command":"echo \"ramo: main ($(cat | grep -o resume || echo new))\""}],
                "prompt_submit":[{"command":"grep -q 'apaga tudo' && { echo 'pedido recusado pela equipa' >&2; exit 2; } || echo 'lembra: testes primeiro'"}]}"#,
        );
        assert_eq!(
            h.pre_tool("read", &json!({"path": "a"})).0,
            PreOutcome::Approve("leituras ok".into())
        );
        assert_eq!(
            h.pre_tool("bash", &json!({"command": "ls"})).0,
            PreOutcome::Ask("revê o comando".into())
        );
        assert_eq!(
            h.pre_tool("bash", &json!({"command": "cat secret"})).0,
            PreOutcome::Block("nada de segredos".into())
        );
        assert_eq!(
            h.pre_tool("write", &json!({"path": "a"})).0,
            PreOutcome::Allow,
            "plain stdout: no opinion"
        );
        assert_eq!(
            h.session_start("resume").0.as_deref(),
            Some("ramo: main (resume)")
        );
        assert_eq!(
            h.session_start("new").0.as_deref(),
            Some("ramo: main (new)")
        );
        assert_eq!(
            h.prompt_submit("apaga tudo").0,
            PromptOutcome::Block("pedido recusado pela equipa".into())
        );
        assert_eq!(
            h.prompt_submit("faz o login").0,
            PromptOutcome::Allow(Some("lembra: testes primeiro".into()))
        );
    }

    #[test]
    fn missing_file_and_bad_regex() {
        let d = tempfile::tempdir().unwrap();
        assert!(Hooks::load(d.path()).unwrap().is_none());
        std::fs::create_dir_all(d.path().join(".dxtutor")).unwrap();
        std::fs::write(
            d.path().join(HOOKS_FILE),
            r#"{"pre_tool":[{"match":"(","command":"x"}]}"#,
        )
        .unwrap();
        assert!(Hooks::load(d.path()).is_err());
    }
}
