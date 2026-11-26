/* ═════════ copiar para a área de transferência (partilhado) ═════════
   No WebKitGTK da app desktop o `navigator.clipboard.writeText` pode não existir ou recusar (fora de
   um contexto que ele considere seguro, ou sem permissão), e os botões «Copy» não copiavam nada. Aqui
   copia-se primeiro pelo caminho SÍNCRONO (`execCommand("copy")` numa textarea escondida, que precisa
   de correr dentro do clique — por isso antes de qualquer `await`) e, se esse falhar, pela API
   assíncrona. Devolve se copiou. Sem `window` (só `document`/`navigator`). */

function copySync(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none";
  const prev = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  prev?.focus?.({ preventScroll: true });
  return ok;
}

/** Copia `text`; resolve `true` se copiou. Chamar directamente no handler do clique. */
export async function copyText(text: string): Promise<boolean> {
  if (copySync(text)) return true;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* recusado */ }
  return false;
}
