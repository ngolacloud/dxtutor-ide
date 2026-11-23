//! Real folders on disk: load a project into the IDE, write and delete files.
//! Every path coming from the UI is relative and is checked to stay inside the root.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

/// Directories that are never loaded into the editor.
pub const IGNORED_DIRS: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
    ".idea",
    ".next",
    ".cache",
    ".gradle",
    ".terraform",
    "vendor",
];

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct FileEntry {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub root: String,
    pub name: String,
    pub files: Vec<FileEntry>,
    /// Files left out because they are binary, too big, or over the file limit.
    pub skipped: usize,
    pub truncated: bool,
}

/// Loads every text file under `root`, up to `max_files` files of at most `max_bytes` each.
pub fn load(root: &Path, max_files: usize, max_bytes: u64) -> io::Result<Loaded> {
    let root = root.canonicalize()?;
    if !root.is_dir() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "not a folder"));
    }
    let mut files = Vec::new();
    let mut skipped = 0usize;
    let mut truncated = false;
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let mut entries: Vec<_> = match fs::read_dir(&dir) {
            Ok(rd) => rd.filter_map(Result::ok).collect(),
            Err(_) => continue,
        };
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let ft = match e.file_type() {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ft.is_symlink() {
                skipped += 1;
                continue;
            }
            if ft.is_dir() {
                if !IGNORED_DIRS.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
            if files.len() >= max_files {
                truncated = true;
                skipped += 1;
                continue;
            }
            let len = e.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
            if len > max_bytes {
                skipped += 1;
                continue;
            }
            match fs::read(&p) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(content) if !content.contains('\0') => {
                        let rel = p.strip_prefix(&root).unwrap_or(&p);
                        files.push(FileEntry {
                            path: to_slash(rel),
                            content,
                        });
                    }
                    _ => skipped += 1,
                },
                Err(_) => skipped += 1,
            }
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "workspace".into());
    Ok(Loaded {
        root: root.to_string_lossy().to_string(),
        name,
        files,
        skipped,
        truncated,
    })
}

/// Política do caso de uso «abrir workspace»: quantos ficheiros e de que tamanho máximo o
/// editor carrega. É a *regra* (não o mecanismo) — vive no caso de uso, não no comando Tauri
/// nem no walk de disco. O `Default` é o contrato público actual (4000 ficheiros, 768 KiB cada).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LoadPolicy {
    pub max_files: usize,
    pub max_bytes: u64,
}

impl Default for LoadPolicy {
    fn default() -> Self {
        Self {
            max_files: 4000,
            max_bytes: 768 * 1024,
        }
    }
}

/// Erro tipado do caso de uso. A fronteira IPC (comando Tauri) ainda o mapeia para `String`,
/// mas o caso de uso fala em variantes — base para erros tipados ponta-a-ponta (Etapa 3).
#[derive(Debug)]
pub enum OpenError {
    /// A raiz existe mas não é uma pasta.
    NotADirectory,
    /// A raiz não existe / não é acessível (e outros erros de E/S do walk).
    Io(io::Error),
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            // Mantém a mensagem histórica do comando ("not a folder") estável na UI.
            OpenError::NotADirectory => write!(f, "not a folder"),
            OpenError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for OpenError {}

/// Caso de uso «abrir workspace para o editor» — **independente de Tauri**: recebe a raiz e a
/// política, delega o walk de disco a [`load`] (o mecanismo) e devolve um resultado tipado com
/// erro tipado. O comando `bridge::load_workspace` é apenas o adaptador fino que o invoca e
/// mapeia `OpenError` → `String` na fronteira IPC.
pub fn open_workspace(root: &Path, policy: LoadPolicy) -> Result<Loaded, OpenError> {
    load(root, policy.max_files, policy.max_bytes).map_err(|e| match e.kind() {
        io::ErrorKind::InvalidInput => OpenError::NotADirectory,
        _ => OpenError::Io(e),
    })
}

fn to_slash(p: &Path) -> String {
    p.components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// Joins a relative path to the root, refusing anything that could escape it.
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() {
        return Err("empty path".into());
    }
    let relp = Path::new(rel);
    for c in relp.components() {
        match c {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("path must stay inside the workspace: {rel}")),
        }
    }
    Ok(root.join(relp))
}

/// Refuses `p` (already lexically inside `root`) when the part of it that exists on
/// disk resolves — through symlinks — to somewhere outside `root`. Lexical checks
/// alone let a link in a cloned repo (`docs -> ~/.ssh`) carry a write out of the
/// workspace. The deepest existing ancestor is canonicalized (paths about to be
/// created are fine); a dangling symlink is refused because its target can't be checked.
pub fn ensure_within(root: &Path, p: &Path) -> Result<(), String> {
    let root_c = fs::canonicalize(root).map_err(|e| format!("workspace root: {e}"))?;
    let mut cur: PathBuf = p.to_path_buf();
    while fs::symlink_metadata(&cur).is_err() {
        if !cur.pop() {
            return Err("path escapes the workspace".into());
        }
    }
    let real = fs::canonicalize(&cur)
        .map_err(|_| format!("path escapes the workspace (unresolvable link): {}", cur.display()))?;
    if real.starts_with(&root_c) {
        Ok(())
    } else {
        Err(format!("path escapes the workspace through a symlink: {}", p.display()))
    }
}

