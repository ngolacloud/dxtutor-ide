/* ═══════════ Co-Dev — domain types (ADR-0002, Phase 2) ═══════════
   Pure TypeScript shapes for the Co-Dev domain: autonomy modes, the approval
   decision, tool calls, the decision log and workspace file entries. (The
   scripted mission scenarios and their rubric were removed — ADR-0005, R1b.)

   Dependency rule (ADR-0002): this folder imports NOTHING — no DOM, no
   `window`, no Tauri, no `application/`/`ui/`/`infrastructure/`. */

/** Autonomy level chosen by the human. */
export type Mode = "manual" | "assist" | "auto";

/** Whether a tool call proceeds automatically or needs human approval first. */
export type Approval = "auto" | "ask";

/** The three tool kinds the agent can run. */
export type ToolKind = "read" | "edit" | "run";

/** A tool call, as seen by the approval policy. The engine's runtime tool
 *  objects carry more (path, `make`, `content`); the policy only needs the
 *  kind and, for `run`, the command string. */
export interface ToolCall {
  kind: ToolKind;
  cmd?: string;
}

/** A recorded decision (who chose what, with what confidence). */
export interface Decision {
  id?: number;
  phase: string;
  q: string;
  choice: string;
  by: string;
  conf?: number;
  basis: string;
  status: "ok" | "pressuposto" | "corrigida";
  mission?: string;
}

/** A workspace file: current content and the committed original (`null` = new). */
export interface FileEntry {
  content: string;
  orig: string | null;
}
