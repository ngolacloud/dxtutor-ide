/* ═══════════ feature `ext` — gramáticas TextMate («lite») ═══════════
   As extensões de linguagem do VS Code trazem o realce como uma gramática TextMate
   (`contributes.grammars[].path`, JSON). O VS Code corre-as com o motor Oniguruma; aqui
   não há Oniguruma (seria uma dependência nativa/wasm), por isso este tokenizador:

   - traduz cada regex Oniguruma para uma RegExp JavaScript quando é possível (`(?x)`,
     `\h`, `\A`, `\z`, quantificadores possessivos, grupos atómicos, `(?i)` inicial…) e
     IGNORA, sem rebentar, os padrões que ainda assim não compilam;
   - suporta `match`, `begin`/`end` (com retro-referências do `begin` no `end`), `captures`,
     `beginCaptures`, `endCaptures`, `contentName`, `patterns` e `include` de `#repo` e
     `$self`/`$base` — o suficiente para a grande maioria das gramáticas de linguagem;
   - guarda a pilha de regras entre linhas, para comentários e strings multi-linha;
   - como o `vscode-textmate`, tokeniza cada linha COM o `\n` do fim (as regras que acabam em `\n`
     fecham-se; os tokens não passam do fim da linha) e o `$` do Oniguruma é o fim da linha (antes do
     `\n`); o `\G` é verdadeiro só na âncora — onde acabou o `begin` da regra aberta, nessa linha —
     por isso um `end` `(?!\G)` fecha a regra logo a seguir (LSP P5: sem isto, um comentário `//` do
     Java ou um `#` do Perl pintavam o resto do ficheiro);
   - NÃO faz `include` de outras gramáticas (`source.js`…): esses blocos ficam sem realce.

   O resultado são tokens com a pilha de *scopes*, que `scopeClass` converte nas sete
   classes do editor. PURO. */

/** Uma captura: um nome de scope e/ou `patterns` que re-tokenizam o texto capturado. */
export interface RawCapture {
  name?: string;
  patterns?: RawRule[];
}

export interface RawRule {
  name?: string;
  contentName?: string;
  match?: string;
  begin?: string;
  end?: string;
  captures?: Record<string, RawCapture>;
  beginCaptures?: Record<string, RawCapture>;
  endCaptures?: Record<string, RawCapture>;
  patterns?: RawRule[];
  include?: string;
  applyEndPatternLast?: boolean | number;
}

export interface RawGrammar extends RawRule {
  scopeName?: string;
  repository?: Record<string, RawRule>;
}

export interface Token {
  start: number;
  end: number;
  scopes: string[];
}

/** Um padrão compilado. Com `\G`, duas variantes: `atAnchor` (o `\G` verdadeiro, ancorada na posição)
 *  e `re` (o `\G` falso, para as posições depois da âncora). */
interface Pattern {
  src: string;
  re: RegExp | null;
  atAnchor: RegExp | null;
  usesG: boolean;
}

interface Frame {
  rule: RawRule;
  /** O `end` desta regra, já com as retro-referências do `begin` substituídas. */
  end: Pattern | null;
  /** Scopes activos dentro desta regra (inclui `name` e `contentName`). */
  scopes: string[];
  /** A âncora (`\G`) da regra de baixo quando esta abriu — repõe-se ao fechar; só vale na mesma linha. */
  parentAnchor: number;
}

/** O estado opaco entre linhas: a pilha de regras abertas. */
export type LineState = Frame[];

export interface Grammar {
  scopeName: string;
  root: RawGrammar;
}

const cache = new Map<string, RegExp | null>();

/** Traduz uma regex Oniguruma para JavaScript; `null` se não compilar. `sticky`: só casa na posição
 *  pedida (`lastIndex`). Um `\G` que sobre conta como verdadeiro (quem precisa da âncora usa `pattern`). */
