//! «New Project»: the project templates of Delonix (`delonix init -t <template>`), embedded, and the
//! rules that turn one into a new project folder — the same as Delonix's `scaffold.rs`:
//!
//! - the project **name** becomes a container name, an image tag and a package/module name at once,
//!   so it must be a DNS label (lowercase letters, digits, inner hyphens, ≤ 63);
//! - a **version** (`-v`) is a plain `1`, `1.2` or `1.2.3`, inside the template's `versions=` when it
//!   lists them; a template without `version=` takes none;
//! - the tokens `__NAME__`, `__MODULE__` (the Python module of the name), `__PORT__`, `__TLS_PORT__`,
//!   `__TEMPLATE_VERSION__` and `__DISTROLESS_REGISTRY__` are replaced in the contents AND the paths;
//! - `template.meta` is not written; `.env.tmpl` is not written as is: it becomes `.env` (0600) with a
//!   fresh random value per `__SECRET_<NAME>__` (the same name, the same value) and per `{random32}`;
//! - the folder must be new or empty (no adoption here), and the project starts as a git repository
//!   on `main` with one commit, `chore: scaffold`.
//!
//! The templates are copied from Delonix as they are (`scripts/sync-delonix-templates.sh`,
//! `templates/projects/SOURCE`): change them there.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

include!(concat!(env!("OUT_DIR"), "/templates.rs"));

/// The default distroless registry (Delonix's `DEFAULT_DISTROLESS_REGISTRY`); the environment
/// variable `DELONIX_DISTROLESS_REGISTRY` overrides it, as in Delonix.
pub const DEFAULT_DISTROLESS_REGISTRY: &str = "gcr.io/distroless";
pub const DISTROLESS_REGISTRY_ENV: &str = "DELONIX_DISTROLESS_REGISTRY";
/// The commit message of the first commit (Delonix's).
pub const SCAFFOLD_COMMIT: &str = "chore: scaffold";

/// What the IDE shows for each template: the group of the New Project dialog, the language it is
/// written in, an icon and one sentence. A template copied from Delonix with no row here still works
/// (it shows in «Other»); the test `every_template_has_a_catalog_row` asks for one.
const CATALOG: &[(&str, &str, &str, &str, &str, &str)] = &[
    // (id, name, group, language, icon, summary)
    (
        "rust",
        "Rust",
        "language",
        "rust",
        "🦀",
        "A JSON API in Rust with axum and tokio: tests, OpenAPI, observability and CI.",
    ),
    (
        "go",
        "Go",
        "language",
        "go",
        "💪",
        "A Go HTTP service on the standard library: tests, OpenAPI, observability and CI.",
    ),
    (
        "node",
        "Node.js",
        "language",
        "typescript",
        "🟩",
        "A Node.js HTTP service in TypeScript with Fastify: tests, OpenAPI and CI.",
    ),
    (
        "fastapi",
        "FastAPI",
        "framework",
        "python",
        "⚡",
        "A FastAPI service in Python: notes API, webhooks, cache, messaging, tests and CI.",
    ),
    (
        "django",
        "Django",
        "framework",
        "python",
        "🎸",
        "A Django JSON service: notes API, webhooks, messaging, tests and CI.",
    ),
    (
        "nestjs",
        "NestJS",
        "framework",
        "typescript",
        "🐈",
        "A NestJS HTTP service in TypeScript: modules, tests, OpenAPI and CI.",
    ),
    (
        "nextjs",
        "Next.js",
        "framework",
        "typescript",
        "▲",
        "A Next.js application in TypeScript with an API, tests and CI.",
    ),
    (
        "laravel",
        "Laravel",
        "framework",
        "php",
        "🟥",
        "A Laravel HTTP service in PHP: notes API, architecture tests and CI.",
    ),
    (
        "nginx",
        "nginx",
        "server",
        "nginx",
        "🌐",
        "An nginx edge: reverse proxy, TLS and health check.",
    ),
    (
        "httpd",
        "Apache httpd",
        "server",
        "apache",
        "🪶",
        "An Apache httpd edge: reverse proxy, TLS and health check.",
    ),
    (
        "haproxy",
        "HAProxy",
        "server",
        "haproxy",
        "⚖️",
        "An HAProxy L7 reverse proxy and load balancer with TLS.",
    ),
    (
        "odoo",
        "Odoo",
        "app",
        "python",
        "🟪",
        "An Odoo stack with PostgreSQL, ready to install modules.",
    ),
    (
        "wordpress",
        "WordPress",
        "app",
        "php",
        "📝",
        "A WordPress stack with its database.",
    ),
];

