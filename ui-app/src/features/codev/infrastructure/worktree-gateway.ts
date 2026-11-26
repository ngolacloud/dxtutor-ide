/* ═══════════ Co-Dev — adaptador: as worktrees e as reservas do Co-Dev (Multi Co-Dev, fase 3) ═══════════
   A porta `WorktreeGateway` sobre o cliente tipado `platform/tauri/codev-worktree`; as respostas estreitam-se
   no domínio (`domain/worktrees.ts`). Não toca no `window` (regra A8). */

import * as ipc from "../../../platform/tauri/codev-worktree";
import type { WorktreeGateway } from "../application/worktrees";
import { parseClaims, parseFile, parseInfo, parseListed, parsePlan } from "../domain/worktrees";

function must<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`resposta inválida do backend (${what})`);
  return v;
}

export const worktreeGateway: WorktreeGateway = {
  plan: async (root, key) => must(parsePlan(await ipc.worktreePlan(root, key)), "codev_worktree_plan"),
  create: async (root, key, command, decidedAt) => must(parseInfo(await ipc.worktreeCreate(root, key, command, decidedAt)), "codev_worktree_create"),
  list: async (root) => must(parseListed(await ipc.worktreeList(root)), "codev_worktrees"),
  remove: async (root, key, command, decidedAt) => {
    const r = (await ipc.worktreeRemove(root, key, command, decidedAt)) as { removed?: unknown; dirty?: unknown } | null;
    return { removed: r?.removed === true, dirty: Array.isArray(r?.dirty) ? r!.dirty.filter((x): x is string => typeof x === "string") : [] };
  },
  file: async (root, key, path) => must(parseFile(await ipc.worktreeFile(root, key, path)), "codev_worktree_file"),
  commit: (root, key, message) => ipc.worktreeCommit(root, key, message),
  claims: async (root) => must(parseClaims(await ipc.fileClaims(root)), "codev_claims"),
};
