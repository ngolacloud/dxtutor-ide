/* ═════════ feature `lsp` — a assinatura da chamada (signatureHelp) ═════════
   A resposta de `textDocument/signatureHelp` numa forma pronta a mostrar: o texto da
   assinatura escolhida, onde está nele cada parâmetro (o servidor dá o parâmetro como texto
   ou como intervalo `[início, fim]`), qual é o activo (o da assinatura sobrepõe-se ao geral)
   e a documentação. PURO. */

import { plainMarkdown } from "./results";

export interface SignatureView {
  /** O texto da assinatura, ex. `int add(int a, int b)`. */
  label: string;
  /** Intervalos `[início, fim)` de cada parâmetro dentro de `label`. */
  params: { start: number; end: number }[];
  /** Índice do parâmetro activo (`-1` se nenhum). */
  active: number;
  /** Documentação da assinatura e do parâmetro activo (texto simples). */
  doc: string;
  paramDoc: string;
  /** «1/3» quando há sobrecargas. */
  overloads: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const docOf = (v: unknown): string => plainMarkdown(typeof v === "string" ? v : isObj(v) && typeof v.value === "string" ? v.value : "");

/** A assinatura activa da resposta, ou `null` se não há nenhuma. */
export function signatureView(result: unknown): SignatureView | null {
  if (!isObj(result) || !Array.isArray(result.signatures) || !result.signatures.length) return null;
  const sigs = result.signatures.filter((s): s is Record<string, unknown> => isObj(s) && typeof s.label === "string");
  if (!sigs.length) return null;
  const which = Math.min(Math.max(0, Number(result.activeSignature ?? 0) || 0), sigs.length - 1);
  const sig = sigs[which];
  const label = sig.label as string;
  const params: { start: number; end: number }[] = [];
  let from = 0;
  const raw = Array.isArray(sig.parameters) ? sig.parameters : [];
  for (const p of raw) {
    const l = isObj(p) ? p.label : undefined;
    if (Array.isArray(l) && l.length === 2 && l.every((n) => Number.isFinite(Number(n)))) {
      params.push({ start: Number(l[0]), end: Number(l[1]) });
      from = Number(l[1]);
    } else if (typeof l === "string" && l) {
      const at = label.indexOf(l, from);
      if (at < 0) {
        params.push({ start: -1, end: -1 });
        continue;
      }
      params.push({ start: at, end: at + l.length });
      from = at + l.length;
    } else params.push({ start: -1, end: -1 });
  }
  const activeRaw = sig.activeParameter ?? result.activeParameter;
  const n = Number(activeRaw);
  const active = activeRaw !== undefined && activeRaw !== null && Number.isFinite(n) && n >= 0 && n < params.length ? n : -1;
  const activeParam = active >= 0 && isObj(raw[active]) ? (raw[active] as Record<string, unknown>) : null;
  return {
    label,
    params,
    active,
    doc: docOf(sig.documentation),
    paramDoc: activeParam ? docOf(activeParam.documentation) : "",
    overloads: sigs.length > 1 ? `${which + 1}/${sigs.length}` : "",
  };
}

/** A assinatura em pedaços, com o parâmetro activo marcado (para a UI pôr a negrito). */
export function signatureParts(v: SignatureView): { text: string; active: boolean }[] {
  const p = v.active >= 0 ? v.params[v.active] : undefined;
  if (!p || p.start < 0 || p.end > v.label.length || p.start >= p.end) return [{ text: v.label, active: false }];
  return [
    { text: v.label.slice(0, p.start), active: false },
    { text: v.label.slice(p.start, p.end), active: true },
    { text: v.label.slice(p.end), active: false },
  ].filter((x) => x.text);
}

/** Abrir/actualizar a assinatura? Depois de `(` ou `,` escritos (o carácter de disparo). */
export function signatureTrigger(text: string, offset: number): string | null {
  const ch = text[offset - 1];
  return ch === "(" || ch === "," ? ch : null;
}
