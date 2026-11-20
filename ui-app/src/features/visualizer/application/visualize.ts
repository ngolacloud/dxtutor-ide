/* ═══════════ feature `visualizer` — caso de uso: compor a visualização (ADR-0002, Fase 3) ═══════════
   A orquestração que vivia no corpo de `vizOpen`: dado um programa, corre o
   interpretador e, se correu, constrói as notas de cada passo (uma por evento, no
   nível `machine`). PURO (deps injectadas pelas portas; sem DOM/window). O overlay
   (resíduo) chama isto e só depois pinta — a lógica de «o que mostrar» fica aqui, o
   «como pintar» fica no overlay.

   O comportamento é VERBATIM do original (incl. o ramo de erro interno com
   `console.error`): o golden do overlay prova a equivalência byte-a-byte. */

import type { VzNote, VzRunResult } from "../domain/types";
import type { VzError } from "../domain/lexer";
import type { VisualizePorts } from "./ports";

/** Um erro visualizável: o erro tipado do domínio (subconjunto/linha), ou um erro
 *  interno embrulhado com `vline: 0`. */
export type VizError = VzError | { message: string; vline: number };

/** O que o caso de uso devolve ao overlay: o traço (ou `null`), o erro (ou `null`) e
 *  as notas por passo. */
export interface VizComputed {
  res: VzRunResult | null;
  err: VizError | null;
  notes: Record<number, VzNote[]>;
}

export function buildVisualization(src: string, ports: VisualizePorts): VizComputed {
  ports.resetSeen();
  let res: VzRunResult | null = null, err: VizError | null = null;
  try { res = ports.run(src); }
  catch (x) { const ex = x as VzError & { message: string }; if (ex.vz || ex.vline) err = ex; else { err = { message: "Internal error in the visualizer: " + ex.message, vline: 0 }; console.error(x); } }
  const notes: Record<number, VzNote[]> = {};
  if (res) res.steps.forEach((s, k) => { notes[k] = s.ev.map(e => ports.narrate(e, "machine")).filter(Boolean) as VzNote[]; });
  return { res, err, notes };
}
