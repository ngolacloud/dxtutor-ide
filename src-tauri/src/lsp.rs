// Multi-language LSP client (JSON-RPC over stdio) for the dxtutor IDE.
//
// ONE server per PROJECT, per language: a session is keyed by (languageId, project
// root), where the root is the NEAREST ancestor holding that language's marker
// (Cargo.toml for Rust, go.mod for Go, tsconfig/package.json for TS, pyproject for
// Python). Rooting the server at the file's own project keeps the index small, fast
// and correct, and makes a DETACHED project resolve — which a single server rooted
// at a huge monorepo never would. The language registry (`languages/registry.json`, through
// `tutor_eval::langreg`: languages, servers, root markers, init options, ready signals, quirks)
// is the ONLY language-specific part; everything below is protocol-generic.
//
// THREADING: every command is `async` and runs its blocking work (the LSP
// round-trip and the "wait for index" poll) on `spawn_blocking`, NEVER on the
// webview's main thread — otherwise a hover (which fires continuously) blocking on
// the index would freeze the whole app.
//
// Each session owns a child process and a reader thread that demultiplexes
// responses by id and forwards `publishDiagnostics` to the UI. A `ready` flag is
// set when the server finishes its first indexing pass; user-driven navigation
// waits (bounded) for it, hover does not.

use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::io::{BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tutor_eval::langreg::{self, Server};
use tutor_eval::lspconf::{self, Effective, TrustStore};

struct Session {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    next_id: i64,
    pending: HashMap<i64, Sender<Value>>,
    open: HashSet<String>,
    /// `initialize` respondido e `initialized` enviado. A sessão entra no mapa ANTES disso (o
    /// arranque bloqueia segundos); quem a encontrar lá espera por isto antes de lhe mandar
    /// pedidos — um pedido antes do `initialize` viola o protocolo, e o jdtls ficava a responder
    /// listas vazias ao completion e ao signatureHelp durante a sessão inteira.
    initialized: bool,
    /// As capacidades que o servidor anunciou no `initialize` (`ServerCapabilities`), para dizer
    /// «este servidor não tem isto» em vez de um erro ou de uma lista vazia.
    server_caps: Value,
    ready: bool,
    /// Substring marking the end-of-index `$/progress` for this server (see `Lang`).
    ready_signal: String,
    /// What the session was started with (`fingerprint`): when the effective entry changes (an
    /// override file), the session is stale and is restarted.
    fingerprint: String,
    /// The server's settings (`settings` of the effective entry, dotted keys nested): the answer to
    /// `workspace/configuration`.
    settings: Value,
    /// The open folder whose override files made this session's entry (`None`: outside them all).
    project: Option<String>,
    /// token → begin-title, so an `end` event (whose own title is empty) can be matched
    /// against `ready_signal` by the title announced when the work began.
    progress_titles: HashMap<String, String>,
}

type SessionMap = Arc<Mutex<HashMap<String, Arc<Mutex<Session>>>>>;

#[derive(Default, Clone)]
pub struct LspState(SessionMap);

/// A session group — ONE server per (group, project root): its registry server entry plus what
/// a session needs. Everything language-specific comes from the language registry
/// (`languages/registry.json`, read through `tutor_eval::langreg`) with the user's and the
/// project's override files over it (`tutor_eval::lspconf`); this is only a view of it.
#[derive(Clone)]
struct Lang {
    /// The server id (`rust`, `typescript`, `cpp`, …) — the session-key prefix and the
    /// `language` the UI hears (`ServerStatus`, workspace symbols).
    id: String,
    /// Project-root markers: the session roots at the nearest ancestor holding ANY.
    markers: Vec<String>,
    /// Human label of the server, for the progress pill ("rust-analyzer", "gopls", …).
    server_label: String,
    /// Lowercase substring that, in the TOKEN or the BEGIN-title of a finishing `$/progress`,
    /// marks the symbol index as built (session becomes `ready`). MEASURED per server:
    /// rust-analyzer's token is `rustAnalyzer/cachePriming`; gopls titles its startup "Setting up
    /// workspace"; pyright sends nothing (empty ⇒ ready as soon as `initialized`).
    ready_signal: String,
    server: Server,
    /// The open folder whose override files apply (`None`: the file is outside every open folder).
    project: Option<String>,
    /// The registry this entry came from (bundled + user + project), with what it was made of.
    eff: Arc<Effective>,
}

impl Lang {
    fn of(server: &Server, project: Option<String>, eff: Arc<Effective>) -> Lang {
        Lang {
            id: server.id.clone(),
            markers: server.root_markers.clone(),
            server_label: server.label.clone(),
            ready_signal: server.ready_signal.clone(),
            server: server.clone(),
            project,
            eff,
        }
    }
}

/// Every session group of a project's effective registry (a server no language uses — an override
/// turned it off — is not one).
fn langs_for(project: Option<&str>) -> Vec<Lang> {
    let eff = effective(project);
    eff.registry
        .servers
        .iter()
        .filter(|s| serves_a_language(&eff.registry, &s.id))
        .map(|s| Lang::of(s, project.map(String::from), eff.clone()))
        .collect()
}

/// Does some language use this server?
fn serves_a_language(reg: &langreg::Registry, server_id: &str) -> bool {
    reg.languages
        .iter()
        .any(|l| l.server.as_deref() == Some(server_id))
}

/// The session group of a file: its language (by file name or extension, case-insensitive; by the
/// first line for a file whose name says nothing) and that language's server — in the registry of
/// the open folder the file is in (its override files included).
fn lang_for_path(path: &str) -> Option<Lang> {
    let project = project_of(path);
    let eff = effective(project.as_deref());
    let server = eff
        .registry
        .server_of(eff.registry.language_for_file(path)?)?
        .clone();
    Some(Lang::of(&server, project, eff))
}

/// The open folder a file belongs to (the deepest one), whose `.dxtutor/lsp.json` applies.
fn project_of(path: &str) -> Option<String> {
    fallback_root(path, &workspace_roots().lock().unwrap())
}

/// Where programs are looked for: the home folder, a PATH and the environment variables. In the
/// app it is [`Host::current`]; the tests build one with an empty PATH and a temporary home.
struct Host {
    home: Option<PathBuf>,
    path: OsString,
    var: EnvLookup,
}

/// Reads an environment variable (the process's, or a test's).
type EnvLookup = Box<dyn Fn(&str) -> Option<String>>;

impl Host {
    fn current() -> Host {
        Host {
            home: home_dir(),
            path: augmented_path(None),
            var: Box::new(|k| std::env::var(k).ok()),
        }
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
}

/// `program` on the host's PATH.
fn on_path(host: &Host, program: &str) -> Option<PathBuf> {
    std::env::split_paths(&host.path)
        .map(|d| d.join(program))
        .find(|p| p.is_file())
}

/// The folders a `searchDirs` entry stands for: `~/` is the home folder and ONE `*` segment
/// expands to every match, the highest version first.
fn expand_dir(host: &Host, hint: &str) -> Vec<PathBuf> {
    let expanded = match hint.strip_prefix("~/") {
        Some(rest) => match &host.home {
            Some(h) => h.join(rest).to_string_lossy().into_owned(),
            None => return Vec::new(),
        },
        None => hint.to_string(),
    };
    glob_candidates(&expanded)
}

/// `program` in the first of `dirs` that holds it.
fn in_dirs(host: &Host, program: &str, dirs: &[String]) -> Option<PathBuf> {
    dirs.iter()
        .flat_map(|d| expand_dir(host, d))
        .map(|d| d.join(program))
        .find(|p| p.is_file())
}

/// (Para os testes.) Resolve um servidor nativo: primeiro o PATH (aumentado), depois pastas conhecidas —
/// `~/` é a pasta do utilizador e um segmento `*` escolhe a versão mais recente (ex.: a
/// toolchain do swiftly, que traz o `sourcekit-lsp`). Erro legível se não estiver instalado.
#[cfg(test)]
fn native_server(name: &str, hints: &[&str]) -> Result<String, String> {
    let host = Host::current();
    let dirs: Vec<String> = hints.iter().map(|h| h.to_string()).collect();
    on_path(&host, name)
        .or_else(|| in_dirs(&host, name, &dirs))
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| not_found(name))
}

fn not_found(name: &str) -> String {
    format!("servidor de linguagem `{name}` não encontrado — instala-o e põe-no no PATH")
}

/// Every expansion of a single `*` segment, the highest version first (`6.10.0` > `6.4.3`,
/// compared numerically, segment by segment). A path without `*` is itself.
fn glob_candidates(path: &str) -> Vec<PathBuf> {
    let Some((before, after)) = path.split_once('*') else {
        return vec![PathBuf::from(path)];
    };
    let key = |s: &str| -> Vec<u64> {
        s.split(|c: char| !c.is_ascii_digit())
            .filter_map(|p| p.parse().ok())
            .collect()
    };
    let Ok(rd) = std::fs::read_dir(before) else {
        return Vec::new();
    };
    let mut names: Vec<String> = rd
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort_by_key(|n| std::cmp::Reverse(key(n)));
    names
        .into_iter()
        .map(|n| PathBuf::from(format!("{before}{n}{after}")))
        .collect()
}

/// Expande um único segmento `*` para a entrada com a versão mais alta.
#[cfg(test)]
fn newest_glob(path: &str) -> Option<PathBuf> {
    glob_candidates(path).into_iter().next()
}

/// The binary a registry server runs, found the way its `resolver` says (see `tutor_eval::langreg`).
/// An `envOverride` variable that is set wins; if it names no file, that is the answer (not a
/// silent fall-through to another binary). A human error when nothing is found lets the UI tell
/// the student what to add.
fn resolve_server(server: &Server, host: &Host) -> Result<String, String> {
    if let Some(var) = &server.env_override {
        if let Some(v) = (host.var)(var).filter(|v| !v.is_empty()) {
            return if Path::new(&v).is_file() {
                Ok(v)
            } else {
                Err(format!("{var}={v}: esse ficheiro não existe"))
            };
        }
    }
    let name = server.command.as_str();
    let dirs = &server.search_dirs;
    let found = match server.resolver() {
        "rustup" => rustup_toolchain_bin(host, name)
            .or_else(|| on_path(host, name).filter(|p| !is_rustup_proxy(host, p)))
            .or_else(|| in_dirs(host, name, dirs)),
        "go" => gopath_bin(host, name)
            .or_else(|| in_dirs(host, name, dirs))
            .or_else(|| on_path(host, name)),
        "node" => in_dirs(host, name, dirs).or_else(|| on_path(host, name)),
        _ => on_path(host, name).or_else(|| in_dirs(host, name, dirs)),
    };
    found
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| not_found(name))
}

