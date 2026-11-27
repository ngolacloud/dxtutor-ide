/* ═══════════ feature `ext` — contribuições declarativas de uma extensão VS Code ═══════════
   O que um VSIX contribui no `package.json` e que o dxtutor sabe usar sem um extension host
   (ADR-0005, Fase 4): linguagens (extensões de ficheiro + language-configuration),
   gramáticas TextMate, temas de cor e snippets — mais, para extensões que só arrancam um
   servidor de linguagem, a ligação a um servidor LSP conhecido. Aqui: os tipos, a lista
   de ficheiros a ler do VSIX, o mapa extensão-de-ficheiro → linguagem e o toggle de
   comentário.
   LSP P4: as linguagens declaradas (`extensions`, `filenames`, `filenamePatterns`, `firstLine`,
   `aliases`) juntam-se por id (`contributedLanguages`) e entram no registo de linguagens por baixo dele
   (`useContributed`, em `lsp/domain/registry.ts`): uma linguagem que o registo não conhece passa a ser
   uma linguagem do editor; o que o registo já reconhece fica dele, e `languageConflicts` di-lo. PURO. */

import type { VsTheme } from "./theme";
import type { RawGrammar } from "./textmate";
import type { Snippet } from "./snippets";
import {
  REGISTRY,
  languageByExtension,
  normExtension,
  registryLanguageForName,
  type ContributedLanguage,
} from "../../lsp/domain/registry";

/** Uma linguagem como o `package.json` a declara (só os campos declarativos que usamos). */
export interface LanguageDecl {
  id?: string;
  extensions?: string[];
  filenames?: string[];
  filenamePatterns?: string[];
  firstLine?: string;
  aliases?: string[];
  configuration?: string;
}

/** O bloco `contributes` (só os campos declarativos que usamos). */
export interface Contributes {
  languages?: LanguageDecl[];
  grammars?: Array<{ language?: string; scopeName?: string; path?: string }>;
  themes?: Array<{ label?: string; uiTheme?: string; path?: string; id?: string }>;
  snippets?: Array<{ language?: string; path?: string }>;
}

/** Um ficheiro que o VSIX referencia e o papel que tem. */
export interface FileRef {
  kind: "grammar" | "theme" | "snippets" | "language-configuration";
  /** Caminho dentro do zip (`extension/…`). */
  zipPath: string;
  language?: string;
  label?: string;
  scopeName?: string;
}

export interface LanguageConfig {
  lineComment?: string;
  blockComment?: [string, string];
}

/** Uma linguagem de uma extensão, como fica guardada (os campos do LSP P4 são opcionais: uma extensão
 *  instalada antes guardou só `id` e `extensions`, até ser reinstalada). */
export interface StoredLanguage {
  id: string;
  extensions: string[];
  filenames?: string[];
  filenamePatterns?: string[];
  firstLine?: string;
  aliases?: string[];
}

/** O que fica guardado de uma extensão depois de ler o VSIX. */
export interface ExtensionContributions {
  id: string;
  languages: StoredLanguage[];
  grammars: Array<{ language: string; scopeName: string; grammar: RawGrammar }>;
  themes: Array<{ label: string; uiTheme: string; theme: VsTheme }>;
  snippets: Array<{ language: string; snippets: Snippet[] }>;
  configs: Array<{ language: string; config: LanguageConfig }>;
  /** Avisos de leitura (ficheiro em falta, formato não suportado…), para mostrar ao utilizador. */
  warnings: string[];
}

