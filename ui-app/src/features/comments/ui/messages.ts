/* Textos da feature `comments` (ADR-0004, U6: textos por chave). O editor (`.ed`) está fora do
   motor de tradução (TR_SKIP), por isso cada texto vem já na língua da interface. */
import type { Messages } from "../../../app/i18n";

export const COMMENT_MESSAGES = {
  en: {
    title: "Start discussion",
    placeholder: "Add a comment / instruction for Co-Dev…",
    add: "Add Comment to Chat",
    discard: "Discard",
    hint: "Ctrl+Enter adds · Esc closes",
    commentLine: "Comment on line {line}",
    commentLines: "Comment on lines {from}–{to}",
    ctxLine: "{path}, line {line}",
    ctxLines: "{path}, lines {from}–{to}",
    ctxComment: "Comment",
    added: "Comment added to the Co-Dev chat",
  },
  ptAO: {
    title: "Iniciar discussão",
    placeholder: "Acrescenta um comentário / instrução para o Co-Dev…",
    add: "Juntar comentário ao chat",
    discard: "Descartar",
    hint: "Ctrl+Enter junta · Esc fecha",
    commentLine: "Comentar a linha {line}",
    commentLines: "Comentar as linhas {from}–{to}",
    ctxLine: "{path}, linha {line}",
    ctxLines: "{path}, linhas {from}–{to}",
    ctxComment: "Comentário",
    added: "Comentário juntado ao chat do Co-Dev",
  },
} satisfies Messages<string>;
export type CommentKey = keyof typeof COMMENT_MESSAGES.en;
