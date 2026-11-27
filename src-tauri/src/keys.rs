//! API keys. r23 F4c (docs/v2/AUDIT-r23.md §5 Q8/Q15e): they live in the OS keychain (account
//! `llm:<provider>`, `tutor_platform::keychain`); a key still in the app's `keys.json` moves there the
//! first time it is read (and leaves the file). Without a keychain (no Secret Service running) the
//! key stays in `keys.json` (0600), as before.
//! Resolution order per provider: the keychain → `keys.json` → the legacy
//! `~/.config/dxtutor/providers.json` that the pre-v7 UI still writes (so a key already configured
//! there keeps working without re-entry) → the matching environment variable (ANTHROPIC_API_KEY,
//! OPENAI_API_KEY, GEMINI_API_KEY). No command returns a key to the UI.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use tutor_platform::keychain::{OsStore, Store};

fn account(provider: &str) -> String {
    format!("llm:{provider}")
}

fn os_store() -> &'static OsStore {
    static S: std::sync::OnceLock<OsStore> = std::sync::OnceLock::new();
    S.get_or_init(OsStore::new)
}

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
    save_in(os_store(), dir, provider, key)
}

/// Saves (or, empty, removes) a key: in the keychain, and never in `keys.json` again; without a
/// keychain, in `keys.json`.
pub fn save_in(store: &dyn Store, dir: &Path, provider: &str, key: &str) -> Result<(), String> {
    let key = key.trim();
    let kept = if key.is_empty() {
        store.delete(&account(provider))
    } else {
        store.set(&account(provider), key)
    };
    match kept {
        Ok(()) => {
            if load(dir).contains_key(provider) {
                save_file(dir, provider, "")?;
            }
            Ok(())
        }
        Err(_) => save_file(dir, provider, key),
    }
}

fn save_file(dir: &Path, provider: &str, key: &str) -> Result<(), String> {
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
    resolve_in(os_store(), dir, provider)
}

/// The keychain first; a key found in `keys.json` moves to the keychain (and leaves the file).
pub fn resolve_in(store: &dyn Store, dir: &Path, provider: &str) -> Option<String> {
    if let Ok(Some(k)) = store.get(&account(provider)) {
        if !k.is_empty() {
            return Some(k);
        }
    }
    let from_file = load(dir).get(provider).cloned().filter(|k| !k.is_empty());
    if let Some(k) = &from_file {
        if store.set(&account(provider), k).is_ok() {
            let _ = save_file(dir, provider, "");
        }
    }
    from_file
        .or_else(|| legacy_key(provider))
        .or_else(|| crate::llm::env_key(provider).and_then(|v| std::env::var(v).ok()))
        .filter(|k| !k.is_empty())
}

/// The matching key from the pre-v7 `~/.config/dxtutor/providers.json`, which the old
/// (still-shipped) UI writes. Reuses `tutor_llm::chat::load_config` so the two UIs read
/// one source of truth; Ollama needs no key, so only the three hosted providers map.
fn legacy_key(provider: &str) -> Option<String> {
    // only the hosted providers have a field there: reading it costs a file and three keychain reads
    if !matches!(provider, "claude" | "codex" | "gemini") {
        return None;
    }
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
        let store = tutor_platform::keychain::MemStore::default();
        save_in(&store, &d, "claude", "sk-from-keychain").unwrap();
        assert_eq!(
            resolve_in(&store, &d, "claude").as_deref(),
            Some("sk-from-keychain")
        );
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

    /// r23 F4c: a key saved goes to the keychain, never to `keys.json`; one already in `keys.json`
    /// moves to the keychain the first time it is read, and leaves the file.
    #[test]
    fn keys_live_in_the_keychain_and_move_there_from_keys_json() {
        let d = std::env::temp_dir().join(format!("dxtutor-keychain-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let store = tutor_platform::keychain::MemStore::default();
        save_in(&store, &d, "claude", " sk-ant-new ").unwrap();
        assert_eq!(
            store.get("llm:claude").unwrap().as_deref(),
            Some("sk-ant-new")
        );
        assert!(!file(&d).exists() || !load(&d).contains_key("claude"));
        save_file(&d, "codex", "sk-old-in-file").unwrap();
        assert_eq!(
            resolve_in(&store, &d, "codex").as_deref(),
            Some("sk-old-in-file")
        );
        assert_eq!(
            store.get("llm:codex").unwrap().as_deref(),
            Some("sk-old-in-file")
        );
        assert!(
            !load(&d).contains_key("codex"),
            "the key stayed in keys.json"
        );
        save_in(&store, &d, "codex", "").unwrap();
        assert_eq!(store.get("llm:codex").unwrap(), None);
        let _ = fs::remove_dir_all(&d);
    }

    /// Without a keychain the key stays in `keys.json` (0600), as before F4c.
    #[test]
    fn saves_removes_and_resolves() {
        struct NoKeychain;
        impl Store for NoKeychain {
            fn get(&self, _: &str) -> Result<Option<String>, String> {
                Err("no keychain".into())
            }
            fn set(&self, _: &str, _: &str) -> Result<(), String> {
                Err("no keychain".into())
            }
            fn delete(&self, _: &str) -> Result<(), String> {
                Err("no keychain".into())
            }
        }
        let d = std::env::temp_dir().join(format!("dxtutor-keys-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        save_in(&NoKeychain, &d, "codex", " sk-test ").unwrap();
        assert_eq!(
            resolve_in(&NoKeychain, &d, "codex").as_deref(),
            Some("sk-test")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(file(&d)).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        save_in(&NoKeychain, &d, "codex", "").unwrap();
        assert!(load(&d).get("codex").is_none());
    }
}
