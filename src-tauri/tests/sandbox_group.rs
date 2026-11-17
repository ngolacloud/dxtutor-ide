//! Teste integrado do caso de uso «sandbox / run» (Etapa 3 — 11º grupo, sandbox).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`sandbox::*`), a mesma
//! fronteira que os comandos Tauri (`compose_ps`/`get_sandbox_engine`/`set_sandbox_engine`)
//! atravessam, sem o runtime Tauri. Prova que a fatia liga: o shaping do `docker compose ps`
//! (puro) + a selecção de motor com erro tipado, com o comportamento (e as mensagens)
//! preservados da versão em `lib.rs`.
//!
//! A suite por omissão é **offline**: só exercita o parser puro e a validação de motor (um
//! átomo em memória). O `compose_ps` vivo (que spawna o `docker`) fica `#[ignore]` — exige
//! docker com o plugin compose instalado, como os ciclos vivos dos grupos debug/devcontainer.

use dxtutor_ide_lib::sandbox::{self, SandboxError};

/// NDJSON (um objecto por linha) do `docker compose ps` é parseado nos campos que a vista
/// mostra, incluindo as portas publicadas (published->target).
#[test]
fn parse_compose_ps_ndjson_extracts_fields_and_ports() {
    let out = concat!(
        r#"{"Name":"app-web-1","Service":"web","State":"running","Status":"Up 3s","Image":"nginx","Publishers":[{"PublishedPort":8080,"TargetPort":80}]}"#,
        "\n",
        r#"{"Name":"app-db-1","Service":"db","State":"running","Status":"Up 3s (healthy)","Image":"postgres:16-alpine","Publishers":[{"PublishedPort":0,"TargetPort":5432}]}"#,
        "\n",
    );
    let svcs = sandbox::parse_compose_ps(out);
    assert_eq!(svcs.len(), 2);
    assert_eq!(svcs[0].service, "web");
    assert_eq!(svcs[0].ports, vec!["8080->80".to_string()]);
    assert_eq!(svcs[1].status, "Up 3s (healthy)");
    assert_eq!(svcs[1].ports, vec!["5432".to_string()]); // não publicado → só a porta interna
}

/// Forma em array único e entradas vazias degradam para `Vec` vazio, nunca falham.
#[test]
fn parse_compose_ps_handles_array_form_and_empty() {
    assert!(sandbox::parse_compose_ps("").is_empty());
    assert!(sandbox::parse_compose_ps("   \n ").is_empty());
    let arr = r#"[{"Name":"x","Service":"x","State":"exited","Status":"Exited (0)","Image":"alpine"}]"#;
    let svcs = sandbox::parse_compose_ps(arr);
    assert_eq!(svcs.len(), 1);
    assert_eq!(svcs[0].state, "exited");
    assert!(svcs[0].ports.is_empty());
}

/// A selecção de motor valida o nome (case-insensitive), aplica-o e lê-o de volta; um nome
/// desconhecido dá o erro tipado com a mensagem de contrato histórica. (Toca o átomo global
/// do motor — por isso vive num único teste, sem corrida com outro.)
#[test]
fn set_engine_roundtrips_known_and_types_unknown() {
    assert_eq!(sandbox::set_engine("docker").unwrap(), "docker");
    assert_eq!(sandbox::current_engine_name(), "docker");
    assert_eq!(sandbox::set_engine("PODMAN").unwrap(), "podman"); // case-insensitive
    assert_eq!(sandbox::current_engine_name(), "podman");

    let err = sandbox::set_engine("nonsense").unwrap_err();
    assert_eq!(err, SandboxError::UnknownEngine("nonsense".to_string()));
    assert_eq!(
        err.to_string(),
        "unknown engine `nonsense` (use host|delonix|docker|podman)"
    );
}

/// Ciclo vivo: `compose_ps` numa pasta sem stack devolve ou uma lista (eventualmente vazia)
/// ou um erro tipado honesto — nunca entra em pânico. Exige `docker compose` instalado.
#[test]
#[ignore = "needs docker with the compose plugin"]
fn compose_ps_is_honest_against_a_real_docker() {
    let dir = tempfile::tempdir().unwrap();
    match sandbox::compose_ps(dir.path()) {
        Ok(svcs) => assert!(svcs.is_empty(), "pasta sem stack não devia listar serviços"),
        Err(e) => {
            // docker ausente → Docker(...); compose a reclamar → Compose(...). Ambos honestos.
            let msg = e.to_string();
            assert!(!msg.is_empty(), "o erro deve carregar uma mensagem");
        }
    }
}
