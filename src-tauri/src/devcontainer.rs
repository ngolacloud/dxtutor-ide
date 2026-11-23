//! Caso de uso «Dev Containers» — **independente de Tauri** (Etapa 3).
//!
//! Os oito comandos `devcontainer_*` de `lib.rs` eram adaptadores finos sobre o *mecanismo*
//! de contentores (`tutor_eval` — `build_image`/`run_in_container`/`session_*`, intocado),
//! mas traziam, embutidas no `#[tauri::command]`, várias **regras** que não são do
//! mecanismo:
//!  - a **descoberta** do `devcontainer.json` (`.devcontainer/devcontainer.json` ou o
//!    top-level `.devcontainer.json`), repetida em quatro comandos;
//!  - o parsing **JSONC** (`strip_jsonc_comments` — só este grupo o usava);
//!  - a **resolução de imagem** (`image` explícita vs. `build.dockerfile`, construindo
//!    quando preciso);
//!  - o **`postCreateCommand`** (string / array juntos / sonda de prontidão por omissão);
//!  - a **guarda de sessão** («No running session …») e a escolha do runner por extensão.
//!
//! Saem para aqui, num caso de uso que não conhece `spawn_blocking` nem o mapeamento de
//! erro → `String`: fala em [`DevcontainerError`] e nos DTOs tipados ([`DevcontainerInfo`],
//! [`DevcontainerUp`], [`SessionStatus`]), deixando a fronteira IPC
//! (`commands::devcontainer`) ser um adaptador fino, como `gitops`/`testexec` ↔ os seus
//! comandos. O `Display` de [`DevcontainerError`] reproduz EXACTAMENTE as mensagens que a
//! UI sempre observou; os erros do próprio motor (E/S, build, run, sessão) passam crus, sem
//! prefixo (variante [`DevcontainerError::Engine`]), como `gitops::GitError::Git`.

use std::path::Path;

/// Dev Container presence + name/image/path for the Remote view. Looks for
/// `.devcontainer/devcontainer.json` or a top-level `.devcontainer.json`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevcontainerInfo {
    pub present: bool,
    pub name: Option<String>,
    pub image: Option<String>,
    pub path: Option<String>,
}

/// Outcome of bringing a devcontainer up / exec-ing in it: the image that ran, whether it
/// was built, the command line, and the captured streams.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevcontainerUp {
    pub ok: bool,
    pub image: String,
    pub built: bool,
    pub ran: String,
    pub stdout: String,
    pub stderr: String,
}

/// Whether a persistent devcontainer session is running, and its deterministic name.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub running: bool,
    pub name: String,
}

/// Erro tipado das operações de devcontainer. Preserva EXACTAMENTE, via `Display`, as
/// mensagens que a UI sempre observou. Os erros do próprio motor de contentores (E/S de
/// ficheiro, `build_image`, `run_in_container`, `session_*`) passam crus, sem prefixo
/// (variante [`DevcontainerError::Engine`]), como `gitops::GitError::Git` passava o `stderr`
/// do git.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DevcontainerError {
    /// Não há `devcontainer.json` na pasta.
    NoConfig,
    /// O `devcontainer.json` não é JSON válido (mensagem crua do parser anexada).
    InvalidJson(String),
    /// O `devcontainer.json` não tem nem `image` nem `build.dockerfile`.
    NoImageOrBuild,
    /// O `build` não tem `dockerfile`.
    NoDockerfile,
    /// Não há sessão persistente a correr (é preciso «Reopen in Container» primeiro).
    NoSession,
    /// Não há runner in-container para o ficheiro activo (caminho relativo anexado).
    NoRunner(String),
    /// Erro do próprio motor (E/S, build, run, sessão) — passa cru, sem prefixo.
    Engine(String),
}

