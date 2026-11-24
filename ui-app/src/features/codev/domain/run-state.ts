/* ═══════════ Co-Dev — domain: the Run view of the harness (docs/v2/UI-AUDIT.md item 11) ═══════════
   What the agent is doing, folded from the turn's real events: the approved plan (with the
   steps, files and lines `exit_plan` lists), the task list (`todo_write`), the sub-agents and
   their roles (`task`), the context used (the `usage` event) and the last turn's report
   (`report`). Pure: no DOM, no window. */

import type { AgentEvent } from "./agent-events";

export interface PlanStep {
  text: string;
  files: Array<{ path: string; start?: number; end?: number }>;
}

export interface SubagentRun {
  id: string;
  role: string;
  description: string;
  state: "running" | "done" | "error";
}

export interface RunState {
  plan: { markdown: string; steps: PlanStep[] } | null;
  todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>;
  subagents: SubagentRun[];
  /** Tokens the model read in the last request (prompt + cache) and wrote in the turn. */
  context: { input: number; output: number } | null;
  report: { title: string; markdown: string } | null;
  running: boolean;
}

export const initialRun = (): RunState => ({ plan: null, todos: [], subagents: [], context: null, report: null, running: false });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The steps `exit_plan` lists (toolset 5); malformed entries are dropped. */
export function parseSteps(v: unknown): PlanStep[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).filter((s) => typeof s.text === "string").map((s) => ({
    text: s.text as string,
    files: (Array.isArray(s.files) ? s.files : [])
      .filter(isObj)
      .filter((f) => typeof f.path === "string")
      .map((f) => ({
        path: f.path as string,
        ...(typeof f.start === "number" ? { start: f.start } : {}),
        ...(typeof f.end === "number" ? { end: f.end } : {}),
      })),
  }));
}

export function reduceRun(s: RunState, e: AgentEvent): RunState {
  switch (e.kind) {
    case "tool_start": {
      if (e.name === "exit_plan") {
        return { ...s, plan: { markdown: typeof e.input.plan === "string" ? e.input.plan : "", steps: parseSteps(e.input.steps) } };
      }
      if (e.name === "todo_write" && Array.isArray(e.input.todos)) {
        const todos = e.input.todos.filter(isObj).filter((t) => typeof t.content === "string").map((t) => ({
          content: t.content as string,
          status: (t.status === "completed" || t.status === "in_progress" ? t.status : "pending") as RunState["todos"][number]["status"],
        }));
        return { ...s, todos };
      }
      if (e.name === "task") {
        const role = typeof e.input.role === "string" ? e.input.role : "explorer";
        const description = typeof e.input.description === "string" ? e.input.description : "";
        return { ...s, subagents: [...s.subagents.filter((x) => x.id !== e.id), { id: e.id, role, description, state: "running" }] };
      }
      return s;
    }
    case "tool_result":
      if (e.name === "task") return { ...s, subagents: s.subagents.map((x) => (x.id === e.id ? { ...x, state: e.is_error ? "error" : "done" } : x)) };
      return s;
    case "usage":
      return {
        ...s,
        context: {
          input: e.request.input_tokens + e.request.cache_read_input_tokens + e.request.cache_creation_input_tokens,
          output: e.turn.output_tokens,
        },
      };
    case "report":
      return { ...s, report: { title: e.title, markdown: e.markdown } };
    case "done":
      return { ...s, running: false };
    default:
      return s;
  }
}

/** A new turn starts: sub-agents of the previous one are history, the plan and tasks stay. */
export const turnStarted = (s: RunState): RunState => ({ ...s, running: true, subagents: s.subagents.filter((x) => x.state === "running") });

/** The model's context window, when known (tokens). Unknown models (local Ollama) → null. */
export function contextWindow(model: string): number | null {
  const m = model.toLowerCase();
  if (m.startsWith("claude")) return 200_000;
  if (m.startsWith("gpt-4.1")) return 1_047_576;
  if (m.startsWith("gpt-4o") || m.startsWith("gpt-codex") || m.startsWith("o3") || m.startsWith("o4")) return 128_000;
  if (m.startsWith("gemini-2") || m.startsWith("gemini-pro")) return 1_048_576;
  return null;
}

/** Share of the window in use (0–100), or null when the window is unknown or nothing ran. */
export function contextPct(s: RunState, model: string): number | null {
  const w = contextWindow(model);
  if (!w || !s.context) return null;
  return Math.min(100, Math.round((s.context.input / w) * 100));
}
