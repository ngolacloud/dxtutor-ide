//! **Construção partilhada** de um curso: as dependências que TODOS os passos usam e a forma
//! como a avaliação corre (Learn P1, emenda ao ADR-0005).
//!
//! Um curso de framework compila contra a biblioteca que ensina (Seiva, por exemplo). Repetir a
//! linha da dependência em cada passo seria pedir que divergissem; por isso o curso declara-as
//! UMA vez, na tabela `[build]`:
//!
//! ```toml
//! [build]
//! prepare = true          # as dependências descarregam-se uma vez (aprovado pelo humano)
//! timeout_secs = 180      # tempo de parede de cada compilação/teste deste curso
//! dependencies = [
//!   'seiva = { ${seiva}, default-features = false }',
//!   'seiva-testing = { ${seiva} }',
//! ]
//!
//! [build.vars]
//! # A ORIGEM, num só sítio: mudar para o crates.io é mudar esta linha.
//! seiva = 'git = "https://github.com/ngolacloud/seiva", tag = "v0.2.0"'
//! ```
//!
//! [`resolve`] corre no parse do curso ([`crate::Course::parse`]): expande as `${nome}` de
//! `[build.vars]` (nas dependências do curso e nas de cada passo; um nome desconhecido é um
//! erro), junta as dependências do curso às de cada drill/desafio (o que o avaliador escreve no
//! `Cargo.toml`) e dá a cada passo o seu [`BuildEnv`]. Assim o avaliador, o `dxt plugin test` e
//! a app vêem exactamente o mesmo.
//!
//! `prepare = true` diz que a avaliação NUNCA vai à rede: as dependências descarregam-se numa
//! acção explícita («preparar o curso», aprovada pelo humano) para uma cache do curso, e daí em
//! diante cada compilação corre offline contra essa cache (`tutor_eval::course_cache`).
//!
//! **O que é uma linha de dependência depende da linguagem que avalia** ([`CacheKind`]):
//!
//! - `rust` (cargo): uma linha de `[dependencies]` do `Cargo.toml`;
//! - `python` (pip, Learn P2a): uma linha de `requirements.txt` FIXADA e com hash —
//!   `Django==5.2.19 --hash=sha256:<64 hex>` —, e todas as dependências transitivas também
//!   (o pip corre com `--require-hashes`, que recusa o que não estiver fixado). Nada de
//!   URLs, de `-e`, de índices nem de outras opções: o curso escolhe pacotes e versões, nunca
//!   de onde vêm ([`pip_requirement`]). Num curso Python as dependências só existem numa cache
//!   preparada, por isso `dependencies` sem `prepare = true` é um erro.

use std::collections::BTreeMap;

use serde::Deserialize;

/// Limites do `timeout_secs` de um curso (segundos).
pub const MIN_TIMEOUT_SECS: u64 = 10;
pub const MAX_TIMEOUT_SECS: u64 = 1800;

/// A tabela `[build]` de um curso. Ver o cabeçalho do módulo.
#[derive(Debug, Clone, Default, Deserialize, PartialEq, Eq)]
pub struct CourseBuild {
    /// Linhas de dependência que TODOS os drills/desafios do curso usam (no Rust, linhas de
    /// `[dependencies]` do `Cargo.toml`). Podem citar `${nome}` de [`vars`](Self::vars).
    #[serde(default)]
    pub dependencies: Vec<String>,
    /// Valores com nome que as linhas de dependência citam como `${nome}`: o sítio único para o
    /// que muda (a origem de uma biblioteca, por exemplo).
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
    /// As dependências descarregam-se uma vez (acção aprovada pelo humano) e a avaliação corre
    /// sempre offline contra a cache do curso.
    #[serde(default)]
    pub prepare: bool,
    /// Tempo de parede (s) de cada compilação/teste deste curso; 0 = o do avaliador.
    #[serde(default)]
    pub timeout_secs: u64,
}

