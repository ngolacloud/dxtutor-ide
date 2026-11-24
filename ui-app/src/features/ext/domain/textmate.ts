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

interface Frame {
  rule: RawRule;
  /** A regex do `end` desta regra, já com as retro-referências do `begin` substituídas. */
  end: RegExp | null;
  /** Scopes activos dentro desta regra (inclui `name` e `contentName`). */
  scopes: string[];
}

/** O estado opaco entre linhas: a pilha de regras abertas. */
export type LineState = Frame[];

export interface Grammar {
  scopeName: string;
  root: RawGrammar;
}

const cache = new Map<string, RegExp | null>();

/** Traduz uma regex Oniguruma para JavaScript; `null` se não compilar. */
export function compileOniguruma(src: string): RegExp | null {
  if (cache.has(src)) return cache.get(src)!;
  // Comentários `(?# …)` não existem em JavaScript.
  let s = src.replace(/\(\?#[^)]*\)/g, "");
  let flags = "dg";
  if (s.startsWith("(?x)")) s = stripExtended(s.slice(4));
  // Modo estendido num grupo interior `(?x: … )`: o JavaScript não tem modificadores de
  // grupo, por isso aplicamo-lo ao padrão inteiro (aproximação segura na prática).
  if (s.includes("(?x:")) s = stripExtended(s).replace(/\(\?x:/g, "(?:");
  const inline = /^\(\?i\)/.exec(s);
  if (inline) {
    s = s.slice(inline[0].length);
    flags += "i";
  }
  s = s
    .replace(/\\h/g, "[0-9a-fA-F]")
    .replace(/\\H/g, "[^0-9a-fA-F]")
    .replace(/\\A/g, "^")
    .replace(/\\[zZ]/g, "$")
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
  cache.set(src, re);
  return re;
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

/** A regex `end` de uma regra, substituindo `\1`… pelo texto capturado no `begin`. */
function endRegex(rule: RawRule, begin: RegExpExecArray): RegExp | null {
  if (!rule.end) return null;
  const src = rule.end.replace(/\\(\d)/g, (_, n) => escapeRe(begin[Number(n)] || ""));
  return compileOniguruma(src);
}

function firstMatch(re: RegExp, line: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(line);
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
        const { tokens } = tokenizeLine(sub, text, null, depth + 1);
        // O primeiro scope é o da gramática-raiz da sub-tokenização (vazio): fica de fora.
        for (const t of tokens) for (let i = t.start; i < t.end; i++) add(span[0] + i, t.scopes.slice(1));
      }
    });
  return extra;
}

/** Tokeniza uma linha a partir do estado da linha anterior (ou `null` no início). */
export function tokenizeLine(
  g: Grammar,
  line: string,
  state: LineState | null,
  depth = 0,
): { tokens: Token[]; state: LineState } {
  const stack: LineState = state ? state.slice() : [{ rule: g.root, end: null, scopes: [g.scopeName] }];
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
    if (top.end && !endLast) consider(firstMatch(top.end, line, pos), null);
    for (const rule of candidates) {
      const re = compileOniguruma((rule.match || rule.begin)!);
      if (re) consider(firstMatch(re, line, pos), rule);
    }
    if (top.end && endLast) {
      const m = firstMatch(top.end, line, pos);
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
      if (stack.length > 1) stack.pop();
    } else if (rule.match) {
      pushMatch(m, rule.name ? [...top.scopes, rule.name] : top.scopes, rule.captures);
    } else {
      const named = rule.name ? [...top.scopes, rule.name] : top.scopes;
      pushMatch(m, named, rule.beginCaptures || rule.captures);
      stack.push({
        rule,
        end: endRegex(rule, m),
        scopes: rule.contentName ? [...named, rule.contentName] : named,
      });
    }
    if (after === pos && after === m.index) {
      // Correspondência vazia: avança um carácter para nunca ficar preso.
      if (pos < line.length) push(pos, pos + 1, top.scopes);
      pos++;
    } else {
      pos = after;
    }
    if (pos >= line.length && !(rule && rule.begin)) {
      // Nada mais a consumir nesta linha (um `begin` no fim ainda abre a regra).
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
