//! Secrets masked before anything is written to disk (RF-T05, docs/v2/RF-DELONIX-PLANO.md F1.3)
//! and — r23 F4 (X02) — before any request leaves for a model (`guard_json`/`guard_body`, with the
//! values the app learned from the open projects' `.env` files):
//! the session log (the conversation the agent resumes from) and the audit log keep the prompt
//! and the tool calls, but keys, tokens and the secret values of the project's `.env` files
//! appear as `••••`.
//!
//! Conservative on purpose: the session log is also what a resumed session sends back to the
//! model, so masking an ordinary word (a `.env` value such as `postgres`) would put `••••` in
//! the code the model sees. Only what looks like a secret is masked: well-known key formats,
//! values of secret-named variables, and long values that mix letters and digits.

use std::path::Path;
use std::sync::{OnceLock, RwLock};

use regex::Regex;
use serde_json::Value;

pub const MASK: &str = "••••";

/// One rule: its name (what the secret scan reports), the pattern, and the shortest captured value
/// it masks. A rule with a capture group keeps everything outside the group (e.g. the
/// `Authorization: Bearer ` prefix) and masks the group.
pub struct Rule {
    pub name: &'static str,
    pub re: Regex,
    min: usize,
}

/// The well-known secrets.
pub fn rules() -> &'static [Rule] {
    static P: OnceLock<Vec<Rule>> = OnceLock::new();
    P.get_or_init(|| {
        [
            // private keys (PEM)
            ("private-key", r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----", 0),
            // Anthropic, OpenAI and similar `sk-` keys
            ("api-key", r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{16,}", 0),
            // GitHub tokens
            ("github-token", r"\bgh[pousr]_[A-Za-z0-9]{20,}", 0),
            ("github-token", r"\bgithub_pat_[A-Za-z0-9_]{20,}", 0),
            // AWS access key id, Slack, Google API key
            ("aws-access-key", r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b", 0),
            ("slack-token", r"\bxox[abprs]-[A-Za-z0-9\-]{10,}", 0),
            ("google-api-key", r"\bAIza[0-9A-Za-z_\-]{35}", 0),
            // JSON Web Tokens
            ("jwt", r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}", 0),
            // Authorization headers
            ("bearer-token", r"(?i)\bbearer\s+([A-Za-z0-9._~+/\-]{12,}=*)", 6),
            // credentials inside a URL: scheme://user:PASSWORD@host — any length (`postgres://u:p@h`),
            // but not a placeholder (`${DB_PASS}`, `$PASS`, `<password>`, `****`)
            ("url-credentials", r"(?i)\b[a-z][a-z0-9+.\-]*://[^\s:/@]+:([^\s@/$<*{][^\s@/]*)@", 1),
            // key = value / key: value with a secret-like name
            ("secret-assignment", r#"(?i)\b[A-Za-z0-9_]*(?:api[_\-]?key|secret|token|passw(?:or)?d|pwd|private[_\-]?key|access[_\-]?key|client[_\-]?secret)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([^\s"',;()\[\]{}<>]*[0-9][^\s"',;()\[\]{}<>]*)"#, 6),
        ]
        .iter()
        .map(|(name, p, min)| Rule { name, re: Regex::new(p).expect("redact pattern"), min: *min })
        .collect()
    })
}

fn secret_name() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(r"(?i)(key|secret|token|pass|pwd|credential|private|auth|dsn|cookie|session)")
            .expect("secret name")
    })
}

/// Is this `.env` value worth masking? Secret-named variables (4+ chars), or long values that
/// mix letters and digits (a random-looking string). Plain words and numbers are left alone.
fn env_value_is_secret(name: &str, value: &str) -> bool {
    let v = value.trim();
    if v.len() < 4 || v.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }
    if matches!(
        v.to_ascii_lowercase().as_str(),
        "true" | "false" | "null" | "none" | "localhost"
    ) {
        return false;
    }
    if secret_name().is_match(name) {
        return true;
    }
    let letters = v.chars().any(|c| c.is_ascii_alphabetic());
    let digits = v.chars().any(|c| c.is_ascii_digit());
    v.len() >= 16 && letters && digits && !v.contains(char::is_whitespace)
}

