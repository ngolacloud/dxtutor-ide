/* ═══════════ feature `scm` — application: staging part of a file (r23 F3, UI-SCM-10) ═══════════
   A changed file opens in the Source Control pane to its hunks — the ones not staged and the ones already in the
   index. Ticking one stages just it (`git_stage_hunks`), unticking takes it back out; afterwards both sides are
   read again and the pane/graph are told the index changed. Paths are the project's (relative to the open
   folder). No DOM, no window. */

import type { FileHunksData, HunksPort } from "./extras-ports";

export interface HunkEntry { unstaged: FileHunksData | null; staged: FileHunksData | null; busy: boolean; error: string | null }

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeHunks(deps: { git: HunksPort; root: () => string | null; changed: () => Promise<void> }) {
  const { git, root, changed } = deps;
  const open = new Map<string, HunkEntry>();
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  async function read(path: string): Promise<void> {
    const r = root(), e = open.get(path);
    if (!r || !e) return;
    try {
      const [unstaged, staged] = await Promise.all([git.hunks(r, path, false), git.hunks(r, path, true)]);
      Object.assign(e, { unstaged, staged, error: null });
    } catch (x) { e.error = msg(x); }
    emit();
  }

  async function move(path: string, id: string, unstage: boolean): Promise<void> {
    const r = root(), e = open.get(path);
    if (!r || !e || e.busy) return;
    e.busy = true; emit();
    try { await git.stageHunks(r, path, [id], unstage); e.error = null; }
    catch (x) { e.error = msg(x); }
    e.busy = false;
    await read(path);
    await changed();
  }

  return {
    entry: (path: string): HunkEntry | undefined => open.get(path),
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    /** opens or closes a file's hunks */
    toggle: async (path: string): Promise<void> => {
      if (open.has(path)) { open.delete(path); emit(); return; }
      open.set(path, { unstaged: null, staged: null, busy: false, error: null });
      emit();
      await read(path);
    },
    stage: (path: string, id: string): Promise<void> => move(path, id, false),
    unstage: (path: string, id: string): Promise<void> => move(path, id, true),
    /** the repository changed: read the open files again */
    refresh: async (): Promise<void> => { await Promise.all([...open.keys()].map(read)); },
    /** a staged hunk exists for this file (the pane shows it as partly staged) */
    partly: (path: string): boolean => !!open.get(path)?.staged?.hunks.length,
  };
}

export type Hunks = ReturnType<typeof makeHunks>;
