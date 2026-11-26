//! Vault (r23 F4c, docs/v2/AUDIT-r23.md §4.4 — K01, K02, K04, K05) over its HTTP API.
//!
//! The rules, all here and tested:
//! - **The token never leaves the backend.** Signing in (OIDC through the browser, or a pasted token)
//!   puts it in the OS keychain; every call reads it from there; no function returns it.
//! - **No staging or production value leaves Vault.** A KV path says its environment by a segment
//!   (`…/local/…`, `…/staging/…`, `…/production/…`); [`kv_meta`] gives metadata only (versions,
//!   times, custom metadata) — the key names only for `local` — and [`reveal_local`] refuses anything
//!   that is not `local`, or a path that does not say. A revealed value can be read for
//!   [`REVEAL_TTL`] and is then forgotten; it joins what the redaction filters out of model requests
//!   and the terminal.
//! - **Dynamic credentials are leases.** [`dynamic`] keeps the credentials in memory and gives the
//!   UI the lease id, its TTL and the names of the fields; a terminal started with the lease gets
//!   them as environment variables, and the lease is revoked when that terminal ends.
//! - Patching a value is the terminal's job (`vault kv patch … key=-` reads stdin): the IDE never
//!   sees it.

use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::keychain::Store;

/// How long a revealed local value can be read.
pub const REVEAL_TTL: Duration = Duration::from_secs(20);
/// Where the browser comes back after an OIDC sign-in (Vault's own CLI uses the same; the role's
/// `allowed_redirect_uris` must list it).
pub const OIDC_REDIRECT: &str = "http://localhost:8250/oidc/callback";

/// Which Vault: its address and, for Vault Enterprise / HCP, the namespace.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub addr: String,
    #[serde(default)]
    pub namespace: Option<String>,
}

impl Target {
    pub fn new(addr: &str, namespace: Option<&str>) -> Result<Self, String> {
        let addr = addr.trim().trim_end_matches('/').to_string();
        if !(addr.starts_with("http://") || addr.starts_with("https://")) {
            return Err(format!(
                "not a Vault address: {addr:?} (http(s)://host:port)"
            ));
        }
        Ok(Target {
            addr,
            namespace: namespace
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .map(String::from),
        })
    }

    /// The keychain account the token is kept under.
    pub fn account(&self) -> String {
        format!(
            "vault:{}#{}",
            self.addr,
            self.namespace.as_deref().unwrap_or("")
        )
    }
}

// ───── HTTP ─────

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(timeout).build()
}

