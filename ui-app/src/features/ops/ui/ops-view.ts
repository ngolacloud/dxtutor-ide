/* ═══════════ feature `ops` — ui: the Ops tab (A9, docs/v2/UI-AUDIT.md item 10; r23 F4b) ═══════════
   IaC in tabs (r23 F4b): Pipeline (each stage, «not installed» with the hint, the verdict, apply the reviewed
   plan), Plan (per resource / attribute, modules, replacements, blast radius, write-only, cost), Security &
   policy (the findings, accept a risk with a reason, fix in the editor), Drift (checked every 6 h; revert,
   into the code, ignore) and State (addresses and ids, lock, backup, move/import through Co-Dev); the
   Kubernetes namespace the Infra pane points at (pods with their trouble, deployments with history
   and actions, services, events) and the cloud CLIs (status, read-only inventory). Texts from the
   catalog, the rest escaped. Actions: data-action="op-…" + data-on. No window. */

import { esc } from "../../../core";
import { podTrouble } from "../domain/commands";
import { securityFindings } from "../domain/commands";
import type { IacTab, OpsState } from "../application/ops-service";
import type { IacFinding, ResourceChange, Stage, StageStatus } from "../domain/types";
import type { OpsKey } from "./messages";

export type T = (k: OpsKey, p?: Record<string, string | number>) => string;

