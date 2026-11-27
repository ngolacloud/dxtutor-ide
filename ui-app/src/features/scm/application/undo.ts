/* ═══════════ feature `scm` — application: undo for git (r23 F3, UI-SCM-12) ═══════════
   Before each operation (commit, checkout, merge, gitflow finish, stash, amend, discard) the state is snapshot
   by the backend. Undoing one shows the exact git commands in the shared approval dialog, is audited before it
   runs (not auditable: not run) and with its result, and snapshots the present first — so an undo is undoable
   too. No DOM, no window. */

import type { UndoEntryData, UndoPort } from "./extras-ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;
export interface ApprovalRequest { title: string; command: string; scope?: string; destructive?: boolean }
export interface ApprovalDecision { approved: boolean; reason: string; decidedAt: number }
export interface UndoAudit {
  record(root: string, e: { action: string; command: string; scope: string; approved: boolean; reason: string; decidedAt: number; outcome?: "sent" | "ok" | "failed" }): Promise<void>;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeUndo(deps: {
  git: UndoPort; root: () => string | null; changed: () => Promise<void>;
  human: { approve(r: ApprovalRequest): Promise<ApprovalDecision>; toast(m: string): void };
  audit: UndoAudit; say: Say;
}) {
  const { git, root, changed, human, audit, say } = deps;
  let entries: UndoEntryData[] = [];
  let busy = false;
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function refresh(): Promise<void> {
    const r = root();
    const l = r ? await git.list(r).catch(() => entries) : [];
    entries = Array.isArray(l) ? l : [];
    emit();
  }

  /** Snapshots before `label` (desktop repository only). Never blocks the operation: a failure is reported. */
  async function snapshot(label: string): Promise<void> {
    const r = root();
    if (!r) return;
    try { await git.snapshot(r, label); } catch (e) { human.toast(say("undoSnapFailed", { e: msg(e) })); return; }
    void refresh();
  }

  async function undo(id: number): Promise<boolean> {
    const r = root();
    if (!r || busy) return false;
    let plan;
    try { plan = await git.plan(r, id); } catch (e) { human.toast(msg(e)); return false; }
    const scope = say("undoScope", { id, head: plan.entry.head ?? (plan.entry.headSha ?? "").slice(0, 7) });
    const d = await human.approve({ title: say("undoTitle", { label: plan.entry.label }), command: plan.display, scope, destructive: true });
    const row = { action: "git.undo", command: plan.display, scope, approved: d.approved, reason: d.reason, decidedAt: d.decidedAt };
    if (!d.approved) { void audit.record(r, row).catch(() => undefined); return false; }
    try { await audit.record(r, { ...row, outcome: "sent" }); } catch (e) { human.toast(say("notAudited", { e: msg(e) })); return false; }
    busy = true; emit();
    try {
      const before = await git.restore(r, id);
      void audit.record(r, { ...row, outcome: "ok" }).catch(() => undefined);
      human.toast(say("undoDone", { label: plan.entry.label, id: before.id }));
      return true;
    } catch (e) {
      void audit.record(r, { ...row, outcome: "failed" }).catch(() => undefined);
      human.toast(say("undoFailed", { e: msg(e) }));
      return false;
    } finally {
      busy = false;
      await changed();
      await refresh();
    }
  }

  return {
    entries: (): UndoEntryData[] => entries,
    busy: (): boolean => busy,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    refresh, snapshot, undo,
    /** undoes the newest snapshot */
    undoLast: async (): Promise<boolean> => { await refresh(); const e = entries[0]; if (!e) { human.toast(say("undoNone")); return false; } return undo(e.id); },
  };
}

export type Undo = ReturnType<typeof makeUndo>;
