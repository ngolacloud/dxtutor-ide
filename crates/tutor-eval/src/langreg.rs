//! The language registry: ONE data file (`languages/registry.json`, at the repo root) that says,
//! for every language the IDE knows, how to recognise its files and, for those with a language
//! server, how to start and talk to it. The backend embeds it here (`include_str!`); the UI
//! imports the very same file through Vite (`ui-app/src/features/lsp/domain/registry.ts`), so
//! the browser build needs no backend call and the two sides cannot drift.
//!
//! Before this file the same knowledge lived in nine hand-copied tables (the LSP client, the
//! one-shot client below it, the agent's outline tool, the UI's languageId/notice/VS Code
//! language/comment/outline/status-bar maps). Adding a language is now a data change.
//!
//! # Languages (`languages[]`)
//! - `id` — the registry/VS Code language id (`typescriptreact`, `shellscript`, …). Unique.
//! - `name` — what the status bar shows.
//! - `lspLanguageId` — the LSP `languageId` sent in `didOpen` (defaults to `id`).
//! - `extensions` — lowercase, without the dot; matched case-insensitively (`Q.SQL` is SQL).
//! - `filenames` — whole file names (`Dockerfile`, `Makefile`), case-insensitive; they win over
//!   the extension.
//! - `firstLine` — a regex for the first line (a shebang), tried only when neither the name nor
//!   the extension matched.
//! - `lineComment` — the Ctrl+/ marker when no installed extension declares one.
//! - `outline` — the language the syntactic outline/codemap speaks (`file_outline`, the agent's
//!   `outline` tool). The explorer asks `file_outline` only when the server is `oneShot`.
//! - `server` — the id of the entry in `servers[]` that serves this language (optional).
//!
//! # Servers (`servers[]`)
//! - `id` — the session group: ONE server per (`id`, project root). It is also the `language` the
//!   backend reports (`ServerStatus`, workspace symbols), so it must stay stable.
//! - `name` — the language group as the "server missing" notice says it (`C/C++`).
//! - `label` — the server as people know it (`rust-analyzer`, `pyright`): the progress pill and
//!   the notice.
//! - `command` + `args` — the program to start (looked up by `resolver`) and its arguments.
//! - `resolver` — how to find `command` (see [`RESOLVERS`]): `path` (default) = PATH then
//!   `searchDirs`; `node` = `searchDirs` (nvm, `~/.local/bin`) then PATH; `go` = `go env GOPATH`
//!   then `searchDirs` then PATH; `rustup` = the concrete toolchain binary (never the rustup
//!   proxy, which recurses forever when the active toolchain lacks the component).
//! - `envOverride` — an environment variable that, when set, names the binary to use.
//! - `searchDirs` — extra folders; `~/` is the home folder and ONE `*` segment expands to every
//!   match, newest version first.
//! - `rootMarkers` — a session roots at the nearest ancestor holding any of these.
//! - `readySignal` — lowercase substring of the end-of-index `$/progress` token or begin-title;
//!   empty = ready as soon as `initialized`.
//! - `initOptions` — `initializationOptions` sent in `initialize`.
//! - `settings` — the server's settings: the answer to `workspace/configuration` (by section,
//!   `rust-analyzer` → `settings["rust-analyzer"]`; a top-level key with dots, `"a.b": 1`, counts as
//!   nested) and the payload of `workspace/didChangeConfiguration`. Usually set by an override.
//! - `oneShot` — cheap enough to start for a single request (the outline/navigation client in
//!   `tutor_eval::lsp`, used by `file_outline` and the agent). JVM servers are not.
//! - `quirks` — known per-server behaviour (see [`QUIRKS`]).
//! - `install` — how to install it (display only; what the UI may RUN stays an allow-list in code).
//! - `vscodeExtensions` — VS Code extensions that only start this server.
//!
//! # Overrides (P2: [`parse_overlay`], [`apply_overlay`])
//! A user file and a project's `.dxtutor/lsp.json` have the same shape: `version` (optional, 1),
//! `languages[]` and `servers[]`, each entry naming the `id` it changes or adds. JSON with `//` and
//! `/* */` comments and trailing commas ([`strip_jsonc`]). An entry for a known id changes only the
//! fields it gives: `initOptions` and `settings` merge key by key (a `null` value removes the key);
//! every other field replaces the old value, and `null` resets it to its default (`"server": null`
//! turns the server off for a language). An entry for a new id is a whole entry. The merged
//! registry must pass [`validate`] (except that a server of the layer below may be left unused); if
//! it does not, the whole file is ignored and its errors say the file and the entry.

