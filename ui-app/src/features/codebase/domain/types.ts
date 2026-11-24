/* ═══════════ feature `codebase` — domain: the shapes of `tutor_eval::deps` and `tutor_eval::onboard` (A10) ═══════════
   serde camelCase. PURE. */

export interface Outdated { name: string; current: string; compatible: string | null; latest: string | null; direct: boolean; jump: "patch" | "minor" | "major" }
export interface Vuln { id: string; package: string; version: string; severity: string; title: string; url: string; fixed: string[] }
export interface Ecosystem { kind: "cargo" | "npm" | "go"; dir: string; outdated: Outdated[]; vulns: Vuln[]; commands: string[]; notes: string[] }
export interface DepsReport { ecosystems: Ecosystem[]; online: boolean }

export interface Lang { name: string; files: number; lines: number }
export interface Entry { kind: string; name: string; file: string; run: string | null }
export interface OnboardMap {
  languages: Lang[]; totalFiles: number; entries: Entry[]; docs: string[];
  hot: Array<{ file: string; changes: number }>; people: Array<{ name: string; commits: number }>;
  modules: Array<{ file: string; symbols: number }>; tests: number; git: boolean; notes: string[];
}
