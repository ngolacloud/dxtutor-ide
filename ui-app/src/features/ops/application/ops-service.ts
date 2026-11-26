/* ═══════════ feature `ops` — application: the Ops tab (A9, docs/v2/UI-AUDIT.md item 10; r23 F4b) ═══════════
   State and use cases, read-only by default:
   - IaC (r23 F4b, docs/v2/AUDIT-r23.md §4.4): the pipeline (init → fmt → validate → rules → tflint → checkov
     → trivy → secrets in the state → plan → drift → conftest → infracost; a missing tool says «not installed»),
     the plan it made (modules, replacements, blast radius, write-only arguments, cost), the findings with
     risk acceptance (a reason, 30 days, audited by the backend), the drift (checked every 6 hours; revert,
     write it into the code, or ignore it with a reason), and the state (addresses and ids, the lock, the
     backup). Applying applies the REVIEWED plan file: the backend gives the command and refuses a blocked
     or changed plan; the human approves it, it runs in a terminal, and its result goes to the audit log.
   - Kubernetes: the namespace the Infra pane points at (pods, deployments, services, events, a
     deployment's revisions) and the real actions (logs, exec, port-forward, scale, restart, roll back,
     delete a pod), each one a command shown in full, approved, and run in a terminal.
   - Cloud: the official CLIs' status and a read-only inventory.
   - Co-Dev explains a plan or a failing pod, and proposes IaC changes as hunks (a fix, a drift written
     into the code, an `import` or a `moved` block).
   No DOM, no window. */

import { DRIFT_EVERY_MS, driftKey, eventsFor, findingLabel, forceUnlock, importDraft, isAddress, kubeCmd, movedDraft, planText, securityFindings, servicePort } from "../domain/commands";
import type { DataSource, Runbook, StepRun } from "../domain/types";
import type { AcceptedRisk, CloudCli, CloudInventory, IacFinding, IacPlan, IacState, KubeState, KubeTarget, PipelineRun, Revision, Stage } from "../domain/types";
import type { ApprovalRequest, AuditPort, CodevPort, HumanPort, OpsPort, OpsWorld } from "./ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;

export type IacTab = "pipeline" | "plan" | "security" | "drift" | "state";

