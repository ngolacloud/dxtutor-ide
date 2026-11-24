/* ═══════════ feature `ext` — temas de cor VS Code → CSS do editor ═══════════
   Um tema VS Code (`contributes.themes[].path`) é JSON com `colors` (cores da UI, como
   `editor.background`) e `tokenColors` (regras por *scope* TextMate). O editor do dxtutor
   pinta com sete classes (`kw str num cm fn ty mac`); escolhemos, para cada uma, a regra do
   tema que melhor casa com um scope representativo — a regra cujo selector é o prefixo MAIS
   ESPECÍFICO, como faz o VS Code — e geramos CSS confinado ao editor. PURO. */

export interface VsTokenColor {
  scope?: string | string[];
  settings?: { foreground?: string; fontStyle?: string; background?: string };
}

export interface VsTheme {
  name?: string;
  type?: string;
  colors?: Record<string, string>;
  tokenColors?: VsTokenColor[];
}

export type TokenClass = "kw" | "str" | "num" | "cm" | "fn" | "ty" | "mac";

/** Scopes representativos, por ordem de preferência, de cada classe do editor. */
const REPRESENTATIVE: Record<TokenClass, string[]> = {
  kw: ["keyword.control", "keyword", "storage.modifier", "storage"],
  str: ["string.quoted", "string"],
  num: ["constant.numeric", "constant"],
  cm: ["comment.line", "comment"],
  fn: ["entity.name.function", "support.function", "meta.function-call"],
  ty: ["entity.name.type", "entity.name.class", "support.type", "support.class", "storage.type"],
  mac: ["entity.name.function.macro", "support.function.macro", "keyword.other.macro"],
};

/** Junta um tema-base (`include`) com o tema que o estende: o filho ganha. */
export function mergeThemes(base: VsTheme, child: VsTheme): VsTheme {
  return {
    ...base,
    ...child,
    colors: { ...(base.colors || {}), ...(child.colors || {}) },
    tokenColors: [...(base.tokenColors || []), ...(child.tokenColors || [])],
  };
}

/** Os selectores de uma regra: `"a, b"` ou `["a", "b"]`. Os selectores DESCENDENTES
 *  (`"meta.scope.for-loop.shell string"`) e com exclusões (`"string - meta"`) só valem num
 *  contexto; como cada classe do editor é global, ficam de fora (senão uma excepção do
 *  tema — ex. o «reset» de strings em ciclos da shell do Dracula — apagava a cor geral). */
function selectors(rule: VsTokenColor): string[] {
  const raw = rule.scope === undefined ? [] : Array.isArray(rule.scope) ? rule.scope : rule.scope.split(",");
  return raw.map(s => s.trim()).filter(s => s && !/\s|\s-\s/.test(s));
}

/** `selector` casa com `scope` se for um prefixo por segmentos (`string` ⊂ `string.quoted`). */
function prefixMatch(selector: string, scope: string): boolean {
  return scope === selector || scope.startsWith(selector + ".");
}

/** A cor (e o estilo) que o tema dá ao primeiro scope representativo que alguma regra cobre. */
export function colorFor(theme: VsTheme, cls: TokenClass): { color?: string; italic?: boolean } {
  const rules = theme.tokenColors || [];
  for (const scope of REPRESENTATIVE[cls]) {
    let best: { len: number; rule: VsTokenColor } | null = null;
    rules.forEach(rule => {
      if (!rule.settings || !rule.settings.foreground) return;
      for (const sel of selectors(rule)) {
        // Regras posteriores ganham empates (`>=`), como no VS Code.
        if (prefixMatch(sel, scope) && (!best || sel.length >= best.len)) best = { len: sel.length, rule };
      }
    });
    if (best) {
      const s = (best as { rule: VsTokenColor }).rule.settings!;
      return { color: s.foreground, italic: /italic/.test(s.fontStyle || "") };
    }
  }
  return {};
}

/** Só aceitamos cores CSS simples vindas do tema (#rgb/#rrggbb/#rrggbbaa), nunca texto livre. */
const SAFE_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const safe = (c: string | undefined): string | undefined => (c && SAFE_COLOR.test(c) ? c : undefined);

/** CSS do editor para o tema: fundo, texto, números de linha, selecção e as sete classes.
 *  Tudo prefixado por `scope` (o contentor do editor), para não pintar o resto da app. */
export function themeToCss(theme: VsTheme, scope = ".ed"): string {
  const c = theme.colors || {};
  const out: string[] = [];
  const bg = safe(c["editor.background"]);
  const fg = safe(c["editor.foreground"]);
  if (bg || fg) out.push(`${scope}{${bg ? `background:${bg};` : ""}${fg ? `color:${fg};` : ""}}`);
  const ln = safe(c["editorLineNumber.foreground"]);
  if (ln) out.push(`${scope} .ed-gut{color:${ln}}`);
  const sel = safe(c["editor.selectionBackground"]);
  if (sel) out.push(`${scope} .ed-ta::selection{background:${sel}}`);
  const caret = safe(c["editorCursor.foreground"]);
  if (caret) out.push(`${scope} .ed-ta{caret-color:${caret}}`);
  (Object.keys(REPRESENTATIVE) as TokenClass[]).forEach(cls => {
    const { color, italic } = colorFor(theme, cls);
    const col = safe(color);
    if (col) out.push(`${scope} .ed-hl .${cls}{color:${col};font-style:${italic ? "italic" : "normal"}}`);
  });
  return out.join("\n");
}
