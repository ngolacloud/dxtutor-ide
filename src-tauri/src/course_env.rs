//! Caso de uso «o ambiente do curso» (ADR-0008, F2) — **independente de Tauri**.
//!
//! Um curso instalado cujo repositório traz `.devcontainer/devcontainer.json` avalia-se no SEU contentor e não no
//! processo da IDE:
//!  - **preparar** é construir a imagem do devcontainer (`<runtime> build`), a única ida à rede, com o comando exacto
//!    aprovado no diálogo partilhado ([`plan`] / [`build`]);
//!  - **avaliar** é correr o `dxtutor-grade` dessa imagem com o pedido no stdin ([`grade`]): sem rede, raiz só de
//!    leitura, `/tmp` em memória, sem capacidades, com limites, o curso montado só de leitura em `/dxtutor/course`
//!    e nada da pasta do aluno (os ficheiros vão dentro do pedido).
//!
//! Um curso sem `.devcontainer/` continua no caminho antigo (`study::grade_in`) até à F4.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use tutor_core::grade::{GradeReport, GradeRequest};

/// Onde o avaliador vê o curso, no contentor (o `tutor_grade::DEFAULT_COURSE_DIR`).
pub const COURSE_MOUNT: &str = "/dxtutor/course";
/// O tempo limite de uma avaliação quando o curso não diz outro (inclui arrancar o contentor).
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);
/// O prefixo com que se recusa avaliar um curso por preparar (a UI oferece «Prepare course»).
pub const NOT_PREPARED: &str = "COURSE_NOT_PREPARED";

/// Os limites do contentor de uma avaliação.
const MEMORY: &str = "1g";
const PIDS: &str = "512";
const CPUS: &str = "2";
const TMPFS: &str = "/tmp:rw,exec,nosuid,size=1g";

/// Um runtime de contentores: o programa e o nome (`podman` ou `docker`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Runtime {
    pub name: String,
    pub program: PathBuf,
}

impl Runtime {
    /// O primeiro runtime na PATH da shell de login: podman, depois docker.
    pub fn detect() -> Option<Runtime> {
        let path = crate::shellenv::get()
            .get("PATH")
            .cloned()
            .unwrap_or_default();
        ["podman", "docker"].iter().find_map(|name| {
            std::env::split_paths(&path)
                .map(|d| d.join(name))
                .find(|c| c.is_file())
                .map(|program| Runtime {
                    name: (*name).to_string(),
                    program,
                })
        })
    }

    fn command(&self) -> Command {
        let mut c = Command::new(&self.program);
        c.env_clear().envs(crate::shellenv::get().iter());
        c.stdin(Stdio::null());
        c
    }
}

/// O que falta à máquina para avaliar no contentor, em palavras para o humano.
pub const NO_RUNTIME: &str = "no container runtime found: install Podman (recommended) or Docker — this course is graded in its own container";

/// O ambiente de um curso instalado com `.devcontainer/`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CourseEnv {
    pub course_id: String,
    /// A pasta do plugin instalado (montada só de leitura no contentor).
    pub plugin_dir: PathBuf,
    /// O `Containerfile`/`Dockerfile` e o contexto do build (do `devcontainer.json`).
    pub dockerfile: PathBuf,
    pub context: PathBuf,
    /// A etiqueta local da imagem: o id do curso e o hash do contexto (um curso mudado é outra imagem).
    pub tag: String,
    /// As imagens base (`FROM`), para o diálogo de aprovação.
    pub bases: Vec<String>,
}

/// Erros do ambiente do curso, com a mensagem que a UI mostra.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvError {
    NoRuntime,
    /// O `devcontainer.json` não serve (o sítio e o porquê).
    Config(String),
    /// A imagem ainda não foi construída.
    NotPrepared(String),
    /// O comando aprovado não é o plano de agora.
    StalePlan,
    /// O runtime falhou (a saída anexada).
    Runtime(String),
    /// O avaliador respondeu com um erro (o código e a mensagem dele).
    Grade(String),
}

