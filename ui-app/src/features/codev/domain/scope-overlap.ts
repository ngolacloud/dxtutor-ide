/* ═══════════ Co-Dev — domínio: a verificação de âmbito entre Co-Devs (Multi Co-Dev, fase 2) ═══════════
   Na fase 2 as sessões Co-Dev correm na MESMA árvore de trabalho (as worktrees são a fase 3): outra
   sessão de uma issue só começa se o âmbito dela não se sobrepuser ao de nenhuma issue em curso. A
   regra é a do plano paralelo da fase 1 (`tutor_board::project::plan`, no Rust); aqui só se estreita a
   resposta de `project_scope_overlap` e se diz o resultado ao humano. PURO. */

/** Uma issue em curso que pode mudar os mesmos ficheiros. */
export interface ScopeClash {
  /** A issue em curso. */
  other: string;
  /** Os primeiros caminhos em comum. */
  paths: string[];
  /** Quantos caminhos em comum, ao todo. */
  total: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** A resposta de `project_scope_overlap` (`{overlaps: [{a, b, paths, total}], files}`) → os choques com as
 *  issues em curso; `null` se a forma não for a esperada. */
export function parseScopeCheck(v: unknown, key: string): ScopeClash[] | null {
  if (!isObj(v) || !Array.isArray(v.overlaps)) return null;
  return v.overlaps.filter(isObj).map((o) => {
    const a = typeof o.a === "string" ? o.a : "";
    const b = typeof o.b === "string" ? o.b : "";
    const paths = Array.isArray(o.paths) ? o.paths.filter((p): p is string => typeof p === "string") : [];
    return { other: a === key ? b : a, paths, total: typeof o.total === "number" ? o.total : paths.length };
  });
}

/** «a.rs, b.rs, c.rs (+4 more)»: os primeiros caminhos e quantos faltam. */
export function clashFiles(c: ScopeClash[], max = 3, more: (n: number) => string = (n) => `+${n}`): string {
  const all = [...new Set(c.flatMap((x) => x.paths))];
  const total = Math.max(all.length, ...c.map((x) => x.total));
  const shown = all.slice(0, max);
  return shown.join(", ") + (total > shown.length ? ` (${more(total - shown.length)})` : "");
}

/** Uma linha por issue em curso: «DX-12: src/cart.rs, src/total.rs». */
export const clashLines = (c: ScopeClash[]): string => c.map((x) => `· ${x.other}: ${x.paths.slice(0, 6).join(", ")}${x.total > Math.min(6, x.paths.length) ? " …" : ""}`).join("\n");
