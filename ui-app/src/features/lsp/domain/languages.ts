/* ═════════ feature `lsp` — que linguagem é este ficheiro (para o servidor) ═════════
   O `languageId` do LSP de um ficheiro, do registo de linguagens (`registry.ts`, o mesmo
   ficheiro que o backend lê): só para as linguagens com servidor — uma que o backend não serve
   não abre sessão nenhuma, por isso também não vale a pena enviá-la. Reconhece pelo nome do
   ficheiro ou pela extensão (sem distinguir maiúsculas) e, com o conteúdo, pela primeira linha
   (um shebang). PURO. */

import { languageFor, lspIdOf, serverOf } from "./registry";

/** O `languageId` LSP do ficheiro, ou `null` se nenhum servidor o trata. */
export function languageIdFor(path: string, content?: string | null): string | null {
  const lang = languageFor(path, content);
  return lang && serverOf(lang) ? lspIdOf(lang) : null;
}
