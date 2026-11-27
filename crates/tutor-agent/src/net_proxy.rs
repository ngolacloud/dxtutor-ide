//! H1b: the network allowlist of the OS sandbox.
//!
//! Inside the sandbox there is no network (`--unshare-net`). When the project allows some domains
//! (`.dxtutor/sandbox.json` `"network": "allowlist"` + `allowDomains`, trusted), the IDE runs a small HTTP
//! proxy OUTSIDE on a Unix socket that only connects to those domains (CONNECT for HTTPS, absolute URIs for
//! plain HTTP) and records what it refused; the socket's folder is mounted inside, and a tiny bridge — the
//! IDE's own binary in bridge mode, started by bubblewrap before the command — listens on
//! `127.0.0.1:3128` inside and forwards to it. The command gets `HTTP(S)_PROXY` pointing there; anything
//! that does not use the proxy still has no network.

use std::io::{self, Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The port the bridge listens on inside the sandbox.
pub const BRIDGE_PORT: u16 = 3128;
/// Where the proxy's socket folder is mounted inside the sandbox.
pub const INSIDE_DIR: &str = "/tmp/.dxtutor-net";
pub const SOCKET_NAME: &str = "proxy.sock";
/// The environment variable that puts an executable in bridge mode (`{port, sock, argv}` in JSON).
pub const BRIDGE_ENV: &str = "DXTUTOR_NET_BRIDGE";
const MAX_HEAD: usize = 16 * 1024;

/// The domains (and ports) the proxy may reach.
#[derive(Debug, Clone, PartialEq)]
pub struct Allowlist {
    domains: Vec<String>,
    ports: Vec<u16>,
}

impl Allowlist {
    /// `domains`: `example.com` (that host) or `*.example.com` (its subdomains). `ports`: empty = 80 and 443.
    pub fn new(domains: &[String], ports: &[u16]) -> Allowlist {
        Allowlist {
            domains: domains
                .iter()
                .map(|d| d.trim().trim_end_matches('.').to_ascii_lowercase())
                .filter(|d| !d.is_empty())
                .collect(),
            ports: if ports.is_empty() {
                vec![80, 443]
            } else {
                ports.to_vec()
            },
        }
    }

    pub fn allows(&self, host: &str, port: u16) -> bool {
        let h = host.trim().trim_end_matches('.').to_ascii_lowercase();
        let h = h.trim_start_matches('[').trim_end_matches(']');
        self.ports.contains(&port)
            && self.domains.iter().any(|d| match d.strip_prefix("*.") {
                Some(suffix) => {
                    h.len() > suffix.len()
                        && h.ends_with(suffix)
                        && h.as_bytes()[h.len() - suffix.len() - 1] == b'.'
                }
                None => h == d,
            })
    }
}

/// `host:port` of a CONNECT target or the authority of an absolute `http://` URI.
fn split_host_port(authority: &str, default_port: u16) -> Option<(String, u16)> {
    let a = authority.trim();
    if let Some(rest) = a.strip_prefix('[') {
        let (h, tail) = rest.split_once(']')?;
        let port = tail
            .strip_prefix(':')
            .map_or(Some(default_port), |p| p.parse().ok())?;
        return Some((h.to_string(), port));
    }
    match a.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => Some((h.to_string(), p.parse().ok()?)),
        _ => Some((a.to_string(), default_port)),
    }
}

/// What a request head asks for: `(host, port, is_connect)`.
pub fn target(head: &str) -> Option<(String, u16, bool)> {
    let line = head.lines().next()?;
    let mut parts = line.split_whitespace();
    let method = parts.next()?;
    let uri = parts.next()?;
    if method.eq_ignore_ascii_case("CONNECT") {
        let (h, p) = split_host_port(uri, 443)?;
        return Some((h, p, true));
    }
    let rest = uri.strip_prefix("http://")?;
    let authority = rest.split('/').next()?;
    let (h, p) = split_host_port(authority, 80)?;
    Some((h, p, false))
}

fn pipe<A, B>(a: A, b: B)
where
    A: Read + Write + Send + 'static + TryCloneStream,
    B: Read + Write + Send + 'static + TryCloneStream,
{
    let (Ok(mut a2), Ok(mut b2)) = (a.try_clone_stream(), b.try_clone_stream()) else {
        return;
    };
    let (mut a, mut b) = (a, b);
    // each direction in its own thread; neither waits for the other (a side that never closes its
    // writing half must not hold the other one)
    std::thread::spawn(move || {
        let _ = io::copy(&mut a2, &mut b2);
        b2.shutdown_write();
    });
    let _ = io::copy(&mut b, &mut a);
    a.shutdown_write();
}

