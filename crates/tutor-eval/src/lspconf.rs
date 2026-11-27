//! Language server overrides (LSP P2): the user file and a project's `.dxtutor/lsp.json` merged
//! over the bundled registry ([`crate::langreg`]), and the rule that keeps a cloned repository from
//! running programs on its own.
//!
//! # Merge order
//! bundled registry → the user file (the app's config folder, `lsp.json`) → the project file
//! (`<open folder>/.dxtutor/lsp.json`). Each file is merged and validated on its own
//! ([`crate::langreg::apply_overlay`]); a file that does not pass is reported ([`FileReport`]) and
//! ignored as a whole — the layers under it stay as they were.
//!
//! # Trust
//! The user file is the user's: trusted. A project file comes with a repository. When it adds a
//! server, or changes how one starts (the [`LAUNCH_FIELDS`]: which program, found where, with which
//! arguments), that server does not start until the human approves the exact program, arguments
//! and folder ([`approval_request`]). When it changes a server's `settings` or `initOptions`
//! ([`CONFIG_FIELDS`]: a server may run a command its settings name, e.g. rust-analyzer's
//! `check.overrideCommand`), the server runs with the trusted values only ([`Effective::trusted_config`])
//! until the human approves the project's values, which the dialog shows. The approval is kept per
//! project, server and [`approval_hash`] ([`TrustStore`]): when the command, the settings or the
//! init options change, the hash changes and the server waits for a new approval. Root markers,
//! labels and the other fields run nothing and need no approval.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::langreg::{apply_overlay, parse_overlay, Registry, Server};

/// The project file, relative to the open folder.
pub const PROJECT_FILE: &str = ".dxtutor/lsp.json";

/// The user file's name, in the app's config folder.
pub const USER_FILE: &str = "lsp.json";

/// The approvals' file name, in the app's config folder (never in a project).
pub const TRUST_FILE: &str = "lsp-trusted.json";

/// An override file bigger than this is refused (a registry is a few KiB).
pub const MAX_FILE_BYTES: u64 = 512 * 1024;

/// What the language servers may use of the machine (LSP P6), from the user's file only
/// (`"resources": { "idleMinutes": 10, "maxServers": 6 }`): a server with no open document for
/// `idle_minutes` is shut down (0 = never), and at most `max_servers` run at once (the least recently
/// used one with no open document stops first; one with open documents never does).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Resources {
    #[serde(default = "default_idle_minutes")]
    pub idle_minutes: u64,
    #[serde(default = "default_max_servers")]
    pub max_servers: usize,
}

/// The idle time after which a server with no open document stops, in minutes.
pub const DEFAULT_IDLE_MINUTES: u64 = 10;
/// How many language servers may run at once.
pub const DEFAULT_MAX_SERVERS: usize = 6;
/// The longest idle time one can set (a day); 0 turns the reaping off.
pub const MAX_IDLE_MINUTES: u64 = 24 * 60;
/// The most servers one can allow at once.
pub const MAX_MAX_SERVERS: usize = 32;

fn default_idle_minutes() -> u64 {
    DEFAULT_IDLE_MINUTES
}
fn default_max_servers() -> usize {
    DEFAULT_MAX_SERVERS
}

impl Default for Resources {
    fn default() -> Self {
        Resources {
            idle_minutes: DEFAULT_IDLE_MINUTES,
            max_servers: DEFAULT_MAX_SERVERS,
        }
    }
}

/// The `resources` of an override file, checked: unknown fields, wrong types and values out of
/// range are errors (the whole file is then ignored, like any other error).
pub fn parse_resources(m: &serde_json::Map<String, Value>) -> Result<Resources, Vec<String>> {
    let r: Resources = serde_json::from_value(Value::Object(m.clone()))
        .map_err(|e| vec![format!("resources: {e}")])?;
    let mut errs = Vec::new();
    if r.idle_minutes > MAX_IDLE_MINUTES {
        errs.push(format!(
            "resources: idleMinutes is at most {MAX_IDLE_MINUTES} (a day; 0 = never stop an idle server)"
        ));
    }
    if r.max_servers == 0 || r.max_servers > MAX_MAX_SERVERS {
        errs.push(format!(
            "resources: maxServers is between 1 and {MAX_MAX_SERVERS}"
        ));
    }
    if errs.is_empty() {
        Ok(r)
    } else {
        Err(errs)
    }
}

/// The server fields that decide WHAT runs: a project that sets any of them to something else than
/// the trusted (bundled + user) value needs the human's approval before the server starts.
pub const LAUNCH_FIELDS: &[&str] = &["command", "args", "resolver", "searchDirs", "envOverride"];

/// The server fields that configure a running server: a project that sets them to something else
/// than the trusted value needs approval too; until then the server gets the trusted values.
pub const CONFIG_FIELDS: &[&str] = &["settings", "initOptions"];

/// The project file of an open folder.
pub fn project_file(root: &Path) -> PathBuf {
    root.join(PROJECT_FILE)
}

/// What a new user file holds: comments only (it changes nothing until you write an entry).
pub const USER_TEMPLATE: &str = r##"// dxtutor — your language servers (this file is yours and trusted).
// It is merged over the bundled registry (languages/registry.json); a project's .dxtutor/lsp.json
// is merged over it. Give only what you change: an entry for a known id changes just the fields you
// write ("settings" and "initOptions" merge key by key; null resets a field); an entry for a new id
// is a whole entry. Saved changes apply at once (the affected servers restart).
// Field reference: docs/lsp/overrides.md
{
  "version": 1,
  // How long a language server with no open file keeps running (minutes; 0 = until you close the
  // folder) and how many run at once (only in this file, never in a project's):
  // "resources": { "idleMinutes": 10, "maxServers": 6 },
  "languages": [
    // A new language with its own server:
    // { "id": "elixir", "name": "Elixir", "lspLanguageId": "elixir", "extensions": ["ex", "exs"],
    //   "lineComment": "#", "server": "elixir" }
  ],
  "servers": [
    // { "id": "elixir", "name": "Elixir", "label": "elixir-ls", "command": "elixir-ls",
    //   "rootMarkers": ["mix.exs"] },
    // Settings for a bundled server (sent as workspace/configuration):
    // { "id": "rust", "settings": { "rust-analyzer": { "check": { "command": "clippy" } } } }
  ]
}
"##;