impl CourseBuild {
    /// Erros de forma da tabela (vazio = válida). A validação dos plugins usa-a.
    pub fn check(&self) -> Vec<String> {
        let mut errs = Vec::new();
        for name in self.vars.keys() {
            if !var_name_ok(name) {
                errs.push(format!(
                    "build.vars: `{name}` is not a valid name (letters, digits, `_` and `-`)"
                ));
            }
        }
        if self.timeout_secs != 0
            && !(MIN_TIMEOUT_SECS..=MAX_TIMEOUT_SECS).contains(&self.timeout_secs)
        {
            errs.push(format!(
                "build.timeout_secs must be between {MIN_TIMEOUT_SECS} and {MAX_TIMEOUT_SECS} (or 0 for the evaluator's default)"
            ));
        }
        if self.prepare && self.dependencies.is_empty() {
            errs.push(
                "build.prepare is set but build.dependencies is empty: there is nothing to prepare"
                    .into(),
            );
        }
        errs
    }
}

/// A cache de um curso que se prepara uma vez: a chave (o id do curso), a linguagem que o
/// avalia (diz o que são as linhas de dependência, [`CacheKind`]) e as dependências que a
/// preparação descarrega (as do curso e as próprias de cada passo, sem repetidos, pela ordem).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CourseCache {
    pub key: String,
    /// A linguagem do curso (`rust`, `python`): o [`CacheKind`] da cache.
    pub language: String,
    pub dependencies: Vec<String>,
}

impl CourseCache {
    /// O gestor de pacotes desta cache (`None` numa linguagem sem cache preparada).
    pub fn kind(&self) -> Option<CacheKind> {
        CacheKind::of(&self.language)
    }
}

/// O gestor de pacotes de uma cache preparada: quem descarrega as dependências e o que é uma
/// linha de dependência.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheKind {
    /// `cargo fetch` + uma compilação, para um `CARGO_HOME` e um `target` do curso.
    Cargo,
    /// Um venv do curso com `pip install --require-hashes --only-binary=:all:`.
    Pip,
}

impl CacheKind {
    /// O gestor de pacotes das caches de um curso avaliado em `language`; `None` quando a
    /// linguagem não tem cache preparada.
    pub fn of(language: &str) -> Option<CacheKind> {
        match language.trim().to_ascii_lowercase().as_str() {
            "rust" | "rs" => Some(CacheKind::Cargo),
            "python" | "py" | "python3" => Some(CacheKind::Pip),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            CacheKind::Cargo => "cargo",
            CacheKind::Pip => "pip",
        }
    }
}

/// Uma linha de `requirements.txt` de um curso Python preparado: um pacote, a versão exacta e
/// os hashes sha256 dos ficheiros aceites.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PipRequirement {
    pub name: String,
    pub version: String,
    /// Hexadecimal em minúsculas (64 caracteres cada).
    pub hashes: Vec<String>,
}

impl PipRequirement {
    /// A linha tal como vai para o `requirements.txt` (normalizada: um espaço entre partes).
    pub fn line(&self) -> String {
        let mut s = format!("{}=={}", self.name, self.version);
        for h in &self.hashes {
            s.push_str(" --hash=sha256:");
            s.push_str(h);
        }
        s
    }
}

/// Lê uma linha de dependência de um curso Python: `nome==versão --hash=sha256:<64 hex>` (um
/// ou mais hashes). Recusa tudo o resto — intervalos de versões, extras, marcadores, URLs,
/// caminhos, `-e`, `-r`, `--index-url` e qualquer outra opção —, porque a linha vai para um
/// `requirements.txt` que o pip lê: o curso diz QUE pacote e QUE ficheiro, nunca de onde.
pub fn pip_requirement(line: &str) -> Result<PipRequirement, String> {
    let mut parts = line.split_whitespace();
    let spec = parts
        .next()
        .ok_or_else(|| "an empty requirement line".to_string())?;
    let Some((name, version)) = spec.split_once("==") else {
        return Err(format!(
            "`{line}`: pin an exact version (`name==1.2.3 --hash=sha256:…`)"
        ));
    };
    let name_ok = !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name.ends_with(|c: char| c.is_ascii_alphanumeric());
    if !name_ok {
        return Err(format!("`{line}`: `{name}` is not a package name"));
    }
    let version_ok = !version.is_empty()
        && version.len() <= 64
        && version.starts_with(|c: char| c.is_ascii_digit())
        && version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '!' | '_' | '-'));
    if !version_ok {
        return Err(format!("`{line}`: `{version}` is not an exact version"));
    }
    let mut hashes = Vec::new();
    for part in parts {
        let Some(hex) = part.strip_prefix("--hash=sha256:") else {
            return Err(format!(
                "`{line}`: only `--hash=sha256:<64 hex>` may follow the version (found `{part}`)"
            ));
        };
        if hex.len() != 64 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(format!("`{line}`: `{hex}` is not a sha256 hash"));
        }
        let hex = hex.to_ascii_lowercase();
        if !hashes.contains(&hex) {
            hashes.push(hex);
        }
    }
    if hashes.is_empty() {
        return Err(format!(
            "`{line}`: add the sha256 of the file to install (`--hash=sha256:…`); grading installs with --require-hashes"
        ));
    }
    Ok(PipRequirement {
        name: name.to_string(),
        version: version.to_string(),
        hashes,
    })
}

