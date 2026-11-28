//! The organisation's AI gateway, and the policy that can require it.
//!
//! A gateway (the seiva AI gateway, or any server that speaks the Anthropic Messages API or
//! OpenAI Chat Completions) sits between the IDE and the models: identity, budget, masking,
//! guardrails and audit happen there. The IDE talks to it like to a provider: a base URL, a
//! gateway key, and a **route** name where a model name would go.
//!
//! The policy comes from three places, and only tightens on the way down:
//!
//! 1. **The system file** (`/etc/dxtutor/llm.json` on Linux; [`system_policy_path`]),
//!    managed by the organisation's administrators. It wins. A system file that cannot be
//!    read or parsed fails **closed**: every model call is refused until it is fixed.
//! 2. **The person's settings** (`providers.json`): their own gateway URL and format.
//! 3. **The project's `.dxtutor/llm.json`.** It may require the gateway and forbid local
//!    models without anyone's say-so — that only tightens. A gateway **URL** from the project
//!    counts only once the person trusts the file: a repository could otherwise send every
//!    prompt to a server of its choosing. An invalid project file also fails closed.
//!
//! Local models (Ollama on this machine) stay allowed when the gateway is required, unless
//! a policy says `"allow_local": false`; an Ollama on another machine is not local.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The project's policy file, relative to the project root.
pub const PROJECT_FILE: &str = ".dxtutor/llm.json";

/// Where the organisation's policy lives on this machine.
pub fn system_policy_path() -> PathBuf {
    if cfg!(target_os = "windows") {
        let base = std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into());
        PathBuf::from(base).join("dxtutor").join("llm.json")
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/dxtutor/llm.json")
    } else {
        PathBuf::from("/etc/dxtutor/llm.json")
    }
}

/// Which API the gateway speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GatewayApi {
    /// The Anthropic Messages API (`POST {url}/v1/messages`).
    Anthropic,
    /// OpenAI Chat Completions (`POST {url}/v1/chat/completions`).
    Openai,
}

impl GatewayApi {
    /// `"anthropic"` or `"openai"`.
    pub fn as_str(self) -> &'static str {
        match self {
            GatewayApi::Anthropic => "anthropic",
            GatewayApi::Openai => "openai",
        }
    }

    /// Parse `"anthropic"` / `"openai"` (case-insensitive).
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "anthropic" => Some(GatewayApi::Anthropic),
            "openai" => Some(GatewayApi::Openai),
            _ => None,
        }
    }
}

/// A gateway: its base URL and the API it speaks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GatewaySpec {
    /// The base URL (`https://ai.example.org`), without `/v1/...`.
    pub url: String,
    /// The API it speaks.
    pub api: GatewayApi,
}

impl GatewaySpec {
    /// The chat endpoint for this gateway's API.
    pub fn chat_endpoint(&self) -> String {
        let base = self.url.trim().trim_end_matches('/');
        match self.api {
            GatewayApi::Anthropic => format!("{base}/v1/messages"),
            GatewayApi::Openai => format!("{base}/v1/chat/completions"),
        }
    }

    /// Where the gateway lists the routes a caller may use (`GET`, both APIs).
    pub fn models_endpoint(&self) -> String {
        format!("{}/v1/models", self.url.trim().trim_end_matches('/'))
    }

    /// Check the URL: `https`, or plain `http` only to this machine (a local gateway); no
    /// credentials, query or fragment in it.
    pub fn validate(&self) -> Result<(), String> {
        let url = self.url.trim();
        let bad = |why: &str| Err(format!("gateway URL `{url}`: {why}"));
        let rest = if let Some(r) = url.strip_prefix("https://") {
            r
        } else if let Some(r) = url.strip_prefix("http://") {
            let host = host_of(r);
            if !is_loopback(&host) {
                return bad("must be https (plain http only to this machine)");
            }
            r
        } else {
            return bad("must start with https://");
        };
        let authority = rest.split('/').next().unwrap_or_default();
        if authority.is_empty() {
            return bad("has no host");
        }
        if authority.contains('@') {
            return bad("must not carry credentials");
        }
        if url.contains('?')
            || url.contains('#')
            || url.chars().any(|c| c.is_whitespace() || c.is_control())
        {
            return bad("must not have a query, a fragment or spaces");
        }
        Ok(())
    }
}