use std::path::Path;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The bundled registry file.
pub const REGISTRY_JSON: &str = include_str!("../../../languages/registry.json");

/// How a server binary may be found (see the module docs).
pub const RESOLVERS: &[&str] = &["path", "node", "go", "rustup"];

/// The quirks the code knows. `nodePath` (set `NODE_PATH` to the global `node_modules` next to the
/// server) and `rustupProxy` (never start the rustup proxy) change what the backend does; the
/// others record handling that is already generic: `stringRequestIds` (jdtls sends request ids as
/// text), `uriOnlyWorkspaceSymbols` (kotlin-language-server sends only the file URI and
/// `containerName: "null"`), `noRangeFormatting` (ktfmt cannot format a selection).
pub const QUIRKS: &[&str] = &[
    "nodePath",
    "rustupProxy",
    "stringRequestIds",
    "uriOnlyWorkspaceSymbols",
    "noRangeFormatting",
];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registry {
    #[serde(rename = "$comment", default)]
    pub comment: String,
    pub version: u32,
    pub languages: Vec<Language>,
    pub servers: Vec<Server>,
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Language {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub lsp_language_id: Option<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub first_line: Option<String>,
    #[serde(default)]
    pub line_comment: Option<String>,
    #[serde(default)]
    pub outline: Option<String>,
    #[serde(default)]
    pub server: Option<String>,
}

impl Language {
    /// The LSP `languageId` (`lspLanguageId`, else the registry id).
    pub fn lsp_id(&self) -> &str {
        self.lsp_language_id.as_deref().unwrap_or(&self.id)
    }
}

#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub resolver: Option<String>,
    #[serde(default)]
    pub env_override: Option<String>,
    #[serde(default)]
    pub search_dirs: Vec<String>,
    #[serde(default)]
    pub root_markers: Vec<String>,
    #[serde(default)]
    pub ready_signal: String,
    #[serde(default)]
    pub init_options: Value,
    #[serde(default)]
    pub settings: Value,
    #[serde(default)]
    pub one_shot: bool,
    #[serde(default)]
    pub quirks: Vec<String>,
    #[serde(default)]
    pub install: Option<String>,
    #[serde(default)]
    pub vscode_extensions: Vec<String>,
}

impl Server {
    /// The resolver name (`path` when the entry does not say).
    pub fn resolver(&self) -> &str {
        self.resolver.as_deref().unwrap_or("path")
    }
    pub fn has_quirk(&self, q: &str) -> bool {
        self.quirks.iter().any(|x| x == q)
    }
}

/// Parse a registry document (no validation — see [`validate`]).
pub fn parse(json: &str) -> Result<Registry, String> {
    serde_json::from_str(json).map_err(|e| format!("language registry: {e}"))
}

/// The bundled registry. The tests guarantee it parses and validates.
pub fn registry() -> &'static Registry {
    static R: OnceLock<Registry> = OnceLock::new();
    R.get_or_init(|| parse(REGISTRY_JSON).expect("languages/registry.json"))
}

/// The last path segment (`/` or `\` separated).
fn file_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

impl Registry {
    pub fn language(&self, id: &str) -> Option<&Language> {
        self.languages.iter().find(|l| l.id == id)
    }

    pub fn server(&self, id: &str) -> Option<&Server> {
        self.servers.iter().find(|s| s.id == id)
    }

    /// The server of a language, if it has one.
    pub fn server_of(&self, lang: &Language) -> Option<&Server> {
        lang.server.as_deref().and_then(|s| self.server(s))
    }

    /// The language of a file by its NAME: a whole-filename match first (`Dockerfile`), then the
    /// extension after the last dot — both case-insensitive. A dotfile with no other dot
    /// (`.gitignore`) has no extension.
    pub fn language_for_name(&self, path: &str) -> Option<&Language> {
        let name = file_name(path);
        if name.is_empty() {
            return None;
        }
        if let Some(l) = self
            .languages
            .iter()
            .find(|l| l.filenames.iter().any(|f| f.eq_ignore_ascii_case(name)))
        {
            return Some(l);
        }
        let dot = name.rfind('.').filter(|&d| d > 0)?;
        let ext = name[dot + 1..].to_ascii_lowercase();
        self.languages.iter().find(|l| l.extensions.contains(&ext))
    }

