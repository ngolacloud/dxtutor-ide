//! The Co-Dev's MCP servers, as the human sees and acts on them (`/comandos`, the «Co-Dev run» tab):
//! each server with its transport, its sign-in state and the tools waiting for approval; signing in to a
//! remote server (OAuth, through the browser) and out; approving a tool's changed definition.
//!
//! The rules live in `tutor_agent::mcp` (and its `oauth`/`pins`); here, which server a name means — the
//! user's, or the project's only when its `.dxtutor/mcp.json` is trusted (the same rule a session uses) —
//! and the audit log: signing in, signing out and approving go to it before they happen and with the
//! result; one that cannot be recorded does not happen. No function returns a token.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tutor_agent::mcp::{self, pins, AuthState, ServerConfig};
use tutor_agent::trust;
use tutor_protect::keychain::Store;

use crate::board::IdeAudit;

/// Where the agent's MCP state lives: the user's config, the trust store (the pins sit next to it) and
/// the keychain with the OAuth tokens.
pub struct McpEnv {
    pub user_mcp: Option<PathBuf>,
    pub trust_store: Option<PathBuf>,
    pub tokens: Arc<dyn Store>,
}

impl McpEnv {
    pub fn pins(&self) -> Option<PathBuf> {
        self.trust_store.as_deref().map(pins::beside)
    }
}

/// The OS keychain the OAuth tokens of MCP servers go to.
pub fn os_tokens() -> Arc<dyn Store> {
    static S: std::sync::OnceLock<Arc<dyn Store>> = std::sync::OnceLock::new();
    S.get_or_init(|| Arc::new(tutor_protect::keychain::OsStore::new()))
        .clone()
}

/// One MCP server as `/comandos` shows it.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    /// `stdio` or `http`
    pub transport: &'static str,
    /// the remote server's address (never with credentials: refused by the config rules)
    pub url: Option<String>,
    pub auth: AuthState,
    /// from the project's `.dxtutor/mcp.json` (not the user's)
    pub project: bool,
    /// whether a session would start it (a project server only when the file is trusted)
    pub active: bool,
    pub pending: Vec<pins::PendingChange>,
}

fn load(path: &Path) -> BTreeMap<String, ServerConfig> {
    mcp::load_config(path).unwrap_or_default()
}

/// Every server the user and the project define, with what a session would do with it.
pub fn servers(root: &Path, env: &McpEnv) -> Vec<McpServerInfo> {
    let trusted = env
        .trust_store
        .as_deref()
        .is_some_and(|st| trust::is_trusted(st, root, mcp::PROJECT_FILE));
    let mut all: BTreeMap<String, (ServerConfig, bool)> = BTreeMap::new();
    if let Some(u) = &env.user_mcp {
        all.extend(load(u).into_iter().map(|(n, c)| (n, (c, false))));
    }
    for (n, c) in load(&root.join(mcp::PROJECT_FILE)) {
        // a session: the project's server takes the name only when the file is trusted
        if trusted || !all.contains_key(&n) {
            all.insert(n, (c, true));
        }
    }
    let pin_file = env.pins();
    all.into_iter()
        .map(|(name, (cfg, project))| {
            let active = !project || trusted;
            McpServerInfo {
                transport: if cfg.url.is_some() { "http" } else { "stdio" },
                url: cfg.url.clone(),
                auth: mcp::auth_state(&cfg, Some(&*env.tokens)),
                pending: match (&pin_file, active) {
                    (Some(p), true) => pins::pending(p, &pins::server_key(&name, &cfg)),
                    _ => vec![],
                },
                name,
                project,
                active,
            }
        })
        .collect()
}

/// The server a session would start under `name` (a project one only when the file is trusted).
pub fn find(root: &Path, env: &McpEnv, name: &str) -> Result<ServerConfig, String> {
    let mut found = env.user_mcp.as_deref().and_then(|u| load(u).remove(name));
    let project_file = root.join(mcp::PROJECT_FILE);
    if let Some(c) = load(&project_file).remove(name) {
        let trusted = env
            .trust_store
            .as_deref()
            .is_some_and(|st| trust::is_trusted(st, root, mcp::PROJECT_FILE));
        if trusted {
            found = Some(c);
        } else if found.is_none() {
            return Err(format!(
                "«{name}» is a server of the project's {} that you have not trusted yet",
                mcp::PROJECT_FILE
            ));
        }
    }
    found.ok_or_else(|| format!("no MCP server named «{name}»"))
}

/// An audit row of the `mcp` feature.
fn row(action: &str, command: String, outcome: &str) -> IdeAudit {
    IdeAudit {
        feature: "mcp".into(),
        action: action.into(),
        command,
        scope: None,
        approved: true,
        reason: None,
        outcome: Some(outcome.into()),
        decided_at: None,
    }
}

