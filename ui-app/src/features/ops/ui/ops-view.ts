/* ═══════════ feature `ops` — ui: the Ops tab (A9, docs/v2/UI-AUDIT.md item 10) ═══════════
   IaC (folders, plan or drift as a per-resource / per-attribute diff, apply through a terminal), the
   Kubernetes namespace the Infra pane points at (pods with their trouble, deployments with history
   and actions, services, events) and the cloud CLIs (status, read-only inventory). Texts from the
   catalog, the rest escaped. Actions: data-action="op-…" + data-on. No window. */

import { esc } from "../../../core";
import { podTrouble } from "../domain/commands";
import type { OpsState } from "../application/ops-service";
import type { ResourceChange } from "../domain/types";
import type { OpsKey } from "./messages";

export type T = (k: OpsKey, p?: Record<string, string | number>) => string;

const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string =>
  `<button class="${cls}" data-action="${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;
const mini = (act: string, label: string, on: string): string => `<button class="ops-mini" data-action="${act}" data-on="${esc(on)}">${label}</button>`;

function resource(t: T, c: ResourceChange, open: boolean): string {
  const attrs = open
    ? `<div class="ops-attrs">${c.attrs.map((a) => `<div class="ops-attr"><span class="notr">${esc(a.name)}</span><code class="ops-b notr">${esc(a.before ?? "∅")}</code><span>→</span><code class="ops-a notr">${a.unknown ? t("knownAfter") : esc(a.after ?? "∅")}</code></div>`).join("") || `<div class="sec-empty">${t("none")}</div>`}</div>`
    : "";
  return `<div class="ops-res a-${c.action}" data-action="ops-res" data-on="${esc(c.address)}"><span class="ops-act">${esc(c.action)}</span><span class="notr">${esc(c.address)}</span><span class="ops-sp"></span><span class="ops-dim">${c.attrs.length}</span></div>${attrs}`;
}

function iacSection(t: T, st: OpsState, canAsk: boolean): string {
  const i = st.iac;
  if (i.dirs === null) return `<div class="sec-empty">${t("loading")}</div>`;
  if (!i.dirs.length) return `<div class="sec-empty">${t("noIac")}</div>`;
  const dirs = `<select class="inp notr ops-dir" data-action="ops-dir">${i.dirs.map((d) => `<option${d === i.dir ? " selected" : ""}>${esc(d)}</option>`).join("")}</select>`;
  let body = "";
  const p = i.plan;
  if (i.busy) body = `<div class="sec-empty">${t("planning")}</div>`;
  else if (p && !p.ok) body = `<pre class="ops-err notr">${esc(p.notes || t("noTool"))}</pre>`;
  else if (p) {
    body = `<div class="ops-sum"><b>${esc(p.tool)}</b> · ${t("summary", { a: p.add, c: p.change, d: p.destroy })}${p.notes ? ` · <span class="ops-dim">${esc(p.notes)}</span>` : ""}</div>`
      + p.changes.map((c) => resource(t, c, i.open === c.address)).join("")
      + (p.drift.length ? `<div class="ops-ct">${t("driftTitle")}</div>${p.drift.map((c) => resource(t, c, i.open === c.address)).join("")}` : "")
      + `<div class="ops-bar">${p.changes.length || (p.refreshOnly && p.drift.length) ? btn("ops-apply", t("apply"), "", "btn") : ""}${canAsk ? btn("ops-ask-plan", t("askPlan"), "", "btn ghost ops-ai") + btn("ops-ask-iac", t("askIac"), "", "btn ghost ops-ai") : ""}</div>`;
  }
  return `<div class="ops-bar">${dirs}${btn("ops-plan", t("plan"), "", "btn ghost", i.busy)}${btn("ops-drift", t("drift"), "", "btn ghost", i.busy)}</div>${body}`;
}

function kubeSection(t: T, st: OpsState, canAsk: boolean): string {
  const k = st.kube;
  if (!k.target) return `<div class="sec-empty">${t("noKube")}</div>`;
  const head = `<div class="ops-bar"><span class="ops-chip notr">${esc(k.target.context)} / ${esc(k.target.namespace)}</span>${btn("ops-kube-reload", t("reload"), "", "btn ghost", k.busy)}</div>`;
  if (k.busy && !k.state) return head + `<div class="sec-empty">${t("loading")}</div>`;
  const s = k.state;
  if (!s) return head;
  if (!s.ok) return head + `<pre class="ops-err notr">${esc(s.notes)}</pre>`;
  const pods = s.pods.length ? s.pods.map((p) => `<div class="ops-row${podTrouble(p) ? " bad" : ""}"><span class="notr ops-nm">${esc(p.name)}</span><span class="ops-dim">${esc(p.phase)} · ${esc(p.ready)}${p.restarts ? " · " + t("restarts", { n: p.restarts }) : ""}</span>${p.reason ? `<span class="ops-why notr">${esc(p.reason)}</span>` : ""}<span class="ops-sp"></span>${mini("ops-logs-pod", t("logs"), p.name)}${mini("ops-exec", t("exec"), p.name)}${mini("ops-del-pod", t("del"), p.name)}${canAsk && podTrouble(p) ? mini("ops-ask-pod", t("why"), p.name) : ""}</div>`).join("") : `<div class="sec-empty">${t("none")}</div>`;
  const deps = s.deployments.length ? s.deployments.map((d) => {
    const h = k.history?.deployment === d.name ? k.history.revisions : null;
    return `<div class="ops-row"><span class="notr ops-nm">${esc(d.name)}</span><span class="ops-dim notr">${esc(d.ready)} · ${esc(d.images.join(", "))}${d.revision ? ` · rev ${esc(d.revision)}` : ""}</span><span class="ops-sp"></span>${mini("ops-logs-deploy", t("logs"), d.name)}${mini("ops-history", t("history"), d.name)}${mini("ops-scale", t("scale"), d.name)}${mini("ops-restart", t("restart"), d.name)}</div>`
      + (h ? `<div class="ops-hist">${h.map((r) => `<div class="ops-row"><span class="ops-dim">rev ${r.revision}</span><span class="notr">${esc(r.images.join(", "))}</span><span class="ops-dim notr">${esc(r.created)}${r.replicas ? " · " + t("current") : ""}</span><span class="ops-sp"></span>${r.replicas ? "" : mini("ops-undo", t("rollback"), `${d.name}|${r.revision}`)}</div>`).join("") || `<div class="sec-empty">${t("none")}</div>`}</div>` : "");
  }).join("") : `<div class="sec-empty">${t("none")}</div>`;
  const svcs = s.services.length ? s.services.map((v) => `<div class="ops-row"><span class="notr ops-nm">${esc(v.name)}</span><span class="ops-dim notr">${esc(v.kind)} · ${esc(v.clusterIp)} · ${esc(v.ports.join(", "))}</span><span class="ops-sp"></span>${mini("ops-port", t("portForward"), v.name)}</div>`).join("") : `<div class="sec-empty">${t("none")}</div>`;
  const evs = s.events.length ? s.events.slice(0, 15).map((e) => `<div class="ops-row${e.kind === "Warning" ? " bad" : ""}"><span class="ops-dim">${esc(e.kind)}</span><span class="notr">${esc(e.reason)}</span><span class="notr ops-dim">${esc(e.object)}${e.count > 1 ? " ×" + e.count : ""}</span><span class="notr ops-msg">${esc(e.message)}</span></div>`).join("") : `<div class="sec-empty">${t("none")}</div>`;
  return head + `<div class="ops-ct">${t("pods")}</div>${pods}<div class="ops-ct">${t("deployments")}</div>${deps}<div class="ops-ct">${t("services")}</div>${svcs}<div class="ops-ct">${t("events")}</div>${evs}`;
}

function cloudSection(t: T, st: OpsState): string {
  const c = st.cloud;
  if (!c.status) return `<div class="sec-empty">${t("loading")}</div>`;
  return `<div class="ops-clouds">${c.status.map((s) => {
    const inv = c.inventory[s.provider];
    const list = inv ? (inv.resources.length ? inv.resources.map((r) => `<div class="ops-row"><span class="ops-dim">${esc(r.kind)}</span><span class="notr ops-nm">${esc(r.name)}</span><span class="ops-dim notr">${esc(r.region)} · ${esc(r.status)}</span></div>`).join("") : `<div class="sec-empty">${t("none")}</div>`) + (inv.notes ? `<pre class="ops-err notr">${esc(inv.notes)}</pre>` : "") + (inv.commands.length ? `<div class="ops-dim notr">${esc(t("ranCommands", { c: inv.commands.join(" · ") }))}</div>` : "") : "";
    return `<div class="ops-card"><div class="ops-ct"><b class="notr">${esc(s.provider)}</b><span class="ops-sp"></span>${s.installed ? `<span class="ops-ok">${t("installed")}</span>` : `<span class="ops-dim">${t("notInstalled")}</span>`}</div>${s.installed ? `<div class="ops-dim notr">${esc(s.version)}</div><div class="notr">${esc(s.account ?? t("noAccount"))}</div>${s.notes ? `<div class="ops-dim notr">${esc(s.notes)}</div>` : ""}<div class="ops-bar">${btn("ops-inventory", t("inventory"), s.provider, "btn ghost", c.busy !== null)}</div>${c.busy === s.provider ? `<div class="sec-empty">${t("loading")}</div>` : list}` : `<div class="ops-dim notr">${esc(s.notes)}</div>`}</div>`;
  }).join("")}</div>`;
}

export function renderOps(t: T, st: OpsState, canAsk: boolean, desktop: boolean): string {
  if (!desktop) return `<div class="ops"><div class="sec-empty">${t("needDesktop")}</div></div>`;
  return `<div class="ops"><div class="ops-top"><b>${t("title")}</b><span class="ops-dim">${t("sub")}</span></div>${st.ran ? `<div class="ops-ran notr">${esc(t("ran", { c: st.ran }))}</div>` : ""}
    <section class="ops-sec"><h3>${t("iac")}</h3>${iacSection(t, st, canAsk)}</section>
    <section class="ops-sec"><h3>${t("kube")}</h3>${kubeSection(t, st, canAsk)}</section>
    <section class="ops-sec"><h3>${t("cloud")}</h3>${cloudSection(t, st)}</section></div>`;
}
