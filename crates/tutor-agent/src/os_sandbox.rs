//! H1 (docs/v2/AUDIT-harness.md): the operating-system sandbox for what the agent RUNS — `bash`,
//! `run_tests`/`lint` and the project's hooks — with bubblewrap on Linux.
//!
//! Inside it:
//! - the whole disk is read-only; the project folder, a private `/tmp`, the git folders of a worktree and
//!   the toolchains' caches (`~/.cache`, `~/.cargo/registry`, `~/go/pkg`, `~/.npm`…) are writable;
//! - `.git/hooks`, `.git/config` and `.dxtutor/` stay read-only inside the project (`.dxtutor/memory/` is
//!   the agent's): a command cannot plant a hook or loosen the project's own rules;
//! - credentials are hidden (`~/.ssh`, `~/.aws`, `~/.kube`, `~/.config/gh`, the IDE's `keys.json`, the
//!   session bus of the keychain, `.netrc`, `.git-credentials`…) and environment variables that look like
//!   credentials are removed;
//! - **the network is off** (`--unshare-net`: loopback only) unless the project turns it on;
//! - its own PID namespace, killed with the IDE.
//!
//! What the project's `.dxtutor/sandbox.json` may change: it can always TIGHTEN; turning the sandbox
//! off, the network on or a folder outside the project writable counts only once the person trusts the
//! file (as hooks and MCP servers). Without bubblewrap (macOS, Windows, a kernel without user
//! namespaces) commands run as before and the session says so: never a silent «sandboxed».

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use serde::Deserialize;

/// The project's sandbox settings.
pub const CONFIG_FILE: &str = ".dxtutor/sandbox.json";

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SandboxConfig {
    /// `false` turns the sandbox off (needs trust).
    #[serde(default)]
    pub enabled: Option<bool>,
    /// `"off"` (default), `"allowlist"` (only `allowDomains`, through the IDE's proxy) or `"on"`. Anything
    /// but `"off"` needs trust.
    #[serde(default)]
    pub network: Option<String>,
    /// H1b: the domains `"allowlist"` lets through (`example.com`, `*.example.com`; ports 80 and 443).
    #[serde(default, rename = "allowDomains")]
    pub allow_domains: Vec<String>,
    /// More writable folders: inside the project they are fine; outside it they need trust.
    #[serde(default)]
    pub writable: Vec<String>,
}

impl SandboxConfig {
    pub fn load(root: &Path) -> Result<Option<SandboxConfig>, String> {
        let p = root.join(CONFIG_FILE);
        match std::fs::read_to_string(&p) {
            Err(_) => Ok(None),
            Ok(t) => serde_json::from_str(&t)
                .map(Some)
                .map_err(|e| format!("{CONFIG_FILE}: {e}")),
        }
    }

    /// Does it loosen anything (so it counts only when trusted)?
    pub fn loosens(&self, root: &Path) -> bool {
        self.enabled == Some(false)
            || self.network.as_deref() == Some("on")
            || (self.network.as_deref() == Some("allowlist") && !self.allow_domains.is_empty())
            || self
                .writable
                .iter()
                .any(|w| !root.join(w).starts_with(root) || w.contains(".."))
    }
}

/// H1b: the network allowlist inside the sandbox — the proxy's socket folder (mounted inside), the command
/// that starts the bridge (the IDE's own binary), and what the proxy refused.
#[derive(Debug, Clone)]
pub struct NetBridge {
    pub dir: PathBuf,
    pub bridge: Vec<OsString>,
    pub denied: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
}

/// The sandbox of one project.
#[derive(Debug, Clone)]
pub struct OsSandbox {
    pub bwrap: PathBuf,
    pub root: PathBuf,
    pub writable: Vec<PathBuf>,
    /// Read-only inside the writable ones (`.git/hooks`, `.git/config`, `.dxtutor`).
    pub readonly: Vec<PathBuf>,
    /// Writable again inside a read-only one (`.dxtutor/memory`).
    pub rewritable: Vec<PathBuf>,
    pub hidden_dirs: Vec<PathBuf>,
    pub hidden_files: Vec<PathBuf>,
    pub network: bool,
    /// H1b: the allowlist (the network stays off; only the proxy reaches out).
    pub net: Option<NetBridge>,
}

