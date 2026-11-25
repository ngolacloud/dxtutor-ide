/* ═══════════ feature `ops` — application: the Ops tab (A9, docs/v2/UI-AUDIT.md item 10) ═══════════
   State and use cases, read-only by default:
   - IaC: the project's folders with `.tf`, a plan or the drift read as a diff, and — only on the
     human's word, with the exact command — applying it in a terminal.
   - Kubernetes: the namespace the Infra pane points at (pods, deployments, services, events, a
     deployment's revisions) and the real actions (logs, exec, port-forward, scale, restart, roll back,
     delete a pod), each one a command shown in full, approved, and run in a terminal.
   - Cloud: the official CLIs' status and a read-only inventory.
   - Co-Dev explains a plan or a failing pod, and proposes IaC changes as hunks.
   No DOM, no window. */

import { eventsFor, iacApply, kubeCmd, planText, servicePort } from "../domain/commands";
import type { CloudCli, CloudInventory, IacPlan, KubeState, KubeTarget, Revision } from "../domain/types";
import type { ApprovalRequest, CodevPort, HumanPort, OpsPort, OpsWorld } from "./ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;

export interface OpsState {
  iac: { dirs: string[] | null; dir: string | null; plan: IacPlan | null; busy: boolean; open: string | null };
  kube: { target: KubeTarget | null; state: KubeState | null; busy: boolean; history: { deployment: string; revisions: Revision[] } | null };
  cloud: { status: CloudCli[] | null; inventory: Record<string, CloudInventory>; busy: string | null };
  /** the last command sent to a terminal */
  ran: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeOps(deps: { ops: OpsPort; world: OpsWorld; human: HumanPort; codev: CodevPort; say: Say }) {
  const { ops, world, human, codev, say } = deps;
  const st: OpsState = { iac: { dirs: null, dir: null, plan: null, busy: false, open: null }, kube: { target: null, state: null, busy: false, history: null }, cloud: { status: null, inventory: {}, busy: null }, ran: null };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  /** The one way anything changes: the exact command, where it runs, the human's yes, a terminal. */
  async function approveAndRun(r: ApprovalRequest & { scope: string }): Promise<boolean> {
    const d = await human.approve(r);
    if (!d.approved) return false;
    const cmd = r.command;
    world.runInTerminal(cmd);
    st.ran = cmd;
    emit();
    return true;
  }

  const kubeScope = (t: KubeTarget): string => say("scopeKube", { c: t.context, n: t.namespace });

  /* ── IaC ── */
  async function loadDirs(): Promise<void> {
    const root = world.root();
    if (!root) return;
    st.iac.dirs = await ops.iacDirs(root).catch(() => []);
    if (!st.iac.dir && st.iac.dirs.length) st.iac.dir = st.iac.dirs[0];
    emit();
  }
  async function plan(refreshOnly: boolean): Promise<void> {
    const root = world.root(), dir = st.iac.dir;
    if (!root || !dir || st.iac.busy) return;
    st.iac.busy = true; emit();
    try { st.iac.plan = await ops.iacPlan(root, dir, refreshOnly); st.iac.open = null; }
    catch (e) { st.iac.plan = { ok: false, tool: "", dir, refreshOnly, add: 0, change: 0, destroy: 0, changes: [], drift: [], applyCommand: "", notes: msg(e) }; }
    st.iac.busy = false; emit();
  }
  function applyPlan(): void {
    const p = st.iac.plan;
    if (!p || !p.ok || (!p.changes.length && !(p.refreshOnly && p.drift.length))) return;
    const destroys = !p.refreshOnly && p.destroy > 0;
    void approveAndRun({ title: say("applyWhat", { n: p.changes.length || p.drift.length, dir: p.dir }), command: iacApply(p), scope: say("scopeIac", { dir: p.dir, tool: p.tool }), destructive: destroys, confirmText: destroys ? p.dir : undefined });
  }
  function askPlan(intent: "explain" | "change"): void {
    const p = st.iac.plan;
    if (!p || !codev.available()) return;
    codev.ask({ intent, text: say(intent === "explain" ? "askPlanText" : "askIacText"), context: [{ kind: "problem", label: `${p.tool} plan · ${p.dir}`, text: planText(p), path: p.dir === "." ? undefined : p.dir }], send: intent === "explain" });
  }

  /* ── Kubernetes ── */
  async function loadKube(): Promise<void> {
    const t = world.kubeTarget();
    st.kube.target = t;
    if (!t || st.kube.busy) { emit(); return; }
    st.kube.busy = true; emit();
    try { st.kube.state = await ops.kubeState(t); } catch (e) { st.kube.state = { ok: false, context: t.context, namespace: t.namespace, pods: [], services: [], deployments: [], events: [], notes: msg(e) }; }
    st.kube.busy = false; emit();
  }
  async function history(deployment: string): Promise<void> {
    const t = st.kube.target;
    if (!t) return;
    if (st.kube.history?.deployment === deployment) { st.kube.history = null; emit(); return; }
    try { st.kube.history = { deployment, revisions: await ops.kubeHistory(t, deployment) }; } catch (e) { human.toast(msg(e)); }
    emit();
  }
  function kubeAction(kind: string, name: string, extra?: string): void {
    const t = st.kube.target;
    if (!t) return;
    switch (kind) {
      case "logs-deploy": world.runInTerminal(kubeCmd.logs(t, "deploy", name)); st.ran = kubeCmd.logs(t, "deploy", name); emit(); return; // reading logs changes nothing
      case "logs-pod": world.runInTerminal(kubeCmd.logs(t, "pod", name)); st.ran = kubeCmd.logs(t, "pod", name); emit(); return;
      case "exec": void approveAndRun({ title: say("execWhat", { pod: name }), command: kubeCmd.exec(t, name), scope: kubeScope(t) }); return;
      case "restart": void approveAndRun({ title: say("restartWhat", { d: name }), command: kubeCmd.restart(t, name), scope: kubeScope(t) }); return;
      case "delete-pod": void approveAndRun({ title: say("deletePodWhat", { pod: name }), command: kubeCmd.deletePod(t, name), scope: kubeScope(t), destructive: true, confirmText: name }); return;
      case "undo": void approveAndRun({ title: say("undoWhat", { d: name, r: extra ?? "" }), command: kubeCmd.undo(t, name, Number(extra)), scope: kubeScope(t) }); return;
    }
  }
  async function scale(deployment: string): Promise<void> {
    const t = st.kube.target;
    if (!t) return;
    const v = await human.text(say("scalePh", { d: deployment }));
    if (v === null) return;
    const n = Number(v.trim());
    if (!Number.isInteger(n) || n < 0 || n > 500) { human.toast(say("badReplicas")); return; }
    await approveAndRun({ title: say("scaleWhat", { d: deployment, n }), command: kubeCmd.scale(t, deployment, n), scope: kubeScope(t) });
  }
  async function portForward(service: string): Promise<void> {
    const t = st.kube.target, svc = st.kube.state?.services.find((s) => s.name === service);
    if (!t || !svc) return;
    const remote = servicePort(svc.ports);
    const v = await human.text(say("portPh", { s: service, p: remote }), remote);
    if (v === null) return;
    const local = Number(v.trim());
    if (!Number.isInteger(local) || local < 1 || local > 65535) { human.toast(say("badPort")); return; }
    await approveAndRun({ title: say("portWhat", { s: service, l: local }), command: kubeCmd.portForward(t, service, local, remote), scope: kubeScope(t) });
  }
  function askPod(pod: string): void {
    const s = st.kube.state, p = s?.pods.find((x) => x.name === pod);
    if (!s || !p || !codev.available()) return;
    const evs = eventsFor(s.events, `pod/${pod}`).map((e) => `${e.kind} ${e.reason} ×${e.count}: ${e.message}`).join("\n");
    codev.ask({ intent: "explain", text: say("askPod"), context: [{ kind: "problem", label: `pod/${pod}`, text: `context ${s.context} · namespace ${s.namespace}\nphase ${p.phase} · ready ${p.ready} · restarts ${p.restarts}${p.reason ? ` · ${p.reason}` : ""}\n\nevents:\n${evs || "(none)"}` }], send: true });
  }

  /* ── Cloud ── */
  async function loadCloud(): Promise<void> {
    st.cloud.status = await ops.cloudStatus().catch(() => []);
    emit();
  }
  async function inventory(provider: string): Promise<void> {
    if (st.cloud.busy) return;
    st.cloud.busy = provider; emit();
    try { st.cloud.inventory[provider] = await ops.cloudInventory(provider); } catch (e) { st.cloud.inventory[provider] = { ok: false, provider, resources: [], commands: [], notes: msg(e) }; }
    st.cloud.busy = null; emit();
  }

  return {
    state: (): OpsState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    /** Everything the tab reads when it opens. */
    refresh: async (): Promise<void> => { await Promise.all([loadDirs(), loadKube(), loadCloud()]); },
    selectDir: (d: string) => { st.iac.dir = d; st.iac.plan = null; emit(); },
    plan, applyPlan, askPlan,
    toggleResource: (address: string) => { st.iac.open = st.iac.open === address ? null : address; emit(); },
    loadKube, history, kubeAction, scale, portForward, askPod,
    inventory,
  };
}

export type Ops = ReturnType<typeof makeOps>;
