//! O registo local de plugins instalados e a instalação propriamente dita.
//!
//! Disposição em disco (`Store::root`):
//!
//! ```text
//! <root>/installed.json      registo (lock): id, versão, origem, sha256, data
//! <root>/<id>/               o plugin, tal como veio (manifesto + cursos + docs)
//! <root>/.staging-*          temporário durante uma instalação (apagado no fim)
//! ```
//!
//! Por omissão `<root>` é `$XDG_DATA_HOME/dxtutor/plugins` (Linux),
//! `~/Library/Application Support/dxtutor/plugins` (macOS) ou `%APPDATA%\dxtutor\plugins`
//! (Windows). A variável `DXTUTOR_PLUGINS_DIR` sobrepõe-se (testes, instalações portáteis).
//!
//! Plugins são DADOS: nada do que vem num plugin é executado na instalação. Os testes de um
//! desafio correm mais tarde, no avaliador (`tutor_eval`), como os dos cursos embutidos.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tutor_core::{Course, CourseFormat};

use crate::manifest::{Manifest, MANIFEST_FILE};
use crate::source::Source;
use crate::validate::{validate_dir, Taken};

/// Tamanho máximo de um plugin (descarregado ou descomprimido).
pub const MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Número máximo de ficheiros num plugin.
pub const MAX_FILES: usize = 5_000;
const LOCK_FILE: &str = "installed.json";
const SKIP_DIRS: [&str; 4] = [".git", "node_modules", "target", ".github"];

/// Uma linha do registo `installed.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub version: String,
    /// Origem canónica (`github:owner/repo@ref`, URL ou caminho).
    pub source: String,
    /// sha256 do zip instalado; ausente quando veio de uma pasta local.
    pub sha256: Option<String>,
    /// Segundos desde a época Unix.
    pub installed_at: u64,
}

/// Um plugin instalado, com o manifesto lido do disco (ou o erro, se estiver estragado).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    pub entry: Entry,
    pub manifest: Option<Manifest>,
    pub error: Option<String>,
}