/// One call to Vault's API with `token` (none: unauthenticated). Vault's error words come back as
/// the error; a 404 is `Ok(None)`.
fn call(
    t: &Target,
    token: Option<&str>,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Option<Value>, String> {
    let url = format!("{}/v1/{}", t.addr, path.trim_start_matches('/'));
    let mut r = agent(Duration::from_secs(10)).request(method, &url);
    if let Some(tok) = token {
        r = r.set("X-Vault-Token", tok);
    }
    if let Some(ns) = &t.namespace {
        r = r.set("X-Vault-Namespace", ns);
    }
    let res = match body {
        Some(b) => r.send_json(b),
        None => r.call(),
    };
    match res {
        Ok(resp) => {
            let text = resp.into_string().map_err(|e| e.to_string())?;
            if text.trim().is_empty() {
                Ok(Some(Value::Null))
            } else {
                serde_json::from_str(&text)
                    .map(Some)
                    .map_err(|e| format!("Vault answered something that is not JSON: {e}"))
            }
        }
        Err(ureq::Error::Status(404, _)) => Ok(None),
        Err(ureq::Error::Status(code, resp)) => {
            let body: Value = resp.into_json().unwrap_or(Value::Null);
            let words: Vec<String> = body["errors"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|e| e.as_str().map(String::from))
                .collect();
            Err(if words.is_empty() {
                format!("Vault answered {code}")
            } else {
                format!("Vault answered {code}: {}", words.join("; "))
            })
        }
        Err(e) => Err(format!("Vault is not reachable at {}: {e}", t.addr)),
    }
}

fn token_of(store: &dyn Store, t: &Target) -> Result<String, String> {
    store
        .get(&t.account())?
        .ok_or_else(|| format!("not signed in to {}", t.addr))
}

fn authed(
    store: &dyn Store,
    t: &Target,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Option<Value>, String> {
    let tok = token_of(store, t)?;
    call(t, Some(&tok), method, path, body)
}

// ───── status and sign-in ─────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub addr: String,
    pub namespace: Option<String>,
    pub reachable: bool,
    pub initialized: bool,
    pub sealed: bool,
    pub version: Option<String>,
    /// a token is in the keychain and Vault accepts it
    pub signed_in: bool,
    pub display_name: Option<String>,
    pub policies: Vec<String>,
    /// seconds left (0 = never expires, e.g. a root token)
    pub ttl: Option<u64>,
    pub renewable: bool,
    pub notes: String,
}

/// What a Vault says about itself and about the token in the keychain (never the token).
pub fn status(store: &dyn Store, t: &Target) -> VaultStatus {
    let mut s = VaultStatus {
        addr: t.addr.clone(),
        namespace: t.namespace.clone(),
        ..Default::default()
    };
    match call(
        t,
        None,
        "GET",
        "sys/health?standbyok=true&sealedcode=200&uninitcode=200&perfstandbyok=true",
        None,
    ) {
        Ok(Some(h)) => {
            s.reachable = true;
            s.initialized = h["initialized"].as_bool().unwrap_or(false);
            s.sealed = h["sealed"].as_bool().unwrap_or(false);
            s.version = h["version"].as_str().map(String::from);
        }
        Ok(None) => {
            s.notes = "no Vault at this address".into();
            return s;
        }
        Err(e) => {
            s.notes = e;
            return s;
        }
    }
    let tok = match store.get(&t.account()) {
        Ok(Some(tok)) => tok,
        Ok(None) => {
            s.notes = "not signed in".into();
            return s;
        }
        Err(e) => {
            s.notes = e;
            return s;
        }
    };
    match call(t, Some(&tok), "GET", "auth/token/lookup-self", None) {
        Ok(Some(v)) => {
            let d = &v["data"];
            s.signed_in = true;
            s.display_name = d["display_name"].as_str().map(String::from);
            s.policies = d["policies"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| p.as_str().map(String::from))
                .collect();
            s.ttl = d["ttl"].as_u64();
            s.renewable = d["renewable"].as_bool().unwrap_or(false);
        }
        Ok(None) | Err(_) => {
            s.notes = "the token in the keychain is no longer valid: sign in again".into();
        }
    }
    s
}

/// Signs in with a pasted token: Vault must accept it; then it goes to the keychain.
pub fn login_token(store: &dyn Store, t: &Target, token: &str) -> Result<VaultStatus, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("no token".into());
    }
    call(t, Some(token), "GET", "auth/token/lookup-self", None)?
        .ok_or("Vault does not know this token")?;
    store.set(&t.account(), token)?;
    Ok(status(store, t))
}

/// The OIDC sign-in, step 1: the URL the browser opens (`auth/<mount>/oidc/auth_url`).
pub fn oidc_auth_url(t: &Target, mount: &str, role: &str) -> Result<String, String> {
    let v = call(
        t,
        None,
        "POST",
        &format!("auth/{}/oidc/auth_url", path_part(mount)?),
        Some(json!({ "role": role, "redirect_uri": OIDC_REDIRECT })),
    )?
    .ok_or("no OIDC auth method at this mount")?;
    let url = v["data"]["auth_url"].as_str().unwrap_or("").to_string();
    if url.is_empty() {
        return Err(format!("the OIDC role {role:?} does not allow the redirect {OIDC_REDIRECT}: add it to its allowed_redirect_uris"));
    }
    Ok(url)
}

