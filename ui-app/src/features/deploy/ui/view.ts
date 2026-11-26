/* ═══════════ feature `deploy` — ui: the guided deploy (r23 F4c2) ═══════════
   Eight steps, each with its checks and their status («not installed» / «not connected» never green); waivers with a
   reason; the exact commands; the rollout's lines; the record. Actions: data-action="deploy:…" + data-on. No window. */
import { esc } from "../../../core";
import { STEPS, gateTone, preflightGates, secretGates, short, stepTone, stillBlocking, type Step } from "../domain/rules";
import type { DeployState } from "../application/deploy-service";
import type { DeployPlan, DeployRecord, Gate, GateStatus } from "../domain/types";
import type { DeployKey } from "./messages";

export type T = (k: DeployKey, p?: Record<string, string | number>) => string;
const ST: Record<GateStatus, DeployKey> = { ok: "stOk", failed: "stFailed", not_installed: "stNotInstalled", not_connected: "stNotConnected", skipped: "stSkipped" };
const btn = (act: string, label: string, on = "", cls = "btn ghost", dis = false): string =>
  `<button class="${cls}" data-action="deploy:${act}"${on ? ` data-on="${esc(on)}"` : ""}${dis ? " disabled" : ""}>${label}</button>`;

function gateRow(t: T, p: DeployPlan, g: Gate, st: DeployState): string {
  const tone = gateTone(p, g, st.waivers);
  const w = st.waivers[g.id];
  const acts = tone === "blocked" && p.waivable.includes(g.id) ? btn("waive", t("waive"), g.id, "dp-mini") : tone === "waived" ? `<span class="dp-dim">${esc(t("waived", { r: w }))}</span>${btn("unwaive", t("unwaive"), g.id, "dp-mini")}` : "";
  const open = st.open === g.id;
  return `<div class="dp-gate g-${tone}" data-action="deploy:toggle" data-on="${esc(g.id)}"><span class="dp-st">${t(ST[g.status])}</span><b class="notr">${esc(g.id)}</b><span class="dp-dim notr">${esc(g.summary)}</span>${tone === "blocked" ? `<span class="dp-blk">${t("blocks")}</span>` : ""}<span class="dp-sp"></span>${acts}</div>`
    + (open || (g.hint && g.status === "not_installed") ? `<div class="dp-gd">${g.hint ? `<code class="notr">${esc(g.hint)}</code>` : ""}${open && g.detail ? `<pre class="notr">${esc(g.detail)}</pre>` : ""}</div>` : "");
}

const kv = (k: string, v: string): string => `<div class="dp-kv"><span>${k}</span><span class="notr">${v}</span></div>`;