/// The secret values of one `.env` file's text.
pub fn env_secrets(text: &str) -> Vec<String> {
    let mut out = vec![];
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        let l = l.strip_prefix("export ").unwrap_or(l);
        let Some((name, value)) = l.split_once('=') else {
            continue;
        };
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|v| v.strip_suffix('"'))
            .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
            .unwrap_or(value);
        if env_value_is_secret(name.trim(), value) {
            out.push(value.to_string());
        }
    }
    out
}

/// Masks the secrets of one project.
#[derive(Debug, Clone, Default)]
pub struct Redactor {
    /// Exact values to mask (the project's `.env` secrets), longest first.
    values: Vec<String>,
}

impl Redactor {
    /// Only the well-known patterns.
    pub fn new() -> Self {
        Redactor::default()
    }

    /// The patterns plus the secret values of `root/.env` and `root/.env.*`.
    pub fn for_root(root: &Path) -> Self {
        let mut r = Redactor::new();
        if let Ok(rd) = std::fs::read_dir(root) {
            for e in rd.filter_map(Result::ok) {
                let name = e.file_name().to_string_lossy().to_string();
                if name == ".env" || name.starts_with(".env.") {
                    if let Ok(text) = std::fs::read_to_string(e.path()) {
                        r.add_values(env_secrets(&text));
                    }
                }
            }
        }
        r
    }

    pub fn add_values(&mut self, values: impl IntoIterator<Item = String>) {
        for v in values {
            if !v.is_empty() && !self.values.contains(&v) {
                self.values.push(v);
            }
        }
        self.values.sort_by_key(|v| std::cmp::Reverse(v.len()));
    }

    pub fn mask(&self, s: &str) -> String {
        self.mask_count(s).0
    }

    /// Masks `s` and says how many secrets went.
    pub fn mask_count(&self, s: &str) -> (String, usize) {
        let mut out = s.to_string();
        let mut n = 0;
        for v in &self.values {
            let k = out.matches(v.as_str()).count();
            if k > 0 {
                n += k;
                out = out.replace(v.as_str(), MASK);
            }
        }
        for r in rules() {
            out =
                r.re.replace_all(&out, |c: &regex::Captures| match c.get(1) {
                    // a short captured value is not a secret (and code like `token = f(x)` never matches:
                    // the value needs a digit and no brackets)
                    Some(g) if g.as_str().chars().count() < r.min || g.as_str() == MASK => {
                        c[0].to_string()
                    }
                    Some(g) => {
                        n += 1;
                        let m = c.get(0).unwrap();
                        let (a, b) = (g.start() - m.start(), g.end() - m.start());
                        format!("{}{MASK}{}", &m.as_str()[..a], &m.as_str()[b..])
                    }
                    None => {
                        n += 1;
                        MASK.to_string()
                    }
                })
                .into_owned();
        }
        (out, n)
    }

    /// The rules a line breaks (the secret scan's findings), and whether a known value is in it.
    pub fn rules_in(&self, s: &str) -> Vec<&'static str> {
        let mut hit: Vec<&'static str> = vec![];
        if self.values.iter().any(|v| s.contains(v.as_str())) {
            hit.push("known-secret");
        }
        for r in rules() {
            let found = r.re.captures_iter(s).any(|c| match c.get(1) {
                Some(g) => g.as_str().chars().count() >= r.min.max(1),
                None => true,
            });
            if found && !hit.contains(&r.name) {
                hit.push(r.name);
            }
        }
        hit
    }

    /// Masks every string inside a JSON value, in place.
    pub fn mask_json(&self, v: &mut Value) {
        self.mask_json_count(v);
    }

    /// Masks every string inside a JSON value, in place; how many secrets went.
    pub fn mask_json_count(&self, v: &mut Value) -> usize {
        match v {
            Value::String(s) => {
                let (m, n) = self.mask_count(s);
                if n > 0 {
                    *s = m;
                }
                n
            }
            Value::Array(a) => a.iter_mut().map(|x| self.mask_json_count(x)).sum(),
            // an image's bytes (base64) are never text to mask — changing them breaks the image: the source of
            // an image block (`{type: base64, data}`), a data URL (`image_url.url`) and Ollama's `images`
            Value::Object(o) => {
                let base64_source = o.get("type").and_then(Value::as_str) == Some("base64");
                o.iter_mut()
                    .map(|(k, x)| match (k.as_str(), &*x) {
                        ("data", Value::String(_)) if base64_source => 0,
                        ("url", Value::String(u)) if u.starts_with("data:image/") => 0,
                        ("images", Value::Array(_)) => 0,
                        _ => self.mask_json_count(x),
                    })
                    .sum()
            }
            _ => 0,
        }
    }
}

