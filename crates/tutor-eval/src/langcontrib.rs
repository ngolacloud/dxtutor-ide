//! The languages installed VS Code extensions contribute (LSP P4): a VSIX's `contributes.languages`
//! — ids, `extensions`, `filenames`, `filenamePatterns`, `firstLine` — over the language registry
//! ([`crate::langreg`]). There is no extension host, so a VSIX never brings a command: a language it
//! contributes reaches a language server only through the registry. The rules (the UI mirrors them
//! in `features/lsp/domain/registry.ts` for the editor; the backend decides which server starts):
//!
//! - **The registry wins.** A file the registry recognises by its name (whole filename or extension)
//!   is the registry's language, whatever a VSIX claims; a VSIX language is asked only when the
//!   registry's name rules say nothing. By the first line, likewise: the registry's `firstLine`
//!   patterns first, then the VSIX's.
//! - **Inside the VSIX languages** (VS Code's precedence): a whole filename, then a filename pattern
//!   (the longest pattern wins), then an extension (the longest wins — `.d.ts` before `.ts`).
//!   Everything is case-insensitive. A pattern with a `/` is matched against the whole path,
//!   otherwise against the file name.
//! - **Same id, same language.** A VSIX language whose id is a registry language (`python` with
//!   `.pyw`, `yaml` with `.condarc`) IS that registry language, server included.
//! - **The server of a VSIX-only language** is the registry server that names one of the extensions
//!   contributing it in `vscodeExtensions` AND lists the language in `vscodeLanguages` (gopls serves
//!   `go.mod`, `go.sum`, `go.work` from `golang.go`; `go.asm` from the same VSIX gets none), and that
//!   still serves a registry language (an override that turns the server off for its languages
//!   turns it off here too). The language id goes to the server as the LSP `languageId`.

use serde::{Deserialize, Serialize};

use crate::langreg::{Language, Registry, Server};

/// One language the installed VSIX contribute, merged by id across them (the UI sends these).
#[derive(Debug, Clone, Default, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContribLanguage {
    /// The VS Code language id (`go.mod`, `apacheconf`).
    pub id: String,
    /// File extensions as the VSIX declares them (`.go`, `.d.ts`; a missing dot is added).
    #[serde(default)]
    pub extensions: Vec<String>,
    /// Whole file names (`go.mod`, `.htaccess`).
    #[serde(default)]
    pub filenames: Vec<String>,
    /// Glob patterns (`**/*requirements*.{txt,in}`).
    #[serde(default)]
    pub filename_patterns: Vec<String>,
    /// A regex for the first line.
    #[serde(default)]
    pub first_line: Option<String>,
    /// The extensions (`publisher.name`, lowercase) that contribute it.
    #[serde(default)]
    pub from: Vec<String>,
}

/// What a file is: a registry language, or a language only a VSIX knows (with the server the
/// registry gives it, if any).
#[derive(Debug, Clone, PartialEq)]
pub enum FileLanguage<'a> {
    Registry(&'a Language),
    Contributed {
        id: String,
        server: Option<&'a Server>,
    },
}

