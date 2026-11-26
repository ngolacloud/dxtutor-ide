/* ═════════ feature `ops` — raiz de composição (A9, docs/v2/UI-AUDIT.md item 10) ═════════
   O separador «Ops», só na app desktop: liga o serviço (application/ops-service.ts) ao backend
   (infrastructure/tauri.ts), ao pane Infra e ao terminal (infrastructure/legacy-bridge.ts) e ao Co-Dev;
   regista o VIEW «ops», as acções `op-*` e, no desktop, um botão no pane Infra. Sem `window` aqui. */

import { VIEW, RP } from "../../app/store/registry";
import { codevAsk } from "../../app/codev-ask";
import { translator } from "../../app/i18n";
import { requestApproval } from "../../app/approval";
import { isDesktop } from "../../platform/tauri/core";
import { makeOps, type IacTab } from "./application/ops-service";
import { services } from "../../app/services";
import { tauriOps, tauriAudit } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { OPS_MESSAGES, type OpsKey } from "./ui/messages";
import { renderOps } from "./ui/ops-view";
import { bindActions, type ActionTable } from "./ui/actions";

const t = translator(OPS_MESSAGES);

export const ops = makeOps({
  ops: tauriOps(),
  world: {
    root: () => B.root(), kubeTarget: () => B.kubeTarget(), runInTerminal: (c) => B.runInTerminal(c), openFile: (f, l) => B.openFile(f, l),
    showFile: (rel, content) => B.showFile(rel, content),
    vault: () => services.vault?.signedIn() ?? null,
    now: () => Date.now(),
    every: (ms, f) => { const h = setInterval(f, ms); return () => clearInterval(h); },
  },
  audit: tauriAudit(() => B.root()),
  human: { approve: (r) => requestApproval(r), text: (ph, initial) => B.textPrompt(ph, initial), toast: (m) => B.notify(m) },
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  say: (k, p) => t(k as OpsKey, p),
});

let host: HTMLElement | null = null;
const paint = (): void => { if (host && host.isConnected) host.innerHTML = renderOps(t, ops.state(), codevAsk.available(), isDesktop() && !!B.root()); };
VIEW.ops = (_t, h) => { host = h; paint(); if (isDesktop() && B.root()) void ops.refresh(); };
ops.subscribe(paint);
/* r23 F4b: outra pasta — o pipeline, o drift agendado e o estado da anterior não valem para esta */
document.addEventListener("dx:workspace", () => ops.workspaceChanged());

/** Abre o separador Ops. */
export function openOps(): void {
  B.openTab("ops", t("tab"));
}

/* no desktop, o pane Infra ganha a entrada para o Ops */
const prevInfra = RP.infra;
if (prevInfra) {
  RP.infra = () => {
    prevInfra();
    if (!isDesktop()) return;
    const sec = document.querySelector("#pane-infra .sections");
    if (sec && !sec.querySelector('[data-action="ops-open"]')) sec.insertAdjacentHTML("afterbegin", `<button class="btn ghost ops-entry" data-action="ops-open">${t("tab")} — IaC · Kubernetes · Cloud</button>`);
  };
}

const ACTIONS: ActionTable = {
  "ops-open": { on: "click", run: () => openOps() },
  "ops-dir": { on: "change", run: (e) => ops.selectDir(e.value) },
  "ops-tab": { on: "click", run: (e) => ops.setTab(e.on as IacTab) },
  "ops-run": { on: "click", run: () => { void ops.runPipeline(); } },
  "ops-res": { on: "click", run: (e) => ops.toggleResource(e.on) },
  "ops-apply": { on: "click", run: () => { void ops.applyRun(); } },
  "ops-accept": { on: "click", run: (e) => { void ops.acceptFinding(e.on); } },
  "ops-revoke": { on: "click", run: (e) => { void ops.revokeRisk(Number(e.on)); } },
  "ops-open-finding": { on: "click", run: (e) => ops.openFinding(e.on) },
  "ops-fix": { on: "click", run: (e) => ops.fixFinding(e.on) },
  "ops-drift": { on: "click", run: () => { void ops.checkDrift(); } },
  "ops-drift-revert": { on: "click", run: (e) => ops.driftRevert(e.on) },
  "ops-drift-code": { on: "click", run: (e) => ops.driftToCode(e.on) },
  "ops-drift-ignore": { on: "click", run: (e) => { void ops.driftIgnore(e.on); } },
  "ops-state": { on: "click", run: () => { void ops.loadState(); } },
  "ops-unlock": { on: "click", run: () => ops.unlock() },
  "ops-move": { on: "click", run: (e) => { void ops.moveResource(e.on); } },
  "ops-import": { on: "click", run: () => { void ops.importResource(); } },
  "ops-ask-plan": { on: "click", run: () => ops.askPlan("explain") },
  "ops-ask-iac": { on: "click", run: () => ops.askPlan("change") },
  "ops-kube-reload": { on: "click", run: () => { void ops.loadKube(); } },
  "ops-logs-pod": { on: "click", run: (e) => ops.kubeAction("logs-pod", e.on) },
  "ops-logs-deploy": { on: "click", run: (e) => ops.kubeAction("logs-deploy", e.on) },
  "ops-exec": { on: "click", run: (e) => ops.kubeAction("exec", e.on) },
  "ops-del-pod": { on: "click", run: (e) => ops.kubeAction("delete-pod", e.on) },
  "ops-restart": { on: "click", run: (e) => ops.kubeAction("restart", e.on) },
  "ops-history": { on: "click", run: (e) => { void ops.history(e.on); } },
  "ops-undo": { on: "click", run: (e) => { const i = e.on.lastIndexOf("|"); ops.kubeAction("undo", e.on.slice(0, i), e.on.slice(i + 1)); } },
  "ops-scale": { on: "click", run: (e) => { void ops.scale(e.on); } },
  "ops-port": { on: "click", run: (e) => { void ops.portForward(e.on); } },
  "ops-ask-pod": { on: "click", run: (e) => ops.askPod(e.on) },
  "ops-inventory": { on: "click", run: (e) => { void ops.inventory(e.on); } },
  /* r23 F5a */
  "ops-rb": { on: "change", run: (e) => ops.selectRunbook(e.value) },
  "ops-rb-run": { on: "click", run: (e) => { void ops.runStep(Number(e.on)); } },
  "ops-rb-new": { on: "click", run: () => ops.newRun() },
  "ops-rb-edit": { on: "click", run: () => ops.editRunbook() },
  "ops-rb-ok": { on: "click", run: (e) => { void ops.judge(Number(e.on), true); } },
  "ops-rb-no": { on: "click", run: (e) => { void ops.judge(Number(e.on), false); } },
  "ops-rb-ask": { on: "click", run: (e) => ops.askStep(Number(e.on)) },
  "ops-rb-reload": { on: "click", run: () => { void ops.loadRunbooks(); } },
  "ops-evidence": { on: "click", run: () => { void ops.exportEvidence(); } },
};
bindActions(ACTIONS);
