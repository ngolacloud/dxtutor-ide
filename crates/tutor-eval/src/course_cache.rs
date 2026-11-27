//! **Cache de um curso preparado uma vez** (Learn P1, P2a): a avaliação nunca vai à rede.
//!
//! Um curso com `[build] prepare = true` (ver `tutor_core::build`) usa bibliotecas de fora (o
//! Seiva, o tokio, o axum…; o Django). O avaliador corre sempre sem ir à rede, por isso essas
//! bibliotecas têm de estar numa cache local ANTES de avaliar. Esta é a única porta para a
//! rede, numa acção explícita que o humano aprova («preparar o curso»). O que corre depende do
//! gestor de pacotes da linguagem do curso ([`CacheKind`]):
//!
//! **cargo** (Rust):
//! 1. `cargo fetch` descarrega as dependências do curso para um `CARGO_HOME` só do curso
//!    (`<raiz>/<id do curso>/cargo-home`): o `~/.cargo` do utilizador não é tocado;
//! 2. `cargo test --offline --no-run` compila-as uma vez para uma pasta `target` partilhada
//!    pelos passos do curso (`<raiz>/<id>/target`), e o `Cargo.lock` resultante fica guardado.
//!
//! **pip** (Python):
//! 1. `python3 -m venv --clear <raiz>/<id>/venv` cria um venv só do curso (sem rede; o Python
//!    do utilizador não ganha pacotes);
//! 2. `pip install --require-hashes --only-binary=:all: -r requirements.txt` instala nesse venv
//!    EXACTAMENTE os pacotes fixados do curso, verificados pelo sha256 (um pacote sem hash, ou
//!    uma dependência transitiva que o curso não fixou, faz o pip recusar), só rodas (nenhum
//!    `setup.py` corre), do PyPI e sem a configuração do pip do utilizador
//!    (`PIP_CONFIG_FILE=/dev/null`) nem a sua cache (`--no-cache-dir`);
//! 3. `pip check` confirma, sem rede, que as dependências instaladas batem certo.
//!
//! **cluster** (Kubernetes, Learn P3b — `crate::kindbox`):
//! 1. descarrega o kind fixado (`kindbox::KIND_VERSION`) e verifica o SHA-256 ANTES de o guardar;
//! 2. `podman pull` da imagem do nó e das imagens dos passos, pelo digest, para um armazenamento
//!    do Podman só do curso (`<raiz>/<id>/cluster/podman`: o do utilizador não é tocado), e
//!    `podman tag` com o nome que os manifestos usam;
//! 3. `podman save` das imagens dos passos para o arquivo que o cluster carrega (`kind load`).
//!
//! Em todos, um marcador (`prepared.json`) regista a impressão digital das dependências
//! preparadas, e só uma preparação completa o escreve.
//!
//! Depois, cada avaliação de um passo deste curso corre contra essa cache (o `CARGO_HOME`, o
//! `target` e o `Cargo.lock` com `--offline`; o Python do venv com `PIP_NO_INDEX`) e com o
//! tempo limite do curso. Se o curso não foi preparado (ou as suas dependências mudaram desde
//! então), a avaliação recusa com [`NOT_PREPARED`] e diz o que fazer — nunca um erro obscuro
//! a meio.
//!
//! A raiz é `DXTUTOR_COURSE_CACHE` ou a pasta de dados do utilizador (`<data>/dxtutor/
//! course-cache`, ao lado dos plugins), partilhada pela app e pelo `dxt`. Os comandos são
//! construídos aqui ([`plan`]); quem os corre ([`prepare`]) corre exactamente esses. O plano
//! lista também os pacotes que descarrega ([`Plan::packages`]), para o diálogo de aprovação os
//! mostrar com nome e versão: um curso de terceiros pode declarar o que quiser.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tutor_core::{BuildEnv, CacheKind, CourseCache};

use crate::runner::{configure_cargo_env, run_guarded, CARGO_TIMEOUT};

/// Prefixo do erro de uma avaliação de um curso que ainda não foi preparado (a UI reconhece-o).
pub const NOT_PREPARED: &str = "COURSE_NOT_PREPARED";
/// O marcador de uma preparação completa.
pub const MARKER_FILE: &str = "prepared.json";
/// Tempo de parede de um passo com rede (`cargo fetch`, `pip install`) e de um sem rede (a
/// primeira compilação, o venv, o `pip check`).
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(600);
pub const WARM_TIMEOUT: Duration = Duration::from_secs(1200);
/// O índice de onde o pip descarrega (o curso não o escolhe: ver `tutor_core::pip_requirement`).
pub const PIP_INDEX_URL: &str = "https://pypi.org/simple";

/// Variáveis que um passo com rede (e só ele) herda além das do toolchain: proxies e
/// certificados, para descarregar atrás de um proxy empresarial.
const FETCH_ENV_ALLOW: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "CARGO_HTTP_CAINFO",
    "REQUESTS_CA_BUNDLE",
    "PIP_CERT",
];

/// A raiz das caches dos cursos: `DXTUTOR_COURSE_CACHE`, senão `<data>/dxtutor/course-cache`.
pub fn root() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("DXTUTOR_COURSE_CACHE").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    dirs::data_dir().map(|d| d.join("dxtutor").join("course-cache"))
}

/// As pastas de um curso dentro da raiz (as de cada gestor de pacotes; só se usam as do seu).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub dir: PathBuf,
    /// cargo: o `CARGO_HOME` do curso (registo, fontes git): só dele.
    pub cargo_home: PathBuf,
    /// cargo: a pasta `target` partilhada pelos passos do curso.
    pub target: PathBuf,
    /// cargo: o pacote que a preparação compila (as dependências do curso, um `lib.rs` vazio).
    pub crate_dir: PathBuf,
    /// cargo: o `Cargo.lock` da preparação, copiado para cada avaliação.
    pub lock: PathBuf,
    /// pip: o venv do curso.
    pub venv: PathBuf,
    /// pip: o `requirements.txt` que a preparação instala.
    pub requirements: PathBuf,
    /// cluster: a pasta do cluster de prática (`crate::kindbox::Sandbox`).
    pub cluster: PathBuf,
    pub marker: PathBuf,
}