impl<'a> FileLanguage<'a> {
    /// The server for the file, if any.
    pub fn server(&self, reg: &'a Registry) -> Option<&'a Server> {
        match self {
            FileLanguage::Registry(l) => reg.server_of(l),
            FileLanguage::Contributed { server, .. } => *server,
        }
    }

    /// The LSP `languageId` the server gets.
    pub fn lsp_id(&self) -> &str {
        match self {
            FileLanguage::Registry(l) => l.lsp_id(),
            FileLanguage::Contributed { id, .. } => id,
        }
    }
}

/// The last path segment (`/` or `\` separated).
fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

/// A declared extension as it is matched: lowercase, with the leading dot.
fn norm_ext(e: &str) -> String {
    let e = e.trim().to_lowercase();
    if e.starts_with('.') {
        e
    } else {
        format!(".{e}")
    }
}

/// A VS Code glob as an anchored, case-insensitive regex: `**/` any folders (or none), `**` anything,
/// `*` anything but `/`, `?` one character but `/`, `{a,b}` alternatives (spaces around them are
/// ignored), `[…]`/`[!…]` a character class. `None` if it does not compile.
pub fn glob_regex(pattern: &str) -> Option<regex::Regex> {
    let p: Vec<char> = pattern.replace('\\', "/").chars().collect();
    let mut out = String::from("(?i)^");
    let mut i = 0;
    let mut braces = 0usize;
    while i < p.len() {
        let c = p[i];
        match c {
            '*' => {
                if p.get(i + 1) == Some(&'*') {
                    if p.get(i + 2) == Some(&'/') {
                        out.push_str("(?:.*/)?");
                        i += 3;
                    } else {
                        out.push_str(".*");
                        i += 2;
                    }
                    continue;
                }
                out.push_str("[^/]*");
            }
            '?' => out.push_str("[^/]"),
            '{' => {
                braces += 1;
                out.push_str("(?:");
                // spaces after `{` or `,` are ignored (`{txt, in}`)
                while p.get(i + 1) == Some(&' ') {
                    i += 1;
                }
            }
            '}' if braces > 0 => {
                braces -= 1;
                while out.ends_with(' ') {
                    out.pop();
                }
                out.push(')');
            }
            ',' if braces > 0 => {
                while out.ends_with(' ') {
                    out.pop();
                }
                out.push('|');
                while p.get(i + 1) == Some(&' ') {
                    i += 1;
                }
            }
            '[' => match p[i + 1..].iter().position(|&x| x == ']') {
                Some(len) if len > 0 => {
                    let body: String = p[i + 1..i + 1 + len].iter().collect();
                    let (neg, body) = match body.strip_prefix(['!', '^']) {
                        Some(rest) => (true, rest.to_string()),
                        None => (false, body),
                    };
                    let body = body.replace('\\', "\\\\").replace('[', "\\[");
                    out.push('[');
                    if neg {
                        out.push('^');
                    }
                    out.push_str(&body);
                    out.push(']');
                    i += len + 2;
                    continue;
                }
                _ => out.push_str("\\["),
            },
            _ => out.push_str(&regex::escape(&c.to_string())),
        }
        i += 1;
    }
    if braces > 0 {
        return None;
    }
    out.push('$');
    regex::Regex::new(&out).ok()
}

/// Does `pattern` match the file at `path` (the whole path if the pattern has a `/`, else the name)?
pub fn pattern_matches(pattern: &str, path: &str) -> bool {
    let path = path.replace('\\', "/");
    let subject = if pattern.contains(['/', '\\']) {
        path.as_str()
    } else {
        file_name(&path)
    };
    glob_regex(pattern).is_some_and(|re| re.is_match(subject))
}

/// The VSIX language of a file by its NAME (see the module docs for the order).
pub fn contributed_for_name<'c>(
    langs: &'c [ContribLanguage],
    path: &str,
) -> Option<&'c ContribLanguage> {
    let name = file_name(path);
    if name.is_empty() {
        return None;
    }
    let lower = name.to_lowercase();
    if let Some(l) = langs
        .iter()
        .find(|l| l.filenames.iter().any(|f| f.to_lowercase() == lower))
    {
        return Some(l);
    }
    let mut best: Option<(&ContribLanguage, usize)> = None;
    for l in langs {
        for p in &l.filename_patterns {
            if pattern_matches(p, path) && best.is_none_or(|(_, n)| p.len() > n) {
                best = Some((l, p.len()));
            }
        }
    }
    if let Some((l, _)) = best {
        return Some(l);
    }
    let mut best: Option<(&ContribLanguage, usize)> = None;
    for l in langs {
        for e in &l.extensions {
            let e = norm_ext(e);
            if e.len() > 1 && lower.ends_with(&e) && best.is_none_or(|(_, n)| e.len() > n) {
                best = Some((l, e.len()));
            }
        }
    }
    best.map(|(l, _)| l)
}

/// The VSIX language whose `firstLine` matches `line` (a pattern that does not compile is skipped).
pub fn contributed_for_first_line<'c>(
    langs: &'c [ContribLanguage],
    line: &str,
) -> Option<&'c ContribLanguage> {
    langs.iter().find(|l| {
        l.first_line
            .as_deref()
            .and_then(|p| regex::Regex::new(p).ok())
            .is_some_and(|re| re.is_match(line))
    })
}

