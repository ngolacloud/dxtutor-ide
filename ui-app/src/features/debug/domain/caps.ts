/* ═══════════ feature `debug` — domain: what the debugger can do here (r23 F2, UI-DBG-07) ═══════════
   Two sources, both real: the HOST (`debug_capabilities`: an adapter on PATH, and whether rr can
   record — Linux, rr, gdb, `perf_event_paranoid` ≤ 1) and the SESSION (`LaunchInfo.caps`: what the
   adapter answered to `initialize`). The floating toolbar shows a control only when it works,
   and says why the others are missing. PURE: no DOM, no window, no Tauri. */

import type { SessionCaps } from "./dap";

/** `debug_capabilities`. */
export interface HostCaps {
  available: boolean;
  adapter: string | null;
  engine: string | null;
  note: string;
  timeTravel: { available: boolean; reason: string; perfEventParanoid: number | null; error?: string | null };
}

export type ToolKey = "rcont" | "back" | "cont" | "over" | "into" | "out" | "cursor" | "rframe" | "restart" | "stop";

export interface ToolButton { key: ToolKey; enabled: boolean }

/** A control that is not offered, and the message key that says why. */
export interface Missing { key: ToolKey; why: string; params?: Record<string, string | number> }

export interface Toolbar { buttons: ToolButton[]; missing: Missing[] }

const ORDER: ToolKey[] = ["rcont", "back", "cont", "over", "into", "out", "cursor", "rframe", "restart", "stop"];

/** Why there is no time travel: the host's reason first (no rr, the kernel's counters…), then the
 *  adapter's (a live session does not step back — only a replay does). */
export function timeTravelWhy(host: HostCaps | null): { why: string; params?: Record<string, string | number> } {
  const r = host?.timeTravel.reason ?? "unknown";
  if (r === "perf-paranoid") return { why: "tt-perf-paranoid", params: { n: host?.timeTravel.perfEventParanoid ?? "?" } };
  if (r === "rr-cannot-record") return { why: "tt-rr-cannot-record", params: { e: host?.timeTravel.error ?? "" } };
  if (r === "ok") return { why: "tt-live" };
  return { why: `tt-${r}` };
}

/** The toolbar of a session: the buttons it shows (enabled when the program is stopped, except
 *  Stop and Restart), and the controls left out with the reason. */
export function toolbarFor(
  s: { status: "starting" | "running" | "stopped"; engine?: "dap" | "gdb"; caps?: SessionCaps | null },
  host: HostCaps | null,
): Toolbar {
  const dap = s.engine === "dap";
  const stopped = s.status === "stopped";
  const missing: Missing[] = [];
  const shown = new Set<ToolKey>(["cont", "over", "into", "restart", "stop"]);
  if (s.caps?.stepBack) { shown.add("rcont"); shown.add("back"); }
  else { const w = timeTravelWhy(host); missing.push({ key: "back", ...w }); }
  if (dap) { shown.add("out"); shown.add("cursor"); }
  else { missing.push({ key: "out", why: "needs-dap" }, { key: "cursor", why: "needs-dap" }); }
  if (s.caps?.restartFrame) shown.add("rframe");
  else missing.push({ key: "rframe", why: dap ? "rframe-adapter" : "needs-dap" });
  const buttons = ORDER.filter((k) => shown.has(k)).map((key) => ({
    key,
    enabled: key === "stop" || key === "restart" ? s.status !== "starting" : stopped,
  }));
  return { buttons, missing };
}

/** The keyboard shortcut of each control (the toolbar's titles and the shortcuts module agree). */
export const TOOL_KEYS: Record<ToolKey, string> = {
  rcont: "Shift+F9", back: "Shift+F10", cont: "F5", over: "F10", into: "F11", out: "Shift+F11",
  cursor: "Ctrl+F10", rframe: "", restart: "Ctrl+Shift+F5", stop: "Shift+F5",
};