/// rust-analyzer from a CONCRETE toolchain. The bare `rust-analyzer` on PATH is often the rustup
/// PROXY, which INFINITELY RECURSES (and crashes) when the active toolchain of the opened project
/// lacks the component (common with a nightly-pinned fuzz crate): `rustup which --toolchain
/// stable`, else a `~/.rustup/toolchains/*/bin` that has it (stable first).
fn rustup_toolchain_bin(host: &Host, name: &str) -> Option<PathBuf> {
    let rustup = on_path(host, "rustup").or_else(|| {
        let p = host.home.as_ref()?.join(".cargo/bin/rustup");
        p.is_file().then_some(p)
    });
    if let Some(rustup) = rustup {
        if let Ok(out) = Command::new(rustup)
            .env("PATH", &host.path)
            .args(["which", "--toolchain", "stable", name])
            .output()
        {
            if out.status.success() {
                let p = PathBuf::from(String::from_utf8_lossy(&out.stdout).trim());
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    let rd = std::fs::read_dir(host.home.as_ref()?.join(".rustup/toolchains")).ok()?;
    let mut fallback = None;
    for e in rd.flatten() {
        let b = e.path().join("bin").join(name);
        if b.is_file() {
            if e.file_name().to_string_lossy().starts_with("stable") {
                return Some(b);
            }
            fallback.get_or_insert(b);
        }
    }
    fallback
}

/// Is `p` a rustup proxy (a link to the `rustup` binary)? rustup installs its proxies as hard
/// links (symbolic on some systems) next to `rustup`.
fn is_rustup_proxy(host: &Host, p: &Path) -> bool {
    let canon = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    if canon
        .file_name()
        .is_some_and(|n| n.to_string_lossy().starts_with("rustup"))
    {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let id = |q: &Path| std::fs::metadata(q).ok().map(|m| (m.dev(), m.ino()));
        let me = id(p);
        let rustups = [
            p.parent().map(|d| d.join("rustup")),
            on_path(host, "rustup"),
        ];
        if me.is_some() && rustups.iter().flatten().any(|r| id(r) == me) {
            return true;
        }
    }
    #[cfg(not(unix))]
    let _ = host;
    false
}

/// `program` in `$(go env GOPATH)/bin` (every GOPATH entry).
fn gopath_bin(host: &Host, program: &str) -> Option<PathBuf> {
    let go = on_path(host, "go")?;
    let out = Command::new(go)
        .env("PATH", &host.path)
        .args(["env", "GOPATH"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let gp = String::from_utf8_lossy(&out.stdout).trim().to_string();
    std::env::split_paths(&gp)
        .map(|d| d.join("bin").join(program))
        .find(|p| p.is_file())
}

/// Resolve the language server command (program + args) of a registry server. A human error
/// when the server isn't installed lets the UI tell the student what to add. The resolvers that
/// run a program (`rustup`, `go`) remember what they found for the rest of the run — never a
/// miss, so a server installed from the notice is found without restarting the app.
fn server_cmd(server: &Server) -> Result<(String, Vec<String>), String> {
    static FOUND: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    let cache = FOUND.get_or_init(Default::default);
    let cacheable = matches!(server.resolver(), "rustup" | "go");
    // an override can change how the same server id is found: the key is everything that decides it
    let key = format!(
        "{}\u{0}{}\u{0}{}\u{0}{:?}\u{0}{:?}",
        server.id,
        server.command,
        server.resolver(),
        server.search_dirs,
        server.env_override
    );
    if cacheable {
        if let Some(p) = cache.lock().unwrap().get(&key) {
            return Ok((p.clone(), server.args.clone()));
        }
    }
    let program = resolve_server(server, &Host::current())?;
    if cacheable {
        cache.lock().unwrap().insert(key, program.clone());
    }
    Ok((program, server.args.clone()))
}

/// The global `node_modules` for `NODE_PATH` (quirk `nodePath`): typescript-language-server does
/// `require('typescript')` and does NOT bundle it, so without this it can't find the
/// globally-installed `typescript` and silently answers nothing. The one next to the server
/// (`<prefix>/bin/server` → `<prefix>/lib/node_modules`, where `npm install -g` put both), else
/// the newest nvm node's. NOTE: it needs the classic TypeScript 5.x `tsserver.js`; `typescript@7`
/// (the native tsgo preview) ships no tsserver and breaks it — keep the global `typescript` on 5.x.
fn node_global_modules(program: &str) -> Option<String> {
    let beside = Path::new(program)
        .parent()
        .and_then(Path::parent)
        .map(|prefix| prefix.join("lib/node_modules"))
        .filter(|p| p.is_dir());
    beside
        .or_else(|| {
            let host = Host {
                home: home_dir(),
                path: OsString::new(),
                var: Box::new(|_| None),
            };
            expand_dir(&host, "~/.nvm/versions/node/*/lib/node_modules")
                .into_iter()
                .find(|p| p.is_dir())
        })
        .map(|p| p.to_string_lossy().into_owned())
}

/// The login shell's PATH (`shellenv`: a desktop app started from the launcher inherits a bare
/// PATH, without nvm's node or `~/go/bin`). Not asked in unit tests, which must not start a shell.
fn login_shell_path() -> Option<String> {
    if cfg!(test) {
        None
    } else {
        crate::shellenv::get().get("PATH").cloned()
    }
}

/// PATH for finding and running the servers, so they find their runtimes (gopls needs `go`; the
/// node servers need `node`) regardless of the app's own PATH: `front` (the node server's own
/// bin folder, whose `node` is the one it was installed with), the go folders, the login shell's
/// PATH and the app's — without repeats, joined the platform's way (`;` on Windows).
fn augmented_path(front: Option<&Path>) -> OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    dirs.extend(front.map(Path::to_path_buf));
    dirs.push(PathBuf::from("/usr/local/go/bin"));
    dirs.extend(home_dir().map(|h| h.join("go/bin")));
    let base = std::env::var_os("PATH").unwrap_or_default();
    join_dirs(
        dirs,
        login_shell_path().map(OsString::from).as_deref(),
        &base,
    )
}

/// `extra` then every entry of `login` and `base`, first occurrence kept.
fn join_dirs(
    extra: Vec<PathBuf>,
    login: Option<&std::ffi::OsStr>,
    base: &std::ffi::OsStr,
) -> OsString {
    let mut seen = HashSet::new();
    let all: Vec<PathBuf> = extra
        .into_iter()
        .chain(
            login
                .map(|l| std::env::split_paths(l).collect::<Vec<_>>())
                .unwrap_or_default(),
        )
        .chain(std::env::split_paths(base))
        .filter(|d| !d.as_os_str().is_empty() && seen.insert(d.clone()))
        .collect();
    std::env::join_paths(all).unwrap_or_else(|_| base.to_os_string())
}

/// Pastas abertas na app (registadas por `lsp_start`). São a raiz de reserva de um ficheiro
/// que não está dentro de nenhum projecto com marcador — um `Main.java` solto, um `.sql`
/// (o SQL não tem marcador nenhum) — para o servidor arrancar à mesma.
fn workspace_roots() -> &'static Mutex<HashSet<String>> {
    static W: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    W.get_or_init(|| Mutex::new(HashSet::new()))
}

/// A pasta aberta mais funda que contém `path` (`None` se o ficheiro está fora de todas).
fn fallback_root(path: &str, roots: &HashSet<String>) -> Option<String> {
    roots
        .iter()
        .filter(|r| {
            let r = r.trim_end_matches('/');
            path.strip_prefix(r)
                .is_some_and(|rest| rest.starts_with('/'))
        })
        .max_by_key(|r| r.len())
        .map(|r| r.trim_end_matches('/').to_string())
}

/// Nearest ancestor directory of `path` holding any of `markers` (the file's project root).
fn project_root_for(path: &str, markers: &[String]) -> Option<String> {
    let mut dir = std::path::Path::new(path).parent();
    while let Some(d) = dir {
        if markers.iter().any(|m| d.join(m).exists()) {
            return Some(d.to_string_lossy().to_string());
        }
        dir = d.parent();
    }
    None
}

fn path_to_uri(p: &str) -> String {
    let mut s = String::from("file://");
    for ch in p.chars() {
        match ch {
            '/' => s.push('/'),
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => s.push(ch),
            _ => {
                for b in ch.to_string().as_bytes() {
                    s.push_str(&format!("%{:02X}", b));
                }
            }
        }
    }
    s
}

fn write_msg(stdin: &mut ChildStdin, v: &Value) -> std::io::Result<()> {
    let body = serde_json::to_string(v).unwrap_or_default();
    write!(stdin, "Content-Length: {}\r\n\r\n{}", body.len(), body)?;
    stdin.flush()
}

fn read_message<R: Read>(r: &mut R) -> Option<Value> {
    let mut content_len = 0usize;
    let mut byte = [0u8; 1];
    loop {
        let mut line = Vec::new();
        loop {
            if r.read(&mut byte).ok()? == 0 {
                return None;
            }
            if byte[0] == b'\n' {
                break;
            }
            if byte[0] != b'\r' {
                line.push(byte[0]);
            }
        }
        if line.is_empty() {
            break;
        }
        let s = String::from_utf8_lossy(&line);
        if let Some(v) = s.strip_prefix("Content-Length:") {
            content_len = v.trim().parse().ok()?;
        }
    }
    let mut buf = vec![0u8; content_len];
    r.read_exact(&mut buf).ok()?;
    serde_json::from_slice(&buf).ok()
}

/// O `id` de um PEDIDO do servidor ao cliente (tem `method` e `id`). O id pode ser número OU
/// texto: o jdtls (lsp4j) envia-o como texto (`"id": "13"`). Só se aceitava número, por isso
/// nenhum pedido do jdtls era respondido — e o `workspace/configuration` que ele faz durante
/// um code action deixava-o à espera para sempre (bloqueando os pedidos seguintes).
fn server_request_id(msg: &Value) -> Option<Value> {
    let id = msg.get("id")?;
    (msg.get("method").is_some_and(Value::is_string)
        && (id.is_i64() || id.is_u64() || id.is_string()))
    .then(|| id.clone())
}

fn dispatch(session: &Arc<Mutex<Session>>, app: &AppHandle, root: &str, label: &str, msg: Value) {
    if let Some(id) = server_request_id(&msg) {
        let method = msg["method"].as_str().unwrap_or_default();
        {
            let result = if method == "workspace/configuration" {
                // the server's settings (an override's `settings`), section by section
                let settings = session
                    .lock()
                    .map(|g| g.settings.clone())
                    .unwrap_or(Value::Null);
                configuration_reply(&settings, &msg["params"])
            } else if method == "workspace/applyEdit" {
                // Um comando executado no servidor (code action) quer mudar ficheiros: a UI
                // (features/lsp) aplica a WorkspaceEdit pelo mesmo caminho do rename.
                let _ = app.emit(
                    "lsp://apply-edit",
                    json!({
                        "root": root,
                        "server": label,
                        "label": msg["params"]["label"],
                        "edit": msg["params"]["edit"],
                    }),
                );
                json!({ "applied": true })
            } else {
                Value::Null
            };
            let reply = json!({ "jsonrpc": "2.0", "id": id, "result": result });
            if let Ok(mut g) = session.lock() {
                if let Some(si) = g.stdin.as_mut() {
                    let _ = write_msg(si, &reply);
                }
            }
        }
    } else if let Some(rid) = msg.get("id").and_then(Value::as_i64) {
        // resposta a um pedido nosso (os nossos ids são números)
        if let Ok(mut g) = session.lock() {
            if let Some(tx) = g.pending.remove(&rid) {
                let _ = tx.send(msg.get("result").cloned().unwrap_or(Value::Null));
            }
        }
    } else if let Some(method) = msg.get("method").and_then(Value::as_str) {
        if method == "textDocument/publishDiagnostics" {
            cache_diagnostics(msg.get("params").unwrap_or(&Value::Null));
            let _ = app.emit(
                "lsp://diagnostics",
                msg.get("params").cloned().unwrap_or(Value::Null),
            );
        } else if method == "$/progress" {
            let token = msg["params"]["token"].as_str().unwrap_or("").to_string();
            let v = &msg["params"]["value"];
            let kind = v["kind"].as_str().unwrap_or("");
            let title = v["title"].as_str().unwrap_or("");
            // Surface the server's own indexing progress so the UI can show it (with the
            // server's label, so the pill reads "gopls · …" for Go, "rust-analyzer · …" etc.).
            let _ = app.emit(
                "lsp://status",
                json!({
                    "root": root,
                    "server": label,
                    "kind": kind,
                    "title": title,
                    "message": v["message"].as_str().unwrap_or(""),
                    "percentage": v["percentage"].as_u64(),
                }),
            );
            // The session is READY only when the SYMBOL INDEX is built, NOT on the first
            // `end`: earlier phases (ra's Fetching/CrateGraph/Roots-Scanned, …) finish while
            // find-references / rename still see a partial project — exactly what broke on a
            // fresh open. We match a MEASURED per-server signal (`ready_signal`) against the
            // token OR the work's begin-title (the `end` event carries neither title nor the
            // readable token for gopls), so we remember begin-titles by token to look up here.
            if let Ok(mut g) = session.lock() {
                match kind {
                    "begin" if !title.is_empty() => {
                        g.progress_titles.insert(token.clone(), title.to_string());
                    }
                    "end" => {
                        let begin_title = g.progress_titles.remove(&token).unwrap_or_default();
                        let hay = format!("{} {}", token, begin_title).to_ascii_lowercase();
                        if !g.ready_signal.is_empty() && hay.contains(g.ready_signal.as_str()) {
                            g.ready = true;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

fn session_request(
    session: &Arc<Mutex<Session>>,
    method: &str,
    params: Value,
) -> Result<Value, String> {
    session_request_within(session, method, params, Duration::from_secs(30))
}

fn session_request_within(
    session: &Arc<Mutex<Session>>,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let (tx, rx) = channel();
    {
        let mut g = session.lock().map_err(|_| "lsp lock")?;
        g.next_id += 1;
        let id = g.next_id;
        g.pending.insert(id, tx);
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let si = g.stdin.as_mut().ok_or("lsp not started")?;
        write_msg(si, &msg).map_err(|e| e.to_string())?;
    }
    rx.recv_timeout(timeout)
        .map_err(|_| format!("lsp timeout: {method}"))
}

fn session_notify(
    session: &Arc<Mutex<Session>>,
    method: &str,
    params: Value,
) -> Result<(), String> {
    let mut g = session.lock().map_err(|_| "lsp lock")?;
    let msg = json!({ "jsonrpc": "2.0", "method": method, "params": params });
    let si = g.stdin.as_mut().ok_or("lsp not started")?;
    write_msg(si, &msg).map_err(|e| e.to_string())
}

/// Quanto esperar que outra thread acabe o `initialize` de uma sessão que já está no mapa.
const INIT_BUDGET: Duration = Duration::from_secs(60);

/// Espera (limitada) que a sessão tenha feito o `initialize`/`initialized` (ver `Session::initialized`).
fn wait_initialized(session: &Arc<Mutex<Session>>, budget: Duration) {
    let start = Instant::now();
    while !session.lock().map(|g| g.initialized).unwrap_or(true) && start.elapsed() < budget {
        thread::sleep(Duration::from_millis(50));
    }
}

fn is_ready(session: &Arc<Mutex<Session>>) -> bool {
    session.lock().map(|g| g.ready).unwrap_or(false)
}

/// Block (bounded) until rust-analyzer finished its first indexing pass. Runs only on a
/// blocking task, never the UI thread.
fn wait_ready(session: &Arc<Mutex<Session>>, budget: Duration) {
    let start = Instant::now();
    while !is_ready(session) && start.elapsed() < budget {
        thread::sleep(Duration::from_millis(150));
    }
}

/// (Para os testes.) Opções de arranque (`initializationOptions`) do servidor `id`, do registo de linguagens
/// (`initOptions`). O jdtls tem o signatureHelp DESLIGADO por omissão: sem
/// `java.signatureHelp.enabled` responde sempre sem assinaturas (medido directamente contra o
/// jdtls 1.61), e sem `symbols.includeSourceMethodDeclarations` o workspace/symbol dele só devolve
/// tipos (medido: «ad» não encontrava `add`). Os outros servidores não precisam de nada.
#[cfg(test)]
fn init_options(id: &str) -> Value {
    langreg::registry()
        .server(id)
        .map(|s| s.init_options.clone())
        .unwrap_or(Value::Null)
}

/// The answer to `workspace/configuration`: one value per item, from the server's settings by
/// section (`tutor_eval::langreg::settings_section`); `null` for a section it has no settings for.
fn configuration_reply(settings: &Value, params: &Value) -> Value {
    Value::Array(
        params["items"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|it| langreg::settings_section(settings, it["section"].as_str()))
                    .collect()
            })
            .unwrap_or_default(),
    )
}

/// What a session is started with: when any of it changes in the effective entry, a running
/// session is stale (it is restarted). Settings are not here: they are sent to the running server.
fn fingerprint(s: &Server) -> String {
    json!({
        "command": s.command,
        "args": s.args,
        "resolver": s.resolver(),
        "searchDirs": s.search_dirs,
        "envOverride": s.env_override,
        "rootMarkers": s.root_markers,
        "readySignal": s.ready_signal,
        "initOptions": s.init_options,
        "quirks": s.quirks,
    })
    .to_string()
}

fn capabilities() -> Value {
    json!({
        "textDocument": {
            "synchronization": { "didSave": false, "dynamicRegistration": false },
            "definition": { "linkSupport": true },
            "references": {},
            "hover": { "contentFormat": ["markdown", "plaintext"] },
            "rename": { "prepareSupport": true },
            // A UI (features/lsp) expande os snippets ($1, ${1:x}) e aplica os additionalTextEdits.
            "completion": {
                "completionItem": {
                    "snippetSupport": true,
                    "documentationFormat": ["markdown", "plaintext"],
                    "insertReplaceSupport": false
                },
                "contextSupport": true
            },
            // Code actions como objectos (com `edit`), não só comandos; `isPreferred` põe a
            // correcção principal primeiro no menu da UI.
            "codeAction": {
                "codeActionLiteralSupport": {
                    "codeActionKind": {
                        "valueSet": [
                            "", "quickfix", "refactor", "refactor.extract", "refactor.inline",
                            "refactor.rewrite", "source", "source.organizeImports"
                        ]
                    }
                },
                "isPreferredSupport": true
            },
            // A UI (features/lsp) mostra a assinatura com o parâmetro activo realçado.
            "signatureHelp": {
                "signatureInformation": {
                    "documentationFormat": ["markdown", "plaintext"],
                    "parameterInformation": { "labelOffsetSupport": true },
                    "activeParameterSupport": true
                },
                "contextSupport": true
            },
            // Shift+Alt+F (documento) e Shift+Alt+F com selecção (intervalo) — features/lsp.
            "formatting": {},
            "rangeFormatting": {},
            // Ctrl+Shift+O (Go to Symbol) e o Outline do explorador — features/lsp.
            "documentSymbol": { "hierarchicalDocumentSymbolSupport": true },
            // Show Type Hierarchy (Shift+Alt+T) — features/lsp
            "typeHierarchy": { "dynamicRegistration": false },
            "publishDiagnostics": { "relatedInformation": true }
        },
        // `window.workDoneProgress` is MANDATORY for server-initiated progress: without it
        // rust-analyzer (per the LSP spec) never sends the `$/progress` stream for indexing.
        // That would both hide the progress pill AND — because `ready` only flips on a
        // `$/progress` "end" — leave the session permanently "not ready", disabling hover /
        // prepareRename and forcing every navigation to burn the full `wait_ready` budget.
        "window": { "workDoneProgress": true },
        "workspace": {
            "workspaceEdit": { "documentChanges": true },
            "configuration": true,
            // comandos das code actions: executados no servidor, que devolve as edições por
            // `workspace/applyEdit` (ver `dispatch`)
            "applyEdit": true,
            "executeCommand": {},
            // Go to Symbol in Workspace (Ctrl+T). Sem `resolveSupport`: a UI não pede
            // `workspaceSymbol/resolve` (o kotlin-language-server manda só o URI na mesma).
            "symbol": { "symbolKind": { "valueSet": (1..=26).collect::<Vec<u8>>() } }
        }
    })
}

/// Get the session for `key` (languageId + root), starting and initializing the resolved
/// server at `root` if needed. `program`/`args` come from `server_cmd`. A session started from an
/// older entry (its `fingerprint` differs: an override file changed how it starts) is stopped and
/// replaced. Blocking.
fn get_or_start(
    map: &SessionMap,
    app: &AppHandle,
    key: &str,
    root: &str,
    lang: &Lang,
    program: &str,
    args: &[String],
) -> Result<Arc<Mutex<Session>>, String> {
    active_roots()
        .lock()
        .unwrap()
        .insert(format!("{} ({})", root, lang.id));
    let fp = fingerprint(&lang.server);
    {
        let mut m = map.lock().map_err(|_| "lsp map lock")?;
        if let Some(s) = m.get(key).cloned() {
            if s.lock().map(|g| g.fingerprint == fp).unwrap_or(false) {
                drop(m);
                wait_initialized(&s, INIT_BUDGET);
                return Ok(s);
            }
            m.remove(key);
            drop(m);
            stop_session(&s);
        }
    }
    // so gopls finds `go`, and a node server finds the `node` it was installed with
    let front = (lang.server.resolver() == "node")
        .then(|| Path::new(program).parent())
        .flatten();
    let mut cmd = Command::new(program);
    cmd.args(args)
        .current_dir(root)
        .env("PATH", augmented_path(front))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if lang.server.has_quirk("nodePath") {
        if let Some(nm) = node_global_modules(program) {
            cmd.env("NODE_PATH", nm); // so typescript-language-server can require('typescript')
        }
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {}: {e}", lang.server_label))?;
    let stdin = child.stdin.take().ok_or("lsp server: no stdin")?;
    let stdout = child.stdout.take().ok_or("lsp server: no stdout")?;
    let settings = langreg::normalize_settings(&lang.server.settings);
    let session = Arc::new(Mutex::new(Session {
        child: Some(child),
        stdin: Some(stdin),
        next_id: 0,
        pending: HashMap::new(),
        open: HashSet::new(),
        initialized: false,
        server_caps: Value::Null,
        ready: false,
        ready_signal: lang.ready_signal.clone(),
        fingerprint: fp,
        settings: settings.clone(),
        project: lang.project.clone(),
        progress_titles: HashMap::new(),
    }));
    {
        let mut m = map.lock().map_err(|_| "lsp map lock")?;
        if let Some(existing) = m.get(key) {
            stop_session(&session);
            let existing = existing.clone();
            drop(m);
            wait_initialized(&existing, INIT_BUDGET);
            return Ok(existing);
        }
        m.insert(key.to_string(), session.clone());
    }
    let rsession = session.clone();
    let rapp = app.clone();
    let rroot = root.to_string();
    let rlabel = lang.server_label.clone();
    thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        while let Some(msg) = read_message(&mut r) {
            dispatch(&rsession, &rapp, &rroot, &rlabel, msg);
        }
    });
    let uri = path_to_uri(root);
    let init = session_request(
        &session,
        "initialize",
        json!({
            "processId": null,
            "rootUri": uri,
            "workspaceFolders": [{ "uri": uri, "name": "root" }],
            "capabilities": capabilities(),
            "initializationOptions": lang.server.init_options
        }),
    )?;
    session_notify(&session, "initialized", json!({}))?;
    // the settings, pushed too (some servers never ask `workspace/configuration`); none → nothing
    // sent, as before overrides existed
    if settings.as_object().is_some_and(|o| !o.is_empty()) {
        session_notify(
            &session,
            "workspace/didChangeConfiguration",
            json!({ "settings": settings }),
        )?;
    }
    if let Ok(mut g) = session.lock() {
        g.server_caps = init.get("capabilities").cloned().unwrap_or(Value::Null);
        g.initialized = true;
    }
    // Servers with no end-of-index `$/progress` (empty `ready_signal`, e.g. pyright) answer
    // immediately — mark them ready now so navigation doesn't burn the full `wait_ready`.
    if lang.ready_signal.is_empty() {
        if let Ok(mut g) = session.lock() {
            g.ready = true;
        }
    }
    Ok(session)
}

/// Stop a session's server: its pending requests fail at once, the process is killed (and reaped
/// on a thread of its own).
fn stop_session(session: &Arc<Mutex<Session>>) {
    if let Ok(mut g) = session.lock() {
        g.stdin = None;
        g.pending.clear();
        g.initialized = true; // nobody waits for an `initialize` that will not come
        if let Some(mut c) = g.child.take() {
            let _ = c.kill();
            thread::spawn(move || {
                let _ = c.wait();
            });
        }
    }
}

/// The session key: one server per (server id, session root, open folder) — the open folder
/// because its override files decide the entry (two folders sharing a root never fight over one
/// session). `\0`-separated: [`split_key`].
fn session_key(lang: &Lang, root: &str) -> String {
    format!(
        "{}\u{0}{}\u{0}{}",
        lang.id,
        root,
        lang.project.as_deref().unwrap_or("")
    )
}

/// (server id, session root) of a session key.
fn split_key(key: &str) -> Option<(&str, &str)> {
    let mut it = key.splitn(3, '\u{0}');
    Some((it.next()?, it.next()?))
}

/// A file's session group and the root its session runs at (the nearest project marker, else the
/// open folder it is in). `None`: no server for its language, or no root.
fn locate(path: &str) -> Option<(Lang, String)> {
    let lang = lang_for_path(path)?;
    let root = project_root_for(path, &lang.markers)
        .or_else(|| fallback_root(path, &workspace_roots().lock().unwrap()))?;
    Some((lang, root))
}

/// The documents the editor opened (path → language id, version, text): a server that starts
/// later (a restart after an override changed, an approval) gets each one in a `didOpen` before
/// any request about it.
#[derive(Clone)]
struct OpenDoc {
    language_id: String,
    version: i64,
    text: String,
}

fn docs() -> &'static Mutex<HashMap<String, OpenDoc>> {
    static D: OnceLock<Mutex<HashMap<String, OpenDoc>>> = OnceLock::new();
    D.get_or_init(Default::default)
}

/// Send `didOpen` for `path` if the editor opened it and this session has not seen it; true when
/// it was sent now (the text it carried is the latest).
fn ensure_doc_open(session: &Arc<Mutex<Session>>, path: &str) -> Result<bool, String> {
    let uri = path_to_uri(path);
    let doc = {
        let mut g = session.lock().map_err(|_| "lsp lock")?;
        if g.open.contains(&uri) {
            return Ok(false);
        }
        let Some(d) = docs().lock().unwrap().get(path).cloned() else {
            return Ok(false);
        };
        g.open.insert(uri.clone());
        d
    };
    session_notify(
        session,
        "textDocument/didOpen",
        json!({ "textDocument": { "uri": uri, "languageId": doc.language_id, "version": doc.version, "text": doc.text } }),
    )?;
    Ok(true)
}

/// The trusted-approvals store (the app's config folder; nowhere in unit tests, so nothing is
/// approved there).
fn trust() -> TrustStore {
    let dir = conf().lock().unwrap().dir.clone();
    TrustStore::new(dir.map(|d| d.join(lspconf::TRUST_FILE)).unwrap_or_default())
}

/// The approval a session group still needs before its server may start (a project file that adds
/// it or changes how it starts), `None` when it may start.
fn pending_approval(lang: &Lang, program: &str, cwd: &str) -> Option<lspconf::Approval> {
    lspconf::approval_request(&lang.eff, &lang.id, program, cwd, &trust())
}

/// Resolve the session a file belongs to: its language (by name/extension, or first line), its project root
/// (nearest marker), and the server for that language — starting it if needed — with the file open
/// in it. Blocking. `None` when the file's language has no server, no project root is found, the
/// language's server is not installed (the UI then falls back to the intra-file heuristic), or a
/// project file asks for a command the human has not approved.
fn session_for(
    map: &SessionMap,
    app: &AppHandle,
    path: &str,
) -> Result<Option<Arc<Mutex<Session>>>, String> {
    Ok(open_session(map, app, path)?.map(|(s, _)| s))
}

/// [`session_for`], and whether the file's `didOpen` was sent just now.
fn open_session(
    map: &SessionMap,
    app: &AppHandle,
    path: &str,
) -> Result<Option<(Arc<Mutex<Session>>, bool)>, String> {
    let Some((lang, root)) = locate(path) else {
        return Ok(None);
    };
    let (program, args) = match server_cmd(&lang.server) {
        Ok(c) => c,
        Err(_) => return Ok(None), // server not installed → no session; frontend falls back
    };
    if pending_approval(&lang, &program, &root).is_some() {
        return Ok(None); // the project's command waits for the human (`lsp_server_status` says so)
    }
    let key = session_key(&lang, &root);
    let session = get_or_start(map, app, &key, &root, &lang, &program, &args)?;
    let opened = ensure_doc_open(&session, path)?;
    Ok(Some((session, opened)))
}

fn pos(path: &str, line: u32, character: u32) -> Value {
    json!({ "textDocument": { "uri": path_to_uri(path) }, "position": { "line": line, "character": character } })
}

/// A semantic request that distinguishes "ready but nothing here" from "still indexing".
/// Empty while NOT ready → `{ "indexing": true }` so the UI says "wait" not "no definition".
fn semantic(session: &Arc<Mutex<Session>>, method: &str, params: Value) -> Result<Value, String> {
    wait_ready(session, Duration::from_secs(20));
    let ready = is_ready(session);
    let res = session_request(session, method, params)?;
    let empty = res.is_null() || res.as_array().is_some_and(|a| a.is_empty());
    if empty && !ready {
        return Ok(json!({ "indexing": true }));
    }
    Ok(res)
}

/// Se o servidor de linguagem de um ficheiro está instalado: sem servidor, `session_for` não abre
/// sessão e não dá erro — o editor ficaria calado. A UI pergunta isto para avisar o que falta e
/// como o instalar.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    /// O id da linguagem (`java`, `kotlin`, …).
    pub language: String,
    /// O servidor que o dxtutor procura (`jdtls`, `kotlin-language-server`, …).
    pub server: String,
    pub installed: bool,
    /// Porque não foi encontrado (a mensagem de `server_cmd`).
    pub problem: Option<String>,
    /// O `.dxtutor/lsp.json` do projecto pede um comando que o humano ainda não aprovou: o servidor
    /// não arranca até lá (o editor mostra o pedido com o comando exacto).
    pub approval: Option<lspconf::Approval>,
}

/// O estado do servidor da linguagem de `path` (`None` se o ficheiro não tem servidor conhecido).
/// Resolve-o exactamente como uma sessão o resolveria (`server_cmd`: PATH aumentado + pistas), com
/// os ficheiros de overrides do utilizador e do projecto.
pub fn server_status(path: &str) -> Option<ServerStatus> {
    let lang = lang_for_path(path)?;
    let (installed, problem, approval) = match server_cmd(&lang.server) {
        Ok((program, _)) => {
            let cwd = project_root_for(path, &lang.markers)
                .or_else(|| lang.project.clone())
                .unwrap_or_default();
            (true, None, pending_approval(&lang, &program, &cwd))
        }
        Err(e) => (false, Some(e), None),
    };
    Some(ServerStatus {
        language: lang.id.clone(),
        server: lang.server_label.clone(),
        installed,
        problem,
        approval,
    })
}

// ── Commands — all async: the blocking work runs on spawn_blocking, off the UI thread. ──

/// Se o servidor de linguagem do ficheiro está instalado (para a UI avisar quando falta).
#[tauri::command]
pub async fn lsp_server_status(path: String) -> Result<Option<ServerStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || server_status(&path))
        .await
        .map_err(|e| e.to_string())
}

// ── Overrides (LSP P2): the user file, the project's `.dxtutor/lsp.json`, approvals, reload ──

/// Where the override files and approvals live, and the effective registry of each open folder.
#[derive(Default)]
struct Conf {
    /// the app's config folder (`lsp.json`, `lsp-trusted.json`); `None` in unit tests
    dir: Option<PathBuf>,
    /// open folder (`""` = none) → bundled + user + project, as read
    cache: HashMap<String, Arc<Effective>>,
}

fn conf() -> &'static Mutex<Conf> {
    static C: OnceLock<Mutex<Conf>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// The user's override file (`<app config>/lsp.json`).
fn user_file() -> Option<PathBuf> {
    conf()
        .lock()
        .unwrap()
        .dir
        .as_ref()
        .map(|d| d.join(lspconf::USER_FILE))
}

/// The effective registry of an open folder (`None`: a file outside every open folder — the user
/// file still applies). Read once and kept until a file changes (`reload_changed`).
fn effective(project: Option<&str>) -> Arc<Effective> {
    let key = project.unwrap_or("").to_string();
    if let Some(e) = conf().lock().unwrap().cache.get(&key) {
        return e.clone();
    }
    let user = user_file();
    let e = Arc::new(Effective::load(
        langreg::registry(),
        user.as_deref(),
        project.map(Path::new),
    ));
    conf().lock().unwrap().cache.entry(key).or_insert(e).clone()
}

/// Registers an open folder (the root of a file outside every project marker, and the folder whose
/// `.dxtutor/lsp.json` applies).
fn register_root(root: &str) -> String {
    let r = root.trim_end_matches('/').to_string();
    workspace_roots().lock().unwrap().insert(r.clone());
    r
}

/// Called once at start-up: where the user file and the approvals live, and a thread that applies a
/// change to any override file without restarting the app (checked every 2 s: one `stat` per file).
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_config_dir() {
        conf().lock().unwrap().dir = Some(dir);
    }
    let app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(2));
        let map = app.state::<LspState>().0.clone();
        reload_changed(&app, &map);
    });
}

