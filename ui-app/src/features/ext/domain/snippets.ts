/* ═══════════ feature `ext` — snippets VS Code ═══════════
   `contributes.snippets[]` aponta para ficheiros JSON(C) `{ nome: { prefix, body,
   description } }`. Aqui: ler esses ficheiros, escolher o snippet cujo prefixo acaba no
   cursor, e EXPANDIR o corpo na sintaxe de snippets do VS Code — tabstops (`$1`, `${1}`,
   `${1:padrão}` com padrões aninhados), escolhas (`${1|a,b|}` → a primeira), o cursor
   final (`$0`), variáveis (`$TM_FILENAME`, `${TM_SELECTED_TEXT}`, `${CURRENT_YEAR}`…) e
   escapes (`\$`, `\}`, `\\`). O resultado diz onde fica o cursor e que texto seleccionar
   (o padrão do primeiro tabstop), como no VS Code. PURO. */

export interface Snippet {
  name: string;
  prefixes: string[];
  body: string;
  description: string;
}

export interface SnippetContext {
  filename?: string;
  selectedText?: string;
  /** Data a usar nas variáveis CURRENT_* (injectada para a função ser pura). */
  now?: Date;
}

export interface Expansion {
  text: string;
  /** Início da selecção depois de expandir (relativo ao início do texto inserido). */
  selStart: number;
  /** Fim da selecção (igual ao início quando não há padrão para seleccionar). */
  selEnd: number;
}