/// What a name typed as a template means (Delonix's `TEMPLATE_ALIASES`).
const ALIASES: &[(&str, &str)] = &[("python", "fastapi")];

/// The keys a `template.meta` may have (Delonix's `build.rs` refuses any other).
pub const META_KEYS: &[&str] = &[
    "port",
    "health",
    "version",
    "versions",
    "lock",
    "wait",
    "tls",
    "tls_redirect",
    "tls_key_mode",
    "open",
    "login",
    "password",
    "up_secret",
    "vm_support",
];

/// One template of the New Project dialog.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    /// `language`, `framework`, `server`, `app` or `other`.
    pub group: String,
    pub language: String,
    pub icon: String,
    pub summary: String,
    /// The default version (`""`: the template takes none).
    pub version: String,
    /// The versions it is validated with (empty: any plain version).
    pub versions: Vec<String>,
    pub port: String,
    /// The HTTPS port, when it serves TLS.
    pub tls_port: Option<String>,
    /// The path that answers when the service is up.
    pub health: String,
    pub files: usize,
}

/// A `template.meta`, read (`key=value` lines, `#` comments).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Meta {
    pub pairs: Vec<(String, String)>,
}

impl Meta {
    pub fn parse(text: &str) -> Meta {
        let pairs = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .filter_map(|l| l.split_once('='))
            .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
            .collect();
        Meta { pairs }
    }
    pub fn get(&self, key: &str) -> Option<&str> {
        self.pairs
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }
    pub fn port(&self) -> &str {
        self.get("port").unwrap_or("8000")
    }
    pub fn health(&self) -> &str {
        self.get("health").unwrap_or("/api/v1/health/live")
    }
    pub fn version(&self) -> &str {
        self.get("version").unwrap_or("")
    }
    pub fn versions(&self) -> Vec<String> {
        self.get("versions")
            .unwrap_or("")
            .split(',')
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .map(String::from)
            .collect()
    }
}

type Files = &'static [(&'static str, &'static str, bool)];

fn canonical(name: &str) -> &str {
    ALIASES
        .iter()
        .find(|(a, _)| *a == name)
        .map(|(_, t)| *t)
        .unwrap_or(name)
}

fn files_of(template: &str) -> Option<Files> {
    TEMPLATES
        .iter()
        .find(|(n, _)| *n == template)
        .map(|(_, f)| *f)
}

fn meta_of(files: Files) -> Meta {
    files
        .iter()
        .find(|(rel, _, _)| *rel == "template.meta")
        .map(|(_, text, _)| Meta::parse(text))
        .unwrap_or_default()
}

/// The ids of the embedded templates.
pub fn template_ids() -> Vec<&'static str> {
    TEMPLATES.iter().map(|(n, _)| *n).collect()
}

/// The New Project catalog: every embedded template, in the catalog's order (unknown ones last).
pub fn catalog() -> Vec<TemplateInfo> {
    let mut out: Vec<TemplateInfo> = TEMPLATES
        .iter()
        .map(|(id, files)| {
            let meta = meta_of(files);
            let row = CATALOG.iter().find(|r| r.0 == *id);
            let (name, group, language, icon, summary) = match row {
                Some(r) => (r.1, r.2, r.3, r.4, r.5),
                None => (*id, "other", "", "📦", ""),
            };
            TemplateInfo {
                id: id.to_string(),
                name: name.into(),
                group: group.into(),
                language: language.into(),
                icon: icon.into(),
                summary: summary.into(),
                version: meta.version().into(),
                versions: meta.versions(),
                port: meta.port().into(),
                tls_port: meta.get("tls").map(String::from),
                health: meta.health().into(),
                files: files
                    .iter()
                    .filter(|(r, _, _)| *r != "template.meta")
                    .count(),
            }
        })
        .collect();
    let rank = |id: &str| {
        CATALOG
            .iter()
            .position(|r| r.0 == id)
            .unwrap_or(CATALOG.len())
    };
    out.sort_by_key(|t| rank(&t.id));
    out
}

