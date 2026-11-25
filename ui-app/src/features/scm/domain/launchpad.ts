/* ═══════════ feature `scm` — domain: the Launchpad (r23 F3, UI-SCM-14) ═══════════
   Open pull requests from `gh`, ordered by what needs the person first: failing checks or changes requested,
   then waiting on a review, then the rest. The issue a PR belongs to comes from its title or branch. And the
   exact commands of «checkout into a worktree» (the backend's `add_pr` runs the same two). PURE. */

import { issueKeyIn } from "./trailers";

export interface PrChecks { passed: number; failed: number; pending: number }
export interface Pr { number: number; title: string; author: string; head: string; base: string; url: string; draft: boolean; state: string; review: string; checks: PrChecks; updatedAt: string }
export type Severity = "high" | "medium" | "low";

export function prSeverity(p: Pr): Severity {
  if (p.checks.failed > 0 || p.review === "CHANGES_REQUESTED") return "high";
  if (!p.draft && (p.review === "REVIEW_REQUIRED" || p.checks.pending > 0)) return "medium";
  return "low";
}

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
export const sortPrs = (prs: Pr[]): Pr[] => [...prs].sort((a, b) => RANK[prSeverity(a)] - RANK[prSeverity(b)] || b.updatedAt.localeCompare(a.updatedAt));

export const prIssue = (p: Pr): string | null => issueKeyIn(p.title) ?? issueKeyIn(p.head.toUpperCase().replace(/[^A-Z0-9-]/g, " "));

/** The worktree folder next to the project (`../proj-pr-42`). */
export const prWorktreePath = (project: string, n: number): string => `../${project}-pr-${n}`;

/** What `git_worktree {op: add_pr}` runs (tutor_eval::gitx::pr_worktree_commands). */
export const prWorktreeCommands = (n: number, path: string, remote: string): string =>
  `git fetch ${remote} pull/${n}/head:pr/${n}\ngit worktree add ${path} pr/${n}`;