/** Caminho de um ficheiro do pacote, relativo à raiz da extensão, dentro do zip. */
export function zipPathOf(relative: string): string {
  const clean = relative.replace(/^\.\//, "").replace(/\\/g, "/");
  return clean.startsWith("extension/") ? clean : `extension/${clean}`;
}

/** Os ficheiros que é preciso ler do VSIX para aplicar as contribuições. */
export function filesToRead(c: Contributes | undefined): FileRef[] {
  if (!c) return [];
  const out: FileRef[] = [];
  for (const g of c.grammars || []) {
    if (g.path && g.language) out.push({ kind: "grammar", zipPath: zipPathOf(g.path), language: g.language, scopeName: g.scopeName });
  }
  for (const t of c.themes || []) {
    if (t.path) out.push({ kind: "theme", zipPath: zipPathOf(t.path), label: t.label || t.id || t.path });
  }
  for (const s of c.snippets || []) {
    if (s.path && s.language) out.push({ kind: "snippets", zipPath: zipPathOf(s.path), language: s.language });
  }
  for (const l of c.languages || []) {
    if (l.configuration && l.id)
      out.push({ kind: "language-configuration", zipPath: zipPathOf(l.configuration), language: l.id });
  }
  return out;
}

/** Junta um caminho relativo (`./base.json`) ao do ficheiro que o referencia. */
export function resolveRelative(fromZipPath: string, relative: string): string {
  const parts = fromZipPath.split("/").slice(0, -1);
  for (const seg of relative.replace(/\\/g, "/").split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** A linguagem de uma extensão de ficheiro: primeiro o registo de linguagens (`languages/registry.json`,
 *  o mesmo que o backend lê — ganha sempre, LSP P4), depois as que as extensões instaladas declaram. */
export function languageOf(fileExt: string, installed: ExtensionContributions[]): string | undefined {
  const reg = languageByExtension(fileExt);
  if (reg) return reg.id;
  const dotted = normExtension(fileExt);
  for (const c of installed) {
    for (const l of c.languages) if (l.extensions.some(e => normExtension(e) === dotted)) return l.id;
  }
  return undefined;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
const union = (a: string[], b: string[]): string[] => [...a, ...b.filter(x => !a.includes(x))];

/** As linguagens que o `package.json` declara, como ficam guardadas: só texto, e as entradas com o mesmo
 *  id juntas (o VS Code deixa uma linguagem repartida por várias entradas). */
export function languagesOf(c: Contributes | undefined): StoredLanguage[] {
  const out: StoredLanguage[] = [];
  for (const l of c?.languages || []) {
    if (typeof l?.id !== "string" || !l.id.trim()) continue;
    const next: StoredLanguage = {
      id: l.id,
      extensions: strings(l.extensions),
      filenames: strings(l.filenames),
      filenamePatterns: strings(l.filenamePatterns),
      aliases: strings(l.aliases),
      ...(typeof l.firstLine === "string" && l.firstLine ? { firstLine: l.firstLine } : {}),
    };
    const prev = out.find(x => x.id === next.id);
    if (!prev) {
      out.push(next);
      continue;
    }
    prev.extensions = union(prev.extensions, next.extensions);
    prev.filenames = union(prev.filenames ?? [], next.filenames ?? []);
    prev.filenamePatterns = union(prev.filenamePatterns ?? [], next.filenamePatterns ?? []);
    prev.aliases = union(prev.aliases ?? [], next.aliases ?? []);
    prev.firstLine ??= next.firstLine;
  }
  return out;
}

/** As linguagens das extensões instaladas (e activas), juntadas por id pela ordem de instalação — o que o
 *  registo de linguagens (`useContributed`) e o backend (`lsp_contributions`) recebem. O nome é o primeiro
 *  dos `aliases`; o comentário de linha, o primeiro `language-configuration.json` que o tem. */
export function contributedLanguages(installed: ExtensionContributions[]): ContributedLanguage[] {
  const out: ContributedLanguage[] = [];
  for (const c of installed) {
    for (const l of c.languages || []) {
      if (!l || typeof l.id !== "string" || !l.id) continue;
      const exts = strings(l.extensions).map(normExtension);
      let m = out.find(x => x.id === l.id);
      if (!m) {
        m = { id: l.id, name: "", extensions: [], filenames: [], filenamePatterns: [], from: [] };
        out.push(m);
      }
      m.extensions = union(m.extensions, exts);
      m.filenames = union(m.filenames, strings(l.filenames));
      m.filenamePatterns = union(m.filenamePatterns, strings(l.filenamePatterns));
      if (!m.name) m.name = strings(l.aliases)[0] ?? "";
      if (!m.firstLine && typeof l.firstLine === "string" && l.firstLine) m.firstLine = l.firstLine;
      if (!m.from.includes(c.id)) m.from.push(c.id);
    }
    for (const cfg of c.configs || []) {
      const m = out.find(x => x.id === cfg.language);
      if (m && !m.lineComment && cfg.config.lineComment) m.lineComment = cfg.config.lineComment;
    }
  }
  for (const m of out) if (!m.name) m.name = m.id;
  return out;
}

/** Uma reivindicação de um VSIX que o registo de linguagens já faz por outra linguagem: o registo ganha. */
export interface LanguageConflict {
  /** a linguagem do VSIX */
  language: string;
  /** a extensão (`.h`), o nome (`Makefile`) ou o padrão que ela reivindica */
  claim: string;
  /** a linguagem do registo que fica com esses ficheiros (o nome, «C/C++») */
  kept: string;
}

/** O que, das linguagens de uma extensão, fica com o registo (porque já reconhece esses ficheiros por
 *  outra linguagem). Uma linguagem com o id de uma do registo não é conflito: é essa. Um padrão só se
 *  verifica quando o fim dele é um nome ou uma extensão literais (`**\/x/*.yml`); os outros, se o registo
 *  também os reconhecer, perdem na mesma — só não se dizem aqui. */
export function languageConflicts(c: ExtensionContributions): LanguageConflict[] {
  const out: LanguageConflict[] = [];
  const check = (language: string, claim: string, sample: string) => {
    const reg = registryLanguageForName(sample);
    if (reg && reg.id !== language && !out.some(x => x.language === language && x.claim === claim)) out.push({ language, claim, kept: reg.name });
  };
  for (const l of c.languages || []) {
    for (const e of strings(l.extensions)) check(l.id, normExtension(e), `f${normExtension(e)}`);
    for (const f of strings(l.filenames)) check(l.id, f, f);
    for (const p of strings(l.filenamePatterns)) {
      const last = p.replace(/\\/g, "/").split("/").pop() ?? "";
      if (!/[*?[\]{}]/.test(last)) check(l.id, p, last);
      else {
        const m = /^\*(\.[^*?[\]{}]+)$/.exec(last);
        if (m) check(l.id, p, `f${m[1]}`);
      }
    }
  }
  return out;
}

/** Lê um `language-configuration.json` já parseado. */
export function parseLanguageConfig(json: unknown): LanguageConfig {
  const c = (json && typeof json === "object" ? (json as { comments?: unknown }).comments : undefined) as
    | { lineComment?: unknown; blockComment?: unknown }
    | undefined;
  const out: LanguageConfig = {};
  if (c && typeof c.lineComment === "string") out.lineComment = c.lineComment;
  if (c && Array.isArray(c.blockComment) && c.blockComment.length === 2) out.blockComment = [String(c.blockComment[0]), String(c.blockComment[1])];
  return out;
}

/**
 * Comenta/descomenta com um comentário de BLOCO (`<!-- … -->`, `/* … *\/`) as linhas tocadas pela
 * selecção — o que o Ctrl+/ do VS Code faz numa linguagem sem comentário de linha: se o texto dessas
 * linhas (sem os espaços das pontas) já está entre os marcadores, tira-os; senão, põe-nos à volta.
 */
export function toggleBlockComment(
  text: string,
  selStart: number,
  selEnd: number,
  [open, close]: [string, string],
): { text: string; selStart: number; selEnd: number } {
  const lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const endAt = Math.max(selStart, selEnd > selStart && text[selEnd - 1] === "\n" ? selEnd - 1 : selEnd);
  const nl = text.indexOf("\n", endAt);
  const lineEnd = nl < 0 ? text.length : nl;
  const block = text.slice(lineStart, lineEnd);
  const lead = block.length - block.trimStart().length;
  const trail = block.length - block.trimEnd().length;
  const inner = block.slice(lead, block.length - trail);
  let next: string;
  if (inner.startsWith(open) && inner.endsWith(close) && inner.length >= open.length + close.length) {
    let body = inner.slice(open.length, inner.length - close.length);
    if (body.startsWith(" ")) body = body.slice(1);
    if (body.endsWith(" ")) body = body.slice(0, -1);
    next = body;
  } else if (!inner) {
    return { text, selStart, selEnd };
  } else next = `${open} ${inner} ${close}`;
  const changed = block.slice(0, lead) + next + block.slice(block.length - trail);
  return { text: text.slice(0, lineStart) + changed + text.slice(lineEnd), selStart: lineStart, selEnd: lineStart + changed.length };
}

/**
 * Comenta/descomenta as linhas tocadas pela selecção `[selStart, selEnd)`, como o
 * `Toggle Line Comment` do VS Code: se todas as linhas não-vazias já começam (depois da
 * indentação) pelo marcador, tira-o; senão, acrescenta-o na menor indentação comum.
 */
export function toggleLineComment(
  text: string,
  selStart: number,
  selEnd: number,
  marker: string,
): { text: string; selStart: number; selEnd: number } {
  const lines = text.split("\n");
  const lineAt = (offset: number) => text.slice(0, offset).split("\n").length - 1;
  const first = lineAt(selStart);
  const last = lineAt(Math.max(selStart, selEnd > selStart && text[selEnd - 1] === "\n" ? selEnd - 1 : selEnd));
  const touched = lines.slice(first, last + 1);
  const nonBlank = touched.filter(l => l.trim());
  const commented = nonBlank.length > 0 && nonBlank.every(l => l.trimStart().startsWith(marker));
  const indent = Math.min(...nonBlank.map(l => l.length - l.trimStart().length), Infinity);
  const changed = touched.map(l => {
    if (!l.trim()) return l;
    if (commented) {
      const i = l.indexOf(marker);
      const after = l.slice(i + marker.length);
      return l.slice(0, i) + (after.startsWith(" ") ? after.slice(1) : after);
    }
    const at = Number.isFinite(indent) ? indent : 0;
    return l.slice(0, at) + marker + " " + l.slice(at);
  });
  const out = [...lines.slice(0, first), ...changed, ...lines.slice(last + 1)].join("\n");
  // A selecção passa a cobrir as linhas alteradas (previsível com uma ou várias linhas).
  const startOfFirst = lines.slice(0, first).join("\n").length + (first > 0 ? 1 : 0);
  return { text: out, selStart: startOfFirst, selEnd: startOfFirst + changed.join("\n").length };
}

/** Extensões VS Code que, no fundo, só arrancam um servidor de linguagem — e o servidor LSP
 *  que o dxtutor arranca no lugar delas (o `command` do servidor no registo de linguagens, o que
 *  o backend procura de facto). */
export const KNOWN_LANGUAGE_SERVERS: Record<string, { language: string; server: string }> = Object.fromEntries(
  REGISTRY.servers.flatMap((s) => (s.vscodeExtensions ?? []).map((x) => [x, { language: s.id, server: s.command }] as const)),
);
