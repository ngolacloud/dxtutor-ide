/* ═════════ feature `lsp` — formatação ═════════
   A resposta de `textDocument/formatting`/`rangeFormatting` é uma lista de `TextEdit` (ou
   `null` quando o servidor não formata). E o cursor tem de ficar onde estava: a formatação só
   mexe em espaços, por isso o cursor fica depois do mesmo número de caracteres visíveis. PURO. */

import type { TextEdit } from "./results";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** As edições da resposta, ou `null` se o servidor não formatou (sem suporte ou erro). */
export function formattingEdits(result: unknown): TextEdit[] | null {
  if (!Array.isArray(result)) return null;
  return result.flatMap((e): TextEdit[] => {
    if (!isObj(e) || typeof e.newText !== "string" || !isObj(e.range)) return [];
    const r = e.range as Record<string, unknown>;
    if (!isObj(r.start) || !isObj(r.end)) return [];
    const n = [r.start.line, r.start.character, r.end.line, r.end.character].map(Number);
    if (!n.every(Number.isFinite)) return [];
    return [{ range: { start: { line: n[0], character: n[1] }, end: { line: n[2], character: n[3] } }, newText: e.newText }];
  });
}

/** Onde fica o cursor `caret` de `before` no texto `after` (a mesma posição entre os caracteres
 *  visíveis; espaços e quebras de linha não contam). */
export function caretAfterFormatting(before: string, after: string, caret: number): number {
  let visible = 0;
  for (let i = 0; i < Math.min(caret, before.length); i++) if (!/\s/.test(before[i])) visible++;
  if (visible === 0) return 0;
  let seen = 0;
  for (let j = 0; j < after.length; j++) {
    if (!/\s/.test(after[j])) {
      seen++;
      if (seen === visible) return j + 1;
    }
  }
  return after.length;
}
