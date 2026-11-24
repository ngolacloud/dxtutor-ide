//! Comandos IPC do «Under the hood» real (A8, docs/v2/UI-AUDIT.md item 7) — passagens directas
//! para `tutor_eval::hood`, num worker bloqueante (compilar e correr é trabalho longo):
//! as instruções de máquina de cada linha (`rustc -C debuginfo=2` + `objdump -d -l`), o bytecode
//! Python de cada linha (`dis`), e o crescimento medido com N crescente e a classe de
//! complexidade que os tempos ajustam.

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("hood task failed: {e}"))
}

/// As instruções de cada linha de um programa Rust completo (`release`: com `-C opt-level=3`).
#[tauri::command]
pub async fn hood_line_asm(
    code: String,
    release: bool,
) -> Result<tutor_eval::hood::LineAsm, String> {
    blocking(move || tutor_eval::hood::line_asm(&code, release)).await
}

/// O bytecode CPython de cada linha de um ficheiro Python, por função.
#[tauri::command]
pub async fn hood_python_bytecode(code: String) -> Result<tutor_eval::hood::Bytecode, String> {
    blocking(move || tutor_eval::hood::python_bytecode(&code)).await
}

/// Constrói o programa uma vez e corre-o com cada `n` (o primeiro argumento), mede o tempo e
/// ajusta-o a uma classe de complexidade.
#[tauri::command]
pub async fn measure_growth(
    code: String,
    sizes: Vec<u64>,
) -> Result<tutor_eval::hood::Growth, String> {
    blocking(move || tutor_eval::hood::measure_growth(&code, &sizes)).await
}
