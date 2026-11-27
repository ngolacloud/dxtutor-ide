//! **A avaliação de módulos Odoo** (Learn P3c): a tabela `[odoo]` do [`crate::toolcheck::CHECKS_FILE`]
//! de um passo do curso de Odoo (linguagem de avaliação `odoo`).
//!
//! Um passo destes não corre comandos escritos pelo autor: diz QUE módulos instalar, com que
//! versão do Odoo e que etiquetas de testes correr, e o avaliador (`tutor_eval::odoo_check`)
//! constrói os comandos no sandbox Podman rootless do Learn P3a — um PostgreSQL e um Odoo, das
//! imagens que «Prepare course» puxou pelo digest, o Odoo no espaço de rede do PostgreSQL
//! (`--network container:`), sem rede, com limites e etiquetas, e tudo apagado no fim.
//!
//! ```toml
//! [odoo]
//! version = "18.0"                               # a série: uma imagem `odoo:18.0-…` do curso
//! install = ["l10n_ao", "dxt_grade_l10n_ao"]     # pastas do passo com `__manifest__.py`
//! test_tags = ["/dxt_grade_l10n_ao", "/l10n_ao"] # omisso: `/<módulo>` de cada um
//! min_tests = 3                                  # «nenhum teste correu» também falha
//! message = "The module must install and its tests pass."
//! ```
//!
//! As regras de forma vivem aqui (o modelo), para a validação dos plugins e o avaliador
//! aplicarem as mesmas. Os passos do Odoo Enterprise (`enterprise = true`) só se avaliam com uma
//! pasta de addons Enterprise do utilizador ([`ENTERPRISE_ENV`]); o dxtutor nunca descarrega código
//! Enterprise.

use std::collections::BTreeSet;

use serde::Deserialize;

/// O prefixo das variáveis que apontam os addons Enterprise do utilizador, uma por série:
/// `DXTUTOR_ODOO_ENTERPRISE_18`, `_19`, `_20` (ver [`enterprise_env`]), cada uma a pasta dos módulos
/// dessa série (`hr_payroll/__manifest__.py`…). Nada está escrito no código.
pub const ENTERPRISE_ENV: &str = "DXTUTOR_ODOO_ENTERPRISE";

/// A variável dos addons Enterprise de uma série: `18.0` → `DXTUTOR_ODOO_ENTERPRISE_18`.
pub fn enterprise_env(series: &str) -> String {
    let major = series.split('.').next().unwrap_or(series);
    format!("{ENTERPRISE_ENV}_{major}")
}
/// O código de um passo Enterprise sem addons Enterprise (o `dxt plugin test` salta-o com o motivo).
pub const ENTERPRISE_MISSING: &str = "ODOO_ENTERPRISE_MISSING";
/// O repositório das imagens oficiais do Odoo e do PostgreSQL que um curso de Odoo prepara.
pub const ODOO_REPO: &str = "docker.io/library/odoo";
pub const POSTGRES_REPO: &str = "docker.io/library/postgres";
/// Máximo de módulos instalados e de etiquetas de testes por passo.
const MAX_MODULES: usize = 8;
const MAX_TAGS: usize = 16;

/// A tabela `[odoo]` de um passo.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OdooTest {
    /// A série do Odoo (`18.0`): escolhe a imagem `docker.io/library/odoo:<série>-…` do curso.
    pub version: String,
    /// Os módulos a instalar (`-i`), pela ordem; cada um é uma pasta do passo com `__manifest__.py`.
    pub install: Vec<String>,
    /// As etiquetas de testes (`--test-tags`); omisso = `/<módulo>` de cada módulo instalado.
    #[serde(default)]
    pub test_tags: Vec<String>,
    /// Quantos testes têm de correr, pelo menos (um módulo sem testes não prova nada).
    pub min_tests: u32,
    /// O passo precisa do Odoo Enterprise (ver [`ENTERPRISE_ENV`]).
    #[serde(default)]
    pub enterprise: bool,
    /// Os módulos Enterprise que o passo usa (têm de existir na pasta Enterprise da série).
    #[serde(default)]
    pub enterprise_modules: Vec<String>,
    /// Textos que o registo do Odoo NÃO pode conter (além dos avisos e erros, que já falham).
    #[serde(default)]
    pub log_lacks: Vec<String>,
    /// Textos que o registo do Odoo tem de conter.
    #[serde(default)]
    pub log_contains: Vec<String>,
    /// O tempo limite da corrida do Odoo, em segundos (omisso: o `timeout_secs` do curso).
    #[serde(default)]
    pub timeout_secs: Option<u64>,
    /// O que dizer ao aluno quando a instalação ou os testes falham.
    pub message: String,
}

