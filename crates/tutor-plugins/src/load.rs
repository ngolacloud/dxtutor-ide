//! Ler os cursos de UMA pasta de plugin, com erros explícitos.
//!
//! O [`crate::Store::courses`] salta um plugin ou um curso estragado para não partir os outros.
//! Quem avalia um curso (o `dxtutor-grade` no devcontainer do curso, ADR-0008) precisa do
//! contrário: um curso que não carrega inteiro é um erro com o sítio, nunca um curso a menos.

use std::path::Path;

use tutor_core::{Course, CourseFormat};

use crate::manifest::{safe_relative, Manifest, MANIFEST_FILE};

/// O manifesto e os cursos da pasta, cada um com os seus ficheiros de apoio carregados.
pub fn load_dir(dir: &Path) -> Result<(Manifest, Vec<Course>), String> {
    let manifest_path = dir.join(MANIFEST_FILE);
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("{}: {e}", manifest_path.display()))?;
    let manifest = Manifest::parse(&raw)?;
    if manifest.courses.is_empty() {
        return Err(format!("{MANIFEST_FILE}: no courses"));
    }
    let mut courses = Vec::new();
    for rel in &manifest.courses {
        if !safe_relative(rel) {
            return Err(format!("{MANIFEST_FILE}: unsafe course path `{rel}`"));
        }
        let fmt = CourseFormat::from_path(rel)
            .ok_or_else(|| format!("{rel}: not a .toml or .json course"))?;
        let raw = std::fs::read_to_string(dir.join(rel)).map_err(|e| format!("{rel}: {e}"))?;
        let mut course = Course::parse(&raw, fmt).map_err(|e| format!("{rel}: {e}"))?;
        crate::support::load_support(dir, &mut course)
            .map_err(|errs| format!("{rel}: support files: {}", errs.join("; ")))?;
        courses.push(course);
    }
    Ok((manifest, courses))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_course(id: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../courses")
            .join(id)
    }

    #[test]
    fn an_official_course_folder_loads_with_its_support_files() {
        let (m, courses) = load_dir(&repo_course("dxjs")).unwrap();
        assert_eq!(m.courses.len(), courses.len());
        let dxjs = &courses[0];
        assert!(
            !dxjs.support.is_empty(),
            "the dxjs course declares [support]"
        );
        assert_eq!(
            dxjs.support_files.len(),
            dxjs.support.len(),
            "every support file is loaded"
        );
        assert!(dxjs.support_files.values().all(|c| !c.is_empty()));
    }

    #[test]
    fn a_broken_folder_is_an_error_with_the_place_never_a_course_less() {
        let tmp = tempfile::tempdir().unwrap();
        let e = load_dir(tmp.path()).unwrap_err();
        assert!(e.contains(MANIFEST_FILE), "{e}");

        let src = repo_course("python");
        let manifest = std::fs::read_to_string(src.join(MANIFEST_FILE)).unwrap();
        std::fs::write(tmp.path().join(MANIFEST_FILE), &manifest).unwrap();
        let e = load_dir(tmp.path()).unwrap_err();
        assert!(
            e.contains("courses/"),
            "a missing course file names it: {e}"
        );

        std::fs::create_dir_all(tmp.path().join("courses")).unwrap();
        let rel = Manifest::parse(&manifest).unwrap().courses[0].clone();
        std::fs::write(tmp.path().join(&rel), "not = [toml").unwrap();
        let e = load_dir(tmp.path()).unwrap_err();
        assert!(e.starts_with(&rel), "{e}");
    }
}