export interface OpsState {
  iac: {
    dirs: string[] | null; dir: string | null; tab: IacTab; open: string | null;
    /** the last pipeline run of the folder, and the stages of the one in flight */
    run: PipelineRun | null; live: Stage[] | null; busy: boolean;
    /** a risk was accepted or revoked after the run: run it again for the apply to see it */
    staleRisks: boolean;
    /** the last apply of a reviewed plan and its exit code */
    applied: { id: string; code: number } | null;
    risks: AcceptedRisk[];
    drift: { plan: IacPlan | null; at: number | null; busy: boolean };
    state: { data: IacState | null; busy: boolean };
  };
  kube: { target: KubeTarget | null; state: KubeState | null; busy: boolean; history: { deployment: string; revisions: Revision[] } | null };
  cloud: { status: CloudCli[] | null; inventory: Record<string, CloudInventory>; busy: string | null };
  /** the last command sent to a terminal */
  ran: string | null;
  /** r23 F5a: runbooks as code (the selected one, the current run's results by step, its past runs) */
  rb: { list: Runbook[] | null; sel: string | null; runId: string | null; results: Record<number, StepRun>; busy: number | null; history: StepRun[] };
  sources: DataSource[] | null;
  evidence: { busy: boolean; last: string | null };
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

export function makeOps(deps: { ops: OpsPort; world: OpsWorld; human: HumanPort; audit: AuditPort; codev: CodevPort; say: Say }) {
  const { ops, world, human, audit, codev, say } = deps;
  const freshIac = (dirs: string[] | null = null, dir: string | null = null): OpsState["iac"] => ({
    dirs, dir, tab: "pipeline", open: null, run: null, live: null, busy: false, staleRisks: false, applied: null, risks: [],
    drift: { plan: null, at: null, busy: false }, state: { data: null, busy: false },
  });
  const st: OpsState = {
    iac: freshIac(), kube: { target: null, state: null, busy: false, history: null }, cloud: { status: null, inventory: {}, busy: null }, ran: null,
    rb: { list: null, sel: null, runId: null, results: {}, busy: null, history: [] }, sources: null, evidence: { busy: false, last: null },
  };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  /** The one way anything changes: the exact command, where it runs, the human's yes, the audit log, a
   *  terminal. A refusal is audited too; an approval that cannot be audited does not run (r23 F1). When the
   *  terminal says how it ended, that goes to the audit log as well. */
  async function approveAndRun(action: string, r: ApprovalRequest & { scope: string }): Promise<number | null> {
    const d = await human.approve(r);
    const row = { action, command: r.command, scope: r.scope, approved: d.approved, reason: d.reason, decidedAt: d.decidedAt };
    if (!d.approved) { void audit.record(row).catch(() => undefined); return null; }
    try { await audit.record({ ...row, outcome: "sent" }); } catch (e) { human.toast(say("notAudited", { e: msg(e) })); return null; }
    const cmd = r.command;
    const done = world.runInTerminal(cmd);
    st.ran = cmd;
    emit();
    const code = await done;
    if (typeof code !== "number") return null;
    void audit.record({ ...row, outcome: code === 0 ? "ok" : "failed" }).catch(() => undefined);
    return code;
  }

  const kubeScope = (t: KubeTarget): string => say("scopeKube", { c: t.context, n: t.namespace });
  const iacScope = (dir: string, tool: string): string => say("scopeIac", { dir, tool });
  const canAsk = (): boolean => { if (codev.available()) return true; human.toast(say("noCodev")); return false; };

  /* ── IaC ── */
  let stopDrift: (() => void) | null = null;
  async function loadDirs(): Promise<void> {
    const root = world.root();
    if (!root) return;
    st.iac.dirs = await ops.iacDirs(root).catch(() => []);
    if (!st.iac.dir && st.iac.dirs.length) st.iac.dir = st.iac.dirs[0];
    if (st.iac.dirs.length && !stopDrift) stopDrift = world.every(DRIFT_EVERY_MS, () => { void checkDrift(true); });
    emit();
  }
  async function loadRisks(): Promise<void> {
    const root = world.root();
    if (!root) return;
    st.iac.risks = await ops.risks(root).catch(() => st.iac.risks);
    emit();
  }

  ops.onStage((e) => {
    const i = st.iac;
    if (!i.busy || !i.live || e.root !== world.root() || e.dir !== i.dir) return;
    const at = i.live.findIndex((s) => s.id === e.stage.id);
    if (at >= 0) i.live[at] = e.stage; else i.live.push(e.stage);
    emit();
  });

  /** Runs the pipeline in the folder (`target`: a targeted plan, to revert one drifted resource). */
  async function runPipeline(target: string | null = null): Promise<void> {
    const root = world.root(), dir = st.iac.dir;
    if (!root || !dir || st.iac.busy) return;
    Object.assign(st.iac, { busy: true, live: [], tab: "pipeline" as IacTab, open: null, applied: null });
    emit();
    try { st.iac.run = await ops.pipeline(root, dir, target); }
    catch (e) { st.iac.run = { id: "", tool: "", dir, target, stages: [], plan: null, blocked: true, blockers: [], notes: msg(e) }; }
    Object.assign(st.iac, { busy: false, live: null, staleRisks: false });
    emit();
    void loadRisks();
  }

  /** Applies the reviewed plan: the backend's command (refused there when blocked or changed), approved,
   *  audited, run in a terminal, and its result audited. */
  async function applyRun(): Promise<void> {
    const r = st.iac.run, root = world.root();
    if (!r || !root || !r.id || r.blocked || !r.plan?.changes.length) return;
    let info;
    try { info = await ops.applyCommand(root, r.dir, r.id); }
    catch (e) { human.toast(say("applyRefused", { e: msg(e) })); return; }
    const destroys = info.destroy > 0;
    const code = await approveAndRun("iac.apply", { title: say("applyWhat", { n: r.plan.changes.length, dir: r.dir }), command: info.command, scope: iacScope(r.dir, info.tool), destructive: destroys, confirmText: destroys ? r.dir : undefined });
    if (code === null) return;
    st.iac.applied = { id: r.id, code };
    emit();
    if (code === 0) { st.iac.state.data = null; void loadState(); }
  }

  function askPlan(intent: "explain" | "change"): void {
    const p = st.iac.run?.plan;
    if (!p || !canAsk()) return;
    codev.ask({ intent, text: say(intent === "explain" ? "askPlanText" : "askIacText"), context: [{ kind: "problem", label: `${p.tool} plan · ${p.dir}`, text: planText(p), path: p.dir === "." ? undefined : p.dir }], send: intent === "explain" });
  }

  const finding = (key: string): IacFinding | undefined => st.iac.run?.stages.flatMap((s) => s.findings).find((f) => f.key === key);

  async function accept(key: string, kind: "finding" | "drift", label: string, detail: string): Promise<void> {
    const root = world.root();
    if (!root) return;
    const d = await human.approve({ title: say(kind === "drift" ? "ignoreWhat" : "acceptWhat", { what: label }), command: detail, scope: say("acceptScope"), reasonRequired: true });
    if (!d.approved) return;
    try { await ops.acceptRisk(root, { key, kind, label, reason: d.reason }); }
    catch (e) { human.toast(say("acceptFailed", { e: msg(e) })); return; }
    for (const f of st.iac.run?.stages.flatMap((s) => s.findings) ?? []) if (f.key === key) f.accepted = true;
    st.iac.staleRisks = true;
    await loadRisks();
  }
  async function acceptFinding(key: string): Promise<void> {
    const f = finding(key);
    if (f) await accept(f.key, f.source === "drift" ? "drift" : "finding", findingLabel(f), f.message);
  }
  async function revokeRisk(id: number): Promise<void> {
    const root = world.root();
    if (!root) return;
    try { await ops.revokeRisk(root, id); } catch (e) { human.toast(msg(e)); return; }
    const gone = st.iac.risks.find((r) => r.id === id);
    for (const f of st.iac.run?.stages.flatMap((s) => s.findings) ?? []) if (gone && f.key === gone.key) f.accepted = false;
    st.iac.staleRisks = true;
    await loadRisks();
  }
  function openFinding(key: string): void {
    const f = finding(key);
    if (f && /\.(tf|tfvars|hcl|json)$/.test(f.file)) world.openFile(f.file, f.line || 1);
  }
  function fixFinding(key: string): void {
    const f = finding(key);
    if (!f || !canAsk()) return;
    if (/\.(tf|tfvars|hcl)$/.test(f.file)) world.openFile(f.file, f.line || 1);
    codev.ask({ intent: "change", text: say("askFix"), context: [{ kind: "problem", label: findingLabel(f), text: f.message, path: f.file }] });
  }

  /* drift: a refresh-only plan, by hand or every 6 hours */
  async function checkDrift(scheduled = false): Promise<void> {
    const root = world.root(), dir = st.iac.dir, d = st.iac.drift;
    if (!root || !dir || d.busy) return;
    d.busy = true; emit();
    try { d.plan = await ops.iacPlan(root, dir, true); }
    catch (e) { d.plan = { ok: false, tool: "", dir, refreshOnly: true, add: 0, change: 0, destroy: 0, changes: [], drift: [], notes: msg(e) }; }
    d.at = world.now(); d.busy = false;
    emit();
    if (scheduled && d.plan.ok && d.plan.drift.length) human.toast(say("driftFound", { n: d.plan.drift.length, dir }));
  }
  /** The drifted resources: from the last drift check, else from the last pipeline's plan. */
  const drifted = () => st.iac.drift.plan?.drift ?? st.iac.run?.plan?.drift ?? [];
  function driftRevert(address: string): void { void runPipeline(address); }
  function driftToCode(address: string): void {
    const c = drifted().find((x) => x.address === address), dir = st.iac.dir;
    if (!c || !dir || !canAsk()) return;
    const text = `${c.action} ${c.address} (changed outside the code)\n${c.attrs.map((a) => `  ${a.name}: ${a.before ?? "∅"} → ${a.after ?? "∅"}`).join("\n")}`;
    codev.ask({ intent: "change", text: say("askDrift"), context: [{ kind: "problem", label: `drift · ${address}`, text, path: dir === "." ? undefined : dir }] });
  }
  async function driftIgnore(address: string): Promise<void> {
    const dir = st.iac.dir;
    if (dir) await accept(driftKey(dir, address), "drift", `drift · ${address} · ${dir}`, say("driftDetail", { a: address }));
  }

  /* state */
  async function loadState(): Promise<void> {
    const root = world.root(), dir = st.iac.dir, s = st.iac.state;
    if (!root || !dir || s.busy) return;
    s.busy = true; emit();
    try { s.data = await ops.iacState(root, dir); }
    catch (e) { s.data = { ok: false, tool: "", dir, backend: "", serial: null, lineage: null, resources: [], lock: null, lockReadable: false, backupSerial: null, notes: msg(e) }; }
    s.busy = false; emit();
  }
  function unlock(): void {
    const s = st.iac.state.data;
    if (!s?.lock) return;
    void approveAndRun("iac.force-unlock", { title: say("unlockWhat", { dir: s.dir, who: s.lock.who }), command: forceUnlock(s.tool, s.dir, s.lock.id), scope: iacScope(s.dir, s.tool), destructive: true, confirmText: s.dir }).then((code) => { if (code === 0) void loadState(); });
  }
  async function moveResource(address: string): Promise<void> {
    const dir = st.iac.dir;
    if (!dir || !codev.available()) { canAsk(); return; }
    const to = await human.text(say("movePh", { a: address }), address);
    if (to === null) return;
    if (!isAddress(to) || to.trim() === address) { human.toast(say("badAddress")); return; }
    codev.ask({ intent: "change", text: say("askMove", { from: address, to: to.trim() }), context: [{ kind: "file", label: "moved", text: movedDraft(address, to.trim()), path: dir === "." ? undefined : dir }] });
  }
  async function importResource(): Promise<void> {
    const dir = st.iac.dir;
    if (!dir || !codev.available()) { canAsk(); return; }
    const a = await human.text(say("importAddrPh"));
    if (a === null) return;
    if (!isAddress(a)) { human.toast(say("badAddress")); return; }
    const id = await human.text(say("importIdPh", { a: a.trim() }));
    if (id === null || !id.trim()) return;
    codev.ask({ intent: "change", text: say("askImport", { a: a.trim() }), context: [{ kind: "file", label: "import", text: importDraft(a.trim(), id.trim()), path: dir === "." ? undefined : dir }] });
  }

  function selectDir(d: string): void {
    st.iac = { ...freshIac(st.iac.dirs, d), risks: st.iac.risks, tab: st.iac.tab };
    emit();
    if (st.iac.tab === "state") void loadState();
  }
  function setTab(tab: IacTab): void {
    st.iac.tab = tab;
    emit();
    if (tab === "state" && !st.iac.state.data) void loadState();
  }

  /* ── r23 F5a: runbooks as code ── */
  const selected = (): Runbook | null => st.rb.list?.find((r) => r.path === st.rb.sel) ?? null;
  async function loadRunbooks(): Promise<void> {
    const root = world.root();
    if (!root) return;
    st.rb.list = await ops.runbooks(root).catch(() => []);
    if ((!st.rb.sel || !selected()) && st.rb.list.length) { st.rb.sel = st.rb.list[0].path; void loadHistory(); }
    emit();
  }
  async function loadHistory(): Promise<void> {
    const root = world.root(), p = st.rb.sel;
    if (!root || !p) return;
    st.rb.history = await ops.runs(root, p).catch(() => []);
    emit();
  }
  function selectRunbook(path: string): void {
    Object.assign(st.rb, { sel: path, runId: null, results: {}, history: [] });
    emit();
    void loadHistory();
  }
  function newRun(): void { st.rb.runId = null; st.rb.results = {}; emit(); }
  /** Runs (or decides) step `n`: a check straight away (the backend refuses one that is not read-only); an action after
   *  the approval with the exact command and a reason (audited in Rust), with Vault's environment for that step only. */
  async function runStep(n: number): Promise<void> {
    const root = world.root(), rb = selected(), step = rb?.steps.find((s) => s.n === n);
    if (!root || !rb || !step || st.rb.busy !== null) return;
    const runId = st.rb.runId ?? `run-${world.now()}`;
    let approval: { reason: string } | null = null, note: string | null = null;
    const vault = world.vault();
    if (step.kind === "action") {
      const d = await human.approve({ title: say("rbActionWhat", { n, t: step.title }), command: step.command + (vault ? `\n# ${say("rbVaultEnv")}` : ""), scope: say("rbScope", { p: rb.path }), reasonRequired: true });
      if (!d.approved) return;
      approval = { reason: d.reason };
    } else if (step.kind === "decision") {
      note = await human.text(say("rbDecidePh", { t: step.title }));
      if (note === null || note.trim().length < 3) return;
    }
    st.rb.runId = runId; st.rb.busy = n; emit();
    try {
      const r = step.kind === "decision" ? await ops.decide(root, rb.path, n, runId, note!) : await ops.runStep(root, rb.path, n, runId, approval, step.kind === "action" ? vault : null);
      st.rb.results = { ...st.rb.results, [n]: r };
    } catch (e) { human.toast(say("rbRefused", { e: msg(e) })); }
    st.rb.busy = null; emit();
    void loadHistory();
  }
  /** The person judges a result against a prose expectation. */
  async function judge(n: number, matched: boolean): Promise<void> {
    const root = world.root(), r = st.rb.results[n];
    if (!root || !r) return;
    const note = await human.text(say("rbJudgePh"), "");
    if (note === null) return;
    try { await ops.judge(root, r.id, matched, note); st.rb.results = { ...st.rb.results, [n]: { ...r, matched, note } }; emit(); }
    catch (e) { human.toast(msg(e)); }
  }
  /** Co-Dev comments an output and suggests the next step (a proposal; it runs nothing). */
  function askStep(n: number): void {
    const rb = selected(), r = st.rb.results[n];
    if (!rb || !r || !canAsk()) return;
    const next = rb.steps.find((s) => s.n === n + 1);
    codev.ask({ intent: "explain", text: say("rbAsk"), context: [{ kind: "problem", label: `${rb.path} · step ${n}`, text: `step ${n} [${r.kind}] ${r.title}\n$ ${r.command}\nexit ${r.exitCode ?? "-"} · expect: ${r.expect}\n\n${r.output.slice(-4000)}${next ? `\n\nnext: step ${next.n} [${next.kind}] ${next.title}` : ""}`, path: rb.path }], send: true });
  }
  function editRunbook(): void { const p = st.rb.sel; if (p) world.openFile(p, 1); }

  /* ── r23 F5a: data sources and the evidence ── */
  async function loadSources(): Promise<void> {
    const root = world.root();
    if (!root) return;
    st.sources = await ops.sources(root).catch(() => []);
    emit();
  }
  async function exportEvidence(): Promise<void> {
    const root = world.root();
    if (!root || st.evidence.busy) return;
    st.evidence.busy = true; emit();
    try {
      const f = await ops.exportEvidence(root);
      st.evidence.last = f.path;
      world.showFile(f.path, f.content);
      human.toast(say("evidenceDone", { p: f.path }));
    } catch (e) { human.toast(say("evidenceFailed", { e: msg(e) })); }
    st.evidence.busy = false; emit();
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
      case "exec": void approveAndRun("kube.exec", { title: say("execWhat", { pod: name }), command: kubeCmd.exec(t, name), scope: kubeScope(t) }); return;
      case "restart": void approveAndRun("kube.restart", { title: say("restartWhat", { d: name }), command: kubeCmd.restart(t, name), scope: kubeScope(t) }); return;
      case "delete-pod": void approveAndRun("kube.delete-pod", { title: say("deletePodWhat", { pod: name }), command: kubeCmd.deletePod(t, name), scope: kubeScope(t), destructive: true, confirmText: name }); return;
      case "undo": void approveAndRun("kube.undo", { title: say("undoWhat", { d: name, r: extra ?? "" }), command: kubeCmd.undo(t, name, Number(extra)), scope: kubeScope(t) }); return;
    }
  }
  async function scale(deployment: string): Promise<void> {
    const t = st.kube.target;
    if (!t) return;
    const v = await human.text(say("scalePh", { d: deployment }));
    if (v === null) return;
    const n = Number(v.trim());
    if (!Number.isInteger(n) || n < 0 || n > 500) { human.toast(say("badReplicas")); return; }
    await approveAndRun("kube.scale", { title: say("scaleWhat", { d: deployment, n }), command: kubeCmd.scale(t, deployment, n), scope: kubeScope(t) });
  }
  async function portForward(service: string): Promise<void> {
    const t = st.kube.target, svc = st.kube.state?.services.find((s) => s.name === service);
    if (!t || !svc) return;
    const remote = servicePort(svc.ports);
    const v = await human.text(say("portPh", { s: service, p: remote }), remote);
    if (v === null) return;
    const local = Number(v.trim());
    if (!Number.isInteger(local) || local < 1 || local > 65535) { human.toast(say("badPort")); return; }
    await approveAndRun("kube.port-forward", { title: say("portWhat", { s: service, l: local }), command: kubeCmd.portForward(t, service, local, remote), scope: kubeScope(t) });
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
    refresh: async (): Promise<void> => { await Promise.all([loadDirs(), loadKube(), loadCloud(), loadRisks(), loadRunbooks(), loadSources()]); },
    loadRunbooks, selectRunbook, newRun, runStep, judge, askStep, editRunbook, loadSources, exportEvidence,
    selectDir, setTab,
    runPipeline, applyRun, askPlan,
    acceptFinding, revokeRisk, openFinding, fixFinding,
    checkDrift, driftRevert, driftToCode, driftIgnore,
    loadState, unlock, moveResource, importResource,
    /** the findings the «Security & policy» tab lists */
    security: (): IacFinding[] => securityFindings(st.iac.run),
    drifted,
    toggleResource: (address: string) => { st.iac.open = st.iac.open === address ? null : address; emit(); },
    /** Another folder opened: what was read of the last one goes (and its drift schedule). */
    workspaceChanged: (): void => {
      stopDrift?.(); stopDrift = null; st.iac = freshIac();
      st.rb = { list: null, sel: null, runId: null, results: {}, busy: null, history: [] }; st.sources = null; st.evidence = { busy: false, last: null };
      emit();
    },
    loadKube, history, kubeAction, scale, portForward, askPod,
    inventory,
  };
}

export type Ops = ReturnType<typeof makeOps>;
