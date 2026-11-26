//! O manifesto `dxtutor-plugin.json`, na raiz de cada plugin.
//!
//! É o contrato público com quem contribui cursos: mudar um campo obrigatório é uma
//! mudança de `schema` (hoje `1`). Campos novos entram como opcionais.

use serde::{Deserialize, Serialize};
use tutor_core::CourseCategory;

/// Nome do ficheiro de manifesto na raiz do plugin.
pub const MANIFEST_FILE: &str = "dxtutor-plugin.json";
/// Versão do formato de manifesto que este dxtutor entende.
pub const SCHEMA_VERSION: u32 = 1;
/// Níveis pedagógicos válidos de uma unidade.
pub const LEVELS: [&str; 3] = ["basic", "intermediate", "advanced"];

/// O manifesto de um plugin de curso.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    /// Versão do formato do manifesto (hoje `1`).
    pub schema: u32,
    /// Identificador único e estável: `[a-z0-9-]`, 2–40 caracteres. É também o nome da
    /// pasta onde o plugin fica instalado.
    pub id: String,
    /// Nome legível do plugin.
    pub name: String,
    /// Versão semântica do plugin (`1.2.0`).
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub license: String,
    /// URL do repositório (normalmente GitHub).
    #[serde(default)]
    pub repository: String,
    /// Versões do dxtutor suportadas, como requisito semver (`>=0.7.0`).
    pub engine: String,
    /// Tipo de plugin. Hoje só existe `course`.
    pub kind: String,
    /// O que os cursos ensinam: `language` (omisso, o de sempre), `framework` ou `tool`
    /// (ADR-0005, emenda de 2026-11-26). Omitido na serialização quando é `language`, para o
    /// manifesto de um plugin de linguagem ficar igual ao de sempre.
    #[serde(default, skip_serializing_if = "is_language")]
    pub category: CourseCategory,
    /// O framework/ferramenta ensinado (obrigatório quando `category` não é `language`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<SubjectInfo>,
    /// A linguagem que o curso ensina; num plugin de framework/ferramenta, a linguagem/runtime
    /// em que os exercícios se escrevem e se avaliam (`python` num curso de Django).
    pub language: LanguageInfo,
    /// Caminhos relativos (à raiz do plugin) dos ficheiros de curso, `.toml` ou `.json`.
    pub courses: Vec<String>,
}

/// Metadados da linguagem ensinada, para o selector de linguagens e o editor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LanguageInfo {
    /// Id da linguagem (`python`, `typescript`, …). Tem de bater com o `language` de cada
    /// curso do plugin.
    pub id: String,
    /// Nome mostrado (`Python`).
    pub name: String,
    /// Um emoji ou glifo curto para o cartão da linguagem.
    #[serde(default)]
    pub icon: String,
    /// Extensão dos ficheiros de exercício, sem ponto (`py`).
    pub extension: String,
    /// Indentação inserida pela tecla Tab: `"tab"` ou um número de espaços (`"4"`).
    #[serde(default = "default_indent")]
    pub indent: String,
    /// Comando de teste mostrado ao aluno nos desafios (`pytest`). Só apresentação.
    #[serde(default)]
    pub test_command: String,
}

/// O framework ou a ferramenta que um plugin de `category` `framework`/`tool` ensina.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SubjectInfo {
    /// Id estável (`django`, `docker`): `[a-z0-9-]`, 2–40 caracteres. Tem de bater com o
    /// `subject` de cada curso do plugin. O plugin oficial é `ngolacloud/dxtutor-course-<id>`.
    pub id: String,
    /// Nome mostrado (`Django`).
    pub name: String,
    /// Um emoji ou glifo curto para o cartão.
    #[serde(default)]
    pub icon: String,
    /// URL `https://` da documentação oficial (mostrada ao aluno).
    #[serde(default)]
    pub docs: String,
}

fn is_language(c: &CourseCategory) -> bool {
    *c == CourseCategory::Language
}

fn default_indent() -> String {
    "4".to_string()
}