/// A project name is a DNS label: lowercase letters, digits and inner hyphens, at most 63 — it
/// becomes a container name, an image tag and a package name at once (Delonix's rule).
pub fn check_project_name(name: &str) -> Result<(), String> {
    let b = name.as_bytes();
    let ok = !b.is_empty()
        && b.len() <= 63
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && b[0] != b'-'
        && b[b.len() - 1] != b'-';
    if ok {
        Ok(())
    } else {
        Err(format!(
            "the project name «{name}» must be lowercase letters, digits and inner hyphens (at most 63) — e.g. {}",
            slug(name)
        ))
    }
}

/// The nearest valid project name.
pub fn slug(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(63).collect();
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() {
        "app".into()
    } else {
        out
    }
}

/// A version is a plain `1`, `1.2` or `1.2.3` (it goes into manifests and a `FROM` line), and inside
/// the template's list when it has one (`1.2` and `1.2.x` are inside `1.2`).
pub fn check_version(template: &str, v: &str, accepted: &[String]) -> Result<(), String> {
    let plain = !v.is_empty()
        && v.split('.').count() <= 3
        && v.split('.')
            .all(|p| !p.is_empty() && p.len() <= 6 && p.bytes().all(|c| c.is_ascii_digit()));
    if !plain {
        return Err(format!(
            "the version «{v}» is not a plain version (1, 1.2 or 1.2.3)"
        ));
    }
    if accepted.is_empty()
        || accepted.iter().any(|a| {
            v == a
                || v.strip_prefix(a.as_str())
                    .is_some_and(|r| r.starts_with('.'))
        })
    {
        Ok(())
    } else {
        Err(format!(
            "the template «{template}» is validated with {}; «{v}» is outside that",
            accepted.join(", ")
        ))
    }
}

/// The Python module of a project name: `[a-z0-9_]`, never starting with a digit.
pub fn python_module(name: &str) -> String {
    let mut m: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    if m.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(true) {
        m.insert(0, 'a');
    }
    m
}

/// What to create.
#[derive(Debug, Clone)]
pub struct Request {
    pub template: String,
    pub name: String,
    /// `None`: the template's default.
    pub version: Option<String>,
    /// The distroless registry baked into the image recipes.
    pub registry: String,
}

impl Request {
    pub fn new(template: &str, name: &str, version: Option<&str>) -> Self {
        Request {
            template: template.into(),
            name: name.into(),
            version: version
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(String::from),
            registry: std::env::var(DISTROLESS_REGISTRY_ENV)
                .ok()
                .map(|r| r.trim().trim_end_matches('/').to_string())
                .filter(|r| !r.is_empty())
                .unwrap_or_else(|| DEFAULT_DISTROLESS_REGISTRY.into()),
        }
    }
}

/// One file to write.
#[derive(Debug, Clone, PartialEq)]
pub struct OutFile {
    pub rel: String,
    pub content: String,
    pub exec: bool,
}

/// The project, rendered in memory (nothing written yet).
#[derive(Debug, Clone)]
pub struct Rendered {
    pub template: String,
    pub version: String,
    pub port: String,
    pub tls_port: Option<String>,
    pub health: String,
    pub files: Vec<OutFile>,
    /// The `.env` (from `.env.tmpl`, secrets filled), when the template has one.
    pub env: Option<String>,
    /// The lock file of the template's package manager (`uv.lock`, `pnpm-lock.yaml`…), if any.
    pub lock: Option<String>,
}

