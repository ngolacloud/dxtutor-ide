/* ═══════════ feature `welcome` — application: the Welcome page and the walkthroughs (r23 F6) ═══════════
   - Recent: the real folder history (never fake folders; in the browser, none).
   - Clone: a URL and a parent folder → the backend builds the exact command → approval → audit → clone →
     open the new folder. A refusal is audited; an approval that cannot be audited does not run.
   - Walkthroughs: progress per viewer, «new» until opened, «mark done».
   No DOM, no window. */

import { currentStep, markDone, markOpened, parseState, progressOf, setShow, type WelcomeState } from "../domain/progress";
import { defaultCloneParent, recentEntries, type RecentEntry } from "../domain/recent";
import { walkthrough, WALKTHROUGHS } from "../domain/walkthroughs";
import type { AuditPort, GitPort, HumanPort, StatePort, WorkspacePort } from "./ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeWelcome(deps: { workspace: WorkspacePort; git: GitPort; human: HumanPort; audit: AuditPort; store: StatePort; say: Say }) {
  const { workspace, git, human, audit, store, say } = deps;
  let st: WelcomeState = parseState(store.load());
  /** the step shown in each open walkthrough tab */
  const sel: Record<string, number> = {};
  let cloning = false;
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };
  const save = (next: WelcomeState): void => { st = next; store.save(st); emit(); };

  const recent = (max?: number): RecentEntry[] => (workspace.desktop() ? recentEntries(workspace.recent(), max) : []);

  async function clone(): Promise<string | null> {
    if (!workspace.desktop() || cloning) return null;
    const url = await human.text(say("cloneUrlPh"));
    if (!url || !url.trim()) return null;
    const parent = await human.text(say("cloneParentPh"), defaultCloneParent(recent(), workspace.home()));
    if (!parent || !parent.trim()) return null;
    let plan;
    try { plan = await git.clonePlan(url.trim(), parent.trim()); } catch (e) { human.toast(say("cloneBad", { e: msg(e) })); return null; }
    if (plan.exists) { human.toast(say("cloneExists", { target: plan.target })); return null; }
    const d = await human.approve({ title: say("cloneTitle", { name: plan.name }), command: plan.command, scope: say("cloneScope", { target: plan.target }) });
    const row = { action: "git.clone", command: plan.command, scope: plan.target, approved: d.approved, reason: d.reason, decidedAt: d.decidedAt };
    if (!d.approved) { void audit.record(plan.target, row).catch(() => undefined); return null; }
    try { await audit.record(plan.target, { ...row, outcome: "sent" }); } catch (e) { human.toast(say("notAudited", { e: msg(e) })); return null; }
    cloning = true; emit();
    human.toast(say("cloning", { url: plan.url }));
    try {
      const path = await git.clone(plan.url, plan.parent);
      void audit.record(plan.target, { ...row, outcome: "ok" }).catch(() => undefined);
      await workspace.open(path);
      return path;
    } catch (e) {
      void audit.record(plan.target, { ...row, outcome: "failed" }).catch(() => undefined);
      human.toast(say("cloneFailed", { e: msg(e) }));
      return null;
    } finally { cloning = false; emit(); }
  }

  return {
    state: (): WelcomeState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    desktop: (): boolean => workspace.desktop(),
    cloning: (): boolean => cloning,
    recent,
    openRecent: (path: string): Promise<void> => workspace.open(path),
    openFolder: (): Promise<void> => workspace.open(),
    clone,
    setShow: (show: boolean): void => save(setShow(st, show)),
    walkthroughs: () => WALKTHROUGHS.map((w) => ({ w, progress: progressOf(st, w), fresh: !st.opened.includes(w.id) })),
    /** opens a walkthrough on its first step not done */
    openWalk: (id: string): void => {
      const w = walkthrough(id);
      if (!w) return;
      sel[id] = currentStep(st, w);
      save(markOpened(st, id));
    },
    selected: (id: string): number => sel[id] ?? 0,
    select: (id: string, i: number): void => { sel[id] = i; emit(); },
    /** marks the step done and moves to the next one */
    done: (id: string, step: string): void => {
      const w = walkthrough(id);
      if (!w) return;
      const next = markDone(st, id, step);
      const i = w.steps.findIndex((s) => s.id === step);
      if (i >= 0 && i < w.steps.length - 1) sel[id] = i + 1;
      save(next);
    },
  };
}

export type Welcome = ReturnType<typeof makeWelcome>;