/// Re-read the override files that changed since they were read and bring the running servers in
/// line; true when something changed.
fn reload_changed(app: &AppHandle, map: &SessionMap) -> bool {
    let stale: Vec<String> = conf()
        .lock()
        .unwrap()
        .cache
        .iter()
        .filter(|(_, e)| !e.is_current())
        .map(|(k, _)| k.clone())
        .collect();
    if stale.is_empty() {
        return false;
    }
    reload(app, map, &stale);
    true
}

/// Forget the effective registry of `keys` (open folders; `""` = none), read them again and apply
/// the difference to the running servers ([`reconcile`]); the UI hears `lsp://config`.
fn reload(app: &AppHandle, map: &SessionMap, keys: &[String]) {
    let old: HashMap<String, Arc<Effective>> = {
        let mut c = conf().lock().unwrap();
        keys.iter()
            .filter_map(|k| c.cache.remove(k).map(|e| (k.clone(), e)))
            .collect()
    };
    reconcile(app, map, &old);
    let _ = app.emit("lsp://config", json!({ "roots": keys }));
}

/// Bring every running session whose open folder's registry changed in line with the new entry: a
/// server that is gone stops; one whose start-up changed (`fingerprint`) restarts — unless the
/// project now asks for a command that needs approval — and gets the open documents again; one
/// whose settings changed hears `workspace/didChangeConfiguration`.
fn reconcile(app: &AppHandle, map: &SessionMap, old: &HashMap<String, Arc<Effective>>) {
    let sessions: Vec<(String, Arc<Mutex<Session>>)> = match map.lock() {
        Ok(m) => m.iter().map(|(k, s)| (k.clone(), s.clone())).collect(),
        Err(_) => return,
    };
    for (key, s) in sessions {
        let Some((server_id, root)) = split_key(&key) else {
            continue;
        };
        let (project, fp, settings) = match s.lock() {
            Ok(g) => (g.project.clone(), g.fingerprint.clone(), g.settings.clone()),
            Err(_) => continue,
        };
        if !old.contains_key(project.as_deref().unwrap_or("")) {
            continue;
        }
        let eff = effective(project.as_deref());
        let server = eff
            .registry
            .server(server_id)
            .filter(|_| serves_a_language(&eff.registry, server_id))
            .cloned();
        let Some(server) = server else {
            remove_session(map, &key, &s); // gone, or no language uses it any more
            continue;
        };
        if fingerprint(&server) != fp {
            remove_session(map, &key, &s);
            let lang = Lang::of(&server, project.clone(), eff.clone());
            let (map, app, key, root) = (map.clone(), app.clone(), key.clone(), root.to_string());
            thread::spawn(move || restart(&map, &app, &key, &root, &lang));
            continue;
        }
        let new_settings = langreg::normalize_settings(&server.settings);
        if new_settings != settings {
            if let Ok(mut g) = s.lock() {
                g.settings = new_settings.clone();
            }
            let payload = if new_settings.is_null() {
                json!({})
            } else {
                new_settings
            };
            let _ = session_notify(
                &s,
                "workspace/didChangeConfiguration",
                json!({ "settings": payload }),
            );
        }
    }
}

