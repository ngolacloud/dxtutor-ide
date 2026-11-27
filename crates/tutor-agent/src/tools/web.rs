//! H5a (docs/v2/AUDIT-harness.md §3, P2 item 7): `web_fetch` — reads one web page as text, from the IDE (not from the
//! command sandbox). Who may be read is the permission policy's (`permissions::decide`): a domain of the project's
//! trusted list (`.dxtutor/sandbox.json` `allowDomains`) or one the person allowed (`web_fetch:<domain>`) is read at
//! once; any other domain asks, with «allow always» for that domain; this machine or the internal network
//! (`localhost`, private and link-local addresses — e.g. a cloud's metadata service) always asks, with no «always».
//! Here, what the policy cannot see: a URL holding a secret the redaction knows is refused (it would leave the
//! machine), a public name that resolves to an internal address is refused (and the connection only goes to the
//! addresses checked), a redirect is not followed (the new URL is a new call, decided again), and only text comes
//! back — HTML as readable text, at most 20 000 characters per call (`offset` for the rest).

use std::io::Read as _;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::time::Duration;

use serde_json::{json, Value};

use crate::tool::{Tool, ToolCtx, ToolOutput};

pub const NAME: &str = "web_fetch";
const MAX_BODY: u64 = 3 * 1024 * 1024;
const PAGE: usize = 20_000;

/// The host of an `http(s)://` URL (lowercase, without the port or brackets), or `None`.
pub fn host_of(url: &str) -> Option<String> {
    let rest = url
        .trim()
        .strip_prefix("https://")
        .or_else(|| url.trim().strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.contains('@') {
        return None; // credentials in the URL: never
    }
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']').next()?.to_string()
    } else {
        authority.split(':').next()?.to_string()
    };
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    let ok = !host.is_empty()
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-._:".contains(c));
    ok.then_some(host)
}

fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            v.is_loopback()
                || v.is_private()
                || v.is_link_local()
                || v.is_unspecified()
                || v.is_broadcast()
                || (o[0] == 100 && (64..128).contains(&o[1])) // carrier-grade NAT
                || o[0] == 0
        }
        IpAddr::V6(v) => {
            let s = v.segments();
            v.is_loopback()
                || v.is_unspecified()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link local
                || v.to_ipv4_mapped().is_some_and(|m| private_ip(IpAddr::V4(m)))
        }
    }
}

/// This machine or the internal network, by name or address (the policy always asks for these).
pub fn is_private(host: &str) -> bool {
    if let Ok(ip) = host.parse::<IpAddr>() {
        return private_ip(ip);
    }
    host == "localhost"
        || [".localhost", ".local", ".internal", ".lan", ".home.arpa"]
            .iter()
            .any(|s| host.ends_with(s))
        || !host.contains('.')
}

/// Whether `host` is one of `domains` (`example.com`, or `*.example.com` for its subdomains).
pub fn domain_listed(domains: &[String], host: &str) -> bool {
    crate::net_proxy::Allowlist::new(domains, &[]).allows(host, 443)
}

/// `web_fetch`: one page as text.
pub struct WebFetch;

fn entity(name: &str) -> Option<String> {
    let c = match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" | "#39" => '\'',
        "nbsp" => ' ',
        "mdash" => '—',
        "ndash" => '–',
        "hellip" => '…',
        "copy" => '©',
        _ => {
            let n = name.strip_prefix('#')?;
            let code = match n.strip_prefix(['x', 'X']) {
                Some(h) => u32::from_str_radix(h, 16).ok()?,
                None => n.parse().ok()?,
            };
            return char::from_u32(code).map(String::from);
        }
    };
    Some(c.to_string())
}

fn decode_entities(s: &str) -> String {
    let re = regex::Regex::new(r"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});").unwrap();
    re.replace_all(s, |c: &regex::Captures| {
        entity(&c[1]).unwrap_or_else(|| c[0].to_string())
    })
    .into_owned()
}