impl std::fmt::Display for DevcontainerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DevcontainerError::NoConfig => write!(f, "No devcontainer.json in this folder."),
            DevcontainerError::InvalidJson(e) => {
                write!(f, "devcontainer.json is not valid JSON: {e}")
            }
            DevcontainerError::NoImageOrBuild => {
                write!(
                    f,
                    "devcontainer.json has neither `image` nor `build.dockerfile`."
                )
            }
            DevcontainerError::NoDockerfile => write!(f, "build has no `dockerfile`."),
            DevcontainerError::NoSession => {
                write!(f, "No running session — press Reopen in Container first.")
            }
            DevcontainerError::NoRunner(rel) => write!(f, "No in-container runner for `{rel}`."),
            DevcontainerError::Engine(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for DevcontainerError {}

/// Os dois caminhos onde um `devcontainer.json` pode viver, por ordem de preferência.
const CONFIG_CANDIDATES: [&str; 2] = [".devcontainer/devcontainer.json", ".devcontainer.json"];

/// Localiza o `devcontainer.json`, lê-o e faz parse (JSONC → `Value`). Regra de descoberta
/// partilhada por `up`/`exec`/`session_up`. O erro de E/S passa cru ([`Engine`]); JSON
/// inválido veste a mensagem histórica ([`InvalidJson`]).
///
/// [`Engine`]: DevcontainerError::Engine
/// [`InvalidJson`]: DevcontainerError::InvalidJson
fn read_config(base: &Path) -> Result<serde_json::Value, DevcontainerError> {
    let file = CONFIG_CANDIDATES
        .iter()
        .map(|r| base.join(r))
        .find(|p| p.is_file())
        .ok_or(DevcontainerError::NoConfig)?;
    let text =
        std::fs::read_to_string(&file).map_err(|e| DevcontainerError::Engine(e.to_string()))?;
    serde_json::from_str(&strip_jsonc_comments(&text))
        .map_err(|e| DevcontainerError::InvalidJson(e.to_string()))
}

/// Resolve the image to run for a devcontainer: an explicit `image`, or a built image from
/// `build.dockerfile`. Returns `(image_ref, built)` — building when necessary. Build output
/// is prefixed onto `log` so the caller can surface it.
fn resolve_image(
    base: &Path,
    v: &serde_json::Value,
    log: &mut String,
) -> Result<(String, bool), DevcontainerError> {
    if let Some(img) = v.get("image").and_then(|i| i.as_str()) {
        return Ok((img.to_string(), false));
    }
    // build: { dockerfile, context } — dockerfile path is relative to the .devcontainer dir.
    let build = v.get("build").ok_or(DevcontainerError::NoImageOrBuild)?;
    let dockerfile = build
        .get("dockerfile")
        .and_then(|d| d.as_str())
        .ok_or(DevcontainerError::NoDockerfile)?;
    // The .devcontainer directory is the reference dir for build paths.
    let dc_dir = base.join(".devcontainer");
    let ref_dir = if dc_dir.is_dir() {
        dc_dir
    } else {
        base.to_path_buf()
    };
    let dockerfile_path = ref_dir.join(dockerfile);
    let context = build
        .get("context")
        .and_then(|c| c.as_str())
        .map(|c| ref_dir.join(c))
        .unwrap_or_else(|| ref_dir.clone());
    let tag = format!(
        "dxtutor-dc-{}",
        base.file_name()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| "project".into())
    );
    log.push_str(&format!(
        "▸ building {tag} from {}\n",
        dockerfile_path.display()
    ));
    let out = tutor_eval::build_image(&context, &dockerfile_path, &tag)
        .map_err(|e| DevcontainerError::Engine(e.to_string()))?;
    log.push_str(&out);
    log.push('\n');
    Ok((tag, true))
}

/// Regra do `postCreateCommand`: string tal e qual, array juntado por espaços, ou uma sonda
/// de prontidão por omissão.
fn post_create_command(v: &serde_json::Value) -> String {
    match v.get("postCreateCommand") {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str())
            .collect::<Vec<_>>()
            .join(" "),
        _ => "echo \"container ready: $(pwd)\"; uname -s; ls -a".to_string(),
    }
}