/// What a new project file holds.
pub const PROJECT_TEMPLATE: &str = r##"// dxtutor — language servers for THIS project (.dxtutor/lsp.json).
// Merged over the bundled registry and your user file (Command Palette → "LSP: Open User Language
// Server Settings"). Same fields as there. It came with the repository, so you approve what it
// changes: a server this file adds, or whose command, args, resolver, searchDirs or envOverride it
// changes, does not start until you approve the exact command; settings and initOptions it gives
// are not applied (the server runs with yours) until you approve them. Field reference:
// docs/lsp/overrides.md
{
  "version": 1,
  "languages": [],
  "servers": [
    // { "id": "python", "settings": { "python": { "analysis": { "typeCheckingMode": "strict" } } } }
  ]
}
"##;

/// The state of one override file, for the UI.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReport {
    pub path: String,
    pub exists: bool,
    /// merged (false when missing or ignored)
    pub applied: bool,
    /// why the file was ignored (empty when it was merged or does not exist)
    pub errors: Vec<String>,
}

/// When a file was read (`None` = missing): a different stamp means the file changed.
pub type Stamp = Option<(SystemTime, u64)>;

/// The stamp of `p` now.
pub fn stamp(p: &Path) -> Stamp {
    let m = std::fs::metadata(p).ok()?;
    Some((m.modified().ok()?, m.len()))
}

/// Which layer an entry came from or was changed by.
pub const BUNDLED: &str = "bundled";
pub const USER: &str = "user";
pub const PROJECT: &str = "project";

/// The registry a project sees, with what it was made from.
#[derive(Debug, Clone)]
pub struct Effective {
    /// bundled + user + project: what the editor uses.
    pub registry: Registry,
    /// bundled + user: what runs without asking.
    pub trusted: Registry,
    pub user: Option<FileReport>,
    pub project: Option<FileReport>,
    /// the project folder (when there is one)
    pub root: Option<PathBuf>,
    /// the files read and their stamps at the time (see [`Effective::is_current`])
    pub stamps: Vec<(PathBuf, Stamp)>,
    /// `language:<id>` / `server:<id>` → the layers that made it, in order
    pub sources: BTreeMap<String, Vec<&'static str>>,
    /// what the servers may use of the machine: the user file's `resources`, else the defaults
    /// (a project file cannot set them)
    pub resources: Resources,
}

/// Read one override file and merge it over `base`. The report says what happened; the registry is
/// `base` when the file is missing or broken.
fn layer(
    base: &Registry,
    path: &Path,
    who: &'static str,
) -> (Registry, FileReport, Option<crate::langreg::Overlay>) {
    let mut rep = FileReport {
        path: path.display().to_string(),
        ..FileReport::default()
    };
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return (base.clone(), rep, None),
    };
    rep.exists = true;
    if !meta.is_file() {
        rep.errors.push("not a file".into());
        return (base.clone(), rep, None);
    }
    if meta.len() > MAX_FILE_BYTES {
        rep.errors.push(format!(
            "{} bytes: an override file is at most {} KiB",
            meta.len(),
            MAX_FILE_BYTES / 1024
        ));
        return (base.clone(), rep, None);
    }
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            rep.errors.push(format!("cannot read it: {e}"));
            return (base.clone(), rep, None);
        }
    };
    let merged = parse_overlay(&text)
        .and_then(|ov| check_resources(&ov, who).map(|_| ov))
        .and_then(|ov| apply_overlay(base, &ov).map(|r| (r, ov)));
    match merged {
        Ok((reg, ov)) => {
            rep.applied = true;
            (reg, rep, Some(ov))
        }
        Err(errs) => {
            rep.errors = errs;
            (base.clone(), rep, None)
        }
    }
}

/// A file's `resources`: checked in the user's file; an error in a project's (the machine is the
/// user's to share, not a cloned repository's).
fn check_resources(ov: &crate::langreg::Overlay, who: &'static str) -> Result<(), Vec<String>> {
    match &ov.resources {
        None => Ok(()),
        Some(_) if who == PROJECT => Err(vec![
            "`resources` is read only from your own lsp.json, not from a project's".into(),
        ]),
        Some(m) => parse_resources(m).map(|_| ()),
    }
}