/// Um nome técnico de módulo do Odoo: `[a-z][a-z0-9_]*`, até 64 caracteres.
pub fn module_name_ok(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name.starts_with(|c: char| c.is_ascii_lowercase())
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

fn ident_ok(s: &str) -> bool {
    !s.is_empty()
        && s.starts_with(|c: char| c.is_ascii_alphabetic() || c == '_')
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Uma etiqueta de testes que o avaliador aceita: `[-][tag][/módulo][:Classe][.método]`, a sintaxe
/// do `--test-tags` do Odoo (`odoo/tests/tag_selector.py`), sem vírgulas nem espaços — e com um
/// módulo, para nunca correr os testes de todo o Odoo.
pub fn test_tag_ok(tag: &str) -> bool {
    let t = tag.strip_prefix('-').unwrap_or(tag);
    let Some((tag_part, rest)) = t.split_once('/') else {
        return false;
    };
    if !tag_part.is_empty() && !ident_ok(tag_part) && tag_part != "*" {
        return false;
    }
    let (module, rest) = match rest.find([':', '.']) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    if !module_name_ok(module) {
        return false;
    }
    let (class, method) = match rest.strip_prefix(':') {
        Some(r) => match r.split_once('.') {
            Some((c, m)) => (Some(c), Some(m)),
            None => (Some(r), None),
        },
        None => (None, rest.strip_prefix('.')),
    };
    if !rest.is_empty() && !rest.starts_with([':', '.']) {
        return false;
    }
    class.is_none_or(ident_ok) && method.is_none_or(ident_ok)
}

/// `18.0`, `19.0`, `20.0`: uma série do Odoo (`<major>.0`, a partir do 16).
pub fn series_ok(v: &str) -> bool {
    match v.split_once('.') {
        Some((major, "0")) => major.parse::<u32>().is_ok_and(|m| (16..100).contains(&m)),
        _ => false,
    }
}

/// A imagem do Odoo de uma série entre as preparadas: `odoo:<série>` ou `odoo:<série>-<data>`.
pub fn odoo_image<'a>(
    images: &'a [crate::build::ImageRef],
    version: &str,
) -> Option<&'a crate::build::ImageRef> {
    images.iter().find(|i| {
        i.repo() == ODOO_REPO
            && (i.tag == version
                || i.tag
                    .strip_prefix(version)
                    .is_some_and(|r| r.starts_with('-')))
    })
}

/// A imagem do PostgreSQL entre as preparadas.
pub fn postgres_image(images: &[crate::build::ImageRef]) -> Option<&crate::build::ImageRef> {
    images.iter().find(|i| i.repo() == POSTGRES_REPO)
}

impl OdooTest {
    /// As etiquetas efectivas: as escritas, ou `/<módulo>` de cada módulo instalado.
    pub fn effective_tags(&self) -> Vec<String> {
        if self.test_tags.is_empty() {
            self.install.iter().map(|m| format!("/{m}")).collect()
        } else {
            self.test_tags.clone()
        }
    }