/// The two stream kinds the proxy and the bridge join.
pub trait TryCloneStream: Sized {
    fn try_clone_stream(&self) -> io::Result<Self>;
    fn shutdown_write(&self);
}
impl TryCloneStream for TcpStream {
    fn try_clone_stream(&self) -> io::Result<Self> {
        self.try_clone()
    }
    fn shutdown_write(&self) {
        let _ = self.shutdown(std::net::Shutdown::Write);
    }
}
impl TryCloneStream for UnixStream {
    fn try_clone_stream(&self) -> io::Result<Self> {
        self.try_clone()
    }
    fn shutdown_write(&self) {
        let _ = self.shutdown(std::net::Shutdown::Write);
    }
}

fn read_head(s: &mut UnixStream) -> io::Result<(String, Vec<u8>)> {
    let mut buf = vec![];
    let mut chunk = [0u8; 4096];
    loop {
        let n = s.read(&mut chunk)?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "no request"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let rest = buf.split_off(i + 4);
            return Ok((String::from_utf8_lossy(&buf).into_owned(), rest));
        }
        if buf.len() > MAX_HEAD {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "request head too long",
            ));
        }
    }
}

/// The text a refused request gets (the hint the agent sees mentions it).
pub fn refused_text(host: &str) -> String {
    format!("dxtutor sandbox: {host} is not in the project's allowlist (.dxtutor/sandbox.json allowDomains)")
}

fn serve(mut c: UnixStream, allow: &Allowlist, denied: &Mutex<Vec<String>>) {
    let _ = c.set_read_timeout(Some(Duration::from_secs(30)));
    let Ok((head, rest)) = read_head(&mut c) else {
        return;
    };
    let Some((host, port, connect)) = target(&head) else {
        let _ = c.write_all(
            b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        return;
    };
    if !allow.allows(&host, port) {
        if let Ok(mut d) = denied.lock() {
            let entry = format!("{host}:{port}");
            if !d.contains(&entry) {
                d.push(entry);
            }
        }
        let body = refused_text(&host);
        let _ = write!(c, "HTTP/1.1 403 Forbidden\r\nX-Dxtutor-Sandbox: denied\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        return;
    }
    let addr = (host.as_str(), port)
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next());
    let up = addr.and_then(|a| TcpStream::connect_timeout(&a, Duration::from_secs(15)).ok());
    let Some(mut up) = up else {
        let _ = c.write_all(
            b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
        return;
    };
    let _ = c.set_read_timeout(None);
    if connect {
        if c.write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
            .is_err()
        {
            return;
        }
    } else if up.write_all(head.as_bytes()).is_err() {
        return;
    }
    if !rest.is_empty() && up.write_all(&rest).is_err() {
        return;
    }
    pipe(c, up);
}

/// The proxy of one session, on a Unix socket; it stops when dropped.
pub struct Proxy {
    pub socket: PathBuf,
    stop: Arc<AtomicBool>,
    denied: Arc<Mutex<Vec<String>>>,
}

impl std::fmt::Debug for Proxy {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Proxy({})", self.socket.display())
    }
}

impl Proxy {
    /// Starts it in `dir` (created 0700; the socket is `dir/proxy.sock`).
    pub fn start(dir: &Path, allow: Allowlist) -> io::Result<Proxy> {
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        let socket = dir.join(SOCKET_NAME);
        let _ = std::fs::remove_file(&socket);
        let listener = UnixListener::bind(&socket)?;
        let stop = Arc::new(AtomicBool::new(false));
        let denied: Arc<Mutex<Vec<String>>> = Default::default();
        let allow = Arc::new(allow);
        let (s, d) = (stop.clone(), denied.clone());
        std::thread::spawn(move || {
            for c in listener.incoming() {
                if s.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(c) = c else { continue };
                let (a, d) = (allow.clone(), d.clone());
                std::thread::spawn(move || serve(c, &a, &d));
            }
        });
        Ok(Proxy {
            socket,
            stop,
            denied,
        })
    }

    /// The `host:port`s refused since the last call.
    pub fn take_denied(&self) -> Vec<String> {
        self.denied
            .lock()
            .map(|mut d| std::mem::take(&mut *d))
            .unwrap_or_default()
    }

    pub fn denied_log(&self) -> Arc<Mutex<Vec<String>>> {
        self.denied.clone()
    }
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = UnixStream::connect(&self.socket); // wakes the accept loop
        let _ = std::fs::remove_file(&self.socket);
        if let Some(dir) = self.socket.parent() {
            let _ = std::fs::remove_dir(dir);
        }
    }
}

/// The bridge's parameters, as the sandbox passes them in [`BRIDGE_ENV`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct BridgeSpec {
    pub port: u16,
    pub sock: PathBuf,
    pub argv: Vec<String>,
}