    /// The language whose `firstLine` pattern matches `line` (only asked for files whose name
    /// says nothing, so the patterns are compiled on the spot).
    pub fn language_for_first_line(&self, line: &str) -> Option<&Language> {
        self.languages.iter().find(|l| {
            l.first_line
                .as_deref()
                .and_then(|p| regex::Regex::new(p).ok())
                .is_some_and(|re| re.is_match(line))
        })
    }

    /// The language of a file: by name, else by its first line (read from disk, at most 1 KiB —
    /// only for files whose name says nothing).
    pub fn language_for_file(&self, path: &str) -> Option<&Language> {
        self.language_for_name(path).or_else(|| {
            first_line_of(Path::new(path)).and_then(|l| self.language_for_first_line(&l))
        })
    }

    /// The `outline` language of a file, by name (the agent's `outline` tool, `board`).
    pub fn outline_for_name(&self, path: &str) -> Option<&str> {
        self.language_for_name(path)?.outline.as_deref()
    }

    /// The language and server the one-shot client uses for `lang` — an `outline` id (`rust`,
    /// `typescript`, `javascript`, …) or a file extension (`py`, `tsx`, `jsx`, …), which maps to
    /// its language's `outline` id. The FIRST language with that `outline` id answers (so `tsx`
    /// and `typescript` both speak as `typescript`). `None` unless the server is `oneShot`.
    pub fn one_shot(&self, lang: &str) -> Option<(&Language, &Server)> {
        let lower = lang.to_ascii_lowercase();
        let outline = if self
            .languages
            .iter()
            .any(|l| l.outline.as_deref() == Some(lower.as_str()))
        {
            lower
        } else {
            self.languages
                .iter()
                .find(|l| l.extensions.contains(&lower))?
                .outline
                .clone()?
        };
        let language = self
            .languages
            .iter()
            .find(|l| l.outline.as_deref() == Some(outline.as_str()))?;
        let server = self.server_of(language).filter(|s| s.one_shot)?;
        Some((language, server))
    }
}

/// The first line of a file (at most 1 KiB read), `None` if it cannot be read.
fn first_line_of(path: &Path) -> Option<String> {
    use std::io::Read;
    let mut buf = [0u8; 1024];
    let n = std::fs::File::open(path).ok()?.read(&mut buf).ok()?;
    let text = String::from_utf8_lossy(&buf[..n]);
    Some(text.lines().next().unwrap_or("").to_string())
}

