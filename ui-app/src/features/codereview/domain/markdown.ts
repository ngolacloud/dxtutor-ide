/* ═══════════ feature Explain · Code-Review — domínio (markdown do documento) ═══════════
   O Explain e a revisão com IA respondem em markdown, e o painel ao lado do código mostra-o
   como documento (pré-visualização) ou como texto. Este módulo só ANALISA: devolve blocos e
   pedaços em linha, sem HTML (a view escapa e desenha). PURO — sem DOM, sem `window`.

   Cobre o que os modelos escrevem: títulos (#..####), parágrafos, listas (com e sem número,
   com caixas `[ ]`/`[x]`), citações, regras `---`, tabelas GFM e blocos de código cercados
   (```lang info). Um bloco de código ainda aberto (a resposta está a chegar) conta como
   bloco até ao fim do texto, para o realce não piscar durante o stream. */

export type Inline =
  | { k: "text"; v: string }
  | { k: "code"; v: string }
  | { k: "b"; v: Inline[] }
  | { k: "i"; v: Inline[] }
  | { k: "link"; v: string; href: string }
  /** `L12`, `L12-L20`, «line 12», «linha 12»: abre o ficheiro nessa linha. */
  | { k: "line"; v: string; line: number };

export type Block =
  | { k: "h"; level: number; v: Inline[] }
  | { k: "p"; v: Inline[] }
  | { k: "list"; ordered: boolean; items: { v: Inline[]; check: boolean | null }[] }
  | { k: "quote"; v: Inline[] }
  | { k: "hr" }
  | { k: "table"; head: Inline[][]; rows: Inline[][][] }
  | { k: "code"; lang: string; info: string; v: string; open: boolean };

const LINE_RE = /\b(?:L(\d{1,6})(?:\s*[-–]\s*L?\d{1,6})?|(?:line|linha|lines|linhas)\s+(\d{1,6})(?:\s*[-–]\s*\d{1,6})?)\b/gi;

/** Os pedaços em linha: `code`, **negrito**, *itálico* ou _itálico_, [ligação](url) e referências de linha. */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  /* sem lookbehind (o WebKitGTK antigo não o tem): o carácter antes do itálico é capturado e devolvido como texto */
  const re = /(`+)([^`]|[^`][\s\S]*?[^`])\1|\*\*([^*]+?)\*\*|__([^_]+?)__|(^|[^\w*])\*([^*\s][^*]*?)\*(?!\w)|(^|[^\w_])_([^_\s][^_]*?)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let i = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => { if (t) out.push(...lineRefs(t)); };
  while ((m = re.exec(s))) {
    text(s.slice(i, m.index));
    if (m[2] !== undefined) out.push({ k: "code", v: m[2].replace(/^ (.*) $/, "$1") });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ k: "b", v: parseInline(m[3] ?? m[4]) });
    else if (m[6] !== undefined) { text(m[5]); out.push({ k: "i", v: parseInline(m[6]) }); }
    else if (m[8] !== undefined) { text(m[7]); out.push({ k: "i", v: parseInline(m[8]) }); }
    else if (m[9] !== undefined) out.push({ k: "link", v: m[9], href: m[10] });
    i = m.index + m[0].length;
  }
  text(s.slice(i));
  return out;
}

function lineRefs(t: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let m: RegExpExecArray | null;
  LINE_RE.lastIndex = 0;
  while ((m = LINE_RE.exec(t))) {
    if (m.index > i) out.push({ k: "text", v: t.slice(i, m.index) });
    out.push({ k: "line", v: m[0], line: +(m[1] ?? m[2]) });
    i = m.index + m[0].length;
  }
  if (i < t.length) out.push({ k: "text", v: t.slice(i) });
  return out;
}

