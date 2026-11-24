/* ═════════ feature `lsp` — posições no texto ═════════
   O LSP fala em `{line, character}` (0-based, `character` em unidades UTF-16). As strings
   de JavaScript também indexam em UTF-16, por isso um offset da textarea converte-se
   directamente. Inclui a geometria do editor: de um ponto do rato (coordenadas relativas
   à textarea) para um offset, com tabs expandidos. PURO. */

export interface Position {
  line: number;
  character: number;
}

/** Offset (como `selectionStart`) → posição LSP. */
export function offsetToPosition(text: string, offset: number): Position {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const nl = before.lastIndexOf("\n");
  let line = 0;
  for (let i = 0; i < before.length; i++) if (before.charCodeAt(i) === 10) line++;
  return { line, character: before.length - (nl + 1) };
}

/** Posição LSP → offset no texto (presa ao fim da linha e do texto). */
export function positionToOffset(text: string, pos: Position): number {
  let offset = 0;
  for (let l = 0; l < pos.line; l++) {
    const nl = text.indexOf("\n", offset);
    if (nl < 0) return text.length;
    offset = nl + 1;
  }
  const end = text.indexOf("\n", offset);
  const lineEnd = end < 0 ? text.length : end;
  return Math.min(offset + Math.max(0, pos.character), lineEnd);
}

/** A métrica do editor: altura de uma linha e largura de um carácter (fonte monoespaçada). */
export interface EditorMetrics {
  lineHeight: number;
  charWidth: number;
  tabSize: number;
}

/** Ponto (x, y em píxeis, relativo ao canto da textarea) → offset do carácter por baixo,
 *  ou `null` se o ponto está depois do fim da linha ou abaixo da última linha. */
export function offsetAtPoint(text: string, x: number, y: number, m: EditorMetrics): number | null {
  if (x < 0 || y < 0 || m.lineHeight <= 0 || m.charWidth <= 0) return null;
  const lines = text.split("\n");
  const lineNo = Math.floor(y / m.lineHeight);
  if (lineNo >= lines.length) return null;
  const line = lines[lineNo];
  const target = Math.floor(x / m.charWidth);
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const width = line[i] === "\t" ? m.tabSize - (col % m.tabSize) : 1;
    if (target < col + width) {
      let offset = 0;
      for (let l = 0; l < lineNo; l++) offset += lines[l].length + 1;
      return offset + i;
    }
    col += width;
  }
  return null;
}