/// Every rule a registry must follow; empty = well-formed. The bundled one is checked by the
/// tests, and every registry merged with an override file ([`apply_overlay`]) too.
pub fn validate(r: &Registry) -> Vec<String> {
    use std::collections::{HashMap, HashSet};
    let mut errs = Vec::new();
    let ident = |s: &str| {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    };
    if r.version != 1 {
        errs.push(format!(
            "version {} (this build reads version 1)",
            r.version
        ));
    }
    let mut lang_ids = HashSet::new();
    let mut exts: HashMap<String, &str> = HashMap::new();
    let mut names: HashMap<String, &str> = HashMap::new();
    let server_ids: HashSet<&str> = r.servers.iter().map(|s| s.id.as_str()).collect();
    let mut used_servers = HashSet::new();
    for l in &r.languages {
        let at = format!("language `{}`", l.id);
        if !ident(&l.id) {
            errs.push(format!(
                "{at}: id must be lowercase letters, digits, - or _"
            ));
        }
        if !lang_ids.insert(l.id.as_str()) {
            errs.push(format!("{at}: duplicate id"));
        }
        if l.name.trim().is_empty() {
            errs.push(format!("{at}: empty name"));
        }
        if l.lsp_language_id
            .as_deref()
            .is_some_and(|x| x.trim().is_empty())
        {
            errs.push(format!("{at}: empty lspLanguageId"));
        }
        if l.extensions.is_empty() && l.filenames.is_empty() && l.first_line.is_none() {
            errs.push(format!(
                "{at}: nothing recognises its files (extensions, filenames or firstLine)"
            ));
        }
        for e in &l.extensions {
            if e.is_empty()
                || e.starts_with('.')
                || e.contains(['/', '\\'])
                || *e != e.to_ascii_lowercase()
            {
                errs.push(format!(
                    "{at}: extension `{e}` must be lowercase, without the dot"
                ));
            }
            if let Some(other) = exts.insert(e.clone(), l.id.as_str()) {
                errs.push(format!(
                    "{at}: extension `{e}` is also claimed by `{other}`"
                ));
            }
        }
        for f in &l.filenames {
            if f.is_empty() || f.contains(['/', '\\']) {
                errs.push(format!("{at}: filename `{f}` must be a bare file name"));
            }
            if let Some(other) = names.insert(f.to_ascii_lowercase(), l.id.as_str()) {
                errs.push(format!("{at}: filename `{f}` is also claimed by `{other}`"));
            }
        }
        if let Some(p) = &l.first_line {
            if let Err(e) = regex::Regex::new(p) {
                errs.push(format!("{at}: firstLine is not a valid regex: {e}"));
            }
        }
        if l.line_comment
            .as_deref()
            .is_some_and(|c| c.trim().is_empty())
        {
            errs.push(format!("{at}: empty lineComment"));
        }
        if l.outline.as_deref().is_some_and(|o| !ident(o)) {
            errs.push(format!("{at}: outline must be a lowercase id"));
        }
        if let Some(s) = &l.server {
            if !server_ids.contains(s.as_str()) {
                errs.push(format!("{at}: server `{s}` is not in servers[]"));
            }
            if l.lsp_language_id.is_none() {
                errs.push(format!(
                    "{at}: a language with a server must say its lspLanguageId"
                ));
            }
            used_servers.insert(s.as_str());
        }
    }
    let mut seen = HashSet::new();
    let mut vsx = HashMap::new();
    for s in &r.servers {
        let at = format!("server `{}`", s.id);
        if !ident(&s.id) {
            errs.push(format!(
                "{at}: id must be lowercase letters, digits, - or _"
            ));
        }
        if !seen.insert(s.id.as_str()) {
            errs.push(format!("{at}: duplicate id"));
        }
        if !used_servers.contains(s.id.as_str()) {
            errs.push(format!("{at}: no language uses it"));
        }
        for (field, v) in [
            ("name", &s.name),
            ("label", &s.label),
            ("command", &s.command),
        ] {
            if v.trim().is_empty() {
                errs.push(format!("{at}: empty {field}"));
            }
        }
        if s.command.contains(['/', '\\']) || s.command.contains(char::is_whitespace) {
            errs.push(format!(
                "{at}: command must be a bare program name (arguments go in args)"
            ));
        }
        if !RESOLVERS.contains(&s.resolver()) {
            errs.push(format!("{at}: unknown resolver `{}`", s.resolver()));
        }
        if let Some(v) = &s.env_override {
            if v.is_empty()
                || !v
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
            {
                errs.push(format!(
                    "{at}: envOverride `{v}` must be an UPPER_CASE variable"
                ));
            }
        }
        for d in &s.search_dirs {
            if !(d.starts_with('/') || d.starts_with("~/")) || d.matches('*').count() > 1 {
                errs.push(format!(
                    "{at}: searchDir `{d}` must be absolute or start with ~/, with at most one *"
                ));
            }
        }
        for m in &s.root_markers {
            if m.is_empty() || m.contains(['/', '\\']) {
                errs.push(format!("{at}: root marker `{m}` must be a bare file name"));
            }
        }
        if s.ready_signal != s.ready_signal.to_ascii_lowercase() {
            errs.push(format!(
                "{at}: readySignal must be lowercase (it is matched against a lowercased title)"
            ));
        }
        if !(s.init_options.is_null() || s.init_options.is_object()) {
            errs.push(format!("{at}: initOptions must be an object"));
        }
        if !(s.settings.is_null() || s.settings.is_object()) {
            errs.push(format!("{at}: settings must be an object"));
        }
        for q in &s.quirks {
            if !QUIRKS.contains(&q.as_str()) {
                errs.push(format!("{at}: unknown quirk `{q}`"));
            }
        }
        if s.install.as_deref().is_some_and(|i| i.trim().is_empty()) {
            errs.push(format!("{at}: empty install"));
        }
        for x in &s.vscode_extensions {
            if *x != x.to_ascii_lowercase() || !x.contains('.') {
                errs.push(format!(
                    "{at}: VS Code extension `{x}` must be a lowercase publisher.name"
                ));
            }
            if let Some(other) = vsx.insert(x.clone(), s.id.as_str()) {
                errs.push(format!(
                    "{at}: VS Code extension `{x}` is also mapped to `{other}`"
                ));
            }
        }
    }
    errs
}