fn remove_session(map: &SessionMap, key: &str, s: &Arc<Mutex<Session>>) {
    if let Ok(mut m) = map.lock() {
        if m.get(key).is_some_and(|x| Arc::ptr_eq(x, s)) {
            m.remove(key);
        }
    }
    stop_session(s);
}

/// Start a session group again (after its entry changed) and give it the documents the editor has
/// open in it. Nothing starts when the server is not installed or waits for an approval.
fn restart(map: &SessionMap, app: &AppHandle, key: &str, root: &str, lang: &Lang) {
    let Ok((program, args)) = server_cmd(&lang.server) else {
        return;
    };
    if pending_approval(lang, &program, root).is_some() {
        return;
    }
    let Ok(session) = get_or_start(map, app, key, root, lang, &program, &args) else {
        return;
    };
    for path in docs_in(key) {
        let _ = ensure_doc_open(&session, &path);
    }
}

/// The open documents whose session would be `key`.
fn docs_in(key: &str) -> Vec<String> {
    let paths: Vec<String> = docs().lock().unwrap().keys().cloned().collect();
    paths
        .into_iter()
        .filter(|p| locate(p).is_some_and(|(l, r)| session_key(&l, &r) == key))
        .collect()
}

/// A server of the effective registry, as the UI shows it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerView {
    #[serde(flatten)]
    pub entry: Server,
    /// the layers that made it (`bundled`, `user`, `project`)
    pub sources: Vec<&'static str>,
    /// the launch fields the project file set (empty: it runs as bundled/user say)
    pub project_launch: Vec<&'static str>,
    /// the approval it still needs (installed, and the project changed how it starts)
    pub approval: Option<lspconf::Approval>,
}

