//! Comandos IPC de sandbox / run (secção 13) — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::sandbox`.
//!
//! Nenhuma regra vive aqui. O shaping do `docker compose ps` ([`sandbox::parse_compose_ps`]),
//! a validação do nome de motor e o erro tipado ([`sandbox::SandboxError`]) estão no caso de
//! uso. `compose_ps` corre o trabalho num worker bloqueante — correr `docker` é I/O de
//! processo, nunca na thread da janela — e mapeia o erro → `String` só na fronteira (o `join`
//! da tarefa pelo seu `to_string`, o erro do caso de uso pelo seu `Display`, as mesmas
//! mensagens que `lib.rs` emitia). `get_sandbox_engine`/`set_sandbox_engine` são síncronos
//! (leitura/escrita dum átomo global em `tutor_eval`, sem I/O de processo). Comportamento
//! idêntico ao anterior — mesmos nomes, args e contratos serde.
//!
//! Nenhum destes comandos é invocado pela `ui-app`; preservam-se por serem contrato público.

use crate::sandbox::{self, ComposeService};
use std::path::Path;

/// Stack services (F8): lista os serviços da stack Compose sob `root`, via `docker compose
/// ps --format json`. Honesto (nada simulado). Corre fora da thread da janela.
#[tauri::command]
pub async fn compose_ps(root: String) -> Result<Vec<ComposeService>, String> {
    tauri::async_runtime::spawn_blocking(move || sandbox::compose_ps(Path::new(&root)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Current sandbox engine as a short string: `"host" | "delonix" | "docker" | "podman"`.
#[tauri::command]
pub async fn get_sandbox_engine() -> String {
    sandbox::current_engine_name()
}

/// Switch the sandbox engine at runtime. Accepts `"delonix" | "docker" | "podman" | "host"`
/// (case-insensitive). Everything that executes student/user code afterwards honors it.
#[tauri::command]
pub async fn set_sandbox_engine(engine: String) -> Result<String, String> {
    sandbox::set_engine(&engine).map_err(|e| e.to_string())
}
