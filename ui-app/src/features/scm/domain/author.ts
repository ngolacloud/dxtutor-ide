/* ═══════════ feature `scm` — domain: resolução de autor (ADR-0002, Fase 2) ═══════════
   Regra PURA que resolve um id de autor para apresentação (nome + cor), consultando
   o catálogo de agentes. Sem DOM, sem `window` — o catálogo entra por argumento.
   (Antes vivia em `features/scm.ts` como `authorOf`, lendo o global `AGENTS`.) */

import type { Author } from "./types";

/** Resolve o autor de um commit: se for um agente conhecido usa o seu nome/cor;
 *  senão, 'w' (e vazio) é «You», qualquer outro id é o próprio nome, cor neutra. */
export function resolveAuthor(id: string, agents: Record<string, Author>): Author {
  return agents[id] ? { n: agents[id].n, col: agents[id].col } : { n: id && id !== "w" ? id : "You", col: "#8a8f9c" };
}
