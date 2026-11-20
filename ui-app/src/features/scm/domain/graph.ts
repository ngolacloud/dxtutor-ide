/* ═══════════ feature `scm` — domain: layout do grafo de commits (ADR-0002, Fase 2) ═══════════
   O algoritmo PURO de atribuição de lanes (colunas) ao DAG de commits: dado o
   `order` topológico e o mapa de commits, devolve, por commit, a sua coluna e as
   colunas dos pais, mais o nº máximo de lanes em uso. Sem DOM, sem `window`, sem
   Tauri — só dados de entrada → dados de saída. (Antes vivia em `features/scm.ts`.) */

import type { GitState, GraphLayout } from "./types";

/** Atribui lanes ao DAG: percorre `order`, reaproveitando a coluna de cada commit
 *  e empurrando os pais para lanes livres. Resultado determinista para o mesmo DAG. */
export function computeGraphLayout(git: Pick<GitState, "order" | "c">): GraphLayout {
  const lanes: (string | null)[] = [], rows: GraphLayout["rows"] = [], idx: Record<string, number> = {}; let max = 1;
  git.order.forEach((h, i) => {
    const c = git.c[h]; let col = lanes.indexOf(h); if (col < 0) { col = lanes.indexOf(null); if (col < 0) col = lanes.length; }
    lanes.forEach((x, k) => { if (x === h) lanes[k] = null; }); lanes[col] = null; const pl: number[] = [];
    c.p.forEach((ph, k) => { let l: number; if (k === 0) { l = col; lanes[col] = ph; } else { l = lanes.indexOf(ph); if (l < 0) { l = lanes.indexOf(null); if (l < 0) l = lanes.length; lanes[l] = ph; } } pl.push(l); });
    idx[h] = i; rows.push({ h, col, pl }); max = Math.max(max, lanes.length, col + 1);
  });
  return { rows, idx, max };
}