impl Manifest {
    /// Lê o manifesto de texto JSON.
    pub fn parse(raw: &str) -> Result<Manifest, String> {
        serde_json::from_str(raw).map_err(|e| format!("{MANIFEST_FILE}: {e}"))
    }

    /// Erros de forma dos campos do próprio manifesto (os cursos validam-se à parte).
    /// `host_version` é a versão do dxtutor que vai carregar o plugin.
    pub fn check(&self, host_version: &str) -> Vec<String> {
        let mut errs = Vec::new();
        if self.schema != SCHEMA_VERSION {
            errs.push(format!(
                "schema {} is not supported (this dxtutor understands schema {SCHEMA_VERSION})",
                self.schema
            ));
        }
        if !valid_id(&self.id) {
            errs.push(format!(
                "id `{}` is invalid: use only [a-z0-9-], 2 to 40 characters, not starting or ending with `-`",
                self.id
            ));
        }
        if self.name.trim().is_empty() {
            errs.push("name is empty".into());
        }
        if semver::Version::parse(&self.version).is_err() {
            errs.push(format!(
                "version `{}` is not semver (e.g. 0.1.0)",
                self.version
            ));
        }
        match semver::VersionReq::parse(&self.engine) {
            Err(_) => errs.push(format!(
                "engine `{}` is not a semver requirement (e.g. >=0.7.0)",
                self.engine
            )),
            Ok(req) => {
                if let Ok(host) = semver::Version::parse(host_version) {
                    if !req.matches(&host) {
                        errs.push(format!(
                            "the plugin requires dxtutor {} but this is {host}",
                            self.engine
                        ));
                    }
                }
            }
        }
        if self.kind != "course" {
            errs.push(format!(
                "unknown kind `{}` (only `course` exists today)",
                self.kind
            ));
        }
        match (&self.subject, self.category.has_subject()) {
            (Some(_), false) => errs.push(
                "subject is only for framework and tool plugins (set category to `framework` or `tool`)"
                    .into(),
            ),
            (None, true) => errs.push(format!(
                "a `{}` plugin needs a `subject` (the {} it teaches: id, name)",
                self.category.as_str(),
                self.category.as_str()
            )),
            (Some(sub), true) => {
                if !valid_id(&sub.id) {
                    errs.push(format!("subject.id `{}` is invalid", sub.id));
                }
                if sub.id == self.language.id {
                    errs.push(format!(
                        "subject.id `{}` is the same as language.id: the subject is the {}, the language is what the exercises are written in",
                        sub.id,
                        self.category.as_str()
                    ));
                }
                if sub.name.trim().is_empty() {
                    errs.push("subject.name is empty".into());
                }
                if !sub.docs.is_empty() && !sub.docs.starts_with("https://") {
                    errs.push(format!(
                        "subject.docs `{}` must be an https:// URL",
                        sub.docs
                    ));
                }
            }
            (None, false) => {}
        }
        if !valid_id(&self.language.id) {
            errs.push(format!("language.id `{}` is invalid", self.language.id));
        }
        if self.language.name.trim().is_empty() {
            errs.push("language.name is empty".into());
        }
        let ext = self.language.extension.trim();
        if ext.is_empty() || ext.starts_with('.') || !ext.chars().all(|c| c.is_ascii_alphanumeric())
        {
            errs.push(format!(
                "language.extension `{}` is invalid (no dot, e.g. py)",
                self.language.extension
            ));
        }
        if self.language.indent != "tab" && !matches!(self.language.indent.parse::<u8>(), Ok(1..=8))
        {
            errs.push(format!(
                "language.indent `{}` is invalid (\"tab\" or 1–8)",
                self.language.indent
            ));
        }
        if self.courses.is_empty() {
            errs.push("courses is empty: the plugin must ship at least one course".into());
        }
        for c in &self.courses {
            if !safe_relative(c) {
                errs.push(format!(
                    "courses: path `{c}` must be relative and stay inside the plugin"
                ));
            } else if tutor_core::CourseFormat::from_path(c).is_none() {
                errs.push(format!("courses: `{c}` must end in .toml or .json"));
            }
        }
        errs
    }
}

