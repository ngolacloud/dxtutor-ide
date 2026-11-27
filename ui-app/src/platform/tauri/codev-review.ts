/* ═════════ dxtutor IDE — adaptador tipado: a revisão Co-Dev e a porta de integração (Multi Co-Dev, fase 4) ═════════
   Cliente dos comandos de `src-tauri/src/commands/codev_review.rs`. As respostas chegam como `unknown` e a
   feature `integration` estreita-as no domínio (`features/integration/domain/types.ts`). A regra (as três
   condições) vive no Rust; aqui só se pede. Ver IPC-MATRIX.md §10b''. */

import { invoke, listen } from "./core";

/** A porta da issue agora, a revisão mais recente e o que cada botão correria (só leitura). */
export const reviewState = (root: string, key: string): Promise<unknown> => invoke<unknown>("codev_review_state", { root, key });

/** «Request review» com o comando aprovado; devolve o id da revisão (o resto chega por evento). */
export const reviewRequest = (
  root: string,
  key: string,
  command: string,
  decidedAt: number,
  reviewer: { provider?: string; model?: string; language?: string },
): Promise<number> => invoke<number>("codev_review_request", { root, key, command, decidedAt, ...reviewer });

/** Pára a revisão a correr da issue. */
export const reviewCancel = (root: string, key: string): Promise<boolean> => invoke<boolean>("codev_review_cancel", { root, key });

/** «Integrate» com o comando aprovado (o Rust pergunta a porta outra vez). */
export const reviewIntegrate = (root: string, key: string, command: string, decidedAt: number): Promise<unknown> =>
  invoke<unknown>("codev_review_integrate", { root, key, command, decidedAt });

/** Os passos de uma revisão a correr (`codev-review://event`). */
export const onReviewEvent = (f: (payload: unknown) => void): Promise<() => void> => listen("codev-review://event", f);
