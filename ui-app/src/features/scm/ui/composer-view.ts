/* ═════════ feature `scm` — ui: the Commit Composer tab (r23 F3, UI-SCM-14) ═════════
   One card per draft: its message (Conventional Commits), its files with +/−, a checkbox to leave one out, a
   select to move it to another draft (or a new one), and — with lanes on — the branch it goes to. Markup only. */

import type { ComposerState } from "../application/composer";
import type { Draft } from "../domain/composer";
import type { GitKey } from "./git-messages";

export type T = (k: GitKey, p?: Record<string, string | number>) => string;
const esc = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function renderComposer(t: T, s: ComposerState, o: { canAsk: boolean; lanes: boolean; branches: string[]; current: string; problem: (d: Draft) => string | null }): string {
  const head = `<div class="gx-head"><b>${esc(t("composerTitle"))}</b><span class="gx-sp"></span>`
    + (o.canAsk ? `<button class="mini gx-ai" data-action="gx-cp-ask"${s.files.length ? "" : " disabled"}>${esc(t("composerAskBtn"))}</button>` : "")
    + `<button class="mini" data-action="gx-cp-reload"${s.loading || s.busy ? " disabled" : ""}>${esc(t("refresh"))}</button>`
    + `<button class="btn" data-action="gx-cp-commit"${s.busy || !s.drafts.length ? " disabled" : ""}>${esc(t("composerCommit"))}</button></div>`
    + `<div class="gx-meta">${esc(t("composerLede"))}${o.lanes ? " " + esc(t("composerLanesOn")) : ""}</div>`
    + (s.error ? `<div class="sec-empty notr" style="color:var(--red)">${esc(s.error)}</div>` : "")
    + (s.busy ? `<div class="sec-empty">${esc(t("running", { op: "commit" }))}</div>` : "");
  if (s.loading) return `<div class="gx cp">${head}<div class="sec-empty">${esc(t("loading"))}</div></div>`;
  if (!s.drafts.length) return `<div class="gx cp">${head}<div class="sec-empty">${esc(t("composerClean"))}</div></div>`;
  const stat = new Map(s.files.map((f) => [f.path, f]));
  const cards = s.drafts.map((d) => {
    const prob = o.problem(d);
    const moveTo = (p: string) => `<select data-action="gx-cp-move" data-on="${esc(p)}" title="${esc(t("composerMove"))}"><option value="">↦</option>${s.drafts.filter((x) => x.id !== d.id).map((x) => `<option value="${x.id}">${esc(x.message.trim() || x.id)}</option>`).join("")}<option value="new">${esc(t("composerNewDraft"))}</option></select>`;
    const files = d.files.map((p) => { const f = stat.get(p); const out = s.excluded.includes(p); return `<div class="cp-file${out ? " out" : ""}"><input type="checkbox" data-action="gx-cp-toggle" data-on="${esc(p)}"${out ? "" : " checked"} title="${esc(t("composerInclude"))}"><span class="gx-st s-${esc((f?.status ?? "M").slice(0, 1))}">${esc((f?.status ?? "M").slice(0, 1))}</span><span class="notr cp-path">${esc(p)}</span><span class="gx-add">+${f?.added ?? 0}</span> <span class="gx-del">−${f?.removed ?? 0}</span>${moveTo(p)}</div>`; }).join("");
    const lane = o.lanes ? `<label class="cp-lane">${esc(t("composerLane"))} <select data-action="gx-cp-lane" data-on="${d.id}"><option value="">${esc(o.current)} (HEAD)</option>${o.branches.filter((b) => b !== o.current).map((b) => `<option value="${esc(b)}"${d.lane === b ? " selected" : ""}>${esc(b)}</option>`).join("")}</select></label>` : "";
    return `<div class="cp-card${prob ? " bad" : ""}"><input class="inp notr cp-msg" data-action="gx-cp-msg" data-on="${d.id}" value="${esc(d.message)}" placeholder="feat(scope): what changed" spellcheck="false">${lane}${prob ? `<div class="cp-prob">${esc(t(`composerProblem-${prob}` as GitKey))}</div>` : ""}${files}</div>`;
  }).join("");
  return `<div class="gx cp">${head}${cards}</div>`;
}
