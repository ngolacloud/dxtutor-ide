/* ═══════════ feature `ext` (Open VSX) — recommendation policy (ADR-0002, Fase 2) ═══════════
   A regra pura que parte o catálogo de extensões em três secções para o pane
   «Extensions»: instaladas, recomendadas-para-este-projecto, e o resto do Open
   VSX. Vivia inline em `renderExtPane`; extraída aqui para ser testável sem DOM.

   Pura: sem DOM, sem `window`, sem Tauri. O que é "este projecto" (os tags de
   contexto `cx`) e o que está instalado (`installed`) são FORNECIDOS pelo
   chamador — a policy não vai buscar nada ao mundo. */

import type { ExtItem } from "./types";

/** As três secções que o pane rende, por esta ordem. */
export interface ExtSections {
  /** Instaladas (catálogo + VSIX) que passam a pesquisa. */
  inst: ExtItem[];
  /** Não instaladas, que passam a pesquisa e combinam o contexto do projecto. */
  rec: ExtItem[];
  /** Não instaladas, que passam a pesquisa e NÃO são recomendadas. */
  rest: ExtItem[];
}

/** Combina `x` com a pesquisa de texto livre `q` (já em minúsculas). Query vazia
 *  combina tudo. Pesquisa sobre nome+id+descrição, como o filtro original. */
export function matchesQuery(x: ExtItem, q: string): boolean {
  return !q || (x.n + x.id + x.d).toLowerCase().includes(q);
}

/** `x` é recomendada para um projecto cujos tags de contexto são `cx`?
 *  O tag `"all"` combina qualquer projecto. */
export function recommendedFor(x: ExtItem, cx: string[]): boolean {
  return x.ctx.some(c => c === "all" || cx.includes(c));
}

/**
 * Parte o pane «Extensions» em instaladas / recomendadas-para-o-contexto / resto.
 *
 *   - `all` é catálogo+VSIX (a secção «instaladas» abrange ambos);
 *   - `catalogue` é só o catálogo embutido (recomendadas/resto saem daqui);
 *   - `installed(id)` diz se um id está instalado;
 *   - `cx` são os tags de contexto do projecto; `q` a pesquisa (em minúsculas).
 *
 * Byte-fiel à partição que estava em `renderExtPane` (mesma ordem de predicados,
 * mesmo `!rec.includes(x)` por identidade sobre o `catalogue`).
 */
export function sectionsFor(
  all: ExtItem[],
  catalogue: ExtItem[],
  installed: (id: string) => boolean,
  cx: string[],
  q: string,
): ExtSections {
  const inst = all.filter(x => installed(x.id) && matchesQuery(x, q));
  const rec = catalogue.filter(x => !installed(x.id) && matchesQuery(x, q) && recommendedFor(x, cx));
  const rest = catalogue.filter(x => !installed(x.id) && matchesQuery(x, q) && !rec.includes(x));
  return { inst, rec, rest };
}