const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string =>
  `<button class="${cls}" data-action="${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;
const mini = (act: string, label: string, on: string): string => `<button class="ops-mini" data-action="${act}" data-on="${esc(on)}">${label}</button>`;

const money = (n: number): string => `$${n.toFixed(2)}`;

function resource(t: T, c: ResourceChange, open: boolean): string {
  const meta = [
    c.module ? `<span class="ops-dim notr">${esc(c.module)}</span>` : "",
    c.reason ? `<span class="ops-dim notr">${esc(c.reason)}</span>` : "",
    c.dependents?.length ? `<span class="ops-blast" title="${esc(c.dependents.join("\n"))}">${t("blast", { n: c.dependents.length })}</span>` : "",
    c.writeOnly?.length ? `<span class="ops-wo notr" title="${esc(t("writeOnlyTip"))}">${esc(c.writeOnly.join(", "))}</span>` : "",
    typeof c.monthlyCost === "number" ? `<span class="ops-cost">${t("perMonth", { c: money(c.monthlyCost) })}</span>` : "",
  ].join("");
  const attrs = open
    ? `<div class="ops-attrs">${c.attrs.map((a) => `<div class="ops-attr"><span class="notr">${esc(a.name)}${c.replacePaths?.includes(a.name) ? ` <span class="ops-why">${t("forcesReplace")}</span>` : ""}</span><code class="ops-b notr">${esc(a.before ?? "∅")}</code><span>→</span><code class="ops-a notr">${a.unknown ? t("knownAfter") : esc(a.after ?? "∅")}</code></div>`).join("") || `<div class="sec-empty">${t("none")}</div>`}${c.dependents?.length ? `<div class="ops-dim notr">${esc(t("blastList", { l: c.dependents.join(", ") }))}</div>` : ""}</div>`
    : "";
  return `<div class="ops-res a-${c.action}" data-action="ops-res" data-on="${esc(c.address)}"><span class="ops-act">${esc(c.action)}</span><span class="notr">${esc(c.address)}</span>${meta}<span class="ops-sp"></span><span class="ops-dim">${c.attrs.length}</span></div>${attrs}`;
}

const STATUS_KEY: Record<StageStatus, OpsKey> = { running: "stRunning", ok: "stOk", failed: "stFailed", not_installed: "stNotInstalled", not_connected: "stNotConnected", skipped: "stSkipped" };

function stageRow(t: T, s: Stage, open: boolean): string {
  const body = open ? `<div class="ops-stage-d">${s.command ? `<code class="notr">${esc(s.command)}</code>` : ""}${s.hint ? `<div class="ops-hint notr">${esc(s.hint)}</div>` : ""}${s.detail ? `<pre class="ops-err notr">${esc(s.detail)}</pre>` : ""}${s.findings.map((f) => `<div class="ops-dim notr">${esc(f.file)}${f.line ? `:${f.line}` : ""} ${esc(f.rule)} — ${esc(f.message)}</div>`).join("")}</div>` : "";
  return `<div class="ops-stage s-${s.status}" data-action="ops-res" data-on="stage:${esc(s.id)}"><span class="ops-st">${t(STATUS_KEY[s.status])}</span><b class="notr">${esc(s.id)}</b><span class="ops-dim notr">${esc(s.summary)}</span>${s.status === "not_installed" && s.hint ? `<span class="ops-hint notr">${esc(s.hint)}</span>` : ""}<span class="ops-sp"></span>${s.ms ? `<span class="ops-dim">${(s.ms / 1000).toFixed(1)} s</span>` : ""}</div>${body}`;
}

function pipelineTab(t: T, st: OpsState): string {
  const i = st.iac, r = i.run;
  const stages = i.live ?? r?.stages ?? [];
  const head = `<div class="ops-bar">${btn("ops-run", i.busy ? t("running") : t("runPipeline"), "", "btn", i.busy)}${r?.target ? `<span class="ops-chip notr">${esc(t("targeted", { a: r.target }))}</span>` : ""}</div>`;
  if (!stages.length && !r) return head + `<div class="sec-empty">${t("pipelineIntro")}</div>`;
  let verdict = "";
  if (r && !i.busy) {
    const changes = r.plan?.changes.length ?? 0;
    verdict = r.notes && !r.stages.length ? `<pre class="ops-err notr">${esc(r.notes)}</pre>`
      : r.blocked ? `<div class="ops-verdict bad">${t("blocked", { s: r.blockers.join(", ") || t("noPlan") })}</div>`
      : changes ? `<div class="ops-verdict ok">${t("readyToApply", { n: changes })}</div><div class="ops-bar">${btn("ops-apply", t("apply"), "", "btn")}</div>`
      : `<div class="ops-verdict">${t("noChanges")}</div>`;
    if (i.staleRisks) verdict += `<div class="ops-dim">${t("staleRisks")}</div>`;
    if (i.applied?.id === r.id) verdict += `<div class="ops-verdict ${i.applied.code === 0 ? "ok" : "bad"}">${t(i.applied.code === 0 ? "appliedOk" : "appliedFailed", { c: i.applied.code })}</div>`;
  }
  return head + stages.map((s) => stageRow(t, s, i.open === `stage:${s.id}`)).join("") + verdict;
}

function planTab(t: T, st: OpsState, canAsk: boolean): string {
  const p = st.iac.run?.plan;
  if (!p) return `<div class="sec-empty">${t("noPlanYet")}</div>`;
  const total = p.changes.reduce((n, c) => n + (c.monthlyCost ?? 0), 0);
  const costed = p.changes.some((c) => typeof c.monthlyCost === "number");
  const cost = st.iac.run?.stages.find((s) => s.id === "infracost");
  return `<div class="ops-sum"><b>${esc(p.tool)}</b> · ${t("summary", { a: p.add, c: p.change, d: p.destroy })} · ${costed ? t("perMonth", { c: money(total) }) : `<span class="ops-dim">${t(cost?.status === "not_connected" ? "costNotConnected" : "costNotInstalled")}</span>`}${p.notes ? ` · <span class="ops-dim">${esc(p.notes)}</span>` : ""}</div>`
    + p.changes.map((c) => resource(t, c, st.iac.open === c.address)).join("")
    + `<div class="ops-bar">${canAsk ? btn("ops-ask-plan", t("askPlan"), "", "btn ghost ops-ai") + btn("ops-ask-iac", t("askIac"), "", "btn ghost ops-ai") : ""}</div>`;
}

const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function securityTab(t: T, st: OpsState, findings: IacFinding[], canAsk: boolean): string {
  const r = st.iac.run;
  const scanners = (r?.stages ?? []).filter((s) => ["rules", "tflint", "checkov", "trivy", "state", "conftest"].includes(s.id));
  const strip = scanners.length ? `<div class="ops-bar">${scanners.map((s) => `<span class="ops-chip s-${s.status} notr" title="${esc(s.hint ?? s.summary)}">${esc(s.id)} · ${t(STATUS_KEY[s.status])}</span>`).join("")}</div>` : "";
  const list = !r ? `<div class="sec-empty">${t("noPlanYet")}</div>` : findings.length ? findings.map((f) => `<div class="ops-row ops-finding${f.severity === "error" && !f.accepted ? " bad" : ""}"><span class="ops-sev ${f.severity}">${t(f.severity === "error" ? "sevError" : "sevWarning")}</span><span class="ops-dim notr">${esc(f.source)}</span><span class="notr">${esc(f.rule)}</span><span class="notr ops-loc" data-action="ops-open-finding" data-on="${esc(f.key)}">${esc(f.file)}${f.line ? `:${f.line}` : ""}</span><span class="notr ops-msg">${esc(f.message)}</span><span class="ops-sp"></span>${f.accepted ? `<span class="ops-ok">${t("accepted")}</span>` : mini("ops-accept", t("acceptRisk"), f.key)}${canAsk ? mini("ops-fix", t("fixInEditor"), f.key) : ""}</div>`).join("") : `<div class="sec-empty">${t("noFindings")}</div>`;
  const risks = st.iac.risks.length ? `<div class="ops-ct">${t("acceptedRisks")}</div>${st.iac.risks.map((a) => `<div class="ops-row"><span class="notr">${esc(a.label)}</span><span class="ops-dim notr">${esc(t("acceptedBy", { who: a.actor, until: fmtDate(a.expires) }))}</span><span class="notr ops-msg">${esc(a.reason)}</span><span class="ops-sp"></span>${mini("ops-revoke", t("revoke"), String(a.id))}</div>`).join("")}` : "";
  return strip + list + risks;
}

function driftTab(t: T, st: OpsState, drifted: ResourceChange[], canAsk: boolean): string {
  const d = st.iac.drift, dir = st.iac.dir ?? "";
  const ignored = new Map(st.iac.risks.filter((r) => r.kind === "drift").map((r) => [r.key, r]));
  const head = `<div class="ops-bar">${btn("ops-drift", d.busy ? t("checking") : t("checkDrift"), "", "btn ghost", d.busy)}<span class="ops-dim">${d.at ? t("driftChecked", { at: new Date(d.at).toLocaleString() }) : t("driftEvery")}</span></div>`;
  if (d.plan && !d.plan.ok) return head + `<pre class="ops-err notr">${esc(d.plan.notes || t("noTool"))}</pre>`;
  if (!d.plan && !st.iac.run?.plan) return head + `<div class="sec-empty">${t("driftIntro")}</div>`;
  if (!drifted.length) return head + `<div class="sec-empty">${t("noDrift")}</div>`;
  return head + `<div class="ops-dim">${t("driftWho")}</div>` + drifted.map((c) => {
    const ign = ignored.get(`drift:${dir}:${c.address}`);
    const acts = ign ? `<span class="ops-ok">${esc(t("ignoredUntil", { until: fmtDate(ign.expires) }))}</span>` : `${mini("ops-drift-revert", t("revert"), c.address)}${canAsk ? mini("ops-drift-code", t("toCode"), c.address) : ""}${mini("ops-drift-ignore", t("ignore"), c.address)}`;
    return resource(t, c, st.iac.open === c.address) + `<div class="ops-bar ops-drift-acts">${acts}</div>`;
  }).join("");
}

function stateTab(t: T, st: OpsState, canAsk: boolean): string {
  const s = st.iac.state;
  const head = `<div class="ops-bar">${btn("ops-state", t("reload"), "", "btn ghost", s.busy)}${canAsk ? btn("ops-import", t("importRes"), "", "btn ghost ops-ai") : ""}</div>`;
  if (s.busy && !s.data) return head + `<div class="sec-empty">${t("loading")}</div>`;
  const d = s.data;
  if (!d) return head;
  if (!d.ok) return head + `<pre class="ops-err notr">${esc(d.notes || t("noTool"))}</pre>`;
  const meta = `<div class="ops-sum"><span class="ops-chip notr">${esc(d.backend)}</span> ${d.serial !== null ? t("serial", { s: d.serial }) : ""}${d.lineage ? ` · <span class="ops-dim notr">${esc(d.lineage)}</span>` : ""}${d.backupSerial !== null ? ` · ${t("backup", { s: d.backupSerial })}` : ""}</div>`;
  const lock = d.lock ? `<div class="ops-row bad"><span>${t("locked", { who: d.lock.who, op: d.lock.operation, at: d.lock.created })}</span><span class="ops-sp"></span>${mini("ops-unlock", t("forceUnlock"), d.lock.id)}</div>` : d.lockReadable ? `<div class="ops-dim">${t("unlocked")}</div>` : "";
  const notes = d.notes ? `<div class="ops-dim notr">${esc(d.notes)}</div>` : "";
  const rows = d.resources.length ? d.resources.map((r) => `<div class="ops-row"><span class="notr ops-nm">${esc(r.address)}</span><span class="ops-dim notr">${esc(r.id ?? "")}</span>${r.sensitive.length ? `<span class="ops-why notr" title="${esc(t("sensitiveTip"))}">${esc(t("sensitiveIn", { l: r.sensitive.join(", ") }))}</span>` : ""}<span class="ops-sp"></span>${canAsk && r.mode === "managed" ? mini("ops-move", t("moveRes"), r.address) : ""}</div>`).join("") : "";
  return head + meta + lock + notes + rows;
}

const TABS: Array<[IacTab, OpsKey]> = [["pipeline", "tabPipeline"], ["plan", "tabPlan"], ["security", "tabSecurity"], ["drift", "tabDrift"], ["state", "tabState"]];

function iacSection(t: T, st: OpsState, view: { canAsk: boolean; findings: IacFinding[]; drifted: ResourceChange[] }): string {
  const i = st.iac;
  if (i.dirs === null) return `<div class="sec-empty">${t("loading")}</div>`;
  if (!i.dirs.length) return `<div class="sec-empty">${t("noIac")}</div>`;
  const dirs = `<select class="inp notr ops-dir" data-action="ops-dir">${i.dirs.map((d) => `<option${d === i.dir ? " selected" : ""}>${esc(d)}</option>`).join("")}</select>`;
  const blocking = view.findings.filter((f) => f.severity === "error" && !f.accepted).length;
  const tabs = TABS.map(([id, k]) => {
    const badge = id === "security" && blocking ? ` <span class="ops-badge">${blocking}</span>` : id === "drift" && view.drifted.length ? ` <span class="ops-badge">${view.drifted.length}</span>` : "";
    return `<button class="ops-tab${i.tab === id ? " on" : ""}" data-action="ops-tab" data-on="${id}">${t(k)}${badge}</button>`;
  }).join("");
  const body = i.tab === "pipeline" ? pipelineTab(t, st)
    : i.tab === "plan" ? planTab(t, st, view.canAsk)
    : i.tab === "security" ? securityTab(t, st, view.findings, view.canAsk)
    : i.tab === "drift" ? driftTab(t, st, view.drifted, view.canAsk)
    : stateTab(t, st, view.canAsk);
  return `<div class="ops-bar">${dirs}<div class="ops-tabs">${tabs}</div></div>${body}`;
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
    <section class="ops-sec"><h3>${t("iac")}</h3>${iacSection(t, st, { canAsk, findings: securityFindings(st.iac.run), drifted: st.iac.drift.plan?.drift ?? st.iac.run?.plan?.drift ?? [] })}</section>
    <section class="ops-sec"><h3>${t("kube")}</h3>${kubeSection(t, st, canAsk)}</section>
    <section class="ops-sec"><h3>${t("cloud")}</h3>${cloudSection(t, st)}</section></div>`;
}
