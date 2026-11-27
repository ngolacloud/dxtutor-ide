/* ═════════ cliente IPC: a app (informação e auto-teste) — ADR-0004, U2 ═════════
   Contratos de `app_info` e `selftest_report` (src-tauri/src/bridge.rs). */
import { invoke, type Invoker } from "./core";

export interface AppInfo {
  version?: string;
  os?: string;
  home?: string;
  configDir?: string;
  openAtStart?: string;
  selftest?: string;
  /** `DXTUTOR_SELFTEST_ONLY`: só estes passos do auto-teste (vírgulas) */
  selftestOnly?: string;
  pairtest?: string;
}

export const appClient = (inv: Invoker = invoke) => ({
  info: (): Promise<AppInfo> => inv<AppInfo>("app_info"),
  /** Grava o relatório do auto-teste (`--selftest` / `--pairtest`). */
  selftestReport: (report: unknown): Promise<void> => inv<void>("selftest_report", { report }),
});

export type AppClient = ReturnType<typeof appClient>;
