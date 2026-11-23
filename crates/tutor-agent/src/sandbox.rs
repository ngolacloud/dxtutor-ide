//! Contenção de caminhos: as ferramentas nunca saem da raiz do projecto.
//!
//! Duas camadas: [`resolve`] recusa lexicalmente (`..` que escapa, absolutos fora da
//! raiz) e [`ensure_within`] resolve symlinks no ancestral existente mais profundo —
//! um link `docs -> ~/.ssh` num repositório clonado não leva uma escrita para fora.
//! O `src-tauri` usa a mesma implementação (`workspace::ensure_within` delega aqui).

use std::fs;
use std::path::{Component, Path, PathBuf};

/// Recusa `p` (já lexicalmente dentro de `root`) quando a parte que existe no disco
/// resolve — por symlinks — para fora de `root`. Caminhos ainda por criar são aceites;
/// um symlink pendurado é recusado porque o destino não se pode verificar.
pub fn ensure_within(root: &Path, p: &Path) -> Result<(), String> {
    let root_c = fs::canonicalize(root).map_err(|e| format!("workspace root: {e}"))?;
    let mut cur: PathBuf = p.to_path_buf();
    while fs::symlink_metadata(&cur).is_err() {
        if !cur.pop() {
            return Err("path escapes the workspace".into());
        }
    }
    let real = fs::canonicalize(&cur).map_err(|_| {
        format!(
            "path escapes the workspace (unresolvable link): {}",
            cur.display()
        )
    })?;
    if real.starts_with(&root_c) {
        Ok(())
    } else {
        Err(format!(
            "path escapes the workspace through a symlink: {}",
            p.display()
        ))
    }
}

/// Resolve o caminho que o modelo deu (relativo à raiz, ou absoluto **dentro** dela)
/// para um caminho absoluto contido na raiz.
pub fn resolve(root: &Path, given: &str) -> Result<PathBuf, String> {
    let given = given.trim();
    if given.is_empty() {
        return Err("caminho vazio".into());
    }
    let root_abs = fs::canonicalize(root).map_err(|e| format!("raiz do projecto: {e}"))?;
    let g = Path::new(given);
    let candidate = if g.is_absolute() {
        g.to_path_buf()
    } else {
        root_abs.join(g)
    };
    // normalização lexical (sem tocar no disco): `.`/`..`
    let mut out = PathBuf::new();
    for c in candidate.components() {
        match c {
            Component::ParentDir => {
                if !out.pop() {
                    return Err(format!("o caminho sai do projecto: {given}"));
                }
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    if !out.starts_with(&root_abs) {
        return Err(format!("o caminho sai do projecto: {given}"));
    }
    ensure_within(&root_abs, &out)?;
    Ok(out)
}

/// O caminho relativo à raiz, com `/`, para mostrar ao modelo.
pub fn rel(root: &Path, p: &Path) -> String {
    let root_abs = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let r = p
        .strip_prefix(&root_abs)
        .or_else(|_| p.strip_prefix(root))
        .unwrap_or(p);
    r.components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_and_absolute_inside_and_refuses_escapes() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        fs::create_dir_all(root.join("src")).unwrap();
        let canon = fs::canonicalize(root).unwrap();
        assert_eq!(resolve(root, "src/a.rs").unwrap(), canon.join("src/a.rs"));
        assert_eq!(resolve(root, "./src/../b.rs").unwrap(), canon.join("b.rs"));
        assert_eq!(
            resolve(root, canon.join("c.rs").to_str().unwrap()).unwrap(),
            canon.join("c.rs")
        );
        assert!(resolve(root, "../fora").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "src/../../x").is_err());
        assert!(resolve(root, "  ").is_err());
        assert_eq!(rel(root, &canon.join("src/a.rs")), "src/a.rs");
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_out_of_the_root_are_refused() {
        let base = tempfile::tempdir().unwrap();
        let (root, out) = (base.path().join("ws"), base.path().join("outside"));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(&out).unwrap();
        std::os::unix::fs::symlink(&out, root.join("docs")).unwrap();
        std::os::unix::fs::symlink(root.join("src"), root.join("alias")).unwrap();
        std::os::unix::fs::symlink(base.path().join("nope"), root.join("dangling")).unwrap();
        assert!(resolve(&root, "docs/authorized_keys").is_err());
        assert!(resolve(&root, "dangling").is_err());
        assert!(resolve(&root, "alias/ok.rs").is_ok());
        assert!(resolve(&root, "new/dir/a.rs").is_ok());
    }
}
