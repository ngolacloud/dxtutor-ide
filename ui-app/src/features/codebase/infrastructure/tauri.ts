/* ═════════ feature `codebase` — adaptador Tauri (A10): `deps_report`, `onboard_map` (commands/codebase.rs). Sem `window`. */
import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { CodebasePort } from "../application/ports";
import type { DepsReport, OnboardMap } from "../domain/types";

export const tauriCodebase = (inv: Invoker = invoke): CodebasePort => ({
  deps: (root, online) => inv<DepsReport>("deps_report", { root, online }),
  map: (root) => inv<OnboardMap>("onboard_map", { root }),
});