/// An HTML page as readable text: no scripts, styles or markup; headings, list items, links and code kept.
pub fn html_to_text(html: &str) -> String {
    let mut s = html.to_string();
    for (pat, rep) in [
        (r"(?is)<!--.*?-->", ""),
        (
            r"(?is)<(script|style|noscript|svg|template|iframe)\b.*?</\s*(script|style|noscript|svg|template|iframe)\s*>",
            "",
        ),
        (r"(?is)<head\b.*?</head\s*>", ""),
        (r"(?is)<pre\b[^>]*>", "\n```\n"),
        (r"(?is)</pre\s*>", "\n```\n"),
        (r"(?is)<h([1-6])\b[^>]*>", "\n\n#$1 "),
        (r"(?is)</h[1-6]\s*>", "\n\n"),
        (r"(?is)<li\b[^>]*>", "\n- "),
        (r"(?is)<br\s*/?>", "\n"),
        (
            r"(?is)</?(p|div|section|article|main|header|footer|nav|aside|ul|ol|table|tr|blockquote|dl|dt|dd|figure|form)\b[^>]*>",
            "\n",
        ),
        (r"(?is)</t[dh]\s*>", " | "),
        (r"(?is)<code\b[^>]*>", "`"),
        (r"(?is)</code\s*>", "`"),
    ] {
        s = regex::Regex::new(pat)
            .unwrap()
            .replace_all(&s, rep)
            .into_owned();
    }
    // headings: «#2 » → «## »
    s = regex::Regex::new(r"#([1-6]) ")
        .unwrap()
        .replace_all(&s, |c: &regex::Captures| {
            format!("{} ", "#".repeat(c[1].parse::<usize>().unwrap_or(1)))
        })
        .into_owned();
    // links with an absolute address keep it
    s = regex::Regex::new(
        r#"(?is)<a\b[^>]*?href\s*=\s*["'](https?://[^"']+)["'][^>]*>(.*?)</a\s*>"#,
    )
    .unwrap()
    .replace_all(&s, "[$2]($1)")
    .into_owned();
    s = regex::Regex::new(r"(?s)<[^>]*>")
        .unwrap()
        .replace_all(&s, "")
        .into_owned();
    s = decode_entities(&s);
    let spaces = regex::Regex::new(r"[ \t\u{a0}]+").unwrap();
    let mut out: Vec<String> = vec![];
    let mut fence = false;
    for line in s.lines() {
        if line.trim() == "```" {
            fence = !fence;
            out.push("```".into());
            continue;
        }
        let l = if fence {
            line.trim_end().to_string()
        } else {
            spaces.replace_all(line.trim(), " ").into_owned()
        };
        if l.is_empty() && out.last().is_none_or(|p| p.is_empty()) {
            continue;
        }
        out.push(l);
    }
    out.join("\n").trim().to_string()
}

fn text_type(ct: &str) -> Option<bool> {
    // Some(true) = HTML, Some(false) = plain text, None = not text
    let ct = ct.to_ascii_lowercase();
    if ct.contains("html") {
        Some(true)
    } else if ct.starts_with("text/")
        || ["json", "xml", "javascript", "yaml", "toml", "markdown"]
            .iter()
            .any(|t| ct.contains(t))
        || ct.is_empty()
    {
        Some(false)
    } else {
        None
    }
}

/// The addresses to connect to: all of them, but a public name that resolves to an internal address is refused.
fn resolve(host: &str, port: u16, private_ok: bool) -> Result<Vec<SocketAddr>, String> {
    let addrs: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("{host}: {e}"))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("{host}: no address"));
    }
    if !private_ok && addrs.iter().any(|a| private_ip(a.ip())) {
        return Err(format!(
            "{host} resolves to an internal address: not read (ask for the address itself if it is meant)"
        ));
    }
    Ok(addrs)
}

