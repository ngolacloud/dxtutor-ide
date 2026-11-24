/* ═══════════ feature `codebase` — domain: the update commands and the map as text (A10) ═══════════
   The exact command for each update (what the human approves, run from the project root) and how
   serious a finding is; the onboarding map as text for Co-Dev. PURE. */

import type { Ecosystem, OnboardMap, Outdated, Vuln } from "./types";

const q = (s: string): string => (/^[A-Za-z0-9_./:=@%+,^~-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
const cd = (dir: string): string => (dir && dir !== "." ? `cd ${q(dir)} && ` : "");

/** The command for a compatible update (within the manifest's requirement). */
export function updateCompatible(e: Pick<Ecosystem, "kind" | "dir">, d: Outdated): string | null {
  if (!d.compatible) return null;
  if (e.kind === "cargo") return `${cd(e.dir)}cargo update -p ${q(d.name)}`;
  if (e.kind === "npm") return `${cd(e.dir)}npm update ${q(d.name)}`;
  return null;
}

/** The command that moves a direct dependency to its latest version (changes the manifest). */
export function upgradeLatest(e: Pick<Ecosystem, "kind" | "dir">, d: Outdated): string | null {
  if (!d.latest || !d.direct) return null;
  if (e.kind === "cargo") return `${cd(e.dir)}cargo add ${q(`${d.name}@${d.latest}`)}`;
  if (e.kind === "npm") return `${cd(e.dir)}npm install ${q(`${d.name}@${d.latest}`)}`;
  return `${cd(e.dir)}go get ${q(`${d.name}@v${d.latest}`)}`;
}

const RANK: Record<string, number> = { critical: 0, high: 1, moderate: 2, medium: 2, low: 3, unsound: 4, unmaintained: 5, yanked: 6 };
export const severityRank = (s: string): number => RANK[s.toLowerCase()] ?? 7;
export const sortVulns = (v: Vuln[]): Vuln[] => [...v].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.package.localeCompare(b.package));
/** A real vulnerability (not only a warning such as unmaintained). */
export const isVuln = (v: Vuln): boolean => severityRank(v.severity) <= 3;

/** The map as text: what Co-Dev reads for a tour of the codebase. */
export function mapText(m: OnboardMap): string {
  const out = [
    `files: ${m.totalFiles} · tests: ${m.tests}`,
    `languages: ${m.languages.slice(0, 8).map((l) => `${l.name} (${l.files} files, ${l.lines} lines)`).join(", ")}`,
    "entry points:", ...m.entries.slice(0, 25).map((e) => `  ${e.kind} ${e.name} — ${e.file}${e.run ? ` — ${e.run}` : ""}`),
    "docs:", ...m.docs.slice(0, 15).map((d) => `  ${d}`),
    "most changed (6 months):", ...m.hot.slice(0, 10).map((h) => `  ${h.file} (${h.changes})`),
    "largest modules (symbols):", ...m.modules.slice(0, 10).map((x) => `  ${x.file} (${x.symbols})`),
  ];
  return out.join("\n");
}
