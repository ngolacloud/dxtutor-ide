/* ═════════ feature `lsp` — formatar sem servidor, só o que é seguro (LSP P5) ═════════
   O «Format Document» do dxtutor quando nenhum servidor de linguagem formata o ficheiro. Nunca
   reescreve código (não parte nem junta linhas, não mexe em nada a meio de uma linha); só:
     • tira os espaços e tabs no fim das linhas;
     • re-indenta, no estilo do PRÓPRIO ficheiro, as linhas cuja indentação usa o outro carácter:
       num ficheiro indentado com espaços, os tabs à cabeça passam a espaços (com a largura que o
       ficheiro usa); num ficheiro com tabs, os espaços à cabeça passam a tabs (o resto, menos que
       uma largura, fica — é alinhamento). Um ficheiro sem estilo dominante não é re-indentado;
     • deixa uma única quebra de linha no fim (tira as linhas vazias a mais, ou acrescenta a que falta).
   Onde o espaço tem significado não mexe: os espaços no fim de uma linha de Markdown são uma quebra
   de linha; a indentação de um Makefile (o tab), de um script de shell (o `<<-` tira tabs), de
   Markdown, de YAML ou de Haskell (a regra do layout conta colunas com tabs de 8) é sintaxe; um
   `.diff`/`.patch` fica como está. As quebras de linha CRLF ficam CRLF. O relatório diz o que mudou
   e o que ficou de propósito. PURO. */

export interface IndentStyle {
  kind: "tabs" | "spaces";
  /** a largura de um nível (espaços), ou de um tab ao converter */
  size: number;
}

export interface SafeFormatResult {
  text: string;
  changed: boolean;
  /** linhas a que se tiraram espaços no fim */
  trimmed: number;
  /** linhas re-indentadas no estilo do ficheiro */
  reindented: number;
  /** o estilo de indentação do ficheiro (`null`: sem estilo dominante) */
  indent: IndentStyle | null;
  /** `added`: faltava a quebra de linha final; `trimmed`: havia linhas vazias a mais no fim */
  finalNewline: "added" | "trimmed" | null;
  /** linhas com espaços no fim que ficaram de propósito (Markdown) */
  keptTrailing: number;
  /** linhas com a indentação do outro estilo que ficaram de propósito (Makefile, shell, Markdown, YAML, Haskell) */
  keptIndent: number;
  /** um ficheiro que não se toca (`.diff`/`.patch`) */
  untouched: boolean;
}

export interface SafeFormatOptions {
  /** o `id` da linguagem no registo (`null` se nenhuma) */
  language: string | null;
  /** o nome (ou caminho) do ficheiro */
  path: string;
  /** a largura de um tab quando o ficheiro não diz nenhuma (o Tab do editor insere 4 espaços) */
  tabSize?: number;
}

/** Linguagens onde a indentação é sintaxe que o tab/espaço muda. */
const INDENT_IS_SYNTAX = new Set(["makefile", "shellscript", "markdown", "yaml", "haskell"]);
/** Linguagens onde os espaços no fim de uma linha contam (dois espaços: quebra de linha). */
const TRAILING_COUNTS = new Set(["markdown"]);

const leadOf = (line: string): string => /^[ \t]*/.exec(line)![0];

/** O estilo de indentação de um ficheiro pelas suas linhas: tabs ou espaços (o que aparece à cabeça de
 *  mais linhas), e, para espaços, a largura de um nível — a subida mais frequente de uma linha para a
 *  seguinte (2, 4, 8…). `null` sem linhas indentadas, ou com empate. */
