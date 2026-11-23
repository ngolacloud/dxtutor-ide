//! Adaptador IPC do ditado local (whisper.cpp) — fino sobre `crate::dictation`.
//!
//! `dictation_stop` corre o whisper (segundos) numa thread de bloqueio: um comando
//! síncrono correria na thread principal e congelava a janela.

use crate::dictation::{self, Status};

/// O que está instalado (whisper.cpp, modelo, gravador) e se há gravação em curso.
#[tauri::command]
pub fn dictation_status() -> Status {
    dictation::status(&dictation::detect())
}

/// Começa a gravar do microfone.
#[tauri::command]
pub fn dictation_start() -> Result<(), String> {
    dictation::start(&dictation::detect())
}

/// Pára a gravação e devolve o texto transcrito (`lang`: `pt`, `en`, … ou `auto`).
#[tauri::command]
pub async fn dictation_stop(lang: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        dictation::stop(&dictation::detect(), lang.as_deref().unwrap_or("auto"))
    })
    .await
    .map_err(|e| format!("dictation task failed: {e}"))?
}

/// Pára e deita fora a gravação.
#[tauri::command]
pub fn dictation_cancel() {
    dictation::cancel()
}
