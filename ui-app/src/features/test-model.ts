/* ═════════ dxtutor IDE — Testing: the model of real runs (A6, docs/v2/UI-AUDIT.md item 3) ═════════
   Pure helpers for the Testing pane in the desktop app: how each runner addresses ONE test
   (so «run this test» re-runs exactly it), the results grouped by suite, and what the
   history cards show (pass-rate trend, flaky and slowest tests) — all from what the
   backend really ran (`test_run`, `test_history`). No DOM, no window, no Tauri. */

import type { CaseResult, RunRow, CaseStat, RunnerKind, TestRunReport } from "../platform/tauri/tests";
import type { AskContext } from "./codev/domain/ask";

const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The name a runner needs to run exactly this test (`Scope::Case`), or null when it can't. */
export function caseFilter(kind: RunnerKind, c: CaseResult): string | null {
  if (!c.name) return null;
  switch (kind) {
    case "cargo":
      // doc tests ("src/lib.rs - add (line 3)") can't be selected by name
      return / - .*\(line \d+\)$/.test(c.name) ? null : c.name;
    case "go":
      return c.name;
    case "pytest": {
      // node id: <file>::[Class::]name; JUnit gives classname = dotted module[.Class]
      const segs = c.suite ? c.suite.split(".") : [];
      const ci = segs.findIndex((s) => /^[A-Z]/.test(s));
      const mod = ci >= 0 ? segs.slice(0, ci) : segs;
      const cls = ci >= 0 ? segs.slice(ci) : [];
      const file = c.file || (mod.length ? mod.join("/") + ".py" : "");
      if (!file) return null;
      return [file.replace(/\\/g, "/"), ...cls, c.name].join("::");
    }
    case "unittest":
      return c.suite ? `${c.suite.replace(/^__main__\./, "")}.${c.name}` : null;
    case "maven":
      return c.suite ? `${c.suite.split(".").pop()}#${c.name}` : null;
    case "gradle":
      return c.suite ? `${c.suite}.${c.name}` : null;
    case "vitest":
    case "jest":
      return `^${reEscape(c.name)}$`;
    default:
      return null;
  }
}

/** The results by suite, failures first (then the suite name). */
export function groupBySuite(results: CaseResult[]): Array<{ suite: string; cases: CaseResult[]; failed: number }> {
  const m = new Map<string, CaseResult[]>();
  for (const r of results) {
    const k = r.suite || "—";
    const a = m.get(k);
    if (a) a.push(r);
    else m.set(k, [r]);
  }
  return [...m.entries()]
    .map(([suite, cases]) => ({ suite, cases, failed: cases.filter((c) => c.status === "failed").length }))
    .sort((a, b) => (b.failed > 0 ? 1 : 0) - (a.failed > 0 ? 1 : 0) || a.suite.localeCompare(b.suite));
}

export const counts = (rs: CaseResult[]): { passed: number; failed: number; skipped: number } => ({
  passed: rs.filter((r) => r.status === "passed").length,
  failed: rs.filter((r) => r.status === "failed").length,
  skipped: rs.filter((r) => r.status === "skipped").length,
});

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Pass rate (0–100) of each run that ran tests, oldest first (the history card's trend). */
export function passRateTrend(runs: RunRow[], n = 12): number[] {
  return runs
    .filter((r) => r.passed + r.failed > 0)
    .slice(0, n)
    .reverse()
    .map((r) => Math.round((r.passed / (r.passed + r.failed)) * 100));
}

export const flakyCases = (cases: CaseStat[]): CaseStat[] => cases.filter((c) => c.flaky).sort((a, b) => b.flips - a.flips);

export const slowestCases = (cases: CaseStat[], n = 5): CaseStat[] =>
  cases.filter((c) => typeof c.avgMs === "number" && (c.avgMs as number) > 0).sort((a, b) => (b.avgMs as number) - (a.avgMs as number)).slice(0, n);

/** A short tail of text (outputs can be long; Co-Dev and the pane need the end). */
export const tail = (s: string, n: number): string => (s.length > n ? "…" + s.slice(-n) : s);

/** The failing test as context for Co-Dev: where it is, the command, the message and its output. */
export function failureContext(rep: Pick<TestRunReport, "command" | "kind">, c: CaseResult): AskContext {
  const text = [
    `runner: ${rep.kind} · comando: ${rep.command}`,
    `teste: ${c.suite ? c.suite + " › " : ""}${c.name}`,
    c.file ? `ficheiro: ${c.file}` : "",
    c.message ? `mensagem: ${c.message}` : "",
    c.output ? `saída:\n${tail(c.output, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { kind: "test", label: c.name, text, ...(c.file ? { path: c.file } : {}) };
}

/** A flaky test as context: its recent results (p/f/s, newest first) and the last failure. */
export function flakyContext(s: CaseStat): AskContext {
  const text = [
    `teste: ${s.suite ? s.suite + " › " : ""}${s.name}`,
    `resultados recentes (mais recente primeiro; p=passou, f=falhou, s=ignorado): ${s.recent}`,
    `mudanças de resultado: ${s.flips}`,
    s.avgMs !== null && s.avgMs !== undefined ? `duração média: ${fmtMs(s.avgMs)}` : "",
    s.lastMessage ? `última falha: ${s.lastMessage}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { kind: "test", label: s.name, text };
}

/** Status glyphs and colours shared by the pane. */
export const STATUS: Record<string, [string, string]> = {
  passed: ["var(--green)", "✓"],
  failed: ["var(--red)", "✖"],
  skipped: ["var(--fg-muted)", "⊘"],
  running: ["var(--yellow)", "◐"],
};
