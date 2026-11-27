/* ═══════════ feature `scm` — domain: Conventional Commits (r23 F3, UI-SCM-08) ═══════════
   `type(scope)!: subject` → the type chip on a graph row. PURE. */

export const CONVENTIONAL_TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"] as const;
export interface Conventional { type: string; scope: string | null; breaking: boolean }

export function conventionalOf(message: string): Conventional | null {
  const m = message.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s/);
  if (!m || !(CONVENTIONAL_TYPES as readonly string[]).includes(m[1].toLowerCase())) return null;
  return { type: m[1].toLowerCase(), scope: m[2] || null, breaking: !!m[3] };
}
