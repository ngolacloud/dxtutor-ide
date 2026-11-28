//! OAuth for remote MCP servers (the MCP authorization spec, 2025-06-18).
//!
//! When a server answers `401` with `WWW-Authenticate: Bearer resource_metadata="…"`, signing in is:
//! the Protected Resource Metadata (RFC 9728) → the Authorization Server Metadata (RFC 8414, with the
//! OpenID Connect discovery as fallback) → Dynamic Client Registration (RFC 7591) when no `clientId` is
//! configured → Authorization Code with **PKCE (S256)**, the browser coming back to a loopback redirect
//! (`http://127.0.0.1:<port>/callback`), the `resource` parameter (RFC 8707) and the `state` checked.
//!
//! The rules, all here and tested:
//! - every address it talks to passes [`super::url_allowed`] (`https`, or `http` only for this machine);
//! - the tokens (access and refresh) go to the OS keychain ([`tutor_protect::keychain`], account
//!   `mcp:<server url>`), never to a file, and no function returns them to the UI;
//! - a token is refreshed before it expires and on a `401`; when refreshing fails the server **needs
//!   sign-in** — a browser is never opened by itself (signing in is the human's, from the UI);
//! - an error never carries a token: only the server's `error`/`error_description`.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tutor_protect::keychain::Store;

use super::{url_allowed, OAuthConfig, PROTOCOL_VERSION};

/// How long the browser has to come back.
pub const SIGN_IN_WAIT: Duration = Duration::from_secs(180);
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);
/// A token this close to expiring is refreshed before it is used.
const EXPIRY_SKEW: u64 = 30;

/// What the keychain keeps for a server: the tokens and what refreshing them needs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    /// seconds since the epoch
    #[serde(default)]
    pub expires_at: Option<u64>,
    pub token_endpoint: String,
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    pub resource: String,
    #[serde(default)]
    pub scope: Option<String>,
}