/// The override files and the registry they make for an open folder (`lsp_config`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspConfigView {
    pub root: Option<String>,
    /// `None` when the app has no config folder
    pub user_file: Option<lspconf::FileReport>,
    pub project_file: Option<lspconf::FileReport>,
    pub languages: Vec<langreg::Language>,
    pub servers: Vec<ServerView>,
}

fn config_view(project: Option<&str>) -> LspConfigView {
    let eff = effective(project);
    let servers = eff
        .registry
        .servers
        .iter()
        .map(|s| {
            let project_launch = if eff.project.as_ref().is_some_and(|p| p.applied) {
                eff.project_launch_changes(&s.id)
            } else {
                Vec::new()
            };
            let approval = if project_launch.is_empty() {
                None
            } else {
                server_cmd(s).ok().and_then(|(program, _)| {
                    let lang = Lang::of(s, project.map(String::from), eff.clone());
                    pending_approval(&lang, &program, project.unwrap_or_default())
                })
            };
            ServerView {
                entry: s.clone(),
                sources: eff.sources_of("server", &s.id),
                project_launch,
                approval,
            }
        })
        .collect();
    LspConfigView {
        root: project.map(String::from),
        user_file: eff.user.clone(),
        project_file: eff.project.clone(),
        languages: eff.registry.languages.clone(),
        servers,
    }
}

/// The override files of the open folder `root` (their errors, if they were ignored) and the
/// registry the editor uses there (bundled + user + project), with the approvals still missing.
/// Reads any file that changed first.
#[tauri::command]
pub async fn lsp_config(
    app: AppHandle,
    state: State<'_, LspState>,
    root: Option<String>,
) -> Result<LspConfigView, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project = root.as_deref().map(register_root);
        reload_changed(&app, &map);
        config_view(project.as_deref())
    })
    .await
    .map_err(|e| e.to_string())
}

/// An override file to edit: the user's (`kind: "user"`) or the project's (`"project"`, needs
/// `root`). Its text, or the commented template when it does not exist yet.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigFile {
    pub path: String,
    pub exists: bool,
    pub text: String,
}

fn config_file(kind: &str, root: Option<&str>) -> Result<ConfigFile, String> {
    let (path, template) = match kind {
        "user" => (
            user_file().ok_or("dxtutor has no config folder here")?,
            lspconf::USER_TEMPLATE,
        ),
        "project" => (
            lspconf::project_file(Path::new(
                root.filter(|r| !r.trim().is_empty())
                    .ok_or("open a folder first")?,
            )),
            lspconf::PROJECT_TEMPLATE,
        ),
        other => return Err(format!("unknown override file `{other}` (user or project)")),
    };
    let meta = std::fs::metadata(&path).ok();
    if meta
        .as_ref()
        .is_some_and(|m| m.len() > lspconf::MAX_FILE_BYTES)
    {
        return Err(format!("{}: too big to edit here", path.display()));
    }
    let exists = meta.is_some();
    let text = if exists {
        std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?
    } else {
        template.to_string()
    };
    Ok(ConfigFile {
        path: path.display().to_string(),
        exists,
        text,
    })
}

