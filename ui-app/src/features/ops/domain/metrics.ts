/* ═══════════ feature `ops` — domain: the metrics source (tutor_platform::metrics; NOTAS-r23 point 3) ═══════════
   The shapes `metrics_status` returns (serde camelCase) and how a budget and the capacity read as a line — the
   same words as the backend's (`budget_line`/`capacity_line`). No token is in any of them. PURE. */

export interface Budget {
  service: string; objective: number; period: string;
  errorRatio: number | null; remaining: number | null; burn1h: number | null; exhausted: boolean;
  queries: string[]; notes: string;
}
export interface Usage { requested: number; allocatable: number; percent: number }
export interface Capacity { cpu: Usage; memory: Usage; maxPercent: number; over: boolean; queries: string[] }
export interface MetricsOverview {
  configured: boolean; url: string | null; auth: "none" | "keychain" | "vault" | null; connected: boolean; version: string | null;
  notes: string; hint: string | null; budgets: Budget[]; budgetErrors: string[]; capacity: Capacity | null; capacityNotes: string;
}

const pct = (x: number): string => { const p = x * 100; return p !== 0 && Math.abs(p) < 1 ? `${p.toFixed(2)}%` : `${p.toFixed(0)}%`; };

/** `web: 72% of the 30d budget left (burn 0.4× in the last hour)` — or why there is no number. */
export function budgetLine(b: Budget): string {
  if (b.remaining === null) return `${b.service}: ${b.notes}`;
  const burn = b.burn1h === null ? "" : ` (burn ${b.burn1h.toFixed(1)}× in the last hour)`;
  return `${b.service}: ${pct(Math.abs(b.remaining))} of the ${b.period} budget ${b.remaining > 0 ? "left" : "overspent"}${burn}`;
}

export const capacityLine = (c: Capacity): string =>
  `CPU ${c.cpu.percent.toFixed(0)}% · memory ${c.memory.percent.toFixed(0)}% of the allocatable requested (limit ${c.maxPercent.toFixed(0)}%)`;