const isFence = (l: string) => /^\s{0,3}(`{3,}|~{3,})/.exec(l);
const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => parseInline(c.trim()));

/** Os blocos do documento, pela ordem. */
export function parseMarkdown(src: string): Block[] {
  const ls = String(src || "").replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ k: "p", v: parseInline(para.join(" ")) }); para = []; } };
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    const f = isFence(l);
    if (f) {
      flush();
      const fence = f[1], info = l.trim().slice(fence.length).trim(), body: string[] = [];
      let open = true;
      for (i++; i < ls.length; i++) {
        if (ls[i].trim().startsWith(fence[0].repeat(fence.length)) && ls[i].trim().replace(/[`~]/g, "") === "") { open = false; break; }
        body.push(ls[i]);
      }
      out.push({ k: "code", lang: (info.split(/\s+/)[0] || "").toLowerCase(), info, v: body.join("\n"), open });
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { flush(); out.push({ k: "h", level: Math.min(4, h[1].length), v: parseInline(h[2]) }); continue; }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push({ k: "hr" }); continue; }
    if (isRow(l) && i + 1 < ls.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(ls[i + 1])) {
      flush();
      const head = cells(l), rows: Inline[][][] = [];
      for (i += 2; i < ls.length && isRow(ls[i]); i++) rows.push(cells(ls[i]));
      i--;
      out.push({ k: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(l)) {
      flush();
      const q: string[] = [];
      for (; i < ls.length && /^\s*>/.test(ls[i]); i++) q.push(ls[i].replace(/^\s*>\s?/, ""));
      i--;
      out.push({ k: "quote", v: parseInline(q.join(" ")) });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]), items: { v: Inline[]; check: boolean | null }[] = [];
      for (; i < ls.length; i++) {
        const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(ls[i]);
        if (m && /\d/.test(m[1]) === ordered) {
          const c = /^\[([ xX])\]\s+(.*)$/.exec(m[2]);
          items.push({ v: parseInline(c ? c[2] : m[2]), check: c ? c[1] !== " " : null });
        } else if (ls[i].trim() && /^\s{2,}\S/.test(ls[i]) && items.length && !isFence(ls[i])) {
          const last = items[items.length - 1];
          last.v = [...last.v, { k: "text", v: " " }, ...parseInline(ls[i].trim())];
        } else break;
      }
      i--;
      out.push({ k: "list", ordered, items });
      continue;
    }
    para.push(l.trim());
  }
  flush();
  return out;
}

/** O código melhorado de uma resposta da revisão: o bloco marcado `improved` (```rust improved),
 *  ou — se o modelo não o marcou — o maior bloco com pelo menos metade das linhas do original.
 *  `null` sem nenhum (ou com o bloco ainda a chegar). */
export function improvedCode(md: string, original: string): { lang: string; code: string } | null {
  const codes = parseMarkdown(md).filter((b): b is Extract<Block, { k: "code" }> => b.k === "code" && !b.open);
  const tagged = codes.filter(b => /\bimproved\b/i.test(b.info));
  const pick = tagged.length ? tagged[tagged.length - 1] : codes.sort((a, b) => b.v.length - a.v.length)[0];
  if (!pick) return null;
  if (!tagged.length && pick.v.split("\n").length < Math.max(3, original.split("\n").length / 2)) return null;
  const code = pick.v.endsWith("\n") || !original.endsWith("\n") ? pick.v : pick.v + "\n";
  return { lang: pick.lang, code };
}

/** O texto da resposta sem o bloco do código melhorado (o painel mostra-o à parte, com acções). */
export function withoutImproved(md: string): string {
  /* o fim do bloco é a cerca de fecho ou o fim do TEXTO (`(?![\s\S])` — com a flag `m`, `$` seria o fim da linha) */
  return md.replace(/^\s{0,3}(`{3,}|~{3,})[^\n]*\bimproved\b[^\n]*\n[\s\S]*?(?:\n\s{0,3}\1[ \t]*(?=\n|(?![\s\S]))|(?![\s\S]))/gim, "").replace(/\n{3,}/g, "\n\n").trim();
}