/// O que uma instalação fez.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub entry: Entry,
    pub language: crate::manifest::LanguageInfo,
    /// `language`, `framework` ou `tool`.
    pub category: tutor_core::CourseCategory,
    /// O framework/ferramenta ensinado (`None` num plugin de linguagem).
    pub subject: Option<crate::manifest::SubjectInfo>,
    pub course_ids: Vec<String>,
    /// Versão anterior, quando a instalação substituiu um plugin com o mesmo id.
    pub replaced: Option<String>,
    pub warnings: Vec<String>,
    /// Informação (ex.: «substitui o curso embutido»), não defeitos de conteúdo.
    pub notes: Vec<String>,
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    /// O registo no sítio por omissão (ou em `DXTUTOR_PLUGINS_DIR`).
    pub fn open_default() -> Result<Store, String> {
        if let Some(dir) = std::env::var_os("DXTUTOR_PLUGINS_DIR").filter(|d| !d.is_empty()) {
            return Ok(Store::at(dir));
        }
        let base = dirs::data_dir().ok_or("cannot find the user data folder")?;
        Ok(Store::at(base.join("dxtutor").join("plugins")))
    }

    pub fn at(root: impl Into<PathBuf>) -> Store {
        Store { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Marca de mudança do registo (mtime do lock): quem guarda cursos em cache recarrega
    /// quando isto muda.
    pub fn fingerprint(&self) -> Option<SystemTime> {
        std::fs::metadata(self.root.join(LOCK_FILE))
            .and_then(|m| m.modified())
            .ok()
    }

    /// As linhas do registo (vazio se ainda não há nada instalado).
    pub fn entries(&self) -> Vec<Entry> {
        std::fs::read_to_string(self.root.join(LOCK_FILE))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn write_entries(&self, entries: &[Entry]) -> Result<(), String> {
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
        let tmp = self.root.join(format!("{LOCK_FILE}.tmp"));
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, self.root.join(LOCK_FILE)).map_err(|e| e.to_string())
    }

    /// Os plugins instalados, com o manifesto de cada um.
    pub fn list(&self) -> Vec<Installed> {
        self.entries()
            .into_iter()
            .map(|entry| {
                let path = self.root.join(&entry.id).join(MANIFEST_FILE);
                match std::fs::read_to_string(&path)
                    .map_err(|e| e.to_string())
                    .and_then(|s| Manifest::parse(&s))
                {
                    Ok(m) => Installed {
                        entry,
                        manifest: Some(m),
                        error: None,
                    },
                    Err(e) => Installed {
                        entry,
                        manifest: None,
                        error: Some(e),
                    },
                }
            })
            .collect()
    }

    /// Todos os cursos dos plugins instalados, com o manifesto do plugin de cada um. Um
    /// plugin estragado (apagado à mão, editado) é ignorado em vez de partir os outros.
    pub fn courses(&self) -> Vec<(Manifest, Course)> {
        let mut out = Vec::new();
        for item in self.list() {
            let Some(m) = item.manifest else { continue };
            let dir = self.root.join(&item.entry.id);
            for rel in &m.courses {
                let Some(fmt) = CourseFormat::from_path(rel) else {
                    continue;
                };
                if !crate::manifest::safe_relative(rel) {
                    continue;
                }
                if let Some(c) = std::fs::read_to_string(dir.join(rel))
                    .ok()
                    .and_then(|raw| Course::parse(&raw, fmt).ok())
                {
                    out.push((m.clone(), c));
                }
            }
        }
        out
    }

    /// Remove um plugin instalado.
    pub fn remove(&self, id: &str) -> Result<Entry, String> {
        let mut entries = self.entries();
        let pos = entries
            .iter()
            .position(|e| e.id == id)
            .ok_or_else(|| format!("plugin `{id}` is not installed"))?;
        let entry = entries.remove(pos);
        let dir = self.root.join(&entry.id);
        if dir.exists() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| format!("cannot delete {}: {e}", dir.display()))?;
        }
        self.write_entries(&entries)?;
        Ok(entry)
    }

    /// Instala (ou actualiza) um plugin. `builtin` são os cursos embutidos na app, para
    /// detectar ids de passo repetidos.
    pub fn install(
        &self,
        source: &Source,
        host_version: &str,
        builtin: &[Course],
    ) -> Result<Outcome, String> {
        std::fs::create_dir_all(&self.root)
            .map_err(|e| format!("cannot create {}: {e}", self.root.display()))?;
        let staging = self
            .root
            .join(format!(".staging-{}-{}", std::process::id(), now_nanos()));
        let result = self.install_into(source, host_version, builtin, &staging);
        if staging.exists() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        result
    }

    fn install_into(
        &self,
        source: &Source,
        host_version: &str,
        builtin: &[Course],
        staging: &Path,
    ) -> Result<Outcome, String> {
        let sha256 = match source {
            Source::LocalDir(dir) => {
                copy_dir(dir, staging)?;
                None
            }
            Source::LocalZip(path) => {
                let bytes = read_limited(
                    std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?,
                )?;
                extract_zip(&bytes, staging)?;
                Some(hex_sha256(&bytes))
            }
            remote => {
                let url = remote.download_url().expect("remote source has a URL");
                let bytes = download(&url)?;
                extract_zip(&bytes, staging)?;
                Some(hex_sha256(&bytes))
            }
        };

        // O id só se sabe depois de ler o manifesto: os cursos de OUTROS plugins (e os
        // embutidos) ocupam ids; o próprio plugin, numa actualização, não.
        let incoming_id = std::fs::read_to_string(staging.join(MANIFEST_FILE))
            .ok()
            .and_then(|s| Manifest::parse(&s).ok())
            .map(|m| m.id);
        let others: Vec<Course> = self
            .courses()
            .into_iter()
            .filter(|(m, _)| Some(&m.id) != incoming_id.as_ref())
            .map(|(_, c)| c)
            .collect();
        let taken = Taken::new(builtin, &others);

        let report = validate_dir(staging, host_version, &taken);
        if !report.ok() {
            return Err(format!(
                "the plugin is not valid:\n  - {}",
                report.errors.join("\n  - ")
            ));
        }
        let manifest = report.manifest.expect("valid report has a manifest");

        let dest = self.root.join(&manifest.id);
        let old = self
            .root
            .join(format!(".old-{}-{}", manifest.id, now_nanos()));
        if dest.exists() {
            std::fs::rename(&dest, &old).map_err(|e| e.to_string())?;
        }
        if let Err(e) = std::fs::rename(staging, &dest) {
            if old.exists() {
                let _ = std::fs::rename(&old, &dest);
            }
            return Err(format!("cannot move the plugin into place: {e}"));
        }
        if old.exists() {
            let _ = std::fs::remove_dir_all(&old);
        }

        let mut entries = self.entries();
        let replaced = entries
            .iter()
            .find(|e| e.id == manifest.id)
            .map(|e| e.version.clone());
        entries.retain(|e| e.id != manifest.id);
        let entry = Entry {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            version: manifest.version.clone(),
            source: source.canonical(),
            sha256,
            installed_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        };
        entries.push(entry.clone());
        entries.sort_by(|a, b| a.id.cmp(&b.id));
        self.write_entries(&entries)?;

        Ok(Outcome {
            entry,
            language: manifest.language.clone(),
            category: manifest.category,
            subject: manifest.subject.clone(),
            course_ids: report.courses.iter().map(|c| c.id.clone()).collect(),
            replaced,
            warnings: report.warnings,
            notes: report.notes,
        })
    }
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0)
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn read_limited(r: impl Read) -> Result<Vec<u8>, String> {
    let mut buf = Vec::new();
    r.take(MAX_BYTES + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() as u64 > MAX_BYTES {
        return Err(format!(
            "the plugin is larger than {} MiB",
            MAX_BYTES / 1024 / 1024
        ));
    }
    Ok(buf)
}

fn download(url: &str) -> Result<Vec<u8>, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(120))
        .user_agent(concat!("dxtutor-plugins/", env!("CARGO_PKG_VERSION")))
        .build();
    match agent.get(url).call() {
        Ok(resp) => read_limited(resp.into_reader()),
        Err(ureq::Error::Status(404, _)) => Err(format!(
            "{url}: not found (does the repository or tag exist, and is it public?)"
        )),
        Err(ureq::Error::Status(code, _)) => Err(format!("{url}: HTTP {code}")),
        Err(e) => Err(format!("{url}: {e}")),
    }
}