impl std::fmt::Display for EnvError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EnvError::NoRuntime => f.write_str(NO_RUNTIME),
            EnvError::Config(m) => write!(f, "the course's devcontainer: {m}"),
            EnvError::NotPrepared(id) => write!(
                f,
                "{NOT_PREPARED}: the container image of course `{id}` is not built yet — «Prepare course» builds it once"
            ),
            EnvError::StalePlan => f.write_str(
                "the approved command is not this course's current preparation; ask again",
            ),
            EnvError::Runtime(m) | EnvError::Grade(m) => f.write_str(m),
        }
    }
}

/// O ambiente do curso `course_id`, se algum plugin instalado em `store` o traz com um `.devcontainer/`.
pub fn find(store: &tutor_plugins::Store, course_id: &str) -> Result<Option<CourseEnv>, EnvError> {
    for item in store.list() {
        if item.manifest.is_none() {
            continue;
        }
        let dir = store.root().join(&item.entry.id);
        if !dir.join(".devcontainer").is_dir() {
            continue;
        }
        let Ok((_, courses)) = tutor_plugins::load_dir(&dir) else {
            continue;
        };
        if courses.iter().any(|c| c.id == course_id) {
            return of_dir(&dir, course_id).map(Some);
        }
    }
    Ok(None)
}

/// O ambiente descrito pelo `.devcontainer/devcontainer.json` da pasta `dir`.
pub fn of_dir(dir: &Path, course_id: &str) -> Result<CourseEnv, EnvError> {
    let cfg_dir = dir.join(".devcontainer");
    let raw = std::fs::read_to_string(cfg_dir.join("devcontainer.json"))
        .map_err(|e| EnvError::Config(format!("devcontainer.json: {e}")))?;
    let v: serde_json::Value = serde_json::from_str(&crate::devcontainer::strip_jsonc(&raw))
        .map_err(|e| EnvError::Config(format!("devcontainer.json: {e}")))?;
    let build = v.get("build").ok_or_else(|| {
        EnvError::Config(
            "needs a `build` with a `dockerfile` (the grader comes in by COPY --from)".into(),
        )
    })?;
    let dockerfile = build
        .get("dockerfile")
        .and_then(|d| d.as_str())
        .ok_or_else(|| EnvError::Config("`build.dockerfile` is missing".into()))?;
    let context = build.get("context").and_then(|c| c.as_str()).unwrap_or(".");
    let dockerfile = inside(dir, &cfg_dir.join(dockerfile), "build.dockerfile")?;
    let context = inside(dir, &cfg_dir.join(context), "build.context")?;
    let containerfile = std::fs::read_to_string(&dockerfile)
        .map_err(|e| EnvError::Config(format!("{}: {e}", dockerfile.display())))?;
    let bases = bases_of(&containerfile);
    let unpinned: Vec<&String> = bases.iter().filter(|b| !b.contains("@sha256:")).collect();
    if !unpinned.is_empty() {
        return Err(EnvError::Config(format!(
            "every base image must be pinned by digest (`image:tag@sha256:…`); not pinned: {}",
            unpinned
                .iter()
                .map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        )));
    }
    let tag = format!(
        "localhost/dxtutor-course-{}:{}",
        sanitize(course_id),
        &context_hash(&context, &dockerfile)?[..16]
    );
    Ok(CourseEnv {
        course_id: course_id.to_string(),
        plugin_dir: dir.to_path_buf(),
        dockerfile,
        context,
        tag,
        bases,
    })
}

/// Um caminho do `devcontainer.json`, resolvido e dentro da pasta do plugin.
fn inside(root: &Path, p: &Path, what: &str) -> Result<PathBuf, EnvError> {
    let root = root
        .canonicalize()
        .map_err(|e| EnvError::Config(format!("{}: {e}", root.display())))?;
    let p = p
        .canonicalize()
        .map_err(|e| EnvError::Config(format!("{what}: {e}")))?;
    if !p.starts_with(&root) {
        return Err(EnvError::Config(format!(
            "{what} points outside the course"
        )));
    }
    Ok(p)
}

