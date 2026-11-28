/* ═══════════ Co-Dev — use case: the harness view (docs/v2/UI-AUDIT.md item 11, phase A3) ═══════════
   What the «Co-Dev run» tab shows and does: the run of the agent (plan with files and lines,
   tasks, sub-agents, context used, the last turn's report — folded from the real events), the
   session's checkpoints with «Rewind to here» (files, or files and conversation), the
   project's permission rules (the same `.dxtutor/permissions.json` the approvals write) and
   the project's MCP servers, hooks, commands and skills. No DOM, no window. */

import type { AgentGateway } from "./ports";
import type { AgentEvent, Checkpoint, ExtensionsStatus, McpPendingChange, Permissions } from "../domain/agent-events";
import { initialRun, reduceRun, turnStarted, type RunState } from "../domain/run-state";
import { ptCopy, type CodevCopy } from "./messages";

export interface HarnessDeps {
  gateway: Pick<AgentGateway, "available" | "checkpoints" | "rewind" | "permissions" | "savePermissions" | "extensions" | "trust" | "mcpSignIn" | "mcpSignOut" | "mcpApproveTool">;
  /** The open agent session, if any. */
  session(): string | null;
  root(): string;
  reloadFromDisk(): Promise<void>;
  /** Opens a project file (relative path) at a line. */
  open(path: string, line?: number): void;
  confirm(message: string): boolean;
  notify(message: string): void;
  /** Os textos para o humano na língua da interface (`./messages`); sem ela, os de antes (português). */
  copy?: CodevCopy;
  /** The shared approval dialog (`app/approval.ts`, structural type): approving a changed MCP tool. */
  approve?(req: HarnessApproval): Promise<{ approved: boolean }>;
}

/** What the approval dialog shows (the same shape as `app/approval.ts`'s request). */
export interface HarnessApproval {
  title: string;
  command: string;
  scope?: string;
  list?: { heading: string; items: string[]; note?: string };
}

export interface HarnessState {
  run: RunState;
  checkpoints: Checkpoint[];
  permissions: Permissions | null;
  extensions: ExtensionsStatus | null;
  available: boolean;
}

export function makeHarness(deps: HarnessDeps) {
  const copy = deps.copy ?? ptCopy;
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

  async function refreshExtensions(): Promise<void> {
    try {
      set({ extensions: await deps.gateway.extensions(deps.root()) });
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
      const what = copy(conversation ? "rewindAll" : "rewindFiles");
      if (!deps.confirm(copy("rewindConfirm", { what, id }))) return;
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
        deps.notify(copy("permsSaved"));
      } catch (e) {
        err(e);
      }
    },
    async trust(kind: "hooks" | "mcp" | "sandbox" | "llm"): Promise<void> {
      if (!deps.confirm(copy(kind === "hooks" ? "trustHooksConfirm" : kind === "mcp" ? "trustMcpConfirm" : kind === "llm" ? "trustLlmConfirm" : "trustSandboxConfirm"))) return;
      try {
        await deps.gateway.trust(deps.root(), kind);
        set({ extensions: await deps.gateway.extensions(deps.root()) });
        deps.notify(copy("trustedNext"));
      } catch (e) {
        err(e);
      }
    },
    /** Signs in to a remote MCP server (the browser opens; the backend audits it and keeps the tokens). */
    async mcpSignIn(server: string): Promise<void> {
      if (!deps.gateway.mcpSignIn) return;
      deps.notify(copy("mcpSigningIn", { server }));
      try {
        await deps.gateway.mcpSignIn(deps.root(), server);
        deps.notify(copy("mcpSignedIn", { server }));
      } catch (e) {
        err(e);
      }
      await refreshExtensions();
    },
    async mcpSignOut(server: string): Promise<void> {
      if (!deps.gateway.mcpSignOut || !deps.confirm(copy("mcpSignOutConfirm", { server }))) return;
      try {
        await deps.gateway.mcpSignOut(deps.root(), server);
        deps.notify(copy("mcpSignedOut", { server }));
      } catch (e) {
        err(e);
      }
      await refreshExtensions();
    },
    /** «Review changes»: the old and the new definitions in the approval dialog; approved, the backend pins
     *  the new one (only that one: the hash the human saw). */
    async mcpReview(server: string, tool: string): Promise<void> {
      const s = st.extensions?.mcpDetails?.find((x) => x.name === server);
      const change = s?.pending.find((c) => c.tool === tool);
      if (!change || !deps.approve || !deps.gateway.mcpApproveTool) return;
      const d = await deps.approve(mcpApproval(server, change, copy));
      if (!d.approved) return;
      try {
        await deps.gateway.mcpApproveTool(deps.root(), server, tool, change.new.hash);
        deps.notify(copy("mcpApproved", { tool }));
      } catch (e) {
        err(e);
      }
      await refreshExtensions();
    },
    open: (path: string, line?: number): void => deps.open(path, line),
  };
}

const pretty = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 2) ?? "null";
  } catch {
    return String(v);
  }
};

/** The approval request of a changed MCP tool: old vs new description and schema, the exact definition. */
export function mcpApproval(server: string, c: McpPendingChange, copy: CodevCopy): HarnessApproval {
  const items: string[] = [];
  if (c.old) {
    items.push(copy("mcpOldDesc", { text: c.old.description }));
    items.push(copy("mcpNewDesc", { text: c.new.description }));
    items.push(copy(pretty(c.old.inputSchema) === pretty(c.new.inputSchema) ? "mcpSchemaSame" : "mcpSchemaChanged"));
  } else {
    items.push(copy("mcpNewTool"));
    items.push(copy("mcpNewDesc", { text: c.new.description }));
  }
  return {
    title: copy("mcpApproveTitle", { tool: c.tool, server }),
    command: copy("mcpApproveCommand", { tool: c.tool, server, hash: c.new.hash, description: c.new.description, schema: pretty(c.new.inputSchema) }),
    list: { heading: copy("mcpOldVsNew"), items, note: copy("mcpApproveNote") },
  };
}

export type HarnessUseCase = ReturnType<typeof makeHarness>;
