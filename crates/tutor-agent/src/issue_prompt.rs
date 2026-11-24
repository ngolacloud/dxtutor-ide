//! The prompt an issue goes to Co-Dev in (RF-B03/B04, docs/v2/RF-DELONIX-PLANO.md F4.3): always
//! the same template, assembled by the IDE — never typed in the chat. The project may keep its
//! own versioned template in `.dxtutor/prompts/issue.pt.md` / `issue.en.md` (only the
//! architect or the tech lead change it: `.dxtutor/` is protected from the agent); without one,
//! the built-in template below is used. Portuguese when the issue is written in Portuguese,
//! English otherwise; code, comments and commits always in English.

use std::path::Path;

/// What the template needs from the issue.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IssueData {
    pub key: String,
    pub title: String,
    pub kind: String,
    pub story_as: String,
    pub story_want: String,
    pub story_so: String,
    pub description: String,
    pub criteria: Vec<String>,
    pub scope: Vec<String>,
    /// The error of the last failed test run (RF-B07), sent with the next attempt.
    pub previous_failure: Option<String>,
}

/// The prompt as it is sent, with where it came from.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rendered {
    pub text: String,
    /// `pt` or `en`.
    pub lang: String,
    /// Where the template came from: `.dxtutor/prompts/issue.pt.md` or `builtin`.
    pub source: String,
    /// The template's version (a hash of its text): kept on the issue that ran with it.
    pub version: String,
    /// An estimate (≈ 4 characters per token); the provider's count comes with the turn.
    pub tokens: usize,
}

pub const BUILTIN_PT: &str = "# Papel
És o Co-Dev deste projecto. Segues o developer, o arquitecto e o backlog. Não decides âmbito.
Respondes em português; o código, os comentários e as mensagens de commit são sempre em inglês.

# Issue {{id}} — {{titulo}}
Como {{persona}} quero {{objectivo}} para {{valor}}.
{{descricao}}

# Critérios de aceitação
{{criterios_given_when_then}}

# Restrições do arquitecto (obrigatórias)
{{regras_arquitectura}}

# Âmbito permitido
Ficheiros/pastas: {{ambito}}. Fora disto: pede autorização.

# Contexto do código
{{ficheiros_relevantes_com_numeros_de_linha}}

# Formato da resposta
1. Plano: ficheiro + intervalo de linhas + motivo (exit_plan).
2. Patches por linha/bloco (nunca o ficheiro inteiro sem justificar).
3. Tabela critério → cumprido/não → prova (finish_issue).
4. Dúvidas, se houver — e pára (ask_human).
";

pub const BUILTIN_EN: &str = "# Role
You are this project's Co-Dev. You follow the developer, the architect and the backlog. You do not decide scope.
Code, comments and commit messages are always in English.

# Issue {{id}} — {{titulo}}
As {{persona}} I want {{objectivo}} so that {{valor}}.
{{descricao}}

# Acceptance criteria
{{criterios_given_when_then}}

# Architect's constraints (mandatory)
{{regras_arquitectura}}

# Allowed scope
Files/folders: {{ambito}}. Outside this: ask for permission.

# Code context
{{ficheiros_relevantes_com_numeros_de_linha}}

# Answer format
1. Plan: file + line range + reason (exit_plan).
2. Patches by line/block (never the whole file without a reason).
3. Table criterion → met/not met → proof (finish_issue).
4. Questions, if any — and stop (ask_human).
";

/// Is the issue written in Portuguese? Counts markers of each language in its text.
pub fn detect_lang(i: &IssueData) -> &'static str {
    let t = format!(
        " {} {} {} {} {} {} ",
        i.title,
        i.story_as,
        i.story_want,
        i.story_so,
        i.description,
        i.criteria.join(" ")
    )
    .to_lowercase();
    let pt = [
        "ç", "ã", "õ", "é", "ê", " que ", " para ", " quero", " dado ", " quando ", " então",
        " não ", " uma ", " com ", " ao ",
    ]
    .iter()
    .filter(|w| t.contains(*w))
    .count();
    let en = [
        " the ", " when ", " then ", " given ", " i want", " so that", " with ", " and ",
        " should ", " is ",
    ]
    .iter()
    .filter(|w| t.contains(*w))
    .count();
    if pt > en {
        "pt"
    } else {
        "en"
    }
}