impl Effective {
    /// `bundled`, then the user file (if given), then the project file of `project_root` (if given).
    pub fn load(bundled: &Registry, user: Option<&Path>, project_root: Option<&Path>) -> Effective {
        let mut sources: BTreeMap<String, Vec<&'static str>> = BTreeMap::new();
        for l in &bundled.languages {
            sources.insert(format!("language:{}", l.id), vec![BUNDLED]);
        }
        for s in &bundled.servers {
            sources.insert(format!("server:{}", s.id), vec![BUNDLED]);
        }
        let mut note = |ov: &crate::langreg::Overlay, who: &'static str| {
            for id in ov.language_ids() {
                sources
                    .entry(format!("language:{id}"))
                    .or_default()
                    .push(who);
            }
            for id in ov.server_ids() {
                sources.entry(format!("server:{id}")).or_default().push(who);
            }
        };
        let mut stamps = Vec::new();
        let mut resources = Resources::default();
        let (trusted, user_rep) = match user {
            Some(p) => {
                stamps.push((p.to_path_buf(), stamp(p)));
                let (reg, rep, ov) = layer(bundled, p, USER);
                if let Some(ov) = &ov {
                    note(ov, USER);
                    if let Some(Ok(r)) = ov.resources.as_ref().map(parse_resources) {
                        resources = r;
                    }
                }
                (reg, Some(rep))
            }
            None => (bundled.clone(), None),
        };
        let (registry, project_rep) = match project_root {
            Some(root) => {
                let p = project_file(root);
                stamps.push((p.clone(), stamp(&p)));
                let (reg, rep, ov) = layer(&trusted, &p, PROJECT);
                if let Some(ov) = &ov {
                    note(ov, PROJECT);
                }
                (reg, Some(rep))
            }
            None => (trusted.clone(), None),
        };
        // an entry a file names but that the merge did not keep (none today) has no source
        sources.retain(|_, v| !v.is_empty());
        Effective {
            registry,
            trusted,
            user: user_rep,
            project: project_rep,
            root: project_root.map(Path::to_path_buf),
            stamps,
            sources,
            resources,
        }
    }

    /// Have the files changed since they were read?
    pub fn is_current(&self) -> bool {
        self.stamps.iter().all(|(p, s)| stamp(p) == *s)
    }

    /// The layers that made an entry (`kind` = `language` or `server`).
    pub fn sources_of(&self, kind: &str, id: &str) -> Vec<&'static str> {
        self.sources
            .get(&format!("{kind}:{id}"))
            .cloned()
            .unwrap_or_default()
    }

    /// The launch fields the project file set to something else than the trusted value (all of
    /// them for a server the project adds); empty = the server runs as trusted.
    pub fn project_launch_changes(&self, server_id: &str) -> Vec<&'static str> {
        let Some(eff) = self.registry.server(server_id) else {
            return Vec::new();
        };
        match self.trusted.server(server_id) {
            None => LAUNCH_FIELDS.to_vec(),
            Some(t) => {
                let (a, b) = (launch_of(t), launch_of(eff));
                LAUNCH_FIELDS
                    .iter()
                    .copied()
                    .filter(|f| a.get(*f) != b.get(*f))
                    .collect()
            }
        }
    }

    /// The config fields ([`CONFIG_FIELDS`]) the project file set to something else than the
    /// trusted value (both, for a server the project adds and configures).
    pub fn project_config_changes(&self, server_id: &str) -> Vec<&'static str> {
        let Some(eff) = self.registry.server(server_id) else {
            return Vec::new();
        };
        let (ts, ti) = self.trusted_config(server_id);
        let mut out = Vec::new();
        if crate::langreg::normalize_settings(&eff.settings)
            != crate::langreg::normalize_settings(&ts)
        {
            out.push("settings");
        }
        if eff.init_options != ti {
            out.push("initOptions");
        }
        out
    }

    /// The `settings` and `initOptions` of a server without the project file (bundled + user;
    /// `null` for a server the project adds): what it runs with until the project's are approved.
    pub fn trusted_config(&self, server_id: &str) -> (Value, Value) {
        self.trusted
            .server(server_id)
            .map(|t| (t.settings.clone(), t.init_options.clone()))
            .unwrap_or((Value::Null, Value::Null))
    }
}

/// The launch fields of a server, as JSON (the resolver with its default spelled out).
fn launch_of(s: &Server) -> Value {
    json!({
        "command": s.command,
        "args": s.args,
        "resolver": s.resolver(),
        "searchDirs": s.search_dirs,
        "envOverride": s.env_override,
    })
}

/// A server a project file wants to run, waiting for the human (the approval dialog shows it all).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    /// the open folder whose `.dxtutor/lsp.json` asks
    pub project: String,
    /// the server id and how people know it
    pub server: String,
    pub label: String,
    /// the program that would run (resolved: an absolute path) and its arguments
    pub program: String,
    pub args: Vec<String>,
    /// the folder it runs in (the session root)
    pub cwd: String,
    /// the file that asked for it
    pub file: String,
    /// what the approval is bound to ([`approval_hash`])
    pub hash: String,
    /// the program lives inside the project folder (it came with the repository)
    pub inside_project: bool,
    /// the launch and config fields the project set
    pub changed: Vec<String>,
    /// the command line as the dialog and the audit log show it
    pub command: String,
    /// the project changed how the server starts: it does not start until approved. `false` = only
    /// settings/initOptions: it runs with the trusted ones until approved
    pub blocks_start: bool,
    /// the settings/initOptions the project gives, and what they replace (for the dialog and the
    /// audit log); `None` when the project changed none
    pub config: Option<String>,
}

impl Approval {
    /// What the dialog shows and the audit log records: the command line, then the project's
    /// settings/initOptions (clipped so the audit row stays under its 8 KiB).
    pub fn audit_text(&self) -> String {
        let full = match &self.config {
            Some(c) => format!("{}\n\n{}", self.command, c),
            None => self.command.clone(),
        };
        if full.len() <= AUDIT_MAX {
            return full;
        }
        let mut end = AUDIT_MAX;
        while !full.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}\n… (clipped)", &full[..end])
    }
}

/// The most the audit row's command holds here (the log takes 8 KiB).
const AUDIT_MAX: usize = 7000;

/// JSON for a person, clipped to `max` characters.
fn pretty_clipped(v: &Value, max: usize) -> String {
    let p = serde_json::to_string_pretty(v).unwrap_or_default();
    if p.chars().count() <= max {
        p
    } else {
        let mut s: String = p.chars().take(max).collect();
        s.push_str("\n… (clipped; the approval covers all of it)");
        s
    }
}

