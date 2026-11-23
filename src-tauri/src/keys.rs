//! API keys, stored in the app's config folder (keys.json, readable only by the user on Unix).
//! Resolution order per provider: the v7 `keys.json` → the legacy `~/.config/dxtutor/providers.json`
//! that the pre-v7 UI still writes (so a key already configured there keeps working without
//! re-entry) → the matching environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY).

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn file(dir: &Path) -> PathBuf {
    dir.join("keys.json")
}

pub fn load(dir: &Path) -> HashMap<String, String> {
    fs::read_to_string(file(dir))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, provider: &str, key: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut all = load(dir);
    if key.trim().is_empty() {
        all.remove(provider);
    } else {
        all.insert(provider.to_string(), key.trim().to_string());
    }
    let p = file(dir);
    let json = serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?;
    // 0600 desde a criação + rename atómico: a chave nunca fica legível por outros.
    tutor_llm::chat::write_private(&p, json.as_bytes()).map_err(|e| e.to_string())
}

pub fn resolve(dir: &Path, provider: &str) -> Option<String> {
    load(dir)
        .get(provider)
        .cloned()
        .or_else(|| legacy_key(provider))
        .or_else(|| crate::llm::env_key(provider).and_then(|v| std::env::var(v).ok()))
        .filter(|k| !k.is_empty())
}

/// The matching key from the pre-v7 `~/.config/dxtutor/providers.json`, which the old
/// (still-shipped) UI writes. Reuses `tutor_llm::chat::load_config` so the two UIs read
/// one source of truth; Ollama needs no key, so only the three hosted providers map.
fn legacy_key(provider: &str) -> Option<String> {
    legacy_key_from(&tutor_llm::chat::load_config(), provider)
}

/// Pure core of [`legacy_key`]: the provider→field mapping over an already-loaded config,
/// so the mapping is testable without touching `$HOME`.
fn legacy_key_from(cfg: &tutor_llm::chat::ProvidersConfig, provider: &str) -> Option<String> {
    let raw = match provider {
        "claude" => &cfg.anthropic_key,
        "codex" => &cfg.openai_key,
        "gemini" => &cfg.gemini_key,
        _ => return None,
    };
    let k = raw.trim();
    (!k.is_empty()).then(|| k.to_string())
}

/// The Anthropic organisation/workspace id from the legacy config (or `ANTHROPIC_WORKSPACE_ID`),
/// required as the `anthropic-workspace-id` header for org-scoped (`sk-ant-usr-…`) keys.
pub fn anthropic_workspace_id() -> Option<String> {
    let ws = tutor_llm::chat::load_config().anthropic_workspace_id;
    let ws = ws.trim();
    if !ws.is_empty() {
        return Some(ws.to_string());
    }
    std::env::var("ANTHROPIC_WORKSPACE_ID")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_config_maps_providers_to_keys() {
        let mut cfg = tutor_llm::chat::ProvidersConfig::default();
        cfg.anthropic_key = "sk-ant-usr-xyz".into();
        cfg.openai_key = "  ".into(); // whitespace-only counts as absent
        cfg.gemini_key = "gm-123".into();
        assert_eq!(
            legacy_key_from(&cfg, "claude").as_deref(),
            Some("sk-ant-usr-xyz")
        );
        assert_eq!(legacy_key_from(&cfg, "codex"), None);
        assert_eq!(legacy_key_from(&cfg, "gemini").as_deref(), Some("gm-123"));
        // Ollama needs no key: never mapped.
        assert_eq!(legacy_key_from(&cfg, "ollama"), None);
    }

    #[test]
    fn keys_json_takes_precedence_over_legacy() {
        // A key saved via the v7 keys.json short-circuits before the legacy fallback,
        // so the v7 UI can always override what the old config held.
        let d = std::env::temp_dir().join(format!("dxtutor-prec-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        save(&d, "claude", "sk-from-keys-json").unwrap();
        assert_eq!(resolve(&d, "claude").as_deref(), Some("sk-from-keys-json"));
        let _ = fs::remove_dir_all(&d);
    }

    /// Live proof (opt-in): with NO keys.json in the v7 config dir and NO ANTHROPIC_API_KEY,
    /// `resolve("claude")` must still find the key from the legacy ~/.config/dxtutor/providers.json.
    /// Ignored by default so CI (which has neither file nor key) stays green; run locally with
    /// `cargo test --bins -- --ignored legacy_providers_json_resolves_live`.
    #[test]
    #[ignore = "requires the owner's populated ~/.config/dxtutor/providers.json"]
    fn legacy_providers_json_resolves_live() {
        std::env::remove_var("ANTHROPIC_API_KEY");
        let empty_cfg_dir =
            std::env::temp_dir().join(format!("dxtutor-nokeys-{}", std::process::id()));
        let _ = fs::remove_dir_all(&empty_cfg_dir); // ensure no keys.json here
        let got = resolve(&empty_cfg_dir, "claude");
        assert!(
            got.is_some(),
            "claude key should come from the legacy providers.json"
        );
        assert!(
            got.as_deref().unwrap().starts_with("sk-ant"),
            "expected an Anthropic key shape"
        );
    }

    #[test]
    fn saves_removes_and_resolves() {
        let d = std::env::temp_dir().join(format!("dxtutor-keys-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        save(&d, "codex", " sk-test ").unwrap();
        assert_eq!(resolve(&d, "codex").as_deref(), Some("sk-test"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(file(&d)).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        save(&d, "codex", "").unwrap();
        assert!(load(&d).get("codex").is_none());
    }
}