/* ───── r23 F4 (X02): every outgoing LLM request is filtered ───── */

fn shared() -> &'static RwLock<Redactor> {
    static S: OnceLock<RwLock<Redactor>> = OnceLock::new();
    S.get_or_init(|| RwLock::new(Redactor::new()))
}

/// What the app learns to mask in every request: the secret values of a project's `.env` files
/// (called when a folder opens) — besides the well-known patterns.
pub fn learn_root(root: &Path) {
    let r = Redactor::for_root(root);
    learn_values(r.values);
}

pub fn learn_values(values: impl IntoIterator<Item = String>) {
    if let Ok(mut s) = shared().write() {
        s.add_values(values);
    }
}

/// The redactor every request goes through (patterns + learned values).
pub fn current() -> Redactor {
    shared().read().map(|r| r.clone()).unwrap_or_default()
}

type OnRedact = Box<dyn Fn(&str, usize) + Send + Sync>;

fn hook() -> &'static RwLock<Option<OnRedact>> {
    static H: OnceLock<RwLock<Option<OnRedact>>> = OnceLock::new();
    H.get_or_init(|| RwLock::new(None))
}

/// Told how many secrets a request lost, and from where (`codev`, `assistant`…) — the app shows the
/// count and records it in the audit log.
pub fn on_redact(f: impl Fn(&str, usize) + Send + Sync + 'static) {
    if let Ok(mut h) = hook().write() {
        *h = Some(Box::new(f));
    }
}

static TOTAL: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// How many secrets every request so far has lost.
pub fn total() -> usize {
    TOTAL.load(std::sync::atomic::Ordering::SeqCst)
}

fn report(origin: &str, n: usize) {
    if n == 0 {
        return;
    }
    TOTAL.fetch_add(n, std::sync::atomic::Ordering::SeqCst);
    if let Ok(h) = hook().read() {
        if let Some(f) = h.as_ref() {
            f(origin, n);
        }
    }
}

/// Filters an outgoing request body (every string in it) — the last step before it is sent.
pub fn guard_json(origin: &str, body: &mut Value) -> usize {
    let n = current().mask_json_count(body);
    report(origin, n);
    n
}

