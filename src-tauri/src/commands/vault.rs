//! Vault (r23 F4c, docs/v2/AUDIT-r23.md §4.4 — K01, K02, K04, K05): thin adapters over
//! `tutor_platform::vault`, with the token in the OS keychain (`tutor_platform::keychain`). No
//! command returns the token; the staging/production refusal and the 20-second reveal live in that
//! crate. Revealing a value and issuing dynamic credentials go to the audit log first (here, in
//! Rust): one that cannot be recorded does not happen.

use std::time::Duration;

use tauri::AppHandle;
use tutor_platform::keychain::OsStore;
use tutor_platform::vault::{self, Target};

fn store() -> &'static OsStore {
    static S: std::sync::OnceLock<OsStore> = std::sync::OnceLock::new();
    S.get_or_init(OsStore::new)
}

fn target(addr: &str, namespace: Option<&str>) -> Result<Target, String> {
    Target::new(addr, namespace)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("vault task failed: {e}"))?
}

fn audited(
    app: &AppHandle,
    root: &str,
    action: &str,
    label: &str,
    reason: Option<&str>,
) -> Result<(), String> {
    crate::board::audit_backend(app, root, "vault", action, label, reason).map_err(|e| {
        format!(
            "not done: the audit log could not record it ({})",
            e.message
        )
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(flatten)]
    status: vault::VaultStatus,
    /// the `vault` CLI (for patching values in a terminal)
    cli: bool,
    /// the OS keychain answers
    keychain: bool,
    keychain_note: Option<String>,
}

fn with_env(status: vault::VaultStatus) -> Status {
    let kc = store().available();
    Status {
        status,
        cli: crate::shellenv::has("vault"),
        keychain: kc.is_ok(),
        keychain_note: kc.err(),
    }
}

/// What the Vault and the token in the keychain say (never the token).
#[tauri::command]
pub async fn vault_status(addr: String, namespace: Option<String>) -> Result<Status, String> {
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        Ok(with_env(vault::status(store(), &t)))
    })
    .await
}

/// Signs in with a pasted token: checked against Vault, then kept in the keychain.
#[tauri::command]
pub async fn vault_login_token(
    addr: String,
    namespace: Option<String>,
    token: String,
) -> Result<Status, String> {
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        vault::login_token(store(), &t, &token).map(with_env)
    })
    .await
}

pub(crate) fn open_browser(url: &str) -> Result<(), String> {
    let (program, args): (&str, Vec<&str>) = if cfg!(target_os = "macos") {
        ("open", vec![url])
    } else if cfg!(windows) {
        ("cmd", vec!["/C", "start", "", url])
    } else {
        ("xdg-open", vec![url])
    };
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open the browser ({e})"))
}

/// Signs in through the browser (OIDC): Vault's URL opens in the browser, the browser comes back to
/// 127.0.0.1:8250, and the token goes to the keychain. Waits up to 3 minutes.
#[tauri::command]
pub async fn vault_login_oidc(
    addr: String,
    namespace: Option<String>,
    mount: Option<String>,
    role: String,
) -> Result<Status, String> {
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        let mount = mount.unwrap_or_else(|| "oidc".into());
        vault::login_oidc(
            store(),
            &t,
            &mount,
            &role,
            &open_browser,
            Duration::from_secs(180),
        )
        .map(with_env)
    })
    .await
}

/// Renews the token in the keychain.
#[tauri::command]
pub async fn vault_renew(addr: String, namespace: Option<String>) -> Result<Status, String> {
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        vault::renew(store(), &t).map(with_env)
    })
    .await
}

/// Signs out: Vault revokes the token and it leaves the keychain.
#[tauri::command]
pub async fn vault_revoke(addr: String, namespace: Option<String>) -> Result<Status, String> {
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        vault::revoke(store(), &t).map(with_env)
    })
    .await
}

