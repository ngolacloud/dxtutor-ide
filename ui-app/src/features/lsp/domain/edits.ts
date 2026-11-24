/* ═════════ feature `lsp` — aplicar as edições de texto do servidor ═════════
   As `TextEdit` de uma `WorkspaceEdit` referem-se todas ao texto ORIGINAL do ficheiro.
   Aplicam-se do fim para o princípio, para cada uma não deslocar as seguintes. PURO. */

import { positionToOffset } from "./positions";
import type { TextEdit } from "./results";

/** O texto depois das edições. Edições sobrepostas: lança, em vez de corromper o ficheiro. */
export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const spans = edits
    .map((e) => ({ start: positionToOffset(text, e.range.start), end: positionToOffset(text, e.range.end), newText: e.newText }))
    .sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  let limit = Number.POSITIVE_INFINITY;
  for (const s of spans) {
    if (s.end > limit) throw new Error("overlapping edits");
    out = out.slice(0, s.start) + s.newText + out.slice(s.end);
    limit = s.start;
  }
  return out;
}
