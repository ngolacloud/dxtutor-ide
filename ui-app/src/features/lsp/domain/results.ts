/* ═════════ feature `lsp` — respostas do servidor, normalizadas ═════════
   As respostas de `textDocument/hover` e `textDocument/definition` têm várias formas
   permitidas pela especificação. Aqui viram uma forma só, que a UI sabe mostrar. PURO. */

/** Um bloco do hover: código (de um bloco ```) ou texto corrido. */
export interface HoverBlock {
  code: boolean;
  text: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** O texto de um bloco markdown, legível sem renderizar markdown: sem comentários HTML, links
 *  como o seu texto, sem marcas de ênfase/código, listas com «•» e sem linhas vazias a mais.
 *  (O jdtls, por exemplo, devolve `* **Parameters:**`, `<!-- -->` e `[Source](file://…)`.) */
export function plainMarkdown(md: string): string {
  // os caracteres escapados (`\*`) ficam guardados até ao fim, longe das regras de ênfase
  const escaped: string[] = [];
  return md
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, (_m, c: string) => `${escaped.push(c) - 1}`)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_m, a: string | undefined, b: string | undefined) => a ?? b ?? "")
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .split("\n")
    .map((l) => l.replace(/^(\s*)[*-]\s+/, "$1• ").replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "•")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(\d+)/g, (_m, i: string) => escaped[Number(i)] ?? "")
    .trim();
}

/** Partes de markdown em blocos: o que está entre ``` é código, o resto é texto. */
function markdownBlocks(md: string): HoverBlock[] {
  const out: HoverBlock[] = [];
  const parts = md.split(/```[^\n]*\n?/);
  parts.forEach((p, i) => {
    const code = i % 2 === 1;
    const text = code ? p.replace(/\s+$/, "").replace(/^\n+/, "") : plainMarkdown(p);
    if (text) out.push({ code, text });
  });
  return out;
}

function contentBlocks(c: unknown): HoverBlock[] {
  if (typeof c === "string") return markdownBlocks(c);
  if (Array.isArray(c)) return c.flatMap(contentBlocks);
  if (isObj(c) && typeof c.value === "string") {
    if (typeof c.language === "string") return c.value.trim() ? [{ code: true, text: c.value.trim() }] : [];
    if (c.kind === "plaintext") return c.value.trim() ? [{ code: false, text: c.value.trim() }] : [];
    return markdownBlocks(c.value);
  }
  return [];
}

/** O hover em blocos; `[]` quando não há nada a mostrar (resposta nula ou vazia). */
export function hoverBlocks(result: unknown): HoverBlock[] {
  if (!isObj(result) || !("contents" in result)) return [];
  return contentBlocks(result.contents);
}

/** Um destino de navegação: ficheiro (caminho absoluto, ou o URI se não for `file://`)
 *  e posição 0-based. */
export interface Target {
  path: string | null;
  uri: string;
  line: number;
  character: number;
}

/** `file:///a%20b/x.rs` → `/a b/x.rs`; outros esquemas (ex. `jdt://`) → `null`. */
export function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  try {
    return decodeURIComponent(uri.slice("file://".length));
  } catch {
    return null;
  }
}

function asTarget(v: unknown): Target | null {
  if (!isObj(v)) return null;
  const uri = typeof v.targetUri === "string" ? v.targetUri : typeof v.uri === "string" ? v.uri : null;
  const range = (isObj(v.targetSelectionRange) ? v.targetSelectionRange : v.range) as unknown;
  if (!uri || !isObj(range) || !isObj(range.start)) return null;
  const line = Number(range.start.line), character = Number(range.start.character);
  if (!Number.isFinite(line) || !Number.isFinite(character)) return null;
  return { path: uriToPath(uri), uri, line, character };
}

/** O primeiro destino de uma resposta de `definition` (Location | Location[] | LocationLink[]). */
export function firstTarget(result: unknown): Target | null {
  const items = Array.isArray(result) ? result : [result];
  for (const it of items) {
    const t = asTarget(it);
    if (t) return t;
  }
  return null;
}

/** O backend responde `{indexing: true}` quando a resposta veio vazia com o índice por fazer. */
export function isIndexing(result: unknown): boolean {
  return isObj(result) && result.indexing === true;
}