impl Layout {
    /// O Python do venv do curso.
    pub fn venv_python(&self) -> PathBuf {
        if cfg!(windows) {
            self.venv.join("Scripts").join("python.exe")
        } else {
            self.venv.join("bin").join("python")
        }
    }

    /// A pasta dos executáveis do venv (vai à frente do `PATH` de uma avaliação).
    pub fn venv_bin(&self) -> PathBuf {
        self.venv
            .join(if cfg!(windows) { "Scripts" } else { "bin" })
    }

    /// O cluster de prática desta cache (só num curso de cluster).
    pub fn sandbox(&self) -> crate::kindbox::Sandbox {
        let key = self
            .dir
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();
        crate::kindbox::Sandbox::new(&self.dir, &key)
    }

    /// O que uma preparação completa deixa e a avaliação usa (além do marcador).
    fn complete(&self, kind: CacheKind) -> bool {
        match kind {
            CacheKind::Cargo => self.lock.is_file(),
            // `is_file` segue a ligação do venv para o Python que o criou: se esse Python
            // desapareceu (uma actualização do sistema), o venv já não serve.
            CacheKind::Pip => self.venv_python().is_file() && self.requirements.is_file(),
            CacheKind::Cluster => self.sandbox().prepared(),
        }
    }
}

/// Uma chave de cache segura (o id do curso): `[a-z0-9._-]`, sem começar por `.`.
pub fn key_ok(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 64
        && !key.starts_with('.')
        && key
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-'))
}

/// As pastas do curso `key` dentro de `root`.
pub fn layout(root: &Path, key: &str) -> Result<Layout> {
    if !key_ok(key) {
        bail!(
            "`{key}` is not a valid course cache key (use the course id: a-z, 0-9, `.`, `_`, `-`)"
        );
    }
    let dir = root.join(key);
    Ok(Layout {
        cargo_home: dir.join("cargo-home"),
        target: dir.join("target"),
        crate_dir: dir.join("prepare"),
        lock: dir.join("Cargo.lock"),
        venv: dir.join("venv"),
        requirements: dir.join("requirements.txt"),
        cluster: dir.join("cluster"),
        marker: dir.join(MARKER_FILE),
        dir,
    })
}

/// O gestor de pacotes da cache, ou um erro claro numa linguagem sem cache preparada.
fn kind_of(cache: &CourseCache) -> Result<CacheKind> {
    cache.kind().with_context(|| {
        format!(
            "course `{}`: a prepared course cache is not available for courses graded in `{}`",
            cache.key, cache.language
        )
    })
}

/// A impressão digital de um conjunto de dependências (a ordem não conta).
pub fn fingerprint(deps: &[String]) -> String {
    let mut lines: Vec<&str> = deps.iter().map(|d| d.trim()).collect();
    lines.sort_unstable();
    lines.dedup();
    let digest = Sha256::digest(lines.join("\n").as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// A impressão digital de uma cache: as dependências e, num curso de cluster, o que o `kindbox`
/// fixa (kind, imagem do nó) — mudar uma dessas versões obriga a preparar outra vez.
pub fn fingerprint_of(kind: CacheKind, deps: &[String]) -> String {
    match kind {
        CacheKind::Cluster => {
            let mut all = deps.to_vec();
            all.extend(crate::kindbox::pins());
            fingerprint(&all)
        }
        _ => fingerprint(deps),
    }
}

/// O que fica escrito depois de uma preparação completa.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub fingerprint: String,
    /// Segundos desde a época.
    pub prepared_at: u64,
    /// Segundos dos passos com rede (`cargo fetch`, `pip install`).
    pub fetch_secs: f64,
    /// Segundos dos passos sem rede (a primeira compilação; o venv e o `pip check`).
    pub warm_secs: f64,
    /// A ferramenta de quem preparou: `cargo --version`, ou o `python --version` do venv.
    /// (`cargo` nos marcadores escritos antes do Learn P2a.)
    #[serde(alias = "cargo")]
    pub tool: String,
}

/// O estado da cache de um curso.
#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    /// Preparado para estas dependências.
    Ready(Marker),
    /// Nunca preparado (ou a preparação não acabou).
    Missing,
    /// Preparado, mas as dependências do curso mudaram desde então (ou o que a preparação
    /// deixou já não está lá).
    Stale(Marker),
}

impl Status {
    pub fn is_ready(&self) -> bool {
        matches!(self, Status::Ready(_))
    }
}

/// O estado da cache de `cache` dentro de `root`.
pub fn status(root: &Path, cache: &CourseCache) -> Result<Status> {
    let kind = kind_of(cache)?;
    let l = layout(root, &cache.key)?;
    let marker: Option<Marker> = std::fs::read_to_string(&l.marker)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());
    Ok(match marker {
        Some(m)
            if m.fingerprint == fingerprint_of(kind, &cache.dependencies) && l.complete(kind) =>
        {
            Status::Ready(m)
        }
        Some(m) => Status::Stale(m),
        None => Status::Missing,
    })
}

/// Um pacote que a preparação descarrega, para o diálogo de aprovação (nome e versão) e o
/// relatório do `dxt`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub name: String,
    /// A versão (pip: exacta), o requisito de versão (cargo: `1`, `0.8`, `=1.2.3`), ou a
    /// referência git (`tag v0.2.0`).
    pub version: String,
    /// De onde vem: `PyPI`, `crates.io`, o URL do repositório git, `path …`.
    pub source: String,
    /// A versão é exacta (pip sempre; cargo com `=x.y.z`, uma tag ou um commit). Um requisito
    /// não exacto escolhe a versão mais recente compatível ao descarregar.
    pub pinned: bool,
}

/// Os pacotes que as linhas de dependência `deps` de uma cache `kind` descarregam.
pub fn packages(kind: CacheKind, deps: &[String]) -> Result<Vec<Package>> {
    deps.iter()
        .map(|d| match kind {
            CacheKind::Pip => {
                let r = tutor_core::pip_requirement(d).map_err(anyhow::Error::msg)?;
                Ok(Package {
                    name: r.name,
                    version: r.version,
                    source: "PyPI".into(),
                    pinned: true,
                })
            }
            CacheKind::Cargo => Ok(cargo_package(d)),
            CacheKind::Cluster => {
                let r = tutor_core::image_reference(d).map_err(anyhow::Error::msg)?;
                Ok(Package {
                    name: format!("{}/{}", r.registry, r.repository),
                    version: r.tag,
                    source: r.registry,
                    pinned: true,
                })
            }
        })
        .collect()
}