/// Waits on 127.0.0.1:8250 for the browser to come back with `code` and `state` (up to `wait`).
pub fn oidc_wait(listener: &TcpListener, wait: Duration) -> Result<(String, String), String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let until = Instant::now() + wait;
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(got) = answer_callback(stream) {
                    return Ok(got);
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

fn answer_callback(mut stream: TcpStream) -> Option<(String, String)> {
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
    let ok =
        path == "/oidc/callback" && params.contains_key("code") && params.contains_key("state");
    let body = if ok {
        "<html><body style='font-family:sans-serif'><h3>Signed in to Vault.</h3><p>You can close this tab and go back to dxtutor.</p></body></html>"
    } else {
        "<html><body>Not a Vault sign-in.</body></html>"
    };
    let _ = write!(
        stream,
        "HTTP/1.1 {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        if ok { "200 OK" } else { "404 Not Found" },
        body.len()
    );
    ok.then(|| (params["code"].clone(), params["state"].clone()))
}

fn unescape(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16)
                {
                    Ok(x) => {
                        out.push(x);
                        i += 3;
                        continue;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

fn escape(s: &str) -> String {
    s.bytes()
        .map(|c| match c {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (c as char).to_string()
            }
            _ => format!("%{c:02X}"),
        })
        .collect()
}

/// The OIDC sign-in, step 3: trade the browser's `code`/`state` for a token, into the keychain.
pub fn oidc_finish(
    store: &dyn Store,
    t: &Target,
    mount: &str,
    code: &str,
    state: &str,
) -> Result<VaultStatus, String> {
    let v = call(
        t,
        None,
        "GET",
        &format!(
            "auth/{}/oidc/callback?state={}&code={}",
            path_part(mount)?,
            escape(state),
            escape(code)
        ),
        None,
    )?
    .ok_or("no OIDC auth method at this mount")?;
    let tok = v["auth"]["client_token"]
        .as_str()
        .ok_or("Vault gave no token for this sign-in")?;
    store.set(&t.account(), tok)?;
    Ok(status(store, t))
}

/// The whole OIDC sign-in: listen on 127.0.0.1:8250, open the browser at Vault's URL, wait for it to
/// come back, and keep the token.
pub fn login_oidc(
    store: &dyn Store,
    t: &Target,
    mount: &str,
    role: &str,
    open: &dyn Fn(&str) -> Result<(), String>,
    wait: Duration,
) -> Result<VaultStatus, String> {
    let listener = TcpListener::bind("127.0.0.1:8250").map_err(|e| {
        format!("cannot listen on 127.0.0.1:8250 for the browser ({e}): is another sign-in open?")
    })?;
    let url = oidc_auth_url(t, mount, role)?;
    open(&url)?;
    let (code, state) = oidc_wait(&listener, wait)?;
    oidc_finish(store, t, mount, &code, &state)
}

/// Renews the token in the keychain.
pub fn renew(store: &dyn Store, t: &Target) -> Result<VaultStatus, String> {
    authed(store, t, "POST", "auth/token/renew-self", Some(json!({})))?;
    Ok(status(store, t))
}

/// Signs out: Vault revokes the token, and it leaves the keychain (even when Vault cannot be reached).
pub fn revoke(store: &dyn Store, t: &Target) -> Result<VaultStatus, String> {
    let r = authed(store, t, "POST", "auth/token/revoke-self", Some(json!({})));
    store.delete(&t.account())?;
    r?;
    Ok(status(store, t))
}

// ───── KV: metadata, and values for local only ─────

/// The environment a KV path names by one of its segments.
pub fn env_of(path: &str) -> Option<&'static str> {
    path.split('/')
        .find_map(|seg| match seg.to_ascii_lowercase().as_str() {
            "local" | "dev" | "development" => Some("local"),
            "staging" | "stage" | "qa" | "test" => Some("staging"),
            "production" | "prod" | "prd" | "live" => Some("production"),
            _ => None,
        })
}

/// The rule: only a `local` path's values are read by the IDE.
pub fn may_reveal(path: &str) -> Result<(), String> {
    match env_of(path) {
        Some("local") => Ok(()),
        Some(env) => Err(format!("{env} values never leave Vault: the IDE shows their metadata only (patch a value in a terminal with `vault kv patch`)")),
        None => Err("this path does not say its environment (…/local/…, …/staging/…, …/production/…): its values are not shown".into()),
    }
}

fn path_part(p: &str) -> Result<String, String> {
    let p = p.trim().trim_matches('/');
    if p.is_empty()
        || p.split('/').any(|c| c.is_empty() || c == "." || c == "..")
        || !p
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./@".contains(c))
    {
        return Err(format!("not a Vault path: {p:?}"));
    }
    Ok(p.to_string())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KvVersion {
    pub version: u64,
    pub created: String,
    pub deleted: bool,
    pub destroyed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KvMeta {
    pub mount: String,
    pub path: String,
    /// `local` | `staging` | `production`, from the path
    pub env: Option<String>,
    pub exists: bool,
    pub current_version: Option<u64>,
    pub versions: Vec<KvVersion>,
    pub created: Option<String>,
    pub updated: Option<String>,
    pub custom_metadata: BTreeMap<String, String>,
    /// the key names — only for a `local` path
    pub keys: Option<Vec<String>>,
    /// the secrets and folders under this path (a folder)
    pub children: Vec<String>,
}

/// A KV v2 secret's metadata (and, under a folder, what it holds). Values never; key names for
/// `local` only.
pub fn kv_meta(store: &dyn Store, t: &Target, mount: &str, path: &str) -> Result<KvMeta, String> {
    let mount = path_part(mount)?;
    let path = path_part(path)?;
    let mut m = KvMeta {
        mount: mount.clone(),
        path: path.clone(),
        env: env_of(&path).map(String::from),
        ..Default::default()
    };
    if let Some(v) = authed(store, t, "LIST", &format!("{mount}/metadata/{path}"), None)? {
        m.children = v["data"]["keys"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|k| k.as_str().map(String::from))
            .collect();
    }
    if let Some(v) = authed(store, t, "GET", &format!("{mount}/metadata/{path}"), None)? {
        let d = &v["data"];
        m.exists = true;
        m.current_version = d["current_version"].as_u64();
        m.created = d["created_time"].as_str().map(String::from);
        m.updated = d["updated_time"].as_str().map(String::from);
        m.custom_metadata = d["custom_metadata"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
            .collect();
        let mut vs: Vec<KvVersion> = d["versions"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(n, x)| KvVersion {
                version: n.parse().unwrap_or(0),
                created: x["created_time"].as_str().unwrap_or("").into(),
                deleted: !x["deletion_time"].as_str().unwrap_or("").is_empty(),
                destroyed: x["destroyed"].as_bool().unwrap_or(false),
            })
            .collect();
        vs.sort_by_key(|v| std::cmp::Reverse(v.version));
        m.versions = vs;
        if may_reveal(&path).is_ok() {
            if let Some(d) = authed(store, t, "GET", &format!("{mount}/data/{path}"), None)? {
                let mut keys: Vec<String> = d["data"]["data"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(k, _)| k.clone())
                    .collect();
                keys.sort();
                m.keys = Some(keys);
            }
        }
    }
    Ok(m)
}

struct Revealed {
    value: String,
    until: Instant,
}

fn reveals() -> &'static Mutex<HashMap<String, Revealed>> {
    static R: std::sync::OnceLock<Mutex<HashMap<String, Revealed>>> = std::sync::OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

fn sweep_reveals() {
    let now = Instant::now();
    reveals().lock().unwrap().retain(|_, r| r.until > now);
}

fn new_id() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0),
    );
    format!("{:016x}", h.finish())
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reveal {
    pub id: String,
    pub path: String,
    pub key: String,
    /// milliseconds the value can be read
    pub ttl_ms: u64,
}

/// Reads one key of a `local` secret (refused for any other environment, here). The value can be
/// read with [`reveal_read`] for [`REVEAL_TTL`]; it also joins what the redaction filters.
pub fn reveal_local(
    store: &dyn Store,
    t: &Target,
    mount: &str,
    path: &str,
    key: &str,
) -> Result<Reveal, String> {
    let mount = path_part(mount)?;
    let path = path_part(path)?;
    may_reveal(&path)?;
    let v = authed(store, t, "GET", &format!("{mount}/data/{path}"), None)?
        .ok_or_else(|| format!("no secret at {mount}/{path}"))?;
    let value = match &v["data"]["data"][key] {
        Value::String(s) => s.clone(),
        Value::Null => return Err(format!("{mount}/{path} has no key {key:?}")),
        other => other.to_string(),
    };
    tutor_protect::redact::learn_values([value.clone()]);
    sweep_reveals();
    let id = new_id();
    reveals().lock().unwrap().insert(
        id.clone(),
        Revealed {
            value,
            until: Instant::now() + REVEAL_TTL,
        },
    );
    Ok(Reveal {
        id,
        path,
        key: key.into(),
        ttl_ms: REVEAL_TTL.as_millis() as u64,
    })
}

/// The value of a reveal, while it lasts.
pub fn reveal_read(id: &str) -> Result<String, String> {
    sweep_reveals();
    reveals()
        .lock()
        .unwrap()
        .get(id)
        .map(|r| r.value.clone())
        .ok_or_else(|| "this value is no longer shown (20 seconds)".into())
}

// ───── dynamic credentials ─────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lease {
    pub lease_id: String,
    pub ttl: u64,
    pub renewable: bool,
    /// the names of the credential's fields (`username`, `password`…), never their values
    pub fields: Vec<String>,
    /// the environment variables a terminal started with this lease gets
    pub env: Vec<String>,
}

struct Held {
    target: Target,
    env: HashMap<String, String>,
}

fn leases() -> &'static Mutex<HashMap<String, Held>> {
    static L: std::sync::OnceLock<Mutex<HashMap<String, Held>>> = std::sync::OnceLock::new();
    L.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The variable a credential field goes in (`password` → `VAULT_DYN_PASSWORD`).
pub fn env_name(field: &str) -> String {
    format!(
        "VAULT_DYN_{}",
        field
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            })
            .collect::<String>()
    )
}