/// As imagens dos `FROM` (sem as fases internas: `FROM build AS x` quando `build` é uma fase anterior) e dos
/// `COPY --from=<imagem>`.
pub fn bases_of(containerfile: &str) -> Vec<String> {
    let mut stages: Vec<String> = Vec::new();
    let mut out: Vec<String> = Vec::new();
    for line in containerfile.lines() {
        let words: Vec<&str> = line.split_whitespace().collect();
        let Some(first) = words.first() else { continue };
        if first.eq_ignore_ascii_case("FROM") {
            let image = words
                .iter()
                .skip(1)
                .find(|w| !w.starts_with("--"))
                .map(|s| s.to_string());
            if let Some(image) = image {
                if !stages.iter().any(|s| s.eq_ignore_ascii_case(&image)) && !image.contains('$') {
                    out.push(image);
                }
            }
            if let Some(i) = words.iter().position(|w| w.eq_ignore_ascii_case("AS")) {
                if let Some(name) = words.get(i + 1) {
                    stages.push(name.to_string());
                }
            }
        } else if first.eq_ignore_ascii_case("COPY") {
            for w in &words[1..] {
                if let Some(src) = w.strip_prefix("--from=") {
                    let internal = stages.iter().any(|s| s.eq_ignore_ascii_case(src))
                        || src.parse::<usize>().is_ok();
                    if !internal && !out.iter().any(|o| o == src) {
                        out.push(src.to_string());
                    }
                }
            }
        }
    }
    out
}

/// Uma imagem base como linha da lista do diálogo de aprovação: `docker.io/library/python` · `3.12-slim` ·
/// `sha256:44cf1793efa7` (sempre fixada: o [`of_dir`] recusa as outras).
pub fn image_package(image: &str) -> tutor_eval::course_cache::Package {
    let (name_tag, digest) = image.split_once('@').unwrap_or((image, ""));
    let slash = name_tag.rfind('/').map(|i| i + 1).unwrap_or(0);
    let (name, version) = match name_tag[slash..].rfind(':') {
        Some(i) => (&name_tag[..slash + i], &name_tag[slash + i + 1..]),
        None => (name_tag, ""),
    };
    let short = digest.get(..19).unwrap_or(digest);
    tutor_eval::course_cache::Package {
        name: name.to_string(),
        version: version.to_string(),
        source: short.to_string(),
        pinned: !digest.is_empty(),
    }
}

/// Um id de curso como parte de um nome de imagem.
fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

