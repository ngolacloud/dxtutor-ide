//! Caso de uso «pesquisa e projecto» — **independente de Tauri** (Etapa 3).
//!
//! Quatro comandos IPC (`search_project`, `list_files`, `read_folder_sources`,
//! `detect_projects`) partilhavam, dentro do `#[tauri::command]`, *regras* que não
//! pertencem ao mecanismo de disco: os **tamanhos de página por omissão** (quantos
//! hits / ficheiros / bytes devolver quando a UI não os passa) e o **walk de
//! detecção** (que sub-pastas contam como projecto, que directórios se ignoram, que
//! extensões de fonte se recolhem). Essas regras saem aqui, para um caso de uso que
//! não conhece o `spawn_blocking` nem o mapeamento de erro → `String`: a fronteira IPC
//! (`commands::search`) fica um adaptador fino, exactamente como
//! `workspace::open_workspace` ↔ `bridge::load_workspace`.
//!
//! O grupo é **infalível** ao nível do caso de uso (o walk engole E/S como antes —
//! uma pasta ilegível é saltada, nunca propagada), tal como `testexec::run_one`. Por
//! isso não ganha erro tipado; a única falha que resta é o *join* da tarefa
//! bloqueante, que o adaptador veste com o prefixo histórico `"… task failed: …"`.
//!
//! `search_project`/`list_files` delegam o trabalho pesado a `tutor_eval::search` (o
//! mecanismo, intocado) depois de aplicar o default de página. Os DTOs `ProjectInfo`
//! e `FolderSource` nasceram ao lado dos comandos em `lib.rs`; vivem agora no caso de
//! uso que os produz.

use std::path::Path;
use tutor_eval::search::SearchHit;

/// Tamanhos de página por omissão — o **contrato público** que a UI observava quando
/// não passava `max`/`max_files`/`max_bytes`. Deixam de ser números presos dentro dos
/// comandos para serem constantes nomeadas da fatia.
pub const DEFAULT_SEARCH_MAX: usize = 500;
pub const DEFAULT_LIST_MAX: usize = 5000;
pub const DEFAULT_FOLDER_MAX_FILES: usize = 10;
pub const DEFAULT_FOLDER_MAX_BYTES: usize = 48_000;

/// Directórios saltados pelo walk (detecção de projectos e recolha de fontes): ruído de
/// build/dependências que nunca é código do utilizador.
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", "vendor"];

/// Extensões de ficheiro recolhidas por [`read_folder_sources`] para um Explain ao nível
/// de módulo. Linguagens de fonte comuns; binários/dados ficam de fora.
const SOURCE_EXTS: &[&str] = &[
    "rs", "py", "js", "mjs", "ts", "tsx", "jsx", "go", "java", "rb", "php", "c", "h", "cpp", "hpp",
    "cs", "swift", "kt",
];

/// A project detected inside the open folder — a sub-directory (or the root itself) that
/// carries a recognised build-manifest. Lets the Agent focus on one project when a
/// workspace holds several.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
    pub kind: String,
}

/// One source file gathered for a folder-level Explain.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSource {
    pub path: String,
    pub content: String,
}

/// Section 5 (daily work): global literal search across the project at `root`. Returns up
/// to `max` hits (file-relative); `None` falls back to the public page size. Offline,
/// bounded. Delega o varrimento a `tutor_eval::search::search_project` (o mecanismo).
pub fn search(
    root: &Path,
    query: &str,
    max: Option<usize>,
    ignore_case: Option<bool>,
) -> Vec<SearchHit> {
    tutor_eval::search::search_project(
        root,
        query,
        max.unwrap_or(DEFAULT_SEARCH_MAX),
        ignore_case.unwrap_or(false),
    )
}

/// Section 5 (daily work): list the project's files (relative, sorted) for quick-open;
/// `None` falls back to the public page size. Delega a `tutor_eval::search::list_files`.
pub fn list_files(root: &Path, max: Option<usize>) -> Vec<String> {
    tutor_eval::search::list_files(root, max.unwrap_or(DEFAULT_LIST_MAX))
}

/// A língua do projecto em `dir`, identificada pelo primeiro manifesto de build que
/// existir; `None` se nenhum marcador for encontrado.
fn project_kind(dir: &Path) -> Option<&'static str> {
    const MARKERS: &[(&str, &str)] = &[
        ("Cargo.toml", "rust"),
        ("go.mod", "go"),
        ("package.json", "node"),
        ("pyproject.toml", "python"),
        ("requirements.txt", "python"),
        ("pom.xml", "java"),
        ("build.gradle", "java"),
        ("composer.json", "php"),
        ("Gemfile", "ruby"),
    ];
    MARKERS
        .iter()
        .find(|(file, _)| dir.join(file).is_file())
        .map(|(_, kind)| *kind)
}

