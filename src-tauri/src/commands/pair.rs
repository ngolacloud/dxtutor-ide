//! Comandos IPC de PairCode (secção 1) — adaptadores finos sobre o caso de uso
//! Tauri-free `crate::pair`.
//!
//! Nenhuma regra vive aqui. O mecanismo par-a-par (`pair::Pair` — TCP + handshake selado
//! ChaCha20-Poly1305 + sessão WebSocket) e o contrato do token já são Tauri-free: `Pair`,
//! `Pair::{host,join,send,stop}` e `pair::Events` não tocam em tipos Tauri. O adaptador só
//! faz a **infra de fronteira**: desembrulha o `tauri::State<'_, pair::Pair>` para o `Pair`
//! gerido, e **veste a emissão** dos eventos `pair-status`/`pair-msg` sobre a `AppHandle`
//! (o `pair::Events` que o caso de uso invoca), como o `commands::assistant` faz com os
//! eventos `llm://*`. Comportamento idêntico ao que `lib.rs` tinha antes da Etapa 3 —
//! mesmos nomes, args, contratos serde, eventos e mensagens de erro (o `String` de
//! `pair::Pair` passa cru). O registo do estado (`Pair`) continua gerido pelo Tauri
//! (`.manage(pair::Pair::default())` em `lib.rs`).
//!
//! Consumido pela `ui-app` (`ui-app/src/pair.ts`): nome, args e eventos preservam-se.

use crate::pair;

/// Onde a sessão reporta: ligamos os callbacks do caso de uso aos eventos Tauri que a UI
/// escuta (`pair-status` para o estado, `pair-msg` para cada frame recebido do par).
fn pair_events(app: &tauri::AppHandle) -> pair::Events {
    use tauri::Emitter;
    let (a, b) = (app.clone(), app.clone());
    pair::Events {
        status: std::sync::Arc::new(move |v| {
            let _ = a.emit("pair-status", v);
        }),
        msg: std::sync::Arc::new(move |m| {
            let _ = b.emit("pair-msg", m);
        }),
    }
}

/// PairCode: start hosting and return the token for the other developer.
#[tauri::command]
pub async fn pair_host(
    app: tauri::AppHandle,
    state: tauri::State<'_, pair::Pair>,
    name: String,
    port: Option<u16>,
) -> Result<String, String> {
    let p = state.inner().clone();
    p.host(&name, port, pair_events(&app)).await
}

/// PairCode: join with a token; `via` ("host:port") overrides the addresses inside it.
#[tauri::command]
pub async fn pair_join(
    app: tauri::AppHandle,
    state: tauri::State<'_, pair::Pair>,
    token: String,
    via: Option<String>,
) -> Result<String, String> {
    let p = state.inner().clone();
    p.join(&token, via, pair_events(&app)).await
}

#[tauri::command]
pub fn pair_send(state: tauri::State<'_, pair::Pair>, msg: String) -> Result<(), String> {
    state.send(&msg)
}

#[tauri::command]
pub fn pair_stop(app: tauri::AppHandle, state: tauri::State<'_, pair::Pair>) {
    use tauri::Emitter;
    state.stop();
    let _ = app.emit("pair-status", serde_json::json!({"state": "idle"}));
}