export function detectIndent(lines: readonly string[], tabSize = 4): IndentStyle | null {
  let tabs = 0, spaces = 0;
  const steps = new Map<number, number>();
  let prev = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const lead = leadOf(line);
    if (lead.startsWith("\t")) tabs++;
    else if (lead.length > 0) spaces++;
    if (!lead.includes("\t")) {
      const d = lead.length - prev;
      // subidas de 1 são alinhamento (` * ` de um comentário), não um nível
      if (d >= 2 && d <= 8) steps.set(d, (steps.get(d) ?? 0) + 1);
      prev = lead.length;
    }
  }
  if (tabs === spaces) return null;
  if (tabs > spaces) {
    const best = [...steps.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    return { kind: "tabs", size: best ? best[0] : tabSize };
  }
  const best = [...steps.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return { kind: "spaces", size: best ? best[0] : tabSize };
}

/** A coluna visual da indentação, com tabs de `size`. */
function columnOf(lead: string, size: number): number {
  let col = 0;
  for (const ch of lead) col = ch === "\t" ? (Math.floor(col / size) + 1) * size : col + 1;
  return col;
}

/** A indentação `lead` no estilo `style` (a mesma coluna visual). */
function restyle(lead: string, style: IndentStyle): string {
  const col = columnOf(lead, style.size);
  return style.kind === "spaces" ? " ".repeat(col) : "\t".repeat(Math.floor(col / style.size)) + " ".repeat(col % style.size);
}

/** Uma linha precisa de re-indentação? (usa o carácter do outro estilo à cabeça) */
function offStyle(lead: string, style: IndentStyle): boolean {
  if (style.kind === "spaces") return lead.includes("\t");
  // num ficheiro de tabs, só os espaços que formam pelo menos um nível antes do texto (o alinhamento fica)
  return lead !== restyle(lead, style);
}

export function safeFormat(text: string, o: SafeFormatOptions): SafeFormatResult {
  const base: SafeFormatResult = { text, changed: false, trimmed: 0, reindented: 0, indent: null, finalNewline: null, keptTrailing: 0, keptIndent: 0, untouched: false };
  if (/\.(diff|patch)$/i.test(o.path)) return { ...base, untouched: true };
  const lang = o.language;
  const trimTrailing = !(lang && TRAILING_COUNTS.has(lang));
  const reindent = !(lang && INDENT_IS_SYNTAX.has(lang));
  const crlf = text.includes("\r\n");
  const eol = crlf ? "\r\n" : "\n";
  // cada linha sem o `\r` do fim (volta a pôr-se), para as quebras CRLF ficarem como estão
  const rows = text.split("\n").map((l) => (l.endsWith("\r") ? { body: l.slice(0, -1), cr: true } : { body: l, cr: false }));
  const style = detectIndent(rows.map((r) => r.body), o.tabSize ?? 4);
  // a última linha com texto: as que vêm depois (vazias ou só com espaços) saem
  let last = rows.length - 1;
  while (last >= 0 && !rows[last].body.trim()) last--;
  let trimmed = 0, reindented = 0, keptTrailing = 0, keptIndent = 0;
  for (const r of rows.slice(0, last + 1)) {
    const bare = r.body.replace(/[ \t]+$/, "");
    if (bare !== r.body) {
      if (trimTrailing) {
        r.body = bare;
        trimmed++;
      } else keptTrailing++;
    }
    if (!style || !r.body.trim()) continue;
    const lead = leadOf(r.body);
    if (!offStyle(lead, style)) continue;
    if (!reindent) {
      keptIndent++;
      continue;
    }
    r.body = restyle(lead, style) + r.body.slice(lead.length);
    reindented++;
  }
  let out: string;
  let finalNewline: SafeFormatResult["finalNewline"] = null;
  if (last < 0) {
    // só espaços e linhas vazias: fica vazio
    out = "";
    if (text.length) finalNewline = "trimmed";
  } else {
    const kept = rows.slice(0, last + 1), end = kept[last];
    const after = rows.length - 1 - last;
    const exactlyOne = after === 1 && rows[rows.length - 1].body === "" && !rows[rows.length - 1].cr;
    if (after === 0) finalNewline = "added";
    else if (!exactlyOne) finalNewline = "trimmed";
    // a quebra que a última linha tinha (CRLF: o `\r` já vem com ela), ou a do ficheiro se faltava
    out = kept.map((r) => r.body + (r.cr ? "\r" : "")).join("\n") + (end.cr ? "\n" : after === 0 ? eol : "\n");
  }
  return { text: out, changed: out !== text, trimmed, reindented, indent: style, finalNewline, keptTrailing, keptIndent, untouched: false };
}
