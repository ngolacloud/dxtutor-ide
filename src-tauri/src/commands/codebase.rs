//! Comandos IPC sobre a base de código (A10, docs/v2/UI-AUDIT.md §3) — passagens directas, num worker
//! bloqueante: as dependências atrasadas e vulneráveis (`tutor_eval::deps`) e o mapa para entrar no
//! projecto (`tutor_eval::onboard`). Só leitura: actualizar é um comando que o humano aprova.

use std::path::Path;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("codebase task failed: {e}"))
}

/// O que está atrasado e o que é vulnerável, por ecossistema (`online`: deixa as ferramentas
/// perguntarem aos registos; sem ele, só o Cargo, com a base local de avisos).
#[tauri::command]
pub async fn deps_report(
    root: String,
    online: bool,
) -> Result<tutor_eval::deps::DepsReport, String> {
    blocking(move || tutor_eval::deps::report(Path::new(root.trim()), online)).await
}

/// O mapa do projecto: linguagens, pontos de entrada, documentação, ficheiros mais mexidos, pessoas,
/// módulos com mais símbolos.
#[tauri::command]
pub async fn onboard_map(root: String) -> Result<tutor_eval::onboard::OnboardMap, String> {
    blocking(move || tutor_eval::onboard::map(Path::new(root.trim()))).await
}
