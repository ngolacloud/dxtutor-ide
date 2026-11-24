//! Comandos IPC de DevOps em só leitura (A9, docs/v2/UI-AUDIT.md item 10) — passagens directas para
//! `tutor_eval::ops`, num worker bloqueante: as pastas de IaC e o `plan` (ou o drift) com OpenTofu ou
//! Terraform; o estado de um namespace do Kubernetes e o histórico de rollout de um deployment; e o
//! estado e o inventário das CLIs oficiais de cloud. Nada aqui muda infraestrutura: aplicar, fazer
//! rollback, escalar ou apagar são comandos que o humano aprova e corre num terminal.

use std::path::Path;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| format!("ops task failed: {e}"))
}

/// As pastas do projecto com ficheiros `.tf`.
#[tauri::command]
pub async fn ops_iac_dirs(root: String) -> Result<Vec<String>, String> {
    blocking(move || tutor_eval::ops::iac_dirs(Path::new(root.trim()))).await
}

/// `init` + `plan` (ou `plan -refresh-only`) numa pasta do projecto: o diff por recurso e atributo.
#[tauri::command]
pub async fn ops_iac_plan(
    root: String,
    dir: String,
    refresh_only: bool,
) -> Result<tutor_eval::ops::IacPlan, String> {
    blocking(move || tutor_eval::ops::iac_plan(Path::new(root.trim()), &dir, refresh_only)).await
}

/// Pods, serviços, deployments e eventos de um namespace de um contexto (`kubeconfig` opcional:
/// sem ele, o do utilizador).
#[tauri::command]
pub async fn ops_kube_state(
    context: String,
    namespace: String,
    kubeconfig: Option<String>,
) -> Result<tutor_eval::ops::KubeState, String> {
    blocking(move || tutor_eval::ops::kube_state(kubeconfig.as_deref(), &context, &namespace)).await
}

/// As revisões de um deployment (as suas ReplicaSets), a mais recente primeiro.
#[tauri::command]
pub async fn ops_kube_history(
    context: String,
    namespace: String,
    deployment: String,
    kubeconfig: Option<String>,
) -> Result<Vec<tutor_eval::ops::Revision>, String> {
    blocking(move || {
        tutor_eval::ops::kube_history(kubeconfig.as_deref(), &context, &namespace, &deployment)
    })
    .await?
}

/// O estado do `aws`/`gcloud`/`az` (instalado, versão, perfil/projecto/subscrição locais).
#[tauri::command]
pub async fn ops_cloud_status() -> Result<Vec<tutor_eval::ops::CloudCli>, String> {
    blocking(tutor_eval::ops::cloud_status).await
}

/// O inventário em só leitura de um fornecedor pela sua CLI oficial.
#[tauri::command]
pub async fn ops_cloud_inventory(
    provider: String,
) -> Result<tutor_eval::ops::CloudInventory, String> {
    blocking(move || tutor_eval::ops::cloud_inventory(&provider)).await
}
