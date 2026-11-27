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
//! - `dockerfile` (imagens, Learn P3a): uma imagem base, com o nome COMPLETO, a tag e o digest —
//!   `docker.io/library/alpine:3.24.4@sha256:<64 hex>` ([`image_reference`]). A preparação puxa-a
//!   pelo digest para o armazenamento do sandbox de contentores e dá-lhe a tag (para um `FROM
//!   alpine:3.24.4` a encontrar); a avaliação nunca puxa (`--pull=never`). Como no pip, sem
//!   `prepare = true` é um erro.
//! - `yaml` (cluster, Learn P3b): uma IMAGEM de contentor que os passos ao vivo usam, com o
//!   registo, a etiqueta e o digest — `docker.io/library/nginx:1.27.5-alpine@sha256:<64 hex>`
//!   ([`image_reference`]). A preparação descarrega o kind fixado e a imagem do nó (fixados no
//!   `tutor-eval`, nunca pelo curso) e estas imagens para o armazenamento do Podman do curso; a
//!   avaliação carrega-as no cluster de prática, que nunca vai à internet.

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
    /// Imagens base fixadas pelo digest, puxadas para o sandbox de contentores (Learn P3a).
    Images,
    /// O cluster de prática dos cursos de Kubernetes (Learn P3b): o kind fixado, a imagem do nó
    /// e as imagens dos passos ao vivo, num armazenamento do Podman só do curso.
    Cluster,
}

impl CacheKind {
    /// O gestor de pacotes das caches de um curso avaliado em `language`; `None` quando a
    /// linguagem não tem cache preparada.
    pub fn of(language: &str) -> Option<CacheKind> {
        match language.trim().to_ascii_lowercase().as_str() {
            "rust" | "rs" => Some(CacheKind::Cargo),
            "python" | "py" | "python3" => Some(CacheKind::Pip),
            // O curso de Odoo (Learn P3c): as imagens do Odoo e do PostgreSQL, no mesmo sandbox.
            "dockerfile" | "containerfile" | "odoo" => Some(CacheKind::Images),
            "yaml" | "yml" => Some(CacheKind::Cluster),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            CacheKind::Cargo => "cargo",
            CacheKind::Pip => "pip",
            CacheKind::Images => "images",
            CacheKind::Cluster => "cluster",
        }
    }
}

/// Uma imagem base de um curso de contentores: registo, repositório, tag e digest (todos
/// obrigatórios: a tag dá o nome que o `FROM` usa, o digest diz exactamente o que se puxa).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct ImageRef {
    /// `docker.io`, `quay.io`, `ghcr.io`, `localhost`…
    pub registry: String,
    /// `library/alpine`, `podman/hello`…
    pub repository: String,
    pub tag: String,
    /// `sha256:<64 hex>` (em minúsculas).
    pub digest: String,
}

impl ImageRef {
    /// `docker.io/library/alpine` (sem tag nem digest).
    pub fn repo(&self) -> String {
        format!("{}/{}", self.registry, self.repository)
    }

    /// `docker.io/library/alpine:3.24.4`: o nome que a preparação lhe dá no sandbox.
    pub fn name(&self) -> String {
        format!("{}:{}", self.repo(), self.tag)
    }

    /// `docker.io/library/alpine@sha256:…`: o que a preparação puxa.
    pub fn pinned(&self) -> String {
        format!("{}@{}", self.repo(), self.digest)
    }

    /// A linha do curso: `docker.io/library/alpine:3.24.4@sha256:…`.
    pub fn line(&self) -> String {
        format!("{}@{}", self.name(), self.digest)
    }

    /// Como se escreve num `FROM` do Docker Hub (`alpine:3.24.4`, `user/app:1`); o nome completo
    /// noutro registo.
    pub fn short(&self) -> String {
        if self.registry == "docker.io" {
            let repo = self
                .repository
                .strip_prefix("library/")
                .unwrap_or(&self.repository);
            format!("{repo}:{}", self.tag)
        } else {
            self.name()
        }
    }

    /// `true` se `reference` (um `FROM`, uma imagem de um `run`) nomeia esta imagem: pelo nome e a
    /// tag (com as regras do Docker Hub para nomes curtos) ou pelo digest.
    pub fn matches(&self, reference: &str) -> bool {
        let Some(n) = normalize_image(reference) else {
            return false;
        };
        if n.repo != self.repo() {
            return false;
        }
        match (&n.tag, &n.digest) {
            (_, Some(d)) => d == &self.digest && n.tag.as_ref().is_none_or(|t| t == &self.tag),
            (Some(t), None) => t == &self.tag,
            (None, None) => false,
        }
    }
}