/// O hash do contexto do build (caminhos e conteúdos, por ordem; sem `.git`) e do ficheiro do build.
fn context_hash(context: &Path, dockerfile: &Path) -> Result<String, EnvError> {
    use sha2::{Digest, Sha256};
    fn walk(dir: &Path, base: &Path, out: &mut Vec<(String, PathBuf)>) -> std::io::Result<()> {
        for e in std::fs::read_dir(dir)? {
            let e = e?;
            let name = e.file_name();
            if name == ".git" {
                continue;
            }
            let ty = e.file_type()?;
            if ty.is_dir() {
                walk(&e.path(), base, out)?;
            } else if ty.is_file() {
                let rel = e
                    .path()
                    .strip_prefix(base)
                    .unwrap_or(&e.path())
                    .display()
                    .to_string();
                out.push((rel, e.path()));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(context, context, &mut files)
        .map_err(|e| EnvError::Config(format!("{}: {e}", context.display())))?;
    files.push(("\0dockerfile".into(), dockerfile.to_path_buf()));
    files.sort();
    let mut h = Sha256::new();
    for (rel, path) in files {
        let bytes = std::fs::read(&path).map_err(|e| EnvError::Config(format!("{rel}: {e}")))?;
        h.update(rel.as_bytes());
        h.update([0]);
        h.update((bytes.len() as u64).to_le_bytes());
        h.update(&bytes);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Os argumentos do build da imagem do curso.
pub fn build_args(env: &CourseEnv) -> Vec<String> {
    vec![
        "build".into(),
        "-t".into(),
        env.tag.clone(),
        "-f".into(),
        env.dockerfile.display().to_string(),
        env.context.display().to_string(),
    ]
}

/// O comando exacto que «Prepare course» corre (o diálogo mostra-o; o build só corre se for este).
pub fn plan(rt: &Runtime, env: &CourseEnv) -> String {
    std::iter::once(rt.name.clone())
        .chain(build_args(env).iter().map(|a| quote(a)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote(s: &str) -> String {
    if !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./:@=+,".contains(c))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// A imagem do curso já está construída?
pub fn image_ready(rt: &Runtime, env: &CourseEnv) -> bool {
    rt.command()
        .args(["image", "inspect", &env.tag])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

/// O resultado de um build.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Built {
    pub ok: bool,
    pub output: String,
}

/// Constrói a imagem do curso, só se `approved` for o plano de agora.
pub fn build(rt: &Runtime, env: &CourseEnv, approved: &str) -> Result<Built, EnvError> {
    if approved != plan(rt, env) {
        return Err(EnvError::StalePlan);
    }
    let out = rt
        .command()
        .args(build_args(env))
        .output()
        .map_err(|e| EnvError::Runtime(format!("cannot start {}: {e}", rt.name)))?;
    Ok(Built {
        ok: out.status.success(),
        output: format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        ),
    })
}

/// Os argumentos do `run` de uma avaliação (sem o programa).
pub fn run_args(env: &CourseEnv, name: &str) -> Vec<String> {
    vec![
        "run".into(),
        "--rm".into(),
        "-i".into(),
        "--name".into(),
        name.into(),
        "--label".into(),
        "io.dxtutor.grade=1".into(),
        "--network".into(),
        "none".into(),
        "--read-only".into(),
        "--tmpfs".into(),
        TMPFS.into(),
        "--cap-drop=ALL".into(),
        "--security-opt".into(),
        "no-new-privileges".into(),
        "--memory".into(),
        MEMORY.into(),
        "--pids-limit".into(),
        PIDS.into(),
        "--cpus".into(),
        CPUS.into(),
        "-v".into(),
        format!("{}:{COURSE_MOUNT}:ro", env.plugin_dir.display()),
        env.tag.clone(),
        "dxtutor-grade".into(),
    ]
}

/// Avalia `req` no contentor do curso. A imagem tem de estar construída ([`EnvError::NotPrepared`]); um relatório de
/// erro do avaliador é [`EnvError::Grade`] com o código dele à frente (o `COURSE_NOT_PREPARED` incluído, para a UI
/// oferecer a preparação).
pub fn grade(
    rt: &Runtime,
    env: &CourseEnv,
    req: &GradeRequest,
    timeout: Duration,
) -> Result<GradeReport, EnvError> {
    if !image_ready(rt, env) {
        return Err(EnvError::NotPrepared(env.course_id.clone()));
    }
    let name = unique_name();
    let body = serde_json::to_string(req).map_err(|e| EnvError::Runtime(e.to_string()))?;
    let mut child = rt
        .command()
        .args(run_args(env, &name))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| EnvError::Runtime(format!("cannot start {}: {e}", rt.name)))?;
    // O pedido vai numa thread: um avaliador que não lê o stdin não pode prender a IDE.
    let mut stdin = child.stdin.take().expect("piped stdin");
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(body.as_bytes());
    });
    let mut stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let out_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err_reader = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let started = Instant::now();
    let status = loop {
        if let Some(st) = child
            .try_wait()
            .map_err(|e| EnvError::Runtime(e.to_string()))?
        {
            break Some(st);
        }
        if started.elapsed() > timeout {
            let _ = rt
                .command()
                .args(["rm", "-f", &name])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
            let _ = child.kill();
            let _ = child.wait();
            break None;
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let _ = writer.join();
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    let Some(status) = status else {
        return Err(EnvError::Runtime(format!(
            "the grading took longer than {} s and was stopped",
            timeout.as_secs()
        )));
    };
    let report = match GradeReport::parse(&out) {
        Ok(r) => r,
        Err(e) => {
            return Err(EnvError::Runtime(format!(
                "{} run exited with {} and no report ({e}):\n{}",
                rt.name,
                status
                    .code()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| "a signal".into()),
                tail(&format!("{out}{err}"), 40)
            )))
        }
    };
    if report.step != req.step {
        return Err(EnvError::Runtime(format!(
            "the grader answered for step `{}`, not `{}`",
            report.step, req.step
        )));
    }
    match &report.error {
        Some(e) => Err(EnvError::Grade(format!("{}: {}", e.code, e.message))),
        None => Ok(report),
    }
}

fn unique_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    format!(
        "dxtutor-grade-{}-{}-{nanos}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    )
}

fn tail(s: &str, lines: usize) -> String {
    let v: Vec<&str> = s.lines().collect();
    v[v.len().saturating_sub(lines)..].join("\n")
}

#[cfg(test)]
mod tests;
