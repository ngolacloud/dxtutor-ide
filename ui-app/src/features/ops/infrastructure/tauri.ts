/* ═════════ feature `ops` — adaptador Tauri (A9) ═════════
   `ops_iac_dirs`, `ops_iac_plan`, `ops_kube_state`, `ops_kube_history`, `ops_cloud_status`,
   `ops_cloud_inventory` (commands/ops.rs), o pipeline de IaC da r23 F4b (`iac_pipeline_run` + evento
   `iac://stage`, `iac_apply_command`, `iac_state` em commands/iac.rs; `iac_risks`/`iac_risk_accept`/
   `iac_risk_revoke` em board.rs), e o `audit_record` (board.rs, r23 F1) pelo cliente partilhado.
   Não toca em `window`. */

import { invoke, isDesktop, listen, type Invoker } from "../../../platform/tauri/core";
import { auditClient } from "../../../platform/tauri/audit";
import type { AuditPort, OpsPort } from "../application/ports";
import type { AcceptedRisk, ApplyInfo, CloudCli, CloudInventory, IacPlan, IacState, KubeState, PipelineRun, Revision, Stage } from "../domain/types";

type Listen = (event: string, f: (payload: unknown) => void) => unknown;

export const tauriOps = (inv: Invoker = invoke, on: Listen = (e, f) => (isDesktop() ? listen(e, f) : null)): OpsPort => ({
  iacDirs: (root) => inv<string[]>("ops_iac_dirs", { root }),
  iacPlan: (root, dir, refreshOnly) => inv<IacPlan>("ops_iac_plan", { root, dir, refreshOnly }),
  kubeState: (t) => inv<KubeState>("ops_kube_state", { context: t.context, namespace: t.namespace, kubeconfig: t.kubeconfig || null }),
  kubeHistory: (t, deployment) => inv<Revision[]>("ops_kube_history", { context: t.context, namespace: t.namespace, deployment, kubeconfig: t.kubeconfig || null }),
  cloudStatus: () => inv<CloudCli[]>("ops_cloud_status"),
  cloudInventory: (provider) => inv<CloudInventory>("ops_cloud_inventory", { provider }),
  /* r23 F4b */
  pipeline: (root, dir, target) => inv<PipelineRun>("iac_pipeline_run", { root, dir, target }),
  onStage: (f) => {
    void on("iac://stage", (p) => {
      const e = p as { root?: string; dir?: string; stage?: Stage };
      if (e && typeof e.root === "string" && typeof e.dir === "string" && e.stage) f({ root: e.root, dir: e.dir, stage: e.stage });
    });
  },
  applyCommand: (root, dir, planId) => inv<ApplyInfo>("iac_apply_command", { root, dir, planId }),
  iacState: (root, dir) => inv<IacState>("iac_state", { root, dir }),
  risks: (root) => inv<AcceptedRisk[]>("iac_risks", { root }),
  acceptRisk: (root, r) => inv<AcceptedRisk>("iac_risk_accept", { root, key: r.key, kind: r.kind, label: r.label, reason: r.reason }),
  revokeRisk: (root, id) => inv<boolean>("iac_risk_revoke", { root, id }),
});

/** O registo de auditoria das operações do Ops, na pasta aberta (sem pasta não há o que auditar nem o que correr). */
export const tauriAudit = (root: () => string | null, inv: Invoker = invoke): AuditPort => ({
  record: async (e) => {
    const r = root();
    if (!r) throw new Error("no folder open");
    await auditClient(inv).record(r, { feature: "ops", ...e, scope: e.scope || undefined, reason: e.reason || undefined, outcome: e.approved ? e.outcome ?? "sent" : undefined });
  },
});
