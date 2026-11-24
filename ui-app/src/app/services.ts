/* ═════════ serviços entre features (ADR-0004, U7g — decisão do dono) ═════════
   Quando uma feature precisa de outra que só avalia DEPOIS dela (no main.ts), não pode importá-la — o import
   puxava a avaliação para mais cedo e trocava a ordem dos efeitos. Até aqui lia-a pelo `window` no acto. O registo
   tipado faz o mesmo sem o `window`: o dono regista a sua API aqui ao avaliar, e quem a lê chama-a no acto
   (`services.learn!.course()`). Os tipos vêm por `import type`, que não muda a ordem de avaliação. Este módulo é
   puro (sem efeitos) e pode ser importado por qualquer um. */
import type * as Learn from "../features/learn";

export interface Services {
  /** o Learning Track (features/learn.ts), lido pelo pane do tutor, que avalia antes */
  learn: Pick<typeof Learn, "LTS" | "saveLT" | "LT_BADGE" | "course" | "ltUnits" | "ltDone" | "ltSeq" | "ltPts" | "stars" | "ltOnboard" | "ltOpen">;
}

export const services: Partial<Services> = {};
