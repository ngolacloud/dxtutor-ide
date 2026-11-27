//! H2 (docs/v2/AUDIT-harness.md, decision D2): the projects of a workspace.
//!
//! The workspace is the folder that is open; its projects are the folders with a build manifest
//! (`Cargo.toml`, `package.json`, `go.mod`, `pyproject.toml`, `pom.xml`, `*.csproj`, `*.tf`…), found up to a
//! few levels deep — a monorepo has several, a plain repository one (the root). `.dxtutor/workspace.json`
//! decides when it exists: it declares projects (name, path, test and lint commands), excludes folders, or
//! turns the detection off (`"detect": false`). Each project gets the commands Co-Dev runs as `run_tests` and
//! `lint`. One function for the IDE (the Project's selector, Co-Dev's boundaries) and the agent.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const WORKSPACE_FILE: &str = ".dxtutor/workspace.json";
/// How deep the detection looks (the root is 0): `apps/web`, `crates/core`, `services/orders` are 2. A deeper
/// project is declared in the workspace file (a template or a fixture deep in a repository is not one).
pub const MAX_DEPTH: usize = 2;
/// At most this many projects go into the system prompt.
pub const MAX_IN_PROMPT: usize = 15;
const SKIP: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    "venv",
    ".venv",
    "__pycache__",
    "coverage",
    "bin",
    "obj",
    "Pods",
    "DerivedData",
    "fixtures",
    "testdata",
    "__fixtures__",
];

/// A project of the workspace.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WsProject {
    pub name: String,
    /// Relative to the workspace, `"."` for the root, always with `/`.
    pub path: String,
    /// `rust`, `go`, `typescript`, `python`, `java`, `php`, `ruby`, `csharp`, `swift`, `cpp`, `terraform` or `""`.
    pub language: String,
    /// The manifests that made it a project.
    pub markers: Vec<String>,
    pub test: Option<String>,
    pub lint: Option<String>,
    /// Declared in `.dxtutor/workspace.json` (not only detected).
    pub declared: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub projects: Vec<WsProject>,
    /// What the workspace file got wrong (the rest still counts).
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct WorkspaceFile {
    #[serde(default)]
    projects: Vec<Declared>,
    #[serde(default)]
    exclude: Vec<String>,
    #[serde(default)]
    detect: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Declared {
    path: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    test: Option<String>,
    #[serde(default)]
    lint: Option<String>,
}

fn has_ext(dir: &Path, ext: &str) -> bool {
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .any(|e| e.path().extension().is_some_and(|x| x == ext) && e.path().is_file())
        })
        .unwrap_or(false)
}

