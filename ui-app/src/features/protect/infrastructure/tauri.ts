/* ═════════ feature `protect` — adaptador Tauri (r23 F4a) ═════════
   `protect_learn`, `secret_scan`, `secret_scan_allow`, `protect_hook_plan`, `protect_hook_install` (src-tauri/src/commands/protect.rs) e o evento
   `protect://redacted` `{origin, count, total}`. Não toca em `window` (o cliente tipado é que o faz). */
import { invoke, isDesktop, listen, type Invoker } from "../../../platform/tauri/core";
import type { ProtectPort } from "../application/ports";
import type { HookPlan, ScanReport } from "../domain/report";

export const tauriProtect = (inv: Invoker = invoke): ProtectPort => ({
  learn: (root) => inv<number>("protect_learn", { root }),
  scan: (root, scope, paths) => inv<ScanReport>("secret_scan", { root, scope: scope ?? null, paths: paths ?? null }),
  allow: (root, reason) => inv<void>("secret_scan_allow", { root, reason }),
  hookPlan: (root) => inv<HookPlan>("protect_hook_plan", { root }),
  hookInstall: (root) => inv<HookPlan>("protect_hook_install", { root }),
});

export function onRedacted(f: (origin: string, count: number, total: number) => void, desktop: () => boolean = isDesktop): void {
  if (!desktop()) return;
  void listen("protect://redacted", (p) => {
    const o = p as { origin?: string; count?: number; total?: number };
    if (o && typeof o.count === "number") f(o.origin ?? "?", o.count, o.total ?? o.count);
  });
}
