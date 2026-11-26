//! **Cache de um curso preparado uma vez** (Learn P1): a avaliação nunca vai à rede.
//!
//! Um curso com `[build] prepare = true` (ver `tutor_core::build`) compila contra bibliotecas de
//! fora (o Seiva, o tokio, o axum…). O avaliador corre sempre com a rede cortada
//! (`CARGO_NET_OFFLINE`), por isso essas bibliotecas têm de estar numa cache local ANTES de
//! avaliar. Esta é a única porta para a rede, numa acção explícita que o humano aprova
//! («preparar o curso»):
//!
//! 1. `cargo fetch` descarrega as dependências do curso para um `CARGO_HOME` só do curso
//!    (`<raiz>/<id do curso>/cargo-home`): o `~/.cargo` do utilizador não é tocado;
//! 2. `cargo test --offline --no-run` compila-as uma vez para uma pasta `target` partilhada
//!    pelos passos do curso (`<raiz>/<id>/target`), e o `Cargo.lock` resultante fica guardado;
//! 3. um marcador (`prepared.json`) regista a impressão digital das dependências preparadas.
//!
//! Depois, cada avaliação de um passo deste curso corre com esse `CARGO_HOME`, esse `target`,
//! esse `Cargo.lock`, `--offline` e o tempo limite do curso. Se o curso não foi preparado (ou as
//! suas dependências mudaram desde então), a avaliação recusa com [`NOT_PREPARED`] e diz o que
//! fazer — nunca um erro obscuro do cargo a meio.
//!
//! A raiz é `DXTUTOR_COURSE_CACHE` ou a pasta de dados do utilizador (`<data>/dxtutor/
//! course-cache`, ao lado dos plugins), partilhada pela app e pelo `dxt`. Os comandos são
//! construídos aqui ([`plan`]); quem os corre ([`prepare`]) corre exactamente esses.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tutor_core::{BuildEnv, CourseCache};

use crate::runner::{configure_cargo_env, run_guarded, CARGO_TIMEOUT};

/// Prefixo do erro de uma avaliação de um curso que ainda não foi preparado (a UI reconhece-o).
pub const NOT_PREPARED: &str = "COURSE_NOT_PREPARED";
/// O marcador de uma preparação completa.
pub const MARKER_FILE: &str = "prepared.json";
/// Tempo de parede do `cargo fetch` (rede) e da primeira compilação.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(600);
pub const WARM_TIMEOUT: Duration = Duration::from_secs(1200);

/// Variáveis que o `cargo fetch` (e só ele) herda além das do toolchain: proxies e certificados,
/// para descarregar atrás de um proxy empresarial.
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
];

/// A raiz das caches dos cursos: `DXTUTOR_COURSE_CACHE`, senão `<data>/dxtutor/course-cache`.
pub fn root() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("DXTUTOR_COURSE_CACHE").filter(|d| !d.is_empty()) {
        return Some(PathBuf::from(dir));
    }
    dirs::data_dir().map(|d| d.join("dxtutor").join("course-cache"))
}

/// As pastas de um curso dentro da raiz.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub dir: PathBuf,
    /// O `CARGO_HOME` do curso (registo, fontes git): só dele.
    pub cargo_home: PathBuf,
    /// A pasta `target` partilhada pelos passos do curso.
    pub target: PathBuf,
    /// O pacote que a preparação compila (as dependências do curso, um `lib.rs` vazio).
    pub crate_dir: PathBuf,
    /// O `Cargo.lock` da preparação, copiado para cada avaliação.
    pub lock: PathBuf,
    pub marker: PathBuf,
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
        bail!("`{key}` is not a valid course cache key (use the course id: a-z, 0-9, `.`, `_`, `-`)");
    }
    let dir = root.join(key);
    Ok(Layout {
        cargo_home: dir.join("cargo-home"),
        target: dir.join("target"),
        crate_dir: dir.join("prepare"),
        lock: dir.join("Cargo.lock"),
        marker: dir.join(MARKER_FILE),
        dir,
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

/// O que fica escrito depois de uma preparação completa.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub fingerprint: String,
    /// Segundos desde a época.
    pub prepared_at: u64,
    pub fetch_secs: f64,
    pub warm_secs: f64,
    /// `cargo --version` de quem preparou.
    pub cargo: String,
}

/// O estado da cache de um curso.
#[derive(Debug, Clone, PartialEq)]
pub enum Status {
    /// Preparado para estas dependências.
    Ready(Marker),
    /// Nunca preparado (ou a preparação não acabou).
    Missing,
    /// Preparado, mas as dependências do curso mudaram desde então.
    Stale(Marker),
}

impl Status {
    pub fn is_ready(&self) -> bool {
        matches!(self, Status::Ready(_))
    }
}

/// O estado da cache de `cache` dentro de `root`.
pub fn status(root: &Path, cache: &CourseCache) -> Result<Status> {
    let l = layout(root, &cache.key)?;
    let marker: Option<Marker> = std::fs::read_to_string(&l.marker)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());
    Ok(match marker {
        Some(m) if m.fingerprint == fingerprint(&cache.dependencies) && l.lock.is_file() => {
            Status::Ready(m)
        }
        Some(m) => Status::Stale(m),
        None => Status::Missing,
    })
}

