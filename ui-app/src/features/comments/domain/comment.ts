/* ═════════ feature `comments` — domínio: comentar uma linha (ou um bloco) para o Co-Dev ═════════
   Ao estilo do Antigravity: na margem do editor, um botão abre «Start discussion» por baixo da
   linha; o comentário vai para o compositor do Co-Dev como um chip com o código a que se refere.
   Aqui só as contas: que linhas o comentário abrange, o rótulo do chip e o texto que o agente
   recebe. Puro: sem DOM, sem window. */

/** Linhas abrangidas (1-based, inclusivas). */
export interface LineRange {
  from: number;
  to: number;
}

/** O contexto que segue para o Co-Dev — a forma do `codev.ask` (`AskContext`), sem depender da
 *  feature Co-Dev. */
export interface CommentContext {
  kind: "comment";
  label: string;
  text: string;
  path: string;
}

/** As palavras do texto para o agente, na língua da interface. */
export interface CommentWords {
  /** `{path}`, `{from}`, `{to}` — ex.: «{path}, lines {from}–{to}». */
  lines: string;
  /** `{path}`, `{line}` — ex.: «{path}, line {line}». */
  line: string;
  /** O título do comentário — ex.: «Comment». */
  comment: string;
}

/** Número de linhas do texto (uma linha vazia no fim conta, como no editor). */
export const lineCount = (text: string): number => text.split("\n").length;

/** A linha (1-based) onde cai o carácter `offset`. */
export function lineOfOffset(text: string, offset: number): number {
  const at = Math.max(0, Math.min(text.length, offset));
  let n = 1;
  for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** A linha sob o ponteiro: `y` é a distância ao topo da primeira linha; fora do texto → null. */
export function lineAtY(y: number, lineHeight: number, lines: number): number | null {
  if (!(lineHeight > 0) || y < 0) return null;
  const n = Math.floor(y / lineHeight) + 1;
  return n >= 1 && n <= lines ? n : null;
}

/** O que o comentário abrange: a selecção, se a linha apontada estiver dentro dela; senão só a
 *  linha. Uma selecção que acaba no início de uma linha não a inclui (como no VS Code). */
export function rangeFor(line: number, text: string, selStart: number, selEnd: number): LineRange {
  if (selEnd > selStart) {
    const from = lineOfOffset(text, selStart);
    let to = lineOfOffset(text, selEnd);
    if (to > from && text.charCodeAt(selEnd - 1) === 10) to--;
    if (line >= from && line <= to) return { from, to };
  }
  return { from: line, to: line };
}

/** As linhas do intervalo, tal como estão no ficheiro. */
export function linesText(text: string, r: LineRange): string {
  return text.split("\n").slice(r.from - 1, r.to).join("\n");
}

const fileName = (path: string): string => path.split("/").pop() || path;

/** «main.rs:25» ou «main.rs:25–30». */
export const rangeLabel = (path: string, r: LineRange): string =>
  `${fileName(path)}:${r.from}${r.to > r.from ? "–" + r.to : ""}`;

/** Corta o comentário para caber no chip. */
export function preview(comment: string, max = 32): string {
  const one = comment.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1).trimEnd() + "…" : one;
}

const fill = (s: string, p: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m));

/** O chip e o texto que o agente recebe: onde, o código dessas linhas e o comentário. Um
 *  comentário vazio não gera contexto. */
export function commentContext(o: {
  path: string;
  text: string;
  range: LineRange;
  comment: string;
  words: CommentWords;
}): CommentContext | null {
  const comment = o.comment.trim();
  if (!comment) return null;
  const { from, to } = o.range;
  const where = to > from ? fill(o.words.lines, { path: o.path, from, to }) : fill(o.words.line, { path: o.path, line: from });
  const code = linesText(o.text, o.range);
  return {
    kind: "comment",
    label: `${rangeLabel(o.path, o.range)} · ${preview(comment)}`,
    text: `${where}:\n\`\`\`\n${code}\n\`\`\`\n${o.words.comment}: ${comment}`,
    path: o.path,
  };
}