fn fetch(url: &str, offset: usize) -> Result<String, String> {
    let host = host_of(url).ok_or("not an http(s) URL (credentials in a URL are not accepted)")?;
    let masked = crate::redact::current().mask(url);
    if masked != url {
        return Err("the URL holds a secret this project knows: not sent".into());
    }
    let private_ok = is_private(&host);
    let h2 = host.clone();
    let agent = ureq::AgentBuilder::new()
        .redirects(0)
        .timeout_connect(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .user_agent("dxtutor-web-fetch/1")
        .resolver(move |netloc: &str| -> std::io::Result<Vec<SocketAddr>> {
            let port = netloc
                .rsplit(':')
                .next()
                .and_then(|p| p.parse().ok())
                .unwrap_or(443);
            resolve(&h2, port, private_ok).map_err(std::io::Error::other)
        })
        .build();
    let resp = match agent.get(url).call() {
        Ok(r) => r,
        Err(ureq::Error::Status(code, r)) => {
            return Err(format!("{url}: HTTP {code} {}", r.status_text()))
        }
        Err(e) => return Err(format!("{url}: {e}")),
    };
    let status = resp.status();
    if (300..400).contains(&status) {
        let to = resp.header("location").unwrap_or("");
        let abs = if to.starts_with("http://") || to.starts_with("https://") {
            to.to_string()
        } else if to.starts_with('/') {
            let scheme = if url.starts_with("https") {
                "https"
            } else {
                "http"
            };
            let authority = url
                .split("://")
                .nth(1)
                .and_then(|r| r.split('/').next())
                .unwrap_or("");
            format!("{scheme}://{authority}{to}")
        } else {
            to.to_string()
        };
        return Ok(format!(
            "URL: {url}\nStatus: {status} — redirected to {abs}\nNot followed: call web_fetch with that URL (it is decided again)."
        ));
    }
    let ct = resp.content_type().to_string();
    let Some(html) = text_type(&ct) else {
        return Err(format!(
            "{url}: not text ({ct}): only pages and text files are read"
        ));
    };
    let mut body = vec![];
    resp.into_reader()
        .take(MAX_BODY)
        .read_to_end(&mut body)
        .map_err(|e| format!("{url}: {e}"))?;
    let raw = String::from_utf8_lossy(&body);
    let text = if html {
        html_to_text(&raw)
    } else {
        raw.into_owned()
    };
    let chars: Vec<char> = text.chars().collect();
    let total = chars.len();
    let start = offset.min(total);
    let end = (start + PAGE).min(total);
    let mut out = format!("URL: {url}\nStatus: {status} · {ct} · {total} characters\n\n");
    out.extend(chars[start..end].iter());
    if end < total {
        out.push_str(&format!(
            "\n\n… ({} more characters: call again with offset {end})",
            total - end
        ));
    }
    Ok(out)
}

impl Tool for WebFetch {
    fn name(&self) -> &str {
        NAME
    }
    fn description(&self) -> &str {
        "Read one web page (documentation, a changelog, an issue, an API reference) as text: HTML becomes readable \
         text, 20 000 characters per call (`offset` for the rest). Domains the project or the person allowed are read \
         at once; another domain asks the person, and this machine or the internal network always does. Redirects \
         are not followed: the answer names the new URL. Never put a secret or private data in a URL."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "an http(s) URL"},
                "offset": {"type": "integer", "minimum": 0, "description": "the character to start from (default 0)"}
            },
            "required": ["url"],
            "additionalProperties": false
        })
    }
    /// Not «read only» for the loop: every call goes to the permission policy (the domain decides), and
    /// sub-agents — which only get read-only tools and no policy — never reach the network.
    fn read_only(&self) -> bool {
        false
    }
    fn mutates_files(&self) -> bool {
        false
    }
    fn run(&self, input: &Value, _ctx: &ToolCtx) -> ToolOutput {
        let url = input["url"].as_str().unwrap_or_default().trim();
        let offset = input["offset"].as_u64().unwrap_or(0) as usize;
        match fetch(url, offset) {
            Ok(s) => ToolOutput::ok(s),
            Err(e) => ToolOutput::err(e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    #[test]
    fn hosts_and_the_internal_network() {
        assert_eq!(
            host_of("https://Docs.RS/serde/latest").as_deref(),
            Some("docs.rs")
        );
        assert_eq!(
            host_of("http://127.0.0.1:8080/x").as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(host_of("http://[::1]:3000/").as_deref(), Some("::1"));
        assert_eq!(host_of("ftp://x.org"), None);
        assert_eq!(host_of("https://user:pw@x.org/"), None);
        assert_eq!(host_of("file:///etc/passwd"), None);
        for p in [
            "localhost",
            "127.0.0.1",
            "10.1.2.3",
            "192.168.0.1",
            "172.16.4.4",
            "169.254.169.254",
            "::1",
            "fd00::1",
            "fe80::1",
            "100.64.0.1",
            "db.internal",
            "printer.local",
            "intranet",
            "::ffff:10.0.0.1",
        ] {
            assert!(is_private(p), "{p}");
        }
        for p in ["docs.rs", "8.8.8.8", "github.com", "2606:4700::1111"] {
            assert!(!is_private(p), "{p}");
        }
        let d = vec!["docs.rs".to_string(), "*.python.org".to_string()];
        assert!(domain_listed(&d, "docs.rs") && domain_listed(&d, "docs.python.org"));
        assert!(!domain_listed(&d, "python.org") && !domain_listed(&d, "evil-docs.rs"));
    }

    #[test]
    fn html_becomes_readable_text() {
        let html = r#"<html><head><title>T</title><style>p{}</style></head><body>
            <nav><a href="/">Home</a></nav><script>alert(1)</script>
            <h1>Serde &amp; you</h1><p>Read   the <a href="https://serde.rs/derive.html">derive guide</a>.</p>
            <ul><li>one</li><li>two &lt;3&gt;</li></ul>
            <pre>fn main() {
    println!("hi");
}</pre><p>Use <code>#[derive]</code>&nbsp;now &#8212; ok</p><!-- hidden --></body></html>"#;
        let t = html_to_text(html);
        assert!(t.starts_with("Home"), "{t}");
        assert!(t.contains("# Serde & you"));
        assert!(t.contains("Read the [derive guide](https://serde.rs/derive.html)."));
        assert!(t.contains("- one\n- two <3>"));
        assert!(
            t.contains("```\nfn main() {\n    println!(\"hi\");\n}\n```"),
            "{t}"
        );
        assert!(t.contains("Use `#[derive]` now — ok"));
        assert!(!t.contains("alert") && !t.contains("hidden") && !t.contains("p{}"));
    }

    /// A local server stands for the web: text, a page in parts, a redirect, a binary — and a public name that
    /// resolves to it is refused (only an address of this machine asked for as such reaches it).
    #[test]
    fn a_page_is_read_in_parts_and_redirects_and_binaries_are_not_followed() {
        let srv = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = srv.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for s in srv.incoming().take(4) {
                let mut s = s.unwrap();
                let mut buf = [0u8; 2048];
                let n = std::io::Read::read(&mut s, &mut buf).unwrap();
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                let resp = if req.starts_with("GET /long") {
                    let body = "a".repeat(25_000);
                    format!("HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\n\r\n{body}", body.len())
                } else if req.starts_with("GET /moved") {
                    "HTTP/1.1 301 Moved\r\nLocation: /long\r\nContent-Length: 0\r\n\r\n".to_string()
                } else if req.starts_with("GET /img") {
                    "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 3\r\n\r\nPNG"
                        .to_string()
                } else {
                    let body = "<p>Hello &amp; welcome</p>";
                    format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{body}", body.len())
                };
                s.write_all(resp.as_bytes()).unwrap();
            }
        });
        let base = format!("http://127.0.0.1:{port}");
        let ctx = ToolCtx {
            root: std::env::temp_dir(),
            cancel: Default::default(),
        };
        let page = WebFetch.run(&json!({"url": format!("{base}/")}), &ctx);
        assert!(
            !page.is_error && page.content.ends_with("Hello & welcome"),
            "{}",
            page.content
        );
        let long = WebFetch.run(&json!({"url": format!("{base}/long")}), &ctx);
        assert!(
            long.content
                .contains("5000 more characters: call again with offset 20000"),
            "{}",
            &long.content[..200]
        );
        let moved = WebFetch.run(&json!({"url": format!("{base}/moved")}), &ctx);
        assert!(
            moved
                .content
                .contains(&format!("redirected to {base}/long")),
            "{}",
            moved.content
        );
        let img = WebFetch.run(&json!({"url": format!("{base}/img")}), &ctx);
        assert!(
            img.is_error && img.content.contains("not text"),
            "{}",
            img.content
        );
        // `localhost.` is not an IP literal but this machine: allowed only because it is private by name; a public
        // name pointing here would be refused by the resolver
        assert!(resolve("localhost", port, false)
            .unwrap_err()
            .contains("internal address"));
        assert!(!WebFetch.read_only() && !WebFetch.mutates_files());
    }
}
