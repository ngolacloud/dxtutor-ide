/* ═══════════ Co-Dev — use case: the harness view (docs/v2/UI-AUDIT.md item 11, phase A3) ═══════════
   What the «Co-Dev run» tab shows and does: the run of the agent (plan with files and lines,
   tasks, sub-agents, context used, the last turn's report — folded from the real events), the
   session's checkpoints with «Rewind to here» (files, or files and conversation), the
   project's permission rules (the same `.dxtutor/permissions.json` the approvals write) and
   the project's MCP servers, hooks, commands and skills. No DOM, no window. */

import type { AgentGateway } from "./ports";
import type { AgentEvent, Checkpoint, ExtensionsStatus, Permissions } from "../domain/agent-events";
import { initialRun, reduceRun, turnStarted, type RunState } from "../domain/run-state";

export interface HarnessDeps {
  gateway: Pick<AgentGateway, "available" | "checkpoints" | "rewind" | "permissions" | "savePermissions" | "extensions" | "trust">;
  /** The open agent session, if any. */
  session(): string | null;
  root(): string;
  reloadFromDisk(): Promise<void>;
  /** Opens a project file (relative path) at a line. */
  open(path: string, line?: number): void;
  confirm(message: string): boolean;
  notify(message: string): void;
}

export interface HarnessState {
  run: RunState;
  checkpoints: Checkpoint[];
  permissions: Permissions | null;
  extensions: ExtensionsStatus | null;
  available: boolean;
}

export function makeHarness(deps: HarnessDeps) {
  let st: HarnessState = { run: initialRun(), checkpoints: [], permissions: null, extensions: null, available: false };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<HarnessState>): void => {
    st = { ...st, ...patch };
    listeners.forEach((f) => f());
  };
  const err = (e: unknown): void => deps.notify(e instanceof Error ? e.message : String(e));

  async function refreshCheckpoints(): Promise<void> {
    const s = deps.session();
    if (!s) return set({ checkpoints: [] });
    try {
      set({ checkpoints: await deps.gateway.checkpoints(s) });
    } catch (e) {
      err(e);
    }
  }

  async function refresh(): Promise<void> {
    const available = deps.gateway.available();
    set({ available });
    if (!available) return;
    const root = deps.root();
    await Promise.all([
      refreshCheckpoints(),
      deps.gateway.permissions(root).then((p) => set({ permissions: p }), err),
      deps.gateway.extensions(root).then((x) => set({ extensions: x }), err),
    ]);
  }

  return {
    state: (): HarnessState => st,
    onChange(f: () => void): () => void {
      listeners.add(f);
      return () => listeners.delete(f);
    },
    event(_s: string, e: AgentEvent): void {
      set({ run: reduceRun(st.run, e) });
      if (e.kind === "checkpoint" || e.kind === "done") void refreshCheckpoints();
    },
    turnStarted(): void {
      set({ run: turnStarted(st.run) });
    },
    refresh,
    /** «Rewind to here»: the files (and with `conversation`, the conversation) go back. */
    async rewind(id: number, conversation: boolean): Promise<void> {
      const s = deps.session();
      if (!s) return;
      const what = conversation ? "os ficheiros e a conversa" : "os ficheiros";
      if (!deps.confirm(`Voltar ${what} ao checkpoint #${id}? O que mudou depois desse pedido deixa de estar no disco.`)) return;
      try {
        const msg = await deps.gateway.rewind(s, id, conversation);
        await deps.reloadFromDisk().catch(() => undefined);
        deps.notify(msg.charAt(0).toUpperCase() + msg.slice(1));
        await refreshCheckpoints();
      } catch (e) {
        err(e);
      }
    },
    /** Saves the project's rules (one per line in the panel) and applies them to open sessions. */
    async savePermissions(allow: string[], deny: string[]): Promise<void> {
      const clean = (v: string[]) => v.map((r) => r.trim()).filter(Boolean);
      try {
        await deps.gateway.savePermissions(deps.root(), { allow: clean(allow), deny: clean(deny) });
        set({ permissions: await deps.gateway.permissions(deps.root()) });
        deps.notify("Permissões gravadas em .dxtutor/permissions.json");
      } catch (e) {
        err(e);
      }
    },
    async trust(kind: "hooks" | "mcp"): Promise<void> {
      if (!deps.confirm(kind === "hooks" ? "Confiar nos hooks do projecto? Correm comandos definidos pelo repositório." : "Confiar nos servidores MCP do projecto? Correm comandos definidos pelo repositório.")) return;
      try {
        await deps.gateway.trust(deps.root(), kind);
        set({ extensions: await deps.gateway.extensions(deps.root()) });
        deps.notify("Confiado. Vale a partir da próxima conversa.");
      } catch (e) {
        err(e);
      }
    },
    open: (path: string, line?: number): void => deps.open(path, line),
  };
}

export type HarnessUseCase = ReturnType<typeof makeHarness>;
