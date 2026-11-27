//! Comandos Tauri da revisão Co-Dev assistida e da porta de integração (Multi Co-Dev, fase 4) —
//! adaptadores finos sobre `crate::codev_review` (sem Tauri). A regra vive lá e no
//! `tutor_board::project::integration::gate`: integrar só com as três condições a valer para as
//! pontas de AGORA (verificações obrigatórias no candidato actual, o revisor Co-Dev com os critérios
//! actuais, a aprovação funcional dada para eles). Pedir a revisão e integrar correm só o comando
//! aprovado e vão ao registo de auditoria antes e com o resultado (no Rust).
//! - `codev-review://event` `{root, key, review, stage, …}` — um passo de uma revisão a correr
//!   (`check`/`checked`/`rules`/`reviewer`/`reviewer-tool`/`done`).

use std::path::PathBuf;

use tauri::{Emitter, Manager};

use crate::codev_review as uc;

/// A pasta das worktrees temporárias de integração (`app_local_data_dir/integration/<repo>/<issue>`).
pub(crate) fn ibase(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("sem directório de dados: {e}"))?
        .join("integration"))
}

fn db(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::board::db_path(app)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("review task failed: {e}"))?
}

/// O painel de revisão da issue: a porta agora (as três condições, com o porquê), a revisão mais
/// recente e o que cada botão correria. SÓ LEITURA.
#[tauri::command]
pub async fn codev_review_state(
    app: tauri::AppHandle,
    root: String,
    key: String,
) -> Result<uc::ReviewState, String> {
    let (db, ib, wb) = (db(&app)?, ibase(&app)?, super::codev_worktree::base(&app)?);
    blocking(move || uc::state(&db, &ib, &wb, root.trim(), key.trim())).await
}

/// «Request review»: com o comando aprovado (`command`, tal como o painel o mostrou) faz o candidato
/// (o ramo da issue fundido na ponta do ramo por omissão) numa worktree temporária e corre lá as
/// verificações, as regras do arquitecto e — se tudo passar — o revisor Co-Dev (`provider`/`model`:
/// os do Co-Dev). Devolve o id da revisão; o resto chega por `codev-review://event`. Auditado.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn codev_review_request(
    app: tauri::AppHandle,
    root: String,
    key: String,
    command: String,
    decided_at: Option<i64>,
    provider: Option<String>,
    model: Option<String>,
    language: Option<String>,
) -> Result<i64, String> {
    let (db, ib) = (db(&app)?, ibase(&app)?);
    let config = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let provider = provider
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "claude".into());
    let reviewer = reviewer_for(config, Some(PathBuf::from(root.trim())), provider, model);
    let lang = tutor_agent::context::ReplyLang::from_ui(language.as_deref());
    let env = Some(crate::shellenv::get().clone());
    let root_key = (root.trim().to_string(), key.trim().to_string());
    let started = blocking(move || {
        uc::request(
            &db,
            &ib,
            root.trim(),
            key.trim(),
            &command,
            decided_at,
            reviewer,
            lang,
            env,
        )
    })
    .await?;
    if let Some(job) = started.job {
        let em = app.clone();
        std::thread::spawn(move || {
            job.run(std::sync::Arc::new(move |v| {
                let _ = em.emit("codev-review://event", v);
            }));
            // Multi Co-Dev, phase 5: with `integrate` (or `pr`) delegated, a review that met every
            // criterion goes on through the gate (nothing happens without a delegation)
            crate::codev_autonomy::review_done(&root_key.0, &root_key.1);
        });
    }
    Ok(started.id)
}

/// The reviewer of a review: the Co-Dev's provider and model, built only when it runs (after the
/// checks passed). Also the autonomy's (phase 5), with the delegation's provider and model.
pub(crate) fn reviewer_for(
    config: PathBuf,
    root: Option<PathBuf>,
    provider: String,
    model: Option<String>,
) -> uc::MakeReviewer {
    Box::new(move || {
        let model = crate::codev_agent::resolve_model(&provider, model.as_deref());
        let key = crate::keys::resolve(&config, &provider);
        let host = tutor_llm::chat::ollama_host();
        // the reviewer obeys the model-call policy like the Co-Dev it reviews
        let policy = crate::llm_policy::current(root.as_deref());
        policy.check(&provider, Some(&host))?;
        let p = crate::codev_agent::make_provider(
            &provider,
            key,
            Some(&host),
            crate::keys::anthropic_workspace_id(),
            policy.gateway.as_ref(),
        )?;
        Ok((p, model))
    })
}

/// Pára a revisão a correr da issue (a verificação em curso é morta, o revisor pára).
#[tauri::command]
pub async fn codev_review_cancel(root: String, key: String) -> bool {
    uc::cancel(root.trim(), key.trim())
}

/// «Integrate»: com o comando aprovado, pergunta outra vez a porta com os factos de agora e só
/// com as três condições a valer avança o ramo por omissão para o commit revisto (fast-forward),
/// depois do undo e do secret scan; nunca push, nunca forçado. Auditado antes e com o resultado.
#[tauri::command]
pub async fn codev_review_integrate(
    app: tauri::AppHandle,
    root: String,
    key: String,
    command: String,
    decided_at: Option<i64>,
) -> Result<uc::Integrated, String> {
    let (db, wb) = (db(&app)?, super::codev_worktree::base(&app)?);
    blocking(move || uc::integrate(&db, &wb, root.trim(), key.trim(), &command, decided_at)).await
}
