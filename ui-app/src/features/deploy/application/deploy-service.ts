/* ═══════════ feature `deploy` — application: the guided deploy (r23 F4c2, docs/v2/AUDIT-r23.md §4.4 — D01–D04) ═══════════
   Target → Identity → Secrets → Preflight → Strategy → Approve → Rollout → Record. The plan comes from the backend
   (every check, what blocks, what can be waived); a waiver needs a reason; the deploy is the shared approval dialog
   with the exact commands (production: a reason and «production» typed); the backend checks the plan again, audits,
   rolls out (lines arrive as they come) and records it. No DOM, no window. */
import { stillBlocking } from "../domain/rules";
import type { DeployPlan, DeployRecord } from "../domain/types";
import type { DeployPort, HumanPort, WorldPort } from "./ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;

export interface DeployState {
  env: string | null;
  plan: DeployPlan | null;
  busy: "plan" | "rollout" | null;
  error: string | null;
  waivers: Record<string, string>;
  lines: string[];
  record: DeployRecord | null;
  /** the project's recent deploys (Environments' history, the wizard's Record) */
  recent: DeployRecord[];
  open: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

export function makeDeploy(deps: { deploy: DeployPort; world: WorldPort; human: HumanPort; say: Say }) {
  const { deploy, world, human, say } = deps;
  const st: DeployState = { env: null, plan: null, busy: null, error: null, waivers: {}, lines: [], record: null, recent: [], open: null };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  deploy.onOutput((id, line) => {
    if (st.plan && id === st.plan.id && st.busy === "rollout") { st.lines.push(line); emit(); }
  });

  async function loadRecent(): Promise<void> {
    const root = world.root();
    if (!root) { st.recent = []; emit(); return; }
    st.recent = await deploy.records(root, null).catch(() => st.recent);
    emit();
  }

  /** Plans a deploy to `env` (the wizard opens on it). */
  async function plan(env: string): Promise<void> {
    const root = world.root();
    if (!root || st.busy) return;
    Object.assign(st, { env, plan: null, busy: "plan", error: null, waivers: {}, lines: [], record: null, open: null });
    emit();
    try { st.plan = await deploy.plan(root, world.target(env)); }
    catch (e) { st.error = msg(e); }
    st.busy = null; emit();
  }
  function open(env: string): void { world.openTab(); void plan(env); }

  async function waive(gate: string): Promise<void> {
    const p = st.plan;
    if (!p || !p.waivable.includes(gate)) return;
    const why = await human.text(say("waivePh", { gate }), st.waivers[gate] ?? "");
    if (why === null) return;
    if (why.trim().length < 3) { human.toast(say("waiveNeedsReason")); return; }
    st.waivers = { ...st.waivers, [gate]: why.trim() };
    emit();
  }
  function unwaive(gate: string): void { const w = { ...st.waivers }; delete w[gate]; st.waivers = w; emit(); }

  /** The deploy: the shared dialog with the exact commands; the backend does the rest. */
  async function rollout(): Promise<void> {
    const p = st.plan, root = world.root();
    if (!p || !root || st.busy) return;
    if (stillBlocking(p, st.waivers).length) return;
    const prod = p.env === "production";
    const waived = Object.entries(st.waivers).filter(([g]) => p.waivable.includes(g));
    const d = await human.approve({
      title: say("approveWhat", { v: p.version.slice(0, 10), env: p.env }),
      command: p.commands.join("\n") + (waived.length ? `\n# ${say("waivedList", { l: waived.map(([g, r]) => `${g} (${r})`).join(", ") })}` : ""),
      scope: say("scope", { ctx: p.context, ns: p.namespace }),
      destructive: prod, reasonRequired: prod, confirmText: prod ? "production" : undefined,
    });
    if (!d.approved) return;
    st.busy = "rollout"; st.lines = []; st.error = null; emit();
    try {
      st.record = await deploy.rollout(root, p.id, prod ? "production" : null, d.reason || null, waived.map(([gate, reason]) => ({ gate, reason })));
      human.toast(say(st.record.ok ? "deployedOk" : "deployedFailed", { env: p.env, step: st.record.failedStep ?? "" }));
    } catch (e) { st.error = msg(e); }
    st.busy = null; emit();
    void loadRecent();
  }

  return {
    state: (): DeployState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    open, plan, waive, unwaive, rollout, loadRecent,
    toggle: (id: string) => { st.open = st.open === id ? null : id; emit(); },
    recent: (): DeployRecord[] => st.recent,
  };
}

export type Deploy = ReturnType<typeof makeDeploy>;