/// Renders the project. `random(n)` gives `n` random bytes (the secrets of `.env`).
pub fn render(
    req: &Request,
    random: &mut dyn FnMut(usize) -> Result<Vec<u8>, String>,
) -> Result<Rendered, String> {
    let template = canonical(req.template.trim());
    let files = files_of(template).ok_or_else(|| {
        format!(
            "the template «{template}» does not exist — available: {}",
            template_ids().join(", ")
        )
    })?;
    check_project_name(&req.name)?;
    let meta = meta_of(files);
    let version = match (req.version.as_deref(), meta.version()) {
        (Some(_), "") => return Err(format!("the template «{template}» takes no version")),
        (Some(v), _) => {
            check_version(template, v, &meta.versions())?;
            v.to_string()
        }
        (None, d) => d.to_string(),
    };
    let module = python_module(&req.name);
    let port = meta.port().to_string();
    let tls_port = meta.get("tls").map(String::from);
    let subst = |s: &str| -> String {
        s.replace("__NAME__", &req.name)
            .replace("__MODULE__", &module)
            .replace("__TLS_PORT__", tls_port.as_deref().unwrap_or(""))
            .replace("__PORT__", &port)
            .replace("__TEMPLATE_VERSION__", &version)
            .replace("__DISTROLESS_REGISTRY__", &req.registry)
    };
    let mut out = vec![];
    let mut env = None;
    for (rel, content, exec) in files {
        if *rel == "template.meta" {
            continue;
        }
        let rel = subst(rel);
        let content = subst(content);
        if Path::new(&rel).file_name().and_then(|n| n.to_str()) == Some(".env.tmpl") {
            env = Some(fill_secrets(&content, random)?);
            continue;
        }
        if !safe_rel(&rel) {
            return Err(format!("the template has an unsafe path: {rel}"));
        }
        out.push(OutFile {
            rel,
            content,
            exec: *exec,
        });
    }
    Ok(Rendered {
        template: template.into(),
        version,
        port,
        tls_port,
        health: meta.health().into(),
        files: out,
        env,
        lock: meta.get("lock").filter(|l| !l.is_empty()).map(String::from),
    })
}

fn safe_rel(rel: &str) -> bool {
    !rel.is_empty()
        && !rel.starts_with('/')
        && !rel.contains('\\')
        && rel
            .split('/')
            .all(|s| !s.is_empty() && s != "." && s != "..")
}

/// Every `__SECRET_<NAME>__` becomes a fresh URL-safe value (the same name, the same value — a
/// password in a URL and in the service's variable match); every `{random32}` an independent 32-byte
/// key in standard base64 (Laravel's `APP_KEY=base64:…`). As Delonix's `fill_env_secrets`.
pub fn fill_secrets(
    template: &str,
    random: &mut dyn FnMut(usize) -> Result<Vec<u8>, String>,
) -> Result<String, String> {
    use base64::Engine;
    let mut names: Vec<String> = vec![];
    let mut rest = template;
    while let Some(p) = rest.find("__SECRET_") {
        let body = &rest[p + "__SECRET_".len()..];
        let Some(end) = body.find("__") else { break };
        let name = body[..end].to_string();
        if !names.contains(&name) {
            names.push(name);
        }
        rest = &body[end + 2..];
    }
    let mut out = template.to_string();
    for name in names {
        let v = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random(24)?);
        out = out.replace(&format!("__SECRET_{name}__"), &v);
    }
    while out.contains("{random32}") {
        let v = base64::engine::general_purpose::STANDARD.encode(random(32)?);
        out = out.replacen("{random32}", &v, 1);
    }
    Ok(out)
}

/// Random bytes from the operating system (no fallback: a secret that is not random is worse than an
/// error).
pub fn os_random(n: usize) -> Result<Vec<u8>, String> {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).map_err(|e| format!("no random source: {e}"))?;
    Ok(b)
}

/// Where the project goes: `<parent>/<name>`, a folder that does not exist yet or is empty.
pub fn target_dir(parent: &Path, name: &str) -> Result<PathBuf, String> {
    check_project_name(name)?;
    if !parent.is_absolute() {
        return Err(format!(
            "the parent folder must be an absolute path: {}",
            parent.display()
        ));
    }
    if !parent.is_dir() {
        return Err(format!(
            "the parent folder does not exist: {}",
            parent.display()
        ));
    }
    let dir = parent.join(name);
    if std::fs::symlink_metadata(&dir).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(format!("{} is a symbolic link", dir.display()));
    }
    if dir.exists() {
        let empty = std::fs::read_dir(&dir)
            .map(|mut d| d.next().is_none())
            .unwrap_or(false);
        if !dir.is_dir() || !empty {
            return Err(format!(
                "{} already exists and is not an empty folder — choose another name",
                dir.display()
            ));
        }
    }
    Ok(dir)
}