/// A short, stable hash of a text (FNV-1a, 64 bits): the template's version.
pub fn version_of(text: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in text.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// The architect's rules for the prompt: `.dxtutor/architecture.yaml` (F5), else
/// `.dxtutor/regras.md`, else a line saying there are none.
fn architect_rules(root: &Path, lang: &str) -> String {
    for f in [
        crate::conformance::RULES_FILE,
        ".dxtutor/architecture.yaml",
        ".dxtutor/regras.md",
    ] {
        if let Ok(t) = std::fs::read_to_string(root.join(f)) {
            let t = t.trim();
            if !t.is_empty() {
                return format!("({f})\n{t}");
            }
        }
    }
    if lang == "pt" {
        "(o projecto ainda não definiu regras do arquitecto)".into()
    } else {
        "(the project has not defined architect rules yet)".into()
    }
}

/// Budgets of the code context (RF-E03 refines this with symbols and ±N lines).
const MAX_LINES_PER_FILE: usize = 200;
const MAX_CONTEXT_CHARS: usize = 16_000;
const MAX_LISTED_FILES: usize = 40;

/// The code of the scope, with line numbers: whole files (up to a budget) for paths that are
/// files, and the file list for folders and globs.
fn code_context(root: &Path, scope: &[String], lang: &str) -> String {
    let mut out = String::new();
    let mut budget = MAX_CONTEXT_CHARS;
    for s in scope {
        let s = s.trim();
        if s.is_empty() {
            continue;
        }
        let plain = !s.contains(['*', '?']);
        let p = root.join(s.trim_end_matches('/'));
        if plain && p.is_file() {
            let Ok(text) = std::fs::read_to_string(&p) else {
                continue;
            };
            let mut block = format!("{s}\n");
            for (n, line) in text.lines().enumerate().take(MAX_LINES_PER_FILE) {
                block.push_str(&format!("{:>4} │ {line}\n", n + 1));
            }
            let total = text.lines().count();
            if total > MAX_LINES_PER_FILE {
                block.push_str(&format!(
                    "     │ … (+{} linhas)\n",
                    total - MAX_LINES_PER_FILE
                ));
            }
            if block.len() > budget {
                out.push_str(&format!(
                    "{s} — (fora do orçamento de contexto; lê-o com read)\n"
                ));
                continue;
            }
            budget -= block.len();
            out.push_str(&block);
            out.push('\n');
            continue;
        }
        // folders and globs: the files that match
        let mut files: Vec<String> = ignore::WalkBuilder::new(root)
            .hidden(false)
            .build()
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
            .filter_map(|e| {
                e.path()
                    .strip_prefix(root)
                    .ok()
                    .map(|r| r.to_string_lossy().replace('\\', "/"))
            })
            .filter(|r| !r.starts_with(".git/") && crate::permissions::scope_matches(s, r))
            .collect();
        files.sort();
        let n = files.len();
        files.truncate(MAX_LISTED_FILES);
        out.push_str(&format!(
            "{s}: {}{}\n",
            files.join(", "),
            if n > MAX_LISTED_FILES {
                format!(" … (+{})", n - MAX_LISTED_FILES)
            } else {
                String::new()
            }
        ));
    }
    if out.trim().is_empty() {
        out = if lang == "pt" {
            "(sem ficheiros no âmbito; investiga com read/grep)".into()
        } else {
            "(no files in the scope; investigate with read/grep)".into()
        };
    }
    out.trim_end().to_string()
}

/// Renders the issue's prompt from the project's template (or the built-in one).
pub fn render(root: &Path, i: &IssueData, lang: Option<&str>) -> Rendered {
    let lang = match lang {
        Some("pt") => "pt",
        Some("en") => "en",
        _ => detect_lang(i),
    };
    let file = format!(".dxtutor/prompts/issue.{lang}.md");
    let (template, source) = match std::fs::read_to_string(root.join(&file)) {
        Ok(t) if !t.trim().is_empty() => (t, file),
        _ => (
            if lang == "pt" { BUILTIN_PT } else { BUILTIN_EN }.to_string(),
            "builtin".to_string(),
        ),
    };
    let dash = |s: &str| {
        if s.trim().is_empty() {
            "—".to_string()
        } else {
            s.trim().to_string()
        }
    };
    let criteria = if i.criteria.is_empty() {
        "—".to_string()
    } else {
        i.criteria
            .iter()
            .enumerate()
            .map(|(n, c)| format!("{}. {}", n + 1, c.trim()))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let mut context = code_context(root, &i.scope, lang);
    if let Some(f) = &i.previous_failure {
        let head = if lang == "pt" {
            "Tentativa anterior: os testes falharam"
        } else {
            "Previous attempt: the tests failed"
        };
        context = format!("{head} — {f}\n\n{context}");
    }
    let scope = if i.scope.is_empty() {
        "—".to_string()
    } else {
        i.scope.join(", ")
    };
    let text = template
        .replace("{{id}}", &i.key)
        .replace("{{titulo}}", &dash(&i.title))
        .replace("{{persona}}", &dash(&i.story_as))
        .replace("{{objectivo}}", &dash(&i.story_want))
        .replace("{{valor}}", &dash(&i.story_so))
        .replace("{{descricao}}", i.description.trim())
        .replace("{{criterios_given_when_then}}", &criteria)
        .replace("{{regras_arquitectura}}", &architect_rules(root, lang))
        .replace("{{ambito}}", &scope)
        .replace("{{ficheiros_relevantes_com_numeros_de_linha}}", &context);
    let tokens = text.chars().count().div_ceil(4);
    Rendered {
        version: version_of(&template),
        text,
        lang: lang.into(),
        source,
        tokens,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn issue() -> IssueData {
        IssueData {
            key: "DX-12".into(),
            title: "Paginação na API".into(),
            kind: "story".into(),
            story_as: "cliente da API".into(),
            story_want: "pedir as encomendas por páginas".into(),
            story_so: "não receber milhares de linhas".into(),
            description: String::new(),
            criteria: vec![
                "Dado 30 encomendas, quando peço a página 2 com 10, então recebo as 11–20".into(),
            ],
            scope: vec!["src/api.rs".into(), "tests/".into()],
            previous_failure: None,
        }
    }

    #[test]
    fn the_builtin_template_has_the_blocks_in_order_with_numbered_code() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        std::fs::create_dir_all(d.path().join("tests")).unwrap();
        std::fs::write(d.path().join("src/api.rs"), "fn main() {}\nfn list() {}\n").unwrap();
        std::fs::write(d.path().join("tests/api.rs"), "#[test] fn t() {}\n").unwrap();
        let r = render(d.path(), &issue(), None);
        assert_eq!(r.lang, "pt");
        assert_eq!(r.source, "builtin");
        let order = [
            "# Papel",
            "# Issue DX-12 — Paginação na API",
            "# Critérios de aceitação",
            "# Restrições do arquitecto",
            "# Âmbito permitido",
            "# Contexto do código",
            "# Formato da resposta",
        ];
        let pos: Vec<usize> = order
            .iter()
            .map(|h| r.text.find(h).unwrap_or_else(|| panic!("{h}")))
            .collect();
        assert!(pos.windows(2).all(|w| w[0] < w[1]), "{pos:?}");
        assert!(r.text.contains("Como cliente da API quero pedir as encomendas por páginas para não receber milhares de linhas."));
        assert!(r.text.contains("1. Dado 30 encomendas"));
        assert!(r.text.contains("   1 │ fn main() {}\n   2 │ fn list() {}"));
        assert!(r.text.contains("tests/: tests/api.rs"));
        assert!(r.text.contains("Ficheiros/pastas: src/api.rs, tests/."));
        assert!(r
            .text
            .contains("o código, os comentários e as mensagens de commit são sempre em inglês"));
        assert!(r.tokens > 50 && r.tokens == r.text.chars().count().div_ceil(4));
    }

    #[test]
    fn the_project_template_wins_and_its_version_changes_with_it() {
        let d = tempfile::tempdir().unwrap();
        let builtin = render(d.path(), &issue(), Some("en"));
        assert_eq!(
            (builtin.lang.as_str(), builtin.source.as_str()),
            ("en", "builtin")
        );
        assert!(builtin.text.starts_with("# Role"));
        std::fs::create_dir_all(d.path().join(".dxtutor/prompts")).unwrap();
        std::fs::write(
            d.path().join(".dxtutor/prompts/issue.pt.md"),
            "Issue {{id}}: {{titulo}}\n{{regras_arquitectura}}",
        )
        .unwrap();
        std::fs::write(
            d.path().join(".dxtutor/regras.md"),
            "Sem unwrap() em produção.",
        )
        .unwrap();
        let a = render(d.path(), &issue(), None);
        assert_eq!(a.source, ".dxtutor/prompts/issue.pt.md");
        assert_eq!(
            a.text,
            "Issue DX-12: Paginação na API\n(.dxtutor/regras.md)\nSem unwrap() em produção."
        );
        std::fs::write(d.path().join(".dxtutor/prompts/issue.pt.md"), "v2 {{id}}").unwrap();
        let b = render(d.path(), &issue(), None);
        assert_ne!(a.version, b.version);
        assert_eq!(b.version, version_of("v2 {{id}}"));
    }

    #[test]
    fn language_and_the_previous_failure() {
        let mut en = issue();
        en.title = "Paginate the API".into();
        en.story_as = "an API client".into();
        en.story_want = "to page the orders".into();
        en.story_so = "I do not get thousands of rows".into();
        en.criteria = vec!["Given 30 orders, when I ask for page 2 of 10, then I get 11-20".into()];
        assert_eq!(detect_lang(&en), "en");
        assert_eq!(detect_lang(&issue()), "pt");
        en.previous_failure = Some("test page_two failed".into());
        let r = render(Path::new("/nonexistent"), &en, None);
        assert!(r
            .text
            .contains("Previous attempt: the tests failed — test page_two failed"));
        assert!(r
            .text
            .contains("(the project has not defined architect rules yet)"));
    }
}
