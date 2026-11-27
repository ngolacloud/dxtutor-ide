/* ═════════ feature `scm` — ui: the Launchpad tab (r23 F3, UI-SCM-14) ═════════
   The pull requests asking for my review and mine, by severity: number, title, author, branches, checks, review
   state, the linked issue; «Checkout into a worktree» and the link to GitHub. Without `gh`: «not installed»
   with the hint, or «not signed in». Markup only. */

import { prIssue, prSeverity, type Pr } from "../domain/launchpad";
import type { LaunchpadState } from "../application/launchpad";
import type { GitKey } from "./git-messages";

export type T = (k: GitKey, p?: Record<string, string | number>) => string;
const esc = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function row(t: T, p: Pr): string {
  const sev = prSeverity(p), issue = prIssue(p), c = p.checks;
  const checks = c.passed + c.failed + c.pending ? `<span class="lp-checks"><span class="gx-add">✓${c.passed}</span> <span class="gx-del">✖${c.failed}</span> <span class="gx-meta">…${c.pending}</span></span>` : `<span class="gx-meta">${esc(t("lpNoChecks"))}</span>`;
  const review = p.review ? `<span class="tag">${esc(t(`lpReview-${p.review}` as GitKey))}</span>` : "";
  return `<div class="lp-row sev-${sev}"><span class="lp-sev" title="${esc(t(`lpSev-${sev}` as GitKey))}"></span><div class="lp-main"><div><b>#${p.number}</b> <span class="notr">${esc(p.title)}</span>${p.draft ? ` <span class="tag">${esc(t("lpDraft"))}</span>` : ""}</div>`
    + `<div class="gx-meta notr">${esc(p.author)} · ${esc(p.head)} → ${esc(p.base)}${issue ? ` · <span class="lp-issue">${esc(issue)}</span>` : ""}</div></div>${checks}${review}`
    + `<button class="mini" data-action="gx-lp-worktree" data-on="${p.number}">${esc(t("lpWorktree"))}</button><button class="mini lp-link" data-action="gx-lp-open" data-on="${esc(p.url)}" title="${esc(p.url)}">GitHub ↗</button></div>`;
}

export function renderLaunchpad(t: T, s: LaunchpadState): string {
  const head = `<div class="gx-head"><b>${esc(t("lpTitle"))}</b><span class="gx-sp"></span>${s.status?.installed ? `<span class="gx-meta">${esc(s.status.version)}</span>` : ""}<button class="mini" data-action="gx-lp-refresh"${s.loading ? " disabled" : ""}>${esc(t("refresh"))}</button></div>`;
  if (s.loading && !s.status) return `<div class="gx lp">${head}<div class="sec-empty">${esc(t("loading"))}</div></div>`;
  if (s.error) return `<div class="gx lp">${head}<div class="sec-empty notr" style="color:var(--red)">${esc(s.error)}</div></div>`;
  if (s.status && !s.status.installed) return `<div class="gx lp">${head}<div class="sec-empty">${esc(t("lpNotInstalled"))}</div><div class="gx-meta">${esc(s.status.notes)}</div></div>`;
  if (s.status && !s.status.signedIn) return `<div class="gx lp">${head}<div class="sec-empty">${esc(t("lpSignedOut"))}</div></div>`;
  const sec = (title: string, list: Pr[] | null) => `<div class="gx-ct">${esc(title)} · ${list ? list.length : 0}</div>${list && list.length ? list.map((p) => row(t, p)).join("") : `<div class="sec-empty">${esc(t("lpNone"))}</div>`}`;
  return `<div class="gx lp">${head}${sec(t("lpReviewMe"), s.review)}${sec(t("lpMine"), s.mine)}</div>`;
}
