/* ═════════ feature `deploy` — adaptador Tauri (r23 F4c2) ═════════
   `deploy_plan`/`deploy_rollout` (commands/deploy.rs), `deploy_records` (board.rs) e o evento `deploy://output`.
   Não toca em `window`. */
import { invoke, isDesktop, listen, type Invoker } from "../../../platform/tauri/core";
import type { DeployPort } from "../application/ports";
import type { DeployPlan, DeployRecord } from "../domain/types";

type Listen = (event: string, f: (payload: unknown) => void) => unknown;

export const tauriDeploy = (inv: Invoker = invoke, on: Listen = (e, f) => (isDesktop() ? listen(e, f) : null)): DeployPort => ({
  plan: (root, target) => inv<DeployPlan>("deploy_plan", { root, target }),
  rollout: (root, planId, confirm, reason, waivers) => inv<DeployRecord>("deploy_rollout", { root, planId, confirm, reason, waivers }),
  records: (root, shas) => inv<DeployRecord[]>("deploy_records", { root, shas }),
  onOutput: (f) => {
    void on("deploy://output", (p) => {
      const e = p as { planId?: string; line?: string };
      if (e && typeof e.planId === "string" && typeof e.line === "string") f(e.planId, e.line);
    });
  },
});
