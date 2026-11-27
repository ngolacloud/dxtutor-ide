//! Caso de uso «sandbox / run» — **independente de Tauri** (Etapa 3, 11º grupo).
//!
//! Três comandos IPC (`compose_ps`, `get_sandbox_engine`, `set_sandbox_engine`)
//! carregavam, dentro do `#[tauri::command]`, *regras* que não pertencem a nenhum
//! mecanismo externo:
//!
//! - o **shaping** da saída do `docker compose ps` (NDJSON ou array JSON →
//!   [`ComposeService`]), tolerante a campos em falta — [`parse_compose_ps`] é uma
//!   função PURA, testável sem processo;
//! - a **validação** do nome do motor de sandbox quando a UI o troca em runtime, com
//!   a mensagem de contrato histórica — [`set_engine`] veste o erro tipado
//!   [`SandboxError::UnknownEngine`].
//!
//! A precedência do motor efectivo (runtime → ambiente → host) já vive em
//! `tutor_eval` (estado global atómico, não um `tauri::State`); [`current_engine_name`]
//! e [`set_engine`] são passagens finas sobre essa API — a fatia não conhece o
//! `spawn_blocking` nem o mapeamento de erro → `String`, que ficam no adaptador
//! (`commands::sandbox`), exactamente como `workspace::open_workspace` ↔
//! `bridge::load_workspace`.
//!
//! O DTO `ComposeService` nasceu ao lado do comando em `lib.rs`; vive agora no caso
//! de uso que o produz.

use std::path::Path;

/// Serviço de uma stack Compose, tal como a vista Services (F8) o mostra.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeService {
    pub name: String,
    pub service: String,
    pub state: String,
    pub status: String,
    pub image: String,
    pub ports: Vec<String>,
}

/// Erro tipado da fatia. As regras com mensagem de contrato (motor desconhecido e as
/// falhas de execução do `docker compose ps`) passam pelo [`Display`], que reproduz
/// EXACTAMENTE as mensagens que `lib.rs` emitia.
///
/// [`Display`]: std::fmt::Display
#[derive(Debug, Clone, PartialEq)]
pub enum SandboxError {
    /// O binário `docker` não pôde ser executado (erro cru do spawn anexado).
    Docker(String),
    /// O `docker compose ps` saiu com erro — a mensagem já resolvida (stderr do
    /// compose, ou a mensagem genérica quando o stderr vem vazio).
    Compose(String),
    /// O nome de motor pedido não é `host`/`delonix`/`docker`/`podman` (nome cru anexado).
    UnknownEngine(String),
}

impl std::fmt::Display for SandboxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SandboxError::Docker(e) => write!(f, "could not run docker: {e}"),
            SandboxError::Compose(m) => write!(f, "{m}"),
            SandboxError::UnknownEngine(e) => {
                write!(f, "unknown engine `{e}` (use host|delonix|docker|podman)")
            }
        }
    }
}

impl std::error::Error for SandboxError {}