export function compileOniguruma(src: string, sticky = false): RegExp | null {
  const key = (sticky ? "y:" : "g:") + src;
  if (cache.has(key)) return cache.get(key)!;
  // Comentários `(?# …)` não existem em JavaScript.
  let s = src.replace(/\(\?#[^)]*\)/g, "");
  let flags = sticky ? "dgy" : "dg";
  if (s.startsWith("(?x)")) s = stripExtended(s.slice(4));
  // Modo estendido num grupo interior `(?x: … )`: o JavaScript não tem modificadores de
  // grupo, por isso aplicamo-lo ao padrão inteiro (aproximação segura na prática).
  if (s.includes("(?x:")) s = stripExtended(s).replace(/\(\?x:/g, "(?:");
  const inline = /^\(\?i\)/.exec(s);
  if (inline) {
    s = s.slice(inline[0].length);
    flags += "i";
  }
  s = endOfLine(s)
    .replace(/\\h/g, "[0-9a-fA-F]")
    .replace(/\\H/g, "[^0-9a-fA-F]")
    .replace(/\\A/g, "^")
    // `\Z`: o fim, ou antes do `\n` final; `\z`: o fim mesmo (depois do `\n`)
    .replace(/\\Z/g, () => "(?=\\n?$)")
    .replace(/\\z/g, () => "$")
    .replace(/\\G/g, "")
    .replace(/\(\?>/g, "(?:")
    .replace(/\(\?i:/g, "(?:")
    .replace(/([*+?}])\+/g, "$1");
  let re: RegExp | null = null;
  // Sem a flag `d` (motores antigos) perde-se só o realce por captura, não o padrão.
  const noIndices = flags.replace("d", "");
  for (const f of [flags, flags + "u", noIndices, noIndices + "u"]) {
    try {
      re = new RegExp(s, f);
      break;
    } catch {
      re = null;
    }
  }
  cache.set(key, re);
  return re;
}

/** O `$` do Oniguruma é o fim da LINHA: com a linha tokenizada com o seu `\n`, é «antes do `\n` final ou
 *  no fim». Só os `$` fora de classes e sem escape. */
function endOfLine(s: string): string {
  let out = "", inClass = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      out += c + (s[i + 1] ?? "");
      i++;
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    out += c === "$" && !inClass ? "(?=\\n?$)" : c;
  }
  return out;
}

/** Troca cada `\G` (sem escape) por `by`. */
function replaceG(s: string, by: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      if (s[i + 1] === "G") out += by;
      else out += s[i] + (s[i + 1] ?? "");
      i++;
    } else out += s[i];
  }
  return out;
}

const patterns = new Map<string, Pattern>();

/** Um padrão da gramática compilado, com as variantes do `\G` (ver `Pattern`). */
function pattern(src: string): Pattern {
  let p = patterns.get(src);
  if (p) return p;
  const usesG = replaceG(src, "\u0000") !== src;
  p = usesG
    ? { src, usesG, re: compileOniguruma(replaceG(src, "(?!)")), atAnchor: compileOniguruma(replaceG(src, "(?:)"), true) }
    : { src, usesG, re: compileOniguruma(src), atAnchor: null };
  patterns.set(src, p);
  return p;
}

/** A primeira correspondência de `p` em `text` a partir de `pos`. O `\G` só é verdadeiro na âncora: aí
 *  tenta-se a variante ancorada; depois dela, a variante com o `\G` falso. */
function search(p: Pattern | null, text: string, pos: number, anchor: number): RegExpExecArray | null {
  if (!p) return null;
  if (p.usesG && pos === anchor) {
    if (p.atAnchor) {
      p.atAnchor.lastIndex = pos;
      const m = p.atAnchor.exec(text);
      if (m) return m;
    }
    if (!p.re || pos + 1 > text.length) return null;
    p.re.lastIndex = pos + 1;
    return p.re.exec(text);
  }
  if (!p.re) return null;
  p.re.lastIndex = pos;
  return p.re.exec(text);
}

/** Modo estendido `(?x)`: espaços e comentários `#…` fora de classes não contam. */
function stripExtended(s: string): string {
  let out = "";
  let inClass = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      out += c + (s[i + 1] || "");
      i++;
      continue;
    }
    if (c === "[") inClass = true;
    if (c === "]") inClass = false;
    if (!inClass && /\s/.test(c)) continue;
    if (!inClass && c === "#") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    out += c;
  }
  return out;
}

export function loadGrammar(raw: RawGrammar): Grammar {
  return { scopeName: raw.scopeName || "source", root: raw };
}

