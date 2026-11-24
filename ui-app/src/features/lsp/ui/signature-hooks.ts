/* ═════════ feature `lsp` — a assinatura da chamada no editor (signatureHelp) ═════════
   Um cartão por cima do cursor (`#lsp-signature`) com a assinatura da função a ser chamada e o
   parâmetro em que se está a negrito, mais a documentação dele.
     • abre depois de escrever `(` ou `,`, ou com Ctrl+Shift+Espaço;
     • enquanto está aberto, cada tecla ou movimento do cursor pergunta de novo (o servidor
       muda o parâmetro activo, ou responde nada quando o cursor sai da chamada → fecha);
     • Escape fecha (se a lista de completion não estiver aberta — aí o Escape é dela);
       sair da textarea ou clicar fora também.
   Dono do DOM do cartão. Não toca em `window`. */

import { pointOfOffset } from "../domain/positions";
import { signatureParts, signatureTrigger, type SignatureView } from "../domain/signature";
import { metricsOf } from "./editor-hooks";
import { completionOpen } from "./completion-view";

export interface SignatureHooksDeps {
  signatureHelpAt(offset: number, triggerCharacter: string | null, isRetrigger: boolean): Promise<SignatureView | null>;
  enabled(): boolean;
}

const KEY = "__lspSignatureHooks__";
const RETRIGGER_MS = 120;
const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
  t instanceof HTMLTextAreaElement && t.id === "ed-ta";

const card = (): HTMLElement | null => document.getElementById("lsp-signature");
export const signatureOpen = (): boolean => !!card();

export function closeSignature(): void {
  card()?.remove();
}

/** Mostra a assinatura com o canto inferior junto a (x, y) — por cima da linha do cursor. */
export function showSignature(v: SignatureView, x: number, y: number): void {
  let el = card();
  if (!el) {
    el = document.createElement("div");
    el.id = "lsp-signature";
    el.className = "lsp-pop lsp-signature";
    document.body.appendChild(el);
  }
  const sig = document.createElement("div");
  sig.className = "lsp-sig-label";
  for (const part of signatureParts(v)) {
    const s = document.createElement(part.active ? "b" : "span");
    s.textContent = part.text;
    sig.appendChild(s);
  }
  if (v.overloads) {
    const o = document.createElement("span");
    o.className = "lsp-sig-n";
    o.textContent = v.overloads;
    sig.prepend(o);
  }
  const nodes: HTMLElement[] = [sig];
  for (const text of [v.paramDoc, v.doc].filter(Boolean)) {
    const d = document.createElement("div");
    d.className = "lsp-sig-doc";
    d.textContent = text.split("\n").slice(0, 4).join("\n");
    nodes.push(d);
  }
  el.replaceChildren(...nodes);
  el.style.left = `${x}px`;
  el.style.top = "0px";
  const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth;
  el.style.left = `${Math.max(8, Math.min(x, vw - r.width - 8))}px`;
  el.style.top = `${Math.max(8, y - r.height - 4)}px`;
}

/** Instala os listeners. Idempotente. */
export function bindSignatureHooks(d: SignatureHooksDeps): void {
  const doc = document as Document & { [KEY]?: () => void };
  doc[KEY]?.();

  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const close = (): void => {
    seq++;
    if (timer) clearTimeout(timer);
    timer = null;
    closeSignature();
  };

  const request = async (ta: HTMLTextAreaElement, trigger: string | null): Promise<void> => {
    const retrigger = signatureOpen();
    const mine = ++seq;
    const v = await d.signatureHelpAt(ta.selectionStart, trigger, retrigger);
    if (mine !== seq || document.activeElement !== ta) return;
    if (!v) return close();
    const r = ta.getBoundingClientRect(), m = metricsOf(ta), p = pointOfOffset(ta.value, ta.selectionStart, m);
    showSignature(v, r.left + p.x - 12, r.top + p.y);
  };

  const later = (ta: HTMLTextAreaElement): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void request(ta, null), RETRIGGER_MS);
  };

  const onInput = (e: Event): void => {
    if (!isEditor(e.target) || !d.enabled()) return;
    const ta = e.target;
    const trigger = signatureTrigger(ta.value, ta.selectionStart);
    if (trigger) void request(ta, trigger);
    else if (signatureOpen()) later(ta);
  };

  const onKeyCapture = (e: KeyboardEvent): void => {
    if (!isEditor(e.target) || !d.enabled()) return;
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === " " || e.code === "Space")) {
      e.preventDefault();
      e.stopPropagation();
      void request(e.target, null);
    } else if (e.key === "Escape" && signatureOpen() && !completionOpen()) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  // depois de o cursor se mexer (setas, Home/End, clique), a assinatura acompanha-o
  const onKeyUp = (e: KeyboardEvent): void => {
    if (isEditor(e.target) && signatureOpen() && CARET_KEYS.has(e.key) && !completionOpen()) later(e.target);
  };
  const onClick = (e: MouseEvent): void => {
    if (isEditor(e.target) && signatureOpen()) later(e.target);
  };
  const onBlur = (e: FocusEvent): void => {
    if (isEditor(e.target)) close();
  };

  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKeyCapture, true);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("click", onClick);
  document.addEventListener("focusout", onBlur);
  doc[KEY] = () => {
    close();
    document.removeEventListener("input", onInput);
    document.removeEventListener("keydown", onKeyCapture, true);
    document.removeEventListener("keyup", onKeyUp);
    document.removeEventListener("click", onClick);
    document.removeEventListener("focusout", onBlur);
  };
}