/// Uma referência de imagem normalizada como o Docker e o Podman a lêem: o registo (o Docker Hub
/// quando o primeiro componente não parece um host), o repositório (`library/` à frente de um nome
/// do Docker Hub sem `/`) e a tag ou o digest, se os tiver.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedImage {
    /// `docker.io/library/alpine`.
    pub repo: String,
    pub tag: Option<String>,
    pub digest: Option<String>,
}

fn path_component_ok(c: &str) -> bool {
    // [a-z0-9]+(?:(?:[._]|__|[-]*)[a-z0-9]+)*
    !c.is_empty()
        && c.len() <= 128
        && c.starts_with(|x: char| x.is_ascii_lowercase() || x.is_ascii_digit())
        && c.ends_with(|x: char| x.is_ascii_lowercase() || x.is_ascii_digit())
        && c.chars()
            .all(|x| x.is_ascii_lowercase() || x.is_ascii_digit() || matches!(x, '.' | '_' | '-'))
}

fn tag_ok(t: &str) -> bool {
    !t.is_empty()
        && t.len() <= 128
        && t.starts_with(|x: char| x.is_ascii_alphanumeric() || x == '_')
        && t.chars()
            .all(|x| x.is_ascii_alphanumeric() || matches!(x, '_' | '.' | '-'))
}

fn digest_ok(d: &str) -> bool {
    d.strip_prefix("sha256:")
        .is_some_and(|h| h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit()))
}

fn host_like(c: &str) -> bool {
    c == "localhost" || c.contains('.') || c.contains(':')
}

/// Normaliza uma referência de imagem (`alpine:3.24`, `docker.io/library/alpine@sha256:…`,
/// `quay.io/podman/hello:latest`). `None` quando não é uma referência válida (maiúsculas, `..`,
/// uma variável `$X`…). Uma referência sem tag nem digest fica sem tag (o Docker juntaria
/// `latest`; o curso exige sempre uma).
pub fn normalize_image(reference: &str) -> Option<NormalizedImage> {
    let r = reference.trim();
    if r.is_empty() || r.len() > 512 || r.chars().any(|c| c.is_whitespace() || c == '$') {
        return None;
    }
    let (rest, digest) = match r.split_once('@') {
        Some((a, d)) => {
            if !digest_ok(d) {
                return None;
            }
            (a, Some(d.to_ascii_lowercase()))
        }
        None => (r, None),
    };
    let last_slash = rest.rfind('/').map(|i| i + 1).unwrap_or(0);
    let (name, tag) = match rest[last_slash..].rfind(':') {
        Some(i) => {
            let t = &rest[last_slash + i + 1..];
            if !tag_ok(t) {
                return None;
            }
            (&rest[..last_slash + i], Some(t.to_string()))
        }
        None => (rest, None),
    };
    let mut parts: Vec<&str> = name.split('/').collect();
    let registry = if parts.len() > 1 && host_like(parts[0]) {
        let host = parts.remove(0);
        if host == "index.docker.io" {
            "docker.io".to_string()
        } else {
            host.to_ascii_lowercase()
        }
    } else {
        "docker.io".to_string()
    };
    if parts.is_empty() || !parts.iter().all(|c| path_component_ok(c)) {
        return None;
    }
    let mut repo = parts.join("/");
    if registry == "docker.io" && parts.len() == 1 {
        repo = format!("library/{repo}");
    }
    Some(NormalizedImage {
        repo: format!("{registry}/{repo}"),
        tag,
        digest,
    })
}

