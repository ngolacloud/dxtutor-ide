/* ═══════════ feature `board` — domínio: selectores do quadro (ADR-0002, Fase 2) ═══════════
   Consultas PURAS sobre a lista de issues que o render (renderBoardView), o runner
   (runSprint) e o CRUD (setStage) usam. Sem DOM, sem `window`, sem Tauri — dados → dados. */

import type { Issue } from "./types";

/** As issues visíveis na vista actual (`view < 0` = Tudo; senão, só o sprint). */
export const inView = (issues: Issue[], view: number): Issue[] =>
  issues.filter((i) => view < 0 || i.sprint === view);

/** Pontos totais e concluídos de uma lista (a barra de progresso do quadro). */
export const points = (list: Issue[]): { total: number; done: number } => ({
  total: list.reduce((a, i) => a + i.pts, 0),
  done: list.filter((i) => i.stage === "done").reduce((a, i) => a + i.pts, 0),
});

/** O estado do componente do Studio para o qual uma issue aponta: `ok` se TODAS as
 *  issues desse nó estão concluídas, senão `wip`. */
export const nodeStatus = (issues: Issue[], nodeId: string): "ok" | "wip" =>
  issues.filter((i) => i.node === nodeId).every((i) => i.stage === "done") ? "ok" : "wip";

/** Qual sprint arrancar quando a vista é «Tudo»: 0 se ainda há trabalho por fazer no
 *  Sprint 1 (todo/backlog), senão 1. */
export const autoSprint = (issues: Issue[]): number =>
  issues.some((i) => i.sprint === 0 && ["todo", "backlog"].includes(i.stage)) ? 0 : 1;

/** Quantas issues de um sprint esperam validação funcional (`func`) e quantas ficaram
 *  bloqueadas em desenvolvimento (`dev`) — o resumo no fim de `runSprint`. */
export const sprintCounts = (issues: Issue[], sprint: number): { func: number; dev: number } => ({
  func: issues.filter((i) => i.sprint === sprint && i.stage === "func").length,
  dev: issues.filter((i) => i.sprint === sprint && i.stage === "dev").length,
});