/// Folders under HOME that hold credentials.
const HIDDEN_DIRS: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".azure",
    ".config/gcloud",
    ".kube",
    ".docker",
    ".config/gh",
    ".password-store",
    ".local/share/keyrings",
    ".config/dxtutor",
    ".config/ao.ngolacloud.dxtutor-ide",
    ".terraform.d",
    ".config/hub",
    ".config/op",
];
/// Files under HOME that hold credentials.
const HIDDEN_FILES: &[&str] = &[
    ".netrc",
    ".git-credentials",
    ".vault-token",
    ".npmrc",
    ".pypirc",
    ".cargo/credentials.toml",
    ".cargo/credentials",
    ".pgpass",
    ".my.cnf",
];
/// Toolchain caches under HOME (writable, when they exist).
const CACHES: &[&str] = &[
    ".cache",
    ".cargo/registry",
    ".cargo/git",
    "go/pkg",
    ".npm",
    ".local/share/pnpm",
    ".gradle",
    ".m2/repository",
    ".nuget/packages",
    ".bun/install/cache",
    ".deno",
];

/// An environment variable whose name says it carries a credential.
pub fn credential_var(name: &str) -> bool {
    let n = name.to_ascii_uppercase();
    [
        "TOKEN",
        "SECRET",
        "PASSWORD",
        "PASSWD",
        "API_KEY",
        "APIKEY",
        "ACCESS_KEY",
        "PRIVATE_KEY",
        "CREDENTIAL",
    ]
    .iter()
    .any(|w| n.contains(w))
        || n.starts_with("AWS_")
        || n == "DBUS_SESSION_BUS_ADDRESS"
        || n == "SSH_AUTH_SOCK"
        || n == "GPG_AGENT_INFO"
}

fn git_dirs(root: &Path) -> Vec<PathBuf> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args([
            "rev-parse",
            "--path-format=absolute",
            "--git-dir",
            "--git-common-dir",
        ])
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .map(|l| PathBuf::from(l.trim()))
            .filter(|p| p.is_absolute())
            .collect(),
        _ => vec![],
    }
}

impl OsSandbox {
    /// The sandbox of `root`: `home` for the credentials and caches, `runtime` the session's runtime
    /// folder (`XDG_RUNTIME_DIR`, the keychain's bus), `cfg` the project's settings as they count
    /// (the loosening ones only when trusted — the caller decides).
    pub fn for_project(
        bwrap: &Path,
        root: &Path,
        home: Option<&Path>,
        runtime: Option<&Path>,
        cfg: &SandboxConfig,
    ) -> OsSandbox {
        let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let exists = |p: &PathBuf| p.exists();
        // never hide (or re-bind) something that contains the project
        let outside = |p: &PathBuf| !root.starts_with(p);
        let mut writable = vec![];
        let mut readonly = vec![
            root.join(".dxtutor"),
            root.join(".git/hooks"),
            root.join(".git/config"),
        ];
        for g in git_dirs(&root) {
            if !g.starts_with(&root) {
                readonly.push(g.join("hooks"));
                readonly.push(g.join("config"));
                writable.push(g);
            }
        }
        if let Some(h) = home {
            writable.extend(CACHES.iter().map(|c| h.join(c)));
        }
        for w in &cfg.writable {
            let p = if Path::new(w).is_absolute() {
                PathBuf::from(w)
            } else {
                root.join(w)
            };
            writable.push(p);
        }
        writable.retain(|p| exists(p) && p != &root);
        writable.sort();
        writable.dedup();
        readonly.retain(exists);
        let rewritable: Vec<PathBuf> = vec![root.join(".dxtutor/memory")]
            .into_iter()
            .filter(exists)
            .collect();
        let (mut hidden_dirs, mut hidden_files) = (vec![], vec![]);
        if let Some(h) = home {
            hidden_dirs.extend(
                HIDDEN_DIRS
                    .iter()
                    .map(|d| h.join(d))
                    .filter(|p| p.is_dir() && outside(p)),
            );
            hidden_files.extend(
                HIDDEN_FILES
                    .iter()
                    .map(|f| h.join(f))
                    .filter(|p| p.is_file()),
            );
        }
        if let Some(r) = runtime.filter(|r| r.is_dir()).map(Path::to_path_buf) {
            if outside(&r) {
                hidden_dirs.push(r);
            }
        }
        OsSandbox {
            bwrap: bwrap.to_path_buf(),
            root,
            writable,
            readonly,
            rewritable,
            hidden_dirs,
            hidden_files,
            network: cfg.network.as_deref() == Some("on"),
            net: None,
        }
    }