/// Os pacotes de uma cache: as dependências e, num curso de cluster, o kind e a imagem do nó.
pub fn cache_packages(kind: CacheKind, deps: &[String]) -> Result<Vec<Package>> {
    let mut out = Vec::new();
    if kind == CacheKind::Cluster {
        let node =
            tutor_core::image_reference(crate::kindbox::NODE_IMAGE).map_err(anyhow::Error::msg)?;
        out.push(Package {
            name: "kind".into(),
            version: crate::kindbox::KIND_VERSION.into(),
            source: "GitHub release (sha256-checked)".into(),
            pinned: true,
        });
        out.push(Package {
            name: format!("{}/{}", node.registry, node.repository),
            version: node.tag,
            source: node.registry,
            pinned: true,
        });
    }
    out.extend(packages(kind, deps)?);
    Ok(out)
}

/// Uma linha de `[dependencies]` como pacote (o melhor que se consegue ler; uma linha que não
/// se lê fica com o texto todo no nome, para nunca esconder nada).
fn cargo_package(line: &str) -> Package {
    let raw = Package {
        name: line.trim().to_string(),
        version: String::new(),
        source: String::new(),
        pinned: false,
    };
    let Ok(table) = toml::from_str::<toml::Table>(line) else {
        return raw;
    };
    let Some((key, value)) = table.iter().next().filter(|_| table.len() == 1) else {
        return raw;
    };
    let text = |t: &toml::Table, k: &str| t.get(k).and_then(|v| v.as_str()).map(str::to_string);
    match value {
        toml::Value::String(v) => Package {
            name: key.clone(),
            version: v.clone(),
            source: "crates.io".into(),
            pinned: v.trim_start().starts_with('='),
        },
        toml::Value::Table(t) => {
            let name = text(t, "package").unwrap_or_else(|| key.clone());
            if let Some(git) = text(t, "git") {
                let (version, pinned) = if let Some(tag) = text(t, "tag") {
                    (format!("tag {tag}"), true)
                } else if let Some(rev) = text(t, "rev") {
                    (format!("rev {rev}"), true)
                } else if let Some(branch) = text(t, "branch") {
                    (format!("branch {branch}"), false)
                } else {
                    ("default branch".into(), false)
                };
                Package {
                    name,
                    version,
                    source: git,
                    pinned,
                }
            } else if let Some(path) = text(t, "path") {
                Package {
                    name,
                    version: text(t, "version").unwrap_or_default(),
                    source: format!("path {path}"),
                    pinned: true,
                }
            } else {
                let version = text(t, "version").unwrap_or_default();
                Package {
                    name,
                    pinned: version.trim_start().starts_with('='),
                    version,
                    source: text(t, "registry").unwrap_or_else(|| "crates.io".into()),
                }
            }
        }
        _ => raw,
    }
}

/// Um comando da preparação, tal como corre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanStep {
    /// O programa (`cargo`, ou o caminho absoluto de um Python).
    pub program: String,
    pub args: Vec<String>,
    /// Variáveis definidas para este comando (além do ambiente mínimo do avaliador).
    pub env: BTreeMap<String, String>,
    /// Só o `cargo fetch`, o `pip install`, o download do kind e os `podman pull` usam a rede.
    pub network: bool,
    /// cluster: um ficheiro que a preparação descarrega ela própria e verifica pelo SHA-256 (o
    /// kind), em vez de correr um programa.
    pub download: Option<crate::kindbox::Download>,
}

/// A preparação de um curso: os comandos, a pasta onde correm e o texto exacto a aprovar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub key: String,
    pub kind: CacheKind,
    pub layout: Layout,
    /// As linhas de dependência que a preparação descarrega e compila/instala.
    pub dependencies: Vec<String>,
    /// Os pacotes dessas linhas (nome e versão), para o diálogo de aprovação.
    pub packages: Vec<Package>,
    /// O ficheiro que a preparação escreve antes de correr: o `Cargo.toml` (cargo) ou o
    /// `requirements.txt` (pip).
    pub manifest: String,
    /// A pasta onde os comandos correm.
    pub cwd: PathBuf,
    pub steps: Vec<PlanStep>,
    /// O que o diálogo de aprovação mostra (e o registo de auditoria guarda): as dependências e
    /// os comandos, com as variáveis e a pasta.
    pub command: String,
}

