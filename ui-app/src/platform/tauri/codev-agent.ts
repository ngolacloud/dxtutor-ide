/* ═════════ dxtutor IDE — adaptador tipado: agente Co-Dev v2 (ADR-0003, F4) ═════════
   Cliente dos comandos `codev_agent_*` (src-tauri/src/commands/codev_agent.rs) e dos três
   eventos que o turno emite. Os payloads dos eventos chegam como `unknown` e quem os
   consome (o adaptador da feature Co-Dev) estreita-os para o seu contrato — esta camada só
   sabe nomes de comandos, argumentos e eventos. Ver IPC-MATRIX.md §10b. */

import { invoke, listen } from "./core";

export interface StartAgentArgs {
  root: string;
  /** `claude`/`codex`/`gemini`/`ollama` (F8). */
  provider?: string | null;
  model?: string | null;
  effort?: string | null;
  testCmd?: string | null;
  lintCmd?: string | null;
  mode?: string | null;
  /** Retomar a sessão gravada com este id. */
  resume?: string | null;
  /** Hunks ao vivo (docs/v2/RF-CODEV-STREAM.md): edições revistas hunk a hunk no editor. */
  reviewEdits?: boolean;
}

/** Abre uma sessão; devolve o id. Falha se faltar a chave do provedor ou a pasta não existir. */
export const startAgent = (a: StartAgentArgs): Promise<string> =>
  invoke<string>("codev_agent_start", {
    root: a.root,
    model: a.model ?? null,
    effort: a.effort ?? null,
    testCmd: a.testCmd ?? null,
    lintCmd: a.lintCmd ?? null,
    mode: a.mode ?? null,
    resume: a.resume ?? null,
    provider: a.provider ?? null,
    reviewEdits: a.reviewEdits ?? false,
  });

/** As sessões gravadas do projecto (mais recentes primeiro) — `Vec<SessionSummary>`. */
export const listAgentSessions = (root: string): Promise<unknown> => invoke<unknown>("codev_agent_sessions", { root });

/** O histórico simplificado de uma sessão aberta — `Vec<HistoryItem>`. */
export const agentHistory = (sessionId: string): Promise<unknown> => invoke<unknown>("codev_agent_history", { sessionId });

/** Envia uma mensagem (`text: null` repete a partir do histórico). Responde por eventos. */
export const sendAgent = (sessionId: string, text: string | null): Promise<void> =>
  invoke<void>("codev_agent_send", { sessionId, text });

export const approveAgent = (sessionId: string, toolUseId: string, allow: boolean, reason?: string, remember?: boolean): Promise<boolean> =>
  invoke<boolean>("codev_agent_approve", { sessionId, toolUseId, allow, reason: reason ?? null, remember: remember ?? false });

/** Uma decisão de um `hunk_review`. */
export interface HunkDecision {
  hunk: string;
  accept: boolean;
  reason?: string;
}

/** Decide os hunks de um `hunk_review`; hunks sem decisão contam como recusados. */
export const reviewAgentHunks = (sessionId: string, call: string, decisions: HunkDecision[]): Promise<void> =>
  invoke<void>("codev_agent_review", { sessionId, call, decisions });

export const cancelAgent = (sessionId: string): Promise<boolean> => invoke<boolean>("codev_agent_cancel", { sessionId });

export const setAgentMode = (sessionId: string, mode: string): Promise<boolean> =>
  invoke<boolean>("codev_agent_set_mode", { sessionId, mode });

export const closeAgent = (sessionId: string): Promise<boolean> => invoke<boolean>("codev_agent_close", { sessionId });

/** `codev-agent://event` `{session, event}` — eventos do loop. */
export const onAgentEvent = (h: (payload: unknown) => void): Promise<() => void> => listen("codev-agent://event", h);
/** `codev-agent://approval` `{session, request}` — uma chamada à espera de decisão. */
export const onAgentApproval = (h: (payload: unknown) => void): Promise<() => void> => listen("codev-agent://approval", h);
/** `codev-agent://error` `{session, error}` — o turno falhou. */
export const onAgentError = (h: (payload: unknown) => void): Promise<() => void> => listen("codev-agent://error", h);

/** Liga/desliga o modo plano (só leitura até o plano ser aprovado). */
export const setAgentPlan = (sessionId: string, on: boolean): Promise<void> => invoke<void>("codev_agent_set_plan", { sessionId, on });

/** Os checkpoints de ficheiros da sessão — `Vec<Checkpoint>`. */
export const listAgentCheckpoints = (sessionId: string): Promise<unknown> => invoke<unknown>("codev_agent_checkpoints", { sessionId });

/** Repõe os ficheiros como estavam no checkpoint; devolve o resumo. */
export const rewindAgent = (sessionId: string, checkpoint: number): Promise<string> =>
  invoke<string>("codev_agent_rewind", { sessionId, checkpoint });

/** O que o projecto define para o agente (comandos, skills, hooks, MCP) — `ExtensionsStatus`. */
export const agentExtensions = (root: string): Promise<unknown> => invoke<unknown>("codev_agent_extensions", { root });

/** Confia nos hooks (`"hooks"`) ou nos servidores MCP (`"mcp"`) do projecto, tal como estão. */
export const trustAgentFile = (root: string, kind: "hooks" | "mcp"): Promise<void> =>
  invoke<void>("codev_agent_trust", { root, kind });
