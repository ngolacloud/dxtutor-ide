/* ═══════════ feature `ops` — ui: the Platform activity (r23 F5b) ═══════════
   My queue (why it is yours, one action, Verify, Hand over; Done, Team, Measured), PR infra review (Before you merge with
   each check's source), Incidents (timeline, confidence, status, feedback). Actions: data-action="pf:…" + data-on. */
import { esc } from "../../../core";
import type { PlatformState } from "../application/platform-service";
import type { CheckStatus, IncidentView } from "../domain/platform-types";
import type { PlatformKey } from "./platform-messages";

export type T = (k: PlatformKey, p?: Record<string, string | number>) => string;
const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string =>
  `<button class="${cls}" data-action="pf:${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;
const ST: Record<CheckStatus, PlatformKey> = { ok: "stOk", failed: "stFailed", pending: "stPending", not_installed: "stNotInstalled", not_connected: "stNotConnected", skipped: "stSkipped" };
const when = (ms: number): string => new Date(ms).toLocaleString();

function home(t: T, st: PlatformState): string {
  const q = st.queue;
  if (!q) return `<div class="sec-empty">${t("loading")}</div>`;
  const items = q.items.length ? q.items.map((i) => `<div class="pf-item k-${esc(i.kind)}"><div class="pf-bar"><b class="notr">${esc(i.title)}</b><span class="pf-sp"></span>${btn("act", t(`act_${i.action.replace(/-/g, "_")}` as PlatformKey), i.id, "btn")}${btn("verify", t("verify"), i.id, "btn ghost", st.busy !== null)}${btn("handover", t("handover"), i.id)}</div><div class="pf-dim notr">${esc(t("why", { w: i.why }))}</div></div>`).join("") : `<div class="sec-empty">${t("empty")}</div>`;
  const done = q.done.slice(0, 10).map((e) => `<div class="pf-row"><span class="pf-ok">✓</span><span class="notr">${esc(e.title)}</span><span class="pf-dim notr">${esc(e.proof ?? "")} · ${esc(e.actor)} · ${esc(when(e.at))}</span></div>`).join("");
  const team = q.team.slice(0, 10).map((e) => `<div class="pf-row"><span class="notr">${esc(e.title)}</span><span class="pf-dim notr">${esc(e.actor)} → <b>${esc(e.recipient ?? "")}</b>: ${esc(e.reason ?? "")}</span></div>`).join("");
  const measured = `<div class="pf-ms">${q.measured.map(([k, v]) => `<div><b class="notr">${esc(v)}</b><span>${t(`m_${k}` as PlatformKey)}</span></div>`).join("")}</div>`;
  const missing = q.missing.length ? `<div class="pf-ct">${t("missing")}</div>${q.missing.map((m) => `<div class="pf-dim notr">${esc(m)}</div>`).join("")}` : "";
  return `<div class="pf-bar"><span class="pf-chip notr">${esc(t("you", { n: q.me.gh ? `${q.me.name} (@${q.me.gh})` : q.me.name }))}</span><span class="pf-chip">${esc(t("openItems", { n: q.items.length }))}</span>${btn("reload", t("reload"), "", "btn ghost", st.busy !== null)}</div>${items}`
    + (done ? `<div class="pf-ct">${t("done")}</div>${done}` : "") + (team ? `<div class="pf-ct">${t("team")}</div>${team}` : "") + `<div class="pf-ct">${t("measured")}</div>${measured}${missing}`;
}

function review(t: T, st: PlatformState, canAsk: boolean): string {
  const head = `<div class="pf-bar">${btn("ask-pr", t("reviewPr"))}${st.prNumber ? `<span class="pf-chip notr">#${st.prNumber}</span>` : ""}</div>`;
  const r = st.review;
  if (st.reviewing) return head + `<div class="sec-empty">${t("loading")}</div>`;
  if (!r) return head;
  const checks = r.checks.map((c) => `<div class="pf-check c-${c.status}"><span class="pf-st">${t(ST[c.status])}</span><b class="notr">${esc(c.id)}</b><span class="notr">${esc(c.summary)}</span><span class="pf-sp"></span><span class="pf-dim notr">${esc(c.source)}</span></div>`).join("");
  return head + `<div class="pf-bar"><b class="notr">#${r.number} ${esc(r.title)}</b><span class="pf-dim notr">${esc(r.author)} · ${esc(r.head)} → ${esc(r.base)} · ${esc(r.headSha.slice(0, 10))}</span></div>`
    + `<div class="pf-ct">${t("beforeMerge")}</div>${checks}`
    + (r.failing.length ? `<div class="pf-why">${esc(t("failingCount", { n: r.failing.length }))}</div>` : "")
    + `<div class="pf-bar">${btn("submit", t("approve"), "approve", "btn", st.busy !== null)}${btn("submit", t("requestChanges"), "request-changes", "btn ghost", st.busy !== null)}${btn("submit", t("comment"), "comment", "btn ghost", st.busy !== null)}${canAsk ? btn("ask-codev-pr", t("askCodevPr"), "", "btn ghost pf-ai") : ""}</div>`
    + `<div class="pf-ct">${t("files")}</div><div class="pf-dim notr">${esc(r.files.join(", "))}</div><div class="pf-ct">${t("diff")}</div><pre class="pf-diff notr">${esc(r.diff)}</pre>`;
}