/// `[a-z0-9-]`, 2–40 caracteres, sem `-` nas pontas.
pub fn valid_id(id: &str) -> bool {
    (2..=40).contains(&id.len())
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !id.starts_with('-')
        && !id.ends_with('-')
}

/// Caminho relativo sem `..`, sem raiz e sem prefixo de drive.
pub fn safe_relative(p: &str) -> bool {
    let path = std::path::Path::new(p);
    !p.is_empty()
        && path.components().all(|c| {
            matches!(
                c,
                std::path::Component::Normal(_) | std::path::Component::CurDir
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn sample() -> Manifest {
        Manifest {
            schema: 1,
            id: "python".into(),
            name: "Python".into(),
            version: "0.1.0".into(),
            description: String::new(),
            authors: vec![],
            license: "MIT".into(),
            repository: String::new(),
            engine: ">=0.7.0".into(),
            kind: "course".into(),
            category: CourseCategory::Language,
            subject: None,
            language: LanguageInfo {
                id: "python".into(),
                name: "Python".into(),
                icon: "🐍".into(),
                extension: "py".into(),
                indent: "4".into(),
                test_command: "pytest".into(),
            },
            courses: vec!["courses/python.toml".into()],
        }
    }

    #[test]
    fn manifesto_valido_nao_tem_erros() {
        assert!(sample().check("0.7.0").is_empty());
    }

    #[test]
    fn apanha_os_erros_de_forma() {
        let mut m = sample();
        m.id = "Py".into();
        m.version = "1".into();
        m.engine = ">=9.0.0".into();
        m.language.extension = ".py".into();
        m.courses = vec!["../fora.toml".into(), "c.yaml".into()];
        let e = m.check("0.7.0").join("\n");
        for frag in [
            "id `Py`",
            "version `1`",
            "requires dxtutor",
            "extension",
            "`../fora.toml`",
            "`c.yaml`",
        ] {
            assert!(e.contains(frag), "falta `{frag}` em:\n{e}");
        }
    }

    #[test]
    fn categoria_e_assunto() {
        // Um manifesto antigo (sem os campos) é de linguagem e serializa como antes.
        let m = sample();
        let json = serde_json::to_string(&m).unwrap();
        assert!(
            !json.contains("category") && !json.contains("subject"),
            "{json}"
        );
        let back = Manifest::parse(&json).unwrap();
        assert_eq!(back.category, CourseCategory::Language);

        let mut fw = sample();
        fw.id = "django".into();
        fw.category = CourseCategory::Framework;
        assert!(fw.check("0.7.0").join("\n").contains("needs a `subject`"));
        fw.subject = Some(SubjectInfo {
            id: "django".into(),
            name: "Django".into(),
            icon: String::new(),
            docs: "https://docs.djangoproject.com/".into(),
        });
        assert!(fw.check("0.7.0").is_empty(), "{:?}", fw.check("0.7.0"));
        let json = serde_json::to_string(&fw).unwrap();
        assert!(json.contains(r#""category":"framework""#), "{json}");
        assert_eq!(Manifest::parse(&json).unwrap(), fw);

        let mut bad = fw.clone();
        bad.subject.as_mut().unwrap().id = "python".into();
        bad.subject.as_mut().unwrap().docs = "http://x".into();
        let e = bad.check("0.7.0").join("\n");
        assert!(
            e.contains("same as language.id") && e.contains("https://"),
            "{e}"
        );
        let mut lang_with_subject = sample();
        lang_with_subject.subject = fw.subject.clone();
        assert!(lang_with_subject
            .check("0.7.0")
            .join("\n")
            .contains("only for framework"));
        assert!(Manifest::parse(&json.replace("framework", "library")).is_err());
    }

    #[test]
    fn caminhos_e_ids() {
        assert!(safe_relative("courses/a.toml"));
        assert!(!safe_relative("/etc/passwd"));
        assert!(!safe_relative("a/../../b"));
        assert!(valid_id("cpp") && valid_id("c-sharp"));
        assert!(!valid_id("x") && !valid_id("-a") && !valid_id("a_b"));
    }
}
