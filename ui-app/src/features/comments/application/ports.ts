/* ═════════ feature `comments` — portas ═════════
   O que o caso de uso precisa do mundo: o ficheiro aberto no editor e o `codev.ask`. */

import type { CommentContext, CommentWords } from "../domain/comment";

/** O ficheiro aberto no editor (a `textarea` da vista `file`). */
export interface EditorPort {
  /** Caminho relativo à raiz do projecto (o que o agente usa); null sem ficheiro aberto. */
  path(): string | null;
  text(): string;
  selection(): { start: number; end: number };
  /** O editor mostra uma proposta do Co-Dev por cima do ficheiro (os números de linha não são os reais). */
  showingProposal(): boolean;
}

/** O `codev.ask` partilhado (app/codev-ask): o comentário fica no compositor como chip. */
export interface AskPort {
  available(): boolean;
  ask(r: { intent: "chat"; context: CommentContext[]; send: false }): Promise<void>;
}

export interface CommentDeps {
  editor: EditorPort;
  ask: AskPort;
  words(): CommentWords;
}
