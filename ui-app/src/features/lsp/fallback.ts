/* ═════════ dxtutor IDE — feature `lsp`: o editor sem servidor de linguagem (LSP P5) ═════════
   Raiz de composição das alternativas para quando nenhum servidor responde (ou não há nenhum, ou se
   está no browser): o realce pelas gramáticas TextMate que vêm com o dxtutor (`application/
   fallback-highlight`, ficheiros pelo `infrastructure/grammars`), o completion por palavras dos
   ficheiros abertos (`application/word-completion`, pelo `infrastructure/open-files`) e o «Format
   Document» seguro (`application/fallback-format`). Os comentários de bloco são domínio puro
   (`domain/comments`), usados pelo Ctrl+/ e pelo Ctrl+Shift+A das extensões (`features/ext.ts`).
   Corre no browser e na app; não tem efeitos ao avaliar (o editor importa-o). */

import { translator } from "../../app/i18n";
import { LSP_FALLBACK_MESSAGES } from "./application/fallback-messages";
import { makeFallbackHighlighter } from "./application/fallback-highlight";
import { makeWordCompletion } from "./application/word-completion";
import { formatWithoutServer } from "./application/fallback-format";
import { bundledGrammarFiles } from "./infrastructure/grammars";
import { openFiles } from "./infrastructure/open-files";

/** Os textos do editor sem servidor, na língua da interface. */
export const fallbackCopy = translator(LSP_FALLBACK_MESSAGES);

/** O realce das linguagens com uma gramática do dxtutor (uma extensão instalada ganha: o editor pergunta-lhe antes). */
export const fallbackHighlighter = makeFallbackHighlighter({ files: bundledGrammarFiles });

/** As palavras dos ficheiros abertos, quando o servidor não sugere nada. */
export const wordCompletion = makeWordCompletion({ files: openFiles, copy: fallbackCopy });

/** O «Format Document» sem servidor: o texto novo e a frase do aviso. */
export const formatFallback = (path: string, text: string): { text: string; changed: boolean; message: string } => formatWithoutServer(path, text, fallbackCopy);