pub fn write(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let p = safe_join(root, rel)?;
    ensure_within(root, &p)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| format!("{rel}: {e}"))
}

pub fn delete(root: &Path, rel: &str) -> Result<(), String> {
    let p = safe_join(root, rel)?;
    ensure_within(root, &p)?;
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{rel}: {e}")),
    }
}

/// Expands a leading `~` to the user's home folder.
pub fn expand_home(p: &str) -> String {
    if let Some(rest) = p.strip_prefix('~') {
        let home = std::env::var("HOME")
            .or_else(|_| std::env::var("USERPROFILE"))
            .unwrap_or_default();
        format!("{home}{rest}")
    } else {
        p.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dxtutor-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn loads_text_files_and_skips_ignored_and_binary() {
        let d = tmp("load");
        fs::create_dir_all(d.join("src")).unwrap();
        fs::create_dir_all(d.join("node_modules/x")).unwrap();
        fs::write(d.join("src/main.rs"), "fn main() {}\n").unwrap();
        fs::write(d.join("README.md"), "# hi\n").unwrap();
        fs::write(d.join("node_modules/x/a.js"), "x").unwrap();
        fs::write(d.join("logo.bin"), [0u8, 159, 146, 150]).unwrap();
        let l = load(&d, 100, 1024).unwrap();
        let paths: Vec<_> = l.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, vec!["README.md", "src/main.rs"]);
        assert_eq!(l.skipped, 1);
        assert!(!l.truncated);
    }

    #[test]
    fn respects_the_file_limit() {
        let d = tmp("limit");
        for i in 0..5 {
            fs::write(d.join(format!("f{i}.txt")), "x").unwrap();
        }
        let l = load(&d, 3, 1024).unwrap();
        assert_eq!(l.files.len(), 3);
        assert!(l.truncated);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_writes_through_symlinks_that_leave_the_root() {
        let base = std::env::temp_dir().join(format!("dxtutor-ws-link-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let (root, out) = (base.join("ws"), base.join("outside"));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(&out).unwrap();
        std::os::unix::fs::symlink(&out, root.join("docs")).unwrap();
        std::os::unix::fs::symlink(root.join("src"), root.join("alias")).unwrap();
        assert!(write(&root, "docs/authorized_keys", "x").is_err());
        assert!(!out.join("authorized_keys").exists());
        assert!(write(&root, "alias/ok.rs", "x").is_ok());
        assert!(write(&root, "new/dir/a.rs", "x").is_ok());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn refuses_paths_that_escape_the_root() {
        let root = Path::new("/tmp/ws");
        assert!(safe_join(root, "../etc/passwd").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        assert!(safe_join(root, "a/../../b").is_err());
        assert_eq!(safe_join(root, "a/b.rs").unwrap(), root.join("a/b.rs"));
    }

    #[test]
    fn writes_nested_files_and_deletes_them() {
        let d = tmp("write");
        write(&d, "deep/dir/x.txt", "hello").unwrap();
        assert_eq!(
            fs::read_to_string(d.join("deep/dir/x.txt")).unwrap(),
            "hello"
        );
        delete(&d, "deep/dir/x.txt").unwrap();
        assert!(!d.join("deep/dir/x.txt").exists());
        delete(&d, "deep/dir/x.txt").unwrap();
    }

    #[test]
    fn default_policy_is_the_public_contract() {
        let p = LoadPolicy::default();
        assert_eq!(p.max_files, 4000);
        assert_eq!(p.max_bytes, 768 * 1024);
    }

    #[test]
    fn open_workspace_applies_the_policy_limits() {
        let d = tmp("usecase-policy");
        for i in 0..5 {
            fs::write(d.join(format!("f{i}.txt")), "x").unwrap();
        }
        let policy = LoadPolicy {
            max_files: 3,
            max_bytes: 1024,
        };
        let l = open_workspace(&d, policy).unwrap();
        assert_eq!(l.files.len(), 3, "a política do caso de uso é respeitada");
        assert!(l.truncated);
    }

    #[test]
    fn open_workspace_reports_not_a_directory_typed() {
        let d = tmp("usecase-notdir");
        let file = d.join("a.txt");
        fs::write(&file, "x").unwrap();
        let err = open_workspace(&file, LoadPolicy::default()).unwrap_err();
        assert!(matches!(err, OpenError::NotADirectory));
        // A mensagem na fronteira IPC mantém-se "not a folder".
        assert_eq!(err.to_string(), "not a folder");
    }

    #[test]
    fn open_workspace_reports_io_error_for_missing_root() {
        let missing = std::env::temp_dir().join("dxtutor-does-not-exist-xyz-123");
        let _ = fs::remove_dir_all(&missing);
        let err = open_workspace(&missing, LoadPolicy::default()).unwrap_err();
        assert!(matches!(err, OpenError::Io(_)));
    }
}