    /// H1b: the network through the allowlist proxy (and nothing else).
    pub fn with_net(mut self, net: NetBridge) -> Self {
        self.network = false;
        self.net = Some(net);
        self
    }

    /// The `host:port`s the allowlist refused since the last call.
    pub fn take_denied(&self) -> Vec<String> {
        self.net
            .as_ref()
            .and_then(|n| n.denied.lock().ok().map(|mut d| std::mem::take(&mut *d)))
            .unwrap_or_default()
    }

    /// The bubblewrap arguments, before the command (the order matters: a later mount covers an
    /// earlier one).
    pub fn args(&self) -> Vec<OsString> {
        let mut a: Vec<OsString> = vec![];
        let mut push = |flag: &str, p: &[&Path]| {
            a.push(flag.into());
            for x in p {
                a.push(x.as_os_str().to_os_string());
            }
        };
        push("--die-with-parent", &[]);
        push("--unshare-pid", &[]);
        push("--ro-bind", &[Path::new("/"), Path::new("/")]);
        push("--dev", &[Path::new("/dev")]);
        push("--proc", &[Path::new("/proc")]);
        push("--tmpfs", &[Path::new("/tmp")]);
        if let Some(n) = &self.net {
            push("--bind", &[&n.dir, Path::new(crate::net_proxy::INSIDE_DIR)]);
            // the bridge's own binary, when it lives under /tmp (an AppImage), stays visible
            if let Some(dir) = n
                .bridge
                .first()
                .map(Path::new)
                .and_then(Path::parent)
                .filter(|d| d.starts_with("/tmp"))
            {
                push("--ro-bind", &[dir, dir]);
            }
        }
        push("--bind", &[&self.root, &self.root]);
        for w in &self.writable {
            push("--bind", &[w, w]);
        }
        for r in &self.readonly {
            push("--ro-bind", &[r, r]);
        }
        for r in &self.rewritable {
            push("--bind", &[r, r]);
        }
        for d in &self.hidden_dirs {
            push("--tmpfs", &[d]);
        }
        for f in &self.hidden_files {
            push("--ro-bind", &[Path::new("/dev/null"), f]);
        }
        if !self.network {
            push("--unshare-net", &[]);
        }
        push("--chdir", &[&self.root]);
        a
    }

    /// `cmd`, run inside the sandbox (its program, arguments, environment and folder kept; credential
    /// variables removed).
    pub fn wrap(&self, cmd: &Command) -> Command {
        let mut w = Command::new(&self.bwrap);
        w.args(self.args());
        w.arg("--");
        match &self.net {
            Some(n) => {
                use crate::net_proxy::{
                    BridgeSpec, BRIDGE_ENV, BRIDGE_PORT, INSIDE_DIR, SOCKET_NAME,
                };
                let (prog, args) = n.bridge.split_first().expect("a bridge command");
                w.arg(prog).args(args);
                let mut argv = vec![cmd.get_program().to_string_lossy().into_owned()];
                argv.extend(cmd.get_args().map(|a| a.to_string_lossy().into_owned()));
                let spec = BridgeSpec {
                    port: BRIDGE_PORT,
                    sock: Path::new(INSIDE_DIR).join(SOCKET_NAME),
                    argv,
                };
                w.env(BRIDGE_ENV, serde_json::to_string(&spec).unwrap_or_default());
                let proxy = format!("http://127.0.0.1:{BRIDGE_PORT}");
                for k in [
                    "HTTP_PROXY",
                    "HTTPS_PROXY",
                    "http_proxy",
                    "https_proxy",
                    "ALL_PROXY",
                    "all_proxy",
                ] {
                    w.env(k, &proxy);
                }
                for k in ["NO_PROXY", "no_proxy"] {
                    w.env(k, "localhost,127.0.0.1,::1");
                }
            }
            None => {
                w.arg(cmd.get_program()).args(cmd.get_args());
            }
        }
        for (k, _) in std::env::vars_os() {
            if credential_var(&k.to_string_lossy()) {
                w.env_remove(&k);
            }
        }
        for (k, v) in cmd.get_envs() {
            match v {
                Some(v) if !credential_var(&k.to_string_lossy()) => {
                    w.env(k, v);
                }
                _ => {
                    w.env_remove(k);
                }
            }
        }
        if let Some(d) = cmd.get_current_dir() {
            w.current_dir(d);
        }
        w
    }
}