/// Asks a secrets engine for short-lived credentials (`<mount>/creds/<role>`): the UI gets the lease;
/// the values stay here until a terminal takes them, and join what the redaction filters.
pub fn dynamic(store: &dyn Store, t: &Target, mount: &str, role: &str) -> Result<Lease, String> {
    let mount = path_part(mount)?;
    let role = path_part(role)?;
    let v = authed(store, t, "GET", &format!("{mount}/creds/{role}"), None)?
        .ok_or_else(|| format!("no role {role:?} at {mount}"))?;
    let lease_id = v["lease_id"].as_str().unwrap_or("").to_string();
    if lease_id.is_empty() {
        return Err("Vault gave credentials without a lease: not dynamic".into());
    }
    let mut env = HashMap::new();
    let mut fields = vec![];
    for (k, x) in v["data"].as_object().into_iter().flatten() {
        let val = match x {
            Value::String(s) => s.clone(),
            Value::Null => continue,
            other => other.to_string(),
        };
        fields.push(k.clone());
        env.insert(env_name(k), val);
    }
    fields.sort();
    tutor_protect::redact::learn_values(env.values().cloned());
    let mut names: Vec<String> = env.keys().cloned().collect();
    names.sort();
    leases().lock().unwrap().insert(
        lease_id.clone(),
        Held {
            target: t.clone(),
            env,
        },
    );
    Ok(Lease {
        lease_id,
        ttl: v["lease_duration"].as_u64().unwrap_or(0),
        renewable: v["renewable"].as_bool().unwrap_or(false),
        fields,
        env: names,
    })
}

/// The environment of a held lease (for the terminal that uses it), and its Vault.
pub fn lease_env(lease_id: &str) -> Option<(Target, HashMap<String, String>)> {
    leases()
        .lock()
        .unwrap()
        .get(lease_id)
        .map(|h| (h.target.clone(), h.env.clone()))
}

/// Revokes a lease (the operation that used it ended) and forgets its values.
pub fn revoke_lease(store: &dyn Store, t: &Target, lease_id: &str) -> Result<(), String> {
    leases().lock().unwrap().remove(lease_id);
    authed(
        store,
        t,
        "PUT",
        "sys/leases/revoke",
        Some(json!({ "lease_id": lease_id })),
    )?;
    Ok(())
}

/// The leases held now (ids).
pub fn held_leases() -> Vec<String> {
    let mut v: Vec<String> = leases().lock().unwrap().keys().cloned().collect();
    v.sort();
    v
}

#[cfg(test)]
mod tests;