/** Lê um ficheiro de snippets já parseado. Entradas inválidas são ignoradas. */
export function parseSnippets(json: unknown): Snippet[] {
  if (!json || typeof json !== "object") return [];
  const out: Snippet[] = [];
  for (const [name, raw] of Object.entries(json as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as { prefix?: unknown; body?: unknown; description?: unknown };
    const prefixes = (Array.isArray(r.prefix) ? r.prefix : [r.prefix]).filter(
      (p): p is string => typeof p === "string" && p.length > 0,
    );
    const body = Array.isArray(r.body) ? r.body.filter(b => typeof b === "string").join("\n") : r.body;
    if (!prefixes.length || typeof body !== "string") continue;
    out.push({ name, prefixes, body, description: typeof r.description === "string" ? r.description : "" });
  }
  return out;
}

/** O snippet cujo prefixo termina exactamente no cursor (o mais longo, se houver vários),
 *  e com uma fronteira de palavra antes dele. Devolve também o prefixo que casou. */
export function matchSnippet(lineBefore: string, snippets: Snippet[]): { snippet: Snippet; prefix: string } | null {
  let best: { snippet: Snippet; prefix: string } | null = null;
  for (const snippet of snippets) {
    for (const prefix of snippet.prefixes) {
      if (!lineBefore.endsWith(prefix)) continue;
      const before = lineBefore.slice(0, lineBefore.length - prefix.length);
      if (before && /\w$/.test(before) && /^\w/.test(prefix)) continue;
      if (!best || prefix.length > best.prefix.length) best = { snippet, prefix };
    }
  }
  return best;
}

const pad = (n: number) => String(n).padStart(2, "0");

function variable(name: string, ctx: SnippetContext): string | undefined {
  const now = ctx.now || new Date(0);
  const file = ctx.filename || "";
  const base = file.split("/").pop() || "";
  switch (name) {
    case "TM_FILENAME": return base;
    case "TM_FILENAME_BASE": return base.replace(/\.[^.]*$/, "");
    case "TM_DIRECTORY": return file.split("/").slice(0, -1).join("/");
    case "TM_FILEPATH": return file;
    case "TM_SELECTED_TEXT": return ctx.selectedText || "";
    case "CURRENT_YEAR": return String(now.getUTCFullYear());
    case "CURRENT_YEAR_SHORT": return String(now.getUTCFullYear()).slice(-2);
    case "CURRENT_MONTH": return pad(now.getUTCMonth() + 1);
    case "CURRENT_DATE": return pad(now.getUTCDate());
    case "CURRENT_HOUR": return pad(now.getUTCHours());
    case "CURRENT_MINUTE": return pad(now.getUTCMinutes());
    case "CURRENT_SECOND": return pad(now.getUTCSeconds());
    default: return undefined;
  }
}

/**
 * Expande o corpo de um snippet. `indent` é a indentação da linha onde o snippet entra
 * (aplicada às linhas seguintes) e `tab` o texto de um nível de indentação (os `\t` do
 * corpo passam a `tab`, como o VS Code faz com `insertSpaces`).
 */
export function expandSnippet(body: string, ctx: SnippetContext = {}, indent = "", tab = "    "): Expansion {
  const stops = new Map<number, { start: number; end: number }>();
  let pos = 0;
  const text = parse(body, 0, ctx, stops, () => pos, d => (pos += d)).text;
  const withIndent = (s: string) => s.replace(/\t/g, tab).replace(/\n/g, "\n" + indent);
  // Recalcula os offsets depois de aplicar a indentação/tabs.
  const remap = (offset: number) => withIndent(text.slice(0, offset)).length;
  const first = [...stops.keys()].filter(k => k > 0).sort((a, b) => a - b)[0];
  const target = first !== undefined ? stops.get(first)! : stops.get(0);
  const out = withIndent(text);
  if (!target) return { text: out, selStart: out.length, selEnd: out.length };
  return { text: out, selStart: remap(target.start), selEnd: remap(target.end) };
}

type Stops = Map<number, { start: number; end: number }>;

/** Analisador recursivo-descendente; para em `}` não escapado quando `nested`. */
function parse(
  src: string,
  from: number,
  ctx: SnippetContext,
  stops: Stops,
  pos: () => number,
  advance: (d: number) => void,
  nested = false,
): { text: string; next: number } {
  let text = "";
  let i = from;
  const emit = (s: string) => {
    text += s;
    advance(s.length);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\\" && i + 1 < src.length && "$}\\".includes(src[i + 1])) {
      emit(src[i + 1]);
      i += 2;
      continue;
    }
    if (c === "}" && nested) return { text, next: i + 1 };
    if (c !== "$") {
      emit(c);
      i++;
      continue;
    }
    // $1 / $NAME
    const simple = /^\$(\d+|[A-Za-z_]\w*)/.exec(src.slice(i));
    if (simple) {
      const key = simple[1];
      if (/^\d+$/.test(key)) {
        const n = Number(key);
        if (!stops.has(n)) stops.set(n, { start: pos(), end: pos() });
      } else {
        const v = variable(key, ctx);
        emit(v !== undefined ? v : key);
      }
      i += simple[0].length;
      continue;
    }
    // ${1}, ${1:default}, ${1|a,b|}, ${NAME}, ${NAME:default}
    const head = /^\$\{(\d+|[A-Za-z_]\w*)(:|\||\})/.exec(src.slice(i));
    if (!head) {
      emit(c);
      i++;
      continue;
    }
    const key = head[1];
    const kind = head[2];
    const isStop = /^\d+$/.test(key);
    i += head[0].length;
    if (kind === "}") {
      if (isStop) {
        const n = Number(key);
        if (!stops.has(n)) stops.set(n, { start: pos(), end: pos() });
      } else {
        const v = variable(key, ctx);
        emit(v !== undefined ? v : key);
      }
      continue;
    }
    if (kind === "|") {
      const close = src.indexOf("|}", i);
      const choices = (close < 0 ? src.slice(i) : src.slice(i, close)).split(",");
      const start = pos();
      emit(choices[0] || "");
      if (isStop && !stops.has(Number(key))) stops.set(Number(key), { start, end: pos() });
      i = close < 0 ? src.length : close + 2;
      continue;
    }
    // kind === ":" → padrão (pode conter mais tabstops)
    const start = pos();
    if (isStop) {
      const inner = parse(src, i, ctx, stops, pos, advance, true);
      text += inner.text;
      if (!stops.has(Number(key))) stops.set(Number(key), { start, end: pos() });
      i = inner.next;
    } else {
      const v = variable(key, ctx);
      // Variável conhecida: usa o valor e salta o padrão; desconhecida: usa o padrão.
      if (v !== undefined && v !== "") {
        const skip = parse(src, i, ctx, new Map(), () => 0, () => {}, true);
        emit(v);
        i = skip.next;
      } else {
        const inner = parse(src, i, ctx, stops, pos, advance, true);
        text += inner.text;
        i = inner.next;
      }
    }
  }
  return { text, next: i };
}