/// Um comando da preparação, tal como corre.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanStep {
    pub args: Vec<String>,
    /// Variáveis definidas para este comando (além do ambiente mínimo do avaliador).
    pub env: BTreeMap<String, String>,
    /// Só o `cargo fetch` usa a rede.
    pub network: bool,
}

/// A preparação de um curso: os comandos, a pasta onde correm e o texto exacto a aprovar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub key: String,
    pub layout: Layout,
    /// As dependências que a preparação descarrega e compila.
    pub dependencies: Vec<String>,
    pub manifest: String,
    pub steps: Vec<PlanStep>,
    /// O que o diálogo de aprovação mostra (e o registo de auditoria guarda): as dependências e
    /// os comandos, com as variáveis e a pasta.
    pub command: String,
}

fn quote(p: &Path) -> String {
    let s = p.display().to_string();
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '+' | '@'))
    {
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

/// Constrói a preparação de `cache` em `root` (não corre nada).
pub fn plan(root: &Path, cache: &CourseCache) -> Result<Plan> {
    if cache.dependencies.is_empty() {
        bail!("course `{}` has no dependencies to prepare", cache.key);
    }
    let l = layout(root, &cache.key)?;
    let home = l.cargo_home.display().to_string();
    let target = l.target.display().to_string();
    let fetch = PlanStep {
        args: vec!["fetch".into()],
        env: BTreeMap::from([("CARGO_HOME".into(), home.clone())]),
        network: true,
    };
    let warm = PlanStep {
        args: vec!["test".into(), "--offline".into(), "--no-run".into()],
        env: BTreeMap::from([
            ("CARGO_HOME".into(), home),
            ("CARGO_TARGET_DIR".into(), target),
        ]),
        network: false,
    };
    let manifest = prepare_manifest(&cache.dependencies);
    let mut command = String::from("# Cargo.toml [dependencies] of the course\n");
    for d in &cache.dependencies {
        command.push_str("#   ");
        command.push_str(d.trim());
        command.push('\n');
    }
    command.push_str(&format!("cd {}\n", quote(&l.crate_dir)));
    for s in [&fetch, &warm] {
        let vars: Vec<String> = s
            .env
            .iter()
            .map(|(k, v)| format!("{k}={}", quote(Path::new(v))))
            .collect();
        command.push_str(&format!("{} cargo {}\n", vars.join(" "), s.args.join(" ")));
    }
    Ok(Plan {
        key: cache.key.clone(),
        layout: l,
        dependencies: cache.dependencies.clone(),
        manifest,
        steps: vec![fetch, warm],
        command: command.trim_end().to_string(),
    })
}

/// O resultado de uma preparação.
#[derive(Debug, Clone, PartialEq)]
pub struct Prepared {
    pub ok: bool,
    pub marker: Option<Marker>,
    /// A saída dos comandos (stdout+stderr), para mostrar quando falha.
    pub output: String,
}

fn cargo_version() -> String {
    let mut cmd = Command::new("cargo");
    cmd.arg("--version");
    configure_cargo_env(&mut cmd);
    cmd.output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Uma preparação de cada vez neste processo (o cargo também tranca as pastas).
static PREPARING: Mutex<()> = Mutex::new(());

/// Corre a preparação `plan` (os comandos que [`plan`] construiu, e só esses). O marcador só é
/// escrito quando os dois passos acabam bem; uma preparação falhada deixa o curso por preparar.
pub fn prepare(plan: &Plan) -> Result<Prepared> {
    let _one = PREPARING.lock().unwrap_or_else(|p| p.into_inner());
    let l = &plan.layout;
    std::fs::create_dir_all(l.crate_dir.join("src")).context("create the course cache folder")?;
    std::fs::write(l.crate_dir.join("Cargo.toml"), &plan.manifest)?;
    std::fs::write(l.crate_dir.join("src/lib.rs"), "")?;
    // A marca de antes deixa de valer: só uma preparação completa a volta a escrever.
    let _ = std::fs::remove_file(&l.marker);

    let mut output = String::new();
    let mut secs = Vec::new();
    for (i, step) in plan.steps.iter().enumerate() {
        let mut cmd = Command::new("cargo");
        cmd.args(&step.args).current_dir(&l.crate_dir);
        configure_cargo_env(&mut cmd);
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
        let t0 = Instant::now();
        let out = run_guarded(cmd, &l.dir, &format!("prepare-{i}"), timeout, None)
            .with_context(|| format!("run `cargo {}`", step.args.join(" ")))?;
        secs.push(t0.elapsed().as_secs_f64());
        output.push_str(&format!("$ cargo {}\n", step.args.join(" ")));
        output.push_str(&out.stdout);
        output.push_str(&out.stderr);
        if out.timed_out {
            output.push_str(&format!(
                "\ntimed out after {}s\n",
                timeout.as_secs()
            ));
        }
        if out.timed_out || !out.status.map(|s| s.success()).unwrap_or(false) {
            return Ok(Prepared {
                ok: false,
                marker: None,
                output,
            });
        }
    }
    std::fs::copy(l.crate_dir.join("Cargo.lock"), &l.lock).context("keep the Cargo.lock")?;
    let marker = Marker {
        fingerprint: fingerprint(&plan.dependencies),
        prepared_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
        fetch_secs: secs.first().copied().unwrap_or(0.0),
        warm_secs: secs.get(1).copied().unwrap_or(0.0),
        cargo: cargo_version(),
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
    let timeout = match build.timeout_secs {
        0 => CARGO_TIMEOUT,
        s => Duration::from_secs(s.clamp(tutor_core::build::MIN_TIMEOUT_SECS, tutor_core::build::MAX_TIMEOUT_SECS)),
    };
    let Some(cache) = &build.cache else {
        return Ok(CargoEnv {
            cache: None,
            timeout,
        });
    };
    let Some(root) = root else {
        bail!("{NOT_PREPARED}: course `{}`: cannot find the user data folder for the course cache (set DXTUTOR_COURSE_CACHE)", cache.key);
    };
    match status(root, cache)? {
        Status::Ready(_) => Ok(CargoEnv {
            cache: Some(layout(root, &cache.key)?),
            timeout,
        }),
        Status::Missing => bail!("{}", not_prepared_message(&cache.key, false)),
        Status::Stale(_) => bail!("{}", not_prepared_message(&cache.key, true)),
    }
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
        let c = cache(&[r#"seiva = { git = "https://github.com/ngolacloud/seiva", tag = "v0.2.0" }"#]);
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
        assert!(q.command.contains("cd '/my data/fw-basics/prepare'"), "{}", q.command);
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
        assert!(e.starts_with(NOT_PREPARED) && e.contains("not been prepared"), "{e}");

        // a complete preparation: marker + lock
        let l = layout(root, &c.key).unwrap();
        std::fs::create_dir_all(&l.dir).unwrap();
        std::fs::write(&l.lock, "# lock").unwrap();
        let m = Marker {
            fingerprint: fingerprint(&c.dependencies),
            prepared_at: 1,
            fetch_secs: 1.0,
            warm_secs: 2.0,
            cargo: "cargo 1".into(),
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
        assert!(matches!(status(root, changed.cache.as_ref().unwrap()).unwrap(), Status::Stale(_)));
        let e = cargo_env_in(Some(root), &changed).unwrap_err().to_string();
        assert!(e.contains("changed its dependencies"), "{e}");

        // a course without a cache keeps the evaluator's environment
        let plain = cargo_env_in(None, &BuildEnv::default()).unwrap();
        assert_eq!(plain, CargoEnv { cache: None, timeout: CARGO_TIMEOUT });
        // the order of the lines does not change the fingerprint
        assert_eq!(
            fingerprint(&["b".into(), "a".into()]),
            fingerprint(&[" a".into(), "b".into(), "b".into()])
        );
    }
}