/// The bubblewrap of this machine, if it works here (checked once): `Err` says why not.
pub fn available() -> Result<PathBuf, String> {
    static CACHE: OnceLock<Result<PathBuf, String>> = OnceLock::new();
    CACHE.get_or_init(probe).clone()
}

fn probe() -> Result<PathBuf, String> {
    if !cfg!(target_os = "linux") {
        return Err("the sandbox uses bubblewrap, which only runs on Linux".into());
    }
    let bwrap = ["/usr/bin/bwrap", "/usr/local/bin/bwrap", "/bin/bwrap"]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .ok_or("bubblewrap (bwrap) is not installed — e.g. `sudo apt install bubblewrap`")?;
    let out = Command::new(&bwrap)
        .args([
            "--die-with-parent",
            "--unshare-pid",
            "--ro-bind",
            "/",
            "/",
            "--dev",
            "/dev",
            "--proc",
            "/proc",
            "--unshare-net",
            "true",
        ])
        .output()
        .map_err(|e| format!("bwrap could not start: {e}"))?;
    if out.status.success() {
        Ok(bwrap)
    } else {
        Err(format!(
            "bwrap does not work here (user namespaces?): {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// When a command failed because of the sandbox, what to tell the model.
pub fn hint(output: &str) -> Option<&'static str> {
    let o = output.to_ascii_lowercase();
    let net = [
        "network is unreachable",
        "could not resolve host",
        "temporary failure in name resolution",
        "name or service not known",
        "failed to lookup address",
        "getaddrinfo",
        "enotfound",
        "eai_again",
        "dial tcp",
        "connection refused",
    ];
    if net.iter().any(|n| o.contains(n)) {
        return Some(
            "[sandbox] the network is off for commands in this project. Work offline (vendored or cached \
             dependencies), ask the human to turn the network on in .dxtutor/sandbox.json, or run this one \
             command with `unsandboxed: true` — the human approves it.",
        );
    }
    if o.contains("read-only file system") {
        return Some(
            "[sandbox] only the project folder (outside .git/hooks, .git/config and .dxtutor), /tmp and the \
             toolchain caches are writable. Write inside the project, or run this one command with \
             `unsandboxed: true` — the human approves it.",
        );
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_home() -> tempfile::TempDir {
        let h = tempfile::tempdir().unwrap();
        for d in [".ssh", ".kube", ".cache", ".cargo/registry", ".config/gh"] {
            std::fs::create_dir_all(h.path().join(d)).unwrap();
        }
        std::fs::write(h.path().join(".netrc"), "machine x").unwrap();
        h
    }

    #[test]
    fn the_mounts_confine_writes_hide_credentials_and_cut_the_network() {
        let home = fake_home();
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(".dxtutor/memory")).unwrap();
        let s = OsSandbox::for_project(
            Path::new("/usr/bin/bwrap"),
            root.path(),
            Some(home.path()),
            None,
            &SandboxConfig::default(),
        );
        let args: Vec<String> = s
            .args()
            .iter()
            .map(|a| a.to_string_lossy().into_owned())
            .collect();
        let j = args.join(" ");
        let r = s.root.display().to_string();
        let h = home.path().display().to_string();
        assert!(j.starts_with("--die-with-parent --unshare-pid --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp"), "{j}");
        assert!(j.contains(&format!("--bind {r} {r}")));
        assert!(j.contains(&format!("--ro-bind {r}/.dxtutor {r}/.dxtutor --bind {r}/.dxtutor/memory {r}/.dxtutor/memory")), "{j}");
        assert!(j.contains(&format!("--bind {h}/.cache {h}/.cache")), "{j}");
        assert!(
            j.contains(&format!("--tmpfs {h}/.ssh"))
                && j.contains(&format!("--tmpfs {h}/.config/gh")),
            "{j}"
        );
        assert!(
            j.contains(&format!("--ro-bind /dev/null {h}/.netrc")),
            "{j}"
        );
        assert!(
            !j.contains(".aws"),
            "a folder that does not exist is not mounted"
        );
        assert!(j.ends_with(&format!("--unshare-net --chdir {r}")), "{j}");
        let on = OsSandbox::for_project(
            Path::new("/usr/bin/bwrap"),
            root.path(),
            Some(home.path()),
            None,
            &SandboxConfig {
                network: Some("on".into()),
                ..Default::default()
            },
        );
        assert!(!on.args().iter().any(|a| a == "--unshare-net"));
    }

    #[test]
    fn a_project_config_that_loosens_needs_trust() {
        let root = Path::new("/w/p");
        assert!(!SandboxConfig::default().loosens(root));
        assert!(!SandboxConfig {
            writable: vec!["build".into()],
            network: Some("off".into()),
            ..Default::default()
        }
        .loosens(root));
        assert!(SandboxConfig {
            network: Some("on".into()),
            ..Default::default()
        }
        .loosens(root));
        assert!(SandboxConfig {
            enabled: Some(false),
            ..Default::default()
        }
        .loosens(root));
        assert!(SandboxConfig {
            writable: vec!["/opt/x".into()],
            ..Default::default()
        }
        .loosens(root));
        assert!(SandboxConfig {
            writable: vec!["../x".into()],
            ..Default::default()
        }
        .loosens(root));
        // H1b: an allowlist opens the network to its domains
        let parsed: SandboxConfig =
            serde_json::from_str(r#"{"network": "allowlist", "allowDomains": ["*.crates.io"]}"#)
                .unwrap();
        assert_eq!(parsed.allow_domains, ["*.crates.io"]);
        assert!(parsed.loosens(root));
    }

    #[test]
    fn credential_variables_are_recognised() {
        for v in [
            "GITHUB_TOKEN",
            "ANTHROPIC_API_KEY",
            "AWS_REGION",
            "DB_PASSWORD",
            "MY_SECRET",
            "SSH_AUTH_SOCK",
            "DBUS_SESSION_BUS_ADDRESS",
        ] {
            assert!(credential_var(v), "{v}");
        }
        for v in ["PATH", "HOME", "LANG", "CARGO_HOME", "GOPATH", "NODE_ENV"] {
            assert!(!credential_var(v), "{v}");
        }
    }

    #[test]
    fn a_sandbox_failure_gets_a_hint() {
        assert!(hint("curl: (6) Could not resolve host: example.com")
            .unwrap()
            .contains("network is off"));
        assert!(hint("touch: cannot touch '/etc/x': Read-only file system")
            .unwrap()
            .contains("writable"));
        assert!(hint("assertion failed").is_none());
    }

    /// The network bridge of the test below: this test binary is the bridge, as the IDE's is in the app.
    #[test]
    #[ignore]
    fn bridge_child() {
        if let Some(code) = crate::net_proxy::bridge_main() {
            std::process::exit(code);
        }
    }

    /// H1b, for real: inside the sandbox only the allowlist goes out, through the proxy.
    #[test]
    fn the_allowlist_is_the_only_way_out_of_the_sandbox() {
        use crate::net_proxy::{Allowlist, Proxy};
        use std::io::{Read, Write};
        let Ok(bwrap) = available() else {
            eprintln!("skipped: no usable bubblewrap here");
            return;
        };
        let origin = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = origin.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for mut c in origin.incoming().flatten() {
                let mut b = [0u8; 1024];
                let _ = c.read(&mut b);
                let _ = c.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                );
            }
        });
        let tmp = tempfile::tempdir().unwrap();
        let proxy = Proxy::start(
            &tmp.path().join("net"),
            Allowlist::new(&["127.0.0.1".into()], &[port]),
        )
        .unwrap();
        let exe = std::env::current_exe().unwrap();
        let bridge: Vec<OsString> = vec![
            exe.into(),
            "--exact".into(),
            "os_sandbox::tests::bridge_child".into(),
            "--ignored".into(),
            "--nocapture".into(),
            "-q".into(),
        ];
        let home = fake_home();
        let root = tempfile::tempdir().unwrap();
        let sb = OsSandbox::for_project(
            &bwrap,
            root.path(),
            Some(home.path()),
            None,
            &SandboxConfig::default(),
        )
        .with_net(NetBridge {
            dir: proxy.socket.parent().unwrap().to_path_buf(),
            bridge,
            denied: proxy.denied_log(),
        });
        let script = format!(
            r#"
import socket
def ask(req):
    s = socket.create_connection(("127.0.0.1", 3128), 5); s.sendall(req.encode()); d = b""
    while True:
        c = s.recv(4096)
        if not c: break
        d += c
    return d.decode(errors="replace").split("\r\n")[0]
print("A:" + ask("GET http://127.0.0.1:{port}/ HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"))
print("B:" + ask("CONNECT example.com:443 HTTP/1.1\r\n\r\n"))
try:
    socket.create_connection(("1.1.1.1", 53), 3); print("C:direct")
except OSError:
    print("C:blocked")
"#
        );
        let mut c = Command::new("python3");
        c.arg("-c").arg(script);
        let o = sb.wrap(&c).current_dir(root.path()).output().unwrap();
        let out = String::from_utf8_lossy(&o.stdout);
        assert!(
            o.status.success(),
            "{out}\n{}",
            String::from_utf8_lossy(&o.stderr)
        );
        assert!(out.contains("A:HTTP/1.1 200 OK"), "{out}");
        assert!(out.contains("B:HTTP/1.1 403 Forbidden"), "{out}");
        assert!(out.contains("C:blocked"), "{out}");
        assert_eq!(sb.take_denied(), vec!["example.com:443".to_string()]);
    }

    /// The real thing, when this machine can run bubblewrap.
    #[test]
    fn inside_the_sandbox_writes_stay_in_the_project_and_secrets_are_gone() {
        let Ok(bwrap) = available() else {
            eprintln!("skipped: no usable bubblewrap here");
            return;
        };
        let home = fake_home();
        std::fs::write(home.path().join(".ssh/id_ed25519"), "PRIVATE").unwrap();
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir_in(home.path()).unwrap();
        let s = OsSandbox::for_project(
            &bwrap,
            root.path(),
            Some(home.path()),
            None,
            &SandboxConfig::default(),
        );
        let run = |script: &str| {
            let mut c = Command::new("sh");
            c.arg("-c")
                .arg(script)
                .env("GITHUB_TOKEN", "ghp_x")
                .env("KEEP", "1");
            let o = s.wrap(&c).current_dir(root.path()).output().unwrap();
            (
                o.status.success(),
                String::from_utf8_lossy(&o.stdout).trim().to_string(),
            )
        };
        assert!(run("echo ok > in-project.txt").0);
        assert!(root.path().join("in-project.txt").exists());
        assert!(!run(&format!("echo x > {}/escape.txt", outside.path().display())).0);
        assert!(!outside.path().join("escape.txt").exists());
        assert!(
            run("echo x > /tmp/scratch && cat /tmp/scratch").0,
            "a private /tmp"
        );
        assert_eq!(
            run(&format!("ls -A {}/.ssh | wc -l", home.path().display())).1,
            "0",
            "~/.ssh is empty inside"
        );
        assert_eq!(
            run(&format!("cat {}/.netrc | wc -c", home.path().display())).1,
            "0"
        );
        assert_eq!(run("echo \"${GITHUB_TOKEN:-gone}-${KEEP}\"").1, "gone-1");
        // no network: not even resolving a name or reaching an address
        assert!(
            !run("python3 -c \"import socket; socket.create_connection(('1.1.1.1', 53), 3)\"").0
        );
        assert!(run("python3 -c \"import socket; s = socket.socket(); s.bind(('127.0.0.1', 0)); print('lo')\"").0, "loopback works");
    }
}