/// Extrai um zip para `dest`. Se tudo estiver dentro de uma única pasta de topo (como nos
/// zips do GitHub, `repo-ref/…`), essa pasta é removida do caminho.
fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("not a zip file: {e}"))?;
    if zip.len() > MAX_FILES {
        return Err(format!("the plugin has more than {MAX_FILES} files"));
    }
    let mut names = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| e.to_string())?;
        let path = f
            .enclosed_name()
            .ok_or_else(|| format!("unsafe path in zip: {}", f.name()))?;
        names.push(path);
    }
    let prefix = common_top_dir(&names);
    let mut total: u64 = 0;
    for (i, name) in names.iter().enumerate() {
        let rel = match &prefix {
            Some(p) => match name.strip_prefix(p) {
                Ok(r) => r.to_path_buf(),
                Err(_) => continue,
            },
            None => name.clone(),
        };
        if rel.as_os_str().is_empty()
            || rel
                .components()
                .any(|c| SKIP_DIRS.iter().any(|s| c.as_os_str() == *s))
        {
            continue;
        }
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let out = dest.join(&rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if f.is_symlink() {
            continue;
        }
        total += f.size();
        if total > MAX_BYTES {
            return Err(format!(
                "the plugin unpacks to more than {} MiB",
                MAX_BYTES / 1024 / 1024
            ));
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut w = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        // `take` protege contra um tamanho declarado mentiroso (zip bomb).
        let copied =
            std::io::copy(&mut (&mut f).take(MAX_BYTES + 1), &mut w).map_err(|e| e.to_string())?;
        if copied > MAX_BYTES {
            return Err("zip entry larger than declared".into());
        }
    }
    Ok(())
}

fn common_top_dir(names: &[PathBuf]) -> Option<PathBuf> {
    let first = names.iter().find_map(|n| n.components().next())?;
    let top = PathBuf::from(first.as_os_str());
    let all_under = names
        .iter()
        .all(|n| n.starts_with(&top) && (n.components().count() > 1 || n == &top));
    // Só é prefixo se for uma pasta (há algo debaixo dela) e não um ficheiro solto.
    (all_under && names.iter().any(|n| n.components().count() > 1)).then_some(top)
}

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    if !src.join(MANIFEST_FILE).is_file() {
        return Err(format!("{MANIFEST_FILE} not found in {}", src.display()));
    }
    let mut files = 0usize;
    let mut total = 0u64;
    copy_rec(src, dest, &mut files, &mut total)
}

