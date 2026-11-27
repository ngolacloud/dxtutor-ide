//! Comandos Tauri da autonomia delegada e dos pull requests (Multi Co-Dev, fase 5) — adaptadores finos
//! sobre `crate::codev_autonomy` e `crate::codev_pr` (sem Tauri). As regras vivem lá e no
//! `tutor_board::project::autonomy`: quem pode delegar (o papel, perguntado ao delegar e outra vez antes de
//! cada uso), a validade (no máximo 7 dias), o interruptor geral, o limite por hora, e a porta de
//! integração da fase 4, que a autonomia nunca salta. Quem age é sempre o do backend (a identidade git
//! da pasta), nunca um nome vindo da interface.
//! - `codev-autonomy://event` `{root, event, integrated?, pr?}` — um passo da autonomia (feito ou
//!   recusado), com as linhas do registo de auditoria que escreveu.

use std::path::PathBuf;

use tauri::Manager;
use tutor_board::project::autonomy::{Delegation, Grant, Switch};

use crate::codev_autonomy as au;
use crate::codev_pr as pr;

fn db(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::board::db_path(app)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("autonomy task failed: {e}"))?
}

/// O programa `gh`: `DXTUTOR_GH` (um caminho absoluto, para o auto-teste usar um `gh` falso), senão
/// o `gh` do PATH.
pub fn gh_program() -> String {
    std::env::var("DXTUTOR_GH")
        .ok()
        .map(|p| p.trim().to_string())
        .filter(|p| p.starts_with('/') && std::path::Path::new(p).is_file())
        .unwrap_or_else(|| "gh".into())
}

/// Instala o runtime da autonomia (no arranque da app): onde estão a base, as worktrees e o `gh`, como
/// construir o revisor de uma delegação e como avisar a interface.
pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let review_app = app.clone();
    let notify_app = app.clone();
    au::install(au::Runtime {
        db: db(app)?,
        ibase: super::codev_review::ibase(app)?,
        wbase: super::codev_worktree::base(app)?,
        gh: gh_program(),
        env: std::sync::Arc::new(|| Some(crate::shellenv::get().clone())),
        reviewer: std::sync::Arc::new(move |provider, model| {
            super::codev_review::reviewer_for(
                config.clone(),
                None, // the open folder's policy (the delegation runs in it)
                provider.to_string(),
                model.map(str::to_string),
            )
        }),
        review_emit: std::sync::Arc::new(move |v| {
            let _ = review_app.emit("codev-review://event", v);
        }),
        notify: std::sync::Arc::new(move |v| {
            let _ = notify_app.emit("codev-autonomy://event", v);
        }),
    });
    Ok(())
}

/// A autonomia de uma issue (`key`) ou da pasta: o interruptor geral, as delegações (as da issue e as da
/// sprint dela), os passos mais recentes com as linhas de auditoria, e o limite por hora. SÓ LEITURA.
#[tauri::command]
pub async fn codev_autonomy_state(
    app: tauri::AppHandle,
    root: String,
    key: Option<String>,
) -> Result<au::Overview, String> {
    let db = db(&app)?;
    blocking(move || {
        let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
        au::overview(&db, root.trim(), key.as_deref())
    })
    .await
}

/// Delega acções (`review`, `integrate`, `pr`) numa issue ou numa sprint, por um tempo (no máximo 7
/// dias). Quem delega é a identidade git da pasta; o papel verifica-se no Rust. Auditado.
#[tauri::command]
pub async fn codev_autonomy_grant(
    app: tauri::AppHandle,
    root: String,
    grant: Grant,
) -> Result<Delegation, String> {
    let db = db(&app)?;
    blocking(move || {
        let root = root.trim().to_string();
        au::grant(&db, &root, &grant, &au::Identity::of(&root))
    })
    .await
}

/// Revoga uma delegação (qualquer pessoa pode: só tira poder). Auditado.
#[tauri::command]
pub async fn codev_autonomy_revoke(
    app: tauri::AppHandle,
    root: String,
    id: i64,
    reason: Option<String>,
) -> Result<Delegation, String> {
    let db = db(&app)?;
    blocking(move || {
        let root = root.trim().to_string();
        au::revoke(
            &db,
            &root,
            id,
            reason.as_deref().unwrap_or(""),
            &au::Identity::of(&root),
        )
    })
    .await
}

/// «Pause autonomy» / «Resume autonomy»: o interruptor de toda a app, que o backend lê antes de cada
/// acção autónoma (pausar pára também as revisões autónomas a correr). Auditado.
#[tauri::command]
pub async fn codev_autonomy_pause(
    app: tauri::AppHandle,
    root: String,
    paused: bool,
    reason: Option<String>,
) -> Result<Switch, String> {
    let db = db(&app)?;
    blocking(move || {
        let root = root.trim().to_string();
        au::set_paused(
            &db,
            &root,
            paused,
            reason.as_deref().unwrap_or(""),
            &au::Identity::of(&root),
        )
    })
    .await
}

/// O pull request de uma issue: o que «Open a pull request» correria (o push e o `gh pr create`), ou
/// porque não; o `gh` (instalado, com sessão); e o pull request já aberto, como o GitHub o tem (SÓ
/// LEITURA: `git ls-remote`, `gh pr view`).
#[tauri::command]
pub async fn codev_pr_state(
    app: tauri::AppHandle,
    root: String,
    key: String,
) -> Result<pr::PrState, String> {
    let db = db(&app)?;
    blocking(move || pr::state(&db, root.trim(), key.trim(), &gh_program())).await
}

/// «Open a pull request»: com o texto aprovado (tal como `codev_pr_state` o deu) pergunta outra vez a
/// porta, faz o secret scan, envia o ramo da issue (nunca o ramo por omissão, nunca forçado, nunca para
/// um ramo remoto que o dxtutor não criou) e abre o pull request com a evidência da porta. Auditado
/// antes e com o resultado; o merge fica com o GitHub.
#[tauri::command]
pub async fn codev_pr_open(
    app: tauri::AppHandle,
    root: String,
    key: String,
    command: String,
    decided_at: Option<i64>,
) -> Result<pr::Opened, String> {
    let db = db(&app)?;
    blocking(move || {
        pr::open_as(
            &db,
            root.trim(),
            key.trim(),
            &command,
            crate::codev_review::By::human(decided_at),
            &gh_program(),
        )
    })
    .await
}
