/* ═══════════ feature `ops` — domain: the shapes of `tutor_eval::ops` (A9, docs/v2/UI-AUDIT.md item 10) ═══════════
   serde camelCase. PURE: no DOM, no window. */

export interface AttrChange { name: string; before: string | null; after: string | null; unknown: boolean; sensitive: boolean }
export interface ResourceChange {
  address: string; action: "create" | "update" | "delete" | "replace" | "read" | "no-op"; attrs: AttrChange[];
  /* r23 F4b (P02) — optional so a plan of the A9 shape still reads */
  module?: string | null; reason?: string | null; replacePaths?: string[];
  /** the blast radius: what in the configuration depends on this resource */
  dependents?: string[];
  /** write-only arguments the configuration sets (never kept in the plan or the state) */
  writeOnly?: string[];
  /** infracost's monthly cost (none without infracost) */
  monthlyCost?: number | null;
}
export interface IacPlan {
  ok: boolean; tool: string; dir: string; refreshOnly: boolean;
  add: number; change: number; destroy: number;
  changes: ResourceChange[]; drift: ResourceChange[];
  notes: string;
}

/* ── r23 F4b: the IaC pipeline, risks and the state (tutor_eval::iac) ── */
export type StageStatus = "running" | "ok" | "failed" | "not_installed" | "not_connected" | "skipped";
export interface IacFinding {
  source: string; rule: string; file: string; line: number; severity: "error" | "warning"; message: string;
  resource: string | null; key: string; accepted: boolean;
}
export interface Stage { id: string; status: StageStatus; summary: string; detail: string; hint: string | null; command: string; findings: IacFinding[]; ms: number }
export interface PipelineRun { id: string; tool: string; dir: string; target: string | null; stages: Stage[]; plan: IacPlan | null; blocked: boolean; blockers: string[]; notes: string }
export interface ApplyInfo { command: string; planFile: string; tool: string; dir: string; destroy: number }
export interface StateResource { address: string; kind: string; mode: string; module: string | null; id: string | null; sensitive: string[] }
export interface LockInfo { id: string; who: string; operation: string; created: string }
export interface IacState {
  ok: boolean; tool: string; dir: string; backend: string; serial: number | null; lineage: string | null;
  resources: StateResource[]; lock: LockInfo | null; lockReadable: boolean; backupSerial: number | null; notes: string;
}
export interface AcceptedRisk { id: number; key: string; kind: "finding" | "drift"; label: string; reason: string; actor: string; at: number; expires: number }

export interface Pod { name: string; phase: string; ready: string; restarts: number; node: string; created: string; reason: string | null }
export interface Service { name: string; kind: string; clusterIp: string; ports: string[] }
export interface Deployment { name: string; ready: string; images: string[]; revision: string | null }
export interface KubeEvent { kind: string; reason: string; object: string; message: string; count: number; last: string }
export interface KubeState { ok: boolean; context: string; namespace: string; pods: Pod[]; services: Service[]; deployments: Deployment[]; events: KubeEvent[]; notes: string }
export interface Revision { revision: number; replicaSet: string; images: string[]; created: string; replicas: number }

export interface CloudCli { provider: "aws" | "gcloud" | "az"; installed: boolean; version: string; account: string | null; notes: string }
export interface CloudResource { provider: string; kind: string; name: string; region: string; status: string }
export interface CloudInventory { ok: boolean; provider: string; resources: CloudResource[]; commands: string[]; notes: string }

/** Where kubectl points: the Infra pane's kubeconfig, context and namespace. */
export interface KubeTarget { kubeconfig: string; context: string; namespace: string }
