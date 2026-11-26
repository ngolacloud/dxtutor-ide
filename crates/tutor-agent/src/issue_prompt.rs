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
    /// Where the issue lives in the project (backlog phase 1, docs/v2/QUESTIONS.md Q3): its
    /// branch, epic, component, dependencies, linked commits and the files already changed for it.
    pub links: IssueLinks,
}

/// What the agent knows of the issue beyond its text: where it lives in the project. Kept short
/// (each list is capped when rendered) — never diffs, only names.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IssueLinks {
    pub branch: Option<String>,
    pub epic: String,
    /// The Studio component the issue belongs to (none is stored yet: phase 4).
    pub component: Option<String>,
    /// The issues that must be Done first, with their title and state.
    pub deps: Vec<DepRef>,
    /// The commits linked to the issue (`issue_links` of kind `commit`), newest first.
    pub commits: Vec<CommitRef>,
    /// The files Co-Dev already changed for the issue (its change sets), most recent first.
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct DepRef {
    pub key: String,
    pub title: String,
    pub state: String,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct CommitRef {
    pub sha: String,
    pub subject: String,
}

/// Caps of the issue's links in the prompt (token-aware).
const MAX_DEPS: usize = 8;
const MAX_COMMITS: usize = 8;
const MAX_FILES: usize = 20;
const MAX_SUBJECT: usize = 80;

/// `a, b, c … (+n)` for at most `cap` items.
fn capped(items: &[String], cap: usize) -> String {
    let mut s = items
        .iter()
        .take(cap)
        .cloned()
        .collect::<Vec<_>>()
        .join(", ");
    if items.len() > cap {
        s.push_str(&format!(" … (+{})", items.len() - cap));
    }
    s
}

/// The «Issue links» block: one line per thing the project knows (branch, epic, component,
/// dependencies, commits, files), each list capped; a line saying there is nothing otherwise.
pub fn links_block(l: &IssueLinks, lang: &str) -> String {
    let pt = lang == "pt";
    let mut out: Vec<String> = Vec::new();
    if let Some(b) = l.branch.as_deref().map(str::trim).filter(|b| !b.is_empty()) {
        out.push(format!("{}: {b}", if pt { "Ramo" } else { "Branch" }));
    }
    if !l.epic.trim().is_empty() {
        out.push(format!(
            "{}: {}",
            if pt { "Épico" } else { "Epic" },
            l.epic.trim()
        ));
    }
    if let Some(c) = l
        .component
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        out.push(format!(
            "{}: {c}",
            if pt { "Componente" } else { "Component" }
        ));
    }
    if !l.deps.is_empty() {
        let deps: Vec<String> = l
            .deps
            .iter()
            .map(|d| {
                let title = d.title.trim();
                let state = if d.state.is_empty() {
                    "?"
                } else {
                    d.state.as_str()
                };
                if title.is_empty() {
                    format!("{} ({state})", d.key)
                } else {
                    format!("{} {title} ({state})", d.key)
                }
            })
            .collect();
        out.push(format!(
            "{}: {}",
            if pt { "Depende de" } else { "Depends on" },
            capped(&deps, MAX_DEPS)
        ));
    }
    if !l.commits.is_empty() {
        let head = match (pt, l.commits.len() > MAX_COMMITS) {
            (true, true) => format!(
                "Commits ligados (os {MAX_COMMITS} mais recentes de {})",
                l.commits.len()
            ),
            (true, false) => "Commits ligados".to_string(),
            (false, true) => format!(
                "Linked commits (the latest {MAX_COMMITS} of {})",
                l.commits.len()
            ),
            (false, false) => "Linked commits".to_string(),
        };
        out.push(format!("{head}:"));
        for c in l.commits.iter().take(MAX_COMMITS) {
            let sha: String = c.sha.chars().take(7).collect();
            let mut subject: String = c.subject.trim().chars().take(MAX_SUBJECT).collect();
            if c.subject.trim().chars().count() > MAX_SUBJECT {
                subject.push('…');
            }
            out.push(format!("- {sha} {subject}"));
        }
    }
    if !l.files.is_empty() {
        out.push(format!(
            "{}: {}",
            if pt {
                "Ficheiros já alterados nesta issue"
            } else {
                "Files already changed for this issue"
            },
            capped(&l.files, MAX_FILES)
        ));
    }
    if out.is_empty() {
        return if pt {
            "(sem ramo, épico, dependências nem commits ligados)".into()
        } else {
            "(no branch, epic, dependencies or linked commits)".into()
        };
    }
    out.join("\n")
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
    /// The template's own text (before filling): what «Edit template» starts the project's file
    /// from when the built-in one is in use.
    pub template: String,
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

# Ligações da issue
{{ligacoes_da_issue}}

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

# Issue links
{{ligacoes_da_issue}}

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

/// Budgets of the code context (RF-E03): about 4 000 tokens of code (≈ 4 characters a token).
const MAX_LINES_PER_FILE: usize = 200;
const MAX_CONTEXT_CHARS: usize = 16_000;
const MAX_LISTED_FILES: usize = 40;
/// Files of a folder or glob read to look for the symbols the issue mentions.
const MAX_SCANNED_FILES: usize = 400;
const MAX_SCANNED_BYTES: u64 = 512 * 1024;
/// The lines shown around a symbol (RF-E03: «±N lines»).
pub const CONTEXT_LINES: usize = 5;
/// A symbol longer than this is cut (its outline line still gives the whole range).
const MAX_SYMBOL_LINES: usize = 80;
/// An anchor (a symbol the outline only knows by its first line) runs to the next symbol, at most this.
const ANCHOR_SPAN: usize = 40;
const MAX_OUTLINE_ENTRIES: usize = 30;

/// One symbol of a file with its 1-based, inclusive line range, as the caller's outline gives it
/// (the IDE passes its syntax map: `tutor-agent` does not parse languages). `end == start` is an
/// anchor: only the definition line is known.
#[derive(Debug, Clone, PartialEq)]
pub struct Symbol {
    pub name: String,
    pub kind: String,
    pub start: usize,
    pub end: usize,
}

/// The symbols of a file (`path` relative to the project, and its text); empty when the file's
/// language is not known.
pub type Outliner<'a> = &'a dyn Fn(&str, &str) -> Vec<Symbol>;

/// Is `c` part of an identifier?
fn ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Does the issue's text point at the symbol `name`? In backticks (`` `parse` ``,
/// `` `Lexer::next()` ``), called (`parse(`), or — for a name that only an identifier would have
/// (`parse_header`, `parseHeader`, `TokenStream`) — anywhere as a whole word. A plain word such as
/// «new» or «list» in the prose does not count.
pub fn mentions(text: &str, name: &str) -> bool {
    if name.chars().count() < 2 || !name.chars().all(ident_char) {
        return false;
    }
    let identifier_like = name.contains('_') || name.chars().skip(1).any(|c| c.is_uppercase());
    let ticked: Vec<&str> = text.split('`').skip(1).step_by(2).collect();
    let words = |t: &str| -> Vec<usize> {
        t.match_indices(name)
            .filter(|(i, _)| {
                let before = t[..*i].chars().next_back();
                let after = t[i + name.len()..].chars().next();
                !before.is_some_and(ident_char) && !after.is_some_and(ident_char)
            })
            .map(|(i, _)| i)
            .collect()
    };
    if ticked.iter().any(|t| !words(t).is_empty()) {
        return true;
    }
    let at = words(text);
    identifier_like && !at.is_empty() || at.iter().any(|i| text[i + name.len()..].starts_with('('))
}

/// The ranges of `syms` with anchors run to the next symbol (sorted by start).
fn spans(syms: &[Symbol], total: usize) -> Vec<Symbol> {
    let mut v: Vec<Symbol> = syms
        .iter()
        .filter(|s| s.start >= 1 && s.start <= total)
        .cloned()
        .collect();
    v.sort_by_key(|s| (s.start, s.end));
    let starts: Vec<usize> = v.iter().map(|s| s.start).collect();
    for s in &mut v {
        if s.end <= s.start {
            let next = starts
                .iter()
                .copied()
                .find(|&n| n > s.start)
                .unwrap_or(total + 1);
            s.end = (next - 1).min(s.start + ANCHOR_SPAN - 1).max(s.start);
        }
        s.end = s.end.min(total);
    }
    v
}

fn sym_label(s: &Symbol) -> String {
    let range = if s.end > s.start {
        format!("{}–{}", s.start, s.end)
    } else {
        s.start.to_string()
    };
    if s.kind.is_empty() {
        format!("{range} ({})", s.name)
    } else {
        format!("{range} ({} {})", s.kind, s.name)
    }
}

/// `other symbols: 1–20 (struct Lexer), …` — where the rest of a file is.
fn outline_line(syms: &[Symbol], lang: &str) -> String {
    if syms.is_empty() {
        return String::new();
    }
    let mut parts: Vec<String> = syms
        .iter()
        .take(MAX_OUTLINE_ENTRIES)
        .map(sym_label)
        .collect();
    if syms.len() > MAX_OUTLINE_ENTRIES {
        parts.push(format!("… (+{})", syms.len() - MAX_OUTLINE_ENTRIES));
    }
    let head = if lang == "pt" {
        "outros símbolos"
    } else {
        "other symbols"
    };
    format!("     │ {head}: {}\n", parts.join(", "))
}

/// The excerpts of `chosen` (±N lines, merged when they meet), with line numbers, under a header
/// that names each symbol and its range; then where the other symbols are.
fn excerpts(rel: &str, lines: &[&str], chosen: &[Symbol], others: &[Symbol], lang: &str) -> String {
    let total = lines.len();
    let mut windows: Vec<(usize, usize)> = chosen
        .iter()
        .map(|s| {
            let end = s.end.min(s.start + MAX_SYMBOL_LINES - 1);
            (
                s.start.saturating_sub(CONTEXT_LINES).max(1),
                (end + CONTEXT_LINES).min(total),
            )
        })
        .collect();
    windows.sort();
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (a, b) in windows {
        match merged.last_mut() {
            Some(last) if a <= last.1 + 1 => last.1 = last.1.max(b),
            _ => merged.push((a, b)),
        }
    }
    let what = if lang == "pt" {
        format!("trechos ±{CONTEXT_LINES} linhas")
    } else {
        format!("excerpts ±{CONTEXT_LINES} lines")
    };
    let mut block = format!(
        "{rel}: {} — {what}\n",
        chosen.iter().map(sym_label).collect::<Vec<_>>().join(", ")
    );
    for (k, (a, b)) in merged.iter().enumerate() {
        if k > 0 || *a > 1 {
            block.push_str("     │ …\n");
        }
        for (n, line) in lines.iter().enumerate().take(*b).skip(a - 1) {
            block.push_str(&format!("{:>4} │ {line}\n", n + 1));
        }
    }
    if merged.last().is_some_and(|(_, b)| *b < total) {
        block.push_str("     │ …\n");
    }
    block.push_str(&outline_line(others, lang));
    block
}

/// The whole file (up to `MAX_LINES_PER_FILE` lines) with line numbers; when it is cut, where the
/// symbols past the cut are.
fn whole_file(rel: &str, lines: &[&str], syms: &[Symbol], lang: &str) -> String {
    let mut block = format!("{rel}\n");
    for (n, line) in lines.iter().enumerate().take(MAX_LINES_PER_FILE) {
        block.push_str(&format!("{:>4} │ {line}\n", n + 1));
    }
    if lines.len() > MAX_LINES_PER_FILE {
        let more = lines.len() - MAX_LINES_PER_FILE;
        block.push_str(&if lang == "pt" {
            format!("     │ … (+{more} linhas)\n")
        } else {
            format!("     │ … (+{more} lines)\n")
        });
        let past: Vec<Symbol> = syms
            .iter()
            .filter(|s| s.start > MAX_LINES_PER_FILE)
            .cloned()
            .collect();
        block.push_str(&outline_line(&past, lang));
    }
    block
}

/// The code of the scope, with line numbers (RF-E03, docs/v2/RF-DELONIX-PLANO.md F2.3), inside a
/// budget of about 4 000 tokens:
/// - a file of the scope that is short goes whole;
/// - a long one (or one past the budget) goes as the excerpts of the symbols the issue mentions,
///   ±N lines, with where its other symbols are — or, when the issue mentions none, its first
///   lines and where the rest is;
/// - a folder or a glob gives its file list and the excerpts of the mentioned symbols in it.
fn code_context(
    root: &Path,
    scope: &[String],
    lang: &str,
    issue_text: &str,
    outline: Outliner,
) -> String {
    let mut out = String::new();
    let mut budget = MAX_CONTEXT_CHARS;
    let push = |out: &mut String, block: String, budget: &mut usize| -> bool {
        if block.len() > *budget {
            return false;
        }
        *budget -= block.len();
        out.push_str(&block);
        out.push('\n');
        true
    };
    let mentioned = |syms: &[Symbol]| -> (Vec<Symbol>, Vec<Symbol>) {
        syms.iter()
            .cloned()
            .partition(|s| mentions(issue_text, &s.name))
    };
    let mut shown: std::collections::HashSet<String> = std::collections::HashSet::new();
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
            shown.insert(s.to_string());
            let lines: Vec<&str> = text.lines().collect();
            let syms = spans(&outline(s, &text), lines.len());
            let (chosen, others) = mentioned(&syms);
            let whole = whole_file(s, &lines, &syms, lang);
            let fits = lines.len() <= MAX_LINES_PER_FILE && whole.len() <= budget;
            let block = if fits {
                whole
            } else if !chosen.is_empty() {
                excerpts(s, &lines, &chosen, &others, lang)
            } else {
                whole
            };
            if !push(&mut out, block, &mut budget) {
                // past the budget: at least where its symbols are
                let gone = if lang == "pt" {
                    "fora do orçamento de contexto; lê-o com read"
                } else {
                    "past the context budget; read it with read"
                };
                let mut line = format!("{s} — ({gone})\n");
                line.push_str(&outline_line(&syms, lang));
                if !push(&mut out, line.clone(), &mut budget) {
                    out.push_str(&format!("{s} — ({gone})\n"));
                }
            }
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
        out.push_str(&format!(
            "{s}: {}{}\n",
            files
                .iter()
                .take(MAX_LISTED_FILES)
                .cloned()
                .collect::<Vec<_>>()
                .join(", "),
            if n > MAX_LISTED_FILES {
                format!(" … (+{})", n - MAX_LISTED_FILES)
            } else {
                String::new()
            }
        ));
        // the symbols the issue mentions, in the files of the folder
        for f in files.iter().take(MAX_SCANNED_FILES) {
            if shown.contains(f)
                || std::fs::metadata(root.join(f)).map_or(true, |m| m.len() > MAX_SCANNED_BYTES)
            {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(root.join(f)) else {
                continue;
            };
            let lines: Vec<&str> = text.lines().collect();
            let syms = spans(&outline(f, &text), lines.len());
            let (chosen, _) = mentioned(&syms);
            if chosen.is_empty() {
                continue;
            }
            shown.insert(f.clone());
            let block = excerpts(f, &lines, &chosen, &[], lang);
            if !push(&mut out, block, &mut budget) {
                break;
            }
        }
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

/// Renders the issue's prompt from the project's template (or the built-in one), with no symbol
/// outline (whole files and file lists only).
pub fn render(root: &Path, i: &IssueData, lang: Option<&str>) -> Rendered {
    render_with(root, i, lang, &|_, _| Vec::new())
}

/// Renders the issue's prompt; `outline` gives the symbols of a file, for the excerpts of the
/// symbols the issue mentions (RF-E03).
pub fn render_with(root: &Path, i: &IssueData, lang: Option<&str>, outline: Outliner) -> Rendered {
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
    let issue_text = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        i.title,
        i.story_as,
        i.story_want,
        i.story_so,
        i.description,
        i.criteria.join("\n")
    );
    let mut context = code_context(root, &i.scope, lang, &issue_text, outline);
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
    // a project template written before the links existed still gets them, above the code
    let links = links_block(&i.links, lang);
    if !template.contains("{{ligacoes_da_issue}}") && i.links != IssueLinks::default() {
        let head = if lang == "pt" {
            "Ligações da issue"
        } else {
            "Issue links"
        };
        context = format!("{head}:\n{links}\n\n{context}");
    }
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
        .replace("{{ligacoes_da_issue}}", &links)
        .replace("{{ficheiros_relevantes_com_numeros_de_linha}}", &context);
    let tokens = text.chars().count().div_ceil(4);
    Rendered {
        version: version_of(&template),
        template,
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
            links: IssueLinks::default(),
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
            "# Ligações da issue",
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
        assert!(r.text.contains(
            "# Ligações da issue\n(sem ramo, épico, dependências nem commits ligados)\n"
        ));
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
        // «Edit template» starts the project's file from the built-in text, placeholders and all
        assert_eq!(builtin.template, BUILTIN_EN);
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
        assert_eq!(b.template, "v2 {{id}}");
    }

    fn links() -> IssueLinks {
        IssueLinks {
            branch: Some("feature/DX-12-paginacao".into()),
            epic: "Encomendas".into(),
            component: None,
            deps: vec![
                DepRef {
                    key: "DX-3".into(),
                    title: "Modelo de encomendas".into(),
                    state: "done".into(),
                },
                DepRef {
                    key: "DX-5".into(),
                    title: String::new(),
                    state: "progress".into(),
                },
            ],
            commits: (0..10)
                .map(|n| CommitRef {
                    sha: format!("{n:02}a1b2c3d4e5f6"),
                    subject: format!("feat: page {n} (DX-12)"),
                })
                .collect(),
            files: vec!["src/api.rs".into(), "tests/api.rs".into()],
        }
    }

    #[test]
    fn the_issue_links_go_in_their_own_block_capped() {
        let d = tempfile::tempdir().unwrap();
        let mut i = issue();
        i.links = links();
        let r = render(d.path(), &i, None);
        let block = r
            .text
            .split("# Ligações da issue\n")
            .nth(1)
            .and_then(|t| t.split("\n\n# ").next())
            .unwrap();
        assert_eq!(
            block,
            "Ramo: feature/DX-12-paginacao\n\
             Épico: Encomendas\n\
             Depende de: DX-3 Modelo de encomendas (done), DX-5 (progress)\n\
             Commits ligados (os 8 mais recentes de 10):\n\
             - 00a1b2c feat: page 0 (DX-12)\n\
             - 01a1b2c feat: page 1 (DX-12)\n\
             - 02a1b2c feat: page 2 (DX-12)\n\
             - 03a1b2c feat: page 3 (DX-12)\n\
             - 04a1b2c feat: page 4 (DX-12)\n\
             - 05a1b2c feat: page 5 (DX-12)\n\
             - 06a1b2c feat: page 6 (DX-12)\n\
             - 07a1b2c feat: page 7 (DX-12)\n\
             Ficheiros já alterados nesta issue: src/api.rs, tests/api.rs"
        );
        let mut l = links();
        l.component = Some("orders-api".into());
        l.commits.truncate(1);
        l.files = (0..25).map(|n| format!("f{n}.rs")).collect();
        let en = links_block(&l, "en");
        assert!(en.contains(
            "Branch: feature/DX-12-paginacao\nEpic: Encomendas\nComponent: orders-api\n"
        ));
        assert!(en.contains("Linked commits:\n- 00a1b2c feat: page 0 (DX-12)\n"));
        assert!(en.ends_with("f19.rs … (+5)"), "{en}");
        assert_eq!(
            links_block(&IssueLinks::default(), "en"),
            "(no branch, epic, dependencies or linked commits)"
        );
    }

    #[test]
    fn a_project_template_without_the_links_placeholder_gets_them_above_the_code() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".dxtutor/prompts")).unwrap();
        std::fs::write(
            d.path().join(".dxtutor/prompts/issue.pt.md"),
            "{{id}}\n{{ficheiros_relevantes_com_numeros_de_linha}}",
        )
        .unwrap();
        let mut i = issue();
        i.scope.clear();
        i.links = IssueLinks {
            branch: Some("feature/x".into()),
            ..Default::default()
        };
        let r = render(d.path(), &i, None);
        assert!(
            r.text
                .starts_with("DX-12\nLigações da issue:\nRamo: feature/x\n\n(sem ficheiros"),
            "{}",
            r.text
        );
        // without links, nothing is added
        i.links = IssueLinks::default();
        assert!(!render(d.path(), &i, None).text.contains("Ligações"));
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
    /// A syntax map for the tests: `fn name` starts a symbol that ends at the next line that is
    /// exactly `}` (Rust-like); `def name` is an anchor (Python-like, only the first line).
    fn toy_outline(_path: &str, code: &str) -> Vec<Symbol> {
        let lines: Vec<&str> = code.lines().collect();
        let mut out = Vec::new();
        for (n, l) in lines.iter().enumerate() {
            if let Some(rest) = l.strip_prefix("fn ") {
                let name: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                let end = lines[n..]
                    .iter()
                    .position(|x| *x == "}")
                    .map_or(n + 1, |k| n + k + 1);
                out.push(Symbol {
                    name,
                    kind: "fn".into(),
                    start: n + 1,
                    end,
                });
            } else if let Some(rest) = l.strip_prefix("def ") {
                let name: String = rest
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                out.push(Symbol {
                    name,
                    kind: "def".into(),
                    start: n + 1,
                    end: n + 1,
                });
            }
        }
        out
    }

    /// A Rust-like file of `n` functions `f0…`, each 10 lines long (`fn fK() {`, 8 body lines, `}`).
    fn long_file(names: &[&str]) -> String {
        names
            .iter()
            .map(|n| {
                let mut f = format!("fn {n}() {{\n");
                for k in 0..8 {
                    f.push_str(&format!("    let {n}_{k} = {k};\n"));
                }
                f.push_str("}\n");
                f
            })
            .collect()
    }

    #[test]
    fn mentions_are_backticks_calls_or_identifier_like_names() {
        assert!(mentions("Change `parse` to accept tabs", "parse"));
        assert!(mentions("fix `Lexer::next()` at eof", "next"));
        assert!(mentions("make parse( skip blanks", "parse"));
        assert!(mentions("the parse_header bug", "parse_header"));
        assert!(mentions("paginar o listOrders", "listOrders"));
        assert!(mentions("TokenStream drops the last token", "TokenStream"));
        // plain words of the prose are not symbols
        assert!(!mentions("add a new list of orders", "new"));
        assert!(!mentions("add a new list of orders", "list"));
        assert!(!mentions("the reparse step", "parse"));
        assert!(!mentions("`parser` breaks", "parse"));
        assert!(!mentions("x", "a b"));
    }

    #[test]
    fn a_long_file_goes_as_the_mentioned_symbols_with_n_lines_around_and_where_the_rest_is() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        // 40 functions of 10 lines: 400 lines, past the whole-file limit
        let names: Vec<String> = (0..40).map(|k| format!("f{k}")).collect();
        let mut names: Vec<&str> = names.iter().map(String::as_str).collect();
        names[12] = "parse_header";
        names[20] = "emit";
        std::fs::write(d.path().join("src/lexer.rs"), long_file(&names)).unwrap();
        let mut i = issue();
        i.title = "Header parsing".into();
        i.description = "`parse_header` drops the last field; `emit` must flush it.".into();
        i.scope = vec!["src/lexer.rs".into()];
        let r = render_with(d.path(), &i, Some("en"), &toy_outline);
        // the header names each symbol and its range
        assert!(
            r.text.contains(
                "src/lexer.rs: 121–130 (fn parse_header), 201–210 (fn emit) — excerpts ±5 lines"
            ),
            "{}",
            r.text
        );
        // ±5 lines around each, with the real line numbers
        assert!(r.text.contains(" 116 │ "));
        assert!(r.text.contains(" 121 │ fn parse_header() {"));
        assert!(r.text.contains(" 135 │ "));
        assert!(!r.text.contains(" 115 │ "));
        assert!(!r.text.contains(" 136 │ "));
        assert!(r.text.contains(" 201 │ fn emit() {"));
        assert!(!r.text.contains("   1 │ fn f0() {"), "not the whole file");
        // where the other symbols are
        assert!(r
            .text
            .contains("other symbols: 1–10 (fn f0), 11–20 (fn f1)"));
        // 38 other symbols, 30 listed
        assert!(
            r.text.contains("… (+8)") && !r.text.contains("(fn f39)"),
            "the outline is capped"
        );
        // in Portuguese too
        let pt = render_with(d.path(), &i, Some("pt"), &toy_outline);
        assert!(pt.text.contains("— trechos ±5 linhas"));
        assert!(pt.text.contains("outros símbolos: 1–10 (fn f0)"));
    }

    #[test]
    fn without_a_mention_a_long_file_shows_its_start_and_where_the_symbols_past_it_are() {
        let d = tempfile::tempdir().unwrap();
        let names: Vec<String> = (0..25).map(|k| format!("g{k}")).collect();
        let names: Vec<&str> = names.iter().map(String::as_str).collect();
        std::fs::write(d.path().join("big.rs"), long_file(&names)).unwrap();
        let mut i = issue();
        i.description = "Make it faster.".into();
        i.scope = vec!["big.rs".into()];
        let r = render_with(d.path(), &i, Some("en"), &toy_outline);
        assert!(r.text.contains(" 200 │ }"));
        assert!(r.text.contains("     │ … (+50 lines)"));
        assert!(
            r.text
                .contains("other symbols: 201–210 (fn g20), 211–220 (fn g21)"),
            "{}",
            r.text
        );
        // without an outline (render): as before
        let plain = render(d.path(), &i, Some("en"));
        assert!(plain.text.contains("… (+50 lines)") && !plain.text.contains("other symbols"));
    }

    #[test]
    fn a_folder_gives_its_files_and_the_mentioned_symbols_in_them_with_anchors_run_to_the_next() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("app")).unwrap();
        std::fs::write(d.path().join("app/models.py"), "import x\n\ndef load_orders(db):\n    rows = db.all()\n    return rows\n\ndef save(db):\n    pass\n").unwrap();
        std::fs::write(
            d.path().join("app/views.py"),
            "def index():\n    return 1\n",
        )
        .unwrap();
        let mut i = issue();
        i.description = "Paginate load_orders.".into();
        i.scope = vec!["app/".into()];
        let r = render_with(d.path(), &i, Some("en"), &toy_outline);
        assert!(r.text.contains("app/: app/models.py, app/views.py"));
        // the anchor (def) runs to the line before the next symbol
        assert!(
            r.text
                .contains("app/models.py: 3–6 (def load_orders) — excerpts ±5 lines"),
            "{}",
            r.text
        );
        assert!(r.text.contains("   3 │ def load_orders(db):"));
        assert!(
            !r.text.contains("def index"),
            "views.py has no mentioned symbol"
        );
    }

    #[test]
    fn the_symbol_context_stays_inside_the_budget() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("src")).unwrap();
        // many files, each with a mentioned symbol of 80 lines: they cannot all fit
        for k in 0..60 {
            let mut f = String::from("fn shared_step() {\n");
            for n in 0..78 {
                f.push_str(&format!(
                    "    let step_{n} = {n}; // a fairly long line of code {k}\n"
                ));
            }
            f.push_str("}\n");
            std::fs::write(d.path().join(format!("src/m{k:02}.rs")), f).unwrap();
        }
        let mut i = issue();
        i.description = "Rename `shared_step` everywhere.".into();
        i.scope = vec!["src/".into()];
        let r = render_with(d.path(), &i, Some("en"), &toy_outline);
        let code = r.text.split("# Code context").nth(1).unwrap();
        assert!(code.len() < MAX_CONTEXT_CHARS + 4_000, "{}", code.len());
        assert!(code.contains("src/m00.rs: 1–80 (fn shared_step)"));
        assert!(!code.contains("src/m59.rs: 1–80"), "past the budget");
    }
}