fn quote(p: &Path) -> String {
    let s = p.display().to_string();
    if s.chars().all(|c| {
        c.is_ascii_alphanumeric()
            || matches!(c, '/' | '.' | '_' | '-' | '+' | '@' | ':' | '=' | ',')
    }) {
        s
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// O `Cargo.toml` do pacote que a preparação compila.
fn prepare_manifest(deps: &[String]) -> String {
    format!(
        "[package]\nname = \"student\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n{}",
        crate::runner::cargo_deps_toml(deps)
    )
}

/// O Python com que a preparação cria o venv: o `python3` do `PATH` (o mesmo que o descritor
/// Python usa), senão `/usr/bin/python3`.
pub fn host_python() -> Option<PathBuf> {
    crate::plugin::find_on_path("python3")
        .or_else(|| Some(PathBuf::from("/usr/bin/python3")).filter(|p| p.is_file()))
}

/// Constrói a preparação de `cache` em `root` (não corre nada). Num curso Python, o venv
/// cria-se com [`host_python`].
pub fn plan(root: &Path, cache: &CourseCache) -> Result<Plan> {
    let python = match cache.kind() {
        Some(CacheKind::Pip) => host_python().context(
            "python3 was not found on the PATH: install Python 3 (with its venv module) to prepare this course",
        )?,
        _ => PathBuf::from("python3"),
    };
    plan_with(root, cache, &python)
}

/// [`plan`] com o Python dado (os testes fixam-no).
pub fn plan_with(root: &Path, cache: &CourseCache, python: &Path) -> Result<Plan> {
    let kind = kind_of(cache)?;
    if cache.dependencies.is_empty() {
        bail!("course `{}` has no dependencies to prepare", cache.key);
    }
    let l = layout(root, &cache.key)?;
    let packages = cache_packages(kind, &cache.dependencies)?;
    let (cwd, steps, manifest, header) = match kind {
        CacheKind::Cargo => cargo_steps(&l, &cache.dependencies),
        CacheKind::Pip => pip_steps(&l, &cache.dependencies, python)?,
        CacheKind::Cluster => cluster_steps(&l, &cache.dependencies)?,
    };
    let mut command = header;
    command.push_str(&format!("cd {}\n", quote(&cwd)));
    for s in &steps {
        if let Some(d) = &s.download {
            command.push_str(&format!(
                "download {}\ncheck    sha256 {}\ninto     {}\n",
                d.url,
                d.sha256,
                quote(&d.dest)
            ));
            continue;
        }
        let vars: Vec<String> = s
            .env
            .iter()
            .map(|(k, v)| format!("{k}={}", quote(Path::new(v))))
            .collect();
        let args: Vec<String> = s.args.iter().map(|a| quote(Path::new(a))).collect();
        let mut line = vars.join(" ");
        if !line.is_empty() {
            line.push(' ');
        }
        line.push_str(&quote(Path::new(&s.program)));
        line.push(' ');
        line.push_str(&args.join(" "));
        command.push_str(&line);
        command.push('\n');
    }
    Ok(Plan {
        key: cache.key.clone(),
        kind,
        layout: l,
        dependencies: cache.dependencies.clone(),
        packages,
        manifest,
        cwd,
        steps,
        command: command.trim_end().to_string(),
    })
}

type Steps = (PathBuf, Vec<PlanStep>, String, String);

fn cluster_steps(l: &Layout, deps: &[String]) -> Result<Steps> {
    let sb = l.sandbox();
    let podman = crate::kindbox::podman_program()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| "podman".into());
    let steps = crate::kindbox::plan_steps(&sb, deps)?
        .into_iter()
        .map(|s| PlanStep {
            program: if s.download.is_some() {
                String::new()
            } else {
                podman.clone()
            },
            args: s.args,
            env: BTreeMap::new(),
            network: s.network,
            download: s.download,
        })
        .collect();
    let mut manifest = String::new();
    for d in deps {
        manifest.push_str(d.trim());
        manifest.push('\n');
    }
    Ok((
        sb.dir.clone(),
        steps,
        manifest,
        crate::kindbox::plan_header(&sb, deps),
    ))
}

fn cargo_steps(l: &Layout, deps: &[String]) -> Steps {
    let home = l.cargo_home.display().to_string();
    let target = l.target.display().to_string();
    let fetch = PlanStep {
        program: "cargo".into(),
        args: vec!["fetch".into()],
        env: BTreeMap::from([("CARGO_HOME".into(), home.clone())]),
        network: true,
        download: None,
    };
    let warm = PlanStep {
        program: "cargo".into(),
        args: vec!["test".into(), "--offline".into(), "--no-run".into()],
        env: BTreeMap::from([
            ("CARGO_HOME".into(), home),
            ("CARGO_TARGET_DIR".into(), target),
        ]),
        network: false,
        download: None,
    };
    let mut header = String::from("# Cargo.toml [dependencies] of the course\n");
    for d in deps {
        header.push_str("#   ");
        header.push_str(d.trim());
        header.push('\n');
    }
    (
        l.crate_dir.clone(),
        vec![fetch, warm],
        prepare_manifest(deps),
        header,
    )
}

fn pip_steps(l: &Layout, deps: &[String], python: &Path) -> Result<Steps> {
    let mut manifest = String::new();
    for d in deps {
        let r = tutor_core::pip_requirement(d).map_err(anyhow::Error::msg)?;
        manifest.push_str(&r.line());
        manifest.push('\n');
    }
    let venv_python = l.venv_python().display().to_string();
    let quiet = BTreeMap::from([("PIP_CONFIG_FILE".to_string(), "/dev/null".to_string())]);
    let venv = PlanStep {
        program: python.display().to_string(),
        args: vec![
            "-m".into(),
            "venv".into(),
            "--clear".into(),
            l.venv.display().to_string(),
        ],
        env: BTreeMap::new(),
        network: false,
        download: None,
    };
    let install = PlanStep {
        program: venv_python.clone(),
        args: [
            "-m",
            "pip",
            "install",
            "--require-hashes",
            "--only-binary=:all:",
            "--no-cache-dir",
            "--no-input",
            "--disable-pip-version-check",
            "--index-url",
            PIP_INDEX_URL,
            "-r",
        ]
        .iter()
        .map(|a| a.to_string())
        .chain([l.requirements.display().to_string()])
        .collect(),
        env: quiet.clone(),
        network: true,
        download: None,
    };
    let check = PlanStep {
        program: venv_python,
        args: ["-m", "pip", "check", "--disable-pip-version-check"]
            .iter()
            .map(|a| a.to_string())
            .collect(),
        env: quiet,
        network: false,
        download: None,
    };
    let mut header = String::from(
        "# requirements.txt of the course: exact versions, sha256-checked, wheels only\n",
    );
    for line in manifest.lines() {
        header.push_str("#   ");
        header.push_str(line);
        header.push('\n');
    }
    Ok((l.dir.clone(), vec![venv, install, check], manifest, header))
}

/// O resultado de uma preparação.
#[derive(Debug, Clone, PartialEq)]
pub struct Prepared {
    pub ok: bool,
    pub marker: Option<Marker>,
    /// A saída dos comandos (stdout+stderr), para mostrar quando falha.
    pub output: String,
}

/// A primeira linha não vazia de `program --version` (stdout, senão stderr).
fn tool_version(mut cmd: Command) -> String {
    cmd.arg("--version");
    cmd.output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let out = String::from_utf8_lossy(&o.stdout).to_string()
                + &String::from_utf8_lossy(&o.stderr);
            out.lines()
                .map(str::trim)
                .find(|l| !l.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_default()
}

/// O ambiente mínimo de um comando Python de uma preparação ou avaliação: nada herdado além
/// do `PATH` de base (com os executáveis do venv à frente quando há um), `HOME` dentro da
/// cache do curso (o pip não lê a configuração do utilizador) e a língua.
fn configure_python_env(cmd: &mut Command, l: &Layout) {
    cmd.env_clear();
    cmd.env(
        "PATH",
        format!("{}:/usr/local/bin:/usr/bin:/bin", l.venv_bin().display()),
    );
    cmd.env("HOME", &l.dir);
    cmd.env("LANG", "C.UTF-8");
    cmd.env("PYTHONNOUSERSITE", "1");
    if let Ok(tmp) = std::env::var("TMPDIR") {
        cmd.env("TMPDIR", tmp);
    }
}

/// Uma preparação de cada vez neste processo (o cargo também tranca as pastas).
static PREPARING: Mutex<()> = Mutex::new(());

/// Corre a preparação `plan` (os comandos que [`plan`] construiu, e só esses). O marcador só é
/// escrito quando todos os passos acabam bem; uma preparação falhada deixa o curso por preparar.
pub fn prepare(plan: &Plan) -> Result<Prepared> {
    let _one = PREPARING.lock().unwrap_or_else(|p| p.into_inner());
    let l = &plan.layout;
    std::fs::create_dir_all(&plan.cwd).context("create the course cache folder")?;
    match plan.kind {
        CacheKind::Cargo => {
            std::fs::create_dir_all(l.crate_dir.join("src"))
                .context("create the course cache folder")?;
            std::fs::write(l.crate_dir.join("Cargo.toml"), &plan.manifest)?;
            std::fs::write(l.crate_dir.join("src/lib.rs"), "")?;
        }
        CacheKind::Pip => std::fs::write(&l.requirements, &plan.manifest)?,
        CacheKind::Cluster => {
            if crate::kindbox::podman_program().is_none() {
                bail!("{}", crate::kindbox::PODMAN_HINT);
            }
            crate::kindbox::podman::init(&l.sandbox())?;
        }
    }
    // A cluster course: a cluster made from the previous preparation goes first (the node image
    // or the images may change), and nobody grades while the images are replaced.
    let _cluster_lock = match plan.kind {
        CacheKind::Cluster => {
            let sb = l.sandbox();
            let lock = crate::kindbox::lock(&sb)?;
            crate::kindbox::delete_cluster(&sb)?;
            Some(lock)
        }
        _ => None,
    };
    // A marca de antes deixa de valer: só uma preparação completa a volta a escrever.
    let _ = std::fs::remove_file(&l.marker);

    let mut output = String::new();
    let (mut fetch_secs, mut warm_secs) = (0.0, 0.0);
    let sandbox = l.sandbox();
    let result = (|| -> Result<Option<Prepared>> {
        for (i, step) in plan.steps.iter().enumerate() {
            if let Some(d) = &step.download {
                let t0 = Instant::now();
                output.push_str(&format!("$ download {} (sha256 {})\n", d.url, d.sha256));
                let r = crate::kindbox::download_checked(d, &crate::lspinstall::http_fetch);
                fetch_secs += t0.elapsed().as_secs_f64();
                if let Err(e) = r {
                    output.push_str(&e);
                    output.push('\n');
                    return Ok(Some(Prepared {
                        ok: false,
                        marker: None,
                        output: output.clone(),
                    }));
                }
                continue;
            }
            let mut cmd = match plan.kind {
                CacheKind::Cluster => crate::kindbox::command(
                    &sandbox,
                    Path::new(&step.program),
                    &step.args,
                    step.network,
                ),
                _ => {
                    let mut c = Command::new(&step.program);
                    c.args(&step.args);
                    c
                }
            };
            cmd.current_dir(&plan.cwd);
            match plan.kind {
                CacheKind::Cargo => configure_cargo_env(&mut cmd),
                CacheKind::Pip => configure_python_env(&mut cmd, l),
                CacheKind::Cluster => {}
            }
            if step.network {
                cmd.env_remove("CARGO_NET_OFFLINE");
                for key in FETCH_ENV_ALLOW {
                    if let Ok(v) = std::env::var(key) {
                        cmd.env(key, v);
                    }
                }
            }
            for (k, v) in &step.env {
                cmd.env(k, v);
            }
            let timeout = if step.network {
                FETCH_TIMEOUT
            } else {
                WARM_TIMEOUT
            };
            let shown = format!(
                "{} {}",
                Path::new(&step.program)
                    .file_name()
                    .map(|f| f.to_string_lossy().into_owned())
                    .unwrap_or_else(|| step.program.clone()),
                step.args.join(" ")
            );
            let t0 = Instant::now();
            let out = run_guarded(cmd, &l.dir, &format!("prepare-{i}"), timeout, None)
                .with_context(|| format!("run `{shown}`"))?;
            let secs = t0.elapsed().as_secs_f64();
            if step.network {
                fetch_secs += secs;
            } else {
                warm_secs += secs;
            }
            output.push_str(&format!("$ {shown}\n"));
            output.push_str(&out.stdout);
            output.push_str(&out.stderr);
            if out.timed_out {
                output.push_str(&format!("\ntimed out after {}s\n", timeout.as_secs()));
            }
            if out.timed_out || !out.status.map(|s| s.success()).unwrap_or(false) {
                return Ok(Some(Prepared {
                    ok: false,
                    marker: None,
                    output: output.clone(),
                }));
            }
        }
        Ok(None)
    })();
    if plan.kind == CacheKind::Cluster {
        // Nothing of the sandbox keeps running after the preparation (Podman's pause process,
        // its runtime folder): no cluster exists now.
        crate::kindbox::podman::stop_pause(&sandbox);
        let _ = std::fs::remove_dir_all(&sandbox.runtime);
    }
    if let Some(failed) = result? {
        return Ok(failed);
    }
    let tool = match plan.kind {
        CacheKind::Cargo => {
            std::fs::copy(l.crate_dir.join("Cargo.lock"), &l.lock)
                .context("keep the Cargo.lock")?;
            let mut cmd = Command::new("cargo");
            configure_cargo_env(&mut cmd);
            tool_version(cmd)
        }
        CacheKind::Pip => {
            let mut cmd = Command::new(l.venv_python());
            configure_python_env(&mut cmd, l);
            tool_version(cmd)
        }
        CacheKind::Cluster => {
            let v = crate::kindbox::versions(&sandbox);
            format!(
                "{} · {}",
                v.get("kind").cloned().unwrap_or_default(),
                v.get("podman").cloned().unwrap_or_default()
            )
        }
    };
    let marker = Marker {
        fingerprint: fingerprint_of(plan.kind, &plan.dependencies),
        prepared_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        fetch_secs,
        warm_secs,
        tool,
    };
    let tmp = l.dir.join(format!("{MARKER_FILE}.tmp"));
    std::fs::write(&tmp, serde_json::to_vec_pretty(&marker)?)?;
    std::fs::rename(&tmp, &l.marker)?;
    Ok(Prepared {
        ok: true,
        marker: Some(marker),
        output,
    })
}

/// O tempo limite de cada avaliação de um curso: o seu `timeout_secs` (dentro dos limites) ou
/// `default`.
pub(crate) fn course_timeout(build: &BuildEnv, default: Duration) -> Duration {
    match build.timeout_secs {
        0 => default,
        s => Duration::from_secs(s.clamp(
            tutor_core::build::MIN_TIMEOUT_SECS,
            tutor_core::build::MAX_TIMEOUT_SECS,
        )),
    }
}

/// As pastas da cache preparada de `build` (`None` num curso sem cache), recusando com
/// [`NOT_PREPARED`] uma que não está pronta e com um erro claro uma de outro gestor de pacotes.
/// O cluster de prática de um passo ao vivo de um curso de cluster preparado (`None` num curso
/// sem cache); recusa com [`NOT_PREPARED`] um curso que não está pronto.
pub fn cluster_sandbox_in(
    root: Option<&Path>,
    build: &BuildEnv,
) -> Result<Option<crate::kindbox::Sandbox>> {
    Ok(ready_layout(root, build, CacheKind::Cluster)?.map(|l| l.sandbox()))
}

/// [`cluster_sandbox_in`] na raiz das caches.
pub fn cluster_sandbox(build: &BuildEnv) -> Result<Option<crate::kindbox::Sandbox>> {
    cluster_sandbox_in(root().as_deref(), build)
}

fn ready_layout(root: Option<&Path>, build: &BuildEnv, want: CacheKind) -> Result<Option<Layout>> {
    let Some(cache) = &build.cache else {
        return Ok(None);
    };
    let kind = kind_of(cache)?;
    if kind != want {
        bail!(
            "course `{}` prepares a {} cache, which this evaluator ({}) cannot use",
            cache.key,
            kind.as_str(),
            want.as_str()
        );
    }
    let Some(root) = root else {
        bail!("{NOT_PREPARED}: course `{}`: cannot find the user data folder for the course cache (set DXTUTOR_COURSE_CACHE)", cache.key);
    };
    match status(root, cache)? {
        Status::Ready(_) => Ok(Some(layout(root, &cache.key)?)),
        Status::Missing => bail!("{}", not_prepared_message(&cache.key, false)),
        Status::Stale(_) => bail!("{}", not_prepared_message(&cache.key, true)),
    }
}

/// Como o cargo corre para avaliar um passo: a cache do curso (quando o curso a tem) e o tempo
/// limite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CargoEnv {
    pub(crate) cache: Option<Layout>,
    pub(crate) timeout: Duration,
}

impl CargoEnv {
    /// Aplica a cache ao comando (`CARGO_HOME`, `CARGO_TARGET_DIR`; a rede já vem cortada).
    pub(crate) fn apply(&self, cmd: &mut Command) {
        if let Some(l) = &self.cache {
            cmd.arg("--offline");
            cmd.env("CARGO_HOME", &l.cargo_home);
            cmd.env("CARGO_TARGET_DIR", &l.target);
        }
    }

    /// Copia o `Cargo.lock` preparado para a pasta da avaliação (as versões são as que se
    /// compilaram na preparação), salvo se a árvore do aluno já trouxer um.
    pub(crate) fn seed_lock(&self, root: &Path) -> Result<()> {
        if let Some(l) = &self.cache {
            let dst = root.join("Cargo.lock");
            if !dst.exists() {
                std::fs::copy(&l.lock, dst).context("copy the prepared Cargo.lock")?;
            }
        }
        Ok(())
    }
}

/// O ambiente de avaliação de um passo: o normal do avaliador, ou — num curso preparado — a sua
/// cache e o seu tempo limite. Recusa com [`NOT_PREPARED`] um curso que não está pronto.
pub(crate) fn cargo_env(build: &BuildEnv) -> Result<CargoEnv> {
    cargo_env_in(root().as_deref(), build)
}

pub(crate) fn cargo_env_in(root: Option<&Path>, build: &BuildEnv) -> Result<CargoEnv> {
    Ok(CargoEnv {
        cache: ready_layout(root, build, CacheKind::Cargo)?,
        timeout: course_timeout(build, CARGO_TIMEOUT),
    })
}

/// Como o Python corre para avaliar um passo de um curso Python preparado: o venv do curso e o
/// tempo limite do curso (sem cache, `None`: o descritor usa o Python do sistema e o seu tempo
/// limite).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct PythonEnv {
    pub(crate) cache: Option<Layout>,
    /// `None` = o tempo limite do descritor.
    pub(crate) timeout: Option<Duration>,
}

