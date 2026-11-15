//! API keys, stored in the app's config folder (keys.json, readable only by the user on Unix).
//! Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY) are used when no key is saved.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

pub fn file(dir: &Path) -> PathBuf {
    dir.join("keys.json")
}

pub fn load(dir: &Path) -> HashMap<String, String> {
    fs::read_to_string(file(dir)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
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
    fs::write(&p, serde_json::to_string_pretty(&all).unwrap()).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

pub fn resolve(dir: &Path, provider: &str) -> Option<String> {
    load(dir).get(provider).cloned().or_else(|| crate::llm::env_key(provider).and_then(|v| std::env::var(v).ok())).filter(|k| !k.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saves_removes_and_resolves() {
        let d = std::env::temp_dir().join(format!("dxtutor-keys-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        save(&d, "codex", " sk-test ").unwrap();
        assert_eq!(resolve(&d, "codex").as_deref(), Some("sk-test"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(file(&d)).unwrap().permissions().mode() & 0o777, 0o600);
        }
        save(&d, "codex", "").unwrap();
        assert!(load(&d).get("codex").is_none());
    }
}