fn copy_rec(src: &Path, dest: &Path, files: &mut usize, total: &mut u64) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("{}: {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if SKIP_DIRS.iter().any(|s| name == *s) {
            continue;
        }
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let to = dest.join(&name);
        if ty.is_dir() {
            copy_rec(&entry.path(), &to, files, total)?;
        } else if ty.is_file() {
            *files += 1;
            *total += entry.metadata().map(|m| m.len()).unwrap_or(0);
            if *files > MAX_FILES || *total > MAX_BYTES {
                return Err("the plugin folder is too large".into());
            }
            std::fs::copy(entry.path(), &to).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const COURSE: &str = r#"
id = "py-basics"
language = "python"
title = "Python basics"
level = "beginner"
summary = "s"
overview = "Python is a dynamic language."

[[unit]]
id = "u1"
title = "Values"
concepts = "Everything is an object."

[[unit.step]]
kind = "concept"
id = "py-c1"
title = "Hello"
points = 5
body = "Hi"
"#;

    fn manifest(version: &str) -> String {
        format!(
            r#"{{"schema":1,"id":"python","name":"Python","version":"{version}","engine":">=0.1.0","kind":"course",
               "language":{{"id":"python","name":"Python","icon":"🐍","extension":"py"}},
               "courses":["courses/python.toml"]}}"#
        )
    }

    fn plugin_dir(root: &Path, version: &str) -> PathBuf {
        let d = root.join(format!("src-{version}"));
        std::fs::create_dir_all(d.join("courses")).unwrap();
        std::fs::write(d.join(MANIFEST_FILE), manifest(version)).unwrap();
        std::fs::write(d.join("courses/python.toml"), COURSE).unwrap();
        d
    }

    fn zip_of(dir_prefix: &str, files: &[(&str, &str)]) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            for (name, body) in files {
                w.start_file(
                    format!("{dir_prefix}{name}"),
                    zip::write::SimpleFileOptions::default(),
                )
                .unwrap();
                w.write_all(body.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn instala_actualiza_lista_e_remove_de_uma_pasta() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("plugins"));
        let v1 = plugin_dir(tmp.path(), "0.1.0");
        let out = store.install(&Source::LocalDir(v1), "0.7.0", &[]).unwrap();
        assert_eq!(out.course_ids, vec!["py-basics"]);
        assert!(out.replaced.is_none());
        assert!(out.warnings.is_empty(), "{:?}", out.warnings);
        assert_eq!(store.courses().len(), 1);

        let v2 = plugin_dir(tmp.path(), "0.2.0");
        let out = store.install(&Source::LocalDir(v2), "0.7.0", &[]).unwrap();
        assert_eq!(out.replaced.as_deref(), Some("0.1.0"));
        let list = store.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].entry.version, "0.2.0");

        store.remove("python").unwrap();
        assert!(store.list().is_empty());
        assert!(!store.root().join("python").exists());
        assert!(store.remove("python").is_err());
    }

    #[test]
    fn zip_estilo_github_tira_a_pasta_de_topo() {
        let tmp = tempfile::tempdir().unwrap();
        let bytes = zip_of(
            "python-main/",
            &[
                (MANIFEST_FILE, &manifest("1.0.0")),
                ("courses/python.toml", COURSE),
                (".git/HEAD", "x"),
            ],
        );
        let zip_path = tmp.path().join("p.zip");
        std::fs::write(&zip_path, &bytes).unwrap();
        let store = Store::at(tmp.path().join("plugins"));
        let out = store
            .install(&Source::LocalZip(zip_path), "0.7.0", &[])
            .unwrap();
        assert_eq!(out.entry.sha256.as_deref().map(str::len), Some(64));
        assert!(store.root().join("python/courses/python.toml").is_file());
        assert!(!store.root().join("python/.git").exists());
    }

    #[test]
    fn recusa_plugin_invalido_e_ids_repetidos_sem_deixar_lixo() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("plugins"));
        // Outro curso embutido da MESMA linguagem com um passo de id igual: recusado.
        let other = COURSE.replace("id = \"py-basics\"", "id = \"py-other\"");
        let builtin = Course::parse(&other, CourseFormat::Toml).unwrap();
        let src = plugin_dir(tmp.path(), "0.1.0");
        let err = store
            .install(&Source::LocalDir(src.clone()), "0.7.0", &[builtin])
            .unwrap_err();
        assert!(err.contains("step ids already used"), "{err}");
        let err = store
            .install(&Source::LocalDir(src), "0.0.1", &[])
            .unwrap_err();
        assert!(err.contains("requires dxtutor"), "{err}");
        let leftovers: Vec<_> = std::fs::read_dir(store.root())
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert!(leftovers.is_empty(), "sobrou {leftovers:?}");
    }

    #[test]
    fn substitui_o_embutido_com_o_mesmo_id_e_aceita_ids_de_outra_linguagem() {
        let tmp = tempfile::tempdir().unwrap();
        let store = Store::at(tmp.path().join("plugins"));
        let same = Course::parse(COURSE, CourseFormat::Toml).unwrap();
        let go = Course::parse(
            &COURSE
                .replace("id = \"py-basics\"", "id = \"go-basics\"")
                .replace("language = \"python\"", "language = \"go\""),
            CourseFormat::Toml,
        )
        .unwrap();
        let src = plugin_dir(tmp.path(), "1.0.0");
        let out = store
            .install(&Source::LocalDir(src), "0.7.0", &[same, go])
            .unwrap();
        assert!(
            out.notes
                .iter()
                .any(|w| w.contains("replaces the built-in")),
            "{:?}",
            out.warnings
        );
        // Outro plugin não pode reutilizar o id de curso de um plugin instalado.
        let dup = tmp.path().join("dup");
        std::fs::create_dir_all(dup.join("courses")).unwrap();
        std::fs::write(
            dup.join(MANIFEST_FILE),
            manifest("1.0.0").replace("\"id\":\"python\"", "\"id\":\"python-fork\""),
        )
        .unwrap();
        std::fs::write(dup.join("courses/python.toml"), COURSE).unwrap();
        let err = store
            .install(&Source::LocalDir(dup), "0.7.0", &[])
            .unwrap_err();
        assert!(err.contains("another installed plugin"), "{err}");
    }

    #[test]
    fn recusa_caminhos_que_fogem_do_zip() {
        let tmp = tempfile::tempdir().unwrap();
        let bytes = zip_of("", &[("../evil.txt", "x")]);
        assert!(extract_zip(&bytes, tmp.path()).is_err());
    }
}