#[tauri::command]
pub async fn lsp_config_file(kind: String, root: Option<String>) -> Result<ConfigFile, String> {
    tauri::async_runtime::spawn_blocking(move || config_file(&kind, root.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// Save the user's override file (only that file: the path is decided here) and apply it at once.
/// An invalid file is saved too — it is being edited — and its report says why it is ignored.
#[tauri::command]
pub async fn lsp_user_config_save(
    app: AppHandle,
    state: State<'_, LspState>,
    text: String,
) -> Result<lspconf::FileReport, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if text.len() as u64 > lspconf::MAX_FILE_BYTES {
            return Err("an override file is at most 512 KiB".to_string());
        }
        let path = user_file().ok_or("dxtutor has no config folder here")?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
        }
        std::fs::write(&path, text).map_err(|e| format!("{}: {e}", path.display()))?;
        // every open folder sees the user file: all of them are read again
        let mut keys: Vec<String> = conf().lock().unwrap().cache.keys().cloned().collect();
        if !keys.iter().any(|k| k.is_empty()) {
            keys.push(String::new());
        }
        reload(&app, &map, &keys);
        Ok(effective(None).user.clone().unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The human's decision on a server the project's `.dxtutor/lsp.json` asks for. `hash` is the one
/// the dialog showed (`ServerStatus.approval`): if the project's command changed since, nothing is
/// approved. The decision goes to the audit log FIRST (no audit, no approval); an approval is kept
/// for this project and this exact command, and the server starts for the open files.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn lsp_approve_server(
    app: AppHandle,
    state: State<'_, LspState>,
    root: String,
    server: String,
    hash: String,
    approved: bool,
    reason: Option<String>,
    decided_at: Option<i64>,
) -> Result<(), String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let project = register_root(&root);
        reload_changed(&app, &map);
        let eff = effective(Some(&project));
        let entry = eff
            .registry
            .server(&server)
            .cloned()
            .ok_or_else(|| format!("no language server `{server}` in this project"))?;
        let (program, _) = server_cmd(&entry)?;
        let lang = Lang::of(&entry, Some(project.clone()), eff.clone());
        let req = pending_approval(&lang, &program, &project)
            .ok_or("this language server needs no approval (or it is approved already)")?;
        if req.hash != hash {
            return Err(
                "the project's command changed since it was shown — review it again".to_string(),
            );
        }
        crate::board::audit_record(
            app.clone(),
            project.clone(),
            crate::board::IdeAudit {
                feature: "lsp".into(),
                action: "lsp.server.approve".into(),
                command: req.command.clone(),
                scope: Some(format!(
                    "{} · asked by {} · cwd {}",
                    req.label, req.file, req.cwd
                )),
                approved,
                reason,
                outcome: None,
                decided_at,
            },
        )
        .map_err(|e| format!("not approved: the audit log failed ({})", e.message))?;
        if !approved {
            return Ok(());
        }
        trust().approve(&project, &server, &hash, crate::board::now_ms())?;
        // the open files of this language start their server now
        let paths: Vec<String> = docs().lock().unwrap().keys().cloned().collect();
        for p in paths {
            if locate(&p)
                .is_some_and(|(l, _)| l.id == server && l.project.as_deref() == Some(&project))
            {
                let _ = open_session(&map, &app, &p);
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_start(
    app: AppHandle,
    state: State<'_, LspState>,
    root: String,
) -> Result<(), String> {
    let map = state.0.clone();
    workspace_roots()
        .lock()
        .unwrap()
        .insert(root.trim_end_matches('/').to_string());
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // Warm up every language whose project marker sits AT the opened folder, so the
        // (possibly minutes-long) first index starts before the student navigates. A server the
        // project's `.dxtutor/lsp.json` asks for without an approval does not start.
        let project = root.trim_end_matches('/').to_string();
        for lang in langs_for(Some(&project)) {
            if lang
                .markers
                .iter()
                .any(|m| std::path::Path::new(&root).join(m).exists())
            {
                if let Ok((program, args)) = server_cmd(&lang.server) {
                    if pending_approval(&lang, &program, &root).is_some() {
                        continue;
                    }
                    let key = session_key(&lang, &root);
                    let _ = get_or_start(&map, &app, &key, &root, &lang, &program, &args);
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_did_open(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    text: String,
    language_id: String,
) -> Result<(), String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        // remembered, so a server that starts later gets it too; sent once per session
        docs().lock().unwrap().insert(
            path.clone(),
            OpenDoc {
                language_id,
                version: 1,
                text,
            },
        );
        open_session(&map, &app, &path)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_did_change(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    text: String,
    version: i64,
) -> Result<(), String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        {
            let mut d = docs().lock().unwrap();
            match d.get_mut(&path) {
                Some(doc) => {
                    doc.version = version;
                    doc.text = text.clone();
                }
                None => {
                    let language_id = lang_for_path(&path)
                        .and_then(|l| {
                            l.eff
                                .registry
                                .language_for_file(&path)
                                .map(|x| x.lsp_id().to_string())
                        })
                        .unwrap_or_default();
                    d.insert(
                        path.clone(),
                        OpenDoc {
                            language_id,
                            version,
                            text: text.clone(),
                        },
                    );
                }
            }
        }
        let uri = path_to_uri(&path);
        diag_stamps()
            .lock()
            .unwrap()
            .0
            .insert(uri.clone(), Instant::now());
        let Some((session, opened)) = open_session(&map, &app, &path)? else { return Ok(()); };
        if opened {
            return Ok(()); // a server that had not seen the file got it whole in the didOpen
        }
        session_notify(
            &session,
            "textDocument/didChange",
            json!({ "textDocument": { "uri": uri, "version": version }, "contentChanges": [{ "text": text }] }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_definition(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        semantic(
            &session,
            "textDocument/definition",
            pos(&path, line, character),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_references(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        let mut p = pos(&path, line, character);
        p["context"] = json!({ "includeDeclaration": true });
        semantic(&session, "textDocument/references", p)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_hover(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        // Hover fires continuously — NEVER block on readiness: always ask the server and let
        // it answer (it returns null fast while still indexing). Gating on `ready` here was a
        // bug: a server whose end-of-index signal we don't yet recognise would never hover.
        session_request(&session, "textDocument/hover", pos(&path, line, character))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Sugestões de completion na posição (`textDocument/completion`). Como o hover, nunca espera
/// pelo fim da indexação: chega enquanto se escreve, e o servidor responde com o que tiver.
/// `trigger_character` (ex. `.`) quando foi esse carácter que abriu a lista.
#[tauri::command]
pub async fn lsp_completion(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    trigger_character: Option<String>,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        let mut p = pos(&path, line, character);
        p["context"] = match trigger_character {
            Some(c) if !c.is_empty() => json!({ "triggerKind": 2, "triggerCharacter": c }),
            _ => json!({ "triggerKind": 1 }),
        };
        session_request(&session, "textDocument/completion", p)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A assinatura da chamada em que está o cursor (`textDocument/signatureHelp`). Como o hover,
/// não espera pelo fim da indexação. `trigger_character` (`(` ou `,`) quando foi esse carácter
/// que a pediu; `is_retrigger` quando a assinatura já estava à vista (o servidor pode manter a
/// escolhida entre sobrecargas).
#[tauri::command]
pub async fn lsp_signature_help(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    trigger_character: Option<String>,
    is_retrigger: Option<bool>,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        let mut p = pos(&path, line, character);
        let retrigger = is_retrigger.unwrap_or(false);
        p["context"] = match trigger_character {
            Some(c) if !c.is_empty() => {
                json!({ "triggerKind": 2, "triggerCharacter": c, "isRetrigger": retrigger })
            }
            _ => json!({ "triggerKind": if retrigger { 3 } else { 1 }, "isRetrigger": retrigger }),
        };
        session_request(&session, "textDocument/signatureHelp", p)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Os diagnósticos publicados (`diagnostics`, a lista de um ficheiro) nas LINHAS do intervalo
/// `sl..=el` — o contexto que o servidor quer para propor correcções. Por linha, não pela
/// posição exacta (como o VS Code): com o cursor em `broken` e o erro marcado no `42` da mesma
/// linha, sem isto o jdtls não recebia o diagnóstico e não propunha a correcção.
fn diagnostics_in_range(diagnostics: &Value, sl: u32, el: u32) -> Vec<Value> {
    let line = |v: &Value| v["line"].as_u64().unwrap_or(0);
    let (s, e) = (sl as u64, el as u64);
    diagnostics
        .as_array()
        .into_iter()
        .flatten()
        .filter(|d| line(&d["range"]["start"]) <= e && s <= line(&d["range"]["end"]))
        .cloned()
        .collect()
}

/// As code actions (correcções e refactorings) para o intervalo, com os diagnósticos já
/// publicados que o tocam (`textDocument/codeAction`). Não espera pela indexação.
#[tauri::command]
pub async fn lsp_code_action(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        let uri = path_to_uri(&path);
        // logo depois de uma edição, os diagnósticos em cache são do texto antigo
        wait_fresh_diagnostics(&uri, Duration::from_secs(2));
        let diagnostics = diag_cache()
            .lock()
            .unwrap()
            .get(&uri)
            .map(|d| diagnostics_in_range(d, start_line, end_line))
            .unwrap_or_default();
        session_request(
            &session,
            "textDocument/codeAction",
            json!({
                "textDocument": { "uri": uri },
                "range": {
                    "start": { "line": start_line, "character": start_character },
                    "end": { "line": end_line, "character": end_character }
                },
                "context": { "diagnostics": diagnostics, "triggerKind": 1 }
            }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Executa no servidor o comando de uma code action (`workspace/executeCommand`). As
/// edições que daí resultem chegam à UI pelo evento `lsp://apply-edit`.
#[tauri::command]
pub async fn lsp_execute_command(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    command: String,
    arguments: Option<Value>,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        let mut params = json!({ "command": command });
        if let Some(a) = arguments.filter(|a| !a.is_null()) {
            params["arguments"] = a;
        }
        session_request(&session, "workspace/executeCommand", params)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Os parâmetros de `textDocument/formatting` (sem intervalo) ou `textDocument/rangeFormatting`.
fn format_request(
    uri: &str,
    tab_size: u32,
    insert_spaces: bool,
    range: Option<(u32, u32, u32, u32)>,
) -> (&'static str, Value) {
    let mut params = json!({
        "textDocument": { "uri": uri },
        "options": { "tabSize": tab_size, "insertSpaces": insert_spaces }
    });
    match range {
        Some((sl, sc, el, ec)) => {
            params["range"] = json!({
                "start": { "line": sl, "character": sc },
                "end": { "line": el, "character": ec }
            });
            ("textDocument/rangeFormatting", params)
        }
        None => ("textDocument/formatting", params),
    }
}

/// Formata o documento (ou só o intervalo, se vier) — devolve as `TextEdit` do servidor,
/// `null` se ele não formatou (sem suporte ou erro: o kotlin-language-server, por exemplo,
/// falha a formatar um fragmento, porque o ktfmt analisa o intervalo sozinho).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn lsp_format(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    tab_size: u32,
    insert_spaces: bool,
    start_line: Option<u32>,
    start_character: Option<u32>,
    end_line: Option<u32>,
    end_character: Option<u32>,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        let range = match (start_line, start_character, end_line, end_character) {
            (Some(sl), Some(sc), Some(el), Some(ec)) => Some((sl, sc, el, ec)),
            _ => None,
        };
        let (method, params) = format_request(&path_to_uri(&path), tab_size, insert_spaces, range);
        session_request(&session, method, params)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Os símbolos do ficheiro (`textDocument/documentSymbol`): `DocumentSymbol[]` hierárquico
/// (jdtls, kotlin-language-server) ou `SymbolInformation[]`. Como o hover, não espera pela
/// indexação: o servidor responde com o que tem do ficheiro aberto.
#[tauri::command]
pub async fn lsp_document_symbols(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        session_request(
            &session,
            "textDocument/documentSymbol",
            json!({ "textDocument": { "uri": path_to_uri(&path) } }),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

/// As sessões vivas e inicializadas cuja raiz se sobrepõe à pasta `root` (a mesma, uma
/// subpasta com marcador de projecto, ou uma pasta acima), com a linguagem de cada uma.
fn sessions_under(map: &SessionMap, root: &str) -> Vec<(String, Arc<Mutex<Session>>)> {
    let root = root.trim_end_matches('/');
    let Ok(m) = map.lock() else {
        return Vec::new();
    };
    m.iter()
        .filter_map(|(key, s)| {
            let (lang, r) = split_key(key)?;
            let ok = roots_overlap(root, r) && s.lock().map(|g| g.initialized).unwrap_or(false);
            ok.then(|| (lang.to_string(), s.clone()))
        })
        .collect()
}

/// A raiz de uma sessão `r` pertence à pasta aberta `root`: a mesma, uma subpasta, ou uma acima.
fn roots_overlap(root: &str, r: &str) -> bool {
    let (root, r) = (root.trim_end_matches('/'), r.trim_end_matches('/'));
    r == root || r.starts_with(&format!("{root}/")) || root.starts_with(&format!("{r}/"))
}

/// Os símbolos da pasta inteira (`workspace/symbol`) que servem para `query`, perguntados a
/// cada servidor que já está a correr nessa pasta (em paralelo, até 5 s cada; um servidor que
/// não responde fica de fora). Devolve `[{ language, result }]`. Não arranca servidores: os
/// que existem são os das linguagens abertas (ou aquecidas pelo `lsp_start`).
/// Medido: o jdtls não devolve nada a uma consulta vazia, e o kotlin-language-server devolve
/// só o URI do ficheiro (sem linha) — a UI procura a posição no ficheiro depois de o abrir.
#[tauri::command]
pub async fn lsp_workspace_symbols(
    state: State<'_, LspState>,
    root: String,
    query: String,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let sessions = sessions_under(&map, &root);
        let out: Vec<Value> = thread::scope(|sc| {
            let jobs: Vec<_> = sessions
                .iter()
                .map(|(lang, s)| {
                    let q = query.clone();
                    sc.spawn(move || {
                        session_request_within(
                            s,
                            "workspace/symbol",
                            json!({ "query": q }),
                            Duration::from_secs(5),
                        )
                        .ok()
                        .map(|result| json!({ "language": lang, "result": result }))
                    })
                })
                .collect();
            jobs.into_iter()
                .filter_map(|j| j.join().ok().flatten())
                .collect()
        });
        Ok(Value::Array(out))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// O servidor anunciou a capacidade `name` (`true` ou um objecto de opções)?
fn server_supports(session: &Arc<Mutex<Session>>, name: &str) -> bool {
    session
        .lock()
        .map(|g| caps_support(&g.server_caps, name))
        .unwrap_or(false)
}

fn caps_support(caps: &Value, name: &str) -> bool {
    match caps.get(name) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Object(_)) => true,
        _ => false,
    }
}

/// O tipo no cursor para a hierarquia de tipos (`textDocument/prepareTypeHierarchy`):
/// `{ supported, items }`. Medido: o jdtls suporta-a; o kotlin-language-server não a anuncia e
/// responde com erro (`UnsupportedOperationException`) — daí o `supported: false`, para a UI o dizer.
#[tauri::command]
pub async fn lsp_prepare_type_hierarchy(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        if !server_supports(&session, "typeHierarchyProvider") {
            return Ok(json!({ "supported": false, "items": [] }));
        }
        let items = session_request(
            &session,
            "textDocument/prepareTypeHierarchy",
            pos(&path, line, character),
        )?;
        Ok(json!({ "supported": true, "items": if items.is_null() { json!([]) } else { items } }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Os supertipos ou subtipos de um item da hierarquia (`typeHierarchy/supertypes|subtypes`). O
/// `item` volta ao servidor tal como veio (com o `data` dele). `path` escolhe a sessão.
#[tauri::command]
pub async fn lsp_type_hierarchy(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    item: Value,
    direction: String,
) -> Result<Value, String> {
    let method = match direction.as_str() {
        "supertypes" => "typeHierarchy/supertypes",
        "subtypes" => "typeHierarchy/subtypes",
        other => return Err(format!("unknown direction: {other}")),
    };
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        session_request(&session, method, json!({ "item": item }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_rename(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    new_name: String,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        let mut p = pos(&path, line, character);
        p["newName"] = json!(new_name);
        semantic(&session, "textDocument/rename", p)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_prepare_rename(
    app: AppHandle,
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
) -> Result<Value, String> {
    let map = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, String> {
        let Some(session) = session_for(&map, &app, &path)? else {
            return Ok(Value::Null);
        };
        session_request(
            &session,
            "textDocument/prepareRename",
            pos(&path, line, character),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Diagnósticos em cache, para o agente (ferramenta `lsp_diagnostics`, ADR-0003 F7) ──
//
// O servidor publica diagnósticos por ficheiro (`textDocument/publishDiagnostics`); além de
// os enviar à UI, guardamos a última publicação de cada ficheiro. O agente lê esta cache —
// não arranca nem controla sessões LSP (isso continua com a UI).

fn diag_cache() -> &'static Mutex<HashMap<String, Value>> {
    static C: OnceLock<Mutex<HashMap<String, Value>>> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

fn active_roots() -> &'static Mutex<HashSet<String>> {
    static A: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    A.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Quando cada ficheiro mudou pela última vez (`didChange`) e quando o servidor publicou
/// diagnósticos dele pela última vez. Um code action pedido logo depois de uma edição tem de
/// esperar pelos diagnósticos do texto novo: com os antigos, o contexto vem vazio ou errado e o
/// servidor não propõe a correcção (medido: o jdtls publica ~0,8 s depois do didChange).
fn diag_stamps() -> &'static Mutex<(HashMap<String, Instant>, HashMap<String, Instant>)> {
    static S: OnceLock<Mutex<(HashMap<String, Instant>, HashMap<String, Instant>)>> =
        OnceLock::new();
    S.get_or_init(|| Mutex::new((HashMap::new(), HashMap::new())))
}

/// Os diagnósticos em cache são de um texto mais antigo do que o actual?
fn diagnostics_stale(changed: Option<Instant>, published: Option<Instant>) -> bool {
    match (changed, published) {
        (Some(c), Some(p)) => p < c,
        (Some(_), None) => true,
        _ => false,
    }
}

/// Espera (até `max`) que o servidor publique os diagnósticos do texto actual de `uri`.
fn wait_fresh_diagnostics(uri: &str, max: Duration) {
    let t0 = Instant::now();
    loop {
        let stale = {
            let s = diag_stamps().lock().unwrap();
            diagnostics_stale(s.0.get(uri).copied(), s.1.get(uri).copied())
        };
        if !stale || t0.elapsed() >= max {
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn cache_diagnostics(params: &Value) {
    if let Some(uri) = params["uri"].as_str() {
        diag_stamps()
            .lock()
            .unwrap()
            .1
            .insert(uri.to_string(), Instant::now());
        let diags = params["diagnostics"].clone();
        let mut c = diag_cache().lock().unwrap();
        if diags.as_array().is_some_and(|a| a.is_empty()) {
            c.remove(uri);
        } else {
            c.insert(uri.to_string(), diags);
        }
    }
}

/// Uma linha por diagnóstico: `caminho:linha:coluna gravidade: mensagem`.
fn format_diagnostics(
    root: &std::path::Path,
    only: Option<&std::path::Path>,
    cache: &HashMap<String, Value>,
) -> Vec<String> {
    let mut out = vec![];
    let mut uris: Vec<&String> = cache.keys().collect();
    uris.sort();
    for uri in uris {
        let path = std::path::PathBuf::from(uri.strip_prefix("file://").unwrap_or(uri));
        if !path.starts_with(root) || only.is_some_and(|o| o != path) {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .display()
            .to_string();
        for d in cache[uri].as_array().into_iter().flatten() {
            let sev = match d["severity"].as_u64() {
                Some(1) => "erro",
                Some(2) => "aviso",
                Some(3) => "info",
                _ => "nota",
            };
            let line = d["range"]["start"]["line"].as_u64().unwrap_or(0) + 1;
            let col = d["range"]["start"]["character"].as_u64().unwrap_or(0) + 1;
            let msg = d["message"]
                .as_str()
                .unwrap_or("")
                .lines()
                .next()
                .unwrap_or("");
            out.push(format!("{rel}:{line}:{col} {sev}: {msg}"));
        }
    }
    out
}

/// `lsp_diagnostics`: os erros e avisos que o servidor de linguagem já publicou.
pub struct LspDiagnosticsTool;

impl tutor_agent::Tool for LspDiagnosticsTool {
    fn name(&self) -> &str {
        "lsp_diagnostics"
    }
    fn description(&self) -> &str {
        "Erros e avisos do servidor de linguagem (rust-analyzer, gopls, tsserver…) para o \
         projecto ou um ficheiro (`path`). Só tem o que o servidor já publicou (ficheiros \
         abertos/indexados); se não houver servidor activo, usa `lint`/`run_tests`."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "additionalProperties": false
        })
    }
    fn read_only(&self) -> bool {
        true
    }
    fn run(&self, input: &Value, ctx: &tutor_agent::ToolCtx) -> tutor_agent::ToolOutput {
        let root = std::fs::canonicalize(&ctx.root).unwrap_or_else(|_| ctx.root.clone());
        let only = match input["path"].as_str().filter(|p| !p.trim().is_empty()) {
            Some(p) => match tutor_agent::sandbox::resolve(&ctx.root, p) {
                Ok(abs) => Some(abs),
                Err(e) => return tutor_agent::ToolOutput::err(e),
            },
            None => None,
        };
        let active: Vec<String> = active_roots()
            .lock()
            .unwrap()
            .iter()
            .filter(|r| r.starts_with(&root.display().to_string()))
            .cloned()
            .collect();
        if active.is_empty() {
            return tutor_agent::ToolOutput::ok(
                "não há servidor de linguagem activo para este projecto (a UI arranca-o ao abrir \
                 ficheiros) — usa `lint` ou `run_tests` para verificar",
            );
        }
        let lines = format_diagnostics(&root, only.as_deref(), &diag_cache().lock().unwrap());
        tutor_agent::ToolOutput::ok(if lines.is_empty() {
            "sem erros nem avisos publicados pelo servidor de linguagem".to_string()
        } else {
            lines.join("\n")
        })
    }
}

#[cfg(test)]
mod diag_tests {
    use super::*;

    #[test]
    fn formats_cached_diagnostics_under_the_root() {
        let mut c = HashMap::new();
        c.insert(
            "file:///p/src/a.rs".to_string(),
            json!([{"severity": 1, "range": {"start": {"line": 4, "character": 2}}, "message": "mismatched types\nexpected i32"},
                   {"severity": 2, "range": {"start": {"line": 9, "character": 0}}, "message": "unused variable"}]),
        );
        c.insert("file:///outro/b.rs".to_string(), json!([{"severity": 1, "range": {"start": {"line": 0, "character": 0}}, "message": "x"}]));
        let root = std::path::Path::new("/p");
        assert_eq!(
            format_diagnostics(root, None, &c),
            vec![
                "src/a.rs:5:3 erro: mismatched types",
                "src/a.rs:10:1 aviso: unused variable"
            ]
        );
        assert!(format_diagnostics(root, Some(std::path::Path::new("/p/src/z.rs")), &c).is_empty());
    }
}

#[cfg(test)]
mod phase4_lang_tests {
    use super::*;

    #[test]
    fn formatting_asks_for_the_document_or_the_range() {
        let (m, p) = format_request("file:///w/A.java", 4, true, None);
        assert_eq!(m, "textDocument/formatting");
        assert_eq!(p["options"]["tabSize"], 4);
        assert_eq!(p["options"]["insertSpaces"], true);
        assert!(p.get("range").is_none());
        let (m, p) = format_request("file:///w/A.java", 2, false, Some((2, 0, 3, 5)));
        assert_eq!(m, "textDocument/rangeFormatting");
        assert_eq!(p["range"]["start"]["line"], 2);
        assert_eq!(p["range"]["end"]["character"], 5);
        assert!(capabilities()["textDocument"]["formatting"].is_object());
        assert_eq!(
            capabilities()["textDocument"]["documentSymbol"]["hierarchicalDocumentSymbolSupport"],
            true
        );
    }

    #[test]
    fn code_actions_get_the_diagnostics_that_touch_the_range() {
        let r = |l: u32, c1: u32, c2: u32| json!({ "range": { "start": { "line": l, "character": c1 }, "end": { "line": l, "character": c2 } }, "message": format!("{l}:{c1}") });
        let diags = json!([r(3, 8, 30), r(5, 0, 4), r(3, 40, 44)]);
        // o cursor em qualquer ponto da linha 3 apanha os dois diagnósticos dela, não o da 5
        let got = diagnostics_in_range(&diags, 3, 3);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0]["message"], "3:8");
        assert_eq!(diagnostics_in_range(&diags, 4, 6).len(), 1);
        assert!(diagnostics_in_range(&Value::Null, 0, 9).is_empty());
        // diagnósticos de um texto mais antigo do que a última edição → esperar pelos novos
        let t = Instant::now();
        let later = t + Duration::from_millis(5);
        assert!(diagnostics_stale(Some(later), Some(t)));
        assert!(diagnostics_stale(Some(t), None));
        assert!(!diagnostics_stale(Some(t), Some(later)));
        assert!(!diagnostics_stale(None, Some(t)));
        // pedidos do servidor: id número OU texto (o jdtls usa texto); respostas não são pedidos
        assert_eq!(
            server_request_id(&json!({ "id": "13", "method": "workspace/configuration" })),
            Some(json!("13"))
        );
        assert_eq!(
            server_request_id(&json!({ "id": 7, "method": "window/workDoneProgress/create" })),
            Some(json!(7))
        );
        assert_eq!(server_request_id(&json!({ "id": 7, "result": null })), None);
        assert_eq!(server_request_id(&json!({ "method": "$/progress" })), None);
        let caps = capabilities();
        assert_eq!(caps["workspace"]["applyEdit"], true);
        assert!(caps["textDocument"]["codeAction"]["codeActionLiteralSupport"].is_object());
    }

    #[test]
    fn jdtls_starts_with_signature_help_enabled() {
        assert_eq!(
            init_options("java")["settings"]["java"]["signatureHelp"]["enabled"],
            true
        );
        assert!(init_options("kotlin").is_null());
        assert!(capabilities()["textDocument"]["signatureHelp"].is_object());
    }

    #[test]
    fn workspace_symbols_cover_methods_and_the_sessions_of_the_open_folder() {
        // sem isto o jdtls só devolve tipos no workspace/symbol
        assert_eq!(
            init_options("java")["settings"]["java"]["symbols"]["includeSourceMethodDeclarations"],
            true
        );
        assert_eq!(
            capabilities()["workspace"]["symbol"]["symbolKind"]["valueSet"]
                .as_array()
                .map(|a| a.len()),
            Some(26)
        );
        // a sessão pertence à pasta aberta: a mesma, uma subpasta (marcador), ou uma acima
        assert!(roots_overlap("/w/proj", "/w/proj"));
        assert!(roots_overlap("/w/proj/", "/w/proj/app"));
        assert!(roots_overlap("/w/proj/app", "/w/proj"));
        assert!(!roots_overlap("/w/proj", "/w/project"));
        assert!(!roots_overlap("/w/proj", "/w/other"));
    }

    #[test]
    fn type_hierarchy_is_asked_only_of_servers_that_announce_it() {
        assert!(capabilities()["textDocument"]["typeHierarchy"].is_object());
        // jdtls: `typeHierarchyProvider: true`; kotlin-language-server não o anuncia (medido)
        assert!(caps_support(
            &json!({ "typeHierarchyProvider": true }),
            "typeHierarchyProvider"
        ));
        assert!(caps_support(
            &json!({ "typeHierarchyProvider": { "workDoneProgress": false } }),
            "typeHierarchyProvider"
        ));
        assert!(!caps_support(
            &json!({ "typeHierarchyProvider": false }),
            "typeHierarchyProvider"
        ));
        assert!(!caps_support(
            &json!({ "hoverProvider": true }),
            "typeHierarchyProvider"
        ));
        assert!(!caps_support(&Value::Null, "typeHierarchyProvider"));
    }

    #[test]
    fn server_status_names_the_language_and_server() {
        assert_eq!(server_status("/w/notes.txt"), None);
        let st = server_status("/w/src/Main.java").unwrap();
        assert_eq!(
            (st.language.as_str(), st.server.as_str()),
            ("java", "jdtls")
        );
        // instalado ou não depende da máquina; sem servidor, diz porquê
        assert_eq!(st.installed, st.problem.is_none());
    }

    #[test]
    fn a_file_without_a_project_marker_falls_back_to_the_open_folder() {
        let roots: HashSet<String> = ["/w/proj".to_string(), "/w/proj/sub/".to_string()].into();
        assert_eq!(
            fallback_root("/w/proj/q.sql", &roots).as_deref(),
            Some("/w/proj")
        );
        // a pasta aberta mais funda ganha
        assert_eq!(
            fallback_root("/w/proj/sub/A.java", &roots).as_deref(),
            Some("/w/proj/sub")
        );
        // um prefixo de nome não é uma pasta-mãe; fora de todas → None
        assert_eq!(fallback_root("/w/project/x.sql", &roots), None);
        assert_eq!(fallback_root("/elsewhere/x.sql", &roots), None);
    }

    #[test]
    fn the_new_learning_track_languages_map_to_their_servers() {
        for (path, id, label) in [
            ("src/main.cpp", "cpp", "clangd"),
            ("lib/util.h", "cpp", "clangd"),
            ("Sources/App/main.swift", "swift", "sourcekit-lsp"),
            ("Program.cs", "csharp", "csharp-ls"),
            ("src/Main.java", "java", "jdtls"),
            ("App.kt", "kotlin", "kotlin-language-server"),
            ("schema.sql", "sql", "sqls"),
        ] {
            let lang = lang_for_path(path).unwrap_or_else(|| panic!("{path}"));
            assert_eq!(
                (lang.id.as_str(), lang.server_label.as_str()),
                (id, label),
                "{path}"
            );
        }
        assert!(lang_for_path("notes.txt").is_none());
    }

    #[test]
    fn newest_glob_picks_the_highest_version_numerically() {
        let dir = tempfile::tempdir().unwrap();
        for v in ["6.4.3", "6.10.0", "5.9.2"] {
            std::fs::create_dir_all(dir.path().join(v).join("usr/bin")).unwrap();
        }
        let got = newest_glob(&format!("{}/*/usr/bin", dir.path().display())).unwrap();
        assert!(got.ends_with("6.10.0/usr/bin"), "{got:?}");
        assert!(newest_glob("/no/such/dir/*/bin").is_none());
    }

    #[test]
    fn a_missing_server_is_a_readable_error_and_a_known_one_resolves() {
        let err = native_server("dxtutor-no-such-language-server", &[]).unwrap_err();
        assert!(err.contains("não encontrado"), "{err}");
        // A shell existe em qualquer máquina: prova o caminho do PATH.
        assert!(native_server("sh", &[]).is_ok());
    }
}

#[cfg(test)]
mod registry_resolution_tests {
    use super::*;

    fn host(home: &Path, path: &Path) -> Host {
        Host {
            home: Some(home.to_path_buf()),
            path: path.as_os_str().to_os_string(),
            var: Box::new(|_| None),
        }
    }

    fn touch_exe(p: &Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "#!/bin/sh\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }

    fn rust() -> &'static Server {
        langreg::registry().server("rust").unwrap()
    }

    #[test]
    fn rust_analyzer_missing_from_path_and_toolchains_is_not_installed() {
        // Antes caía num `rust-analyzer` solto e o aviso «servidor em falta» nunca aparecia.
        let home = tempfile::tempdir().unwrap();
        let bin = tempfile::tempdir().unwrap();
        let err = resolve_server(rust(), &host(home.path(), bin.path())).unwrap_err();
        assert!(
            err.contains("rust-analyzer") && err.contains("não encontrado"),
            "{err}"
        );
    }

    #[test]
    fn rust_analyzer_is_found_in_a_toolchain_or_on_path_but_never_as_the_rustup_proxy() {
        let home = tempfile::tempdir().unwrap();
        let bin = tempfile::tempdir().unwrap();
        // só o proxy do rustup no PATH (uma ligação ao `rustup`): não conta
        touch_exe(&bin.path().join("rustup-real"));
        #[cfg(unix)]
        {
            std::fs::hard_link(bin.path().join("rustup-real"), bin.path().join("rustup")).unwrap();
            std::fs::hard_link(bin.path().join("rustup"), bin.path().join("rust-analyzer"))
                .unwrap();
            assert!(is_rustup_proxy(
                &host(home.path(), bin.path()),
                &bin.path().join("rust-analyzer")
            ));
        }
        // o `rustup` falso não responde a `which`: sem toolchain, não está instalado
        std::fs::write(bin.path().join("rustup-real"), "#!/bin/sh\nexit 1\n").unwrap();
        #[cfg(unix)]
        assert!(resolve_server(rust(), &host(home.path(), bin.path())).is_err());
        // uma toolchain com o componente resolve (a stable primeiro)
        let nightly = home
            .path()
            .join(".rustup/toolchains/nightly-x/bin/rust-analyzer");
        let stable = home
            .path()
            .join(".rustup/toolchains/stable-x/bin/rust-analyzer");
        touch_exe(&nightly);
        touch_exe(&stable);
        assert_eq!(
            resolve_server(rust(), &host(home.path(), bin.path())).unwrap(),
            stable.display().to_string()
        );
        // um rust-analyzer verdadeiro no PATH (não ligado ao rustup) também serve
        let home2 = tempfile::tempdir().unwrap();
        let bin2 = tempfile::tempdir().unwrap();
        touch_exe(&bin2.path().join("rust-analyzer"));
        assert_eq!(
            resolve_server(rust(), &host(home2.path(), bin2.path())).unwrap(),
            bin2.path().join("rust-analyzer").display().to_string()
        );
    }

    #[test]
    fn an_env_override_wins_and_a_wrong_one_is_reported() {
        let home = tempfile::tempdir().unwrap();
        let bin = tempfile::tempdir().unwrap();
        let ra = bin.path().join("my-ra");
        touch_exe(&ra);
        let ra_s = ra.display().to_string();
        let mut h = host(home.path(), Path::new(""));
        h.var = Box::new(move |k| (k == "DXTUTOR_RUST_ANALYZER").then(|| ra_s.clone()));
        assert_eq!(
            resolve_server(rust(), &h).unwrap(),
            ra.display().to_string()
        );
        h.var = Box::new(|k| (k == "DXTUTOR_RUST_ANALYZER").then(|| "/no/such/ra".to_string()));
        let err = resolve_server(rust(), &h).unwrap_err();
        assert!(err.contains("DXTUTOR_RUST_ANALYZER=/no/such/ra"), "{err}");
    }

    #[test]
    fn node_servers_come_from_the_newest_nvm_that_has_them_then_path() {
        let reg = langreg::registry();
        let ts = reg.server("typescript").unwrap();
        let home = tempfile::tempdir().unwrap();
        let empty = tempfile::tempdir().unwrap();
        assert!(resolve_server(ts, &host(home.path(), empty.path())).is_err());
        // v9 < v25 numericamente; a v26 não tem o servidor
        let nvm = home.path().join(".nvm/versions/node");
        touch_exe(&nvm.join("v9.0.0/bin/typescript-language-server"));
        touch_exe(&nvm.join("v25.0.0/bin/typescript-language-server"));
        std::fs::create_dir_all(nvm.join("v26.1.0/bin")).unwrap();
        let got = resolve_server(ts, &host(home.path(), empty.path())).unwrap();
        assert!(
            got.ends_with("v25.0.0/bin/typescript-language-server"),
            "{got}"
        );
        // o NODE_PATH é o node_modules global ao lado do servidor
        std::fs::create_dir_all(nvm.join("v25.0.0/lib/node_modules/typescript")).unwrap();
        assert_eq!(
            node_global_modules(&got).unwrap(),
            nvm.join("v25.0.0/lib/node_modules").display().to_string()
        );
        // sem nvm, o PATH
        let home2 = tempfile::tempdir().unwrap();
        let bin = tempfile::tempdir().unwrap();
        touch_exe(&bin.path().join("pyright-langserver"));
        let py = reg.server("python").unwrap();
        assert!(resolve_server(py, &host(home2.path(), bin.path())).is_ok());
        // só o typescript-language-server precisa do NODE_PATH
        assert!(ts.has_quirk("nodePath") && !py.has_quirk("nodePath"));
    }

    #[test]
    fn path_entries_are_split_and_joined_the_platform_way_without_repeats() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let login = OsString::from(["/a", "/b"].join(sep));
        let base = OsString::from(["/b", "/c", ""].join(sep));
        let got = join_dirs(
            vec![PathBuf::from("/x"), PathBuf::from("/a")],
            Some(&login),
            &base,
        );
        let dirs: Vec<PathBuf> = std::env::split_paths(&got).collect();
        assert_eq!(dirs, ["/x", "/a", "/b", "/c"].map(PathBuf::from).to_vec());
        // nenhuma versão do node fica escrita no código
        assert!(!std::env::split_paths(&augmented_path(None))
            .any(|d| d.to_string_lossy().contains("v25.0.0")));
    }

    #[test]
    fn every_registry_server_is_a_session_group_with_its_markers_and_signal() {
        let ids: Vec<String> = langs_for(None).into_iter().map(|l| l.id).collect();
        assert_eq!(
            ids,
            [
                "rust",
                "go",
                "typescript",
                "python",
                "cpp",
                "swift",
                "csharp",
                "java",
                "kotlin",
                "sql"
            ]
        );
        let ra = lang_for_path("/w/src/MAIN.RS").unwrap();
        assert_eq!(
            (ra.id.as_str(), ra.ready_signal.as_str()),
            ("rust", "cachepriming")
        );
        assert_eq!(ra.markers, ["Cargo.toml".to_string()]);
        assert_eq!(
            lang_for_path("/w/a.mjs").unwrap().server_label,
            "typescript-language-server"
        );
        assert!(
            lang_for_path("/w/Dockerfile").is_none(),
            "a language without a server"
        );
    }
}

#[cfg(test)]
mod override_tests {
    use super::*;

    #[test]
    fn workspace_configuration_answers_each_item_from_the_settings() {
        let settings = langreg::normalize_settings(&json!({
            "python.analysis.typeCheckingMode": "strict",
            "gopls": { "staticcheck": true }
        }));
        let params = json!({ "items": [
            { "section": "python.analysis" },
            { "section": "gopls.staticcheck", "scopeUri": "file:///w" },
            { "section": "java" },
            {}
        ] });
        assert_eq!(
            configuration_reply(&settings, &params),
            json!([{ "typeCheckingMode": "strict" }, true, null, settings])
        );
        // no settings: one null per item, as before overrides
        assert_eq!(
            configuration_reply(&Value::Null, &params),
            json!([null, null, null, null])
        );
        assert_eq!(configuration_reply(&settings, &json!({})), json!([]));
    }

    #[test]
    fn a_session_restarts_when_how_it_starts_changes_not_when_its_settings_do() {
        let base = langreg::registry().server("python").unwrap().clone();
        let mut with_settings = base.clone();
        with_settings.settings = json!({ "python": { "analysis": {} } });
        assert_eq!(fingerprint(&base), fingerprint(&with_settings));
        for change in [
            |s: &mut Server| s.args.push("--verbose".into()),
            |s: &mut Server| s.command = "basedpyright-langserver".into(),
            |s: &mut Server| s.init_options = json!({ "a": 1 }),
            |s: &mut Server| s.root_markers = vec!["x.toml".into()],
            |s: &mut Server| s.search_dirs = vec!["/opt/bin".into()],
        ] {
            let mut other = base.clone();
            change(&mut other);
            assert_ne!(fingerprint(&base), fingerprint(&other));
        }
    }

    fn project(files: &[(&str, &str)]) -> (tempfile::TempDir, String) {
        let d = tempfile::tempdir().unwrap();
        for (p, text) in files {
            let f = d.path().join(p);
            std::fs::create_dir_all(f.parent().unwrap()).unwrap();
            std::fs::write(f, text).unwrap();
        }
        let root = register_root(&d.path().display().to_string());
        (d, root)
    }

    #[test]
    fn a_project_file_adds_a_language_for_its_own_folder_only() {
        let (_d, root) = project(&[(
            ".dxtutor/lsp.json",
            r#"{ "languages": [ { "id": "markdown", "lspLanguageId": "markdown", "server": "sql" } ] }"#,
        )]);
        let inside = format!("{root}/README.md");
        let lang = lang_for_path(&inside).expect("markdown has a server in this project");
        assert_eq!(lang.id, "sql");
        assert_eq!(lang.project.as_deref(), Some(root.as_str()));
        // elsewhere the bundled registry: Markdown has no server
        assert!(lang_for_path("/elsewhere/README.md").is_none());
        // a settings-only or re-pointing project change needs no approval
        assert!(lang.eff.project_launch_changes("sql").is_empty());
        let view = config_view(Some(&root));
        assert!(view.project_file.as_ref().unwrap().applied);
        let sql = view.servers.iter().find(|s| s.entry.id == "sql").unwrap();
        assert!(sql.approval.is_none() && sql.project_launch.is_empty());
        assert!(view
            .languages
            .iter()
            .any(|l| l.id == "markdown" && l.server.as_deref() == Some("sql")));
    }

    #[test]
    fn a_session_key_carries_the_open_folder() {
        let lang = lang_for_path("/nowhere/src/a.rs").unwrap();
        assert_eq!(lang.project, None);
        assert_eq!(session_key(&lang, "/nowhere"), "rust\u{0}/nowhere\u{0}");
        assert_eq!(split_key("rust\u{0}/w\u{0}/w/p"), Some(("rust", "/w")));
        assert_eq!(split_key("rust\u{0}/w"), Some(("rust", "/w")));
        assert_eq!(split_key("bad"), None);
        // the workspace-symbol search still sees the session root
        assert!(roots_overlap(
            "/w",
            split_key("rust\u{0}/w/app\u{0}/w").unwrap().1
        ));
    }

    #[test]
    fn a_server_turned_off_for_its_language_is_not_warmed_up_nor_used() {
        let (_d, root) = project(&[
            (
                ".dxtutor/lsp.json",
                r#"{ "languages": [ { "id": "rust", "server": null } ] }"#,
            ),
            ("Cargo.toml", "[package]\nname = \"x\"\n"),
        ]);
        assert!(lang_for_path(&format!("{root}/src/main.rs")).is_none());
        assert!(!langs_for(Some(&root)).iter().any(|l| l.id == "rust"));
        assert!(langs_for(None).iter().any(|l| l.id == "rust"));
    }

    #[test]
    fn a_project_command_waits_for_approval_and_an_invalid_file_is_reported() {
        // `sh` exists everywhere: the project points the SQL server at it (a new command)
        let (_d, root) = project(&[
            (
                ".dxtutor/lsp.json",
                r#"{ "servers": [ { "id": "sql", "command": "sh", "args": ["-c", "echo pwned"] } ] }"#,
            ),
            ("q.sql", "select 1;"),
        ]);
        let st = server_status(&format!("{root}/q.sql")).unwrap();
        assert!(st.installed, "{st:?}");
        let a = st.approval.expect("the project's command needs approval");
        assert_eq!(a.args, ["-c", "echo pwned"]);
        assert!(a.program.ends_with("/sh"), "{}", a.program);
        assert_eq!(a.command, format!("{} -c 'echo pwned'", a.program));
        assert_eq!(a.project, root);
        assert_eq!(a.cwd, root, "SQL has no marker: the open folder");
        assert!(a.file.ends_with(".dxtutor/lsp.json"));
        assert_eq!(a.changed, ["command", "args"]);
        // the same in the config view
        let view = config_view(Some(&root));
        let sql = view.servers.iter().find(|s| s.entry.id == "sql").unwrap();
        assert_eq!(sql.approval.as_ref().map(|x| &x.hash), Some(&a.hash));
        assert_eq!(sql.sources, ["bundled", "project"]);

        // an invalid project file: ignored and reported, the bundled entries stay
        let (_d2, root2) = project(&[(
            ".dxtutor/lsp.json",
            r#"{ "servers": [ { "id": "sql", "comand": "sh" } ] }"#,
        )]);
        let view = config_view(Some(&root2));
        let rep = view.project_file.unwrap();
        assert!(rep.exists && !rep.applied);
        assert!(rep.errors[0].contains("unknown field `comand`"), "{rep:?}");
        assert!(server_status(&format!("{root2}/q.sql"))
            .unwrap()
            .approval
            .is_none());
    }

    #[test]
    fn the_override_files_open_with_a_template_when_missing() {
        let (_d, root) = project(&[]);
        let f = config_file("project", Some(&root)).unwrap();
        assert!(!f.exists && f.text == lspconf::PROJECT_TEMPLATE);
        assert!(f.path.ends_with(".dxtutor/lsp.json"));
        std::fs::create_dir_all(format!("{root}/.dxtutor")).unwrap();
        std::fs::write(format!("{root}/.dxtutor/lsp.json"), "{}").unwrap();
        let f = config_file("project", Some(&root)).unwrap();
        assert!(f.exists && f.text == "{}");
        assert!(config_file("project", None).is_err());
        assert!(config_file("other", Some(&root)).is_err());
        // unit tests have no app config folder
        assert!(config_file("user", None).is_err());
    }
}
