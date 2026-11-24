/* ═══════════ Co-Dev — domain: the chat keeps prose (docs/v2/RF-CODEV-STREAM.md §7, I6) ═══════════
   Code Co-Dev wants applied goes to the editor through `edit`/`write`, never into the
   reply. As a safety net, fenced code blocks longer than 3 lines in the agent's reply are
   not drawn: a short line says where the code goes instead. A block still being streamed
   (no closing fence yet) counts too. Explanations (`codev.ask` with intent `explain`) do
   not go through here, so they may show code. Pure: no DOM. */

export const CODE_IN_EDITOR = "O código é aplicado no editor — pede ao Co-Dev para fazer a alteração.";

/** Most lines a fenced block may have and still be shown in the chat. */
export const MAX_CHAT_CODE_LINES = 3;

export function proseOnly(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^\s*(```|~~~)/.exec(lines[i]);
    if (!open) {
      out.push(lines[i++]);
      continue;
    }
    const fence = open[1];
    let j = i + 1;
    while (j < lines.length && !lines[j].trim().startsWith(fence)) j++;
    const body = lines.slice(i + 1, j);
    const closed = j < lines.length;
    if (body.length > MAX_CHAT_CODE_LINES) out.push(CODE_IN_EDITOR);
    else out.push(...lines.slice(i, closed ? j + 1 : j));
    i = closed ? j + 1 : j;
  }
  return out.join("\n");
}
