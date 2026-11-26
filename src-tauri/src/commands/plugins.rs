//! Adaptador IPC dos plugins de curso — fronteira fina sobre `tutor_plugins`.
//!
//! A lógica (manifesto, validação, origem, instalação, registo) vive no crate
//! `tutor-plugins`, partilhado com o CLI `dxt plugin`. Aqui só há serde, `spawn_blocking`
//! (a instalação faz rede e disco) e erro→`String`. Depois de instalar/remover, os cursos
//! aparecem/desaparecem em `list_courses`/`get_course`/`submit_step` sozinhos: o
//! `crate::study::all_courses` recarrega quando o registo muda.

use tutor_plugins::{Installed, Outcome, Source, Store};

const HOST_VERSION: &str = env!("CARGO_PKG_VERSION");

fn store() -> Result<Store, String> {
    Store::open_default()
}

/// Os plugins instalados, com o manifesto de cada um (linguagem: nome, ícone, extensão,
/// indentação). Um plugin estragado vem com `error` em vez de `manifest`.
#[tauri::command]
pub async fn plugin_list() -> Result<Vec<Installed>, String> {
    Ok(store()?.list())
}

/// Instala ou actualiza um plugin. `source`: `python`, `owner/repo[@ref]`, um URL do GitHub,
/// um URL `.zip`, ou uma pasta/zip locais (ver `tutor_plugins::source`).
#[tauri::command]
pub async fn plugin_install(source: String) -> Result<Outcome, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src = Source::parse(&source)?;
        store()?.install(&src, HOST_VERSION, crate::study::builtin_courses())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove um plugin instalado pelo id. Devolve o id removido.
#[tauri::command]
pub async fn plugin_remove(id: String) -> Result<String, String> {
    store()?.remove(&id).map(|e| e.id)
}
