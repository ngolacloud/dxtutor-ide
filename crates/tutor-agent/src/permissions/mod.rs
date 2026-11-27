//! Permissões do agente, decididas no **backend** (F3; ARCHITECTURE.md §6).
//!
//! Três camadas, por ordem:
//! 1. **Regras `deny`** do projecto/utilizador → recusa sem perguntar.
//! 2. **Piso de segurança** (não há regra que o dispense): comandos perigosos
//!    ([`shell::Risk::Dangerous`]) e edições a ficheiros protegidos (`.git/`,
//!    `.dxtutor/`, `.env`, `.ssh/`, `.github/workflows/`) perguntam sempre.
//! 3. **Regras `allow`** («permitir sempre») e o **modo** da modebar, sobre a política
//!    única de `tutor_llm::policy` (Manual pergunta edições e comandos; Assistido e Auto
//!    aplicam-nos). Refinamento do agente: no Assistido, um comando que não se prova
//!    seguro ([`shell::Risk::Unknown`]) pergunta — falha fechada.
//!
//! As leituras passam em todos os modos (salvo `deny`).

pub mod shell;

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
pub use shell::{assess, Assessment, Risk};
pub use tutor_llm::policy::CoDevMode as Mode;
use tutor_llm::policy::{approval_for, Action, Approval};

use crate::agent::PendingCall;

/// Regras persistentes: `"edit"`, `"run_tests"` (por ferramenta) ou `"bash:cargo build"`
/// (por prefixo de comando — todas as partes de um comando composto têm de bater).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Rules {
    #[serde(default)]
    pub allow: Vec<String>,
    #[serde(default)]
    pub deny: Vec<String>,
}

impl Rules {
    /// `.dxtutor/permissions.json` do projecto.
    pub fn project_file(root: &Path) -> PathBuf {
        root.join(".dxtutor").join("permissions.json")
    }

    /// `~/.config/dxtutor/permissions.json` (regras do utilizador, valem em todos os projectos).
    pub fn user_file() -> Option<PathBuf> {
        let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
        Some(PathBuf::from(home).join(".config/dxtutor/permissions.json"))
    }

    fn read(p: &Path) -> Rules {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Junta as regras do projecto e do utilizador. Carregadas **no início da sessão**:
    /// um comando que altere o ficheiro a meio não muda as permissões da sessão em curso.
    pub fn load(root: &Path, user_file: Option<&Path>) -> Rules {
        let mut r = Self::read(&Self::project_file(root));
        if let Some(u) = user_file {
            let u = Self::read(u);
            r.allow.extend(u.allow);
            r.deny.extend(u.deny);
        }
        r
    }

    /// Acrescenta uma regra `allow` ao ficheiro do projecto (sem duplicar).
    pub fn remember(root: &Path, rule: &str) -> std::io::Result<()> {
        let p = Self::project_file(root);
        let mut r = Self::read(&p);
        if !r.allow.iter().any(|x| x == rule) {
            r.allow.push(rule.to_string());
        }
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d)?;
        }
        std::fs::write(
            &p,
            serde_json::to_string_pretty(&r).unwrap_or_default() + "\n",
        )
    }
}

/// A decisão sobre uma chamada.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Verdict {
    Allow,
    /// Perguntar ao humano. `dangerous`: é o piso de segurança (não há «permitir sempre»).
    /// `suggested_rule`: a regra que «permitir sempre» gravaria.
    Ask {
        reason: String,
        dangerous: bool,
        suggested_rule: Option<String>,
    },
    Deny {
        reason: String,
    },
}

/// Ficheiros cuja alteração dá poder ao agente, corre código noutro momento ou guarda segredos.
/// What an `ide` action that asks the human will do, in one line: the action and its arguments (compact,
/// at most 300 characters) — also what the audit log keeps of the call.
pub fn ide_action_reason(input: &serde_json::Value) -> String {
    let action = input["action"].as_str().unwrap_or("?");
    let args = input
        .get("args")
        .filter(|a| a.as_object().is_some_and(|o| !o.is_empty()))
        .map(|a| a.to_string())
        .unwrap_or_default();
    let mut s = format!("ide {action} {args}");
    if s.chars().count() > 300 {
        s = s.chars().take(299).collect::<String>() + "…";
    }
    format!(
        "{}: muda um registo do projecto (aprovação e auditoria)",
        s.trim_end()
    )
}

pub fn is_protected(path: &str) -> bool {
    let p = path.trim().trim_start_matches("./").replace('\\', "/");
    let segs: Vec<&str> = p.split('/').filter(|s| !s.is_empty()).collect();
    let first = segs.first().copied().unwrap_or("");
    let file = segs.last().copied().unwrap_or("");
    first == ".git"
        // .dxtutor/ é protegido (permissões, regras), excepto a memória do projecto
        || (first == ".dxtutor" && segs.get(1) != Some(&"memory"))
        || segs.contains(&".ssh")
        || p.starts_with(".github/workflows/")
        || file == ".env"
        || file.starts_with(".env.")
}