/// Dev Container presence + name/image/path for the Remote view. Best-effort: a missing or
/// malformed `devcontainer.json` just yields absent fields (never an error), as the command
/// always did.
pub fn info(base: &Path) -> DevcontainerInfo {
    for rel in CONFIG_CANDIDATES {
        let p = base.join(rel);
        if p.is_file() {
            // devcontainer.json is JSONC; strip // and /* */ comments before parsing so
            // a commented template still yields its fields. Best-effort (None on failure).
            let v = std::fs::read_to_string(&p).ok().and_then(|s| {
                serde_json::from_str::<serde_json::Value>(&strip_jsonc_comments(&s)).ok()
            });
            let field = |k: &str| {
                v.as_ref()
                    .and_then(|v| v.get(k).and_then(|n| n.as_str().map(String::from)))
            };
            // Prefer the explicit image; fall back to a dockerfile reference for display.
            let image = field("image").or_else(|| {
                v.as_ref()
                    .and_then(|v| v.get("build"))
                    .and_then(|b| b.get("dockerfile"))
                    .and_then(|d| d.as_str().map(|s| format!("Dockerfile: {s}")))
            });
            return DevcontainerInfo {
                present: true,
                name: field("name"),
                image,
                path: Some(p.to_string_lossy().into_owned()),
            };
        }
    }
    DevcontainerInfo {
        present: false,
        name: None,
        image: None,
        path: None,
    }
}

/// Bring the Dev Container up: resolve/build its image, then run `postCreateCommand` (or a
/// readiness probe) inside it with the workspace bind-mounted, via the active engine. Now
/// supports Dockerfile-based devcontainers (it builds first). One-shot per call.
pub fn up(base: &Path) -> Result<DevcontainerUp, DevcontainerError> {
    let v = read_config(base)?;
    let mut log = String::new();
    let (image, built) = resolve_image(base, &v, &mut log)?;
    let post = post_create_command(&v);

    let mut spec = tutor_eval::ContainerSpec::new(
        image.clone(),
        base.to_path_buf(),
        vec!["sh".into(), "-lc".into(), post.clone()],
    );
    spec.network = true;
    spec.timeout = std::time::Duration::from_secs(300);

    let out =
        tutor_eval::run_in_container(spec).map_err(|e| DevcontainerError::Engine(e.to_string()))?;
    Ok(DevcontainerUp {
        ok: out.ok,
        image,
        built,
        ran: post,
        stdout: format!("{log}{}", out.stdout),
        stderr: out.stderr,
    })
}

/// Run an arbitrary command inside the devcontainer image with the workspace mounted — the
/// practical "attach" affordance (exec a shell line in the project's container env).
pub fn exec(base: &Path, cmd: &str) -> Result<DevcontainerUp, DevcontainerError> {
    let v = read_config(base)?;
    let mut log = String::new();
    let (image, built) = resolve_image(base, &v, &mut log)?;
    let mut spec = tutor_eval::ContainerSpec::new(
        image.clone(),
        base.to_path_buf(),
        vec!["sh".into(), "-lc".into(), cmd.to_string()],
    );
    spec.network = true;
    spec.timeout = std::time::Duration::from_secs(300);
    let out =
        tutor_eval::run_in_container(spec).map_err(|e| DevcontainerError::Engine(e.to_string()))?;
    Ok(DevcontainerUp {
        ok: out.ok,
        image,
        built,
        ran: cmd.to_string(),
        stdout: format!("{log}{}", out.stdout),
        stderr: out.stderr,
    })
}

/// Start a PERSISTENT devcontainer session: resolve/build the image, then run a long-lived
/// container with the workspace mounted. Unlike `up` (one-shot), state persists across exec
/// calls — the real attached session. Returns the build log + container name.
pub fn session_up(base: &Path) -> Result<DevcontainerUp, DevcontainerError> {
    let v = read_config(base)?;
    let mut log = String::new();
    let (image, built) = resolve_image(base, &v, &mut log)?;
    let name = tutor_eval::session_up(base, &image)
        .map_err(|e| DevcontainerError::Engine(e.to_string()))?;
    log.push_str(&format!("▸ session started: {name}\n"));
    Ok(DevcontainerUp {
        ok: true,
        image,
        built,
        ran: "session up".into(),
        stdout: log,
        stderr: String::new(),
    })
}

/// Exec a command inside the RUNNING persistent session (state preserved between calls).
pub fn session_exec(base: &Path, cmd: &str) -> Result<DevcontainerUp, DevcontainerError> {
    let name = tutor_eval::session_name(base);
    if !tutor_eval::session_running(&name) {
        return Err(DevcontainerError::NoSession);
    }
    let out = tutor_eval::session_exec(&name, cmd)
        .map_err(|e| DevcontainerError::Engine(e.to_string()))?;
    Ok(DevcontainerUp {
        ok: out.ok,
        image: name,
        built: false,
        ran: cmd.to_string(),
        stdout: out.stdout,
        stderr: out.stderr,
    })
}