impl PythonEnv {
    /// Aplica o venv a um comando já com o ambiente mínimo do descritor: os executáveis do venv
    /// à frente do `PATH` (o `python3` passa a ser o do venv), `VIRTUAL_ENV`, e o pip sem
    /// índice (`PIP_NO_INDEX`): nada do que corre na avaliação descarrega pacotes.
    pub(crate) fn apply(&self, cmd: &mut Command, base_path: &str) {
        if let Some(l) = &self.cache {
            cmd.env("PATH", format!("{}:{base_path}", l.venv_bin().display()));
            cmd.env("VIRTUAL_ENV", &l.venv);
            cmd.env("PIP_NO_INDEX", "1");
            cmd.env("PIP_CONFIG_FILE", "/dev/null");
            cmd.env("PYTHONNOUSERSITE", "1");
        }
    }
}

/// O ambiente Python de avaliação de um passo (ver [`PythonEnv`]); recusa com [`NOT_PREPARED`]
/// um curso que não está pronto.
pub(crate) fn python_env(build: &BuildEnv) -> Result<PythonEnv> {
    python_env_in(root().as_deref(), build)
}

pub(crate) fn python_env_in(root: Option<&Path>, build: &BuildEnv) -> Result<PythonEnv> {
    let cache = ready_layout(root, build, CacheKind::Pip)?;
    let timeout = (build.timeout_secs != 0).then(|| course_timeout(build, Duration::ZERO));
    Ok(PythonEnv { cache, timeout })
}