/// The registry server of a VSIX-only language (see the module docs).
pub fn server_for<'a>(reg: &'a Registry, lang: &ContribLanguage) -> Option<&'a Server> {
    reg.servers.iter().find(|s| {
        s.vscode_languages.contains(&lang.id)
            && lang.from.iter().any(|e| {
                s.vscode_extensions
                    .iter()
                    .any(|x| x.eq_ignore_ascii_case(e))
            })
            && reg
                .languages
                .iter()
                .any(|l| l.server.as_deref() == Some(s.id.as_str()))
    })
}

/// A VSIX language as a file's language: the registry language of the same id, or a VSIX-only one.
fn resolve<'a>(reg: &'a Registry, lang: &ContribLanguage) -> FileLanguage<'a> {
    match reg.language(&lang.id) {
        Some(l) => FileLanguage::Registry(l),
        None => FileLanguage::Contributed {
            id: lang.id.clone(),
            server: server_for(reg, lang),
        },
    }
}

/// The language of a file at `path`: the registry by name, the VSIX by name, then — only when the
/// name says nothing — the registry's first-line patterns and the VSIX's (`first_line` reads it,
/// once, only if needed).
pub fn file_language<'a>(
    reg: &'a Registry,
    langs: &[ContribLanguage],
    path: &str,
    first_line: impl FnOnce() -> Option<String>,
) -> Option<FileLanguage<'a>> {
    if let Some(l) = reg.language_for_name(path) {
        return Some(FileLanguage::Registry(l));
    }
    if let Some(c) = contributed_for_name(langs, path) {
        return Some(resolve(reg, c));
    }
    let line = first_line()?;
    if let Some(l) = reg.language_for_first_line(&line) {
        return Some(FileLanguage::Registry(l));
    }
    contributed_for_first_line(langs, &line).map(|c| resolve(reg, c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::langreg::registry;

    fn lang(id: &str, from: &str) -> ContribLanguage {
        ContribLanguage {
            id: id.into(),
            from: vec![from.into()],
            ..Default::default()
        }
    }

    /// The `contributes.languages` of the real `golang.go` 0.58.0 VSIX (Open VSX, MIT).
    fn golang_go() -> Vec<ContribLanguage> {
        let g = "golang.go";
        vec![
            ContribLanguage {
                extensions: vec![".go".into()],
                ..lang("go", g)
            },
            ContribLanguage {
                extensions: vec![".s".into()],
                ..lang("go.asm", g)
            },
            ContribLanguage {
                filenames: vec!["go.mod".into()],
                ..lang("go.mod", g)
            },
            ContribLanguage {
                filenames: vec!["go.work".into()],
                ..lang("go.work", g)
            },
            ContribLanguage {
                filenames: vec!["go.sum".into()],
                ..lang("go.sum", g)
            },
            ContribLanguage {
                extensions: vec![".tmpl".into(), ".gotmpl".into()],
                ..lang("gotmpl", g)
            },
        ]
    }

    /// The `contributes.languages` of the real `ms-python.python` 2026.10.0 VSIX (Open VSX, MIT).
    fn ms_python() -> Vec<ContribLanguage> {
        let p = "ms-python.python";
        vec![
            ContribLanguage {
                extensions: vec![".j2".into(), ".jinja2".into()],
                ..lang("jinja", p)
            },
            ContribLanguage {
                filenames: vec![
                    "constraints.txt".into(),
                    "requirements.in".into(),
                    "requirements.txt".into(),
                ],
                filename_patterns: vec![
                    "**/*requirements*.{txt, in}".into(),
                    "**/*constraints*.txt".into(),
                    "**/requirements/*.{txt,in}".into(),
                    "**/constraints/*.txt".into(),
                ],
                ..lang("pip-requirements", p)
            },
            ContribLanguage {
                filenames: vec![".condarc".into()],
                ..lang("yaml", p)
            },
            ContribLanguage {
                filenames: vec![".flake8".into(), ".pylintrc".into()],
                ..lang("ini", p)
            },
            ContribLanguage {
                filenames: vec!["Pipfile".into(), "uv.lock".into()],
                ..lang("toml", p)
            },
        ]
    }

    fn no_line() -> Option<String> {
        None
    }

    #[test]
    fn the_go_extension_picks_gopls_for_the_languages_gopls_lists() {
        let reg = registry();
        let langs = golang_go();
        for f in ["/w/go.mod", "/w/sub/GO.SUM", "/w/go.work"] {
            let fl = file_language(reg, &langs, f, no_line).unwrap_or_else(|| panic!("{f}"));
            assert_eq!(
                fl.server(reg).map(|s| s.label.as_str()),
                Some("gopls"),
                "{f}"
            );
            assert!(matches!(fl, FileLanguage::Contributed { .. }), "{f}");
        }
        assert_eq!(
            file_language(reg, &langs, "/w/go.mod", no_line)
                .unwrap()
                .lsp_id(),
            "go.mod"
        );
        // the VSIX's `go` IS the registry's Go
        assert!(
            matches!(file_language(reg, &langs, "/w/a.go", no_line), Some(FileLanguage::Registry(l)) if l.id == "go")
        );
        // languages gopls does not list get no server, though the same VSIX brings them
        for f in ["/w/x.s", "/w/page.tmpl"] {
            let fl = file_language(reg, &langs, f, no_line).unwrap();
            assert!(fl.server(reg).is_none(), "{f}");
        }
    }

    #[test]
    fn another_extension_contributing_go_mod_does_not_pick_gopls() {
        let reg = registry();
        let langs = vec![ContribLanguage {
            filenames: vec!["go.mod".into()],
            ..lang("go.mod", "someone.go-mod-syntax")
        }];
        let fl = file_language(reg, &langs, "/w/go.mod", no_line).unwrap();
        assert_eq!(
            fl,
            FileLanguage::Contributed {
                id: "go.mod".into(),
                server: None
            }
        );
    }

    #[test]
    fn python_extension_languages_same_id_is_the_registry_and_pip_requirements_has_no_server() {
        let reg = registry();
        let langs = ms_python();
        for f in [
            "/w/requirements.txt",
            "/w/dev-requirements.in",
            "/w/requirements/base.txt",
            "/w/a/constraints/x.txt",
        ] {
            let fl = file_language(reg, &langs, f, no_line).unwrap_or_else(|| panic!("{f}"));
            assert_eq!(fl.lsp_id(), "pip-requirements", "{f}");
            assert!(
                fl.server(reg).is_none(),
                "{f}: pyright never gets requirements files"
            );
        }
        assert!(
            matches!(file_language(reg, &langs, "/w/.condarc", no_line), Some(FileLanguage::Registry(l)) if l.id == "yaml")
        );
        assert!(
            matches!(file_language(reg, &langs, "/w/Pipfile", no_line), Some(FileLanguage::Registry(l)) if l.id == "toml")
        );
        assert_eq!(
            file_language(reg, &langs, "/w/.flake8", no_line)
                .unwrap()
                .lsp_id(),
            "ini"
        );
        assert!(file_language(reg, &langs, "/w/notes.txt", no_line).is_none());
    }

    #[test]
    fn the_registry_wins_a_conflict() {
        let reg = registry();
        // a VSIX that claims `.h` and `.py` for itself
        let langs = vec![ContribLanguage {
            extensions: vec![".h".into(), "py".into(), ".m".into()],
            ..lang("objective-c", "acme.objc")
        }];
        assert!(
            matches!(file_language(reg, &langs, "/w/a.h", no_line), Some(FileLanguage::Registry(l)) if l.id == "cpp")
        );
        assert!(
            matches!(file_language(reg, &langs, "/w/a.py", no_line), Some(FileLanguage::Registry(l)) if l.id == "python")
        );
        assert_eq!(
            file_language(reg, &langs, "/w/a.m", no_line)
                .unwrap()
                .lsp_id(),
            "objective-c"
        );
        // a more specific VSIX extension loses to the registry's extension too
        let langs = vec![ContribLanguage {
            extensions: vec![".blade.php".into()],
            ..lang("blade", "acme.blade")
        }];
        assert!(
            matches!(file_language(reg, &langs, "/w/v.blade.php", no_line), Some(FileLanguage::Registry(l)) if l.id == "php")
        );
    }

    #[test]
    fn first_lines_registry_first_then_the_vsix_and_only_when_the_name_says_nothing() {
        let reg = registry();
        let langs = vec![ContribLanguage {
            extensions: vec![".pl".into()],
            first_line: Some(r"^#!.*\bperl\b".into()),
            ..lang("perl", "vscode.perl")
        }];
        let perl = || Some("#!/usr/bin/env perl".to_string());
        assert_eq!(
            file_language(reg, &langs, "/w/script", perl)
                .unwrap()
                .lsp_id(),
            "perl"
        );
        assert!(
            matches!(file_language(reg, &langs, "/w/run", || Some("#!/bin/bash".into())), Some(FileLanguage::Registry(l)) if l.id == "shellscript")
        );
        // the name says it: the first line is never read
        assert!(matches!(
            file_language(reg, &langs, "/w/a.py", || panic!("read")),
            Some(FileLanguage::Registry(_))
        ));
        assert_eq!(
            file_language(reg, &langs, "/w/a.pl", || panic!("read"))
                .unwrap()
                .lsp_id(),
            "perl"
        );
        assert!(file_language(reg, &langs, "/w/script", || Some("hello".into())).is_none());
        // a pattern that does not compile in Rust is skipped, not an error
        let bad = vec![ContribLanguage {
            first_line: Some("(?<=x)y".into()),
            ..lang("odd", "a.b")
        }];
        assert!(file_language(reg, &bad, "/w/f", || Some("xy".into())).is_none());
    }

    #[test]
    fn vsix_precedence_filename_then_longest_pattern_then_longest_extension() {
        let langs = vec![
            ContribLanguage {
                extensions: vec![".ts".into()],
                ..lang("short", "a.a")
            },
            ContribLanguage {
                extensions: vec![".d.ts".into()],
                ..lang("long", "a.a")
            },
            ContribLanguage {
                filename_patterns: vec!["*.d.ts".into()],
                ..lang("pat", "a.a")
            },
            ContribLanguage {
                filename_patterns: vec!["**/types/*.d.ts".into()],
                ..lang("longpat", "a.a")
            },
            ContribLanguage {
                filenames: vec!["index.d.ts".into()],
                ..lang("name", "a.a")
            },
        ];
        assert_eq!(contributed_for_name(&langs, "/w/x.ts").unwrap().id, "short");
        assert_eq!(
            contributed_for_name(&langs[..2], "/w/x.d.ts").unwrap().id,
            "long"
        );
        assert_eq!(
            contributed_for_name(&langs[..3], "/w/x.d.ts").unwrap().id,
            "pat"
        );
        assert_eq!(
            contributed_for_name(&langs, "/w/types/x.d.ts").unwrap().id,
            "longpat"
        );
        assert_eq!(
            contributed_for_name(&langs, "/w/types/INDEX.D.TS")
                .unwrap()
                .id,
            "name"
        );
        // the Apache VSIX declares extensions without the dot (`htaccess`): a dotfile matches
        let apache = vec![ContribLanguage {
            extensions: vec!["conf".into(), ".htaccess".into(), "htpasswd".into()],
            ..lang("apacheconf", "mrmlnc.vscode-apache")
        }];
        assert_eq!(
            contributed_for_name(&apache, "/srv/.htaccess").unwrap().id,
            "apacheconf"
        );
        assert_eq!(
            contributed_for_name(&apache, "/srv/.htpasswd").unwrap().id,
            "apacheconf"
        );
        assert_eq!(
            contributed_for_name(&apache, "/etc/httpd.CONF").unwrap().id,
            "apacheconf"
        );
        assert!(contributed_for_name(&apache, "/etc/conf").is_none());
    }

    #[test]
    fn globs() {
        let m = pattern_matches;
        assert!(m("**/*requirements*.{txt, in}", "/w/dev-requirements.in"));
        assert!(m("**/*requirements*.{txt, in}", "requirements.txt"));
        assert!(!m("**/*requirements*.{txt, in}", "/w/requirements.md"));
        assert!(m(
            "**/.github/workflows/*.yml",
            "/p/.github/workflows/ci.yml"
        ));
        assert!(!m(
            "**/.github/workflows/*.yml",
            "/p/.github/workflows/sub/ci.yml"
        ));
        assert!(m("*.conf", "/etc/a.conf"), "no `/`: the file name");
        assert!(m("Jenkinsfile*", "C:\\w\\Jenkinsfile.prod"));
        assert!(m("file?.[ch]", "/w/file1.c"));
        assert!(!m("file?.[!ch]", "/w/file1.c"));
        assert!(m("a.(x)+", "/w/a.(x)+"), "regex characters are literal");
        assert!(glob_regex("{a,b").is_none());
    }
}
