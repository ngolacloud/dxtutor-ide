/* ═════════ feature `ops` — adaptador Tauri (A9) ═════════
   `ops_iac_dirs`, `ops_iac_plan`, `ops_kube_state`, `ops_kube_history`, `ops_cloud_status`,
   `ops_cloud_inventory` (commands/ops.rs), o pipeline de IaC da r23 F4b (`iac_pipeline_run` + evento
   `iac://stage`, `iac_apply_command`, `iac_state` em commands/iac.rs; `iac_risks`/`iac_risk_accept`/
   `iac_risk_revoke` em board.rs), e o `audit_record` (board.rs, r23 F1) pelo cliente partilhado.
   Não toca em `window`. */

import { invoke, isDesktop, listen, type Invoker } from "../../../platform/tauri/core";
import { auditClient } from "../../../platform/tauri/audit";
import type { AuditPort, OpsPort } from "../application/ports";
import type { DataSource, EvidenceFile, Runbook, StepRun } from "../domain/types";
import type { MetricsOverview } from "../domain/metrics";
import type { PlatformPort } from "../application/platform-service";
import type { Incident, IncidentView, PrReview, Queue } from "../domain/platform-types";
import type { AcceptedRisk, ApplyInfo, CloudCli, CloudInventory, IacPlan, IacState, KubeState, PipelineRun, Revision, Stage } from "../domain/types";

type Listen = (event: string, f: (payload: unknown) => void) => unknown;

/* r23 F5b: a actividade Platform — `queue_*`, `pr_infra_review`/`pr_review_submit`, `incident_*` (commands/platform.rs) */
export const tauriPlatform = (inv: Invoker = invoke): PlatformPort => ({
  queue: (root) => inv<Queue>("queue_items", { root }),
  verify: (root, id, title) => inv<{ done: boolean; proof: string | null }>("queue_verify", { root, id, title }),
  handover: (root, id, title, recipient, reason) => inv<number>("queue_handover", { root, id, title, recipient, reason }),
  review: (root, pr) => inv<PrReview>("pr_infra_review", { root, pr }),
  submit: (root, pr, decision, body, reason) => inv<string>("pr_review_submit", { root, pr, decision, body, reason }),
  incidents: (root) => inv<Incident[]>("incident_list", { root }),
  incident: (root, id) => inv<IncidentView>("incident_get", { root, id }),
  open: (root, title, severity) => inv<Incident>("incident_open", { root, title, severity }),
  add: (root, id, kind, text, reason) => inv<void>("incident_add", { root, id, kind, text, reason }),
  status: (root, id, status, note) => inv<Incident>("incident_status", { root, id, status, note }),
  feedback: (root, id, right) => inv<void>("incident_feedback", { root, id, right }),
  metricsCheck: (root, id) => inv<string[]>("incident_metrics_check", { root, id }),
});

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
  /* r23 F5a */
  runbooks: (root) => inv<Runbook[]>("runbook_list", { root }),
  runStep: (root, path, n, runId, approval, vault) => inv<StepRun>("runbook_step", { root, path, n, runId, approval, vault }),
  decide: (root, path, n, runId, note) => inv<StepRun>("runbook_decide", { root, path, n, runId, note }),
  judge: (root, id, matched, note) => inv<boolean>("runbook_judge", { root, id, matched, note }),
  runs: (root, path) => inv<StepRun[]>("runbook_runs", { root, path }),
  sources: (root) => inv<DataSource[]>("sources_status", { root }),
  metrics: (root) => inv<MetricsOverview>("metrics_status", { root }),
  metricsTokenSet: (root, url, token) => inv<void>("metrics_token_set", { root, url, token }),
  metricsTokenClear: (root, url) => inv<void>("metrics_token_clear", { root, url }),
  exportEvidence: (root) => inv<EvidenceFile>("audit_export_evidence", { root, from: null, to: null }),
});

/** O registo de auditoria das operações do Ops, na pasta aberta (sem pasta não há o que auditar nem o que correr). */
export const tauriAudit = (root: () => string | null, inv: Invoker = invoke): AuditPort => ({
  record: async (e) => {
    const r = root();
    if (!r) throw new Error("no folder open");
    await auditClient(inv).record(r, { feature: "ops", ...e, scope: e.scope || undefined, reason: e.reason || undefined, outcome: e.approved ? e.outcome ?? "sent" : undefined });
  },
});