    /// Erros de forma (vazio = válida). `files` são os ficheiros do passo (iniciais e ocultos);
    /// `images` as imagens preparadas do curso (`None` = não verificar).
    pub fn check(
        &self,
        files: &BTreeSet<String>,
        images: Option<&[crate::build::ImageRef]>,
    ) -> Vec<String> {
        let at = "[odoo]";
        let mut errs = Vec::new();
        if !series_ok(&self.version) {
            errs.push(format!(
                "{at}: version `{}` is not an Odoo series like `18.0`",
                self.version
            ));
        } else if let Some(imgs) = images {
            if odoo_image(imgs, &self.version).is_none() {
                errs.push(format!(
                    "{at}: the course prepares no `{ODOO_REPO}:{}` image (add it to [build] dependencies)",
                    self.version
                ));
            }
            if postgres_image(imgs).is_none() {
                errs.push(format!(
                    "{at}: the course prepares no `{POSTGRES_REPO}` image (Odoo needs a database)"
                ));
            }
        }
        if self.install.is_empty() || self.install.len() > MAX_MODULES {
            errs.push(format!("{at}: install 1 to {MAX_MODULES} modules"));
        }
        let mut seen = BTreeSet::new();
        for m in &self.install {
            if !module_name_ok(m) {
                errs.push(format!("{at}: `{m}` is not a technical module name"));
            } else if !seen.insert(m.as_str()) {
                errs.push(format!("{at}: `{m}` is installed twice"));
            } else if !files.contains(&format!("{m}/__manifest__.py")) {
                errs.push(format!(
                    "{at}: `{m}/__manifest__.py` is not a file of the step (only the step's modules are installed)"
                ));
            }
        }
        if self.test_tags.len() > MAX_TAGS {
            errs.push(format!("{at}: more than {MAX_TAGS} test tags"));
        }
        for t in &self.test_tags {
            if !test_tag_ok(t) {
                errs.push(format!(
                    "{at}: test tag `{t}` is not `[-][tag]/module[:Class][.method]`"
                ));
            }
        }
        if self.min_tests == 0 {
            errs.push(format!(
                "{at}: min_tests must be at least 1 (a step without tests proves nothing)"
            ));
        }
        if self.enterprise != !self.enterprise_modules.is_empty() {
            errs.push(format!(
                "{at}: an Enterprise step names the Enterprise modules it uses (enterprise_modules), and only an Enterprise step does"
            ));
        }
        for m in &self.enterprise_modules {
            if !module_name_ok(m) {
                errs.push(format!("{at}: `{m}` is not a technical module name"));
            }
        }
        if self
            .log_lacks
            .iter()
            .chain(&self.log_contains)
            .any(|s| s.trim().is_empty())
        {
            errs.push(format!("{at}: an empty `log_lacks`/`log_contains` entry"));
        }
        if self.timeout_secs.is_some_and(|t| !(30..=1800).contains(&t)) {
            errs.push(format!("{at}: timeout_secs is between 30 and 1800"));
        }
        if self.message.trim().is_empty() {
            errs.push(format!(
                "{at}: `message` is empty (tell the learner what is checked)"
            ));
        }
        errs
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> OdooTest {
        toml::from_str(
            "version = \"18.0\"\ninstall = [\"l10n_ao\"]\nmin_tests = 1\nmessage = \"m\"\n",
        )
        .unwrap()
    }

    fn files(f: &[&str]) -> BTreeSet<String> {
        f.iter().map(|s| s.to_string()).collect()
    }

    fn images() -> Vec<crate::build::ImageRef> {
        let d = format!("sha256:{}", "a".repeat(64));
        [
            format!("docker.io/library/odoo:18.0-20261124@{d}"),
            format!("docker.io/library/postgres:17.12@{d}"),
        ]
        .iter()
        .map(|l| crate::build::image_reference(l).unwrap())
        .collect()
    }

    #[test]
    fn a_minimal_spec_is_valid_and_tags_default_to_the_modules() {
        let s = spec();
        let f = files(&["l10n_ao/__manifest__.py"]);
        assert!(
            s.check(&f, Some(&images())).is_empty(),
            "{:?}",
            s.check(&f, None)
        );
        assert_eq!(s.effective_tags(), vec!["/l10n_ao"]);
    }

    #[test]
    fn modules_must_be_folders_of_the_step_and_the_series_prepared() {
        let mut s = spec();
        s.version = "19.0".into();
        s.install.push("Bad-Name".into());
        let errs = s.check(&files(&[]), Some(&images())).join("\n");
        assert!(
            errs.contains("no `docker.io/library/odoo:19.0` image"),
            "{errs}"
        );
        assert!(
            errs.contains("`l10n_ao/__manifest__.py` is not a file"),
            "{errs}"
        );
        assert!(
            errs.contains("`Bad-Name` is not a technical module name"),
            "{errs}"
        );
    }

    #[test]
    fn test_tags_follow_the_odoo_selector_and_always_name_a_module() {
        for ok in [
            "/l10n_ao",
            "-/l10n_ao",
            "post_install/l10n_ao",
            "/l10n_ao:TestNif",
            "/l10n_ao:TestNif.test_valid",
            "/l10n_ao.test_valid",
        ] {
            assert!(test_tag_ok(ok), "{ok}");
        }
        for bad in [
            "",
            "l10n_ao",
            "/",
            "/a,b",
            "/l10n ao",
            "at_install",
            "/x:1a",
            "/x:",
        ] {
            assert!(!test_tag_ok(bad), "{bad}");
        }
    }

    #[test]
    fn each_series_has_its_own_enterprise_variable() {
        assert_eq!(enterprise_env("18.0"), "DXTUTOR_ODOO_ENTERPRISE_18");
        assert_eq!(enterprise_env("20.0"), "DXTUTOR_ODOO_ENTERPRISE_20");
    }

    #[test]
    fn series_and_images_are_matched_by_the_tag_prefix() {
        assert!(series_ok("18.0") && series_ok("20.0"));
        assert!(!series_ok("18") && !series_ok("18.1") && !series_ok("saas-18.2"));
        let imgs = images();
        assert!(odoo_image(&imgs, "18.0").is_some());
        assert!(odoo_image(&imgs, "18").is_none());
        assert!(postgres_image(&imgs).is_some());
    }

    #[test]
    fn enterprise_steps_name_their_modules_and_messages_are_required() {
        let mut s = spec();
        s.enterprise = true;
        s.message = " ".into();
        s.min_tests = 0;
        let errs = s
            .check(&files(&["l10n_ao/__manifest__.py"]), None)
            .join("\n");
        assert!(errs.contains("enterprise_modules"), "{errs}");
        assert!(errs.contains("`message` is empty"), "{errs}");
        assert!(errs.contains("min_tests"), "{errs}");
        s.enterprise_modules = vec!["hr_payroll".into()];
        s.message = "m".into();
        s.min_tests = 2;
        assert!(s
            .check(&files(&["l10n_ao/__manifest__.py"]), None)
            .is_empty());
    }
}