/// The manifests in `dir` and the language they say.
pub fn markers(dir: &Path) -> (Vec<String>, &'static str) {
    const FILES: &[(&str, &str)] = &[
        ("Cargo.toml", "rust"),
        ("go.mod", "go"),
        ("package.json", "typescript"),
        ("pyproject.toml", "python"),
        ("setup.py", "python"),
        ("requirements.txt", "python"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("build.gradle.kts", "java"),
        ("composer.json", "php"),
        ("Gemfile", "ruby"),
        ("Package.swift", "swift"),
        ("CMakeLists.txt", "cpp"),
        ("mix.exs", "elixir"),
    ];
    let mut found = vec![];
    let mut lang = "";
    for (f, l) in FILES {
        if dir.join(f).is_file() {
            found.push(f.to_string());
            if lang.is_empty() {
                lang = l;
            }
        }
    }
    for (ext, l) in [("csproj", "csharp"), ("sln", "csharp"), ("tf", "terraform")] {
        if has_ext(dir, ext) {
            found.push(format!("*.{ext}"));
            if lang.is_empty() {
                lang = l;
            }
        }
    }
    (found, lang)
}

fn package_scripts(dir: &Path) -> (bool, bool) {
    let v: serde_json::Value = std::fs::read_to_string(dir.join("package.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    let s = &v["scripts"];
    (s["test"].is_string(), s["lint"].is_string())
}

/// The test and lint commands of a project, from its manifests.
pub fn commands(dir: &Path, language: &str) -> (Option<String>, Option<String>) {
    let s = |v: &str| Some(v.to_string());
    match language {
        "rust" => (s("cargo test"), s("cargo clippy")),
        "go" => (s("go test ./..."), s("go vet ./...")),
        "typescript" => {
            let pm = if dir.join("pnpm-lock.yaml").is_file() {
                "pnpm"
            } else if dir.join("yarn.lock").is_file() {
                "yarn"
            } else {
                "npm"
            };
            let (test, lint) = package_scripts(dir);
            (
                test.then(|| {
                    if pm == "npm" {
                        "npm test".into()
                    } else {
                        format!("{pm} test")
                    }
                }),
                lint.then(|| format!("{pm} run lint")),
            )
        }
        "python" => {
            let deps = ["pyproject.toml", "requirements.txt", "setup.cfg"]
                .iter()
                .filter_map(|f| std::fs::read_to_string(dir.join(f)).ok())
                .collect::<String>();
            let test = if deps.contains("pytest") {
                "python3 -m pytest"
            } else {
                "python3 -m unittest discover"
            };
            (
                s(test),
                deps.contains("ruff").then(|| "ruff check .".to_string()),
            )
        }
        "java" if dir.join("pom.xml").is_file() => (s("mvn -q test"), None),
        "java" => (
            s(if dir.join("gradlew").is_file() {
                "./gradlew test"
            } else {
                "gradle test"
            }),
            None,
        ),
        "csharp" => (s("dotnet test"), None),
        "swift" => (s("swift test"), None),
        "terraform" => (None, s("terraform validate")),
        _ => (None, None),
    }
}

fn rel(root: &Path, p: &Path) -> String {
    let r = p
        .strip_prefix(root)
        .unwrap_or(p)
        .to_string_lossy()
        .replace('\\', "/");
    if r.is_empty() {
        ".".into()
    } else {
        r
    }
}

fn excluded(path: &str, exclude: &[String]) -> bool {
    exclude.iter().any(|e| {
        let e = e.trim().trim_start_matches("./").trim_end_matches('/');
        !e.is_empty()
            && (path == e
                || path.starts_with(&format!("{e}/"))
                || crate::permissions::scope_matches(e, path))
    })
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    out.push(dir.to_path_buf());
    if depth >= MAX_DEPTH {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    let mut subs: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let n = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            p.is_dir() && !n.starts_with('.') && !SKIP.contains(&n.as_str()) && !p.is_symlink()
        })
        .collect();
    subs.sort();
    for s in subs {
        walk(&s, depth + 1, out);
    }
}

fn safe_rel(p: &str) -> bool {
    let p = p.trim();
    !p.is_empty() && !p.starts_with('/') && !p.contains('\\') && !p.split('/').any(|s| s == "..")
}

/// The projects of the workspace `root`.
pub fn detect(root: &Path) -> Workspace {
    let mut notes = vec![];
    let file: WorkspaceFile = match std::fs::read_to_string(root.join(WORKSPACE_FILE)) {
        Err(_) => WorkspaceFile::default(),
        Ok(t) => serde_json::from_str(&t).unwrap_or_else(|e| {
            notes.push(format!("{WORKSPACE_FILE}: {e} — the projects are detected"));
            WorkspaceFile::default()
        }),
    };
    let folder_name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "workspace".into());
    let mut projects: Vec<WsProject> = vec![];
    if file.detect != Some(false) {
        let mut dirs = vec![];
        walk(root, 0, &mut dirs);
        for d in dirs {
            let (m, lang) = markers(&d);
            if m.is_empty() {
                continue;
            }
            let path = rel(root, &d);
            if excluded(&path, &file.exclude) {
                continue;
            }
            let (test, lint) = commands(&d, lang);
            projects.push(WsProject {
                name: if path == "." {
                    folder_name.clone()
                } else {
                    d.file_name().unwrap().to_string_lossy().into_owned()
                },
                path,
                language: lang.into(),
                markers: m,
                test,
                lint,
                declared: false,
            });
        }
    }
    for decl in &file.projects {
        let path = decl
            .path
            .trim()
            .trim_start_matches("./")
            .trim_end_matches('/');
        let path = if path.is_empty() { "." } else { path };
        if path != "." && !safe_rel(path) {
            notes.push(format!(
                "{WORKSPACE_FILE}: «{}» is not a folder inside the workspace",
                decl.path
            ));
            continue;
        }
        let dir = if path == "." {
            root.to_path_buf()
        } else {
            root.join(path)
        };
        if !dir.is_dir() {
            notes.push(format!("{WORKSPACE_FILE}: «{path}» does not exist"));
            continue;
        }
        let (m, lang) = markers(&dir);
        let (test, lint) = commands(&dir, lang);
        let p = WsProject {
            name: decl
                .name
                .clone()
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| {
                    if path == "." {
                        folder_name.clone()
                    } else {
                        dir.file_name().unwrap().to_string_lossy().into_owned()
                    }
                }),
            path: path.to_string(),
            language: lang.into(),
            markers: m,
            test: decl.test.clone().or(test),
            lint: decl.lint.clone().or(lint),
            declared: true,
        };
        match projects.iter_mut().find(|x| x.path == p.path) {
            Some(x) => *x = p,
            None => projects.push(p),
        }
    }
    if projects.is_empty() {
        // an empty or plain folder is one project: the workspace itself
        projects.push(WsProject {
            name: folder_name,
            path: ".".into(),
            language: String::new(),
            markers: vec![],
            test: None,
            lint: None,
            declared: false,
        });
    }
    projects.sort_by(|a, b| (a.path != ".", &a.path).cmp(&(b.path != ".", &b.path)));
    Workspace { projects, notes }
}