/// A KV v2 secret's metadata (and what a folder holds): never a value; key names for `local` only.
#[tauri::command]
pub async fn vault_kv_meta(
    addr: String,
    namespace: Option<String>,
    mount: String,
    path: String,
) -> Result<vault::KvMeta, String> {
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        vault::kv_meta(store(), &t, &mount, &path)
    })
    .await
}

/// Reads one key of a `local` secret (any other environment is refused in Rust), audited first;
/// the value is read with `vault_reveal_read` for 20 seconds.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn vault_reveal_local(
    app: AppHandle,
    root: String,
    addr: String,
    namespace: Option<String>,
    mount: String,
    path: String,
    key: String,
    reason: Option<String>,
) -> Result<vault::Reveal, String> {
    vault::may_reveal(&path)?;
    audited(
        &app,
        &root,
        "reveal-local",
        &format!("show {mount}/{path} {key} for 20 s"),
        reason.as_deref(),
    )?;
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        vault::reveal_local(store(), &t, &mount, &path, &key)
    })
    .await
}

/// The value of a reveal while it lasts (20 seconds), then an error.
#[tauri::command]
pub async fn vault_reveal_read(id: String) -> Result<String, String> {
    vault::reveal_read(&id)
}

/// Short-lived credentials from a secrets engine (`<mount>/creds/<role>`), audited first: the UI
/// gets the lease; the values stay in the backend until a terminal started with the lease takes
/// them, and the lease is revoked when that terminal ends.
#[tauri::command]
pub async fn vault_dynamic(
    app: AppHandle,
    root: String,
    addr: String,
    namespace: Option<String>,
    mount: String,
    role: String,
    reason: Option<String>,
) -> Result<vault::Lease, String> {
    audited(
        &app,
        &root,
        "dynamic",
        &format!("issue {mount}/creds/{role}"),
        reason.as_deref(),
    )?;
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        vault::dynamic(store(), &t, &mount, &role)
    })
    .await
}

/// Revokes a lease now (audited).
#[tauri::command]
pub async fn vault_lease_revoke(
    app: AppHandle,
    root: String,
    addr: String,
    namespace: Option<String>,
    lease: String,
) -> Result<(), String> {
    audited(
        &app,
        &root,
        "lease-revoke",
        &format!("revoke {lease}"),
        None,
    )?;
    blocking(move || {
        let t = target(&addr, namespace.as_deref())?;
        vault::revoke_lease(store(), &t, &lease)
    })
    .await
}

/// The environment a terminal gets from Vault (r23 F4c): `VAULT_ADDR`/`VAULT_NAMESPACE`/`VAULT_TOKEN`
/// (the token from the keychain, so the `vault` CLI works without the UI ever seeing it) and, with a
/// lease, its credentials as `VAULT_DYN_*`. The values join what the terminal masks.
pub fn terminal_env(
    addr: &str,
    namespace: Option<&str>,
    lease: Option<&str>,
) -> Result<(Target, std::collections::HashMap<String, String>), String> {
    use tutor_platform::keychain::Store;
    let t = target(addr, namespace)?;
    let mut env = std::collections::HashMap::new();
    env.insert("VAULT_ADDR".to_string(), t.addr.clone());
    if let Some(ns) = &t.namespace {
        env.insert("VAULT_NAMESPACE".into(), ns.clone());
    }
    if let Some(tok) = store().get(&t.account())? {
        tutor_protect::redact::learn_values([tok.clone()]);
        env.insert("VAULT_TOKEN".into(), tok);
    }
    if let Some(l) = lease {
        let (lt, lenv) = vault::lease_env(l).ok_or("this lease is no longer held")?;
        if lt != t {
            return Err("this lease belongs to another Vault".into());
        }
        env.extend(lenv);
    }
    Ok((t, env))
}

/// Revokes a terminal's lease when it ends (the operation that used it is over).
pub fn revoke_after(t: &Target, lease: &str) -> Result<(), String> {
    vault::revoke_lease(store(), t, lease)
}