/// The host of `authority[/path]` (without port; IPv6 brackets removed).
fn host_of(rest: &str) -> String {
    let authority = rest.split('/').next().unwrap_or_default();
    let authority = authority.rsplit('@').next().unwrap_or(authority);
    if let Some(v6) = authority.strip_prefix('[') {
        return v6
            .split(']')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
    }
    authority
        .split(':')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn is_loopback(host: &str) -> bool {
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

/// Whether an Ollama host is this machine (an empty host is the default, localhost).
pub fn is_local_host(url: &str) -> bool {
    let url = url.trim();
    if url.is_empty() {
        return true;
    }
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    is_loopback(&host_of(rest))
}

#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct PolicyFile {
    require_gateway: Option<bool>,
    allow_local: Option<bool>,
    gateway: Option<GatewaySpec>,
}

fn read_policy(path: &Path) -> Result<Option<PolicyFile>, String> {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<PolicyFile>(&text)
            .map(Some)
            .map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Where the policy is read from.
#[derive(Debug, Clone, Default)]
pub struct Sources {
    /// The organisation's file (normally [`system_policy_path`]).
    pub system: Option<PathBuf>,
    /// The person's own gateway, from their settings.
    pub user_gateway: Option<GatewaySpec>,
    /// The open project, whose `.dxtutor/llm.json` is read.
    pub project_root: Option<PathBuf>,
    /// Whether the person trusts the project's file (its gateway URL counts only then).
    pub project_trusted: bool,
}

/// The effective policy.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Policy {
    /// Every model call must go through the gateway (local ones excepted, below).
    pub require_gateway: bool,
    /// Local models (Ollama on this machine) stay allowed.
    pub allow_local: bool,
    /// The gateway to use, if any.
    pub gateway: Option<GatewaySpec>,
    /// Where the gateway came from: `system`, `project` or `user`.
    pub gateway_from: Option<String>,
    /// Who required the gateway: `system`, `project`.
    pub required_by: Vec<String>,
    /// What was wrong or ignored (an invalid file, an untrusted project URL).
    pub problems: Vec<String>,
}

/// The providers that call a model on this machine only when their host is local.
const LOCAL_PROVIDERS: [&str; 1] = ["ollama"];

impl Policy {
    /// Read the policy from `sources`.
    pub fn load(sources: &Sources) -> Policy {
        let mut p = Policy {
            allow_local: true,
            ..Policy::default()
        };
        // 1. The organisation's file: it wins, and a broken one fails closed.
        let mut system_gateway = None;
        if let Some(path) = &sources.system {
            match read_policy(path) {
                Ok(None) => {}
                Ok(Some(f)) => {
                    if f.require_gateway == Some(true) {
                        p.require_gateway = true;
                        p.required_by.push("system".into());
                    }
                    if f.allow_local == Some(false) {
                        p.allow_local = false;
                    }
                    system_gateway = f.gateway;
                }
                Err(e) => {
                    p.require_gateway = true;
                    p.allow_local = false;
                    p.required_by.push("system".into());
                    p.problems.push(format!("the organisation's policy cannot be read, so every model call is refused: {e}"));
                    return p;
                }
            }
        }
        // 3. The project's file: it may only tighten; its gateway URL needs trust.
        let mut project_gateway = None;
        if let Some(root) = &sources.project_root {
            match read_policy(&root.join(PROJECT_FILE)) {
                Ok(None) => {}
                Ok(Some(f)) => {
                    if f.require_gateway == Some(true)
                        && !p.required_by.iter().any(|r| r == "project")
                    {
                        p.require_gateway = true;
                        p.required_by.push("project".into());
                    }
                    if f.allow_local == Some(false) {
                        p.allow_local = false;
                    }
                    if let Some(g) = f.gateway {
                        if sources.project_trusted {
                            project_gateway = Some(g);
                        } else {
                            p.problems.push(format!(
                                "the project's gateway URL ({}) is ignored until you trust {PROJECT_FILE}",
                                g.url
                            ));
                        }
                    }
                }
                Err(e) => {
                    p.require_gateway = true;
                    p.required_by.push("project".into());
                    p.problems.push(format!(
                        "the project's policy is invalid, so the gateway is required: {e}"
                    ));
                }
            }
        }
        // The gateway: the organisation's, then the trusted project's, then the person's.
        let chosen = [
            (system_gateway, "system"),
            (project_gateway, "project"),
            (sources.user_gateway.clone(), "user"),
        ]
        .into_iter()
        .find_map(|(g, from)| g.map(|g| (g, from)));
        if let Some((g, from)) = chosen {
            match g.validate() {
                Ok(()) => {
                    p.gateway = Some(g);
                    p.gateway_from = Some(from.into());
                }
                Err(e) => p.problems.push(e),
            }
        }
        p
    }

    /// Whether `provider` may be called. `ollama_host` is the configured Ollama host (empty
    /// is localhost). The error says why, in words a person can act on.
    pub fn check(&self, provider: &str, ollama_host: Option<&str>) -> Result<(), String> {
        if provider == "gateway" {
            return match &self.gateway {
                Some(_) => Ok(()),
                None => Err(
                    "no organisation gateway is configured: set its URL in Settings → Models and providers, or ask \
                     your administrator"
                        .into(),
                ),
            };
        }
        if !self.require_gateway {
            return Ok(());
        }
        if LOCAL_PROVIDERS.contains(&provider) {
            if !self.allow_local {
                return Err(format!(
                    "the {} policy does not allow local models: use the organisation gateway",
                    self.who()
                ));
            }
            if !is_local_host(ollama_host.unwrap_or("")) {
                return Err(format!(
                    "the {} policy requires the organisation gateway; an Ollama on another machine is not local",
                    self.who()
                ));
            }
            return Ok(());
        }
        Err(format!(
            "the {} policy requires the organisation gateway: {provider} cannot be called directly",
            self.who()
        ))
    }

    fn who(&self) -> &str {
        if self.required_by.iter().any(|r| r == "system") {
            "organisation's"
        } else {
            "project's"
        }
    }
}

/// The routes this gateway key may use: `GET /v1/models`, the `id` of each entry of `data`
/// (the shape both the Anthropic and the OpenAI model lists share), in the gateway's order.
/// The key goes the way the gateway's API expects it; the URL is validated first.
pub fn list_routes(gateway: &GatewaySpec, key: &str) -> Result<Vec<String>, String> {
    gateway.validate()?;
    let mut req = ureq::get(&gateway.models_endpoint()).timeout(std::time::Duration::from_secs(10));
    req = match gateway.api {
        GatewayApi::Anthropic => req
            .set("x-api-key", key)
            .set("anthropic-version", crate::ANTHROPIC_VERSION),
        GatewayApi::Openai => req.set("authorization", &format!("Bearer {key}")),
    };
    let resp = match req.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(401 | 403, _)) => return Err("the gateway refused the key".into()),
        Err(ureq::Error::Status(code, r)) => {
            let detail: String = r
                .into_string()
                .unwrap_or_default()
                .chars()
                .take(300)
                .collect();
            return Err(format!("the gateway returned {code}: {detail}"));
        }
        Err(ureq::Error::Transport(t)) => return Err(format!("could not reach the gateway: {t}")),
    };
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("the gateway's model list is not JSON: {e}"))?;
    let data = body
        .get("data")
        .and_then(|d| d.as_array())
        .ok_or("the gateway's model list has no `data`")?;
    let mut routes: Vec<String> = Vec::new();
    for id in data
        .iter()
        .filter_map(|m| m.get("id").and_then(|v| v.as_str()))
    {
        let id = id.trim();
        if !id.is_empty() && !routes.iter().any(|r| r == id) {
            routes.push(id.to_string());
        }
    }
    Ok(routes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dxt-gw-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join(".dxtutor")).unwrap();
        d
    }

    fn gw(url: &str) -> GatewaySpec {
        GatewaySpec {
            url: url.into(),
            api: GatewayApi::Anthropic,
        }
    }

    /// Serve one HTTP request from a local socket with `body`; hand back what was asked.
    fn serve_once(
        status: &'static str,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let h = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            while !String::from_utf8_lossy(&buf).contains("\r\n\r\n") {
                let n = sock.read(&mut chunk).unwrap();
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&chunk[..n]);
            }
            let reply = format!(
                "{status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            sock.write_all(reply.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf).to_string()
        });
        (url, h)
    }

    #[test]
    fn the_routes_come_from_the_gateways_model_list_with_the_key_its_api_expects() {
        let list = r#"{"object":"list","data":[{"id":"support-chat"},{"id":"code-review"},{"id":"support-chat"},{"id":" "}]}"#;
        let (url, server) = serve_once("HTTP/1.1 200 OK", list);
        let anth = GatewaySpec {
            url: format!("{url}/"),
            api: GatewayApi::Anthropic,
        };
        assert_eq!(
            list_routes(&anth, "sk-gw").unwrap(),
            ["support-chat", "code-review"]
        );
        let asked = server.join().unwrap().to_ascii_lowercase();
        assert!(asked.starts_with("get /v1/models "), "{asked}");
        assert!(
            asked.contains("x-api-key: sk-gw") && asked.contains("anthropic-version"),
            "{asked}"
        );

        let (url, server) = serve_once("HTTP/1.1 200 OK", list);
        let oai = GatewaySpec {
            url,
            api: GatewayApi::Openai,
        };
        assert_eq!(list_routes(&oai, "sk-gw").unwrap().len(), 2);
        let asked = server.join().unwrap().to_ascii_lowercase();
        assert!(
            asked.contains("authorization: bearer sk-gw") && !asked.contains("x-api-key"),
            "{asked}"
        );
    }

    #[test]
    fn a_refused_key_or_a_bad_url_lists_nothing() {
        let (url, server) = serve_once("HTTP/1.1 401 Unauthorized", r#"{"error":"no"}"#);
        let err = list_routes(
            &GatewaySpec {
                url,
                api: GatewayApi::Openai,
            },
            "bad",
        )
        .unwrap_err();
        assert!(err.contains("refused the key"), "{err}");
        server.join().unwrap();
        let err = list_routes(&gw("http://ai.example.org"), "k").unwrap_err();
        assert!(err.contains("https"), "{err}");
    }

    #[test]
    fn without_any_policy_everything_is_allowed_and_no_gateway_is_set() {
        let p = Policy::load(&Sources::default());
        assert!(!p.require_gateway && p.allow_local && p.gateway.is_none());
        assert!(p.check("claude", None).is_ok());
        assert!(p.check("gateway", None).is_err(), "no gateway configured");
    }

    #[test]
    fn the_organisation_file_requires_the_gateway_and_wins() {
        let d = tmp("org");
        let sys = d.join("llm.json");
        std::fs::write(&sys, r#"{"require_gateway": true, "gateway": {"url": "https://ai.org.example", "api": "openai"}}"#).unwrap();
        let p = Policy::load(&Sources {
            system: Some(sys),
            user_gateway: Some(gw("https://my-own.example")),
            ..Sources::default()
        });
        assert!(p.require_gateway);
        assert_eq!(p.gateway.as_ref().unwrap().url, "https://ai.org.example");
        assert_eq!(p.gateway_from.as_deref(), Some("system"));
        let err = p.check("claude", None).unwrap_err();
        assert!(
            err.contains("organisation's") && err.contains("claude"),
            "{err}"
        );
        assert!(p.check("gateway", None).is_ok());
        assert!(p.check("ollama", None).is_ok(), "local stays allowed");
        assert!(
            p.check("ollama", Some("http://gpu-box:11434")).is_err(),
            "another machine is not local"
        );
    }

    #[test]
    fn a_broken_organisation_file_fails_closed() {
        let d = tmp("broken");
        let sys = d.join("llm.json");
        std::fs::write(&sys, "{ not json").unwrap();
        let p = Policy::load(&Sources {
            system: Some(sys),
            user_gateway: Some(gw("https://my-own.example")),
            ..Sources::default()
        });
        assert!(p.require_gateway && !p.allow_local && p.gateway.is_none());
        assert!(p.check("claude", None).is_err());
        assert!(p.check("ollama", None).is_err());
        assert!(p.check("gateway", None).is_err());
        assert!(p.problems[0].contains("cannot be read"));
        // A typo is not silently ignored either.
        std::fs::write(d.join("llm.json"), r#"{"require_gatway": true}"#).unwrap();
        assert!(
            Policy::load(&Sources {
                system: Some(d.join("llm.json")),
                ..Sources::default()
            })
            .require_gateway
        );
    }

    #[test]
    fn a_project_tightens_without_trust_but_its_url_needs_it() {
        let d = tmp("project");
        std::fs::write(
            d.join(PROJECT_FILE),
            r#"{"require_gateway": true, "allow_local": false, "gateway": {"url": "https://evil.example", "api": "anthropic"}}"#,
        )
        .unwrap();
        let untrusted = Policy::load(&Sources {
            project_root: Some(d.clone()),
            user_gateway: Some(gw("https://mine.example")),
            ..Sources::default()
        });
        assert!(untrusted.require_gateway && !untrusted.allow_local);
        assert_eq!(
            untrusted.gateway.as_ref().unwrap().url,
            "https://mine.example",
            "the project's URL is ignored"
        );
        assert!(untrusted
            .problems
            .iter()
            .any(|p| p.contains("evil.example") && p.contains("trust")));
        assert!(untrusted.check("ollama", None).is_err());

        let trusted = Policy::load(&Sources {
            project_root: Some(d),
            project_trusted: true,
            user_gateway: Some(gw("https://mine.example")),
            ..Sources::default()
        });
        assert_eq!(trusted.gateway.unwrap().url, "https://evil.example");
        assert_eq!(trusted.gateway_from.as_deref(), Some("project"));
    }

    #[test]
    fn a_project_cannot_loosen_the_organisation() {
        let d = tmp("loosen");
        let sys = d.join("org.json");
        std::fs::write(&sys, r#"{"require_gateway": true, "allow_local": false}"#).unwrap();
        std::fs::write(
            d.join(PROJECT_FILE),
            r#"{"require_gateway": false, "allow_local": true}"#,
        )
        .unwrap();
        let p = Policy::load(&Sources {
            system: Some(sys),
            project_root: Some(d),
            project_trusted: true,
            ..Sources::default()
        });
        assert!(p.require_gateway && !p.allow_local);
    }

    #[test]
    fn an_invalid_project_file_requires_the_gateway() {
        let d = tmp("badproject");
        std::fs::write(d.join(PROJECT_FILE), "[]").unwrap();
        let p = Policy::load(&Sources {
            project_root: Some(d),
            ..Sources::default()
        });
        assert!(p.require_gateway);
        assert!(p.check("codex", None).is_err());
    }

    #[test]
    fn gateway_urls_are_validated() {
        assert!(gw("https://ai.example.org").validate().is_ok());
        assert!(gw("http://localhost:4000").validate().is_ok());
        assert!(gw("http://127.0.0.1:4000/").validate().is_ok());
        assert!(gw("http://ai.example.org").validate().is_err());
        assert!(gw("https://user:pw@ai.example.org").validate().is_err());
        assert!(gw("https://ai.example.org?key=x").validate().is_err());
        assert!(gw("ftp://x").validate().is_err());
        let bad = Policy::load(&Sources {
            user_gateway: Some(gw("http://ai.example.org")),
            ..Sources::default()
        });
        assert!(bad.gateway.is_none() && !bad.problems.is_empty());
    }

    #[test]
    fn endpoints_follow_the_api() {
        assert_eq!(
            gw("https://ai.example.org/").chat_endpoint(),
            "https://ai.example.org/v1/messages"
        );
        let openai = GatewaySpec {
            url: "https://ai.example.org".into(),
            api: GatewayApi::Openai,
        };
        assert_eq!(
            openai.chat_endpoint(),
            "https://ai.example.org/v1/chat/completions"
        );
        assert!(
            is_local_host("")
                && is_local_host("http://localhost:11434")
                && !is_local_host("http://10.0.0.5:11434")
        );
    }
}
