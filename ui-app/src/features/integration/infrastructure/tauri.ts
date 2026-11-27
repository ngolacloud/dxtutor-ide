/* ═════════ feature `integration` — adaptador: a revisão Co-Dev e a porta de integração no backend ═════════
   A porta `ReviewGateway` sobre o cliente tipado `platform/tauri/codev-review`; as respostas estreitam-se no
   domínio (`domain/types.ts`) e uma resposta que não se lê é um erro (nunca uma porta aberta). Não toca no
   `window` (regra A8). */

import * as ipc from "../../../platform/tauri/codev-review";
import type { ReviewGateway } from "../application/ports";
import { parseEvent, parseIntegrated, parseState } from "../domain/types";

function must<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`resposta inválida do backend (${what})`);
  return v;
}

export const reviewGateway: ReviewGateway = {
  state: async (root, key) => must(parseState(await ipc.reviewState(root, key)), "codev_review_state"),
  request: (root, key, command, decidedAt, reviewer) => ipc.reviewRequest(root, key, command, decidedAt, reviewer),
  cancel: (root, key) => ipc.reviewCancel(root, key),
  integrate: async (root, key, command, decidedAt) => must(parseIntegrated(await ipc.reviewIntegrate(root, key, command, decidedAt)), "codev_review_integrate"),
  onEvent: (f) =>
    ipc.onReviewEvent((p) => {
      const e = parseEvent(p);
      if (e) f(e);
    }),
};
