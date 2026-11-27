/* ═════════ feature `lsp` — o completion por palavras, quando o servidor não sugere nada (LSP P5) ═════════
   Os ganchos do completion (`ui/completion-hooks`) perguntam primeiro ao servidor de linguagem; quando
   ele não responde com sugestões (ou não há servidor, ou pasta), perguntam aqui. As palavras vêm do
   ficheiro aberto (as mais perto do cursor primeiro) e dos outros separadores abertos da mesma
   linguagem; cada uma diz de onde vem («word», «word · outro.py»). Nunca se juntam às do servidor.
   A lista não abre sozinha em texto corrido (Markdown, ficheiros sem linguagem conhecida) nem com
   menos de 2 letras escritas; Ctrl+Espaço abre-a sempre. Sem DOM, sem `window`. */

import { wordStartAt } from "../domain/completion";
import { collectWords, wordItems, wordRangeAt, type WordHit } from "../domain/words";
import { languageFor } from "../domain/registry";
import type { CompletionResult } from "./lsp-client";
import type { FallbackCopy } from "./fallback-messages";

export interface OpenFilesPort {
  /** a chave do ficheiro na textarea do editor (`null` sem ficheiro) */
  currentKey(): string | null;
  /** os outros ficheiros com separador aberto: chave e texto */
  others(): Array<{ key: string; text: string }>;
}

export interface WordCompletionDeps {
  files: OpenFilesPort;
  copy: FallbackCopy;
}

export interface WordCompletion {
  /** As palavras para o nome que acaba em `offset` de `text` (o texto da textarea); `null` se não há
   *  nenhuma ou se não é para abrir (`explicit`: Ctrl+Espaço). */
  at(text: string, offset: number, explicit: boolean): CompletionResult | null;
}

/** Texto corrido: a lista não abre sozinha (só com Ctrl+Espaço). */
const PROSE = new Set(["markdown"]);
/** Quantos outros separadores se lêem, no máximo. */
const MAX_OTHERS = 8;

const baseName = (key: string): string => key.slice(key.lastIndexOf("/") + 1);
const extOf = (key: string): string => {
  const b = baseName(key), dot = b.lastIndexOf(".");
  return dot > 0 ? b.slice(dot + 1).toLowerCase() : "";
};

export function makeWordCompletion(d: WordCompletionDeps): WordCompletion {
  return {
    at(text, offset, explicit) {
      const key = d.files.currentKey();
      const lang = key ? languageFor(key, text) : null;
      const wordStart = wordStartAt(text, offset);
      const typed = offset - wordStart;
      if (/^\p{N}/u.test(text.slice(wordStart, offset))) return null;
      if (!explicit && (typed < 2 || !lang || PROSE.has(lang.id))) return null;
      const here = collectWords(text, wordRangeAt(text, offset), offset);
      const sources: Array<{ hits: WordHit[]; detail: string }> = [{ hits: here, detail: d.copy("wordHere") }];
      // os outros separadores da mesma linguagem (sem linguagem conhecida: da mesma extensão)
      const sameKind = (k: string, t: string): boolean => {
        if (lang) return languageFor(k, t)?.id === lang.id;
        return !!key && extOf(k) === extOf(key);
      };
      for (const o of d.files.others().filter((f) => f.key !== key && sameKind(f.key, f.text)).slice(0, MAX_OTHERS)) {
        sources.push({ hits: collectWords(o.text, null, null), detail: d.copy("wordIn", { file: baseName(o.key) }) });
      }
      const items = wordItems(sources);
      return items.length ? { items, incomplete: false, wordStart } : null;
    },
  };
}
