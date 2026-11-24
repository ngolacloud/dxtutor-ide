/* ═══════════ feature `ext` (Open VSX) — as secções do pane (ADR-0002, Fase 2; ADR-0006, R6b) ═══════════
   A regra pura que parte o pane «Extensions» em: instaladas, recomendadas-para-este-projecto e
   resultados da pesquisa no Open VSX. Pura: o que está instalado, as recomendações e os
   resultados são FORNECIDOS pelo chamador. */

import type { ExtItem } from "./types";

/** As três secções que o pane rende, por esta ordem. */
export interface ExtSections {
  /** Instaladas (por VSIX) que passam a pesquisa. */
  inst: ExtItem[];
  /** Recomendadas para o projecto, não instaladas, que passam a pesquisa. */
  rec: ExtItem[];
  /** Resultados do Open VSX que não estão instalados nem já recomendados. */
  rest: ExtItem[];
}

/** Combina `x` com a pesquisa de texto livre `q` (já em minúsculas). Query vazia combina tudo. */
export function matchesQuery(x: ExtItem, q: string): boolean {
  return !q || (x.n + x.id + x.d).toLowerCase().includes(q);
}

/** Parte o pane: `installed` são os VSIX instalados, `recs` as recomendações, `results` a
 *  pesquisa no Open VSX (já filtrada pelo servidor — não se volta a filtrar por texto). */
export function sectionsFor(installed: ExtItem[], recs: ExtItem[], results: ExtItem[], isInstalled: (id: string) => boolean, q: string): ExtSections {
  const inst = installed.filter((x) => matchesQuery(x, q));
  const rec = recs.filter((x) => !isInstalled(x.id) && matchesQuery(x, q));
  const rest = results.filter((x) => !isInstalled(x.id) && !rec.some((r) => r.id === x.id));
  return { inst, rec, rest };
}
