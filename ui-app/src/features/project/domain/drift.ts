/* ═════════ feature `project` — domain: the drift of the architect's rules by issue (RF-A05, F5.6) ═════════
   The repository against `.dxtutor/architecture.toml` (`arch_conformance`), narrowed to the files
   Co-Dev changed for one issue (its change sets, F2.7): what this issue's work left outside the
   rules. PURE. */

/** One broken rule, as `arch_conformance` reports it. */
export interface RuleViolation {
  rule: string;
  message: string;
  path: string;
  line: number | null;
}

export interface IssueDrift {
  /** The files Co-Dev changed for the issue (each once, in path order). */
  files: string[];
  /** The violations in those files, by path and line. */
  violations: RuleViolation[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const norm = (p: string): string => p.trim().replace(/^\.\//, "").replace(/\\/g, "/");

/** `arch_conformance`'s answer (`null`: no rules file → none). */
export function parseViolations(v: unknown): RuleViolation[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .filter((x) => typeof x.path === "string" && typeof x.message === "string")
    .map((x) => ({
      rule: typeof x.rule === "string" ? x.rule : "",
      message: x.message as string,
      path: norm(x.path as string),
      line: typeof x.line === "number" ? x.line : null,
    }));
}

/** The issue's drift: the violations in the files of its change sets. */
export function issueDrift(changeSets: ReadonlyArray<{ path: string }>, violations: readonly RuleViolation[]): IssueDrift {
  const files = [...new Set(changeSets.map((c) => norm(c.path)).filter(Boolean))].sort();
  const set = new Set(files);
  const inIssue = violations
    .filter((v) => set.has(norm(v.path)))
    .sort((a, b) => a.path.localeCompare(b.path) || (a.line ?? 0) - (b.line ?? 0));
  return { files, violations: inIssue };
}