fn split_rule(rule: &str) -> (&str, Option<&str>) {
    match rule.split_once(':') {
        Some((t, pre)) => (t.trim(), Some(pre.trim())),
        None => (rule.trim(), None),
    }
}

fn starts_with_words(cmd: &[String], prefix: &str) -> bool {
    let pre: Vec<&str> = prefix.split_whitespace().collect();
    !pre.is_empty() && cmd.len() >= pre.len() && cmd.iter().zip(&pre).all(|(a, b)| a == b)
}

/// Where a turn comes from (RF-G01): every action of the agent answers a human request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OriginKind {
    /// A message the human typed in the Co-Dev chat.
    Chat,
    /// A command the human gave in the editor (Explain, Fix, Ctrl+I…).
    Editor,
    /// An issue the human sent to Co-Dev from the board.
    Issue,
}

impl OriginKind {
    pub fn as_str(self) -> &'static str {
        match self {
            OriginKind::Chat => "chat",
            OriginKind::Editor => "editor",
            OriginKind::Issue => "issue",
        }
    }
}

/// The human request a turn answers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Origin {
    pub kind: OriginKind,
    /// The issue (`DX-12`) when the request is an issue.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
    /// Who asked (filled by the host from the project's git user, never trusted from the UI).
    #[serde(default)]
    pub by: String,
    /// Files and folders the request may change (RF-G03): `src/**`, `docs/`, `Cargo.toml`.
    /// Empty: the whole project. A change outside asks, in every mode.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scope: Vec<String>,
    /// The version of the prompt template the issue was sent with (RF-B04).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

/// The reason recorded and returned for an action with no human request (RF-G01).
pub const NO_REQUEST: &str = "bloqueada: sem pedido";

/// Does `path` (relative to the project) match the scope pattern `pat`? `dir/` and `dir/**`
/// match everything under `dir`; `*` stays inside one folder, `**` crosses folders; a plain
/// name matches that file or that folder.
pub fn scope_matches(pat: &str, path: &str) -> bool {
    let pat = pat.trim().trim_start_matches("./").replace('\\', "/");
    let path = path.trim().trim_start_matches("./").replace('\\', "/");
    if pat.is_empty() {
        return false;
    }
    if let Some(dir) = pat.strip_suffix("/**").or_else(|| pat.strip_suffix('/')) {
        if !dir.contains(['*', '?']) {
            return path == dir || path.starts_with(&format!("{dir}/"));
        }
    }
    if !pat.contains(['*', '?']) {
        return path == pat || path.starts_with(&format!("{}/", pat.trim_end_matches('/')));
    }
    let mut re = String::from("^");
    let mut chars = pat.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    chars.next();
                    re.push_str("(?:.*/)?");
                } else {
                    re.push_str(".*");
                }
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            c => re.push_str(&regex::escape(&c.to_string())),
        }
    }
    re.push('$');
    regex::Regex::new(&re).is_ok_and(|r| r.is_match(&path))
}

impl Origin {
    /// Is `path` (relative to the project) inside the request's scope?
    pub fn in_scope(&self, path: &str) -> bool {
        self.scope.is_empty() || self.scope.iter().any(|p| scope_matches(p, path))
    }
}

/// Toolset 6 gates shared with the flow tools (RF-G06/G08): whether the human approved a
/// plan in this turn, and the question the agent asked (nothing changes until it is answered).
#[derive(Clone, Default)]
pub struct Gates {
    pub plan_approved: std::sync::Arc<std::sync::atomic::AtomicBool>,
    pub question: std::sync::Arc<std::sync::Mutex<Option<String>>>,
    /// Toolset 7: the issue is finished (`finish_issue`): nothing more changes, in any mode.
    pub finished: std::sync::Arc<std::sync::Mutex<Option<serde_json::Value>>>,
}

pub struct Policy {
    pub mode: Mode,
    pub rules: Rules,
    pub root: PathBuf,
    /// Modo plano (partilhado com a ferramenta `exit_plan`): só leitura até o plano ser aprovado.
    pub plan: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// The IDE requires a human request for every action (RF-G01); the TUI and the CLI, where
    /// every turn is typed by the human, leave it off.
    pub require_origin: bool,
    /// The request the current turn answers.
    pub origin: Option<Origin>,
    /// Toolset 6 sessions: a question waits for the human, and Manual/Assist need an
    /// approved plan before changing files. `None`: older sessions, TUI, CLI.
    pub gates: Option<Gates>,
    /// H5a: the domains `web_fetch` reads without asking — the project's trusted list (`.dxtutor/sandbox.json`
    /// `allowDomains`); the person's `web_fetch:<domain>` rules add to it.
    pub web_domains: Vec<String>,
}