/// Detect projects at the root and one level down (skipping hidden / build dirs), so the
/// Agent can pin its focus to a specific project in a multi-project workspace. Infalível:
/// uma pasta ilegível é simplesmente saltada.
pub fn detect_projects(root: &Path) -> Vec<ProjectInfo> {
    let mut out = Vec::new();
    let mut push = |dir: &Path| {
        if let Some(kind) = project_kind(dir) {
            out.push(ProjectInfo {
                name: dir
                    .file_name()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| dir.to_string_lossy().into_owned()),
                path: dir.to_string_lossy().into_owned(),
                kind: kind.to_string(),
            });
        }
    };
    push(root);
    if let Ok(rd) = std::fs::read_dir(root) {
        let mut subdirs: Vec<_> = rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                p.is_dir()
                    && !p
                        .file_name()
                        .map(|n| {
                            let n = n.to_string_lossy();
                            n.starts_with('.') || SKIP_DIRS.contains(&n.as_ref())
                        })
                        .unwrap_or(false)
            })
            .collect();
        subdirs.sort();
        for d in subdirs {
            push(&d);
        }
    }
    out
}

/// Collect source files under `dir` (recursive, skipping hidden / build dirs), bounded by
/// `max_files` and `max_bytes` total, for a module-level Explain. Honest truncation: stops
/// adding once a cap is hit. `None` em qualquer limite cai no contrato público.
pub fn read_folder_sources(
    dir: &Path,
    max_files: Option<usize>,
    max_bytes: Option<usize>,
) -> Vec<FolderSource> {
    let max_files = max_files.unwrap_or(DEFAULT_FOLDER_MAX_FILES);
    let max_bytes = max_bytes.unwrap_or(DEFAULT_FOLDER_MAX_BYTES);
    let mut out: Vec<FolderSource> = Vec::new();
    let mut total = 0usize;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let rd = match std::fs::read_dir(&d) {
            Ok(r) => r,
            Err(_) => continue,
        };
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok().map(|e| e.path())).collect();
        entries.sort();
        for p in entries {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            if name.starts_with('.') {
                continue;
            }
            if p.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) {
                    stack.push(p);
                }
                continue;
            }
            if out.len() >= max_files || total >= max_bytes {
                return out;
            }
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !SOURCE_EXTS.contains(&ext) {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(&p) {
                total += content.len();
                out.push(FolderSource {
                    path: p.to_string_lossy().into_owned(),
                    content,
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_page_sizes_are_the_public_contract() {
        // Os números que estavam presos nos `#[tauri::command]` passam a contrato nomeado.
        assert_eq!(DEFAULT_SEARCH_MAX, 500);
        assert_eq!(DEFAULT_LIST_MAX, 5000);
        assert_eq!(DEFAULT_FOLDER_MAX_FILES, 10);
        assert_eq!(DEFAULT_FOLDER_MAX_BYTES, 48_000);
    }

    #[test]
    fn detect_projects_finds_the_root_and_one_level_down() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // Raiz = projecto Rust; uma sub-pasta = projecto Go; ruído de build ignorado.
        std::fs::write(root.join("Cargo.toml"), "[package]\nname=\"x\"\n").unwrap();
        std::fs::create_dir_all(root.join("svc")).unwrap();
        std::fs::write(root.join("svc/go.mod"), "module svc\n").unwrap();
        std::fs::create_dir_all(root.join("target/sub")).unwrap();
        std::fs::write(
            root.join("target/sub/Cargo.toml"),
            "[package]\nname=\"y\"\n",
        )
        .unwrap();

        let found = detect_projects(root);
        let kinds: Vec<_> = found.iter().map(|p| p.kind.as_str()).collect();
        assert!(
            kinds.contains(&"rust"),
            "a raiz é um projecto Rust: {found:?}"
        );
        assert!(kinds.contains(&"go"), "svc/ é um projecto Go: {found:?}");
        assert!(
            !found.iter().any(|p| p.path.contains("target")),
            "target/ é ruído de build e não deve aparecer: {found:?}"
        );
    }

    #[test]
    fn read_folder_sources_caps_the_file_count() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for i in 0..5 {
            std::fs::write(root.join(format!("f{i}.rs")), "fn main() {}\n").unwrap();
        }
        // Com o limite em 2, a truncagem honesta pára aos 2 ficheiros.
        let got = read_folder_sources(root, Some(2), None);
        assert_eq!(got.len(), 2, "o limite de ficheiros é respeitado: {got:?}");
        assert!(got.iter().all(|s| s.path.ends_with(".rs")));
    }

    #[test]
    fn read_folder_sources_skips_build_dirs_and_non_source() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::write(root.join("keep.rs"), "fn main() {}\n").unwrap();
        std::fs::write(root.join("data.bin"), "x").unwrap(); // extensão não-fonte
        std::fs::create_dir_all(root.join("node_modules")).unwrap();
        std::fs::write(root.join("node_modules/dep.js"), "module.exports={}\n").unwrap();

        let got = read_folder_sources(root, None, None);
        let paths: Vec<_> = got.iter().map(|s| s.path.as_str()).collect();
        assert!(
            paths.iter().any(|p| p.ends_with("keep.rs")),
            "a fonte real entra: {paths:?}"
        );
        assert!(
            !paths.iter().any(|p| p.ends_with("data.bin")),
            "não-fonte fica de fora"
        );
        assert!(
            !paths.iter().any(|p| p.contains("node_modules")),
            "node_modules é saltado: {paths:?}"
        );
    }
}