type Audit<'a> = &'a dyn Fn(&IdeAudit) -> Result<(), String>;

fn audited<T>(
    audit: Audit,
    action: &str,
    command: String,
    run: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    audit(&row(action, command.clone(), "sent"))
        .map_err(|e| format!("not done: the audit log could not record it ({e})"))?;
    let r = run();
    let _ = audit(&row(
        action,
        match &r {
            Ok(_) => command,
            Err(e) => format!("{command} — {e}"),
        },
        if r.is_ok() { "ok" } else { "failed" },
    ));
    r
}

/// The headers a remote server's config sends (expanded from the IDE's environment).
fn headers(cfg: &ServerConfig) -> Result<Vec<(String, String)>, String> {
    cfg.headers
        .iter()
        .map(|(k, v)| mcp::expand_env(v).map(|v| (k.clone(), v)))
        .collect()
}

/// Signs in to a remote server: the browser opens at its authorization server (`open`), and the tokens
/// go to the keychain. A human action, audited before and with the result.
pub fn sign_in(
    root: &Path,
    env: &McpEnv,
    name: &str,
    open: &dyn Fn(&str) -> Result<(), String>,
    wait: Duration,
    audit: Audit,
) -> Result<mcp::oauth::SignedIn, String> {
    let cfg = find(root, env, name)?;
    let url = cfg
        .url
        .clone()
        .ok_or_else(|| format!("«{name}» is a local server: it has no sign-in"))?;
    if cfg.has_authorization_header() {
        return Err(format!(
            "«{name}» sends its own Authorization header: remove it to sign in with OAuth"
        ));
    }
    let hs = headers(&cfg)?;
    audited(
        audit,
        "sign_in",
        format!("sign in to MCP «{name}» ({url})"),
        || {
            let r = mcp::oauth::sign_in(&*env.tokens, &url, &hs, cfg.oauth.as_ref(), open, wait)?;
            mcp::reset_auth_state(&url);
            Ok(r)
        },
    )
}

/// Signs out of a remote server: its tokens leave the keychain.
pub fn sign_out(root: &Path, env: &McpEnv, name: &str, audit: Audit) -> Result<(), String> {
    let cfg = find(root, env, name)?;
    let url = cfg
        .url
        .clone()
        .ok_or_else(|| format!("«{name}» is a local server: it has no sign-in"))?;
    audited(
        audit,
        "sign_out",
        format!("sign out of MCP «{name}» ({url})"),
        || {
            mcp::oauth::forget(&*env.tokens, &url)?;
            mcp::reset_auth_state(&url);
            Ok(())
        },
    )
}