/// Writes a rendered project into `dir` (new or empty): every file with its mode, `.env` 0600.
/// Returns how many files were written.
pub fn write(dir: &Path, r: &Rendered) -> Result<usize, String> {
    let io = |e: std::io::Error, p: &Path| format!("{}: {e}", p.display());
    std::fs::create_dir_all(dir).map_err(|e| io(e, dir))?;
    let mut n = 0;
    for f in &r.files {
        let p = dir.join(&f.rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| io(e, parent))?;
        }
        std::fs::write(&p, &f.content).map_err(|e| io(e, &p))?;
        #[cfg(unix)]
        if f.exec {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755))
                .map_err(|e| io(e, &p))?;
        }
        n += 1;
    }
    if let Some(env) = &r.env {
        let p = dir.join(".env");
        write_private(&p, env.as_bytes()).map_err(|e| io(e, &p))?;
        n += 1;
    }
    Ok(n)
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o.open(path)?.write_all(bytes)
}

/// How the first commit went.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GitOutcome {
    /// A repository on `main` with one commit.
    Committed,
    /// The folder is inside another repository: no nested one.
    InsideRepository,
    /// Created and staged, but the commit needs `user.name`/`user.email`.
    NeedsAuthor,
    /// git is not usable, or a step failed (git's own words).
    Failed { detail: String },
}

/// `git init` on `main`, add everything, `chore: scaffold` — as Delonix. `git()` makes a `git` command
/// (the app passes one with the login shell's PATH).
pub fn git_init(dir: &Path, git: &dyn Fn() -> Command) -> GitOutcome {
    let run = |args: &[&str]| {
        let mut c = git();
        c.arg("-C").arg(dir).args(args);
        c.output().ok()
    };
    let ok = |o: &Option<std::process::Output>| o.as_ref().is_some_and(|o| o.status.success());
    if !ok(&{
        let mut c = git();
        c.arg("--version");
        c.output().ok()
    }) {
        return GitOutcome::Failed {
            detail: "git is not available".into(),
        };
    }
    if dir.join(".git").exists() {
        return GitOutcome::Committed;
    }
    if ok(&run(&["rev-parse", "--is-inside-work-tree"])) {
        return GitOutcome::InsideRepository;
    }
    let init = ok(&run(&["init", "--initial-branch=main"]))
        || (ok(&run(&["init"])) && ok(&run(&["symbolic-ref", "HEAD", "refs/heads/main"])));
    if !init {
        return GitOutcome::Failed {
            detail: "git init failed".into(),
        };
    }
    if !ok(&run(&["add", "-A"])) {
        return GitOutcome::Failed {
            detail: "the files could not be staged".into(),
        };
    }
    let out = run(&["commit", "-m", SCAFFOLD_COMMIT]);
    if ok(&out) {
        return GitOutcome::Committed;
    }
    let has =
        |k: &str| run(&["config", k]).is_some_and(|o| o.status.success() && !o.stdout.is_empty());
    if !has("user.email") || !has("user.name") {
        return GitOutcome::NeedsAuthor;
    }
    let detail = out
        .map(|o| {
            String::from_utf8_lossy(&o.stderr)
                .lines()
                .find(|l| !l.trim().is_empty())
                .unwrap_or("")
                .trim()
                .to_string()
        })
        .unwrap_or_default();
    GitOutcome::Failed { detail }
}

