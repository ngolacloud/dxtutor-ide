/* ═══════════ Co-Dev — approval policy (ADR-0002, Phase 2) ═══════════
   The SINGLE source of the per-mode approval rule. It used to live inline in
   `doTool` (one `if` for edits, one boolean for commands) and was restated in
   prose in the Settings `POLICY` table. `doTool` now calls `approvalFor`; the
   Settings table stays as human-facing prose and a unit test asserts the two
   agree on the tool-governed rows.

   Pure: no DOM, no `window`, no Tauri. Whether a command is "safe" or
   "destructive" is not decided here — it is supplied via `CommandRules`, so the
   concrete regexes (`SAFE`/`DANGER`, owned by the app shell) stay out of the
   domain. */

import type { Mode, Approval, ToolCall } from "./types";

/** Classifies a command string. Implemented by the caller (the legacy bridge
 *  wraps the app's `SAFE`/`DANGER` regexes); kept abstract so the policy is
 *  pure and testable with fakes. */
export interface CommandRules {
  /** Build/test/lint and friends — safe to run unattended in assist/auto. */
  isSafe(cmd: string): boolean;
  /** Push, `rm -rf`, `--force`, `drop table` — always needs approval. */
  isDestructive(cmd: string): boolean;
}

/**
 * Decides whether a tool call runs automatically or must be approved, given
 * the autonomy mode and the command classification. This is exactly the rule
 * that was embedded in `doTool`:
 *
 *   - read: never asks, in any mode;
 *   - edit: asks only in manual (assist/auto apply automatically, with diff);
 *   - run: asks iff the command is destructive, OR the mode is manual, OR the
 *     mode is assist and the command is not safe.
 */
export function approvalFor(mode: Mode, call: ToolCall, rules: CommandRules): Approval {
  if (call.kind === "read") return "auto";
  if (call.kind === "edit") return mode === "manual" ? "ask" : "auto";
  const cmd = call.cmd ?? "";
  if (rules.isDestructive(cmd)) return "ask"; // always, in every mode
  if (mode === "manual") return "ask";
  if (mode === "assist" && !rules.isSafe(cmd)) return "ask";
  return "auto";
}
