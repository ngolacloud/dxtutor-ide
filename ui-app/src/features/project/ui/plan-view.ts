/* ═════════ feature `project` — the parallel plan of a sprint (Multi Co-Dev, phase 1) ═════════
   Read-only: one column per Co-Dev, one row per wave (an issue starts when the previous waves
   are done), the issues left out with the reason, and the overlaps (which files, which scope
   entries). The cards open the issue (`pj-open`); nothing here runs anything. */

import { esc } from "../../../core";
import { translator } from "../../../app/i18n";
import type { ProjectState } from "../application/project-service";
import { METHOD_INFO } from "../domain/board";
import { MAX_CODEVS, laneCells, type LeftOut, type Overlap, type PlannedIssue, type SprintPlan } from "../domain/plan";
import type { Project, Sprint, State } from "../domain/types";
import { PROJECT_PLAN_MESSAGES } from "./plan-messages";

const t = translator(PROJECT_PLAN_MESSAGES);

/** The sprint's «Co-Devs: N» field and the «Parallel plan» button. */
export function planControls(s: Sprint): string {
  return `<span class="pj-plan-ctl"><label class="pj-dim" title="${esc(t("codevsTitle", { max: MAX_CODEVS }))}">${esc(t("codevs"))} <input class="pj-input pj-codevs" type="number" min="1" max="${MAX_CODEVS}" step="1" data-action="pj-sprint-codevs" data-on="${esc(s.id)}" value="${s.codevs ?? ""}" placeholder="1"></label>
    <button class="pj-btn" data-action="pj-sprint-plan" data-on="${esc(s.id)}" title="${esc(t("planBtnTitle"))}"><span>${esc(t("planBtn"))}</span></button></span>`;
}

const keyList = (keys: string[]): string => keys.map((k) => `<code>${esc(k)}</code>`).join(", ");

function card(i: PlannedIssue): string {
  const tags = [
    i.after.length ? `<span class="pj-plan-tag" title="${esc(t("afterTitle"))}">${t("after", { keys: keyList(i.after) })}</span>` : "",
    i.serialisedAfter.length
      ? `<span class="pj-plan-tag warn" title="${esc(t("serialisedTitle", { keys: i.serialisedAfter.join(", ") }))}">${t("serialised", { keys: keyList(i.serialisedAfter) })}</span>`
      : "",
    i.branchConflicts.length ? `<span class="pj-plan-tag bad">${t("branchConflicts", { files: keyList(i.branchConflicts) })}</span>` : "",
  ].join("");
  return `<div class="pj-plan-card" data-action="pj-open" data-on="${esc(i.key)}"><div><span class="pj-key">${esc(i.key)}</span>${i.points !== null ? ` <span class="pj-pts">${i.points}</span>` : ""}</div><div class="pj-title">${esc(i.title)}</div>${tags}</div>`;
}

function reason(l: LeftOut, p: Project): string {
  switch (l.reason) {
    case "not_ready":
      return esc(t("reasonNotReady", { missing: l.missing.join("; ") }));
    case "in_flow": {
      const s = l.keys[0] as State | undefined;
      return esc(t("reasonInFlow", { state: s ? (METHOD_INFO[p.method].labels[s] ?? s) : "" }));
    }
    case "blocked_by_deps":
      return t("reasonBlocked", { keys: keyList(l.keys) });
    case "dep_cycle":
      return t("reasonCycle", { keys: keyList(l.keys) });
    case "overlaps_in_flow":
      return t("reasonOverlapsFlow", { keys: keyList(l.keys) });
  }
}

function overlapRow(o: Overlap): string {
  const globs = o.globs.map(([a, b]) => `<code>${esc(a === "known" ? t("knownFile") : a)}</code> ∩ <code>${esc(b === "known" ? t("knownFile") : b)}</code>`).join(" · ");
  const more = o.total > o.paths.length ? ` <span class="pj-dim">${esc(t("overlapMore", { n: o.total - o.paths.length }))}</span>` : "";
  return `<div class="pj-plan-ov"><div><code>${esc(o.a)}</code> ↔ <code>${esc(o.b)}</code> <span class="pj-dim">${globs}</span></div><div class="pj-plan-paths">${o.paths.map((x) => `<code>${esc(x)}</code>`).join(" ")}${more}</div></div>`;
}

/** The lanes × waves grid, the left-out issues and the overlaps. */
export function planBody(plan: SprintPlan, p: Project): string {
  const cols = `grid-template-columns: repeat(${Math.max(1, plan.lanes.length)}, minmax(150px, 1fr))`;
  const heads = plan.lanes
    .map(
      (l) =>
        `<div class="pj-plan-lane"><b>${esc(t("lane", { n: l.codev }))}</b> <span class="pj-dim">${esc(t("lanePoints", { points: l.points }))}${l.unestimated ? " " + esc(t("laneUnestimated", { n: l.unestimated })) : ""}</span></div>`,
    )
    .join("");
  const cells = plan.lanes.map((l) => laneCells(l, plan.waves));
  let rows = "";
  for (let w = 1; w <= plan.waves; w++) {
    rows += `<div class="pj-plan-wave" title="${esc(t("waveTitle"))}">${esc(t("wave", { n: w }))}</div>`;
    rows += cells.map((c) => (c[w - 1] ? card(c[w - 1]!) : `<div class="pj-plan-idle pj-dim">${esc(t("idle"))}</div>`)).join("");
  }
  const grid = plan.waves ? `<div class="pj-plan-grid" style="${cols}">${heads}${rows}</div>` : `<div class="pj-dim pj-pad">${esc(t("nothingPlanned"))}</div>`;
  const left = plan.leftOut.length
    ? `<div class="pj-sec"><span>${esc(t("leftOut"))}</span> <span class="pj-count">${plan.leftOut.length}</span></div>${plan.leftOut
        .map((l) => `<div class="pj-row" data-action="pj-open" data-on="${esc(l.key)}"><span class="pj-key">${esc(l.key)}</span><span class="pj-row-t">${esc(l.title)}</span><span class="pj-plan-why">${reason(l, p)}</span></div>`)
        .join("")}`
    : "";
  const ovs = `<div class="pj-sec"><span>${esc(t("overlaps"))}</span> <span class="pj-dim">— ${esc(t("overlapsHint"))}</span></div>${
    plan.overlaps.map(overlapRow).join("") || `<div class="pj-dim pj-pad">${esc(t("noOverlaps"))}</div>`
  }`;
  return grid + left + ovs;
}

/** The plan block under the sprint it belongs to (or nothing). */
export function planBlock(st: ProjectState, p: Project, sprint: string): string {
  const sp = st.sprintPlan;
  if (!sp || sp.sprint !== sprint) return "";
  const d = sp.data;
  const summary = d ? `<span class="pj-dim">${esc(t("planSummary", { codevs: d.codevs, waves: d.waves, files: d.files }))}</span>` : "";
  const body = sp.error ? `<div class="pj-li bad">${esc(sp.error)}</div>` : d ? planBody(d, p) : `<div class="pj-dim pj-pad">${esc(t("computing"))}</div>`;
  return `<div class="pj-plan${sp.loading ? " loading" : ""}"><div class="pj-plan-head"><b>${esc(t("planTitle"))}</b> ${summary}<span class="sp"></span>
    <button class="pj-btn" data-action="pj-sprint-plan" data-on="${esc(sprint)}"><span>${esc(t("recompute"))}</span></button><button class="pj-icon" title="${esc(t("close"))}" data-action="pj-plan-close">✕</button></div>${body}</div>`;
}