/// Filters an outgoing request body already serialized as JSON text.
pub fn guard_body(origin: &str, body: &str) -> String {
    match serde_json::from_str::<Value>(body) {
        Ok(mut v) => {
            if guard_json(origin, &mut v) > 0 {
                v.to_string()
            } else {
                body.to_string()
            }
        }
        Err(_) => {
            let (m, n) = current().mask_count(body);
            report(origin, n);
            m
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bytes_of_an_image_are_never_masked() {
        let r = Redactor::new();
        let key = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";
        let mut v = serde_json::json!({"messages": [{"content": [
            {"type": "text", "text": format!("my key {key}")},
            {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": key}},
            {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{key}")}},
        ], "images": [key]}]});
        assert_eq!(r.mask_json_count(&mut v), 1, "only the text");
        let c = &v["messages"][0]["content"];
        assert!(!c[0]["text"].as_str().unwrap().contains(key));
        assert_eq!(c[1]["source"]["data"], key);
        assert!(c[2]["image_url"]["url"].as_str().unwrap().ends_with(key));
        assert_eq!(v["messages"][0]["images"][0], key);
    }

    #[test]
    fn well_known_keys_are_masked() {
        let r = Redactor::new();
        for s in [
            "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuv",
            "token ghp_0123456789abcdefghijABCDEFGHIJ",
            "AKIAABCDEFGHIJKLMNOP",
            "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
        ] {
            let m = r.mask(s);
            assert!(m.contains(MASK), "{s} → {m}");
            assert!(!m.contains("abcdefghij") && !m.contains("MIIabc"), "{m}");
        }
    }

    #[test]
    fn prefixes_are_kept_and_only_the_secret_goes() {
        let r = Redactor::new();
        assert_eq!(
            r.mask("curl -H 'Authorization: Bearer abcdef1234567890xyz' https://x"),
            "curl -H 'Authorization: Bearer ••••' https://x"
        );
        assert_eq!(
            r.mask("DATABASE_URL=postgres://app:s3cr3tpass@db:5432/app"),
            "DATABASE_URL=postgres://app:••••@db:5432/app"
        );
        assert_eq!(r.mask("password = \"hunter22!\""), "password = \"••••\"");
    }

    #[test]
    fn env_values_only_when_they_look_secret() {
        let text = "# db\nDB_HOST=localhost\nDB_NAME=postgres\nDB_PASSWORD=s3cr3t\nPORT=5432\n\
                    export STRIPE_KEY='rk_live_abc123'\nBUILD_ID=a1b2c3d4e5f6a7b8c9d0\nDEBUG=true\n";
        let v = env_secrets(text);
        assert_eq!(v, vec!["s3cr3t", "rk_live_abc123", "a1b2c3d4e5f6a7b8c9d0"]);
        let mut r = Redactor::new();
        r.add_values(v);
        // the ordinary values stay readable (the model may see this text again on resume)
        assert_eq!(
            r.mask("connect postgres at localhost:5432 with s3cr3t"),
            "connect postgres at localhost:5432 with ••••"
        );
    }

    #[test]
    fn for_root_reads_env_files_and_masks_json() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join(".env"), "API_TOKEN=tok_9f8e7d6c\n").unwrap();
        std::fs::write(d.path().join(".env.local"), "SECRET=abcd1234\n").unwrap();
        let r = Redactor::for_root(d.path());
        let mut v = serde_json::json!({"command": "echo tok_9f8e7d6c abcd1234", "n": 3, "a": ["tok_9f8e7d6c"]});
        r.mask_json(&mut v);
        assert_eq!(
            v,
            serde_json::json!({"command": "echo •••• ••••", "n": 3, "a": ["••••"]})
        );
    }

    /// r23 F4 acceptance: a request with a known secret (and a URL's credentials) arrives redacted,
    /// and the count is reported.
    #[test]
    fn an_llm_request_arrives_redacted() {
        let seen = std::sync::Arc::new(std::sync::Mutex::new(vec![]));
        let s2 = seen.clone();
        on_redact(move |o, n| s2.lock().unwrap().push((o.to_string(), n)));
        learn_values(["hunter2-prod-9".to_string()]);
        let mut body = serde_json::json!({"messages": [{"role": "user", "content": "deploy with hunter2-prod-9 to postgres://u:p@h/app"}]});
        assert_eq!(guard_json("codev", &mut body), 2);
        let c = body["messages"][0]["content"].as_str().unwrap();
        assert_eq!(c, "deploy with •••• to postgres://u:••••@h/app");
        assert!(seen.lock().unwrap().contains(&("codev".to_string(), 2)));
        let text = guard_body("assistant", r#"{"prompt":"pw hunter2-prod-9"}"#);
        assert!(!text.contains("hunter2"), "{text}");
        assert!(total() >= 3);
        // a placeholder is not a secret
        assert_eq!(
            Redactor::new().mask("postgres://app:${DB_PASS}@db/app"),
            "postgres://app:${DB_PASS}@db/app"
        );
        assert_eq!(
            Redactor::new().rules_in("x = postgres://u:p@h"),
            vec!["url-credentials"]
        );
    }

    #[test]
    fn ordinary_code_is_untouched() {
        let r = Redactor::new();
        let code = "fn token_count(s: &str) -> usize { s.len() }\nlet key = map.get(\"k\");\n\
                    let token = compute_token(x);\nlet password = user.password;\nsecret: &str,";
        assert_eq!(r.mask(code), code);
    }
}