// ── Overrides (P2) ──────────────────────────────────────────────────────────────────────────────

/// An override file (user or project), parsed but not merged yet. The entries stay JSON objects:
/// a partial entry (`{ "id": "rust", "args": ["-v"] }`) is not a [`Language`]/[`Server`] until it
/// is merged over the entry it changes.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Overlay {
    pub languages: Vec<serde_json::Map<String, Value>>,
    pub servers: Vec<serde_json::Map<String, Value>>,
    /// `resources` (LSP P6: how long an idle server lives, how many run at once) as written; read
    /// and checked by [`crate::lspconf`], which takes it only from the user's file.
    pub resources: Option<serde_json::Map<String, Value>>,
}

impl Overlay {
    /// The ids of the server entries in the file.
    pub fn server_ids(&self) -> impl Iterator<Item = &str> {
        self.servers.iter().filter_map(|m| m.get("id")?.as_str())
    }
    /// The ids of the language entries in the file.
    pub fn language_ids(&self) -> impl Iterator<Item = &str> {
        self.languages.iter().filter_map(|m| m.get("id")?.as_str())
    }
}

/// The JSON of an override file without its `//` and `/* */` comments and without trailing commas
/// (`[1, 2,]`). Newlines are kept, so a syntax error still points at the right line.
pub fn strip_jsonc(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut it = text.chars().peekable();
    let mut in_str = false;
    // where the last comma went in `out`, until something other than blanks/comments follows it
    let mut comma: Option<usize> = None;
    while let Some(c) = it.next() {
        if in_str {
            out.push(c);
            if c == '\\' {
                if let Some(n) = it.next() {
                    out.push(n);
                }
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        match c {
            '/' if it.peek() == Some(&'/') => {
                while it.peek().is_some_and(|&n| n != '\n') {
                    it.next();
                }
            }
            '/' if it.peek() == Some(&'*') => {
                it.next();
                let mut prev = '\0';
                for n in it.by_ref() {
                    if prev == '*' && n == '/' {
                        break;
                    }
                    if n == '\n' {
                        out.push('\n');
                    }
                    prev = n;
                }
                out.push(' ');
            }
            c if c.is_whitespace() => out.push(c),
            ',' => {
                comma = Some(out.len());
                out.push(',');
            }
            ']' | '}' => {
                if let Some(at) = comma.take() {
                    out.replace_range(at..at + 1, " ");
                }
                out.push(c);
            }
            '"' => {
                comma = None;
                in_str = true;
                out.push(c);
            }
            _ => {
                comma = None;
                out.push(c);
            }
        }
    }
    out
}

/// Parse an override file (JSON with comments). `Err` = the file is ignored; each error says
/// where (`line 3 column 7` for the JSON, `servers[2]` for an entry).
pub fn parse_overlay(text: &str) -> Result<Overlay, Vec<String>> {
    let v: Value = serde_json::from_str(&strip_jsonc(text))
        .map_err(|e| vec![format!("not valid JSON: {e}")])?;
    let Value::Object(top) = v else {
        return Err(vec![
            "the file must be a JSON object ({ \"languages\": [...], \"servers\": [...] })".into(),
        ]);
    };
    let mut errs = Vec::new();
    let mut ov = Overlay::default();
    for (k, val) in &top {
        match k.as_str() {
            "$comment" => {}
            "version" => {
                if val.as_u64() != Some(1) {
                    errs.push(format!("version {val} (this build reads version 1)"));
                }
            }
            "resources" => match val {
                Value::Object(m) => ov.resources = Some(m.clone()),
                _ => errs.push("`resources` must be an object".into()),
            },
            "languages" | "servers" => {
                let Some(arr) = val.as_array() else {
                    errs.push(format!("`{k}` must be a list"));
                    continue;
                };
                let mut seen = std::collections::HashSet::new();
                for (i, e) in arr.iter().enumerate() {
                    let at = format!("{k}[{i}]");
                    let Value::Object(m) = e else {
                        errs.push(format!("{at}: must be an object"));
                        continue;
                    };
                    match m
                        .get("id")
                        .and_then(Value::as_str)
                        .filter(|id| !id.trim().is_empty())
                    {
                        Some(id) if !seen.insert(id.to_string()) => {
                            errs.push(format!("{at} (`{id}`): the same id twice in one file"))
                        }
                        Some(_) if k == "languages" => ov.languages.push(m.clone()),
                        Some(_) => ov.servers.push(m.clone()),
                        None => errs.push(format!("{at}: every entry needs an `id` (text)")),
                    }
                }
            }
            other => errs.push(format!(
                "unknown field `{other}` (expected `version`, `languages`, `servers` or `resources`)"
            )),
        }
    }
    if errs.is_empty() {
        Ok(ov)
    } else {
        Err(errs)
    }
}

/// `patch` merged into `base`, key by key: two objects merge, a `null` removes the key, anything
/// else replaces the old value.
pub fn deep_merge(base: &mut Value, patch: &Value) {
    match (base, patch) {
        (Value::Object(b), Value::Object(p)) => {
            for (k, v) in p {
                if v.is_null() {
                    b.remove(k);
                } else if let Some(old) = b.get_mut(k).filter(|o| o.is_object() && v.is_object()) {
                    deep_merge(old, v);
                } else {
                    b.insert(k.clone(), v.clone());
                }
            }
        }
        (b, p) => *b = p.clone(),
    }
}

/// Settings with dotted top-level keys (`"python.analysis.typeCheckingMode": "strict"`, the VS Code
/// way) as nested objects (`{ "python": { "analysis": { … } } }`), so a section lookup finds both.
pub fn normalize_settings(v: &Value) -> Value {
    let Value::Object(m) = v else {
        return v.clone();
    };
    let mut out = Value::Object(serde_json::Map::new());
    for (k, val) in m {
        let mut nested = val.clone();
        for part in k.split('.').rev() {
            let mut one = serde_json::Map::new();
            one.insert(part.to_string(), nested);
            nested = Value::Object(one);
        }
        deep_merge(&mut out, &nested);
    }
    out
}

/// The answer to one `workspace/configuration` item: every setting when there is no section, else
/// the value at the dotted path (`java.format` → `settings.java.format`), `null` when absent (what
/// the protocol expects for a section the client does not know).
pub fn settings_section(settings: &Value, section: Option<&str>) -> Value {
    let Some(sec) = section.filter(|s| !s.is_empty()) else {
        return settings.clone();
    };
    sec.split('.')
        .try_fold(settings, |v, k| v.get(k))
        .cloned()
        .unwrap_or(Value::Null)
}

/// One entry, `start` with `patch` over it (see the module docs): `id` never changes, a `null`
/// resets the field, `initOptions`/`settings` merge key by key, the rest replaces.
fn merge_entry<T: Serialize + serde::de::DeserializeOwned>(
    start: serde_json::Map<String, Value>,
    patch: &serde_json::Map<String, Value>,
) -> Result<T, String> {
    let mut obj = start;
    for (k, v) in patch {
        if k == "id" && obj.contains_key("id") {
            continue;
        }
        if v.is_null() {
            obj.remove(k);
            continue;
        }
        let v = if k == "settings" {
            normalize_settings(v)
        } else {
            v.clone()
        };
        match obj.get_mut(k) {
            Some(old)
                if (k == "initOptions" || k == "settings") && old.is_object() && v.is_object() =>
            {
                deep_merge(old, &v)
            }
            _ => {
                obj.insert(k.clone(), v);
            }
        }
    }
    // the base serialises its unset options as `null`: drop them, so the defaults apply
    obj.retain(|_, v| !v.is_null());
    serde_json::from_value(Value::Object(obj)).map_err(|e| e.to_string())
}

fn as_map<T: Serialize>(entry: &T) -> serde_json::Map<String, Value> {
    match serde_json::to_value(entry) {
        Ok(Value::Object(m)) => m,
        _ => serde_json::Map::new(),
    }
}

/// `base` with an override file over it, validated as a whole ([`validate`]). `Err` = the file is
/// ignored and `base` stays as it was; each error names the entry (`servers[1] (`rust`)`) or the
/// broken rule (`language `x`: …`).
pub fn apply_overlay(base: &Registry, ov: &Overlay) -> Result<Registry, Vec<String>> {
    let mut errs = Vec::new();
    let mut languages = base.languages.clone();
    for (i, patch) in ov.languages.iter().enumerate() {
        let id = patch.get("id").and_then(Value::as_str).unwrap_or_default();
        match languages.iter().position(|l| l.id == id) {
            Some(p) => match merge_entry::<Language>(as_map(&languages[p]), patch) {
                Ok(l) => languages[p] = l,
                Err(e) => errs.push(format!("languages[{i}] (`{id}`): {e}")),
            },
            None => match merge_entry::<Language>(serde_json::Map::new(), patch) {
                Ok(l) => languages.push(l),
                Err(e) => errs.push(format!("languages[{i}] (new language `{id}`): {e}")),
            },
        }
    }
    let mut servers = base.servers.clone();
    for (i, patch) in ov.servers.iter().enumerate() {
        let id = patch.get("id").and_then(Value::as_str).unwrap_or_default();
        match servers.iter().position(|s| s.id == id) {
            Some(p) => match merge_entry::<Server>(as_map(&servers[p]), patch) {
                Ok(s) => servers[p] = s,
                Err(e) => errs.push(format!("servers[{i}] (`{id}`): {e}")),
            },
            None => match merge_entry::<Server>(serde_json::Map::new(), patch) {
                Ok(s) => servers.push(s),
                Err(e) => errs.push(format!("servers[{i}] (new server `{id}`): {e}")),
            },
        }
    }
    if !errs.is_empty() {
        return Err(errs);
    }
    let merged = Registry {
        comment: base.comment.clone(),
        version: base.version,
        languages,
        servers,
    };
    // a server of the layer below that the file leaves unused (`"server": null` turns a language's
    // server off) is fine; a NEW server no language uses is still an error (a typo, most likely)
    let broken: Vec<String> = validate(&merged)
        .into_iter()
        .filter(|e| {
            !base
                .servers
                .iter()
                .any(|s| *e == format!("server `{}`: no language uses it", s.id))
        })
        .collect();
    if broken.is_empty() {
        Ok(merged)
    } else {
        Err(broken)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_registry_is_well_formed() {
        let r = parse(REGISTRY_JSON).unwrap();
        let errs = validate(&r);
        assert!(errs.is_empty(), "{errs:#?}");
        assert!(!r.comment.is_empty(), "the file explains itself");
    }

    #[test]
    fn validation_catches_every_broken_rule() {
        let bad = r#"{
          "version": 2,
          "languages": [
            { "id": "a", "name": "A", "extensions": ["x", ".Y"], "server": "missing" },
            { "id": "a", "name": "", "extensions": ["x"], "filenames": ["Makefile"], "firstLine": "(" },
            { "id": "b", "name": "B", "filenames": ["makefile"], "lspLanguageId": "b", "server": "s" },
            { "id": "c", "name": "C" }
          ],
          "servers": [
            { "id": "s", "name": "S", "label": "s", "command": "bin/s --x", "resolver": "magic",
              "envOverride": "lower", "searchDirs": ["rel/dir", "/a/*/b/*"], "rootMarkers": ["a/b"],
              "readySignal": "Big", "initOptions": [1], "quirks": ["nope"],
              "vscodeExtensions": ["Pub.Ext"] },
            { "id": "unused", "name": "U", "label": "u", "command": "u" }
          ]
        }"#;
        let errs = validate(&parse(bad).unwrap()).join("\n");
        for want in [
            "version 2",
            "extension `.Y`",
            "server `missing` is not in servers[]",
            "must say its lspLanguageId",
            "language `a`: duplicate id",
            "empty name",
            "extension `x` is also claimed by `a`",
            "filename `makefile` is also claimed by `a`",
            "firstLine is not a valid regex",
            "language `c`: nothing recognises",
            "command must be a bare program name",
            "unknown resolver `magic`",
            "envOverride `lower`",
            "searchDir `rel/dir`",
            "searchDir `/a/*/b/*`",
            "root marker `a/b`",
            "readySignal must be lowercase",
            "initOptions must be an object",
            "unknown quirk `nope`",
            "VS Code extension `Pub.Ext`",
            "server `unused`: no language uses it",
        ] {
            assert!(errs.contains(want), "missing «{want}» in:\n{errs}");
        }
        // a field nobody reads is a typo, not data
        assert!(parse(
            r#"{"version":1,"languages":[{"id":"a","name":"A","extension":["x"]}],"servers":[]}"#
        )
        .is_err());
    }

    #[test]
    fn files_are_matched_case_insensitively_and_by_whole_name() {
        let r = registry();
        let id = |p: &str| r.language_for_name(p).map(|l| l.id.as_str());
        assert_eq!(id("/w/q.SQL"), Some("sql"));
        assert_eq!(id("/w/src/Main.JAVA"), Some("java"));
        assert_eq!(id("C:\\w\\lib.RS"), Some("rust"));
        assert_eq!(id("/w/Dockerfile"), Some("dockerfile"));
        assert_eq!(id("/w/dockerfile"), Some("dockerfile"));
        assert_eq!(id("/w/api.dockerfile"), Some("dockerfile"));
        assert_eq!(id("/w/Makefile"), Some("makefile"));
        assert_eq!(id("/w/GNUmakefile"), Some("makefile"));
        assert_eq!(id("/w/Gemfile"), Some("ruby"));
        assert_eq!(id("/w/.gitignore"), None);
        assert_eq!(id("/w/notes.txt"), None);
        assert_eq!(id("/w/LICENSE"), None);
        assert_eq!(
            id("/w/a.b/README"),
            None,
            "a dot in a folder is not an extension"
        );
        // the languageId the server gets
        assert_eq!(
            r.language_for_name("/w/a.tsx").unwrap().lsp_id(),
            "typescriptreact"
        );
        assert_eq!(r.language_for_name("/w/a.c").unwrap().lsp_id(), "c");
        assert_eq!(r.language_for_name("/w/a.h").unwrap().lsp_id(), "cpp");
        // TS/JS share ONE server; C and C++ too
        let srv = |p: &str| {
            r.server_of(r.language_for_name(p).unwrap())
                .map(|s| s.id.as_str())
        };
        assert_eq!(srv("/w/a.jsx"), Some("typescript"));
        assert_eq!(srv("/w/a.c"), Some("cpp"));
        assert_eq!(srv("/w/Dockerfile"), None);
    }

    #[test]
    fn a_shebang_names_the_language_of_a_file_without_extension() {
        let r = registry();
        let id = |l: &str| r.language_for_first_line(l).map(|x| x.id.as_str());
        assert_eq!(id("#!/usr/bin/env python3"), Some("python"));
        assert_eq!(id("#!/usr/bin/env node"), Some("javascript"));
        assert_eq!(id("#!/bin/bash"), Some("shellscript"));
        assert_eq!(id("#!/usr/bin/fish"), None);
        assert_eq!(id("print('x')"), None);
        let d = tempfile::tempdir().unwrap();
        let script = d.path().join("deploy");
        std::fs::write(&script, "#!/usr/bin/env python3\nprint(1)\n").unwrap();
        assert_eq!(
            r.language_for_file(&script.display().to_string())
                .map(|l| l.id.as_str()),
            Some("python")
        );
        // the name wins over the content; a missing file is just unknown
        let named = d.path().join("x.rs");
        std::fs::write(&named, "#!/usr/bin/env python3\n").unwrap();
        assert_eq!(
            r.language_for_file(&named.display().to_string())
                .unwrap()
                .id,
            "rust"
        );
        assert!(r.language_for_file("/no/such/file").is_none());
    }

    #[test]
    fn the_one_shot_client_keeps_its_four_servers_and_language_ids() {
        let r = registry();
        let one = |l: &str| {
            r.one_shot(l)
                .map(|(lang, s)| (s.command.as_str(), s.args.clone(), lang.lsp_id()))
        };
        assert_eq!(one("rust"), Some(("rust-analyzer", vec![], "rust")));
        assert_eq!(one("go"), Some(("gopls", vec![], "go")));
        let stdio = vec!["--stdio".to_string()];
        for l in ["python", "py"] {
            assert_eq!(
                one(l),
                Some(("pyright-langserver", stdio.clone(), "python")),
                "{l}"
            );
        }
        for l in ["typescript", "ts", "tsx"] {
            assert_eq!(
                one(l),
                Some(("typescript-language-server", stdio.clone(), "typescript")),
                "{l}"
            );
        }
        for l in ["javascript", "js", "jsx"] {
            assert_eq!(
                one(l),
                Some(("typescript-language-server", stdio.clone(), "javascript")),
                "{l}"
            );
        }
        // JVM and native servers are never started for one request
        for l in [
            "java", "kotlin", "cpp", "csharp", "swift", "sql", "markdown", "zzz",
        ] {
            assert!(one(l).is_none(), "{l}");
        }
        assert_eq!(r.outline_for_name("a/b.TSX"), Some("typescript"));
        assert_eq!(r.outline_for_name("a/b.hxx"), Some("cpp"));
        assert_eq!(r.outline_for_name("q.sql"), None);
    }
}