impl Tokens {
    pub fn expired(&self, now: u64) -> bool {
        self.expires_at.is_some_and(|t| t <= now + EXPIRY_SKEW)
    }
}

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// The server's canonical URI (RFC 8707 `resource`): lowercase scheme and host, no fragment, no lone `/`.
pub fn resource_of(url: &str) -> String {
    let u = url.trim();
    let u = u.split('#').next().unwrap_or(u);
    let Some((scheme, rest)) = u.split_once("://") else {
        return u.to_string();
    };
    let cut = rest.find(['/', '?']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(cut);
    let tail = if tail == "/" { "" } else { tail };
    format!(
        "{}://{}{tail}",
        scheme.to_ascii_lowercase(),
        authority.to_ascii_lowercase()
    )
}

/// The keychain account of a server's tokens.
pub fn account(url: &str) -> String {
    format!("mcp:{}", resource_of(url))
}

pub fn load(store: &dyn Store, url: &str) -> Result<Option<Tokens>, String> {
    Ok(store
        .get(&account(url))?
        .and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn save(store: &dyn Store, url: &str, t: &Tokens) -> Result<(), String> {
    store.set(
        &account(url),
        &serde_json::to_string(t).map_err(|e| e.to_string())?,
    )
}

/// Signs out: the tokens leave the keychain.
pub fn forget(store: &dyn Store, url: &str) -> Result<(), String> {
    store.delete(&account(url))
}

/// The parameters of a `WWW-Authenticate: Bearer …` header (`resource_metadata`, `scope`, `error`…).
pub fn bearer_params(header: &str) -> HashMap<String, String> {
    let h = header.trim();
    let rest = match h.get(..6) {
        Some(p) if p.eq_ignore_ascii_case("bearer") => &h[6..],
        _ => return HashMap::new(),
    };
    let re =
        regex::Regex::new(r#"([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))"#)
            .unwrap();
    re.captures_iter(rest)
        .map(|c| {
            let v = c
                .get(2)
                .or_else(|| c.get(3))
                .map(|m| m.as_str().replace("\\\"", "\""))
                .unwrap_or_default();
            (c[1].to_ascii_lowercase(), v)
        })
        .collect()
}

/// Where to sign in for a server.
#[derive(Debug, Clone, PartialEq)]
pub struct AuthServer {
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    /// what to ask for: the `scope` of the 401, else the resource's `scopes_supported`
    pub scopes: Vec<String>,
    /// the `resource` parameter (RFC 8707)
    pub resource: String,
}

/// `scheme://authority` and the path without its trailing `/` (empty for the root).
fn split(url: &str) -> Option<(String, String)> {
    let u = url.trim();
    let (scheme, rest) = u.split_once("://")?;
    let cut = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(cut);
    let path = tail.split(['?', '#']).next().unwrap_or("");
    Some((
        format!(
            "{}://{}",
            scheme.to_ascii_lowercase(),
            authority.to_ascii_lowercase()
        ),
        path.trim_end_matches('/').to_string(),
    ))
}

fn same_origin(a: &str, b: &str) -> bool {
    matches!((split(a), split(b)), (Some((x, _)), Some((y, _))) if x == y)
}

fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout(HTTP_TIMEOUT)
        .redirects(0)
        .user_agent(concat!("dxtutor-ide/", env!("CARGO_PKG_VERSION")))
        .build()
}

fn get_json(agent: &ureq::Agent, url: &str) -> Result<Value, String> {
    url_allowed(url)?;
    let r = agent
        .get(url)
        .set("Accept", "application/json")
        .set("MCP-Protocol-Version", PROTOCOL_VERSION)
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(c, _) => format!("{url}: HTTP {c}"),
            e => format!("{url}: {e}"),
        })?;
    r.into_json::<Value>()
        .map_err(|e| format!("{url}: not JSON ({e})"))
}

fn first_json(agent: &ureq::Agent, urls: &[String]) -> Result<Value, String> {
    let mut errs = vec![];
    for u in urls {
        match get_json(agent, u) {
            Ok(v) if v.is_object() => return Ok(v),
            Ok(_) => errs.push(format!("{u}: not a JSON object")),
            Err(e) => errs.push(e),
        }
    }
    Err(errs.join("; "))
}

fn dedup(v: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = vec![];
    for s in v {
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

/// From a server's 401 (or its well-known addresses when there was none) to its authorization server.
pub fn discover(server_url: &str, www_authenticate: Option<&str>) -> Result<AuthServer, String> {
    discover_with(&agent(), server_url, www_authenticate)
}

fn discover_with(
    agent: &ureq::Agent,
    server_url: &str,
    www_authenticate: Option<&str>,
) -> Result<AuthServer, String> {
    let mut resource = resource_of(server_url);
    let params = www_authenticate.map(bearer_params).unwrap_or_default();
    let (origin, path) = split(&resource).ok_or("not an http(s) URL")?;
    // RFC 9728: the address the 401 names, else the well-known ones (with the path, then without)
    let prm_urls = match params.get("resource_metadata") {
        Some(u) => vec![u.clone()],
        None => dedup(vec![
            format!("{origin}/.well-known/oauth-protected-resource{path}"),
            format!("{origin}/.well-known/oauth-protected-resource"),
        ]),
    };
    let prm = first_json(agent, &prm_urls)
        .map_err(|e| format!("no protected resource metadata (RFC 9728): {e}"))?;
    if let Some(r) = prm["resource"].as_str() {
        if !same_origin(r, &resource) {
            return Err(format!(
                "the resource metadata is for {r}, not for {resource}"
            ));
        }
        resource = resource_of(r);
    }
    let issuer = prm["authorization_servers"]
        .as_array()
        .and_then(|a| a.iter().find_map(Value::as_str))
        .ok_or("the resource metadata names no authorization server")?
        .trim_end_matches('/')
        .to_string();
    url_allowed(&issuer)?;
    let (io, ip) = split(&issuer).ok_or("the authorization server is not an http(s) URL")?;
    // RFC 8414, then OpenID Connect discovery (both placements of the path)
    let as_urls = dedup(vec![
        format!("{io}/.well-known/oauth-authorization-server{ip}"),
        format!("{io}/.well-known/openid-configuration{ip}"),
        format!("{io}{ip}/.well-known/openid-configuration"),
    ]);
    let meta = first_json(agent, &as_urls)
        .map_err(|e| format!("no authorization server metadata (RFC 8414 / OIDC): {e}"))?;
    if let Some(i) = meta["issuer"].as_str() {
        if i.trim_end_matches('/') != issuer {
            return Err(format!(
                "the authorization server says it is {i}, not {issuer}"
            ));
        }
    }
    if let Some(m) = meta["code_challenge_methods_supported"].as_array() {
        if !m.iter().any(|x| x.as_str() == Some("S256")) {
            return Err("the authorization server does not support PKCE with S256".into());
        }
    }
    let endpoint = |k: &str| -> Result<String, String> {
        let u = meta[k]
            .as_str()
            .ok_or_else(|| format!("the authorization server has no {k}"))?;
        url_allowed(u)?;
        Ok(u.to_string())
    };
    let authorization_endpoint = endpoint("authorization_endpoint")?;
    let token_endpoint = endpoint("token_endpoint")?;
    let registration_endpoint = match meta["registration_endpoint"].as_str() {
        Some(_) => Some(endpoint("registration_endpoint")?),
        None => None,
    };
    let scopes: Vec<String> = match params.get("scope") {
        Some(s) => s.split_whitespace().map(String::from).collect(),
        None => prm["scopes_supported"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default(),
    };
    Ok(AuthServer {
        issuer,
        authorization_endpoint,
        token_endpoint,
        registration_endpoint,
        scopes,
        resource,
    })
}

/// RFC 7591: a public client for this redirect (no secret, PKCE).
fn register(
    agent: &ureq::Agent,
    endpoint: &str,
    redirect: &str,
) -> Result<(String, Option<String>), String> {
    url_allowed(endpoint)?;
    let body = json!({
        "client_name": "dxtutor-ide",
        "redirect_uris": [redirect],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    let v: Value = match agent
        .post(endpoint)
        .set("Accept", "application/json")
        .send_json(body)
    {
        Ok(r) => r
            .into_json()
            .map_err(|e| format!("registration: not JSON ({e})"))?,
        Err(ureq::Error::Status(c, r)) => {
            return Err(format!("registration refused: HTTP {c}{}", oauth_error(r)))
        }
        Err(e) => return Err(format!("registration: {e}")),
    };
    let id = v["client_id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("the registration gave no client_id")?;
    Ok((
        id.to_string(),
        v["client_secret"].as_str().map(String::from),
    ))
}

/// The server's `error` and `error_description`, never more (a body could echo a token).
fn oauth_error(r: ureq::Response) -> String {
    let v: Value = r.into_json().unwrap_or(Value::Null);
    let mut s = String::new();
    if let Some(e) = v["error"].as_str() {
        s.push_str(&format!(" ({e}"));
        if let Some(d) = v["error_description"].as_str() {
            s.push_str(&format!(": {}", d.chars().take(200).collect::<String>()));
        }
        s.push(')');
    }
    s
}

fn random_b64(n: usize) -> String {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).expect("the OS random source");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

/// PKCE (RFC 7636): the S256 challenge of a verifier.
pub fn challenge_of(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// A verifier of 43 characters (32 random bytes) and its challenge.
pub fn pkce() -> (String, String) {
    let v = random_b64(32);
    let c = challenge_of(&v);
    (v, c)
}

/// Percent-encoding for a query value.
pub fn escape(s: &str) -> String {
    s.bytes()
        .map(|c| match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (c as char).to_string()
            }
            _ => format!("%{c:02X}"),
        })
        .collect()
}

pub fn unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                match std::str::from_utf8(&b[i + 1..i + 3])
                    .ok()
                    .and_then(|h| u8::from_str_radix(h, 16).ok())
                {
                    Some(x) => {
                        out.push(x);
                        i += 3;
                        continue;
                    }
                    None => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The address the browser opens.
pub fn authorize_url(
    a: &AuthServer,
    client_id: &str,
    redirect: &str,
    challenge: &str,
    state: &str,
    scopes: &[String],
) -> String {
    let mut q = vec![
        ("response_type", "code".to_string()),
        ("client_id", client_id.to_string()),
        ("redirect_uri", redirect.to_string()),
        ("code_challenge", challenge.to_string()),
        ("code_challenge_method", "S256".to_string()),
        ("state", state.to_string()),
        ("resource", a.resource.clone()),
    ];
    if !scopes.is_empty() {
        q.push(("scope", scopes.join(" ")));
    }
    let sep = if a.authorization_endpoint.contains('?') {
        '&'
    } else {
        '?'
    };
    let query: Vec<String> = q
        .iter()
        .map(|(k, v)| format!("{k}={}", escape(v)))
        .collect();
    format!("{}{sep}{}", a.authorization_endpoint, query.join("&"))
}

/// Waits for the browser to come back to `/callback` with this sign-in's `state`; a request with
/// another state (or another path) is answered and ignored. The authorization server's `error` ends it.
pub fn wait_callback(
    listener: &TcpListener,
    state: &str,
    wait: Duration,
) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let until = Instant::now() + wait;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(got) = answer_callback(stream, state) {
                    return got;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > until {
                    return Err("the browser did not come back: the sign-in timed out".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn answer_callback(mut stream: TcpStream, state: &str) -> Option<Result<String, String>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line).ok()?;
    let target = line.split_whitespace().nth(1)?.to_string();
    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
    let params: HashMap<String, String> = query
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), unescape(v)))
        .collect();
    let ours = path == "/callback" && params.get("state").map(String::as_str) == Some(state);
    let result = if !ours {
        None
    } else if let Some(e) = params.get("error") {
        let d = params
            .get("error_description")
            .map(|d| format!(": {}", d.chars().take(200).collect::<String>()))
            .unwrap_or_default();
        Some(Err(format!("the authorization server refused: {e}{d}")))
    } else {
        params.get("code").map(|c| Ok(c.clone()))
    };
    let (status, body) = match &result {
        Some(Ok(_)) => ("200 OK", "<html><body style='font-family:sans-serif'><h3>Signed in to the MCP server.</h3><p>You can close this tab and go back to dxtutor.</p></body></html>"),
        Some(Err(_)) => ("200 OK", "<html><body style='font-family:sans-serif'><h3>The sign-in was refused.</h3><p>Go back to dxtutor.</p></body></html>"),
        None => ("400 Bad Request", "<html><body>Not this sign-in.</body></html>"),
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    result
}

fn token_request(
    agent: &ureq::Agent,
    endpoint: &str,
    form: &[(&str, &str)],
) -> Result<Value, String> {
    url_allowed(endpoint)?;
    match agent
        .post(endpoint)
        .set("Accept", "application/json")
        .send_form(form)
    {
        Ok(r) => r
            .into_json::<Value>()
            .map_err(|e| format!("token endpoint: not JSON ({e})")),
        Err(ureq::Error::Status(c, r)) => Err(format!(
            "the token endpoint refused: HTTP {c}{}",
            oauth_error(r)
        )),
        Err(e) => Err(format!("token endpoint: {e}")),
    }
}

fn tokens_from(v: &Value, base: Tokens) -> Result<Tokens, String> {
    let access = v["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("the token endpoint gave no access_token")?;
    if let Some(tt) = v["token_type"].as_str() {
        if !tt.eq_ignore_ascii_case("bearer") {
            return Err(format!(
                "the token endpoint gave a {tt} token, not a bearer"
            ));
        }
    }
    Ok(Tokens {
        access_token: access.to_string(),
        refresh_token: v["refresh_token"]
            .as_str()
            .map(String::from)
            .or(base.refresh_token),
        expires_at: v["expires_in"].as_u64().map(|s| now() + s),
        scope: v["scope"].as_str().map(String::from).or(base.scope),
        ..base
    })
}

/// A refreshed token (the refresh token stays when the server gives no new one).
pub fn refresh(t: &Tokens) -> Result<Tokens, String> {
    let rt = t
        .refresh_token
        .as_deref()
        .ok_or("no refresh token: sign in again")?;
    let mut form = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", rt),
        ("client_id", t.client_id.as_str()),
        ("resource", t.resource.as_str()),
    ];
    if let Some(s) = t.client_secret.as_deref() {
        form.push(("client_secret", s));
    }
    let v = token_request(&agent(), &t.token_endpoint, &form)?;
    tokens_from(&v, t.clone())
}

/// What the sign-in did (never the tokens).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignedIn {
    pub issuer: String,
    pub scopes: Vec<String>,
    /// whether the client was registered now (RFC 7591)
    pub registered: bool,
}

/// `POST initialize` without a token: the server's `WWW-Authenticate` when it answers 401.
fn probe(agent: &ureq::Agent, url: &str, headers: &[(String, String)]) -> Option<String> {
    let mut r = agent
        .post(url)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("MCP-Protocol-Version", PROTOCOL_VERSION);
    for (k, v) in headers {
        r = r.set(k, v);
    }
    let msg = json!({ "jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
        "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
        "clientInfo": { "name": "dxtutor-ide", "version": env!("CARGO_PKG_VERSION") } } });
    match r.send_string(&msg.to_string()) {
        Err(ureq::Error::Status(401, resp)) => Some(
            resp.header("www-authenticate")
                .unwrap_or("Bearer")
                .to_string(),
        ),
        Ok(resp) => {
            // a server that let us in opened a session: close it
            if let Some(sid) = resp.header("mcp-session-id") {
                let _ = agent
                    .delete(url)
                    .set("Mcp-Session-Id", sid)
                    .set("MCP-Protocol-Version", PROTOCOL_VERSION)
                    .call();
            }
            None
        }
        Err(_) => None,
    }
}

/// The whole sign-in, a human action: discover, register when there is no `clientId`, open the browser
/// at the authorization server (`open`), wait for it to come back to the loopback redirect, trade the
/// code (with the PKCE verifier) for tokens, and keep them in the keychain.
pub fn sign_in(
    store: &dyn Store,
    server_url: &str,
    headers: &[(String, String)],
    cfg: Option<&OAuthConfig>,
    open: &dyn Fn(&str) -> Result<(), String>,
    wait: Duration,
) -> Result<SignedIn, String> {
    url_allowed(server_url)?;
    let agent = agent();
    let www = probe(&agent, server_url.trim(), headers);
    let a = discover_with(&agent, server_url, www.as_deref()).map_err(|e| {
        if www.is_none() {
            format!("this server did not ask for a sign-in and {e}")
        } else {
            e
        }
    })?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("cannot listen on 127.0.0.1 for the browser ({e})"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let configured = cfg
        .and_then(|c| c.client_id.clone())
        .filter(|s| !s.trim().is_empty());
    let registered = configured.is_none();
    let (client_id, client_secret) = match configured {
        Some(id) => (id, None),
        None => {
            let ep = a.registration_endpoint.as_deref().ok_or(
                "the authorization server has no registration endpoint: set `oauth.clientId` for this server",
            )?;
            register(&agent, ep, &redirect)?
        }
    };
    let scopes = match cfg.map(|c| c.scopes.clone()).filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => a.scopes.clone(),
    };
    let (verifier, challenge) = pkce();
    let state = random_b64(16);
    open(&authorize_url(
        &a, &client_id, &redirect, &challenge, &state, &scopes,
    ))?;
    let code = wait_callback(&listener, &state, wait)?;
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code.as_str()),
        ("redirect_uri", redirect.as_str()),
        ("client_id", client_id.as_str()),
        ("code_verifier", verifier.as_str()),
        ("resource", a.resource.as_str()),
    ];
    if let Some(s) = client_secret.as_deref() {
        form.push(("client_secret", s));
    }
    let v = token_request(&agent, &a.token_endpoint, &form)?;
    let tokens = tokens_from(
        &v,
        Tokens {
            access_token: String::new(),
            refresh_token: None,
            expires_at: None,
            token_endpoint: a.token_endpoint.clone(),
            client_id,
            client_secret,
            resource: a.resource.clone(),
            scope: (!scopes.is_empty()).then(|| scopes.join(" ")),
        },
    )?;
    save(store, server_url, &tokens)?;
    Ok(SignedIn {
        issuer: a.issuer,
        scopes,
        registered,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bearer_challenge_is_read() {
        let p = bearer_params(
            r#"Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="read write", error=invalid_token"#,
        );
        assert_eq!(
            p["resource_metadata"],
            "https://mcp.example.com/.well-known/oauth-protected-resource"
        );
        assert_eq!(p["scope"], "read write");
        assert_eq!(p["error"], "invalid_token");
        assert!(bearer_params("Basic realm=\"x\"").is_empty());
    }

    #[test]
    fn canonical_resource_pkce_and_escaping() {
        assert_eq!(
            resource_of("HTTPS://MCP.Example.com/Mcp#x"),
            "https://mcp.example.com/Mcp"
        );
        assert_eq!(
            resource_of("https://mcp.example.com/"),
            "https://mcp.example.com"
        );
        assert_eq!(
            account("https://a.example/mcp"),
            "mcp:https://a.example/mcp"
        );
        // the S256 challenge, as computed independently (Python hashlib + base64url)
        assert_eq!(
            challenge_of("dBjftJeZ4CVP-mJ92IZvNG2Pw7aF5hRQtnHxyxM0ZAo"),
            "AIPJCECnGErmDC6bwBICuGqLViRuCc8yWcmYCCXBKoM"
        );
        let (v, c) = pkce();
        assert_eq!(v.len(), 43);
        assert_eq!(challenge_of(&v), c);
        assert_ne!(pkce().0, v);
        assert_eq!(escape("a b/é"), "a%20b%2F%C3%A9");
        assert_eq!(unescape("a%20b%2F%C3%A9+c%"), "a b/é c%");
        let t = Tokens {
            access_token: "a".into(),
            refresh_token: None,
            expires_at: Some(100),
            token_endpoint: "x".into(),
            client_id: "c".into(),
            client_secret: None,
            resource: "r".into(),
            scope: None,
        };
        assert!(t.expired(80));
        assert!(!t.expired(60));
    }

    #[test]
    fn the_tokens_live_in_the_keychain() {
        let s = tutor_protect::keychain::MemStore::default();
        let url = "https://a.example/mcp";
        assert_eq!(load(&s, url).unwrap(), None);
        let t = Tokens {
            access_token: "a".into(),
            refresh_token: Some("r".into()),
            expires_at: None,
            token_endpoint: "https://as.example/token".into(),
            client_id: "c".into(),
            client_secret: None,
            resource: url.into(),
            scope: None,
        };
        save(&s, url, &t).unwrap();
        assert_eq!(load(&s, "HTTPS://A.EXAMPLE/mcp").unwrap(), Some(t));
        forget(&s, url).unwrap();
        assert_eq!(load(&s, url).unwrap(), None);
    }
}