/// Run the active file INSIDE the persistent session (the container's toolchain), picking
/// the runner by extension and executing from /work. The project agent for execution.
pub fn session_run(base: &Path, file: &str) -> Result<DevcontainerUp, DevcontainerError> {
    let name = tutor_eval::session_name(base);
    if !tutor_eval::session_running(&name) {
        return Err(DevcontainerError::NoSession);
    }
    let rel = Path::new(file)
        .strip_prefix(base)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| file.to_string());
    let has_cargo = base.join("Cargo.toml").is_file();
    let runner = tutor_eval::run_file_command(&rel, has_cargo)
        .ok_or_else(|| DevcontainerError::NoRunner(rel.clone()))?;
    let out = tutor_eval::session_exec(&name, &format!("cd /work && {runner}"))
        .map_err(|e| DevcontainerError::Engine(e.to_string()))?;
    Ok(DevcontainerUp {
        ok: out.ok,
        image: name,
        built: false,
        ran: runner,
        stdout: out.stdout,
        stderr: out.stderr,
    })
}

/// Whether the persistent session for `base` is running, and its deterministic name.
/// Best-effort: probes the engine, falling back to `running: false` when it is absent.
pub fn session_status(base: &Path) -> SessionStatus {
    let name = tutor_eval::session_name(base);
    SessionStatus {
        running: tutor_eval::session_running(&name),
        name,
    }
}

/// Tear the persistent session down (remove the long-lived container).
pub fn session_down(base: &Path) -> Result<(), DevcontainerError> {
    let name = tutor_eval::session_name(base);
    tutor_eval::session_down(&name).map_err(|e| DevcontainerError::Engine(e.to_string()))
}

