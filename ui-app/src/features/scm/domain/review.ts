/* ═══════════ feature scm — domain: reviewing a big change (A10, docs/v2/UI-AUDIT.md §3 «Rever diffs grandes») ═══════════
   A change's files grouped by what they are — tests, docs, config, infrastructure, styles, or the source
   module they belong to — biggest groups first, and the +/− of a unified diff. PURE. */

export interface ReviewFile { path: string; status: string; added: number; removed: number }
export interface ReviewGroup { key: string; files: ReviewFile[]; added: number; removed: number }

/** The theme of a file: `tests`, `docs`, `config`, `infra`, `styles` or `src:<top folder>`. */
export function groupOf(path: string): string {
  const p = path.toLowerCase(), name = p.split("/").pop() ?? p;
  if (/(^|\/)(tests?|__tests__|e2e|spec)\//.test(p) || /[._-](test|spec)\.[a-z0-9]+$/.test(name) || /^test_.*\.py$/.test(name) || /_test\.go$/.test(name)) return "tests";
  if (/\.(md|mdx|rst|adoc|txt)$/.test(name) || p.startsWith("docs/")) return "docs";
  if (/(^|\/)(dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/.test(p) || /\.(tf|tfvars|hcl)$/.test(name) || /(^|\/)(k8s|deploy|helm|charts|\.github)\//.test(p)) return "infra";
  if (/\.(css|scss|sass|less)$/.test(name)) return "styles";
  if (/\.(json|ya?ml|toml|lock|ini|cfg|conf|env)$/.test(name) || /^\.[a-z]+rc$/.test(name)) return "config";
  const parts = path.split("/");
  const top = parts.length > 1 ? (["src", "lib", "app", "crates", "packages", "pkg", "cmd", "internal"].includes(parts[0]) && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0]) : ".";
  return `src:${top}`;
}

export function groupFiles(files: ReviewFile[]): ReviewGroup[] {
  const by = new Map<string, ReviewFile[]>();
  for (const f of files) { const k = groupOf(f.path); const a = by.get(k); if (a) a.push(f); else by.set(k, [f]); }
  return [...by.entries()]
    .map(([key, fs]) => ({ key, files: fs.sort((a, b) => b.added + b.removed - (a.added + a.removed)), added: fs.reduce((s, f) => s + f.added, 0), removed: fs.reduce((s, f) => s + f.removed, 0) }))
    .sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.key.localeCompare(b.key));
}

/** The +/− of a unified diff (headers not counted). */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++") || l.startsWith("---")) continue;
    if (l.startsWith("+")) added++;
    else if (l.startsWith("-")) removed++;
  }
  return { added, removed };
}