/// The project a file belongs to: the deepest one that contains it (`rel_file` relative to the workspace).
pub fn project_of<'a>(ws: &'a Workspace, rel_file: &str) -> Option<&'a WsProject> {
    let f = rel_file.trim_start_matches("./");
    ws.projects
        .iter()
        .filter(|p| p.path == "." || f == p.path || f.starts_with(&format!("{}/", p.path)))
        .max_by_key(|p| if p.path == "." { 0 } else { p.path.len() + 1 })
}

/// The block of the system prompt that tells Co-Dev the workspace's projects and which one it works in.
pub fn prompt_block(ws: &Workspace, current: Option<&str>) -> Option<String> {
    if ws.projects.len() < 2 {
        return None;
    }
    let mut out = String::from(
        "Projects of this workspace (each has its own boundaries: change files only inside the project of the request; \
         a change in another project needs the human's approval):\n",
    );
    for p in ws.projects.iter().take(MAX_IN_PROMPT) {
        let mark = if Some(p.path.as_str()) == current {
            " ← this conversation"
        } else {
            ""
        };
        let cmds = [
            p.test.as_deref().map(|t| format!("test: `{t}`")),
            p.lint.as_deref().map(|l| format!("lint: `{l}`")),
        ]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(", ");
        out.push_str(&format!(
            "- {} — `{}`{}{}{}\n",
            p.name,
            p.path,
            if p.language.is_empty() {
                String::new()
            } else {
                format!(" ({})", p.language)
            },
            if cmds.is_empty() {
                String::new()
            } else {
                format!(" — {cmds} (run inside the project folder)")
            },
            mark
        ));
    }
    if ws.projects.len() > MAX_IN_PROMPT {
        out.push_str(&format!(
            "- … and {} more ({WORKSPACE_FILE} lists or excludes them)\n",
            ws.projects.len() - MAX_IN_PROMPT
        ));
    }
    Some(out.trim_end().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    fn monorepo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let r = d.path();
        put(
            r,
            "package.json",
            r#"{"private": true, "workspaces": ["apps/*"]}"#,
        );
        put(
            r,
            "apps/web/package.json",
            r#"{"scripts": {"test": "vitest", "lint": "eslint ."}}"#,
        );
        put(r, "apps/web/pnpm-lock.yaml", "");
        put(
            r,
            "services/orders/Cargo.toml",
            "[package]\nname = \"orders\"\n",
        );
        put(r, "services/pay/go.mod", "module pay\n");
        put(r, "services/pay/node_modules/x/package.json", "{}");
        put(r, "infra/main.tf", "");
        put(
            r,
            "tools/py/pyproject.toml",
            "[project]\ndependencies = [\"pytest\", \"ruff\"]\n",
        );
        put(r, ".hidden/Cargo.toml", "");
        d
    }

    #[test]
    fn a_monorepo_has_one_project_per_manifest_with_its_commands() {
        let d = monorepo();
        let ws = detect(d.path());
        let got: Vec<(&str, &str)> = ws
            .projects
            .iter()
            .map(|p| (p.path.as_str(), p.language.as_str()))
            .collect();
        assert_eq!(
            got,
            [
                (".", "typescript"),
                ("apps/web", "typescript"),
                ("infra", "terraform"),
                ("services/orders", "rust"),
                ("services/pay", "go"),
                ("tools/py", "python")
            ]
        );
        let web = &ws.projects[1];
        assert_eq!(
            (web.test.as_deref(), web.lint.as_deref()),
            (Some("pnpm test"), Some("pnpm run lint"))
        );
        assert_eq!(
            ws.projects[0].test, None,
            "the root package.json has no test script"
        );
        let py = ws.projects.iter().find(|p| p.path == "tools/py").unwrap();
        assert_eq!(
            (py.test.as_deref(), py.lint.as_deref()),
            (Some("python3 -m pytest"), Some("ruff check ."))
        );
        assert!(ws.notes.is_empty());
    }

    #[test]
    fn the_workspace_file_declares_excludes_and_can_turn_detection_off() {
        let d = monorepo();
        put(
            d.path(),
            WORKSPACE_FILE,
            r#"{"projects": [{"path": "services/orders", "name": "Orders API", "test": "cargo test -p orders"}, {"path": "docs"}, {"path": "../x"}], "exclude": ["tools", "infra"]}"#,
        );
        std::fs::create_dir_all(d.path().join("docs")).unwrap();
        let ws = detect(d.path());
        let paths: Vec<&str> = ws.projects.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(
            paths,
            [".", "apps/web", "docs", "services/orders", "services/pay"]
        );
        let orders = ws
            .projects
            .iter()
            .find(|p| p.path == "services/orders")
            .unwrap();
        assert_eq!(
            (
                orders.name.as_str(),
                orders.test.as_deref(),
                orders.declared
            ),
            ("Orders API", Some("cargo test -p orders"), true)
        );
        assert!(
            ws.notes.iter().any(|n| n.contains("../x")),
            "{:?}",
            ws.notes
        );
        put(
            d.path(),
            WORKSPACE_FILE,
            r#"{"detect": false, "projects": [{"path": "apps/web"}]}"#,
        );
        assert_eq!(
            detect(d.path())
                .projects
                .iter()
                .map(|p| p.path.as_str())
                .collect::<Vec<_>>(),
            ["apps/web"]
        );
    }

    #[test]
    fn a_plain_folder_is_one_project_and_files_belong_to_the_deepest() {
        let empty = tempfile::tempdir().unwrap();
        let ws = detect(empty.path());
        assert_eq!(ws.projects.len(), 1);
        assert_eq!(ws.projects[0].path, ".");
        assert!(
            prompt_block(&ws, Some(".")).is_none(),
            "one project: nothing to tell"
        );
        let d = monorepo();
        let ws = detect(d.path());
        assert_eq!(
            project_of(&ws, "services/orders/src/main.rs").unwrap().path,
            "services/orders"
        );
        assert_eq!(project_of(&ws, "README.md").unwrap().path, ".");
        assert_eq!(
            project_of(&ws, "services/payments.md").unwrap().path,
            ".",
            "a prefix is not a folder"
        );
        let block = prompt_block(&ws, Some("services/orders")).unwrap();
        assert!(block.contains("- orders — `services/orders` (rust) — test: `cargo test`, lint: `cargo clippy` (run inside the project folder) ← this conversation"), "{block}");
    }
}