/// Inside the sandbox: forwards `127.0.0.1:port` to the proxy's socket, runs the command and returns its
/// exit code (the bridge dies with it).
pub fn run_bridged(spec: &BridgeSpec) -> i32 {
    let listener = match TcpListener::bind(("127.0.0.1", spec.port)) {
        Ok(l) => l,
        Err(e) => {
            eprintln!(
                "dxtutor sandbox: the network bridge could not listen on 127.0.0.1:{}: {e}",
                spec.port
            );
            return 126;
        }
    };
    let sock = spec.sock.clone();
    std::thread::spawn(move || {
        for c in listener.incoming() {
            let Ok(c) = c else { continue };
            let sock = sock.clone();
            std::thread::spawn(move || {
                if let Ok(u) = UnixStream::connect(&sock) {
                    pipe(c, u);
                }
            });
        }
    });
    let Some((prog, args)) = spec.argv.split_first() else {
        return 126;
    };
    match std::process::Command::new(prog)
        .args(args)
        .env_remove(BRIDGE_ENV)
        .status()
    {
        Ok(s) => s.code().unwrap_or(128),
        Err(e) => {
            eprintln!("dxtutor sandbox: {prog}: {e}");
            127
        }
    }
}

/// For an executable's `main`: in bridge mode (the variable [`BRIDGE_ENV`] is set) runs the bridge and
/// returns the exit code to exit with; otherwise `None`.
pub fn bridge_main() -> Option<i32> {
    let raw = std::env::var(BRIDGE_ENV).ok()?;
    match serde_json::from_str::<BridgeSpec>(&raw) {
        Ok(spec) => Some(run_bridged(&spec)),
        Err(e) => {
            eprintln!("dxtutor sandbox: bad {BRIDGE_ENV}: {e}");
            Some(126)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_allowlist_matches_hosts_subdomains_and_ports() {
        let a = Allowlist::new(
            &[
                "registry.npmjs.org".into(),
                "*.crates.io".into(),
                "Pypi.org.".into(),
            ],
            &[],
        );
        assert!(a.allows("registry.npmjs.org", 443));
        assert!(a.allows("REGISTRY.npmjs.org.", 80));
        assert!(a.allows("static.crates.io", 443));
        assert!(!a.allows("crates.io", 443), "*.x is the subdomains only");
        assert!(!a.allows("evilcrates.io", 443));
        assert!(a.allows("pypi.org", 443));
        assert!(
            !a.allows("registry.npmjs.org", 22),
            "only 80 and 443 by default"
        );
        assert!(!a.allows("example.com", 443));
    }

    #[test]
    fn request_targets_are_read() {
        assert_eq!(
            target("CONNECT github.com:443 HTTP/1.1\r\nHost: x\r\n\r\n"),
            Some(("github.com".into(), 443, true))
        );
        assert_eq!(
            target("GET http://example.com/a/b HTTP/1.1\r\n\r\n"),
            Some(("example.com".into(), 80, false))
        );
        assert_eq!(
            target("GET http://example.com:8080/ HTTP/1.1\r\n\r\n"),
            Some(("example.com".into(), 8080, false))
        );
        assert_eq!(
            target("CONNECT [::1]:8443 HTTP/1.1\r\n\r\n"),
            Some(("::1".into(), 8443, true))
        );
        assert_eq!(target("GET /relative HTTP/1.1\r\n\r\n"), None);
    }

    fn http_through(sock: &Path, head: String) -> String {
        let mut s = UnixStream::connect(sock).unwrap();
        s.write_all(head.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        out
    }

    #[test]
    fn the_proxy_connects_allowed_hosts_and_refuses_the_rest() {
        // a local «origin» that answers one request
        let origin = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = origin.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for c in origin.incoming().flatten() {
                let mut c = c;
                let mut b = [0u8; 1024];
                let n = c.read(&mut b).unwrap_or(0);
                let req = String::from_utf8_lossy(&b[..n]).to_string();
                let body = if req.contains("GET http://127.0.0.1") {
                    "plain-ok"
                } else {
                    "tunnel-ok"
                };
                let _ = write!(
                    c,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
            }
        });
        let dir = tempfile::tempdir().unwrap();
        let p = Proxy::start(
            &dir.path().join("net"),
            Allowlist::new(&["127.0.0.1".into()], &[port]),
        )
        .unwrap();
        let plain = http_through(
            &p.socket,
            format!("GET http://127.0.0.1:{port}/x HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"),
        );
        assert!(plain.ends_with("plain-ok"), "{plain}");
        let mut s = UnixStream::connect(&p.socket).unwrap();
        write!(
            s,
            "CONNECT 127.0.0.1:{port} HTTP/1.1\r\n\r\nGET / HTTP/1.1\r\n\r\n"
        )
        .unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        assert!(
            out.starts_with("HTTP/1.1 200 Connection established") && out.ends_with("tunnel-ok"),
            "{out}"
        );
        let no = http_through(&p.socket, "CONNECT example.com:443 HTTP/1.1\r\n\r\n".into());
        assert!(
            no.starts_with("HTTP/1.1 403") && no.contains(&refused_text("example.com")),
            "{no}"
        );
        assert_eq!(p.take_denied(), vec!["example.com:443".to_string()]);
        assert!(p.take_denied().is_empty());
        let sock = p.socket.clone();
        drop(p);
        assert!(!sock.exists(), "the socket goes with the proxy");
    }
}
