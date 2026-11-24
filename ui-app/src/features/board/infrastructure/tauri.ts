/* ═════════ feature `board` — adaptador Tauri (ADR-0006, R3b) ═════════
   `board_load`/`board_save` (src-tauri/src/board.rs): o backlog de uma pasta, num SQLite da
   app (chaveado pela raiz). Não toca em `window` (o cliente tipado é que o faz). */

import { invoke, type Invoker } from "../../../platform/tauri/core";
import type { BacklogDto } from "../domain/persist";

export const tauriBoard = (inv: Invoker = invoke) => ({
  load: (root: string): Promise<BacklogDto | null> => inv<BacklogDto | null>("board_load", { root }),
  save: (root: string, backlog: BacklogDto): Promise<void> => inv<void>("board_save", { root, backlog }),
});