/// Strip `//` line and `/* */` block comments (JSONC) outside of string literals. Only the
/// devcontainer group reads JSONC, so this lives with the use case that needs it.
fn strip_jsonc_comments(src: &str) -> String {
    let b = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let (mut i, mut in_str, mut esc) = (0usize, false, false);
    while i < b.len() {
        let c = b[i] as char;
        if in_str {
            out.push(c);
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if c == '"' {
            in_str = true;
            out.push(c);
            i += 1;
        } else if c == '/' && i + 1 < b.len() && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
        } else if c == '/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn errors_wear_the_historical_messages() {
        // As mensagens que a UI sempre observou — fixadas aqui para não derivarem.
        assert_eq!(
            DevcontainerError::NoConfig.to_string(),
            "No devcontainer.json in this folder."
        );
        assert_eq!(
            DevcontainerError::InvalidJson("expected `,` at line 2".into()).to_string(),
            "devcontainer.json is not valid JSON: expected `,` at line 2"
        );
        assert_eq!(
            DevcontainerError::NoImageOrBuild.to_string(),
            "devcontainer.json has neither `image` nor `build.dockerfile`."
        );
        assert_eq!(
            DevcontainerError::NoDockerfile.to_string(),
            "build has no `dockerfile`."
        );
        assert_eq!(
            DevcontainerError::NoSession.to_string(),
            "No running session — press Reopen in Container first."
        );
        assert_eq!(
            DevcontainerError::NoRunner("src/x.rs".into()).to_string(),
            "No in-container runner for `src/x.rs`."
        );
        // O erro do próprio motor passa cru, sem prefixo.
        assert_eq!(
            DevcontainerError::Engine("falha a lançar `docker run`".into()).to_string(),
            "falha a lançar `docker run`"
        );
    }

    #[test]
    fn read_config_discovers_strips_jsonc_and_reports_typed_errors() {
        let dir = tempdir().unwrap();
        // Ausente → NoConfig, antes de tocar no motor.
        assert_eq!(read_config(dir.path()), Err(DevcontainerError::NoConfig));

        // JSONC (comentários) é despido antes do parse → fields acessíveis.
        fs::create_dir(dir.path().join(".devcontainer")).unwrap();
        fs::write(
            dir.path().join(".devcontainer/devcontainer.json"),
            "{\n  // o nosso ambiente\n  \"image\": \"debian:bookworm\"\n}",
        )
        .unwrap();
        let v = read_config(dir.path()).expect("devcontainer.json válido");
        assert_eq!(
            v.get("image").and_then(|i| i.as_str()),
            Some("debian:bookworm")
        );

        // JSON partido no top-level → InvalidJson (mensagem histórica, não NoConfig).
        fs::remove_file(dir.path().join(".devcontainer/devcontainer.json")).unwrap();
        fs::write(dir.path().join(".devcontainer.json"), "{ not json").unwrap();
        match read_config(dir.path()) {
            Err(DevcontainerError::InvalidJson(_)) => {}
            other => panic!("esperado InvalidJson, veio {other:?}"),
        }
    }

    #[test]
    fn resolve_image_prefers_explicit_image_and_never_builds() {
        let dir = tempdir().unwrap();
        let mut log = String::new();
        let v = serde_json::json!({ "image": "alpine:3" });
        // A imagem explícita devolve (image, built=false) sem tocar no motor de build.
        assert_eq!(
            resolve_image(dir.path(), &v, &mut log).unwrap(),
            ("alpine:3".into(), false)
        );
        assert!(
            log.is_empty(),
            "o caminho de imagem explícita não escreve log de build"
        );
    }

    #[test]
    fn resolve_image_typed_errors_when_neither_image_nor_dockerfile() {
        let dir = tempdir().unwrap();
        let mut log = String::new();
        // Sem `image` nem `build` → NoImageOrBuild.
        let v = serde_json::json!({ "name": "x" });
        assert_eq!(
            resolve_image(dir.path(), &v, &mut log),
            Err(DevcontainerError::NoImageOrBuild)
        );
        // `build` sem `dockerfile` → NoDockerfile.
        let v = serde_json::json!({ "build": { "context": "." } });
        assert_eq!(
            resolve_image(dir.path(), &v, &mut log),
            Err(DevcontainerError::NoDockerfile)
        );
    }

    #[test]
    fn post_create_command_handles_string_array_and_default() {
        assert_eq!(
            post_create_command(&serde_json::json!({ "postCreateCommand": "npm ci" })),
            "npm ci"
        );
        assert_eq!(
            post_create_command(&serde_json::json!({ "postCreateCommand": ["cargo", "fetch"] })),
            "cargo fetch"
        );
        // Ausente → sonda de prontidão por omissão.
        assert_eq!(
            post_create_command(&serde_json::json!({})),
            "echo \"container ready: $(pwd)\"; uname -s; ls -a"
        );
    }

    #[test]
    fn session_exec_without_a_running_session_is_a_typed_error() {
        // `session_running` devolve false quando não há sessão (ou motor) → NoSession, antes
        // de qualquer `exec`. Determinístico offline (um tempdir fresco nunca tem sessão).
        let dir = tempdir().unwrap();
        assert_eq!(
            session_exec(dir.path(), "true").unwrap_err(),
            DevcontainerError::NoSession
        );
        assert_eq!(
            session_run(dir.path(), "main.rs").unwrap_err(),
            DevcontainerError::NoSession
        );
    }

    #[test]
    fn info_reads_name_and_image_from_a_real_config() {
        let dir = tempdir().unwrap();
        // Sem config → present:false.
        let absent = info(dir.path());
        assert!(!absent.present);
        assert!(absent.name.is_none() && absent.image.is_none() && absent.path.is_none());

        fs::create_dir(dir.path().join(".devcontainer")).unwrap();
        fs::write(
            dir.path().join(".devcontainer/devcontainer.json"),
            "{ \"name\": \"dxtutor\", \"image\": \"debian:bookworm\" }",
        )
        .unwrap();
        let present = info(dir.path());
        assert!(present.present);
        assert_eq!(present.name.as_deref(), Some("dxtutor"));
        assert_eq!(present.image.as_deref(), Some("debian:bookworm"));
        assert!(present.path.is_some());
    }

    #[test]
    fn info_falls_back_to_a_dockerfile_reference_for_display() {
        let dir = tempdir().unwrap();
        fs::write(
            dir.path().join(".devcontainer.json"),
            "{ \"build\": { \"dockerfile\": \"Dockerfile\" } }",
        )
        .unwrap();
        let i = info(dir.path());
        assert!(i.present);
        // Sem `image` explícita, mostra a referência do Dockerfile para display.
        assert_eq!(i.image.as_deref(), Some("Dockerfile: Dockerfile"));
    }
}
