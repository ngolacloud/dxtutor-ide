/* ═════════ feature `comments` — caso de uso: um comentário de cada vez ═════════
   Abrir a discussão numa linha (ou na selecção que a contém), descartá-la, ou juntá-la ao chat
   do Co-Dev. Não toca no DOM: a UI desenha o estado que daqui sai. */

import { commentContext, rangeFor, rangeLabel, type LineRange } from "../domain/comment";
import type { CommentDeps } from "./ports";

export interface OpenComment {
  path: string;
  range: LineRange;
  /** «main.rs:25» — para o título da caixa. */
  label: string;
}

export function makeLineComments(d: CommentDeps) {
  let open: OpenComment | null = null;

  return {
    /** Pode comentar-se agora? (ficheiro aberto, Co-Dev carregado, sem proposta por cima) */
    canComment(): boolean {
      return d.ask.available() && d.editor.path() !== null && !d.editor.showingProposal();
    },
    current: (): OpenComment | null => open,
    /** Abre a discussão na linha `line` (1-based); devolve o que ficou aberto, ou null. */
    openAt(line: number): OpenComment | null {
      const path = d.editor.path();
      if (path === null || !d.ask.available() || d.editor.showingProposal()) return null;
      const { start, end } = d.editor.selection();
      const range = rangeFor(line, d.editor.text(), start, end);
      open = { path, range, label: rangeLabel(path, range) };
      return open;
    },
    discard(): void {
      open = null;
    },
    /** Junta o comentário ao chat (um chip no compositor, sem enviar). false se estiver vazio. */
    async add(comment: string): Promise<boolean> {
      if (!open) return false;
      const ctx = commentContext({ path: open.path, text: d.editor.text(), range: open.range, comment, words: d.words() });
      if (!ctx) return false;
      open = null;
      await d.ask.ask({ intent: "chat", context: [ctx], send: false });
      return true;
    },
  };
}

export type LineComments = ReturnType<typeof makeLineComments>;