impl Policy {
    pub fn new(mode: Mode, rules: Rules, root: impl Into<PathBuf>) -> Self {
        Policy {
            mode,
            rules,
            root: root.into(),
            plan: Default::default(),
            require_origin: false,
            origin: None,
            gates: None,
            web_domains: vec![],
        }
    }

    /// The path of `path` relative to the project root (tools accept both forms).
    fn relative<'a>(&self, path: &'a str) -> std::borrow::Cow<'a, str> {
        let root = self.root.to_string_lossy();
        let root = root.trim_end_matches('/');
        match path.strip_prefix(root).and_then(|p| p.strip_prefix('/')) {
            Some(rel) if !root.is_empty() => std::borrow::Cow::Owned(rel.to_string()),
            _ => std::borrow::Cow::Borrowed(path),
        }
    }

    fn denied(&self, call: &PendingCall, a: Option<&Assessment>) -> Option<String> {
        for r in &self.rules.deny {
            let (tool, pre) = split_rule(r);
            match (pre, a) {
                (None, _) if tool == call.name => return Some(format!("regra deny: {r}")),
                (Some(p), Some(a))
                    if tool == "bash" && a.commands.iter().any(|c| starts_with_words(c, p)) =>
                {
                    return Some(format!("regra deny: {r}"))
                }
                _ => {}
            }
        }
        None
    }

    fn allowed(&self, call: &PendingCall, a: Option<&Assessment>) -> bool {
        let tool_rule = self
            .rules
            .allow
            .iter()
            .any(|r| split_rule(r) == (call.name.as_str(), None));
        if tool_rule {
            return true;
        }
        let Some(a) = a else { return false };
        let prefixes: Vec<&str> = self
            .rules
            .allow
            .iter()
            .filter_map(|r| match split_rule(r) {
                ("bash", Some(p)) => Some(p),
                _ => None,
            })
            .collect();
        !a.commands.is_empty()
            && a.commands
                .iter()
                .all(|c| prefixes.iter().any(|p| starts_with_words(c, p)))
    }

    fn suggest(call: &PendingCall, a: Option<&Assessment>) -> Option<String> {
        match (call.name.as_str(), a) {
            ("bash", Some(a)) => {
                let c = a.commands.first()?;
                let n = if c
                    .get(1)
                    .is_some_and(|w| !w.starts_with('-') && !w.contains('/') && !w.contains('.'))
                {
                    2
                } else {
                    1
                };
                Some(format!("bash:{}", c[..n.min(c.len())].join(" ")))
            }
            (name, _) => Some(name.to_string()),
        }
    }

    /// `web_fetch`: this machine or the internal network always asks (no «always»); a listed or allowed domain is
    /// read; another asks, offering «always» for that domain; a `web_fetch:<domain>` deny rule refuses it.
    fn web_verdict(&self, call: &PendingCall) -> Verdict {
        use crate::tools::web;
        let url = call.input["url"].as_str().unwrap_or_default().trim();
        let Some(host) = web::host_of(url) else {
            return Verdict::Deny {
                reason: "web_fetch lê só URLs http(s), sem credenciais no endereço".into(),
            };
        };
        let rule_domains = |list: &[String]| -> Vec<String> {
            list.iter()
                .filter_map(|r| match split_rule(r) {
                    (t, Some(d)) if t == web::NAME => Some(d.to_string()),
                    _ => None,
                })
                .collect()
        };
        if web::domain_listed(&rule_domains(&self.rules.deny), &host) {
            return Verdict::Deny {
                reason: format!("regra deny: {}:{host}", web::NAME),
            };
        }
        if web::is_private(&host) {
            return Verdict::Ask {
                reason: format!("ler {url}: um endereço desta máquina ou da rede interna"),
                dangerous: true,
                suggested_rule: None,
            };
        }
        let everything = self
            .rules
            .allow
            .iter()
            .any(|r| split_rule(r) == (web::NAME, None));
        if everything
            || web::domain_listed(&self.web_domains, &host)
            || web::domain_listed(&rule_domains(&self.rules.allow), &host)
        {
            return Verdict::Allow;
        }
        Self::ask(
            format!("ler {url} — {host} não está na lista de domínios do projecto"),
            Some(format!("{}:{host}", web::NAME)),
        )
    }

    fn ask(reason: impl Into<String>, suggested_rule: Option<String>) -> Verdict {
        Verdict::Ask {
            reason: reason.into(),
            dangerous: false,
            suggested_rule,
        }
    }

    pub fn decide(&self, call: &PendingCall) -> Verdict {
        let v = self.decide_rules(call);
        // H5d: a pre_tool hook's advice, after the rules: «ask» makes an allowed call ask (every mode); «allow»
        // spares the human an ordinary question — never a dangerous one, never a refusal
        match (&call.hook, v) {
            (Some(crate::agent::HookAdvice::Ask { reason }), Verdict::Allow) => Verdict::Ask {
                reason: format!("hook do projecto: {reason}"),
                dangerous: false,
                suggested_rule: None,
            },
            (
                Some(crate::agent::HookAdvice::Allow { .. }),
                Verdict::Ask {
                    dangerous: false, ..
                },
            ) => Verdict::Allow,
            (_, v) => v,
        }
    }

    fn decide_rules(&self, call: &PendingCall) -> Verdict {
        let a = call.command.as_deref().map(|c| assess(c, &self.root));
        if let Some(reason) = self.denied(call, a.as_ref()) {
            return Verdict::Deny { reason };
        }
        // H5a: reading a page is research (plan mode too, no request needed): the domain decides
        if call.name == crate::tools::web::NAME {
            return self.web_verdict(call);
        }
        if call.read_only {
            return Verdict::Allow;
        }
        // o plano proposto é sempre aprovado pelo humano
        if call.name == "exit_plan" {
            return Verdict::Ask {
                reason: "aprovar o plano proposto".into(),
                dangerous: false,
                suggested_rule: None,
            };
        }
        // RF-G01: no human request, no action (reads and proposing a plan are not actions)
        if self.require_origin && self.origin.is_none() {
            return Verdict::Deny {
                reason: NO_REQUEST.into(),
            };
        }
        if self.plan.load(std::sync::atomic::Ordering::SeqCst) {
            return Verdict::Deny {
                reason: "modo plano: só investigação (leitura). Propõe o plano com exit_plan \
                         antes de alterar alguma coisa"
                    .into(),
            };
        }
        if let Some(g) = &self.gates {
            // RF-B06/G04: after finish_issue the rest is the human's (Auto stops here too)
            if g.finished.lock().unwrap().is_some() {
                return Verdict::Deny {
                    reason: "a issue terminou (finish_issue): o resto é do humano".into(),
                };
            }
            // RF-G06: a question to the human stops every change until the answer
            if g.question.lock().unwrap().is_some() {
                return Verdict::Deny {
                    reason: "perguntaste ao humano (ask_human): espera pela resposta antes de \
                             alterar alguma coisa"
                        .into(),
                };
            }
            // RF-G08: in Manual and Assist the plan comes before changing files
            let changes_files =
                (call.input.get("path").is_some() && a.is_none()) || !call.hunks.is_empty();
            if changes_files
                && matches!(self.mode, Mode::Manual | Mode::Assist)
                && !g.plan_approved.load(std::sync::atomic::Ordering::SeqCst)
            {
                return Verdict::Deny {
                    reason: format!(
                        "modo {}: antes de alterar ficheiros apresenta o plano com exit_plan \
                         (cada ficheiro com o intervalo de linhas) e espera a aprovação",
                        if self.mode == Mode::Manual {
                            "Manual"
                        } else {
                            "Assistido"
                        }
                    ),
                };
            }
        }
        // H4: an `ide` action that changes a record of the project (an incident, a runbook step that is not
        // known to be reviewed) is always the human's call — every mode, no «allow always» (the tool said
        // which of its calls only read: those were allowed above)
        if call.name == "ide" {
            return Verdict::Ask {
                reason: ide_action_reason(&call.input),
                dangerous: false,
                suggested_rule: None,
            };
        }
        // H1: a command outside the OS sandbox is always the human's (every mode, no «allow always»)
        if call.name == "bash"
            && call.input.get("unsandboxed").and_then(|v| v.as_bool()) == Some(true)
        {
            return Verdict::Ask {
                reason: "corre fora da sandbox: com rede e com o disco inteiro".into(),
                dangerous: true,
                suggested_rule: None,
            };
        }
        let manual = approval_for(self.mode, Action::Edit) == Approval::Ask;
        // edições: piso dos ficheiros protegidos, depois regras e modo
        if let Some(path) = call
            .input
            .get("path")
            .and_then(|p| p.as_str())
            .filter(|_| a.is_none())
        {
            if is_protected(path) {
                return Verdict::Ask {
                    reason: format!(
                        "{path} é um ficheiro protegido (permissões, git, segredos ou CI)"
                    ),
                    dangerous: true,
                    suggested_rule: None,
                };
            }
            // RF-G03: outside the request's scope asks, in every mode (no «allow always»)
            if let Some(o) = &self.origin {
                let rel = self.relative(path);
                if !o.in_scope(&rel) {
                    return Verdict::Ask {
                        reason: format!(
                            "{rel} está fora do âmbito do pedido ({})",
                            o.scope.join(", ")
                        ),
                        dangerous: true,
                        suggested_rule: None,
                    };
                }
            }
        }
        if let Some(a) = &a {
            if a.risk == Risk::Dangerous {
                return Verdict::Ask {
                    reason: a.reason.clone(),
                    dangerous: true,
                    suggested_rule: None,
                };
            }
        }
        if self.allowed(call, a.as_ref()) {
            return Verdict::Allow;
        }
        let suggested = Self::suggest(call, a.as_ref());
        if manual {
            return Self::ask(
                "modo Manual: cada edição e comando é aprovado por ti",
                suggested,
            );
        }
        match (&a, self.mode) {
            (Some(a), Mode::Assist) if a.risk == Risk::Unknown => {
                Self::ask(a.reason.clone(), suggested)
            }
            // ferramentas de servidores MCP: código externo que pode mudar o mundo lá fora
            // (criar issues, enviar mensagens…). O Assistido e o Auto perguntam (RF-G02/G05);
            // uma regra «permitir sempre» do humano dispensa-o.
            (None, Mode::Assist | Mode::Auto) if call.name.starts_with("mcp__") => {
                Self::ask("ferramenta de um servidor MCP externo", suggested)
            }
            _ => Verdict::Allow,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn call(
        name: &str,
        read_only: bool,
        input: serde_json::Value,
        command: Option<&str>,
    ) -> PendingCall {
        PendingCall {
            id: "t".into(),
            name: name.into(),
            input,
            read_only,
            command: command.map(String::from),
            hunks: vec![],
            hook: None,
        }
    }
    fn bash(cmd: &str) -> PendingCall {
        call("bash", false, json!({ "command": cmd }), Some(cmd))
    }
    fn edit(path: &str) -> PendingCall {
        call("edit", false, json!({ "path": path }), None)
    }
    fn pol(mode: Mode, rules: Rules) -> Policy {
        Policy::new(mode, rules, "/tmp/ws")
    }
    fn kind(v: &Verdict) -> &'static str {
        match v {
            Verdict::Allow => "allow",
            Verdict::Ask {
                dangerous: true, ..
            } => "ask!",
            Verdict::Ask { .. } => "ask",
            Verdict::Deny { .. } => "deny",
        }
    }

    #[test]
    fn a_command_outside_the_sandbox_is_always_the_humans() {
        let out = call(
            "bash",
            false,
            json!({"command": "npm install", "unsandboxed": true}),
            Some("npm install"),
        );
        let mut rules = Rules::default();
        rules.allow.push("bash:npm install".into());
        for m in [Mode::Manual, Mode::Assist, Mode::Auto] {
            let v = pol(m, rules.clone()).decide(&out);
            assert_eq!(kind(&v), "ask!", "{m:?}");
        }
        // the same command in the sandbox follows the rules as before
        let inside = call(
            "bash",
            false,
            json!({"command": "npm install"}),
            Some("npm install"),
        );
        assert_eq!(kind(&pol(Mode::Auto, rules).decide(&inside)), "allow");
    }

    #[test]
    fn an_ide_action_that_changes_a_record_is_always_the_humans_and_a_read_runs() {
        let open = call(
            "ide",
            false,
            json!({"action": "incident.open", "args": {"title": "checkout 500s", "severity": "sev2"}}),
            None,
        );
        let mut rules = Rules::default();
        rules.allow.push("ide".into());
        for m in [Mode::Manual, Mode::Assist, Mode::Auto] {
            let v = pol(m, rules.clone()).decide(&open);
            assert_eq!(kind(&v), "ask", "{m:?}");
            let Verdict::Ask {
                reason,
                suggested_rule,
                ..
            } = v
            else {
                unreachable!()
            };
            assert!(reason.starts_with("ide incident.open {"), "{reason}");
            assert!(reason.contains("checkout 500s"));
            assert!(suggested_rule.is_none(), "no «allow always»");
        }
        // a read of the same tool runs in every mode
        let read = call("ide", true, json!({"action": "incident.list"}), None);
        for m in [Mode::Manual, Mode::Assist, Mode::Auto] {
            assert_eq!(
                kind(&pol(m, Rules::default()).decide(&read)),
                "allow",
                "{m:?}"
            );
        }
        // the plan mode lets nothing change
        let p = pol(Mode::Auto, Rules::default());
        p.plan.store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(kind(&p.decide(&open)), "deny");
        // a long argument is cut in the reason
        let long = json!({"action": "incident.add", "args": {"text": "x".repeat(2000)}});
        assert!(ide_action_reason(&long).chars().count() < 400);
    }

    #[test]
    fn a_web_page_is_read_by_its_domain() {
        let get = |url: &str| call("web_fetch", false, json!({ "url": url }), None);
        let mut p = pol(Mode::Manual, Rules::default());
        p.web_domains = vec!["docs.rs".into(), "*.python.org".into()];
        // the project's list: read at once, in every mode and in plan mode
        p.plan.store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(kind(&p.decide(&get("https://docs.rs/serde"))), "allow");
        assert_eq!(kind(&p.decide(&get("https://docs.python.org/3/"))), "allow");
        // another domain asks, offering «always» for that domain
        let v = p.decide(&get("https://example.org/a?b=1"));
        let Verdict::Ask {
            suggested_rule,
            dangerous,
            ..
        } = v
        else {
            panic!("{v:?}")
        };
        assert_eq!(suggested_rule.as_deref(), Some("web_fetch:example.org"));
        assert!(!dangerous);
        // this machine and the internal network: always, dangerous, no «always» — even with web_fetch allowed
        let mut rules = Rules::default();
        rules.allow.push("web_fetch".into());
        rules.allow.push("web_fetch:example.org".into());
        rules.deny.push("web_fetch:*.evil.test".into());
        let q = pol(Mode::Auto, rules);
        for u in [
            "http://localhost:3000/",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/",
        ] {
            assert_eq!(kind(&q.decide(&get(u))), "ask!", "{u}");
        }
        assert_eq!(kind(&q.decide(&get("https://example.org/"))), "allow");
        assert_eq!(
            kind(&q.decide(&get("https://any.where/"))),
            "allow",
            "web_fetch alone allows every public domain"
        );
        assert_eq!(kind(&q.decide(&get("https://a.evil.test/"))), "deny");
        assert_eq!(kind(&q.decide(&get("file:///etc/passwd"))), "deny");
        assert_eq!(kind(&q.decide(&get("https://u:p@example.org/"))), "deny");
    }

    #[test]
    fn a_hook_advises_after_the_rules_and_never_over_danger_or_a_refusal() {
        use crate::agent::HookAdvice;
        let with = |mut c: PendingCall, h: HookAdvice| {
            c.hook = Some(h);
            c
        };
        let ask = |r: &str| HookAdvice::Ask { reason: r.into() };
        let allow = || HookAdvice::Allow {
            reason: "ok".into(),
        };
        let p = pol(Mode::Manual, Rules::default());
        // «allow» spares an ordinary question (Manual asks for every command)
        assert_eq!(kind(&p.decide(&bash("cargo test"))), "ask");
        assert_eq!(kind(&p.decide(&with(bash("cargo test"), allow()))), "allow");
        // never a dangerous one, never a refusal
        assert_eq!(kind(&p.decide(&with(bash("rm -rf /"), allow()))), "ask!");
        let mut rules = Rules::default();
        rules.deny.push("bash:git push".into());
        let q = pol(Mode::Auto, rules);
        assert_eq!(kind(&q.decide(&with(bash("git push"), allow()))), "deny");
        // «ask» makes an allowed call ask, in Auto too, with the hook's reason
        let r = pol(Mode::Auto, Rules::default());
        let read = call("read", true, json!({"path": "a"}), None);
        assert_eq!(kind(&r.decide(&read)), "allow");
        let v = r.decide(&with(read, ask("lê só com aprovação")));
        let Verdict::Ask { reason, .. } = v else {
            panic!("{v:?}")
        };
        assert_eq!(reason, "hook do projecto: lê só com aprovação");
    }

    #[test]
    fn mode_matrix() {
        let read = call("read", true, json!({"path": "a"}), None);
        let cases: &[(&PendingCall, [&str; 3])] = &[
            (&read, ["allow", "allow", "allow"]),
            (&edit("src/a.rs"), ["ask", "allow", "allow"]),
            (&bash("cargo test"), ["ask", "allow", "allow"]),
            (&bash("npm run build"), ["ask", "ask", "allow"]),
            (&bash("rm -rf target"), ["ask!", "ask!", "ask!"]),
            (&bash("git push"), ["ask!", "ask!", "ask!"]),
            (&edit(".dxtutor/permissions.json"), ["ask!", "ask!", "ask!"]),
            (&edit(".git/hooks/pre-commit"), ["ask!", "ask!", "ask!"]),
            (&edit("config/.env.local"), ["ask!", "ask!", "ask!"]),
        ];
        for (c, want) in cases {
            for (i, m) in [Mode::Manual, Mode::Assist, Mode::Auto]
                .into_iter()
                .enumerate()
            {
                assert_eq!(
                    kind(&pol(m, Rules::default()).decide(c)),
                    want[i],
                    "{} {:?} em {:?}",
                    c.name,
                    c.command,
                    m
                );
            }
        }
    }

    #[test]
    fn rules_allow_deny_and_the_floor() {
        let rules = Rules {
            allow: vec![
                "bash:npm run build".into(),
                "bash:npm test".into(),
                "edit".into(),
                "bash:rm".into(),
            ],
            deny: vec!["bash:curl".into(), "write".into()],
        };
        let p = pol(Mode::Manual, rules);
        assert_eq!(kind(&p.decide(&bash("npm run build --prod"))), "allow");
        assert_eq!(kind(&p.decide(&bash("npm run build && npm test"))), "allow");
        assert_eq!(
            kind(&p.decide(&bash("npm run build && make"))),
            "ask",
            "todas as partes têm de bater"
        );
        assert_eq!(kind(&p.decide(&edit("src/a.rs"))), "allow");
        assert_eq!(kind(&p.decide(&bash("ls && curl x"))), "deny");
        assert_eq!(
            kind(&p.decide(&call("write", false, json!({"path": "x"}), None))),
            "deny"
        );
        // nenhuma regra dispensa o piso
        assert_eq!(kind(&p.decide(&bash("rm -rf /tmp/ws/src"))), "ask!");
        assert_eq!(kind(&p.decide(&edit(".git/config"))), "ask!");
    }

    #[test]
    fn suggested_rules() {
        let p = pol(Mode::Manual, Rules::default());
        let s = |c: &PendingCall| match p.decide(c) {
            Verdict::Ask { suggested_rule, .. } => suggested_rule,
            _ => None,
        };
        assert_eq!(
            s(&bash("cargo build --release")),
            Some("bash:cargo build".into())
        );
        assert_eq!(s(&bash("make -j8")), Some("bash:make".into()));
        assert_eq!(
            s(&bash("./scripts/x.sh")),
            Some("bash:./scripts/x.sh".into())
        );
        assert_eq!(s(&edit("src/a.rs")), Some("edit".into()));
        assert_eq!(
            s(&bash("git push")),
            None,
            "perigoso: sem «permitir sempre»"
        );
    }

    #[test]
    fn rules_load_merge_and_remember() {
        let d = tempfile::tempdir().unwrap();
        let user = d.path().join("user.json");
        std::fs::write(&user, r#"{"allow":["bash:make"],"deny":["bash:curl"]}"#).unwrap();
        assert_eq!(Rules::load(d.path(), Some(&user)).allow, vec!["bash:make"]);
        Rules::remember(d.path(), "bash:cargo build").unwrap();
        Rules::remember(d.path(), "bash:cargo build").unwrap();
        let r = Rules::load(d.path(), Some(&user));
        assert_eq!(r.allow, vec!["bash:cargo build", "bash:make"]);
        assert_eq!(r.deny, vec!["bash:curl"]);
        // ficheiro inválido = sem regras (não rebenta a sessão)
        std::fs::write(Rules::project_file(d.path()), "{nope").unwrap();
        assert_eq!(Rules::load(d.path(), None), Rules::default());
    }

    #[test]
    fn plan_mode_allows_reads_denies_changes_and_asks_for_the_plan() {
        let p = pol(Mode::Auto, Rules::default());
        p.plan.store(true, std::sync::atomic::Ordering::SeqCst);
        let read = call("read", true, json!({"path": "a"}), None);
        let plan = call("exit_plan", false, json!({"plan": "x"}), None);
        assert_eq!(kind(&p.decide(&read)), "allow");
        assert_eq!(kind(&p.decide(&edit("src/a.rs"))), "deny");
        assert_eq!(kind(&p.decide(&bash("cargo test"))), "deny");
        assert_eq!(kind(&p.decide(&plan)), "ask");
        p.plan.store(false, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(kind(&p.decide(&edit("src/a.rs"))), "allow");
        assert_eq!(kind(&p.decide(&plan)), "ask");
    }

    #[test]
    fn mcp_tools_ask_in_assist_and_can_be_always_allowed() {
        let mcp = call(
            "mcp__github__create_issue",
            false,
            json!({"title": "x"}),
            None,
        );
        assert_eq!(
            kind(&pol(Mode::Assist, Rules::default()).decide(&mcp)),
            "ask"
        );
        // RF-G02/G05 (F1.5): Auto asks too — an MCP tool may create issues or send messages
        assert_eq!(kind(&pol(Mode::Auto, Rules::default()).decide(&mcp)), "ask");
        assert_eq!(
            kind(&pol(Mode::Manual, Rules::default()).decide(&mcp)),
            "ask"
        );
        let rules = Rules {
            allow: vec!["mcp__github__create_issue".into()],
            deny: vec![],
        };
        assert_eq!(
            kind(&pol(Mode::Assist, rules.clone()).decide(&mcp)),
            "allow"
        );
        assert_eq!(kind(&pol(Mode::Auto, rules).decide(&mcp)), "allow");
    }

    #[test]
    fn protected_paths() {
        for p in [
            ".git/config",
            "./.dxtutor/permissions.json",
            ".env",
            "app/.env.production",
            "x/.ssh/id_rsa",
            ".github/workflows/ci.yml",
        ] {
            assert!(is_protected(p), "{p}");
        }
        for p in [
            "src/env.rs",
            ".dxtutor/memory/decisoes.md",
            ".gitignore",
            "docs/.envrc.md",
            ".github/CODEOWNERS",
            "dxtutor/a",
        ] {
            assert!(!is_protected(p), "{p}");
        }
    }

    fn origin(kind: OriginKind, scope: &[&str]) -> Origin {
        Origin {
            kind,
            issue: None,
            by: "ana".into(),
            scope: scope.iter().map(|s| s.to_string()).collect(),
            template: None,
        }
    }

    #[test]
    fn without_a_human_request_nothing_changes_but_reads_and_plans_go_on() {
        let mut p = Policy::new(Mode::Auto, Rules::default(), "/p");
        p.require_origin = true;
        let edit = call("edit", false, json!({"path": "src/a.rs"}), None);
        assert_eq!(
            p.decide(&edit),
            Verdict::Deny {
                reason: NO_REQUEST.into()
            }
        );
        let bash = call("bash", false, json!({}), Some("cargo build"));
        assert!(matches!(p.decide(&bash), Verdict::Deny { reason } if reason == NO_REQUEST));
        assert_eq!(
            p.decide(&call("read", true, json!({"path": "a"}), None)),
            Verdict::Allow
        );
        assert!(matches!(
            p.decide(&call("exit_plan", false, json!({}), None)),
            Verdict::Ask { .. }
        ));
        // with a request, Auto applies as before
        p.origin = Some(origin(OriginKind::Chat, &[]));
        assert_eq!(p.decide(&edit), Verdict::Allow);
        // the TUI/CLI never require one
        let q = Policy::new(Mode::Auto, Rules::default(), "/p");
        assert_eq!(q.decide(&edit), Verdict::Allow);
    }

    #[test]
    fn outside_the_scope_asks_even_in_auto_and_cannot_be_always_allowed() {
        let mut p = Policy::new(
            Mode::Auto,
            Rules {
                allow: vec!["edit".into()],
                deny: vec![],
            },
            "/p",
        );
        p.require_origin = true;
        p.origin = Some(origin(OriginKind::Issue, &["src/**", "Cargo.toml"]));
        let at = |path: &str| call("edit", false, json!({ "path": path }), None);
        assert_eq!(p.decide(&at("src/lexer/mod.rs")), Verdict::Allow);
        assert_eq!(p.decide(&at("/p/src/lib.rs")), Verdict::Allow);
        assert_eq!(p.decide(&at("Cargo.toml")), Verdict::Allow);
        match p.decide(&at("docs/README.md")) {
            Verdict::Ask {
                reason,
                dangerous,
                suggested_rule,
            } => {
                assert!(
                    reason.contains("docs/README.md") && reason.contains("fora do âmbito"),
                    "{reason}"
                );
                assert!(dangerous && suggested_rule.is_none());
            }
            v => panic!("{v:?}"),
        }
    }

    #[test]
    fn scope_patterns() {
        for (pat, path, ok) in [
            ("src/**", "src/a/b.rs", true),
            ("src/**", "src", true),
            ("src/", "src/x.rs", true),
            ("src", "src/x.rs", true),
            ("src", "srcx/x.rs", false),
            ("Cargo.toml", "Cargo.toml", true),
            ("Cargo.toml", "crates/a/Cargo.toml", false),
            ("*.md", "README.md", true),
            ("*.md", "docs/a.md", false),
            ("**/*.md", "docs/a.md", true),
            ("**/*.md", "README.md", true),
            ("crates/*/src/**", "crates/core/src/lib.rs", true),
            ("crates/*/src/**", "crates/core/tests/a.rs", false),
            ("./ui/", "ui/app.ts", true),
        ] {
            assert_eq!(scope_matches(pat, path), ok, "{pat} vs {path}");
        }
    }

    #[test]
    fn toolset_6_gates_plan_first_and_a_question_stops_changes() {
        let g = Gates::default();
        let mut p = Policy::new(Mode::Assist, Rules::default(), "/p");
        p.gates = Some(g.clone());
        let edit = call("edit", false, json!({"path": "src/a.rs"}), None);
        let test = call("bash", false, json!({}), Some("cargo test"));
        match p.decide(&edit) {
            Verdict::Deny { reason } => assert!(reason.contains("exit_plan"), "{reason}"),
            v => panic!("{v:?}"),
        }
        // commands and questions do not need a plan
        assert_eq!(p.decide(&test), Verdict::Allow);
        assert_eq!(
            p.decide(&call("ask_human", true, json!({"question": "?"}), None)),
            Verdict::Allow
        );
        g.plan_approved
            .store(true, std::sync::atomic::Ordering::SeqCst);
        assert_eq!(p.decide(&edit), Verdict::Allow);
        // Auto never needed one
        let mut q = Policy::new(Mode::Auto, Rules::default(), "/p");
        q.gates = Some(Gates::default());
        assert_eq!(q.decide(&edit), Verdict::Allow);
        // a pending question stops changes and commands, not reads
        *g.question.lock().unwrap() = Some("qual?".into());
        assert!(
            matches!(p.decide(&edit), Verdict::Deny { reason } if reason.contains("ask_human"))
        );
        assert!(matches!(p.decide(&test), Verdict::Deny { .. }));
        assert_eq!(
            p.decide(&call("read", true, json!({"path": "a"}), None)),
            Verdict::Allow
        );
    }
}
