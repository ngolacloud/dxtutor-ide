/* ═════════ feature `lsp` — completion por palavras, sem servidor (LSP P5) ═════════
   Quando nenhum servidor de linguagem responde com sugestões (ou não há nenhum), o completion
   oferece as palavras que já estão escritas: as do ficheiro aberto (as mais perto do cursor
   primeiro) e as dos outros separadores abertos da mesma linguagem. Uma palavra é um nome:
   letras, dígitos, `_` e `$`, a começar por letra, `_` ou `$` (as mesmas letras que o completion
   aceita no prefixo). A palavra que se está a escrever não conta. PURO. */

import type { CompletionItem } from "./completion";

/** Letras de um nome (as mesmas do prefixo do completion, `completion.ts`). */
const WORD = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
const NAME_CHAR = /[\p{L}\p{N}_$]/u;

export interface WordOptions {
  /** palavras mais curtas não contam (por omissão 3) */
  minLength?: number;
  /** nem as muito compridas (por omissão 64: um hash, um blob em base64) */
  maxLength?: number;
  /** quantas palavras diferentes, no máximo (por omissão 5000) */
  limit?: number;
  /** num ficheiro enorme só se lê esta janela à volta do cursor (por omissão 200 000 caracteres para cada lado) */
  span?: number;
}

export interface WordHit {
  word: string;
  /** a menor distância (em caracteres) de uma ocorrência ao cursor */
  distance: number;
  count: number;
}

/** O nome que contém o offset (o que se está a escrever): do início ao fim do nome. */
export function wordRangeAt(text: string, offset: number): { start: number; end: number } {
  let start = offset, end = offset;
  while (start > 0 && NAME_CHAR.test(text[start - 1])) start--;
  while (end < text.length && NAME_CHAR.test(text[end])) end++;
  return { start, end };
}

/** As palavras de `text`, sem a ocorrência que cruza `skip` (o nome no cursor). `around` é o cursor
 *  (para a distância); sem cursor (outro ficheiro), a distância é a posição da primeira ocorrência. */
export function collectWords(text: string, skip: { start: number; end: number } | null, around: number | null, o: WordOptions = {}): WordHit[] {
  const min = o.minLength ?? 3, max = o.maxLength ?? 64, limit = o.limit ?? 5000, win = o.span ?? 200_000;
  const centre = around ?? 0;
  const from = Math.max(0, centre - win), to = Math.min(text.length, centre + win);
  const hits = new Map<string, WordHit>();
  WORD.lastIndex = 0;
  const slice = text.slice(from, to);
  for (let m = WORD.exec(slice); m; m = WORD.exec(slice)) {
    const word = m[0], at = from + m.index;
    if (word.length < min || word.length > max) continue;
    // um nome colado a dígitos à esquerda (`0x1f`, `3px`) não é um nome
    if (at > 0 && /\p{N}/u.test(text[at - 1])) continue;
    if (skip && at < skip.end && at + word.length > skip.start) continue;
    const distance = around === null ? at : Math.abs(at - around);
    const h = hits.get(word);
    if (h) {
      h.count++;
      if (distance < h.distance) h.distance = distance;
    } else {
      if (hits.size >= limit) continue;
      hits.set(word, { word, distance, count: 1 });
    }
  }
  return [...hits.values()];
}

/** As palavras de vários ficheiros como sugestões: primeiro as do ficheiro aberto (as mais perto do
 *  cursor primeiro), depois as dos outros (pela ordem dos ficheiros e do texto). Uma palavra aparece
 *  uma vez, com o `detail` do primeiro sítio onde aparece. */
export function wordItems(sources: ReadonlyArray<{ hits: WordHit[]; detail: string }>): CompletionItem[] {
  const seen = new Set<string>();
  const out: CompletionItem[] = [];
  for (const s of sources) {
    const sorted = [...s.hits].sort((a, b) => a.distance - b.distance || (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    for (const h of sorted) {
      if (seen.has(h.word)) continue;
      seen.add(h.word);
      out.push({
        label: h.word,
        kind: 1, // Text: como as sugestões por palavras do VS Code
        detail: s.detail,
        documentation: "",
        sortText: String(out.length).padStart(6, "0"),
        filterText: h.word,
        insert: h.word,
        snippet: false,
        edit: null,
        additional: [],
      });
    }
  }
  return out;
}
