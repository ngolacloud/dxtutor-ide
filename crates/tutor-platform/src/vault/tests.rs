use super::*;
use crate::keychain::MemStore;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;

/// A tiny HTTP server answering like Vault: `route(method, path, body) -> (status, json)`. Records
/// each request as `METHOD path token`.
fn fake(
    route: impl Fn(&str, &str, &str) -> (u16, String) + Send + Sync + 'static,
) -> (Target, Arc<Mutex<Vec<String>>>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = format!("http://{}", l.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(vec![]));
    let log = seen.clone();
    std::thread::spawn(move || {
        for s in l.incoming().flatten() {
            let mut r = BufReader::new(s.try_clone().unwrap());
            let mut line = String::new();
            if r.read_line(&mut line).is_err() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let (method, path) = (
                parts.next().unwrap_or("").to_string(),
                parts.next().unwrap_or("").to_string(),
            );
            let (mut len, mut token) = (0usize, String::new());
            loop {
                let mut h = String::new();
                if r.read_line(&mut h).is_err() || h.trim().is_empty() {
                    break;
                }
                let lower = h.to_ascii_lowercase();
                if let Some(v) = lower.strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
                if lower.starts_with("x-vault-token:") {
                    token = h["x-vault-token:".len()..].trim().to_string();
                }
            }
            let mut body = vec![0u8; len];
            let _ = r.read_exact(&mut body);
            let body = String::from_utf8_lossy(&body).to_string();
            log.lock().unwrap().push(format!("{method} {path} {token}"));
            let (code, out) = route(&method, &path, &body);
            let mut s = s;
            let _ = write!(s, "HTTP/1.1 {code} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{out}", out.len());
        }
    });
    (Target::new(&addr, None).unwrap(), seen)
}

#[test]
fn the_environment_of_a_path_and_the_reveal_rule() {
    assert_eq!(env_of("apps/shop/local/db"), Some("local"));
    assert_eq!(env_of("apps/shop/production/db"), Some("production"));
    assert_eq!(env_of("prod/db"), Some("production"));
    assert_eq!(env_of("apps/shop/db"), None);
    assert!(may_reveal("apps/shop/dev/db").is_ok());
    // r23 F4c acceptance: no staging or production value leaves Vault — refused here, in Rust
    assert!(may_reveal("apps/shop/staging/db")
        .unwrap_err()
        .contains("staging values never leave Vault"));
    assert!(may_reveal("apps/shop/production/db")
        .unwrap_err()
        .contains("production values never leave Vault"));
    assert!(may_reveal("apps/shop/db")
        .unwrap_err()
        .contains("does not say its environment"));
    // a path that tries to mix environments takes the first one it names
    assert!(may_reveal("production/local/db").is_err());
    assert!(
        path_part("../sys/raw").is_err() && path_part("a//b").is_err() && path_part("a b").is_err()
    );
    assert_eq!(env_name("security_token"), "VAULT_DYN_SECURITY_TOKEN");
    assert!(Target::new("vault.local:8200", None).is_err());
    assert_eq!(
        Target::new("https://v.example/ ", Some(" admin "))
            .unwrap()
            .account(),
        "vault:https://v.example#admin"
    );
}