/// The command that produces a template's lock file against the version just written (Delonix's
/// `generate_lockfile`): `(program, args)`, or `None` for a lock the generator does not know.
pub fn lock_command(lock: &str) -> Option<(&'static str, &'static [&'static str])> {
    match lock {
        "uv.lock" => Some(("uv", &["lock"])),
        "pnpm-lock.yaml" => Some(("pnpm", &["install", "--lockfile-only", "--ignore-scripts"])),
        "Cargo.lock" => Some(("cargo", &["generate-lockfile"])),
        "composer.lock" => Some((
            "composer",
            &[
                "update",
                "--no-install",
                "--no-interaction",
                "--no-progress",
            ],
        )),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn zeros(n: usize) -> Result<Vec<u8>, String> {
        Ok(vec![7u8; n])
    }

    fn counter() -> impl FnMut(usize) -> Result<Vec<u8>, String> {
        let mut k = 0u8;
        move |n| {
            k = k.wrapping_add(1);
            Ok(vec![k; n])
        }
    }

    #[test]
    fn the_thirteen_delonix_templates_are_embedded_with_their_files() {
        assert_eq!(
            template_ids(),
            [
                "django",
                "fastapi",
                "go",
                "haproxy",
                "httpd",
                "laravel",
                "nestjs",
                "nextjs",
                "nginx",
                "node",
                "odoo",
                "rust",
                "wordpress"
            ]
        );
        let fa = files_of("fastapi").unwrap();
        assert!(fa.iter().any(|(r, _, _)| *r == "src/__MODULE__/app.py"));
        assert!(
            fa.iter().any(|(r, _, x)| *r == "scripts/smoke.sh" && *x),
            "smoke.sh is executable"
        );
    }

    #[test]
    fn every_template_has_a_catalog_row_and_a_known_meta() {
        for (id, files) in TEMPLATES {
            assert!(
                CATALOG.iter().any(|r| r.0 == *id),
                "no catalog row for {id}"
            );
            for (k, _) in meta_of(files).pairs {
                assert!(
                    META_KEYS.contains(&k.as_str()),
                    "{id}: unknown template.meta key {k}"
                );
            }
        }
        let c = catalog();
        assert_eq!(c[0].id, "rust");
        let fa = c.iter().find(|t| t.id == "fastapi").unwrap();
        assert_eq!(
            (fa.group.as_str(), fa.language.as_str()),
            ("framework", "python")
        );
        assert_eq!(fa.versions, ["0.141", "0.142"]);
        assert_eq!(fa.tls_port.as_deref(), Some("8443"));
        assert!(fa.files > 50);
    }

    #[test]
    fn names_and_versions_follow_delonix() {
        assert!(check_project_name("shop-api").is_ok());
        for bad in ["", "Shop", "-a", "a-", "a_b", "a b", &"x".repeat(64)] {
            assert!(check_project_name(bad).is_err(), "{bad}");
        }
        assert_eq!(slug("My Shop_API!"), "my-shop-api");
        assert_eq!(python_module("9-lives"), "a9_lives");
        let v = vec!["5.2".to_string(), "6.0".to_string()];
        assert!(check_version("django", "5.2", &v).is_ok());
        assert!(check_version("django", "5.2.3", &v).is_ok());
        assert!(check_version("django", "5.20", &v).is_err());
        assert!(check_version("django", "5.2\", \"evil==1", &v).is_err());
        assert!(check_version("nginx", "1.31", &[]).is_ok());
    }

    #[test]
    fn rendering_replaces_every_token_in_paths_and_contents() {
        let r = render(&Request::new("python", "shop-api", None), &mut zeros).unwrap();
        assert_eq!(
            (r.template.as_str(), r.version.as_str()),
            ("fastapi", "0.142")
        );
        assert!(r.files.iter().any(|f| f.rel == "src/shop_api/app.py"));
        assert!(!r
            .files
            .iter()
            .any(|f| f.rel == "template.meta" || f.rel.ends_with(".env.tmpl")));
        let readme = &r
            .files
            .iter()
            .find(|f| f.rel == "README.md")
            .unwrap()
            .content;
        assert!(readme.starts_with("# shop-api"), "{readme}");
        assert!(r.env.is_some());
        assert_eq!(r.lock.as_deref(), Some("uv.lock"));
        // no Delonix token is left in any template (PHP's own __DIR__ is not one)
        for id in template_ids() {
            let r = render(&Request::new(id, "demo", None), &mut zeros).unwrap();
            for f in r
                .files
                .iter()
                .map(|f| (&f.rel, &f.content))
                .chain(r.env.iter().map(|e| (&r.template, e)))
            {
                for tok in [
                    "__NAME__",
                    "__MODULE__",
                    "__PORT__",
                    "__TLS_PORT__",
                    "__TEMPLATE_VERSION__",
                    "__DISTROLESS_REGISTRY__",
                    "__SECRET_",
                    "{random32}",
                ] {
                    assert!(
                        !f.0.contains(tok) && !f.1.contains(tok),
                        "{id}: {tok} left in {}",
                        f.0
                    );
                }
            }
        }
    }

    #[test]
    fn a_version_is_checked_and_written() {
        let r = render(&Request::new("django", "shop", Some("6.0")), &mut zeros).unwrap();
        assert_eq!(r.version, "6.0");
        let e = render(&Request::new("django", "shop", Some("4.2")), &mut zeros).unwrap_err();
        assert!(e.contains("validated with 5.2, 6.0, 6.1"), "{e}");
        assert!(render(&Request::new("nope", "shop", None), &mut zeros)
            .unwrap_err()
            .contains("available"));
        assert!(render(&Request::new("rust", "Shop", None), &mut zeros).is_err());
    }

    #[test]
    fn secrets_are_random_per_name_and_the_same_for_the_same_name() {
        let t = "A=__SECRET_DB__\nB=postgres://u:__SECRET_DB__@h\nC=__SECRET_MQ__\nK=base64:{random32}\nL=base64:{random32}\n";
        let s = fill_secrets(t, &mut counter()).unwrap();
        let v: Vec<&str> = s.lines().map(|l| l.split_once('=').unwrap().1).collect();
        assert!(v[1].ends_with(&format!("{}@h", v[0])));
        assert_ne!(v[0], v[2]);
        assert_ne!(v[3], v[4]);
        assert!(!s.contains("__SECRET_") && !s.contains("{random32}"));
        let laravel = render(&Request::new("laravel", "shop", None), &mut counter()).unwrap();
        assert!(laravel.env.unwrap().contains("APP_KEY=base64:"));
    }

    #[test]
    fn the_project_is_written_with_modes_and_a_private_env_then_committed() {
        let parent = tempfile::tempdir().unwrap();
        let dir = target_dir(parent.path(), "shop-api").unwrap();
        let r = render(&Request::new("go", "shop-api", None), &mut zeros).unwrap();
        let n = write(&dir, &r).unwrap();
        assert_eq!(n, r.files.len() + usize::from(r.env.is_some()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode =
                |p: &str| std::fs::metadata(dir.join(p)).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode("scripts/smoke.sh"), 0o755);
            if r.env.is_some() {
                assert_eq!(mode(".env"), 0o600);
            }
        }
        // the folder is no longer empty: another project cannot go there
        assert!(target_dir(parent.path(), "shop-api")
            .unwrap_err()
            .contains("already exists"));
        let git = || {
            let mut c = Command::new("git");
            c.env("GIT_AUTHOR_NAME", "t")
                .env("GIT_AUTHOR_EMAIL", "t@e")
                .env("GIT_COMMITTER_NAME", "t")
                .env("GIT_COMMITTER_EMAIL", "t@e");
            c
        };
        assert_eq!(git_init(&dir, &git), GitOutcome::Committed);
        let log = git()
            .args(["-C", dir.to_str().unwrap(), "log", "--format=%s", "-1"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&log.stdout).trim(), SCAFFOLD_COMMIT);
        let branch = git()
            .args(["-C", dir.to_str().unwrap(), "branch", "--show-current"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&branch.stdout).trim(), "main");
        // .env never goes into the commit (the template's .gitignore)
        let tracked = git()
            .args(["-C", dir.to_str().unwrap(), "ls-files", ".env"])
            .output()
            .unwrap();
        assert!(tracked.stdout.is_empty());
    }

    #[test]
    fn the_target_must_be_new_or_empty_under_an_absolute_parent() {
        let parent = tempfile::tempdir().unwrap();
        assert!(target_dir(Path::new("rel"), "a").is_err());
        assert!(target_dir(&parent.path().join("nope"), "a").is_err());
        std::fs::create_dir(parent.path().join("empty")).unwrap();
        assert!(target_dir(parent.path(), "empty").is_ok());
        assert!(target_dir(parent.path(), "Bad Name").is_err());
    }

    #[test]
    fn lock_commands_are_delonix_s() {
        assert_eq!(lock_command("uv.lock").unwrap().0, "uv");
        assert_eq!(lock_command("Cargo.lock").unwrap().1, ["generate-lockfile"]);
        assert!(lock_command("yarn.lock").is_none());
    }
}
