//! Secrets masked before anything is written to disk (RF-T05, docs/v2/RF-DELONIX-PLANO.md F1.3):
//! the session log (the conversation the agent resumes from) and the audit log keep the prompt
//! and the tool calls, but keys, tokens and the secret values of the project's `.env` files
//! appear as `••••`.
//!
//! Conservative on purpose: the session log is also what a resumed session sends back to the
//! model, so masking an ordinary word (a `.env` value such as `postgres`) would put `••••` in
//! the code the model sees. Only what looks like a secret is masked: well-known key formats,
//! values of secret-named variables, and long values that mix letters and digits.

use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

pub const MASK: &str = "••••";

/// Patterns of well-known secrets. A pattern with a capture group keeps everything outside the
/// group (e.g. the `Authorization: Bearer ` prefix) and masks the group.
fn patterns() -> &'static [Regex] {
    static P: OnceLock<Vec<Regex>> = OnceLock::new();
    P.get_or_init(|| {
        [
            // private keys (PEM)
            r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
            // Anthropic, OpenAI and similar `sk-` keys
            r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{16,}",
            // GitHub tokens
            r"\bgh[pousr]_[A-Za-z0-9]{20,}",
            r"\bgithub_pat_[A-Za-z0-9_]{20,}",
            // AWS access key id, Slack, Google API key
            r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b",
            r"\bxox[abprs]-[A-Za-z0-9\-]{10,}",
            r"\bAIza[0-9A-Za-z_\-]{35}",
            // JSON Web Tokens
            r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}",
            // Authorization headers
            r"(?i)\bbearer\s+([A-Za-z0-9._~+/\-]{12,}=*)",
            // credentials inside a URL: scheme://user:PASSWORD@host
            r"(?i)\b[a-z][a-z0-9+.\-]*://[^\s:/@]+:([^\s@/]{3,})@",
            // key = value / key: value with a secret-like name
            r#"(?i)\b[A-Za-z0-9_]*(?:api[_\-]?key|secret|token|passw(?:or)?d|pwd|private[_\-]?key|access[_\-]?key|client[_\-]?secret)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?([^\s"',;()\[\]{}<>]*[0-9][^\s"',;()\[\]{}<>]*)"#,
        ]
        .iter()
        .map(|p| Regex::new(p).expect("redact pattern"))
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
        let mut out = s.to_string();
        for v in &self.values {
            if out.contains(v.as_str()) {
                out = out.replace(v.as_str(), MASK);
            }
        }
        for re in patterns() {
            out = re
                .replace_all(&out, |c: &regex::Captures| match c.get(1) {
                    // a short captured value is not a secret (and code like `token = f(x)` never matches:
                    // the value needs a digit and no brackets)
                    Some(g) if g.as_str().chars().count() < 6 => c[0].to_string(),
                    Some(g) => {
                        let m = c.get(0).unwrap();
                        let (a, b) = (g.start() - m.start(), g.end() - m.start());
                        format!("{}{MASK}{}", &m.as_str()[..a], &m.as_str()[b..])
                    }
                    None => MASK.to_string(),
                })
                .into_owned();
        }
        out
    }

    /// Masks every string inside a JSON value, in place.
    pub fn mask_json(&self, v: &mut Value) {
        match v {
            Value::String(s) => {
                let m = self.mask(s);
                if m != *s {
                    *s = m;
                }
            }
            Value::Array(a) => a.iter_mut().for_each(|x| self.mask_json(x)),
            Value::Object(o) => o.values_mut().for_each(|x| self.mask_json(x)),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn ordinary_code_is_untouched() {
        let r = Redactor::new();
        let code = "fn token_count(s: &str) -> usize { s.len() }\nlet key = map.get(\"k\");\n\
                    let token = compute_token(x);\nlet password = user.password;\nsecret: &str,";
        assert_eq!(r.mask(code), code);
    }
}
