//! A map for entering a codebase (A10, docs/v2/UI-AUDIT.md §3 «Entrar numa base de código»).
//!
//! From the project itself: the languages (files and lines of the tracked files), the entry points
//! (Cargo binaries, Go `package main`, Python `__main__`, `package.json` scripts, Dockerfiles and
//! compose services, Makefile targets), the docs (READMEs, contributing guides, ADRs), the files most
//! changed in the last six months and who changes the code most, and the modules with the most
//! symbols (`codemap::all_symbols`). Read-only; nothing is invented — an empty part says why.

use std::collections::BTreeMap;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Lang {
    pub name: String,
    pub files: usize,
    pub lines: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// cargo-bin | go-main | python-main | npm-script | docker | compose | make
    pub kind: String,
    pub name: String,
    pub file: String,
    /// how to run it, as the human would type it
    pub run: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hot {
    pub file: String,
    pub changes: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    pub commits: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Module {
    pub file: String,
    pub symbols: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OnboardMap {
    pub languages: Vec<Lang>,
    pub total_files: usize,
    pub entries: Vec<Entry>,
    pub docs: Vec<String>,
    pub hot: Vec<Hot>,
    pub people: Vec<Person>,
    pub modules: Vec<Module>,
    pub tests: usize,
    pub git: bool,
    pub notes: Vec<String>,
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let o = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .ok()?;
    o.status
        .success()
        .then(|| String::from_utf8_lossy(&o.stdout).to_string())
}

const SKIP: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "vendor",
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".terraform",
    ".next",
];

fn files(root: &Path) -> (Vec<String>, bool) {
    if let Some(out) = git(root, &["ls-files", "-z"]) {
        return (
            out.split('\0')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect(),
            true,
        );
    }
    let mut out = vec![];
    fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            let p = e.path();
            if p.is_dir() {
                if !n.starts_with('.') && !SKIP.contains(&n.as_str()) && out.len() < 20000 {
                    walk(root, &p, out);
                }
            } else if let Ok(r) = p.strip_prefix(root) {
                out.push(r.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    walk(root, root, &mut out);
    (out, false)
}

fn lang_of(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    Some(match ext.as_str() {
        "rs" => "Rust",
        "ts" | "tsx" => "TypeScript",
        "js" | "jsx" | "mjs" | "cjs" => "JavaScript",
        "py" => "Python",
        "go" => "Go",
        "java" => "Java",
        "kt" | "kts" => "Kotlin",
        "swift" => "Swift",
        "cs" => "C#",
        "c" | "h" => "C",
        "cc" | "cpp" | "cxx" | "hpp" => "C++",
        "rb" => "Ruby",
        "php" => "PHP",
        "sql" => "SQL",
        "css" | "scss" => "CSS",
        "html" => "HTML",
        "tf" => "Terraform",
        "sh" | "bash" => "Shell",
        "md" => "Markdown",
        "toml" | "yaml" | "yml" | "json" => "Config",
        _ => return None,
    })
}

const TEST_MARK: &[&str] = &[
    "/tests/",
    "/test/",
    "_test.",
    ".test.",
    ".spec.",
    "test_",
    "/__tests__/",
];

/// Entry points found in the files (paths relative to the root) and their contents (read on demand).
pub fn entries(root: &Path, files: &[String]) -> Vec<Entry> {
    let read = |f: &str| std::fs::read_to_string(root.join(f)).unwrap_or_default();
    let mut out = vec![];
    for f in files {
        let name = f.rsplit('/').next().unwrap_or(f);
        let dir = f.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        if name == "Cargo.toml" {
            let t = read(f);
            let pkg = t.split("[package]").nth(1).and_then(|s| {
                s.lines().find_map(|l| {
                    l.trim().strip_prefix("name").map(|r| {
                        r.trim_start_matches([' ', '='])
                            .trim()
                            .trim_matches('"')
                            .to_string()
                    })
                })
            });
            let has_main = files.iter().any(|x| {
                x == &format!(
                    "{}{}src/main.rs",
                    dir,
                    if dir.is_empty() { "" } else { "/" }
                )
            });
            if let (Some(p), true) = (pkg.clone(), has_main) {
                out.push(Entry {
                    kind: "cargo-bin".into(),
                    run: Some(format!("cargo run -p {p}")),
                    name: p,
                    file: f.clone(),
                });
            }
            for b in files.iter().filter(|x| {
                x.starts_with(&format!(
                    "{}{}src/bin/",
                    dir,
                    if dir.is_empty() { "" } else { "/" }
                )) && x.ends_with(".rs")
            }) {
                let bn = b
                    .rsplit('/')
                    .next()
                    .unwrap_or("")
                    .trim_end_matches(".rs")
                    .to_string();
                out.push(Entry {
                    kind: "cargo-bin".into(),
                    run: Some(format!("cargo run --bin {bn}")),
                    name: bn,
                    file: b.clone(),
                });
            }
        } else if name.ends_with(".go") && !name.ends_with("_test.go") {
            let t = read(f);
            if t.lines().any(|l| l.trim() == "package main") && t.contains("func main()") {
                out.push(Entry {
                    kind: "go-main".into(),
                    name: if dir.is_empty() {
                        "main".into()
                    } else {
                        dir.into()
                    },
                    run: Some(format!("go run ./{dir}")),
                    file: f.clone(),
                });
            }
        } else if name.ends_with(".py") && !TEST_MARK.iter().any(|m| f.contains(m)) {
            let t = read(f);
            if t.contains("if __name__ == \"__main__\"") || t.contains("if __name__ == '__main__'")
            {
                out.push(Entry {
                    kind: "python-main".into(),
                    name: name.into(),
                    run: Some(format!("python3 {f}")),
                    file: f.clone(),
                });
            }
        } else if name == "package.json" {
            let v: serde_json::Value =
                serde_json::from_str(&read(f)).unwrap_or(serde_json::Value::Null);
            for (s, _) in v["scripts"].as_object().cloned().unwrap_or_default() {
                if ["start", "dev", "build", "test", "serve", "preview"].contains(&s.as_str()) {
                    out.push(Entry {
                        kind: "npm-script".into(),
                        run: Some(if dir.is_empty() {
                            format!("npm run {s}")
                        } else {
                            format!("npm --prefix {dir} run {s}")
                        }),
                        name: s,
                        file: f.clone(),
                    });
                }
            }
        } else if name == "Dockerfile" || name.starts_with("Dockerfile.") {
            out.push(Entry {
                kind: "docker".into(),
                name: if dir.is_empty() {
                    "Dockerfile".into()
                } else {
                    dir.into()
                },
                run: Some(format!("docker build -f {f} .")),
                file: f.clone(),
            });
        } else if name == "docker-compose.yml"
            || name == "compose.yaml"
            || name == "docker-compose.yaml"
            || name == "compose.yml"
        {
            let t = read(f);
            let mut in_services = false;
            for l in t.lines() {
                if l.starts_with("services:") {
                    in_services = true;
                    continue;
                }
                if in_services {
                    if !l.starts_with(' ') && !l.trim().is_empty() {
                        break;
                    }
                    if let Some(svc) = l
                        .strip_prefix("  ")
                        .filter(|r| !r.starts_with(' '))
                        .and_then(|r| r.strip_suffix(':'))
                    {
                        out.push(Entry {
                            kind: "compose".into(),
                            name: svc.into(),
                            run: Some(format!("docker compose -f {f} up {svc}")),
                            file: f.clone(),
                        });
                    }
                }
            }
        } else if name == "Makefile" {
            for l in read(f).lines() {
                if let Some((t, _)) = l.split_once(':') {
                    if !t.is_empty()
                        && !t.starts_with(['.', '\t', ' ', '#'])
                        && t.chars()
                            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
                        && !l.contains(":=")
                    {
                        out.push(Entry {
                            kind: "make".into(),
                            run: Some(format!(
                                "make -C {} {t}",
                                if dir.is_empty() { "." } else { dir }
                            )),
                            name: t.into(),
                            file: f.clone(),
                        });
                    }
                }
            }
        }
    }
    out.truncate(60);
    out
}

/// The map of the project at `root`.
pub fn map(root: &Path) -> OnboardMap {
    let (all, is_git) = files(root);
    let mut m = OnboardMap {
        git: is_git,
        total_files: all.len(),
        ..Default::default()
    };
    // languages
    let mut by: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    for f in all.iter().take(20000) {
        if let Some(l) = lang_of(f) {
            let lines = if l == "Config" || l == "Markdown" {
                0
            } else {
                std::fs::read(root.join(f))
                    .map(|b| b.iter().filter(|c| **c == b'\n').count())
                    .unwrap_or(0)
            };
            let e = by.entry(l).or_insert((0, 0));
            e.0 += 1;
            e.1 += lines;
        }
    }
    m.languages = by
        .into_iter()
        .map(|(n, (f, l))| Lang {
            name: n.into(),
            files: f,
            lines: l,
        })
        .collect();
    m.languages
        .sort_by(|a, b| b.lines.cmp(&a.lines).then(b.files.cmp(&a.files)));
    m.tests = all
        .iter()
        .filter(|f| {
            TEST_MARK
                .iter()
                .any(|t| f.contains(t) || format!("/{f}").contains(t))
        })
        .count();
    m.entries = entries(root, &all);
    // docs
    let mut docs: Vec<String> = all
        .iter()
        .filter(|f| {
            let n = f.rsplit('/').next().unwrap_or("").to_ascii_lowercase();
            n.starts_with("readme")
                || n.starts_with("contributing")
                || n.starts_with("architecture")
                || n == "claude.md"
                || n == "agents.md"
                || (f.contains("adr") && n.ends_with(".md"))
                || (f.starts_with("docs/") && n.ends_with(".md") && f.matches('/').count() <= 2)
        })
        .cloned()
        .collect();
    docs.sort_by_key(|f| (f.matches('/').count(), f.clone()));
    docs.truncate(25);
    m.docs = docs;
    // history
    if is_git {
        if let Some(log) = git(
            root,
            &["log", "--since=6.months", "--name-only", "--format="],
        ) {
            let mut c: BTreeMap<String, usize> = BTreeMap::new();
            for f in log.lines().filter(|l| !l.trim().is_empty()) {
                *c.entry(f.to_string()).or_default() += 1;
            }
            let mut hot: Vec<Hot> = c
                .into_iter()
                .filter(|(f, _)| all.contains(f))
                .map(|(file, changes)| Hot { file, changes })
                .collect();
            hot.sort_by(|a, b| b.changes.cmp(&a.changes).then(a.file.cmp(&b.file)));
            hot.truncate(15);
            m.hot = hot;
        }
        if let Some(sl) = git(
            root,
            &[
                "shortlog",
                "-sn",
                "--no-merges",
                "--since=12.months",
                "HEAD",
            ],
        ) {
            m.people = sl
                .lines()
                .filter_map(|l| {
                    let (n, name) = l.trim().split_once('\t')?;
                    Some(Person {
                        name: name.trim().into(),
                        commits: n.trim().parse().ok()?,
                    })
                })
                .take(10)
                .collect();
        }
        if m.hot.is_empty() {
            m.notes
                .push("No commits in the last six months: no hot files.".into());
        }
    } else {
        m.notes
            .push("Not a git repository: no history (hot files, people).".into());
    }
    // modules with the most symbols
    let syms = crate::codemap::all_symbols(root, 20000);
    let mut per: BTreeMap<String, usize> = BTreeMap::new();
    for s in syms {
        let rel = Path::new(&s.file)
            .strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or(s.file.clone());
        *per.entry(rel).or_default() += 1;
    }
    let mut modules: Vec<Module> = per
        .into_iter()
        .map(|(file, symbols)| Module { file, symbols })
        .collect();
    modules.sort_by(|a, b| b.symbols.cmp(&a.symbols).then(a.file.cmp(&b.file)));
    modules.truncate(12);
    m.modules = modules;
    if m.entries.is_empty() {
        m.notes.push("No entry point found (no Cargo binary, Go main, Python __main__, npm script, Dockerfile, compose service or Makefile target).".into());
    }
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_a_small_project() {
        let d = tempfile::tempdir().unwrap();
        let w = |p: &str, s: &str| {
            let f = d.path().join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, s).unwrap();
        };
        w(
            "Cargo.toml",
            "[package]\nname = \"shop\"\nversion = \"0.1.0\"\n",
        );
        w(
            "src/main.rs",
            "fn main() {\n    println!(\"hi\");\n}\nfn helper() {}\n",
        );
        w("src/bin/migrate.rs", "fn main() {}\n");
        w(
            "web/package.json",
            "{\"scripts\": {\"dev\": \"vite\", \"lint\": \"eslint .\", \"test\": \"vitest\"}}",
        );
        w("web/src/app.test.ts", "test('x', () => {})\n");
        w(
            "tools/seed.py",
            "def run():\n    pass\n\nif __name__ == \"__main__\":\n    run()\n",
        );
        w("cmd/api/main.go", "package main\n\nfunc main() {}\n");
        w(
            "docker-compose.yml",
            "services:\n  api:\n    build: .\n  db:\n    image: postgres:16\nvolumes:\n  data:\n",
        );
        w(
            "Makefile",
            "build:\n\tcargo build\nCC := gcc\n.PHONY: build\n",
        );
        w("README.md", "# shop\n");
        w("docs/adr/0001-db.md", "# ADR\n");
        let g = |a: &[&str]| {
            let _ = Command::new("git").arg("-C").arg(d.path()).args(a).output();
        };
        g(&["init", "-q", "-b", "main"]);
        g(&["-c", "user.name=Ana", "-c", "user.email=a@x", "add", "."]);
        g(&[
            "-c",
            "user.name=Ana",
            "-c",
            "user.email=a@x",
            "commit",
            "-q",
            "-m",
            "first",
        ]);
        w(
            "src/main.rs",
            "fn main() {\n    println!(\"hi!\");\n}\nfn helper() {}\n",
        );
        g(&[
            "-c",
            "user.name=Rui",
            "-c",
            "user.email=r@x",
            "commit",
            "-qam",
            "second",
        ]);
        let m = map(d.path());
        assert!(m.git);
        let kinds: Vec<(&str, &str)> = m
            .entries
            .iter()
            .map(|e| (e.kind.as_str(), e.name.as_str()))
            .collect();
        for want in [
            ("cargo-bin", "shop"),
            ("cargo-bin", "migrate"),
            ("npm-script", "dev"),
            ("npm-script", "test"),
            ("python-main", "seed.py"),
            ("go-main", "cmd/api"),
            ("compose", "api"),
            ("compose", "db"),
            ("make", "build"),
        ] {
            assert!(kinds.contains(&want), "missing {want:?} in {kinds:?}");
        }
        assert!(!kinds.contains(&("npm-script", "lint")));
        assert!(!kinds.iter().any(|(k, n)| *k == "make" && *n == "CC"));
        assert_eq!(
            m.entries
                .iter()
                .find(|e| e.name == "dev")
                .unwrap()
                .run
                .as_deref(),
            Some("npm --prefix web run dev")
        );
        assert!(
            m.docs.contains(&"README.md".to_string())
                && m.docs.contains(&"docs/adr/0001-db.md".to_string())
        );
        assert_eq!(m.hot[0].file, "src/main.rs");
        assert_eq!(m.hot[0].changes, 2);
        assert_eq!(m.people.len(), 2);
        assert!(m.languages.iter().any(|l| l.name == "Rust" && l.files == 2));
        assert_eq!(m.tests, 1);
    }

    #[test]
    fn says_why_when_there_is_no_history() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("notes.txt"), "x").unwrap();
        let m = map(d.path());
        assert!(!m.git);
        assert!(m.notes.iter().any(|n| n.contains("Not a git repository")));
        assert!(m.notes.iter().any(|n| n.contains("No entry point")));
    }
}