/// O que chega ao avaliador sobre a construção de um passo (de [`CourseBuild`]). Por omissão,
/// nada: o avaliador usa o seu ambiente e os seus limites, como antes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BuildEnv {
    /// `Some` quando o curso se prepara uma vez e a avaliação corre offline contra a sua cache.
    pub cache: Option<CourseCache>,
    /// Tempo de parede (s) de cada compilação/teste; 0 = o do avaliador.
    pub timeout_secs: u64,
}

fn var_name_ok(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Expande as `${nome}` de `line` com `vars`. Um nome desconhecido ou um `${` sem `}` é um erro
/// (nunca fica um `${…}` literal num `Cargo.toml`).
pub fn expand(line: &str, vars: &BTreeMap<String, String>) -> Result<String, String> {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(i) = rest.find("${") {
        out.push_str(&rest[..i]);
        let after = &rest[i + 2..];
        let Some(j) = after.find('}') else {
            return Err(format!("`${{` without a closing `}}` in `{line}`"));
        };
        let name = &after[..j];
        match vars.get(name) {
            Some(v) => out.push_str(v),
            None => {
                return Err(format!(
                    "`${{{name}}}` in `{line}` is not defined in [build.vars]"
                ))
            }
        }
        rest = &after[j + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Junta `extra` a `base` sem repetir linhas (comparadas sem espaços nas pontas).
fn merge_into(base: &mut Vec<String>, extra: &[String]) {
    for d in extra {
        let d = d.trim();
        if !d.is_empty() && !base.iter().any(|b| b.trim() == d) {
            base.push(d.to_string());
        }
    }
}

/// Aplica a `[build]` de um curso: expande as variáveis, junta as dependências do curso às de
/// cada drill/desafio e dá a cada passo o seu [`BuildEnv`]. Ver o cabeçalho do módulo.
pub fn resolve(course: &mut crate::Course) -> Result<(), String> {
    let vars = course.build.vars.clone();
    let mut shared = Vec::new();
    for d in &course.build.dependencies {
        let line = expand(d, &vars).map_err(|e| format!("build.dependencies: {e}"))?;
        merge_into(&mut shared, &[line]);
    }
    course.build.dependencies = shared.clone();

    let mut all = shared.clone();
    for unit in &mut course.units {
        for step in &mut unit.steps {
            let mut own = Vec::new();
            for d in &step.dependencies {
                own.push(expand(d, &vars).map_err(|e| format!("step `{}`: {e}", step.id))?);
            }
            merge_into(&mut all, &own);
            if step.kind != crate::StepKind::Concept {
                let mut deps = shared.clone();
                merge_into(&mut deps, &own);
                step.dependencies = deps;
            } else {
                step.dependencies = own;
            }
        }
    }
    if CacheKind::of(&course.language) == Some(CacheKind::Pip) && !all.is_empty() {
        if !course.build.prepare {
            return Err(format!(
                "build.dependencies of a course graded in `{}` are installed only into a prepared course cache: set build.prepare = true",
                course.language
            ));
        }
        let mut names = Vec::new();
        for line in &all {
            let req = pip_requirement(line).map_err(|e| format!("build.dependencies: {e}"))?;
            let key = req.name.to_ascii_lowercase().replace(['_', '.'], "-");
            if names.contains(&key) {
                return Err(format!(
                    "build.dependencies: `{}` is pinned more than once",
                    req.name
                ));
            }
            names.push(key);
        }
    }
    let env = BuildEnv {
        cache: course.build.prepare.then(|| CourseCache {
            key: course.id.clone(),
            language: course.language.clone(),
            dependencies: all,
        }),
        timeout_secs: course.build.timeout_secs,
    };
    for unit in &mut course.units {
        for step in &mut unit.steps {
            step.build = env.clone();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Course, CourseFormat, Level};

    const COURSE: &str = r##"
id = "fw-basics"
language = "rust"
category = "framework"
subject = "fw"
title = "T"
level = "beginner"
summary = "s"

[build]
prepare = true
timeout_secs = 120
dependencies = [
  'fw = { ${fw}, default-features = false }',
  'fw-testing = { ${fw} }',
  'tokio = { version = "1", features = ["rt"] }',
]

[build.vars]
fw = 'git = "https://example.org/fw", tag = "v0.2.0"'

[[unit]]
id = "u1"
title = "U1"

[[unit.step]]
kind = "concept"
id = "c1"
title = "C"
body = "b"

[[unit.step]]
kind = "drill"
id = "d1"
title = "D"
target = "fn main() {}"
dependencies = ['serde = "1"', 'tokio = { version = "1", features = ["rt"] }']

[[unit.step]]
kind = "challenge"
id = "ch1"
title = "Ch"
instructions = "i"
entry = "f"
starter = "pub fn f() {}"
tests = "#[test] fn t() {}"
[unit.step.gabarito]
solution = "pub fn f() {}"
time = ""
space = ""
justification = ""
"##;

    #[test]
    fn the_source_is_written_once_and_reaches_every_step() {
        let c = Course::parse(COURSE, CourseFormat::Toml).expect("valid course");
        let line =
            r#"fw = { git = "https://example.org/fw", tag = "v0.2.0", default-features = false }"#;
        assert_eq!(c.build.dependencies[0], line);
        // the drill: the course's lines first, then its own (no repeats)
        let d = c.step("d1").unwrap();
        assert_eq!(d.dependencies.len(), 4, "{:?}", d.dependencies);
        assert_eq!(d.dependencies[0], line);
        assert_eq!(d.dependencies[3], r#"serde = "1""#);
        // the challenge's Phase carries the course lines and the cache
        let ch = c.step("ch1").unwrap();
        let phase = ch.as_phase("rust", Level::Basico).unwrap();
        assert_eq!(phase.dependencies, c.build.dependencies);
        let cache = phase.build.cache.as_ref().expect("a prepared course");
        assert_eq!(cache.key, "fw-basics");
        assert_eq!(cache.dependencies.len(), 4, "the union: course + serde");
        assert_eq!(phase.build.timeout_secs, 120);
        // a concept compiles nothing
        assert!(c.step("c1").unwrap().dependencies.is_empty());

        // the crates.io switch is ONE line: the var
        let published = COURSE.replace(
            r#"fw = 'git = "https://example.org/fw", tag = "v0.2.0"'"#,
            r#"fw = 'version = "0.2.0"'"#,
        );
        let p = Course::parse(&published, CourseFormat::Toml).unwrap();
        assert_eq!(
            p.build.dependencies[0],
            r#"fw = { version = "0.2.0", default-features = false }"#
        );
        assert_eq!(
            p.build.dependencies[1],
            r#"fw-testing = { version = "0.2.0" }"#
        );
    }

    #[test]
    fn unknown_vars_and_bad_tables_are_errors() {
        let bad = COURSE.replace("${fw}, default", "${nope}, default");
        let e = Course::parse(&bad, CourseFormat::Toml).unwrap_err();
        assert!(e.contains("${nope}") && e.contains("build.vars"), "{e}");
        let open = COURSE.replace("{ ${fw} }", "{ ${fw }");
        assert!(Course::parse(&open, CourseFormat::Toml).is_err());

        let b = CourseBuild {
            prepare: true,
            timeout_secs: 5,
            vars: BTreeMap::from([("a b".into(), "x".into())]),
            ..Default::default()
        };
        let errs = b.check();
        assert_eq!(errs.len(), 3, "{errs:?}");
        assert!(CourseBuild::default().check().is_empty());
    }

    const H1: &str = "5965d974a5218a2b68a11dd1276434707f23886525c23f0598eccedaf4f4ca00";
    const H2: &str = "fe386d1c2bff7259ea95929266d12a8cf9a8b5a1c2598402967d8792e7a7c094";

    #[test]
    fn a_pip_requirement_is_pinned_hashed_and_nothing_else() {
        let r = pip_requirement(&format!("Django==5.2.19 --hash=sha256:{H1}")).unwrap();
        assert_eq!((r.name.as_str(), r.version.as_str()), ("Django", "5.2.19"));
        assert_eq!(r.hashes, [H1]);
        // two hashes, upper case, extra spaces: normalised
        let two = pip_requirement(&format!(
            "  asgiref==3.12.1   --hash=sha256:{}  --hash=sha256:{H1}",
            H2.to_uppercase()
        ))
        .unwrap();
        assert_eq!(
            two.line(),
            format!("asgiref==3.12.1 --hash=sha256:{H2} --hash=sha256:{H1}")
        );
        for bad in [
            "Django".to_string(),
            "Django>=5.2".to_string(),
            format!("Django>=5.2 --hash=sha256:{H1}"),
            "Django==5.2.19".to_string(),
            format!("Django==5.2.19 --hash=md5:{}", &H1[..32]),
            format!("Django==5.2.19 --hash=sha256:{}", &H1[..60]),
            format!("Django==5.2.19 --index-url https://evil.example --hash=sha256:{H1}"),
            format!("Django==5.2.19 --hash=sha256:{H1} --extra-index-url=https://evil.example"),
            format!("django[argon2]==5.2.19 --hash=sha256:{H1}"),
            format!("Django==5.2.19;sys_platform=='linux' --hash=sha256:{H1}"),
            format!("git+https://github.com/django/django==5.2 --hash=sha256:{H1}"),
            format!("-e ./django --hash=sha256:{H1}"),
            format!("-r other.txt --hash=sha256:{H1}"),
            format!("./django.whl==1 --hash=sha256:{H1}"),
            format!("Django==5.2.* --hash=sha256:{H1}"),
            format!("Django===5.2.19 --hash=sha256:{H1}"),
        ] {
            assert!(pip_requirement(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_python_course_pins_every_package_and_only_in_a_prepared_cache() {
        let course = |build: &str| {
            format!(
                "id = \"py-fw\"\nlanguage = \"python\"\ntitle = \"T\"\nlevel = \"beginner\"\nsummary = \"s\"\n{build}\n[[unit]]\nid = \"u1\"\ntitle = \"U\"\n[[unit.step]]\nkind = \"concept\"\nid = \"c1\"\ntitle = \"C\"\nbody = \"b\"\n"
            )
        };
        let ok = course(&format!(
            "[build]\nprepare = true\ndependencies = ['Django==5.2.19 --hash=sha256:{H1}', 'asgiref==3.12.1 --hash=sha256:{H2}']"
        ));
        let c = Course::parse(&ok, CourseFormat::Toml).expect("valid");
        let cache = c.units[0].steps[0].build.cache.clone().expect("prepared");
        assert_eq!(cache.language, "python");
        assert_eq!(cache.kind(), Some(CacheKind::Pip));
        assert_eq!(cache.dependencies.len(), 2);

        let unpinned = course("[build]\nprepare = true\ndependencies = ['Django>=5']");
        let e = Course::parse(&unpinned, CourseFormat::Toml).unwrap_err();
        assert!(e.contains("exact version"), "{e}");
        let unprepared = course(&format!(
            "[build]\ndependencies = ['Django==5.2.19 --hash=sha256:{H1}']"
        ));
        let e = Course::parse(&unprepared, CourseFormat::Toml).unwrap_err();
        assert!(e.contains("build.prepare = true"), "{e}");
        let twice = course(&format!(
            "[build]\nprepare = true\ndependencies = ['Django==5.2.19 --hash=sha256:{H1}', 'django==5.2.18 --hash=sha256:{H2}']"
        ));
        let e = Course::parse(&twice, CourseFormat::Toml).unwrap_err();
        assert!(e.contains("more than once"), "{e}");

        assert_eq!(CacheKind::of("Rust"), Some(CacheKind::Cargo));
        assert_eq!(CacheKind::of("typescript"), None);
    }

    #[test]
    fn a_course_without_build_is_unchanged() {
        let c = crate::load_course("python-basics").unwrap();
        assert_eq!(c.build, CourseBuild::default());
        for s in c.units.iter().flat_map(|u| &u.steps) {
            assert_eq!(s.build, BuildEnv::default());
        }
        assert_eq!(expand("a = 1", &BTreeMap::new()).unwrap(), "a = 1");
    }
}
