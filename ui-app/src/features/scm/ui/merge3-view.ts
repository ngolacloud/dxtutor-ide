/* ═════════ feature `scm` — ui: the three-way merge tab (r23 F3, UI-SCM-13) ═════════
   The merge's message and its actions (Complete — check then commit —, Abort); the conflicted files; for the
   selected one, base · ours · theirs side by side and the result to edit, with «take ours/theirs/both», «ask
   Co-Dev» and «Resolve». Markup only; actions `gx-merge-*` through the scm dispatcher. */

import type { Merge3State } from "../application/merge3";
import type { GitKey } from "./git-messages";

export type T = (k: GitKey, p?: Record<string, string | number>) => string;
const esc = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const btn = (action: string, label: string, on = "", cls = "mini", dis = false): string => `<button class="${cls}" data-action="${action}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${esc(label)}</button>`;

export function renderMerge3(t: T, s: Merge3State, canAsk: boolean, blocks: (path: string) => number): string {
  const m = s.merge;
  if (!m || !m.merging) return `<div class="gx gm"><div class="sec-empty">${esc(s.error ?? t("mergeNone"))}</div></div>`;
  const busy = s.busy !== null;
  const files = s.files.map((f) => {
    const open = m.conflicts.includes(f);
    return `<button class="gm-file${f === s.selected ? " on" : ""}${open ? "" : " ok"}" data-action="gx-merge-file" data-on="${esc(f)}"><span>${open ? "⚠" : "✓"}</span><span class="notr">${esc(f)}</span></button>`;
  }).join("");
  const head = `<div class="gx-head"><b class="notr">${esc(m.message || t("mergeCommitTitle"))}</b><span class="gx-sp"></span>`
    + `<span class="gx-meta">${esc(t("mergeLeft", { n: m.conflicts.length }))}</span>${btn("gx-merge-complete", t("mergeComplete"), "", "btn", busy || m.conflicts.length > 0)}${btn("gx-merge-abort", t("mergeAbort"), "", "btn ghost", busy)}</div>`
    + (s.check ? `<div class="gm-check ${s.check.ok ? "ok" : "bad"}">${esc(s.check.cmd ? `${s.check.cmd} · ${s.check.summary}` : t("mergeNoCheck"))}</div>` : "")
    + (s.busy ? `<div class="sec-empty">${esc(t("running", { op: s.busy }))}</div>` : "")
    + (s.error ? `<div class="sec-empty notr" style="color:var(--red)">${esc(s.error)}</div>` : "");
  const sel = s.selected, st = sel ? s.stages[sel] : undefined;
  const col = (title: string, text: string | null | undefined) => `<div class="gm-col"><div class="gx-ct">${esc(title)}</div><pre class="gm-pre notr">${text == null ? `<i>${esc(t("mergeAbsent"))}</i>` : esc(text)}</pre></div>`;
  const body = !sel ? "" : !st ? `<div class="sec-empty">${esc(t("loading"))}</div>`
    : `<div class="gm-three">${col(t("mergeBase"), st.base)}${col(t("mergeOurs"), st.ours)}${col(t("mergeTheirs"), st.theirs)}</div>`
      + `<div class="gx-ct">${esc(t("mergeResult", { n: blocks(sel) }))}</div><textarea class="gm-result notr" data-action="gx-merge-draft" data-on="${esc(sel)}" spellcheck="false">${esc(s.draft[sel] ?? "")}</textarea>`
      + `<div class="gx-bar">${btn("gx-merge-take", t("mergeTakeOurs"), `${sel}|ours`)}${btn("gx-merge-take", t("mergeTakeTheirs"), `${sel}|theirs`)}${btn("gx-merge-take", t("mergeTakeBoth"), `${sel}|both`)}`
      + `${canAsk ? btn("gx-merge-ask", t("mergeAskBtn"), sel, "mini gx-ai") : ""}<span class="gx-sp"></span>${btn("gx-merge-resolve", t("mergeResolve"), sel, "btn", busy || !m.conflicts.includes(sel))}</div>`;
  return `<div class="gx gm">${head}<div class="gm-cols"><div class="gm-files">${files}</div><div class="gm-main">${body}</div></div></div>`;
}
