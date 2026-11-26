/* ═════════ feature `project` — domain: the integration gate's data (Multi Co-Dev, phase 2) ═════════
   A change is integrated only when (1) every MANDATORY check passes on the current commit, (2) the
   Co-Dev reviewer confirms it meets the issue's acceptance criteria and (3) the responsible person
   recorded the functional approval. Phase 2 keeps the data: the project's mandatory checks (edited
   in Settings as text, one per line `name: command`) and the approval on the issue. Phase 4 runs the
   checks and the reviewer. Pure: no DOM, no window, no Tauri. */

import type { Check, Issue } from "./types";

/** The most mandatory checks a project may list (the store refuses more). */
export const MAX_CHECKS = 12;

/** The name the detected test command goes by when no check was set. */
export const DEFAULT_CHECK_NAME = "tests";

/** The checks as the Settings textarea shows them: one per line, `name: command`. */
export const checksText = (checks: readonly Check[]): string => checks.map((c) => `${c.name}: ${c.command}`).join("\n");

/** The Settings textarea → the checks. A line without `name:` is named after its first word; empty
 *  lines are skipped. `{error}` names the line that has a name and no command. */
export function parseChecks(text: string): { checks: Check[] } | { error: string } {
  const checks: Check[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^([^:]{1,60}):\s*(.*)$/.exec(line);
    // `name: command` — a colon inside the command (`cargo test -- a::b`) is not a name
    const named = m && !/\s/.test(m[1].trim()) ? m : null;
    const name = named ? named[1].trim() : line.split(/\s+/)[0];
    const command = named ? named[2].trim() : line;
    if (!command) return { error: line };
    checks.push({ name, command });
  }
  return { checks };
}

/** The checks that hold: the project's, or — none set — the detected test command (as `tests`). */
export function effectiveChecks(checks: readonly Check[], detected: string | null): { checks: Check[]; detected: boolean } {
  if (checks.length) return { checks: [...checks], detected: false };
  return detected ? { checks: [{ name: DEFAULT_CHECK_NAME, command: detected }], detected: true } : { checks: [], detected: true };
}

/** Why the functional approval cannot be recorded now (`null`: it can). */
export function approvalBlocker(i: Pick<Issue, "acceptance" | "functional">): "noCriteria" | "approved" | null {
  if (!i.acceptance.length) return "noCriteria";
  if (i.functional) return "approved";
  return null;
}
