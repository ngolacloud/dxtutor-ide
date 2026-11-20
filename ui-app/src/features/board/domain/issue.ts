/* ═══════════ feature `board` — domínio: issue + colunas (ADR-0002, Fase 2) ═══════════
   As colunas do quadro kanban e a FÁBRICA pura de issues. PURO: sem DOM, sem
   `window`, sem Tauri — não muta o backlog (o resíduo é que faz o push). */

import type { Issue, Stage } from "./types";

/** As colunas do quadro, por ordem: [chave, rótulo]. */
export const STAGES: Stage[] = [
  ["backlog", "Backlog"],
  ["todo", "A fazer"],
  ["dev", "Em desenvolvimento"],
  ["test", "Teste automático"],
  ["func", "Validação funcional"],
  ["done", "Concluído"],
];

/** Constrói uma issue com os defaults da fábrica (id `DX-<seq>`, feature, 3 pts, no
 *  backlog, sem tentativas/testes/resultado/nota/modelo/ramo), sobreposto por `o`.
 *  PURO: devolve a issue; quem a adiciona ao backlog é o chamador. */
export function makeIssue(seq: number, o: Partial<Issue>): Issue {
  return Object.assign(
    { id: "DX-" + seq, type: "feature", pts: 3, stage: "backlog", attempts: 0, tests: [], res: null, note: "", model: null, branch: null },
    o,
  ) as Issue;
}
