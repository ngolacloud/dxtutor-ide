/* ═══════════ feature `deploy` — domain: the shapes of `tutor_platform::deploy` (r23 F4c2, D01–D04) ═══════════
   serde camelCase. No secret value is in any of them (the Secrets are names). PURE. */
export type GateStatus = "ok" | "failed" | "not_installed" | "not_connected" | "skipped";
export interface Gate { id: string; status: GateStatus; summary: string; detail: string; hint: string | null }
export interface Identity { git: string; cluster: string | null; vault: string | null }
export interface DeployPlan {
  id: string; env: string; context: string; namespace: string; version: string; subject: string; issue: string | null;
  identity: Identity; manifests: string[]; deployments: string[]; images: string[];
  /** the Secret objects NOT applied: the cluster reads them from Vault */
  secretsFromVault: string[];
  gates: Gate[]; strategy: string; blockers: string[]; waivable: string[]; commands: string[]; approver: string | null; notes: string;
}
export interface DeployRecord {
  id: number; env: string; context: string; namespace: string; version: string; issue: string | null; actor: string; approver: string | null;
  at: number; ok: boolean; failedStep: string | null; waivers: string; gates: string; reason: string | null;
}
/** Where a deploy goes, as the backend takes it. */
export interface TargetArg {
  env: string; context: string; namespace: string; kubeconfig?: string | null;
  stagingContext?: string | null; stagingNamespace?: string | null;
  vaultAddr?: string | null; vaultNamespace?: string | null; kvMount?: string | null;
}
