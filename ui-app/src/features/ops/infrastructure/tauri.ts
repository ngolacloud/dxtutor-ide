/* ═════════ feature `ops` — adaptador Tauri (A9) ═════════
   `ops_iac_dirs`, `ops_iac_plan`, `ops_kube_state`, `ops_kube_history`, `ops_cloud_status`,
   `ops_cloud_inventory` (commands/ops.rs), e o `audit_record` (board.rs, r23 F1) pelo cliente partilhado.
   Não toca em `window`. */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import { auditClient } from "../../../platform/tauri/audit";
import type { AuditPort, OpsPort } from "../application/ports";
import type { CloudCli, CloudInventory, IacPlan, KubeState, Revision } from "../domain/types";

export const tauriOps = (inv: Invoker = invoke): OpsPort => ({
  iacDirs: (root) => inv<string[]>("ops_iac_dirs", { root }),
  iacPlan: (root, dir, refreshOnly) => inv<IacPlan>("ops_iac_plan", { root, dir, refreshOnly }),
  kubeState: (t) => inv<KubeState>("ops_kube_state", { context: t.context, namespace: t.namespace, kubeconfig: t.kubeconfig || null }),
  kubeHistory: (t, deployment) => inv<Revision[]>("ops_kube_history", { context: t.context, namespace: t.namespace, deployment, kubeconfig: t.kubeconfig || null }),
  cloudStatus: () => inv<CloudCli[]>("ops_cloud_status"),
  cloudInventory: (provider) => inv<CloudInventory>("ops_cloud_inventory", { provider }),
});

/** O registo de auditoria das operações do Ops, na pasta aberta (sem pasta não há o que auditar nem o que correr). */
export const tauriAudit = (root: () => string | null, inv: Invoker = invoke): AuditPort => ({
  record: async (e) => {
    const r = root();
    if (!r) throw new Error("no folder open");
    await auditClient(inv).record(r, { feature: "ops", ...e, scope: e.scope || undefined, reason: e.reason || undefined, outcome: e.approved ? "sent" : undefined });
  },
});