function stepBody(t: T, s: Step, st: DeployState, p: DeployPlan): string {
  switch (s) {
    case "target": return kv(t("env"), esc(p.env)) + kv(t("cluster"), `${esc(p.context)} / ${esc(p.namespace)}`) + kv(t("version"), `<code>${esc(short(p.version))}</code> ${esc(p.subject)}`) + kv(t("issue"), esc(p.issue ?? "—")) + kv(t("manifests"), esc(p.manifests.join(", "))) + kv(t("workloads"), esc(p.deployments.join(", ") || "—")) + p.gates.filter((g) => g.id === "version").map((g) => gateRow(t, p, g, st)).join("");
    case "identity": return kv(t("gitUser"), esc(p.identity.git || "—")) + kv(t("clusterUser"), esc(p.identity.cluster ?? t("notConnected"))) + kv(t("vaultUser"), esc(p.identity.vault ?? t("notConnected")));
    case "secrets": return `<div class="dp-dim">${p.secretsFromVault.length ? esc(t("fromVault", { l: p.secretsFromVault.join(", ") })) : t("noSecretObjects")}</div>` + secretGates(p).map((g) => gateRow(t, p, g, st)).join("");
    case "preflight": return preflightGates(p).map((g) => gateRow(t, p, g, st)).join("");
    case "strategy": return `<label class="dp-opt"><input type="radio" checked disabled> ${t("rolling")}</label><label class="dp-opt off"><input type="radio" disabled> ${t("canary")}</label><label class="dp-opt off"><input type="radio" disabled> ${t("blueGreen")}</label>`;
    case "approve": {
      const left = stillBlocking(p, st.waivers);
      return `<div class="dp-ct">${t("commands")}</div><pre class="dp-cmds notr">${esc(p.commands.join("\n"))}</pre>`
        + (p.env === "production" ? `<div class="dp-dim">${esc(t("prodNeeds", { who: p.approver ?? t("noApprover") }))}</div>` : "")
        + (left.length ? `<div class="dp-verdict bad">${esc(t("blockedBy", { l: left.join(", ") }))}</div>` : `<div class="dp-verdict ok">${t("ready")}</div>`)
        + `<div class="dp-bar">${btn("rollout", st.busy === "rollout" ? t("deploying") : t("deploy"), "", p.env === "production" ? "btn danger" : "btn", !!left.length || st.busy !== null || !!st.record)}</div>`;
    }
    case "rollout": return st.lines.length ? `<pre class="dp-out notr">${esc(st.lines.join("\n"))}</pre>` : "";
    case "record": return st.record ? recRow(t, st.record) : "";
  }
}

function recRow(t: T, r: DeployRecord): string {
  return `<div class="dp-rec ${r.ok ? "ok" : "bad"}"><b>${r.ok ? t("recOk") : esc(t("recFailed", { step: r.failedStep ?? "?" }))}</b><span class="notr">${esc(r.env)} · ${esc(r.context)}/${esc(r.namespace)} · <code>${esc(short(r.version))}</code>${r.issue ? ` · ${esc(r.issue)}` : ""}</span><span class="dp-dim">${esc(t("recBy", { who: r.actor }))}${r.approver ? ` · ${esc(t("recApprover", { who: r.approver }))}` : ""} · ${esc(new Date(r.at).toLocaleString())}</span></div>`;
}

export function renderDeploy(t: T, st: DeployState, desktop: boolean): string {
  if (!desktop) return `<div class="dp"><div class="sec-empty">${t("needDesktop")}</div></div>`;
  const head = `<div class="dp-top"><b>${t("title")}</b><span class="dp-dim">${t("sub")}</span></div><div class="dp-bar"><span class="dp-dim">${t("choose")}</span>${btn("plan", t("toStaging"), "staging", st.env === "staging" ? "btn" : "btn ghost", st.busy !== null)}${btn("plan", t("toProduction"), "production", st.env === "production" ? "btn" : "btn ghost", st.busy !== null)}${st.env ? btn("plan", st.busy === "plan" ? t("planning") : t("replan"), st.env, "btn ghost", st.busy !== null) : ""}</div>`;
  const err = st.error ? `<pre class="dp-err notr">${esc(st.error)}</pre>` : "";
  const p = st.plan;
  const steps = p ? STEPS.map((s) => {
    const tone = s === "rollout" ? (st.busy === "rollout" ? "warn" : st.record ? (st.record.ok ? "ok" : "blocked") : "todo") : s === "record" ? (st.record ? (st.record.ok ? "ok" : "blocked") : "todo") : stepTone(p, s, st.waivers);
    const body = stepBody(t, s, st, p);
    return `<section class="dp-step s-${tone}"><h3>${t(s)}</h3>${body}</section>`;
  }).join("") : "";
  const hist = `<section class="dp-step"><h3>${t("history")}</h3>${st.recent.length ? st.recent.slice(0, 10).map((r) => recRow(t, r)).join("") : `<div class="sec-empty">${t("noHistory")}</div>`}</section>`;
  return `<div class="dp">${head}${err}${steps}${hist}</div>`;
}
