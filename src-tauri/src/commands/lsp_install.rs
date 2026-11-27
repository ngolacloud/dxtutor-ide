//! Installing a missing language server from the registry's recipes (LSP P3).
//!
//! Like `git_clone_plan`: the backend builds the exact command and the UI only shows it, gets the
//! human's approval (`app/approval.ts`), records it (`audit_record`, no audit → no run) and runs it.
//! The plan is built from the TRUSTED registry (bundled + the user's `lsp.json`) — a project file's
//! recipes are never offered — and the managers are looked for on the login shell's PATH
//! (`shellenv`). The rules and the commands live in `tutor_eval::lspinstall`.
//!
//! - `lsp_install_plan` (read-only): every way to install the server of a file on this machine.
//! - `lsp_install_download`: a `github` recipe — dxtutor downloads the pinned asset, checks its
//!   SHA-256 BEFORE unpacking (a mismatch installs nothing) and unpacks it into
//!   `<app data>/lsp-servers/<server>`. It takes the option's id, never a URL: the asset is the one
//!   the registry pins.
//!
//! The terminal recipes (npm, pip, pipx, go, cargo, dotnet, gem, rustup) run in a terminal task
//! the UI opens with the plan's command line and environment; brew and apt are only shown (they
//! may need sudo, which dxtutor never runs).

use std::path::Path;
use std::sync::Mutex;

use tutor_eval::langreg;
use tutor_eval::lspinstall::{self, InstallPlan, PlanCtx, MODE_DOWNLOAD};

use crate::lsp::{self, ServerStatus};

/// A plan, the server it is for, and the registries it came from.
type Planned = (
    InstallPlan,
    langreg::Server,
    std::sync::Arc<tutor_eval::lspconf::Effective>,
);

/// The plan for `path`'s server (`None`: the file has no server).
fn plan_for(path: &str) -> Result<Option<Planned>, String> {
    let Some((server, eff)) = lsp::install_target(path) else {
        return Ok(None);
    };
    let managed =
        lsp::managed_root().ok_or("dxtutor's folder for language servers is not known yet")?;
    let platform = lspinstall::current_platform();
    let home = std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(std::path::PathBuf::from);
    let path_var = lsp::login_path();
    let ctx = PlanCtx {
        managed: &managed,
        platform: &platform,
        home: home.as_deref(),
        path: &path_var,
    };
    let plan = lspinstall::plan(langreg::registry(), &eff.trusted, &server, &ctx);
    Ok(Some((plan, server, eff)))
}

/// Every way to install the language server of `path` on this machine, with the exact commands
/// (read-only). `None` when the file's language has no server.
#[tauri::command]
pub async fn lsp_install_plan(path: String) -> Result<Option<InstallPlan>, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(plan_for(&path)?.map(|(p, _, _)| p)))
        .await
        .map_err(|e| e.to_string())?
}

/// Downloads, checks and unpacks the pinned release of `path`'s server (option `option` of the
/// plan, a `github` recipe), then answers the server's status (installed, found where). The UI has
/// approved and audited it before calling this.
#[tauri::command]
pub async fn lsp_install_download(
    path: String,
    option: String,
) -> Result<Option<ServerStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // one install at a time: two would unpack into the same folder
        static BUSY: Mutex<()> = Mutex::new(());
        let _one = BUSY.lock().map_err(|_| "another install failed midway")?;
        let (plan, server, eff) =
            plan_for(&path)?.ok_or("this file's language has no language server")?;
        let opt = plan
            .options
            .iter()
            .find(|o| o.id == option)
            .ok_or_else(|| format!("no install option `{option}` for {}", plan.label))?;
        if opt.mode != MODE_DOWNLOAD {
            return Err(format!(
                "`{option}` is not a download (it runs in a terminal or by hand)"
            ));
        }
        if !opt.available {
            return Err(format!(
                "{} cannot be downloaded here ({})",
                plan.label,
                opt.missing.as_deref().unwrap_or("unavailable")
            ));
        }
        // the asset the TRUSTED registry pins for this platform (the plan was built from it too)
        let recipe = eff
            .trusted
            .server(&server.id)
            .and_then(|t| t.recipes.iter().find(|r| r.manager == opt.manager))
            .ok_or("the recipe is gone")?;
        let asset = recipe
            .asset_for(&plan.platform)
            .ok_or("no asset for this platform")?;
        let managed =
            lsp::managed_root().ok_or("dxtutor's folder for language servers is not known yet")?;
        let tar = lspinstall::find_on(&lsp::login_path(), "tar");
        lspinstall::install_release(
            &managed,
            &server.id,
            &server.command,
            asset,
            &lspinstall::http_fetch,
            tar.as_deref().map(Path::new),
        )?;
        Ok(lsp::server_status(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}
