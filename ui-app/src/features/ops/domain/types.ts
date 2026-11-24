/* ═══════════ feature `ops` — domain: the shapes of `tutor_eval::ops` (A9, docs/v2/UI-AUDIT.md item 10) ═══════════
   serde camelCase. PURE: no DOM, no window. */

export interface AttrChange { name: string; before: string | null; after: string | null; unknown: boolean; sensitive: boolean }
export interface ResourceChange { address: string; action: "create" | "update" | "delete" | "replace" | "read" | "no-op"; attrs: AttrChange[] }
export interface IacPlan {
  ok: boolean; tool: string; dir: string; refreshOnly: boolean;
  add: number; change: number; destroy: number;
  changes: ResourceChange[]; drift: ResourceChange[];
  applyCommand: string; notes: string;
}

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