/// The config fields the project changed, as the dialog shows them.
fn config_text(eff: &Effective, server: &Server, changed: &[&str]) -> Option<String> {
    let (ts, ti) = eff.trusted_config(&server.id);
    let parts: Vec<String> = changed
        .iter()
        .map(|f| {
            let (now, was) = if *f == "settings" {
                (&server.settings, &ts)
            } else {
                (&server.init_options, &ti)
            };
            let was = if was.is_null() {
                "none".to_string()
            } else {
                pretty_clipped(was, 1200)
            };
            format!(
                "{f} from .dxtutor/lsp.json:\n{}\n(without the project: {was})",
                pretty_clipped(now, 2400)
            )
        })
        .collect();
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

/// What an approval is bound to: the project, the server, the resolved program, every launch
/// field and the effective settings and init options — and, for a program inside the project folder, its content ([`file_digest`]): a
/// repository that replaces the approved binary at the same path is asking again. A different
/// command, arguments, place to look or program file is a different hash.
pub fn approval_hash(project: &str, server: &Server, program: &str) -> String {
    let content = if Path::new(program).starts_with(project) {
        file_digest(Path::new(program))
    } else {
        String::new()
    };
    let doc = json!({
        "project": project,
        "server": server.id,
        "program": program,
        "content": content,
        "launch": launch_of(server),
        "settings": crate::langreg::normalize_settings(&server.settings),
        "initOptions": server.init_options,
    });
    let mut h = Sha256::new();
    h.update(doc.to_string().as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// The SHA-256 of a file's content (`""` when it cannot be read), remembered by path, time and size
/// so a request does not read the binary again.
pub fn file_digest(path: &Path) -> String {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<HashMap<PathBuf, (Stamp, String)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let st = stamp(path);
    if st.is_none() {
        return String::new();
    }
    if let Some((s, d)) = cache.lock().unwrap().get(path) {
        if *s == st {
            return d.clone();
        }
    }
    let digest: String = match std::fs::File::open(path) {
        Ok(mut f) => {
            let mut h = Sha256::new();
            if std::io::copy(&mut f, &mut h).is_err() {
                return String::new();
            }
            h.finalize().iter().map(|b| format!("{b:02x}")).collect()
        }
        Err(_) => return String::new(),
    };
    cache
        .lock()
        .unwrap()
        .insert(path.to_path_buf(), (st, digest.clone()));
    digest
}

/// `program args…` as a person reads it (an argument with blanks or quotes is quoted).
pub fn command_line(program: &str, args: &[String]) -> String {
    let quote = |s: &str| {
        if !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || "-_./=:,@+%~".contains(c))
        {
            s.to_string()
        } else {
            format!("'{}'", s.replace('\'', r"'\''"))
        }
    };
    std::iter::once(program)
        .chain(args.iter().map(String::as_str))
        .map(quote)
        .collect::<Vec<_>>()
        .join(" ")
}

/// The approval a server needs before it starts, or `None` when it needs none (no project file, or
/// the project did not change how it starts) or the human already approved this exact command.
pub fn approval_request(
    eff: &Effective,
    server_id: &str,
    program: &str,
    cwd: &str,
    trust: &TrustStore,
) -> Option<Approval> {
    let root = eff.root.as_ref()?;
    if !eff.project.as_ref().is_some_and(|p| p.applied) {
        return None;
    }
    let launch = eff.project_launch_changes(server_id);
    let config = eff.project_config_changes(server_id);
    if launch.is_empty() && config.is_empty() {
        return None;
    }
    let server = eff.registry.server(server_id)?;
    let project = root.display().to_string();
    let hash = approval_hash(&project, server, program);
    if trust.is_approved(&project, server_id, &hash) {
        return None;
    }
    let inside = Path::new(program).starts_with(root);
    Some(Approval {
        project,
        server: server.id.clone(),
        label: server.label.clone(),
        program: program.to_string(),
        args: server.args.clone(),
        cwd: cwd.to_string(),
        file: project_file(root).display().to_string(),
        hash,
        inside_project: inside,
        changed: launch
            .iter()
            .chain(&config)
            .map(|s| s.to_string())
            .collect(),
        command: command_line(program, &server.args),
        blocks_start: !launch.is_empty(),
        config: config_text(eff, server, &config),
    })
}

/// The approvals the human gave, in a file of the app's config folder (0600). Never in a project:
/// a repository cannot ship its own approval.
#[derive(Debug, Clone)]
pub struct TrustStore {
    path: PathBuf,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct TrustFile {
    version: u32,
    approved: Vec<TrustEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustEntry {
    project: String,
    server: String,
    hash: String,
    at: i64,
}

impl TrustStore {
    pub fn new(path: PathBuf) -> TrustStore {
        TrustStore { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The approvals on disk; a missing or broken file approves nothing.
    fn read(&self) -> TrustFile {
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or_default()
    }

    /// Did the human approve this exact command for this project?
    pub fn is_approved(&self, project: &str, server: &str, hash: &str) -> bool {
        self.read()
            .approved
            .iter()
            .any(|e| e.project == project && e.server == server && e.hash == hash)
    }

    /// Remember an approval. It replaces the one this server had in this project, so the old
    /// command needs a new approval if it ever comes back.
    pub fn approve(&self, project: &str, server: &str, hash: &str, at: i64) -> Result<(), String> {
        let mut f = self.read();
        f.version = 1;
        f.approved
            .retain(|e| !(e.project == project && e.server == server));
        f.approved.push(TrustEntry {
            project: project.into(),
            server: server.into(),
            hash: hash.into(),
            at,
        });
        self.write(&f)
    }

    /// Forget the approval of a server in a project (true when there was one).
    pub fn revoke(&self, project: &str, server: &str) -> Result<bool, String> {
        let mut f = self.read();
        let before = f.approved.len();
        f.approved
            .retain(|e| !(e.project == project && e.server == server));
        if f.approved.len() == before {
            return Ok(false);
        }
        f.version = 1;
        self.write(&f).map(|_| true)
    }

    fn write(&self, f: &TrustFile) -> Result<(), String> {
        let dir = self
            .path
            .parent()
            .ok_or("no folder for the approvals file")?;
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        let text = serde_json::to_string_pretty(f).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        }
        std::fs::rename(&tmp, &self.path).map_err(|e| format!("{}: {e}", self.path.display()))
    }
}

/// The servers whose launch fields or settings differ between two registries (for a reload: a
/// launch change restarts the server; a settings change is sent as `didChangeConfiguration`).
pub fn changed_servers(old: &Registry, new: &Registry) -> HashSet<String> {
    let ids: HashSet<&str> = old
        .servers
        .iter()
        .chain(&new.servers)
        .map(|s| s.id.as_str())
        .collect();
    ids.into_iter()
        .filter(|id| old.server(id) != new.server(id))
        .map(String::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::langreg::{self, registry, settings_section, strip_jsonc};

    fn write(p: &Path, text: &str) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    fn setup(user: Option<&str>, project: Option<&str>) -> (tempfile::TempDir, PathBuf, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let user_p = d.path().join("config/lsp.json");
        let root = d.path().join("proj");
        std::fs::create_dir_all(&root).unwrap();
        if let Some(u) = user {
            write(&user_p, u);
        }
        if let Some(p) = project {
            write(&project_file(&root), p);
        }
        (d, user_p, root)
    }

    #[test]
    fn the_templates_are_valid_override_files_that_change_nothing() {
        for t in [USER_TEMPLATE, PROJECT_TEMPLATE] {
            let ov = langreg::parse_overlay(t).unwrap();
            assert!(ov.languages.is_empty() && ov.servers.is_empty());
            let reg = langreg::apply_overlay(registry(), &ov).unwrap();
            assert_eq!(reg.servers, registry().servers);
        }
    }

    #[test]
    fn project_beats_user_beats_bundled_and_a_partial_entry_keeps_the_rest() {
        let (_d, user, root) = setup(
            Some(
                r#"{ "servers": [ { "id": "rust", "args": ["--from-user"],
                       "settings": { "rust-analyzer": { "check": { "command": "clippy" }, "a": 1 } } } ] }"#,
            ),
            Some(
                r#"{ "servers": [ { "id": "rust", "settings": { "rust-analyzer.check.extraArgs": ["--all"],
                       "rust-analyzer": { "a": null } } } ] }"#,
            ),
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.user.as_ref().unwrap().applied, "{:?}", eff.user);
        assert!(eff.project.as_ref().unwrap().applied, "{:?}", eff.project);
        let ra = eff.registry.server("rust").unwrap();
        let bundled = registry().server("rust").unwrap();
        // only what the files give changed
        assert_eq!(ra.args, ["--from-user"]);
        assert_eq!(ra.command, bundled.command);
        assert_eq!(ra.root_markers, bundled.root_markers);
        assert_eq!(ra.ready_signal, bundled.ready_signal);
        assert_eq!(ra.label, "rust-analyzer");
        // settings merge key by key, dotted keys nest, a null removes
        assert_eq!(
            ra.settings,
            json!({ "rust-analyzer": { "check": { "command": "clippy", "extraArgs": ["--all"] } } })
        );
        // the trusted layer is bundled + user only
        assert_eq!(
            eff.trusted.server("rust").unwrap().settings["rust-analyzer"]["a"],
            1
        );
        assert_eq!(eff.sources_of("server", "rust"), [BUNDLED, USER, PROJECT]);
        assert_eq!(eff.sources_of("server", "go"), [BUNDLED]);
        // the other servers are untouched
        assert_eq!(eff.registry.server("go"), registry().server("go"));
    }

    #[test]
    fn an_override_may_give_a_language_its_block_comment_and_a_broken_one_is_refused() {
        let (_d, user, root) = setup(
            Some(
                r#"{ "languages": [ { "id": "python", "blockComment": ["\"\"\"", "\"\"\""] } ] }"#,
            ),
            None,
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.user.as_ref().unwrap().applied, "{:?}", eff.user);
        let py = eff.registry.language_for_name("/w/a.py").unwrap();
        assert_eq!(
            py.block_comment,
            Some(vec!["\"\"\"".to_string(), "\"\"\"".to_string()])
        );
        assert_eq!(py.line_comment.as_deref(), Some("#"));
        write(
            &user,
            r#"{ "languages": [ { "id": "toml", "blockComment": ["/*"] } ] }"#,
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        let rep = eff.user.as_ref().unwrap();
        assert!(!rep.applied);
        assert!(
            rep.errors
                .iter()
                .any(|e| e.contains("language `toml`: blockComment must be [open, close]")),
            "{rep:?}"
        );
        let toml = eff.registry.language_for_name("/w/Cargo.toml").unwrap();
        assert_eq!(toml.block_comment, None);
    }

    #[test]
    fn a_whole_new_language_and_server_can_be_added_and_a_server_turned_off() {
        let (_d, user, root) = setup(
            Some(
                r#"// my servers
                {
                  "languages": [
                    { "id": "elixir", "name": "Elixir", "lspLanguageId": "elixir",
                      "extensions": ["ex", "exs"], "server": "elixir" }, // trailing comma next
                    { "id": "sql", "server": null },
                    { "id": "markdown", "lineComment": null },
                  ],
                  "servers": [
                    { "id": "elixir", "name": "Elixir", "label": "elixir-ls", "command": "elixir-ls",
                      "rootMarkers": ["mix.exs"] },
                    /* sqls has no language now: allowed, it came from below */
                  ]
                }"#,
            ),
            None,
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.user.as_ref().unwrap().applied, "{:?}", eff.user);
        let ex = eff.registry.language_for_name("/w/lib/A.EXS").unwrap();
        assert_eq!(
            eff.registry.server_of(ex).map(|s| s.label.as_str()),
            Some("elixir-ls")
        );
        assert_eq!(eff.sources_of("server", "elixir"), [USER]);
        // a user-added server is trusted
        assert!(eff.project_launch_changes("elixir").is_empty());
        // SQL files have no server now; the rest of the SQL entry stays
        let sql = eff.registry.language_for_name("/w/q.sql").unwrap();
        assert!(sql.server.is_none());
        assert_eq!(sql.line_comment.as_deref(), Some("--"));
        // but a NEW server that no language uses is a mistake
        write(
            &user,
            r#"{ "servers": [ { "id": "zls", "name": "Zig", "label": "zls", "command": "zls" } ] }"#,
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        let rep = eff.user.as_ref().unwrap();
        assert!(!rep.applied);
        assert!(
            rep.errors
                .iter()
                .any(|e| e.contains("server `zls`: no language uses it")),
            "{rep:?}"
        );
        assert_eq!(
            eff.registry.servers,
            registry().servers,
            "the bundled entries stay"
        );
    }

    #[test]
    fn an_invalid_file_is_ignored_with_errors_that_say_where() {
        let cases: &[(&str, &str)] = &[
            (
                r#"{ "servers": [ { "id": "rust", "comand": "x" } ] }"#,
                "servers[0] (`rust`): unknown field `comand`",
            ),
            (
                r#"{ "servers": [ { "id": "new", "command": "x" } ] }"#,
                "servers[0] (new server `new`): missing field `name`",
            ),
            (
                r#"{ "servers": [ { "id": "rust", "args": "--x" } ] }"#,
                "servers[0] (`rust`): invalid type: string \"--x\", expected a sequence",
            ),
            (
                r#"{ "languages": [ { "id": "go", "extensions": ["rs"] } ] }"#,
                "extension `rs` is also claimed by",
            ),
            (
                r#"{ "servers": [ { "id": "rust", "command": "/tmp/evil" } ] }"#,
                "command must be a bare program name",
            ),
            (
                r#"{ "servers": [ { "id": "rust", "settings": [1] } ] }"#,
                "settings must be an object",
            ),
            (
                r#"{ "servers": [ { "args": [] } ] }"#,
                "servers[0]: every entry needs an `id`",
            ),
            (
                r#"{ "servers": [ { "id": "go" }, { "id": "go" } ] }"#,
                "servers[1] (`go`): the same id twice",
            ),
            (r#"{ "languages": {} }"#, "`languages` must be a list"),
            (r#"{ "lsp": [] }"#, "unknown field `lsp`"),
            (r#"{ "version": 2 }"#, "version 2"),
            (
                "{\n  \"servers\": [\n    { \"id\": \"rust\" \n  ]\n}",
                "not valid JSON",
            ),
            ("[]", "must be a JSON object"),
        ];
        for (text, want) in cases {
            let (_d, user, root) = setup(Some(text), None);
            let eff = Effective::load(registry(), Some(&user), Some(&root));
            let rep = eff.user.clone().unwrap();
            assert!(rep.exists && !rep.applied, "{text}");
            assert_eq!(rep.path, user.display().to_string());
            assert!(
                rep.errors.iter().any(|e| e.contains(want)),
                "want «{want}» in {:?}",
                rep.errors
            );
            assert_eq!(eff.registry.servers, registry().servers, "{text}");
        }
        // the JSON error says the line
        let (_d, user, root) = setup(
            Some("{\n  \"servers\": [\n    { \"id\": \"rust\" \n  ]\n}"),
            None,
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.user.unwrap().errors[0].contains("line 4"));
        // a broken project file never breaks the user layer under it
        let (_d, user, root) = setup(
            Some(r#"{ "servers": [ { "id": "go", "args": ["-rpc.trace"] } ] }"#),
            Some(r#"{ "servers": [ { "id": "go", "nope": 1 } ] }"#),
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(!eff.project.as_ref().unwrap().applied);
        assert_eq!(eff.registry.server("go").unwrap().args, ["-rpc.trace"]);
        // a missing file is fine and reports nothing
        let (_d, user, root) = setup(None, None);
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        let rep = eff.user.unwrap();
        assert!(!rep.exists && !rep.applied && rep.errors.is_empty());
    }

    #[test]
    fn comments_and_trailing_commas_are_allowed_but_not_inside_strings() {
        let s = strip_jsonc(
            "{ \"a\": \"//not a comment, /* nor this */\", // yes\n \"b\": [1, 2, /* x */ ], }",
        );
        let v: Value = serde_json::from_str(&s).unwrap();
        assert_eq!(
            v,
            json!({ "a": "//not a comment, /* nor this */", "b": [1, 2] })
        );
        assert_eq!(
            strip_jsonc("{\n// x\n}").lines().count(),
            3,
            "lines are kept"
        );
        let v: Value = serde_json::from_str(&strip_jsonc(r#"{"q": "a\"b,]"}"#)).unwrap();
        assert_eq!(v["q"], "a\"b,]");
    }

    #[test]
    fn workspace_configuration_is_answered_by_section() {
        let settings = langreg::normalize_settings(&json!({
            "rust-analyzer": { "check": { "command": "clippy" } },
            "python.analysis.typeCheckingMode": "strict",
            "python.analysis.extraPaths": ["src"],
        }));
        assert_eq!(
            settings_section(&settings, Some("rust-analyzer.check.command")),
            json!("clippy")
        );
        assert_eq!(
            settings_section(&settings, Some("rust-analyzer")),
            json!({ "check": { "command": "clippy" } })
        );
        assert_eq!(
            settings_section(&settings, Some("python.analysis")),
            json!({ "typeCheckingMode": "strict", "extraPaths": ["src"] })
        );
        assert_eq!(settings_section(&settings, Some("gopls")), Value::Null);
        assert_eq!(
            settings_section(&settings, Some("rust-analyzer.check.command.x")),
            Value::Null
        );
        assert_eq!(settings_section(&settings, None), settings);
        assert_eq!(settings_section(&settings, Some("")), settings);
        // no settings → null for every item (what the client answered before overrides)
        assert_eq!(settings_section(&Value::Null, Some("java")), Value::Null);
        assert_eq!(settings_section(&Value::Null, None), Value::Null);
    }

    #[test]
    fn a_project_command_needs_approval_remembered_until_it_changes() {
        let d = tempfile::tempdir().unwrap();
        let trust = TrustStore::new(d.path().join("cfg").join(TRUST_FILE));
        let (_p, user, root) = setup(
            Some(r#"{ "servers": [ { "id": "go", "command": "my-gopls" } ] }"#),
            Some(r#"{ "servers": [ { "id": "python", "args": ["--stdio", "--verbose"] } ] }"#),
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        let proj = root.display().to_string();
        let program = "/usr/bin/pyright-langserver";
        // the user's own command, or a server the project does not touch: no approval
        assert!(approval_request(&eff, "go", "/x/my-gopls", &proj, &trust).is_none());
        assert!(approval_request(&eff, "rust", "/x/rust-analyzer", &proj, &trust).is_none());
        // a project that changes the arguments: approval, with everything the dialog shows
        let a = approval_request(&eff, "python", program, &proj, &trust).unwrap();
        assert_eq!(a.server, "python");
        assert_eq!(a.label, "pyright");
        assert_eq!(a.args, ["--stdio", "--verbose"]);
        assert_eq!(a.changed, ["args"]);
        assert_eq!(a.file, project_file(&root).display().to_string());
        assert_eq!(a.command, "/usr/bin/pyright-langserver --stdio --verbose");
        assert!(!a.inside_project);
        // approved → remembered (a new load reads the same file)
        trust.approve(&a.project, &a.server, &a.hash, 1).unwrap();
        assert!(approval_request(&eff, "python", program, &proj, &trust).is_none());
        let again = Effective::load(registry(), Some(&user), Some(&root));
        assert!(approval_request(&again, "python", program, &proj, &trust).is_none());
        // another program file (found elsewhere) → ask again
        assert!(approval_request(
            &eff,
            "python",
            "/elsewhere/pyright-langserver",
            &proj,
            &trust
        )
        .is_some());
        // the project changes the command → the old approval does not cover it
        write(
            &project_file(&root),
            r#"{ "servers": [ { "id": "python", "args": ["--stdio", "--evil"] } ] }"#,
        );
        assert!(!eff.is_current(), "the change is seen");
        let changed = Effective::load(registry(), Some(&user), Some(&root));
        let b = approval_request(&changed, "python", program, &proj, &trust).unwrap();
        assert_ne!(b.hash, a.hash);
        // approving the new one replaces the old one; going back needs a new approval too
        trust.approve(&b.project, &b.server, &b.hash, 2).unwrap();
        assert!(!trust.is_approved(&a.project, "python", &a.hash));
        // another project with the same file is another approval
        assert_ne!(
            approval_hash(
                "/other",
                changed.registry.server("python").unwrap(),
                program
            ),
            b.hash
        );
        // the approvals file is the user's only
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(trust.path())
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(trust.revoke(&b.project, "python").unwrap());
        assert!(!trust.revoke(&b.project, "python").unwrap());
        // a broken approvals file approves nothing
        std::fs::write(trust.path(), "{not json").unwrap();
        assert!(!trust.is_approved(&b.project, "python", &b.hash));
    }

    #[test]
    fn project_settings_and_init_options_need_approval_but_the_users_do_not() {
        let d = tempfile::tempdir().unwrap();
        let trust = TrustStore::new(d.path().join(TRUST_FILE));
        let (_p, user, root) = setup(
            Some(
                r#"{ "servers": [ { "id": "go", "settings": { "gopls": { "staticcheck": true } } } ] }"#,
            ),
            Some(
                r#"{ "servers": [
                  { "id": "rust", "settings": { "rust-analyzer.check.overrideCommand": ["sh", "-c", "evil"] } },
                  { "id": "java", "initOptions": { "extendedClientCapabilities": {} } },
                  { "id": "go", "settings": { "gopls": { "staticcheck": true } } }
                ] }"#,
            ),
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.project.as_ref().unwrap().applied, "{:?}", eff.project);
        let proj = root.display().to_string();
        // the project sets a setting that can run a command: approval, and the server still starts
        // (with the trusted settings) — the dialog shows what the project gives
        let a = approval_request(&eff, "rust", "/x/rust-analyzer", &proj, &trust).unwrap();
        assert_eq!(a.changed, ["settings"]);
        assert!(!a.blocks_start);
        let cfg = a.config.clone().unwrap();
        assert!(
            cfg.contains("overrideCommand") && cfg.contains("evil"),
            "{cfg}"
        );
        assert!(cfg.contains("without the project: none"), "{cfg}");
        assert!(a
            .audit_text()
            .starts_with("/x/rust-analyzer\n\nsettings from .dxtutor/lsp.json"));
        // a huge settings block still fits the audit row
        let mut big = a.clone();
        big.config = Some("é".repeat(9000));
        assert!(big.audit_text().len() <= AUDIT_MAX + 20);
        assert_eq!(eff.trusted_config("rust"), (Value::Null, Value::Null));
        // initOptions too; the trusted ones are the bundled ones
        let j = approval_request(&eff, "java", "/x/jdtls", &proj, &trust).unwrap();
        assert_eq!(j.changed, ["initOptions"]);
        assert!(!j.blocks_start);
        assert_eq!(
            eff.trusted_config("java").1,
            registry().server("java").unwrap().init_options
        );
        // the project repeating the user's settings changes nothing: no approval
        assert!(eff.project_config_changes("go").is_empty());
        assert!(approval_request(&eff, "go", "/x/gopls", &proj, &trust).is_none());
        // approved → remembered; the project then changes the settings → asked again
        trust.approve(&a.project, "rust", &a.hash, 1).unwrap();
        assert!(approval_request(&eff, "rust", "/x/rust-analyzer", &proj, &trust).is_none());
        write(
            &project_file(&root),
            r#"{ "servers": [ { "id": "rust", "settings": { "rust-analyzer.check.overrideCommand": ["sh", "-c", "worse"] } } ] }"#,
        );
        let changed = Effective::load(registry(), Some(&user), Some(&root));
        let b = approval_request(&changed, "rust", "/x/rust-analyzer", &proj, &trust).unwrap();
        assert_ne!(a.hash, b.hash);
        // a project that changes the command AND the settings blocks the start
        write(
            &project_file(&root),
            r#"{ "servers": [ { "id": "rust", "args": ["-v"], "settings": { "x": 1 } } ] }"#,
        );
        let both = Effective::load(registry(), Some(&user), Some(&root));
        let c = approval_request(&both, "rust", "/x/rust-analyzer", &proj, &trust).unwrap();
        assert_eq!(c.changed, ["args", "settings"]);
        assert!(c.blocks_start);
    }

    #[test]
    fn a_server_the_project_adds_needs_approval_and_says_when_it_lives_in_the_repo() {
        let d = tempfile::tempdir().unwrap();
        let trust = TrustStore::new(d.path().join(TRUST_FILE));
        let (_p, user, root) = setup(
            None,
            Some(
                r#"{ "languages": [ { "id": "zig", "lspLanguageId": "zig", "server": "zls" } ],
                     "servers": [ { "id": "zls", "name": "Zig", "label": "zls", "command": "zls",
                                    "searchDirs": ["/tmp/x/bin"] } ] }"#,
            ),
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.project.as_ref().unwrap().applied, "{:?}", eff.project);
        let program = root.join("bin/zls").display().to_string();
        write(Path::new(&program), "#!/bin/sh\necho one\n");
        let a =
            approval_request(&eff, "zls", &program, &root.display().to_string(), &trust).unwrap();
        assert_eq!(a.changed, LAUNCH_FIELDS);
        assert!(a.inside_project);
        trust.approve(&a.project, &a.server, &a.hash, 1).unwrap();
        assert!(
            approval_request(&eff, "zls", &program, &root.display().to_string(), &trust).is_none()
        );
        // the repository replaces the approved program at the same path: asked again
        write(Path::new(&program), "#!/bin/sh\necho two, longer\n");
        let b = approval_request(&eff, "zls", &program, &root.display().to_string(), &trust)
            .expect("new content, new approval");
        assert_ne!(a.hash, b.hash);
        // setting a launch field to the value it already has is no change
        write(
            &project_file(&root),
            r#"{ "servers": [ { "id": "go", "command": "gopls", "resolver": "go" } ] }"#,
        );
        let same = Effective::load(registry(), Some(&user), Some(&root));
        assert!(same.project.as_ref().unwrap().applied);
        assert!(same.project_launch_changes("go").is_empty());
        // without a project file nothing needs approval
        let none = Effective::load(registry(), Some(&user), None);
        assert!(approval_request(&none, "go", "/x/gopls", "/w", &trust).is_none());
    }

    #[test]
    fn a_reload_knows_which_servers_changed() {
        let (_d, user, root) = setup(None, None);
        let before = Effective::load(registry(), Some(&user), Some(&root));
        write(
            &user,
            r#"{ "servers": [ { "id": "go", "settings": { "gopls": { "staticcheck": true } } } ] }"#,
        );
        assert!(!before.is_current());
        let after = Effective::load(registry(), Some(&user), Some(&root));
        assert!(after.is_current());
        assert_eq!(
            changed_servers(&before.registry, &after.registry),
            ["go".to_string()].into()
        );
        assert!(changed_servers(&after.registry, &after.registry).is_empty());
    }

    #[test]
    fn the_command_line_quotes_what_needs_quoting() {
        assert_eq!(
            command_line("/usr/bin/x", &["--stdio".into()]),
            "/usr/bin/x --stdio"
        );
        assert_eq!(
            command_line("/a b/x", &["it's".into(), "".into()]),
            r"'/a b/x' 'it'\''s' ''"
        );
    }

    #[test]
    fn resources_come_from_the_user_file_only_and_are_checked() {
        // no file, or a file without them: the defaults
        let (_d, user, root) = setup(None, None);
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert_eq!(eff.resources, Resources::default());
        assert_eq!(
            (eff.resources.idle_minutes, eff.resources.max_servers),
            (10, 6)
        );
        // the user's own, partial: the other field keeps its default
        let (_d, user, root) = setup(Some(r#"{ "resources": { "maxServers": 2 } }"#), None);
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.user.as_ref().unwrap().applied);
        assert_eq!(
            eff.resources,
            Resources {
                idle_minutes: 10,
                max_servers: 2
            }
        );
        let (_d, user, root) = setup(Some(r#"{ "resources": { "idleMinutes": 0 } }"#), None);
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert_eq!(
            eff.resources.idle_minutes, 0,
            "0 = never stop an idle server"
        );
        // wrong values make the whole file ignored, with the reason
        for (text, want) in [
            (
                r#"{ "resources": { "maxServers": 0 } }"#,
                "maxServers is between 1 and 32",
            ),
            (
                r#"{ "resources": { "maxServers": 33 } }"#,
                "maxServers is between 1 and 32",
            ),
            (
                r#"{ "resources": { "idleMinutes": 1441 } }"#,
                "idleMinutes is at most 1440",
            ),
            (
                r#"{ "resources": { "idleMinutes": -1 } }"#,
                "resources: invalid value",
            ),
            (
                r#"{ "resources": { "idle": 5 } }"#,
                "resources: unknown field `idle`",
            ),
            (r#"{ "resources": 5 }"#, "`resources` must be an object"),
        ] {
            let (_d, user, root) = setup(Some(text), None);
            let eff = Effective::load(registry(), Some(&user), Some(&root));
            let rep = eff.user.clone().unwrap();
            assert!(!rep.applied, "{text}");
            assert!(
                rep.errors.iter().any(|e| e.contains(want)),
                "want «{want}» in {:?}",
                rep.errors
            );
            assert_eq!(eff.resources, Resources::default(), "{text}");
        }
        // a project file cannot set them: it is ignored, and the user's stay
        let (_d, user, root) = setup(
            Some(r#"{ "resources": { "maxServers": 3 } }"#),
            Some(r#"{ "resources": { "maxServers": 30 } }"#),
        );
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        let rep = eff.project.clone().unwrap();
        assert!(!rep.applied);
        assert!(rep.errors[0].contains("only from your own lsp.json"));
        assert_eq!(eff.resources.max_servers, 3);
        // the template's commented line, uncommented, is a valid file
        let line = USER_TEMPLATE
            .lines()
            .find(|l| l.contains("\"resources\""))
            .unwrap()
            .trim()
            .trim_start_matches("//")
            .trim()
            .trim_end_matches(',');
        let (_d, user, root) = setup(Some(&format!("{{ {line} }}")), None);
        let eff = Effective::load(registry(), Some(&user), Some(&root));
        assert!(eff.user.unwrap().applied);
        assert_eq!(eff.resources, Resources::default());
    }
}
