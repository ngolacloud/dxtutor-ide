//! Teste integrado do caso de uso «Dev Containers» (Etapa 3 — grupo devcontainer).
//!
//! Corre de FORA do crate `dxtutor_ide_lib`, contra a API pública (`devcontainer::*`), a
//! mesma fronteira que os comandos Tauri (`devcontainer_info`/`devcontainer_up`/
//! `devcontainer_session_*`) atravessam, sem o runtime Tauri. Prova que a fatia liga:
//! descoberta + parsing JSONC + resolução de imagem + erro tipado, com o comportamento (e
//! as mensagens) preservados da versão em `lib.rs`.
//!
//! A suite por omissão é **offline**: só exercita os caminhos que falham/decidem antes de
//! tocar no motor de contentores (docker/podman). O ciclo vivo real fica `#[ignore]` (exige
//! um motor de contentores com daemon a correr — como os testes vivos do grupo debug).

use dxtutor_ide_lib::devcontainer::{self, DevcontainerError};
use std::fs;
use tempfile::tempdir;

/// `info` sobre um `devcontainer.json` real (JSONC): present + name/image/path, best-effort.
#[test]
fn info_reads_a_real_jsonc_config() {
    let dir = tempdir().unwrap();
    fs::create_dir(dir.path().join(".devcontainer")).unwrap();
    fs::write(
        dir.path().join(".devcontainer/devcontainer.json"),
        "{\n  // ambiente do projecto\n  \"name\": \"dxtutor\",\n  \"image\": \"debian:bookworm\"\n}",
    )
    .unwrap();

    let i = devcontainer::info(dir.path());
    assert!(i.present);
    assert_eq!(i.name.as_deref(), Some("dxtutor"));
    assert_eq!(i.image.as_deref(), Some("debian:bookworm"));
    assert!(i.path.is_some());

    // Pasta vazia → present:false (nunca um erro).
    let empty = tempdir().unwrap();
    assert!(!devcontainer::info(empty.path()).present);
}

/// `up` numa pasta sem `devcontainer.json` → erro tipado `NoConfig`, com a mensagem
/// histórica, ANTES de tocar no motor de contentores.
#[test]
fn up_without_a_config_is_a_typed_error_before_the_engine() {
    let dir = tempdir().unwrap();
    let err = devcontainer::up(dir.path()).unwrap_err();
    assert_eq!(err, DevcontainerError::NoConfig);
    assert_eq!(err.to_string(), "No devcontainer.json in this folder.");
}

/// `up` com um `devcontainer.json` sem `image` nem `build.dockerfile` → `NoImageOrBuild`
/// (a resolução de imagem decide antes de qualquer build/run).
#[test]
fn up_without_image_or_build_is_a_typed_error() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join(".devcontainer.json"), "{ \"name\": \"x\" }").unwrap();
    let err = devcontainer::up(dir.path()).unwrap_err();
    assert_eq!(err, DevcontainerError::NoImageOrBuild);
    assert_eq!(
        err.to_string(),
        "devcontainer.json has neither `image` nor `build.dockerfile`."
    );
}

/// `up` com JSON partido → `InvalidJson`, com o prefixo histórico (não `NoConfig`).
#[test]
fn up_with_broken_json_is_a_typed_error() {
    let dir = tempdir().unwrap();
    fs::write(dir.path().join(".devcontainer.json"), "{ not json").unwrap();
    match devcontainer::up(dir.path()).unwrap_err() {
        DevcontainerError::InvalidJson(_) => {}
        other => panic!("esperado InvalidJson, veio {other:?}"),
    }
}

/// A sessão persistente: sem container a correr, `session_exec` dá `NoSession` e
/// `session_status` reporta `running:false` com o nome determinístico — alcançável offline.
#[test]
fn session_without_a_running_container_is_a_typed_error() {
    let dir = tempdir().unwrap();
    assert_eq!(
        devcontainer::session_exec(dir.path(), "echo hi").unwrap_err(),
        DevcontainerError::NoSession
    );
    let st = devcontainer::session_status(dir.path());
    assert!(!st.running);
    assert!(st.name.starts_with("dxtutor-sess-"));
}

/// Ciclo vivo real (precisa de docker/podman com daemon): sobe a sessão, corre um comando
/// dentro dela, e desliga. `#[ignore]` por omissão — corre com `--ignored` numa máquina com
/// motor de contentores, como os testes vivos do grupo debug.
#[test]
#[ignore = "requer docker/podman com daemon a correr"]
fn live_session_up_exec_down() {
    let dir = tempdir().unwrap();
    fs::write(
        dir.path().join(".devcontainer.json"),
        "{ \"image\": \"docker.io/library/alpine:3\" }",
    )
    .unwrap();

    let up = devcontainer::session_up(dir.path()).expect("session up");
    assert!(up.ok);
    assert!(devcontainer::session_status(dir.path()).running);

    let out = devcontainer::session_exec(dir.path(), "echo hi").expect("session exec");
    assert!(out.ok);
    assert!(out.stdout.contains("hi"));

    devcontainer::session_down(dir.path()).expect("session down");
    assert!(!devcontainer::session_status(dir.path()).running);
}