/// Lê uma linha de dependência de um curso de contentores: `registo/repositório:tag@sha256:<64
/// hex>`, com o registo escrito (nada de nomes curtos que dependam de uma lista de pesquisa) e a
/// tag e o digest presentes.
pub fn image_reference(line: &str) -> Result<ImageRef, String> {
    let l = line.trim();
    let first = l.split('/').next().unwrap_or("");
    if !l.contains('/') || !host_like(first) {
        return Err(format!(
            "`{l}`: write the registry in full (`docker.io/library/alpine:3.24.4@sha256:…`)"
        ));
    }
    let n = normalize_image(l).ok_or_else(|| format!("`{l}` is not an image reference"))?;
    let tag = n.tag.ok_or_else(|| {
        format!("`{l}`: add the tag that FROM lines use (`…/alpine:3.24.4@sha256:…`)")
    })?;
    let digest = n.digest.ok_or_else(|| {
        format!(
            "`{l}`: pin the image by digest (`@sha256:<64 hex>`): preparation pulls exactly that"
        )
    })?;
    let (registry, repository) = n
        .repo
        .split_once('/')
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .ok_or_else(|| format!("`{l}` is not an image reference"))?;
    Ok(ImageRef {
        registry,
        repository,
        tag,
        digest,
    })
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
    if CacheKind::of(&course.language) == Some(CacheKind::Images) && !all.is_empty() {
        if !course.build.prepare {
            return Err(format!(
                "build.dependencies of a course graded in `{}` are images pulled only into the prepared container sandbox: set build.prepare = true",
                course.language
            ));
        }
        let mut names = Vec::new();
        for line in &all {
            let img = image_reference(line).map_err(|e| format!("build.dependencies: {e}"))?;
            if names.contains(&img.name()) {
                return Err(format!(
                    "build.dependencies: `{}` is listed more than once",
                    img.name()
                ));
            }
            names.push(img.name());
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
    if CacheKind::of(&course.language) == Some(CacheKind::Cluster) && !all.is_empty() {
        if !course.build.prepare {
            return Err(format!(
                "build.dependencies of a course graded in `{}` are images preloaded into the practice cluster: set build.prepare = true",
                course.language
            ));
        }
        let mut names = Vec::new();
        for line in &all {
            let img = image_reference(line).map_err(|e| format!("build.dependencies: {e}"))?;
            // `latest` makes the kubelet pull the image on every start: the practice cluster
            // is offline, so a live step could never start it.
            if img.tag == "latest" {
                return Err(format!(
                    "build.dependencies: `{}`: `latest` makes Kubernetes pull the image every time; pin a version tag",
                    img.line()
                ));
            }
            if names.contains(&img.name()) {
                return Err(format!(
                    "build.dependencies: `{}` is listed more than once",
                    img.name()
                ));
            }
            names.push(img.name());
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

    const ALPINE: &str = "sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf";

    #[test]
    fn image_references_are_normalised_like_docker_does() {
        let n = |s: &str| normalize_image(s).map(|n| (n.repo, n.tag, n.digest));
        assert_eq!(
            n("alpine:3.24.4"),
            Some((
                "docker.io/library/alpine".into(),
                Some("3.24.4".into()),
                None
            ))
        );
        assert_eq!(
            n("user/app"),
            Some(("docker.io/user/app".into(), None, None))
        );
        assert_eq!(
            n("localhost:5000/team/app:v1"),
            Some(("localhost:5000/team/app".into(), Some("v1".into()), None))
        );
        assert_eq!(
            n(&format!("index.docker.io/library/alpine@{ALPINE}")).map(|x| x.0),
            Some("docker.io/library/alpine".into())
        );
        for bad in [
            "",
            "Alpine:3",
            "a b",
            "$BASE",
            "alpine:",
            "x@sha256:12",
            "a//b",
            "-x",
        ] {
            assert_eq!(normalize_image(bad), None, "{bad}");
        }
    }

    #[test]
    fn course_images_need_the_registry_the_tag_and_the_digest() {
        let img = image_reference(&format!("docker.io/library/alpine:3.24.4@{ALPINE}")).unwrap();
        assert_eq!(img.name(), "docker.io/library/alpine:3.24.4");
        assert_eq!(img.pinned(), format!("docker.io/library/alpine@{ALPINE}"));
        assert_eq!(img.short(), "alpine:3.24.4");
        assert!(img.matches("alpine:3.24.4"));
        assert!(img.matches("docker.io/library/alpine:3.24.4"));
        assert!(img.matches(&format!("alpine@{ALPINE}")));
        assert!(!img.matches("alpine:3.24"));
        assert!(!img.matches("alpine"));
        assert!(!img.matches("evil/alpine:3.24.4"));
        for (bad, frag) in [
            (format!("alpine:3.24.4@{ALPINE}"), "registry in full"),
            ("docker.io/library/alpine:3.24.4".to_string(), "digest"),
            (format!("docker.io/library/alpine@{ALPINE}"), "tag"),
        ] {
            let e = image_reference(&bad).unwrap_err();
            assert!(e.contains(frag), "{bad}: {e}");
        }
    }

    #[test]
    fn a_container_course_pins_its_images_and_prepares_them() {
        let course = |deps: &str, prepare: bool| {
            format!(
                "id = \"c\"\nlanguage = \"dockerfile\"\ncategory = \"tool\"\nsubject = \"podman\"\ntitle = \"T\"\nlevel = \"beginner\"\nsummary = \"s\"\n[build]\nprepare = {prepare}\ndependencies = [{deps}]\n[[unit]]\nid = \"u\"\ntitle = \"U\"\n[[unit.step]]\nkind = \"concept\"\nid = \"c1\"\ntitle = \"C\"\nbody = \"b\"\n"
            )
        };
        let ok = format!("\"docker.io/library/alpine:3.24.4@{ALPINE}\"");
        let c = Course::parse(&course(&ok, true), CourseFormat::Toml).expect("valid");
        assert_eq!(CacheKind::of(&c.language), Some(CacheKind::Images));
        let e = Course::parse(&course(&ok, false), CourseFormat::Toml).unwrap_err();
        assert!(e.to_string().contains("build.prepare"), "{e}");
        let other = ok.replace("f59a", "0000");
        let twice = format!("{ok}, {other}");
        let e = Course::parse(&course(&twice, true), CourseFormat::Toml).unwrap_err();
        assert!(e.to_string().contains("more than once"), "{e}");
        let e = Course::parse(&course("\"alpine:3.24\"", true), CourseFormat::Toml).unwrap_err();
        assert!(e.to_string().contains("registry"), "{e}");
    }

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

    const NGINX: &str = "docker.io/library/nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10";

    #[test]
    fn a_cluster_image_line_names_what_the_manifests_use_and_what_is_pulled() {
        let img = image_reference(NGINX).expect("a pinned image");
        assert_eq!(img.name(), "docker.io/library/nginx:1.27.5-alpine");
        assert_eq!(img.short(), "nginx:1.27.5-alpine");
        assert_eq!(
            img.pinned(),
            "docker.io/library/nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10"
        );
        assert!(img.matches("nginx:1.27.5-alpine"));
        assert!(img.matches("docker.io/library/nginx:1.27.5-alpine"));
        assert!(!img.matches("nginx:1.28.0-alpine") && !img.matches("nginx"));
        for bad in [
            "docker.io/library/nginx:1.27.5-alpine",
            "nginx:1.27.5-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10",
            "docker.io/library/nginx@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10",
        ] {
            assert!(image_reference(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_cluster_course_preloads_pinned_images_only_from_a_prepared_cache() {
        let course = |build: &str| {
            format!(
                "id = \"k-live\"\nlanguage = \"yaml\"\ncategory = \"tool\"\nsubject = \"k\"\ntitle = \"T\"\nlevel = \"beginner\"\nsummary = \"s\"\n{build}\n[[unit]]\nid = \"u1\"\ntitle = \"U\"\n[[unit.step]]\nkind = \"concept\"\nid = \"c1\"\ntitle = \"C\"\nbody = \"b\"\n"
            )
        };
        let ok = Course::parse(
            &course(&format!(
                "[build]\nprepare = true\ndependencies = ['{NGINX}']\n"
            )),
            CourseFormat::Toml,
        )
        .expect("a cluster course");
        let cache = ok.units[0].steps[0].build.cache.as_ref().expect("cache");
        assert_eq!(cache.kind(), Some(CacheKind::Cluster));
        assert_eq!(cache.kind().unwrap().as_str(), "cluster");
        assert_eq!(cache.dependencies, vec![NGINX.to_string()]);

        let e = Course::parse(
            &course(&format!("[build]\ndependencies = ['{NGINX}']\n")),
            CourseFormat::Toml,
        )
        .unwrap_err()
        .to_string();
        assert!(e.contains("set build.prepare = true"), "{e}");
        let e = Course::parse(
            &course("[build]\nprepare = true\ndependencies = ['docker.io/library/nginx:1']\n"),
            CourseFormat::Toml,
        )
        .unwrap_err()
        .to_string();
        assert!(e.contains("pin the image by digest"), "{e}");
        let latest = NGINX.replace("1.27.5-alpine", "latest");
        let e = Course::parse(
            &course(&format!(
                "[build]\nprepare = true\ndependencies = ['{latest}']\n"
            )),
            CourseFormat::Toml,
        )
        .unwrap_err()
        .to_string();
        assert!(e.contains("`latest` makes Kubernetes pull"), "{e}");
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
