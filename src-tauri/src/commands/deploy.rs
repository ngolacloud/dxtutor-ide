//! The guided deploy (r23 F4c2, docs/v2/AUDIT-r23.md §4.4 — D01–D04): thin adapters over
//! `tutor_platform::deploy`. The rule (what blocks, the waivers, HEAD and manifests unchanged) lives
//! there; here, production's typed confirmation, the audit log before and after, the record in the
//! project base, and the rollout's lines as `deploy://output`.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter};
use tutor_platform::deploy::{self, Target, Tools};
use tutor_platform::keychain::OsStore;

fn store() -> &'static OsStore {
    static S: std::sync::OnceLock<OsStore> = std::sync::OnceLock::new();
    S.get_or_init(OsStore::new)
}

/// Where a deploy goes, as the UI knows it (the Environments' clusters, the Vault it points at).
#[derive(serde::Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct TargetArg {
    pub env: String,
    pub context: String,
    pub namespace: String,
    pub kubeconfig: Option<String>,
    pub staging_context: Option<String>,
    pub staging_namespace: Option<String>,
    pub vault_addr: Option<String>,
    pub vault_namespace: Option<String>,
    pub kv_mount: Option<String>,
}

impl TargetArg {
    fn target(self) -> Result<Target, String> {
        let vault = match self
            .vault_addr
            .as_deref()
            .map(str::trim)
            .filter(|a| !a.is_empty())
        {
            Some(a) => Some(tutor_platform::vault::Target::new(
                a,
                self.vault_namespace.as_deref(),
            )?),
            None => None,
        };
        Ok(Target {
            env: self.env,
            context: self.context.trim().into(),
            namespace: self.namespace.trim().into(),
            kubeconfig: self.kubeconfig,
            staging: match (self.staging_context, self.staging_namespace) {
                (Some(c), Some(n)) => Some((c, n)),
                _ => None,
            },
            vault,
            kv_mount: self.kv_mount,
        })
    }
}

fn tools() -> Tools<'static> {
    Tools {
        cmd: &crate::shellenv::command,
        has: &crate::shellenv::has,
        store: store(),
    }
}

/// The plan: target, identity, secrets (names only), every preflight check, the strategy, and the
/// exact commands; what blocks and what can be waived.
#[tauri::command]
pub async fn deploy_plan(root: String, target: TargetArg) -> Result<deploy::DeployPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let t = target.target()?;
        deploy::plan(&tools(), &PathBuf::from(root.trim()), &t)
    })
    .await
    .map_err(|e| format!("deploy task failed: {e}"))?
}

#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Waiver {
    pub gate: String,
    pub reason: String,
}

/// Rolls a plan out: production needs `confirm` = `production` (typed) and a reason; the plan is checked
/// again (blockers, waivers, HEAD, manifests); the decision goes to the audit log first, the rollout's
/// lines arrive as `deploy://output`, and the result is recorded (project base) and audited.
#[tauri::command]
pub async fn deploy_rollout(
    app: AppHandle,
    root: String,
    plan_id: String,
    confirm: Option<String>,
    reason: Option<String>,
    waivers: Vec<Waiver>,
) -> Result<tutor_board::project::deploys::DeployRecord, String> {
    let w: Vec<(String, String)> = waivers
        .iter()
        .map(|x| (x.gate.clone(), x.reason.clone()))
        .collect();
    let (plan, _, _, _) = deploy::check(&plan_id, &tools(), &w)?;
    let reason = reason
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty());
    deploy::confirmed(&plan.env, confirm.as_deref(), reason.as_deref())?;
    let label = format!(
        "deploy {} to {} ({}/{}){}",
        &plan.version[..plan.version.len().min(12)],
        plan.env,
        plan.context,
        plan.namespace,
        if w.is_empty() {
            String::new()
        } else {
            format!(
                " · waived: {}",
                w.iter()
                    .map(|(g, r)| format!("{g} ({r})"))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        }
    );
    crate::board::audit_backend(&app, &root, "deploy", "rollout", &label, reason.as_deref())
        .map_err(|e| {
            format!(
                "not deployed: the audit log could not record it ({})",
                e.message
            )
        })?;
    let app2 = app.clone();
    let id = plan_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        deploy::rollout(&id, &tools(), &w, &mut |line| {
            let _ = app2.emit(
                "deploy://output",
                serde_json::json!({"planId": id, "line": line}),
            );
        })
    })
    .await
    .map_err(|e| format!("deploy task failed: {e}"))??;
    let gates: serde_json::Map<String, serde_json::Value> = result
        .plan
        .gates
        .iter()
        .map(|g| {
            (
                g.id.clone(),
                serde_json::to_value(g.status).unwrap_or_default(),
            )
        })
        .collect();
    let rec = tutor_board::project::deploys::DeployRecord {
        env: result.plan.env.clone(),
        context: result.plan.context.clone(),
        namespace: result.plan.namespace.clone(),
        version: result.plan.version.clone(),
        issue: result.plan.issue.clone(),
        approver: result.plan.approver.clone(),
        ok: result.ok,
        failed_step: result.failed_step.clone(),
        waivers: serde_json::to_string(&result.waivers).unwrap_or_else(|_| "[]".into()),
        gates: serde_json::Value::Object(gates).to_string(),
        reason: reason.clone(),
        ..Default::default()
    };
    let id = crate::board::record_deploy(&app, &root, rec.clone()).map_err(|e| e.message)?;
    let _ = crate::board::audit_backend(
        &app,
        &root,
        "deploy",
        if result.ok {
            "rollout-ok"
        } else {
            "rollout-failed"
        },
        &format!(
            "{label}{}",
            result
                .failed_step
                .as_deref()
                .map(|s| format!(" · failed at {s}"))
                .unwrap_or_default()
        ),
        None,
    );
    Ok(tutor_board::project::deploys::DeployRecord { id, ..rec })
}