/// A mensagem de um curso por preparar: o que fazer, nas duas portas (app e `dxt`).
pub fn not_prepared_message(key: &str, stale: bool) -> String {
    format!(
        "{NOT_PREPARED}: course `{key}` {} Grading runs offline, so its dependencies must be downloaded once first: \
         use «Prepare course» in the Learning Track (or `dxt plugin prepare <course folder>`).",
        if stale {
            "changed its dependencies since it was prepared."
        } else {
            "has not been prepared yet."
        }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache(deps: &[&str]) -> CourseCache {
        CourseCache {
            key: "fw-basics".into(),
            language: "rust".into(),
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
        }
    }

    #[test]
    fn keys_are_checked_and_the_layout_stays_inside_the_root() {
        for bad in ["", "..", "../x", "a/b", ".hidden", "Seiva", "a b"] {
            assert!(layout(Path::new("/r"), bad).is_err(), "{bad}");
        }
        let l = layout(Path::new("/r"), "seiva-basics").unwrap();
        assert_eq!(l.cargo_home, Path::new("/r/seiva-basics/cargo-home"));
        assert_eq!(l.target, Path::new("/r/seiva-basics/target"));
    }

    #[test]
    fn the_plan_is_the_exact_commands_and_only_fetch_uses_the_network() {
        let c =
            cache(&[r#"seiva = { git = "https://github.com/ngolacloud/seiva", tag = "v0.2.0" }"#]);
        let p = plan(Path::new("/data/cc"), &c).unwrap();
        assert_eq!(p.steps.len(), 2);
        assert!(p.steps[0].network && !p.steps[1].network);
        assert_eq!(p.steps[1].args, ["test", "--offline", "--no-run"]);
        assert_eq!(
            p.command,
            "# Cargo.toml [dependencies] of the course\n\
             #   seiva = { git = \"https://github.com/ngolacloud/seiva\", tag = \"v0.2.0\" }\n\
             cd /data/cc/fw-basics/prepare\n\
             CARGO_HOME=/data/cc/fw-basics/cargo-home cargo fetch\n\
             CARGO_HOME=/data/cc/fw-basics/cargo-home CARGO_TARGET_DIR=/data/cc/fw-basics/target cargo test --offline --no-run"
        );
        assert_eq!(p.dependencies, c.dependencies);
        assert!(p.manifest.contains("[dependencies]\nseiva = "));
        // a folder with spaces is quoted in the shown command
        let q = plan(Path::new("/my data"), &c).unwrap();
        assert!(
            q.command.contains("cd '/my data/fw-basics/prepare'"),
            "{}",
            q.command
        );
        assert!(plan(Path::new("/r"), &cache(&[])).is_err());
    }

    #[test]
    fn grading_refuses_an_unprepared_or_changed_course_and_uses_a_ready_one() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let c = cache(&["a = \"1\""]);
        let env = BuildEnv {
            cache: Some(c.clone()),
            timeout_secs: 90,
        };
        let e = cargo_env_in(Some(root), &env).unwrap_err().to_string();
        assert!(
            e.starts_with(NOT_PREPARED) && e.contains("not been prepared"),
            "{e}"
        );

        // a complete preparation: marker + lock
        let l = layout(root, &c.key).unwrap();
        std::fs::create_dir_all(&l.dir).unwrap();
        std::fs::write(&l.lock, "# lock").unwrap();
        let m = Marker {
            fingerprint: fingerprint(&c.dependencies),
            prepared_at: 1,
            fetch_secs: 1.0,
            warm_secs: 2.0,
            tool: "cargo 1".into(),
        };
        std::fs::write(&l.marker, serde_json::to_vec(&m).unwrap()).unwrap();
        assert_eq!(status(root, &c).unwrap(), Status::Ready(m.clone()));
        let ok = cargo_env_in(Some(root), &env).unwrap();
        assert_eq!(ok.timeout, Duration::from_secs(90));
        assert_eq!(ok.cache.as_ref().unwrap().target, l.target);

        // the course changed its dependencies: stale, and grading says so
        let changed = BuildEnv {
            cache: Some(cache(&["a = \"2\""])),
            timeout_secs: 0,
        };
        assert!(matches!(
            status(root, changed.cache.as_ref().unwrap()).unwrap(),
            Status::Stale(_)
        ));
        let e = cargo_env_in(Some(root), &changed).unwrap_err().to_string();
        assert!(e.contains("changed its dependencies"), "{e}");

        // a course without a cache keeps the evaluator's environment
        let plain = cargo_env_in(None, &BuildEnv::default()).unwrap();
        assert_eq!(
            plain,
            CargoEnv {
                cache: None,
                timeout: CARGO_TIMEOUT
            }
        );
        // the order of the lines does not change the fingerprint
        assert_eq!(
            fingerprint(&["b".into(), "a".into()]),
            fingerprint(&[" a".into(), "b".into(), "b".into()])
        );
    }

    const H1: &str = "5965d974a5218a2b68a11dd1276434707f23886525c23f0598eccedaf4f4ca00";
    const H2: &str = "fe386d1c2bff7259ea95929266d12a8cf9a8b5a1c2598402967d8792e7a7c094";

    fn pip_cache() -> CourseCache {
        CourseCache {
            key: "django-basics".into(),
            language: "python".into(),
            dependencies: vec![
                format!("Django==5.2.19 --hash=sha256:{H1}"),
                format!("asgiref==3.12.1   --hash=sha256:{H2}"),
            ],
        }
    }

    #[test]
    fn the_cargo_plan_lists_each_crate_with_its_version_and_source() {
        let c = cache(&[
            r#"seiva = { git = "https://github.com/ngolacloud/seiva", tag = "v0.2.0", default-features = false }"#,
            r#"tokio = { version = "1", features = ["rt"] }"#,
            r#"axum = "0.8""#,
            r#"exact = "=1.2.3""#,
            r#"renamed = { package = "real-name", version = "2" }"#,
            r#"edge = { git = "https://example.org/edge", branch = "main" }"#,
            "not toml at all",
        ]);
        let p = plan(Path::new("/r"), &c).unwrap();
        let shown: Vec<(&str, &str, &str, bool)> = p
            .packages
            .iter()
            .map(|k| {
                (
                    k.name.as_str(),
                    k.version.as_str(),
                    k.source.as_str(),
                    k.pinned,
                )
            })
            .collect();
        assert_eq!(
            shown,
            [
                (
                    "seiva",
                    "tag v0.2.0",
                    "https://github.com/ngolacloud/seiva",
                    true
                ),
                ("tokio", "1", "crates.io", false),
                ("axum", "0.8", "crates.io", false),
                ("exact", "=1.2.3", "crates.io", true),
                ("real-name", "2", "crates.io", false),
                ("edge", "branch main", "https://example.org/edge", false),
                ("not toml at all", "", "", false),
            ]
        );
        assert_eq!(p.kind, CacheKind::Cargo);
    }

    #[test]
    fn the_pip_plan_is_a_course_venv_and_a_hash_checked_install_from_pypi() {
        let c = pip_cache();
        let p = plan_with(Path::new("/data/cc"), &c, Path::new("/usr/bin/python3")).unwrap();
        assert_eq!(p.kind, CacheKind::Pip);
        assert_eq!(p.cwd, Path::new("/data/cc/django-basics"));
        // the requirements file: normalised, exactly the pinned lines
        assert_eq!(
            p.manifest,
            format!("Django==5.2.19 --hash=sha256:{H1}\nasgiref==3.12.1 --hash=sha256:{H2}\n")
        );
        // only the install uses the network; the venv and the check do not
        let net: Vec<bool> = p.steps.iter().map(|s| s.network).collect();
        assert_eq!(net, [false, true, false]);
        assert_eq!(
            p.command,
            format!(
                "# requirements.txt of the course: exact versions, sha256-checked, wheels only\n\
                 #   Django==5.2.19 --hash=sha256:{H1}\n\
                 #   asgiref==3.12.1 --hash=sha256:{H2}\n\
                 cd /data/cc/django-basics\n\
                 /usr/bin/python3 -m venv --clear /data/cc/django-basics/venv\n\
                 PIP_CONFIG_FILE=/dev/null /data/cc/django-basics/venv/bin/python -m pip install --require-hashes --only-binary=:all: --no-cache-dir --no-input --disable-pip-version-check --index-url https://pypi.org/simple -r /data/cc/django-basics/requirements.txt\n\
                 PIP_CONFIG_FILE=/dev/null /data/cc/django-basics/venv/bin/python -m pip check --disable-pip-version-check"
            )
        );
        let names: Vec<(&str, &str, &str, bool)> = p
            .packages
            .iter()
            .map(|k| {
                (
                    k.name.as_str(),
                    k.version.as_str(),
                    k.source.as_str(),
                    k.pinned,
                )
            })
            .collect();
        assert_eq!(
            names,
            [
                ("Django", "5.2.19", "PyPI", true),
                ("asgiref", "3.12.1", "PyPI", true)
            ]
        );
        // a line that is not pinned and hashed never reaches pip
        let mut bad = pip_cache();
        bad.dependencies
            .push("evil --index-url https://evil.example".into());
        assert!(plan_with(Path::new("/r"), &bad, Path::new("/usr/bin/python3")).is_err());
        // a language without a prepared cache is refused
        let mut ts = pip_cache();
        ts.language = "typescript".into();
        let e = plan_with(Path::new("/r"), &ts, Path::new("/x"))
            .unwrap_err()
            .to_string();
        assert!(
            e.contains("not available for courses graded in `typescript`"),
            "{e}"
        );
        assert!(status(Path::new("/r"), &ts).is_err());
    }

    #[test]
    fn a_pip_cache_is_ready_only_with_its_venv_and_grading_uses_it() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let c = pip_cache();
        let build = BuildEnv {
            cache: Some(c.clone()),
            timeout_secs: 300,
        };
        let e = python_env_in(Some(root), &build).unwrap_err().to_string();
        assert!(e.starts_with(NOT_PREPARED), "{e}");

        let l = layout(root, &c.key).unwrap();
        std::fs::create_dir_all(l.venv_bin()).unwrap();
        std::fs::write(&l.requirements, "x").unwrap();
        // a marker written before Learn P2a says `cargo`: it still reads
        let old = format!(
            r#"{{"fingerprint":"{}","preparedAt":1,"fetchSecs":1.0,"warmSecs":2.0,"cargo":"cargo 1.99"}}"#,
            fingerprint(&c.dependencies)
        );
        std::fs::write(&l.marker, old).unwrap();
        // no Python in the venv yet: not usable
        assert!(matches!(status(root, &c).unwrap(), Status::Stale(_)));
        std::fs::write(l.venv_python(), "").unwrap();
        let Status::Ready(m) = status(root, &c).unwrap() else {
            panic!("ready")
        };
        assert_eq!(m.tool, "cargo 1.99");
        let env = python_env_in(Some(root), &build).unwrap();
        assert_eq!(env.cache.as_ref().unwrap().venv, l.venv);
        assert_eq!(env.timeout, Some(Duration::from_secs(300)));

        // the evaluator's variables: venv first on the PATH, no index for pip
        let mut cmd = Command::new("true");
        env.apply(&mut cmd, "/usr/bin:/bin");
        let vars: BTreeMap<String, String> = cmd
            .get_envs()
            .filter_map(|(k, v)| Some((k.to_str()?.into(), v?.to_str()?.into())))
            .collect();
        assert_eq!(
            vars["PATH"],
            format!("{}:/usr/bin:/bin", l.venv_bin().display())
        );
        assert_eq!(vars["PIP_NO_INDEX"], "1");
        assert_eq!(vars["VIRTUAL_ENV"], l.venv.display().to_string());

        // no cache: the descriptor's own interpreter and timeout
        let plain = python_env_in(None, &BuildEnv::default()).unwrap();
        assert_eq!(
            plain,
            PythonEnv {
                cache: None,
                timeout: None
            }
        );
        // a cargo cache is not a Python one
        let cargo = BuildEnv {
            cache: Some(cache(&["a = \"1\""])),
            timeout_secs: 0,
        };
        let e = python_env_in(Some(root), &cargo).unwrap_err().to_string();
        assert!(e.contains("prepares a cargo cache"), "{e}");
    }
}