/** Os padrões efectivos de uma regra, com os `include` resolvidos (sem ciclos). */
function patternsOf(g: Grammar, rule: RawRule, seen = new Set<RawRule>()): RawRule[] {
  const out: RawRule[] = [];
  for (const p of rule.patterns || []) {
    if (p.include) {
      const target =
        p.include === "$self" || p.include === "$base"
          ? g.root
          : p.include.startsWith("#")
            ? (g.root.repository || {})[p.include.slice(1)]
            : undefined;
      if (!target || seen.has(target)) continue;
      seen.add(target);
      if (target.match || target.begin) out.push(target);
      else out.push(...patternsOf(g, target, seen));
    } else if (p.match || p.begin) {
      out.push(p);
    } else if (p.patterns) {
      out.push(...patternsOf(g, p, seen));
    }
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** O `end` de uma regra, substituindo `\1`… pelo texto capturado no `begin`. */
function endPattern(rule: RawRule, begin: RegExpExecArray): Pattern | null {
  if (!rule.end) return null;
  return pattern(rule.end.replace(/\\(\d)/g, (_, n) => escapeRe(begin[Number(n)] || "")));
}

/** Aplica as capturas a uma correspondência: devolve os scopes extra por carácter. Uma
 *  captura com `patterns` re-tokeniza o texto capturado com essas regras (com acesso ao
 *  `repository` da gramática), como no TextMate. */
function captureScopes(
  g: Grammar,
  line: string,
  m: RegExpExecArray,
  caps: Record<string, RawCapture> | undefined,
  depth: number,
): Map<number, string[]> {
  const extra = new Map<number, string[]>();
  const idx = (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> }).indices;
  if (!caps || !idx) return extra;
  const add = (i: number, scopes: string[]) => extra.set(i, [...(extra.get(i) || []), ...scopes]);
  Object.keys(caps)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach(k => {
      const cap = caps[String(k)];
      const span = idx[k];
      if (!cap || !span || span[1] <= span[0]) return;
      if (cap.name) for (let i = span[0]; i < span[1]; i++) add(i, [cap.name]);
      if (cap.patterns && depth < 4) {
        const sub: Grammar = { scopeName: "", root: { ...g.root, patterns: cap.patterns } };
        const text = line.slice(span[0], span[1]);
        const { tokens } = tokenizeText(sub, text, null, depth + 1);
        // O primeiro scope é o da gramática-raiz da sub-tokenização (vazio): fica de fora.
        for (const t of tokens) for (let i = t.start; i < t.end; i++) add(span[0] + i, t.scopes.slice(1));
      }
    });
  return extra;
}

/** Tokeniza uma linha a partir do estado da linha anterior (ou `null` no início). A linha vai com o seu
 *  `\n` (como no `vscode-textmate`); os tokens acabam no fim da linha. */
export function tokenizeLine(
  g: Grammar,
  line: string,
  state: LineState | null,
  depth = 0,
): { tokens: Token[]; state: LineState } {
  const r = tokenizeText(g, line + "\n", state, depth);
  const tokens = r.tokens.filter((t) => t.start < line.length).map((t) => (t.end > line.length ? { ...t, end: line.length } : t));
  return { tokens, state: r.state };
}

function tokenizeText(g: Grammar, line: string, state: LineState | null, depth: number): { tokens: Token[]; state: LineState } {
  // a âncora de cada regra só vale na linha onde abriu
  const stack: LineState = state ? state.map((f) => ({ ...f, parentAnchor: -1 })) : [{ rule: g.root, end: null, scopes: [g.scopeName], parentAnchor: -1 }];
  /** onde acabou o `begin` da regra aberta, nesta linha (o `\G`); -1 se não abriu nesta linha */
  let anchor = -1;
  const tokens: Token[] = [];
  const push = (start: number, end: number, scopes: string[]) => {
    if (end <= start) return;
    const last = tokens[tokens.length - 1];
    if (last && last.end === start && last.scopes.join(" ") === scopes.join(" ")) last.end = end;
    else tokens.push({ start, end, scopes });
  };
  const pushMatch = (m: RegExpExecArray, base: string[], caps: Record<string, RawCapture> | undefined) => {
    const extra = captureScopes(g, line, m, caps, depth);
    for (let i = m.index; i < m.index + m[0].length; i++) push(i, i + 1, [...base, ...(extra.get(i) || [])]);
  };

  let pos = 0;
  /** mudanças de estado (abrir/fechar regras) sem avançar: um laço numa gramática estragada pára aqui */
  let stuck = 0;
  for (let guard = 0; guard < 2000 && pos <= line.length; guard++) {
    const top = stack[stack.length - 1];
    const candidates = patternsOf(g, top.rule);
    let best: { m: RegExpExecArray; rule: RawRule | null } | null = null;
    // O `end` da regra aberta ganha empates, salvo `applyEndPatternLast`.
    const endLast = !!top.rule.applyEndPatternLast;
    const consider = (m: RegExpExecArray | null, rule: RawRule | null) => {
      if (!m) return;
      if (!best || m.index < best.m.index) best = { m, rule };
    };
    if (!endLast) consider(search(top.end, line, pos, anchor), null);
    for (const rule of candidates) consider(search(pattern((rule.match || rule.begin)!), line, pos, anchor), rule);
    if (endLast) {
      const m = search(top.end, line, pos, anchor);
      if (m && (!best || m.index < (best as { m: RegExpExecArray }).m.index)) best = { m, rule: null };
    }
    if (!best) {
      push(pos, line.length, top.scopes);
      break;
    }
    const { m, rule } = best as { m: RegExpExecArray; rule: RawRule | null };
    push(pos, m.index, top.scopes);
    const after = m.index + m[0].length;
    if (rule === null) {
      // Fecha a regra aberta: o delimitador leva o `name`, não o `contentName`.
      const outer = top.rule.contentName ? top.scopes.slice(0, -1) : top.scopes;
      pushMatch(m, outer, top.rule.endCaptures || top.rule.captures);
      if (stack.length > 1) anchor = stack.pop()!.parentAnchor;
    } else if (rule.match) {
      pushMatch(m, rule.name ? [...top.scopes, rule.name] : top.scopes, rule.captures);
    } else {
      const named = rule.name ? [...top.scopes, rule.name] : top.scopes;
      pushMatch(m, named, rule.beginCaptures || rule.captures);
      stack.push({
        rule,
        end: endPattern(rule, m),
        scopes: rule.contentName ? [...named, rule.contentName] : named,
        parentAnchor: anchor,
      });
      anchor = after;
    }
    if (after > pos) {
      pos = after;
      stuck = 0;
    } else if ((rule && rule.match) || ++stuck > 16) {
      // Correspondência vazia sem mudar de estado (ou um laço): avança um carácter para nunca ficar preso.
      if (pos < line.length) push(pos, pos + 1, stack[stack.length - 1].scopes);
      pos++;
      stuck = 0;
    }
    if (pos >= line.length && !(rule && rule.begin) && rule !== null) {
      // Nada mais a consumir nesta linha (um `begin` no fim ainda abre a regra; um `end` vazio no fim
      // fecha a regra e deixa os de baixo tentar fechar também).
      break;
    }
  }
  return { tokens, state: stack };
}

/** Classe do editor para uma pilha de scopes (o scope mais interior decide). */
export function scopeClass(scopes: string[]): string {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (/^comment\b/.test(s) || /\.comment\b/.test(s)) return "cm";
    if (/^(entity\.name\.function\.macro|support\.function\.macro)/.test(s)) return "mac";
    if (/^string\b/.test(s)) return "str";
    if (/^constant\.(numeric|character|language)/.test(s) || /^constant\b/.test(s)) return "num";
    if (/^(entity\.name\.(type|class|struct|enum|interface|namespace)|support\.(type|class)|storage\.type)/.test(s))
      return /^storage\.type/.test(s) ? "kw" : "ty";
    if (/^(entity\.name\.function|support\.function|meta\.function-call\.name)/.test(s)) return "fn";
    if (/^(keyword(?!\.operator)|storage|variable\.language|entity\.name\.tag)/.test(s)) return "kw";
    if (/^entity\.other\.attribute-name/.test(s)) return "fn";
  }
  return "";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML de cada linha de um documento, com o estado a passar de linha para linha. */
export function highlightLines(g: Grammar, lines: string[]): string[] {
  let state: LineState | null = null;
  return lines.map(line => {
    const r = tokenizeLine(g, line, state);
    state = r.state;
    let html = "";
    let pos = 0;
    for (const t of r.tokens) {
      if (t.start > pos) html += esc(line.slice(pos, t.start));
      const cls = scopeClass(t.scopes);
      const text = esc(line.slice(t.start, t.end));
      html += cls ? `<span class="${cls}">${text}</span>` : text;
      pos = t.end;
    }
    return html + esc(line.slice(pos));
  });
}
