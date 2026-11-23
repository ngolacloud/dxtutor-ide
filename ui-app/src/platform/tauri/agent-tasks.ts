/* ═════════ cliente IPC: tarefas isoladas do agente (git worktree) — ADR-0004, U2 ═════════
   Contratos de `agent_task_submit/status/cancel` (src-tauri/src/commands/agent.rs). */
import { invoke, type Invoker } from "./core";

/** `AgentTask` — o estado de uma delegação isolada. */
export interface AgentTask {
  id: string;
  status: string;
  patch: string;
  error: string;
}

export const agentTasksClient = (inv: Invoker = invoke) => ({
  /** Aplica `writes` (caminho, conteúdo) num worktree de HEAD; devolve o id. */
  submit: (root: string, writes: Array<[string, string]>): Promise<string> => inv<string>("agent_task_submit", { root, writes }),
  status: (id: string): Promise<AgentTask | null> => inv<AgentTask | null>("agent_task_status", { id }),
  cancel: (id: string): Promise<boolean> => inv<boolean>("agent_task_cancel", { id }),
});

export type AgentTasksClient = ReturnType<typeof agentTasksClient>;