/// Faz o parse de `docker compose ps --format json`. O Compose v2 emite NDJSON (um
/// objecto por linha); algumas versões emitem um único array JSON. Tolerante a campos
/// em falta (usa `serde_json::Value`), para que uma mudança de formato degrade para
/// vazios em vez de falhar. Função PURA → testada.
pub fn parse_compose_ps(stdout: &str) -> Vec<ComposeService> {
    let s = stdout.trim();
    if s.is_empty() {
        return Vec::new();
    }
    let objs: Vec<serde_json::Value> = if s.starts_with('[') {
        serde_json::from_str::<Vec<serde_json::Value>>(s).unwrap_or_default()
    } else {
        s.lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .collect()
    };
    let field = |v: &serde_json::Value, keys: &[&str]| -> String {
        for k in keys {
            if let Some(x) = v.get(*k).and_then(|x| x.as_str()) {
                return x.to_string();
            }
        }
        String::new()
    };
    objs.iter()
        .map(|v| {
            let ports = v
                .get("Publishers")
                .and_then(|p| p.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|pb| {
                            let tgt = pb.get("TargetPort").and_then(|x| x.as_u64());
                            let publ = pb.get("PublishedPort").and_then(|x| x.as_u64());
                            match (publ, tgt) {
                                (Some(p), Some(t)) if p != 0 => Some(format!("{p}->{t}")),
                                (_, Some(t)) => Some(format!("{t}")),
                                _ => None,
                            }
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            ComposeService {
                name: field(v, &["Name"]),
                service: field(v, &["Service"]),
                state: field(v, &["State"]),
                status: field(v, &["Status", "Health"]),
                image: field(v, &["Image"]),
                ports,
            }
        })
        .collect()
}

/// Lista os serviços da stack em execução sob `root`, via `docker compose ps --format
/// json`. Honesto: se docker/compose não existir, devolve [`SandboxError::Docker`]; se
/// não há stack ou ficheiro compose, o compose sai com uma mensagem que é propagada
/// ([`SandboxError::Compose`]). Nada é simulado. (Faz I/O de processo — o adaptador
/// corre-a num worker bloqueante.)
pub fn compose_ps(root: &Path) -> Result<Vec<ComposeService>, SandboxError> {
    let out = std::process::Command::new("docker")
        .args(["compose", "ps", "--format", "json"])
        .current_dir(root)
        .output()
        .map_err(|e| SandboxError::Docker(e.to_string()))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(SandboxError::Compose(if err.trim().is_empty() {
            "docker compose ps failed".to_string()
        } else {
            err.trim().to_string()
        }));
    }
    Ok(parse_compose_ps(&String::from_utf8_lossy(&out.stdout)))
}

/// Nome curto do motor de sandbox efectivo: `"host" | "delonix" | "docker" |
/// "podman"`. Reflecte o override de runtime ([`set_engine`]), senão a env var
/// `DXTUTOR_SANDBOX_ENGINE`, senão `"host"`. Passagem sobre a precedência de
/// `tutor_eval::current_engine`.
pub fn current_engine_name() -> String {
    tutor_eval::engine_name(tutor_eval::current_engine()).to_string()
}

/// Troca o motor de sandbox em runtime. Aceita `"host" | "delonix" | "docker" |
/// "podman"` (sem distinção de maiúsculas); um nome desconhecido devolve
/// [`SandboxError::UnknownEngine`] com a mensagem de contrato histórica. Em sucesso,
/// devolve o nome curto canónico do motor aplicado.
pub fn set_engine(engine: &str) -> Result<String, SandboxError> {
    let parsed = tutor_eval::parse_engine(engine)
        .ok_or_else(|| SandboxError::UnknownEngine(engine.to_string()))?;
    tutor_eval::set_engine(parsed);
    Ok(tutor_eval::engine_name(parsed).to_string())
}

/// The sandbox engine is one process-wide value and the unit tests run in parallel: a test that
/// changes it, or that grades code and needs a known engine, holds this lock and restores the engine
/// it found ([`EngineGuard`]).
#[cfg(test)]
pub(crate) static ENGINE_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Holds [`ENGINE_TEST_LOCK`] and puts back the engine it found when dropped.
#[cfg(test)]
pub(crate) struct EngineGuard {
    before: String,
    _lock: std::sync::MutexGuard<'static, ()>,
}

#[cfg(test)]
impl EngineGuard {
    pub(crate) fn take() -> Self {
        let lock = ENGINE_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Self {
            before: current_engine_name(),
            _lock: lock,
        }
    }
}

#[cfg(test)]
impl Drop for EngineGuard {
    fn drop(&mut self) {
        let _ = set_engine(&self.before);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// F8 Services: NDJSON (um objecto por linha) do `docker compose ps` é parseado nos
    /// campos que a vista mostra, incluindo as portas publicadas (published->target).
    #[test]
    fn parse_compose_ps_ndjson_extracts_fields_and_ports() {
        let out = concat!(
            r#"{"Name":"app-web-1","Service":"web","State":"running","Status":"Up 3s","Image":"nginx","Publishers":[{"PublishedPort":8080,"TargetPort":80}]}"#,
            "\n",
            r#"{"Name":"app-db-1","Service":"db","State":"running","Status":"Up 3s (healthy)","Image":"postgres:16-alpine","Publishers":[{"PublishedPort":0,"TargetPort":5432}]}"#,
            "\n",
        );
        let svcs = parse_compose_ps(out);
        assert_eq!(svcs.len(), 2);
        assert_eq!(svcs[0].service, "web");
        assert_eq!(svcs[0].ports, vec!["8080->80".to_string()]);
        assert_eq!(svcs[1].service, "db");
        assert_eq!(svcs[1].status, "Up 3s (healthy)");
        assert_eq!(svcs[1].ports, vec!["5432".to_string()]); // não publicado → só a porta interna
    }

    #[test]
    fn parse_compose_ps_handles_array_form_and_empty() {
        assert!(parse_compose_ps("").is_empty());
        assert!(parse_compose_ps("   \n ").is_empty());
        let arr = r#"[{"Name":"x","Service":"x","State":"exited","Status":"Exited (0)","Image":"alpine"}]"#;
        let svcs = parse_compose_ps(arr);
        assert_eq!(svcs.len(), 1);
        assert_eq!(svcs[0].state, "exited");
        assert!(svcs[0].ports.is_empty());
    }

    /// `set_engine` valida o nome (case-insensitive), aplica-o e devolve o nome curto
    /// canónico; um nome desconhecido dá o erro tipado com a mensagem de contrato.
    #[test]
    fn set_engine_roundtrips_known_and_types_unknown() {
        let _engine = EngineGuard::take();
        assert_eq!(set_engine("docker").unwrap(), "docker");
        assert_eq!(current_engine_name(), "docker");
        assert_eq!(set_engine("DELONIX").unwrap(), "delonix"); // case-insensitive
        assert_eq!(current_engine_name(), "delonix");

        let err = set_engine("nonsense").unwrap_err();
        assert_eq!(err, SandboxError::UnknownEngine("nonsense".to_string()));
        assert_eq!(
            err.to_string(),
            "unknown engine `nonsense` (use host|delonix|docker|podman)"
        );
    }

    /// As mensagens de `compose_ps`/`docker` vestem o texto histórico exacto.
    #[test]
    fn errors_wear_the_historical_messages() {
        assert_eq!(
            SandboxError::Docker("No such file".into()).to_string(),
            "could not run docker: No such file"
        );
        assert_eq!(
            SandboxError::Compose("docker compose ps failed".into()).to_string(),
            "docker compose ps failed"
        );
    }
}