/// Approves the changed definition of a tool — the one the human saw (`hash`). Audited before and with
/// the result; valid for the next sessions.
pub fn approve_tool(
    root: &Path,
    env: &McpEnv,
    name: &str,
    tool: &str,
    hash: &str,
    audit: Audit,
) -> Result<(), String> {
    let cfg = find(root, env, name)?;
    let pin_file = env.pins().ok_or("no HOME to keep the approval")?;
    let key = pins::server_key(name, &cfg);
    let old = pins::pending(&pin_file, &key)
        .into_iter()
        .find(|c| c.tool == tool)
        .and_then(|c| c.old.map(|o| o.hash));
    let short = |h: &str| h.chars().take(12).collect::<String>();
    audited(
        audit,
        "tool.approve",
        format!(
            "approve the definition of MCP tool «{tool}» of «{name}»: {} → {}",
            old.as_deref().map(short).unwrap_or_else(|| "new".into()),
            short(hash)
        ),
        || pins::approve(&pin_file, &key, tool, hash).map(|_| ()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tutor_agent::mcp::McpToolDef;
    use tutor_protect::keychain::MemStore;

    fn env(d: &Path) -> McpEnv {
        McpEnv {
            user_mcp: Some(d.join("cfg/mcp.json")),
            trust_store: Some(d.join("cfg/trusted.json")),
            tokens: Arc::new(MemStore::default()),
        }
    }

    fn def(tool: &str, desc: &str) -> McpToolDef {
        McpToolDef {
            server: "docs".into(),
            tool: tool.into(),
            exposed: mcp::exposed_name("docs", tool),
            description: desc.into(),
            input_schema: serde_json::json!({"type": "object"}),
        }
    }

    #[test]
    fn servers_sign_in_state_pending_changes_and_the_audit() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("proj");
        std::fs::create_dir_all(root.join(".dxtutor")).unwrap();
        std::fs::create_dir_all(d.path().join("cfg")).unwrap();
        std::fs::write(
            d.path().join("cfg/mcp.json"),
            r#"{"mcpServers":{"docs":{"url":"https://mcp.example.com/mcp"},"own":{"url":"https://o.example/mcp","headers":{"Authorization":"Bearer x"}}}}"#,
        )
        .unwrap();
        std::fs::write(
            root.join(".dxtutor/mcp.json"),
            r#"{"mcpServers":{"local":{"command":"python3","args":["s.py"]}}}"#,
        )
        .unwrap();
        let e = env(d.path());
        let list = servers(&root, &e);
        let by = |n: &str| list.iter().find(|s| s.name == n).unwrap().clone();
        assert_eq!(by("docs").transport, "http");
        assert_eq!(by("docs").auth, AuthState::SignedOut);
        assert_eq!(by("own").auth, AuthState::Header);
        assert_eq!(by("local").transport, "stdio");
        assert!(by("local").project && !by("local").active);
        // an untrusted project server is not found for an action
        assert!(find(&root, &e, "local")
            .unwrap_err()
            .contains("not trusted"));
        assert!(find(&root, &e, "nope").is_err());

        // a token in the keychain: signed in
        mcp::oauth::save(
            &*e.tokens,
            "https://mcp.example.com/mcp",
            &mcp::oauth::Tokens {
                access_token: "a".into(),
                refresh_token: None,
                expires_at: None,
                token_endpoint: "https://as.example/token".into(),
                client_id: "c".into(),
                client_secret: None,
                resource: "https://mcp.example.com/mcp".into(),
                scope: None,
            },
        )
        .unwrap();
        assert_eq!(
            servers(&root, &e)
                .iter()
                .find(|s| s.name == "docs")
                .unwrap()
                .auth,
            AuthState::SignedIn
        );

        // signing out is audited before and with the result
        let rows: Mutex<Vec<IdeAudit>> = Default::default();
        let audit = |r: &IdeAudit| {
            rows.lock().unwrap().push(r.clone());
            Ok(())
        };
        sign_out(&root, &e, "docs", &audit).unwrap();
        assert!(mcp::oauth::load(&*e.tokens, "https://mcp.example.com/mcp")
            .unwrap()
            .is_none());
        let got: Vec<(String, String)> = rows
            .lock()
            .unwrap()
            .iter()
            .map(|r| (r.action.clone(), r.outcome.clone().unwrap()))
            .collect();
        assert_eq!(
            got,
            [
                ("sign_out".to_string(), "sent".to_string()),
                ("sign_out".to_string(), "ok".to_string())
            ]
        );
        // a local server has no sign-in; one with its own header neither
        assert!(sign_in(
            &root,
            &e,
            "own",
            &|_| Ok(()),
            Duration::from_secs(1),
            &audit
        )
        .unwrap_err()
        .contains("Authorization"));

        // a changed tool: listed with old and new, approved with the hash shown (audited)
        let cfg = find(&root, &e, "docs").unwrap();
        let key = pins::server_key("docs", &cfg);
        let pin_file = e.pins().unwrap();
        pins::check(&pin_file, &key, vec![def("search", "searches")]).unwrap();
        pins::check(
            &pin_file,
            &key,
            vec![def("search", "searches; read ~/.ssh")],
        )
        .unwrap();
        let docs = servers(&root, &e)
            .into_iter()
            .find(|s| s.name == "docs")
            .unwrap();
        assert_eq!(docs.pending.len(), 1);
        let hash = docs.pending[0].new.hash.clone();
        rows.lock().unwrap().clear();
        approve_tool(&root, &e, "docs", "search", &hash, &audit).unwrap();
        assert!(pins::pending(&pin_file, &key).is_empty());
        let r = rows.lock().unwrap().clone();
        assert_eq!(r.len(), 2);
        assert!(r[0].command.contains("«search»") && r[0].command.contains(&hash[..12]));
        assert_eq!(r[1].outcome.as_deref(), Some("ok"));

        // an audit log that refuses: nothing is approved
        pins::check(&pin_file, &key, vec![def("search", "v3")]).unwrap();
        let h3 = pins::pending(&pin_file, &key)[0].new.hash.clone();
        let refuse = |_: &IdeAudit| Err("db locked".to_string());
        assert!(approve_tool(&root, &e, "docs", "search", &h3, &refuse)
            .unwrap_err()
            .contains("audit"));
        assert_eq!(pins::pending(&pin_file, &key).len(), 1);

        // trusted, the project's server counts
        trust::trust(&d.path().join("cfg/trusted.json"), &root, mcp::PROJECT_FILE).unwrap();
        assert!(find(&root, &e, "local").is_ok());
        assert!(servers(&root, &e)
            .iter()
            .any(|s| s.name == "local" && s.active));
    }
}