function incident(t: T, v: IncidentView, canAsk: boolean): string {
  const i = v.incident;
  const acts = i.status === "investigating" ? btn("status", t("mitigate"), "mitigated") + btn("status", t("resolve"), "resolved") : i.status === "mitigated" ? btn("status", t("resolve"), "resolved", "btn") + btn("status", t("reopen"), "investigating") : "";
  const judged = v.events.some((e) => e.kind === "feedback");
  const fb = i.status !== "investigating" && !judged ? `<div class="pf-bar"><span>${t("topCause")}</span>${btn("feedback", t("yes"), "1")}${btn("feedback", t("no"), "0")}</div>` : "";
  const add = i.status !== "resolved" ? `<div class="pf-bar">${btn("add", t("addEvidence"), "evidence")}${btn("add", t("addChecked"), "checked")}${btn("add", t("addNotChecked"), "not-checked")}${btn("add", t("addNote"), "note")}</div>` : `<div class="pf-bar">${btn("add", t("addNote"), "note")}</div>`;
  const tl = v.events.map((e) => `<div class="pf-row ev-${esc(e.kind)}"><span class="pf-dim">${esc(when(e.at))}</span><span class="pf-chip">${t(`ev_${e.kind}` as PlatformKey)}</span><span class="notr">${esc(e.text)}</span>${e.reason ? `<span class="pf-dim notr">— ${esc(e.reason)}</span>` : ""}<span class="pf-dim notr">${esc(e.actor)}</span></div>`).join("");
  return `<div class="pf-inc"><div class="pf-bar"><b class="notr">${esc(i.key)} · ${esc(i.title)}</b><span class="pf-chip sev">${esc(i.severity)}</span><span class="pf-chip s-${i.status}">${esc(i.status)}</span><span class="pf-dim notr">${esc(t("commander", { c: i.commander }))} · ${esc(t("opened", { t: when(i.openedAt) }))}</span></div>`
    + `<div class="pf-conf c-${v.confidence.level}">${esc(t("confidence", { l: v.confidence.level }))} — <span class="notr">${esc(v.confidence.reasons.join("; "))}</span></div>`
    + `<div class="pf-bar">${acts}${canAsk ? btn("ask-cause", t("askCauseBtn"), "", "btn ghost pf-ai") + btn("postmortem", t("postmortemBtn"), "", "btn ghost pf-ai") : ""}<span class="pf-sp"></span><span class="pf-dim">${esc(t("precision", { r: v.precision[0], n: v.precision[1] }))}</span></div>`
    + fb + add + tl + `</div>`;
}

function incidents(t: T, st: PlatformState, canAsk: boolean): string {
  const head = `<div class="pf-bar">${btn("new-incident", t("newIncident"), "", "btn")}${btn("reload-incidents", t("reload"))}</div>`;
  const l = st.incidents;
  if (!l) return head + `<div class="sec-empty">${t("loading")}</div>`;
  const list = l.length ? l.map((i) => `<div class="pf-row pf-li${st.incident?.incident.id === i.id ? " on" : ""}" data-action="pf:incident" data-on="${i.id}"><b class="notr">${esc(i.key)}</b><span class="notr">${esc(i.title)}</span><span class="pf-chip sev">${esc(i.severity)}</span><span class="pf-chip s-${i.status}">${esc(i.status)}</span></div>`).join("") : `<div class="sec-empty">${t("noIncidents")}</div>`;
  return head + list + (st.incident ? incident(t, st.incident, canAsk) : "");
}

const TABS: Array<[PlatformState["tab"], PlatformKey]> = [["home", "tabHome"], ["review", "tabReview"], ["incidents", "tabIncidents"]];

export function renderPlatform(t: T, st: PlatformState, canAsk: boolean, desktop: boolean): string {
  if (!desktop) return `<div class="pf"><div class="sec-empty">${t("needDesktop")}</div></div>`;
  const tabs = TABS.map(([id, k]) => `<button class="ops-tab${st.tab === id ? " on" : ""}" data-action="pf:tab" data-on="${id}">${t(k)}</button>`).join("");
  const body = st.tab === "home" ? home(t, st) : st.tab === "review" ? review(t, st, canAsk) : incidents(t, st, canAsk);
  return `<div class="pf"><div class="pf-top"><b>${t("title")}</b><span class="pf-dim">${t("sub")}</span></div><div class="ops-tabs">${tabs}</div>${st.error ? `<pre class="ops-err notr">${esc(st.error)}</pre>` : ""}${body}</div>`;
}
