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

pub struct Policy {
    pub mode: Mode,
    pub rules: Rules,
    pub root: PathBuf,
    /// Modo plano (partilhado com a ferramenta `exit_plan`): só leitura até o plano ser aprovado.
    pub plan: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl Policy {
    pub fn new(mode: Mode, rules: Rules, root: impl Into<PathBuf>) -> Self {
        Policy {
            mode,
            rules,
            root: root.into(),
            plan: Default::default(),
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

    fn ask(reason: impl Into<String>, suggested_rule: Option<String>) -> Verdict {
        Verdict::Ask {
            reason: reason.into(),
            dangerous: false,
            suggested_rule,
        }
    }

    pub fn decide(&self, call: &PendingCall) -> Verdict {
        let a = call.command.as_deref().map(|c| assess(c, &self.root));
        if let Some(reason) = self.denied(call, a.as_ref()) {
            return Verdict::Deny { reason };
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
        if self.plan.load(std::sync::atomic::Ordering::SeqCst) {
            return Verdict::Deny {
                reason: "modo plano: só investigação (leitura). Propõe o plano com exit_plan \
                         antes de alterar alguma coisa"
                    .into(),
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
}
