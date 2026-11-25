/* ═══════════ feature `scm` — domain: a commit's lifecycle (r23 F3, UI-SCM-09) ═══════════
   issue → tests → CI → pull request → environments, each from a real source or saying it has none: the issue key
   in the message; the test results stored for that commit; GitHub Actions runs and the pull request that contains
   it (from `gh`); environments are not connected yet (F4). Nothing is synthesised. PURE. */

import { issueKeyIn } from "./trailers";
import type { Pr } from "./launchpad";

export type StageKey = "issue" | "tests" | "ci" | "pr" | "env";
export type StageState = "ok" | "failed" | "pending" | "none" | "not-connected" | "not-installed" | "error";
export interface Stage { key: StageKey; state: StageState; text: string; url?: string; detail?: string }

export interface TestResultRow { sha: string; dirty: boolean; at: number; runner: string; command: string; passed: number; failed: number; ignored: number; ok: boolean }
export interface CiRun { name: string; status: string; conclusion: string; url: string }

/** `undefined` = still reading; `null` = the source is missing (with `why`). */
export interface LifecycleInput {
  message: string;
  tests: TestResultRow[] | undefined;
  runs: CiRun[] | null | undefined;
  prs: Pr[] | null | undefined;
  ghMissing: "not-installed" | "error" | null;
  ghError?: string;
}

export function lifecycleOf(i: LifecycleInput): Stage[] {
  const issue = issueKeyIn(i.message);
  const out: Stage[] = [{ key: "issue", state: issue ? "ok" : "none", text: issue ?? "" }];
  if (i.tests === undefined) out.push({ key: "tests", state: "pending", text: "" });
  else if (!i.tests.length) out.push({ key: "tests", state: "none", text: "" });
  else {
    const t = [...i.tests].sort((a, b) => b.at - a.at)[0];
    out.push({ key: "tests", state: t.ok ? "ok" : "failed", text: `${t.passed}/${t.failed}/${t.ignored}`, detail: `${t.command}${t.dirty ? " (uncommitted changes)" : ""}` });
  }
  const gh = (key: "ci" | "pr", f: () => Stage): Stage =>
    i.ghMissing === "not-installed" ? { key, state: "not-installed", text: "" } : i.ghMissing === "error" ? { key, state: "error", text: "", detail: i.ghError } : f();
  out.push(gh("ci", () => {
    if (i.runs === undefined) return { key: "ci", state: "pending", text: "" };
    if (!i.runs || !i.runs.length) return { key: "ci", state: "none", text: "" };
    const failed = i.runs.filter((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion));
    const running = i.runs.filter((r) => r.status !== "completed");
    const pick = failed[0] ?? running[0] ?? i.runs[0];
    return { key: "ci", state: failed.length ? "failed" : running.length ? "pending" : "ok", text: `${i.runs.length}`, url: pick.url, detail: pick.name };
  }));
  out.push(gh("pr", () => {
    if (i.prs === undefined) return { key: "pr", state: "pending", text: "" };
    if (!i.prs || !i.prs.length) return { key: "pr", state: "none", text: "" };
    const p = i.prs[0];
    return { key: "pr", state: p.state === "MERGED" ? "ok" : p.state === "CLOSED" ? "failed" : "pending", text: `#${p.number}`, url: p.url, detail: `${p.title} · ${p.state.toLowerCase()}` };
  }));
  out.push({ key: "env", state: "not-connected", text: "" });
  return out;
}