#[test]
fn oidc_through_the_browser_keeps_only_the_token_in_the_keychain() {
    let (t, seen) = fake(|m, p, _| {
        match (m, p) {
        ("POST", "/v1/auth/oidc/oidc/auth_url") => (200, r#"{"data":{"auth_url":"https://idp.example/authorize?state=st1"}}"#.into()),
        ("GET", p) if p.starts_with("/v1/auth/oidc/oidc/callback") => (200, r#"{"auth":{"client_token":"hvs.from-oidc"}}"#.into()),
        ("GET", "/v1/auth/token/lookup-self") => (200, r#"{"data":{"display_name":"oidc-ana","policies":["default","dev"],"ttl":3600,"renewable":true}}"#.into()),
        ("GET", p) if p.starts_with("/v1/sys/health") => (200, r#"{"initialized":true,"sealed":false,"version":"2.2.2"}"#.into()),
        _ => (404, "{}".into()),
    }
    });
    let store = MemStore::default();
    assert_eq!(
        oidc_auth_url(&t, "oidc", "dev").unwrap(),
        "https://idp.example/authorize?state=st1"
    );
    // the browser comes back to the local listener
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    let browser = std::thread::spawn(move || {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(
            s,
            "GET /oidc/callback?code=c%2F1&state=st1 HTTP/1.1\r\nHost: localhost\r\n\r\n"
        )
        .unwrap();
        let mut page = String::new();
        let _ = s.read_to_string(&mut page);
        page
    });
    let (code, state) = oidc_wait(&l, Duration::from_secs(5)).unwrap();
    assert_eq!((code.as_str(), state.as_str()), ("c/1", "st1"));
    assert!(browser.join().unwrap().contains("Signed in to Vault"));
    let st = oidc_finish(&store, &t, "oidc", &code, &state).unwrap();
    assert!(st.signed_in);
    assert_eq!(
        (st.display_name.as_deref(), st.ttl),
        (Some("oidc-ana"), Some(3600))
    );
    assert_eq!(
        store.get(&t.account()).unwrap().as_deref(),
        Some("hvs.from-oidc")
    );
    // the status never carries the token
    assert!(!serde_json::to_string(&st)
        .unwrap()
        .contains("hvs.from-oidc"));
    assert!(seen
        .lock()
        .unwrap()
        .iter()
        .any(|r| r.starts_with("GET /v1/auth/oidc/oidc/callback?state=st1&code=c%2F1")));
    // a role that does not allow the redirect says so
    let (t2, _) = fake(|_, _, _| (200, r#"{"data":{"auth_url":""}}"#.into()));
    assert!(oidc_auth_url(&t2, "oidc", "dev")
        .unwrap_err()
        .contains("allowed_redirect_uris"));
}

#[test]
fn dynamic_credentials_are_a_lease_the_values_stay_here_and_revoke_forgets_them() {
    let (t, seen) = fake(|m, p, b| {
        match (m, p) {
        ("GET", "/v1/database/creds/app") => (200, r#"{"lease_id":"database/creds/app/L1","lease_duration":900,"renewable":true,"data":{"username":"v-app-x1","password":"A1a-dyn-pass-9z"}}"#.into()),
        ("PUT", "/v1/sys/leases/revoke") if b.contains("database/creds/app/L1") => (204, String::new()),
        ("GET", "/v1/kv/creds/static") => (200, r#"{"lease_id":"","data":{"x":"y"}}"#.into()),
        _ => (404, "{}".into()),
    }
    });
    let store = MemStore::default();
    assert!(dynamic(&store, &t, "database", "app")
        .unwrap_err()
        .contains("not signed in"));
    store.set(&t.account(), "hvs.user").unwrap();
    let l = dynamic(&store, &t, "database", "app").unwrap();
    assert_eq!(
        (l.lease_id.as_str(), l.ttl, l.fields.clone()),
        (
            "database/creds/app/L1",
            900,
            vec!["password".to_string(), "username".to_string()]
        )
    );
    assert_eq!(l.env, vec!["VAULT_DYN_PASSWORD", "VAULT_DYN_USERNAME"]);
    assert!(
        !serde_json::to_string(&l)
            .unwrap()
            .contains("A1a-dyn-pass-9z"),
        "a value reached the UI's answer"
    );
    let (_, env) = lease_env(&l.lease_id).unwrap();
    assert_eq!(env["VAULT_DYN_PASSWORD"], "A1a-dyn-pass-9z");
    // the value joins the redaction: a model request or the terminal never shows it
    assert!(!tutor_protect::redact::current()
        .mask("pw A1a-dyn-pass-9z")
        .contains("A1a-dyn-pass-9z"));
    revoke_lease(&store, &t, &l.lease_id).unwrap();
    assert!(lease_env(&l.lease_id).is_none());
    assert!(seen
        .lock()
        .unwrap()
        .iter()
        .any(|r| r == "PUT /v1/sys/leases/revoke hvs.user"));
    assert!(dynamic(&store, &t, "kv", "static")
        .unwrap_err()
        .contains("not dynamic"));
}

struct DevVault {
    child: Child,
    _home: tempfile::TempDir,
    t: Target,
    root: String,
}

impl Drop for DevVault {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A real `vault server -dev` on a free port, with a temporary HOME (the dev server writes
/// `~/.vault-token`: never the human's).
fn dev_vault() -> Option<DevVault> {
    if Command::new("vault")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_err()
    {
        eprintln!("skipped: vault is not installed");
        return None;
    }
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let home = tempfile::tempdir().unwrap();
    let root = format!("root-{}", std::process::id());
    let child = Command::new("vault")
        .args([
            "server",
            "-dev",
            &format!("-dev-root-token-id={root}"),
            &format!("-dev-listen-address=127.0.0.1:{port}"),
        ])
        .env("HOME", home.path())
        .env_remove("VAULT_TOKEN")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let t = Target::new(&format!("http://127.0.0.1:{port}"), None).unwrap();
    let v = DevVault {
        child,
        _home: home,
        t,
        root,
    };
    for _ in 0..100 {
        if status(&MemStore::default(), &v.t).reachable {
            return Some(v);
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    eprintln!("skipped: the dev Vault did not start");
    None
}

/// r23 F4c acceptance, against a real Vault: sign in with a token (kept in the keychain, never
/// returned), metadata of every environment, values of `local` only (20 s), renew and sign out.
#[test]
fn a_real_dev_vault() {
    let Some(v) = dev_vault() else { return };
    let t = &v.t;
    let store = MemStore::default();
    let s0 = status(&store, t);
    assert!(
        s0.reachable && !s0.sealed && !s0.signed_in && s0.version.is_some(),
        "{s0:?}"
    );
    assert!(login_token(&store, t, "hvs.not-a-token").is_err());
    assert_eq!(store.get(&t.account()).unwrap(), None);
    // a child token (renewable, with a TTL) — what a human would paste
    let child = call(
        t,
        Some(&v.root),
        "POST",
        "auth/token/create",
        Some(
            json!({"policies": ["default"], "ttl": "1h", "renewable": true, "display_name": "ana"}),
        ),
    )
    .unwrap()
    .unwrap();
    let tok = child["auth"]["client_token"].as_str().unwrap().to_string();
    let root_store = MemStore::default();
    root_store.set(&t.account(), &v.root).unwrap();
    let st = login_token(&store, t, &tok).unwrap();
    assert!(
        st.signed_in && st.renewable && st.ttl.unwrap() > 3000,
        "{st:?}"
    );
    assert!(!serde_json::to_string(&st).unwrap().contains(&tok));
    // secrets in three environments (written with the root token)
    for (env, pw) in [
        ("local", "local-pw-123"),
        ("staging", "staging-pw-456"),
        ("production", "prod-pw-789"),
    ] {
        call(
            t,
            Some(&v.root),
            "POST",
            &format!("secret/data/apps/shop/{env}/db"),
            Some(json!({"data": {"DB_PASSWORD": pw, "DB_USER": "app"}})),
        )
        .unwrap();
    }
    call(
        t,
        Some(&v.root),
        "POST",
        "secret/data/apps/shop/production/db",
        Some(json!({"data": {"DB_PASSWORD": "prod-pw-790", "DB_USER": "app"}})),
    )
    .unwrap();
    let prod = kv_meta(&root_store, t, "secret", "apps/shop/production/db").unwrap();
    assert!(
        prod.exists && prod.current_version == Some(2) && prod.versions.len() == 2,
        "{prod:?}"
    );
    assert_eq!(
        (prod.env.as_deref(), prod.keys.clone()),
        (Some("production"), None)
    );
    let json = serde_json::to_string(&prod).unwrap();
    assert!(!json.contains("prod-pw") && !json.contains("DB_PASSWORD"));
    let local = kv_meta(&root_store, t, "secret", "apps/shop/local/db").unwrap();
    assert_eq!(
        local.keys,
        Some(vec!["DB_PASSWORD".to_string(), "DB_USER".to_string()])
    );
    assert!(!serde_json::to_string(&local)
        .unwrap()
        .contains("local-pw-123"));
    let folder = kv_meta(&root_store, t, "secret", "apps/shop").unwrap();
    assert_eq!(folder.children, vec!["local/", "production/", "staging/"]);
    assert!(!folder.exists);
    // values: local only, for 20 seconds
    assert!(reveal_local(
        &root_store,
        t,
        "secret",
        "apps/shop/production/db",
        "DB_PASSWORD"
    )
    .unwrap_err()
    .contains("never leave Vault"));
    assert!(reveal_local(
        &root_store,
        t,
        "secret",
        "apps/shop/staging/db",
        "DB_PASSWORD"
    )
    .is_err());
    let r = reveal_local(
        &root_store,
        t,
        "secret",
        "apps/shop/local/db",
        "DB_PASSWORD",
    )
    .unwrap();
    assert_eq!(
        (r.ttl_ms, reveal_read(&r.id).unwrap().as_str()),
        (20_000, "local-pw-123")
    );
    assert!(!tutor_protect::redact::current()
        .mask("DB_PASSWORD=local-pw-123")
        .contains("local-pw-123"));
    reveals().lock().unwrap().get_mut(&r.id).unwrap().until = Instant::now();
    assert!(reveal_read(&r.id).unwrap_err().contains("no longer shown"));
    assert!(
        reveal_local(&root_store, t, "secret", "apps/shop/local/db", "NOPE")
            .unwrap_err()
            .contains("no key")
    );
    // the user's token cannot read secrets (default policy): Vault's words come back
    assert!(kv_meta(&store, t, "secret", "apps/shop/local/db")
        .unwrap_err()
        .contains("403"));
    // renew, sign out: Vault revokes it and it leaves the keychain
    assert!(renew(&store, t).unwrap().signed_in);
    let out = revoke(&store, t).unwrap();
    assert!(!out.signed_in);
    assert_eq!(store.get(&t.account()).unwrap(), None);
    assert!(call(t, Some(&tok), "GET", "auth/token/lookup-self", None).is_err());
}
