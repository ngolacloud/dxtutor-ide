//! `dxt plugin new`: cria o esqueleto de um plugin de curso, já válido.

use std::path::{Path, PathBuf};

use crate::manifest::{valid_id, MANIFEST_FILE};
use crate::source::OFFICIAL_ORG;

const T_MANIFEST: &str = include_str!("../template/dxtutor-plugin.json");
const T_COURSE: &str = include_str!("../template/course.toml");
const T_README: &str = include_str!("../template/README.md");
const T_WORKFLOW: &str = include_str!("../template/validate.yml");

/// Parâmetros do esqueleto.
pub struct NewPlugin<'a> {
    /// Id da linguagem e do plugin (`kotlin`).
    pub id: &'a str,
    /// Nome mostrado (`Kotlin`).
    pub name: &'a str,
    /// Extensão dos ficheiros (`kt`).
    pub extension: &'a str,
    /// Versão mínima do dxtutor (`0.7.0`).
    pub engine: &'a str,
}

/// Escreve o esqueleto em `dir` (que tem de não existir ou estar vazia). Devolve os
/// ficheiros criados.
pub fn create(dir: &Path, p: &NewPlugin) -> Result<Vec<PathBuf>, String> {
    if !valid_id(p.id) {
        return Err(format!(
            "`{}` is not a valid id: use [a-z0-9-], 2 to 40 characters",
            p.id
        ));
    }
    if p.name.trim().is_empty() || p.name.contains(['"', '\\', '\n']) {
        return Err("the name must be non-empty plain text".into());
    }
    if p.extension.is_empty() || !p.extension.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!(
            "`{}` is not a valid file extension (no dot, e.g. kt)",
            p.extension
        ));
    }
    if dir.exists()
        && std::fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
    {
        return Err(format!("{} already exists and is not empty", dir.display()));
    }
    let fill = |t: &str| {
        t.replace("{{id}}", p.id)
            .replace("{{name}}", p.name)
            .replace("{{ext}}", p.extension)
            .replace("{{org}}", OFFICIAL_ORG)
            .replace("{{engine}}", p.engine)
    };
    let files = [
        (PathBuf::from(MANIFEST_FILE), fill(T_MANIFEST)),
        (
            PathBuf::from("courses").join(format!("{}.toml", p.id)),
            fill(T_COURSE),
        ),
        (PathBuf::from("README.md"), fill(T_README)),
        (
            PathBuf::from(".github/workflows/validate.yml"),
            fill(T_WORKFLOW),
        ),
    ];
    let mut written = Vec::new();
    for (rel, body) in files {
        let path = dir.join(&rel);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, body).map_err(|e| format!("{}: {e}", path.display()))?;
        written.push(path);
    }
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validate::{validate_dir, Taken};

    #[test]
    fn o_esqueleto_valida_sem_erros_nem_avisos() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("kotlin");
        let p = NewPlugin {
            id: "kotlin",
            name: "Kotlin",
            extension: "kt",
            engine: "0.7.0",
        };
        let files = create(&dir, &p).unwrap();
        assert_eq!(files.len(), 4);
        let r = validate_dir(&dir, "0.7.0", &Taken::default());
        assert!(r.ok(), "{:?}", r.errors);
        assert!(r.warnings.is_empty(), "{:?}", r.warnings);
        assert_eq!(r.manifest.unwrap().language.extension, "kt");
        assert!(create(&dir, &p).is_err(), "não pode escrever por cima");
    }
}
