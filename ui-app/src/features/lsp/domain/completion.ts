/* ═════════ feature `lsp` — completion ═════════
   A resposta de `textDocument/completion` (`CompletionList` ou `CompletionItem[]`) numa forma
   só; o filtro pelo que já se escreveu; os snippets do LSP (`$1`, `${1:nome}`, `$0`) em texto
   simples com o cursor na primeira paragem; e a aplicação do item escolhido ao texto, junto
   com os `additionalTextEdits` (ex. imports automáticos). PURO. */

import { applyTextEdits } from "./edits";
import { offsetToPosition, positionToOffset } from "./positions";
import type { Range, TextEdit } from "./results";

export interface CompletionItem {
  label: string;
  /** `CompletionItemKind` do LSP (1–25), ou `null`. */
  kind: number | null;
  detail: string;
  documentation: string;
  sortText: string;
  filterText: string;
  /** O texto a inserir (`insertText`, ou o `label`). */
  insert: string;
  /** `insertTextFormat` 2: o texto é um snippet. */
  snippet: boolean;
  /** Edição própria do item (substitui `insert` + o intervalo da palavra). */
  edit: TextEdit | null;
  additional: TextEdit[];
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function asRange(v: unknown): Range | null {
  if (!isObj(v) || !isObj(v.start) || !isObj(v.end)) return null;
  const n = [v.start.line, v.start.character, v.end.line, v.end.character].map(Number);
  return n.every(Number.isFinite) ? { start: { line: n[0], character: n[1] }, end: { line: n[2], character: n[3] } } : null;
}
function asEdit(v: unknown): TextEdit | null {
  if (!isObj(v) || typeof v.newText !== "string") return null;
  // InsertReplaceEdit (insert/replace) também é aceite: usa o intervalo de substituição
  const range = asRange(v.range) ?? asRange(v.replace) ?? asRange(v.insert);
  return range ? { range, newText: v.newText } : null;
}
function docText(v: unknown): string {
  if (typeof v === "string") return v;
  return isObj(v) && typeof v.value === "string" ? v.value : "";
}

/** A resposta do servidor em itens; `incomplete` quando o servidor quer ser perguntado de novo
 *  a cada tecla (`isIncomplete`). */
export function completionItems(result: unknown): { items: CompletionItem[]; incomplete: boolean } {
  const raw = Array.isArray(result) ? result : isObj(result) && Array.isArray(result.items) ? result.items : [];
  const incomplete = isObj(result) && !Array.isArray(result) && result.isIncomplete === true;
  const items = raw.flatMap((it): CompletionItem[] => {
    if (!isObj(it) || typeof it.label !== "string") return [];
    const label = it.label;
    return [{
      label,
      kind: typeof it.kind === "number" ? it.kind : null,
      detail: str(it.detail) || (isObj(it.labelDetails) ? str(it.labelDetails.detail) + str(it.labelDetails.description) : ""),
      documentation: docText(it.documentation),
      sortText: str(it.sortText) || label,
      filterText: str(it.filterText) || label,
      insert: str(it.insertText) || label,
      snippet: it.insertTextFormat === 2,
      edit: asEdit(it.textEdit),
      additional: Array.isArray(it.additionalTextEdits) ? it.additionalTextEdits.map(asEdit).filter((e): e is TextEdit => !!e) : [],
    }];
  });
  return { items, incomplete };
}

/** Onde começam as palavras de um nome: o início, depois de `_`/`.`/`$`, e as maiúsculas do
 *  camelCase (`getGreeting` → 0 e 3). */
function wordStarts(name: string): number[] {
  const out = [0];
  for (let i = 1; i < name.length; i++) {
    const prev = name[i - 1], ch = name[i];
    if (/[_.$]/.test(prev) || (/[A-Z]/.test(ch) && /[a-z0-9]/.test(prev))) out.push(i);
  }
  return out;
}

/** Os itens que servem para `prefix`: primeiro os que começam por ele, depois os que o têm no
 *  início de uma palavra do nome (`gre` → `getGreeting`, mas não `IntProgression`), sem
 *  distinguir maiúsculas; cada grupo pela ordem do servidor (`sortText`), sem repetidos. */
export function filterCompletions(items: readonly CompletionItem[], prefix: string, limit = 60): CompletionItem[] {
  const p = prefix.toLowerCase();
  const byServer = (a: CompletionItem, b: CompletionItem) => (a.sortText < b.sortText ? -1 : a.sortText > b.sortText ? 1 : 0);
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const k = `${i.label}\u0000${i.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const starts = unique.filter((i) => i.filterText.toLowerCase().startsWith(p)).sort(byServer);
  const inWord = p
    ? unique
        .filter((i) => !i.filterText.toLowerCase().startsWith(p) && wordStarts(i.filterText).some((at) => i.filterText.toLowerCase().startsWith(p, at)))
        .sort(byServer)
    : [];
  return [...starts, ...inWord].slice(0, limit);
}

/** Um snippet do LSP em texto simples: `${1:nome}` → `nome`, `$1`/`$0` → nada, `${1|a,b|}` →
 *  `a`, `\$` → `$`. `caret` é a primeira paragem (`$1`), senão o `$0`, senão o fim. */
export function snippetToText(snippet: string): { text: string; caret: number } {
  let out = "";
  const stops = new Map<number, number>();
  let i = 0;
  const parse = (src: string, depthEnd: string | null): void => {
    while (i < src.length) {
      const ch = src[i];
      if (depthEnd && ch === depthEnd) return;
      if (ch === "\\" && i + 1 < src.length) {
        out += src[i + 1];
        i += 2;
      } else if (ch === "$" && /\d/.test(src[i + 1] ?? "")) {
        const m = /^\d+/.exec(src.slice(i + 1))![0];
        if (!stops.has(+m)) stops.set(+m, out.length);
        i += 1 + m.length;
      } else if (ch === "$" && src[i + 1] === "{") {
        const m = /^\{(\d+)([:|])?/.exec(src.slice(i + 1));
        if (!m) {
          // ${VARIÁVEL} ou ${VARIÁVEL:valor por omissão}: sem valor aqui, fica o por omissão
          const v = /^\{([A-Za-z_]\w*)(:)?/.exec(src.slice(i + 1));
          if (!v) {
            out += ch;
            i++;
            continue;
          }
          i += 1 + v[0].length;
          if (v[2] === ":") parse(src, "}");
          else while (i < src.length && src[i] !== "}") i++;
          i++; // fecha a chaveta
          continue;
        }
        const n = +m[1];
        if (!stops.has(n)) stops.set(n, out.length);
        i += 1 + m[0].length;
        if (m[2] === "|") {
          const end = src.indexOf("|}", i);
          out += src.slice(i, end < 0 ? src.length : end).split(",")[0];
          i = end < 0 ? src.length : end + 2;
        } else {
          if (m[2] === ":") parse(src, "}");
          i++; // fecha a chaveta
        }
      } else if (ch === "$" && /[A-Za-z_]/.test(src[i + 1] ?? "")) {
        // variáveis ($TM_FILENAME…): sem valor aqui
        i += 1 + /^[A-Za-z_]\w*/.exec(src.slice(i + 1))![0].length;
      } else {
        out += ch;
        i++;
      }
    }
  };
  parse(snippet, null);
  const first = [...stops.keys()].filter((k) => k > 0).sort((a, b) => a - b)[0];
  const caret = first !== undefined ? stops.get(first)! : stops.get(0) ?? out.length;
  return { text: out, caret };
}

/** O texto depois de aceitar `item` com o cursor em `offset` (a palavra escrita começa em
 *  `wordStart`), e onde fica o cursor. */
export function applyCompletion(text: string, item: CompletionItem, offset: number, wordStart: number): { text: string; caret: number } {
  const { text: newText, caret: inner } = item.snippet ? snippetToText(item.edit ? item.edit.newText : item.insert) : { text: item.edit ? item.edit.newText : item.insert, caret: -1 };
  const range: Range = item.edit ? item.edit.range : { start: offsetToPosition(text, wordStart), end: offsetToPosition(text, offset) };
  const main: TextEdit = { range, newText };
  const startOff = positionToOffset(text, range.start);
  // as edições adicionais antes do ponto de inserção deslocam o cursor
  const shift = item.additional
    .filter((e) => positionToOffset(text, e.range.end) <= startOff)
    .reduce((n, e) => n + e.newText.length - (positionToOffset(text, e.range.end) - positionToOffset(text, e.range.start)), 0);
  const result = applyTextEdits(text, [main, ...item.additional]);
  return { text: result, caret: startOff + shift + (inner >= 0 ? inner : newText.length) };
}

/** Uma letra para o tipo do item (CompletionItemKind do LSP). */
export function kindGlyph(kind: number | null): string {
  const g: Record<number, string> = {
    1: "t", 2: "m", 3: "f", 4: "c", 5: "◇", 6: "v", 7: "C", 8: "I", 9: "M", 10: "p", 11: "u", 12: "=",
    13: "E", 14: "k", 15: "s", 16: "#", 17: "F", 18: "↗", 19: "▢", 20: "e", 21: "π", 22: "S", 23: "⚡", 24: "±", 25: "T",
  };
  return kind ? g[kind] ?? "·" : "·";
}

/** Abrir a lista sozinho? Depois de `.` (com o carácter de disparo) ou com ≥ `minWord`
 *  caracteres de um nome escrito; `null` se não. */
export function autoTrigger(text: string, offset: number, minWord = 2): { trigger: string | null; wordStart: number } | null {
  const before = text[offset - 1];
  if (before === ".") return { trigger: ".", wordStart: offset };
  let start = offset;
  while (start > 0 && /[\p{L}\p{N}_$]/u.test(text[start - 1])) start--;
  if (offset - start < minWord || /\p{N}/u.test(text[start] ?? "")) return null;
  return { trigger: null, wordStart: start };
}

/** Onde começa o nome que se está a escrever no offset. */
export function wordStartAt(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && /[\p{L}\p{N}_$]/u.test(text[start - 1])) start--;
  return start;
}
