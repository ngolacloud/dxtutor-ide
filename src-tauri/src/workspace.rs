//! Real folders on disk: load a project into the IDE, write and delete files.
//! Every path coming from the UI is relative and is checked to stay inside the root.

use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

/// Directories that are never loaded into the editor.
pub const IGNORED_DIRS: &[&str] = &[
    ".git", "node_modules", "target", "dist", "build", ".venv", "venv", "__pycache__",
    ".idea", ".next", ".cache", ".gradle", ".terraform", "vendor",
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
                        files.push(FileEntry { path: to_slash(rel), content });
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
    Ok(Loaded { root: root.to_string_lossy().to_string(), name, files, skipped, truncated })
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

pub fn write(root: &Path, rel: &str, content: &str) -> Result<(), String> {
    let p = safe_join(root, rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&p, content).map_err(|e| format!("{rel}: {e}"))
}

pub fn delete(root: &Path, rel: &str) -> Result<(), String> {
    let p = safe_join(root, rel)?;
    match fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("{rel}: {e}")),
    }
}

/// Expands a leading `~` to the user's home folder.
pub fn expand_home(p: &str) -> String {
    if let Some(rest) = p.strip_prefix('~') {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_default();
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
        assert_eq!(fs::read_to_string(d.join("deep/dir/x.txt")).unwrap(), "hello");
        delete(&d, "deep/dir/x.txt").unwrap();
        assert!(!d.join("deep/dir/x.txt").exists());
        delete(&d, "deep/dir/x.txt").unwrap();
    }
}
