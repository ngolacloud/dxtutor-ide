/* ═══════════ feature `ext` — contribuições declarativas de uma extensão VS Code ═══════════
   O que um VSIX contribui no `package.json` e que o dxtutor sabe usar sem um extension host
   (ADR-0005, Fase 4): linguagens (extensões de ficheiro + language-configuration),
   gramáticas TextMate, temas de cor e snippets — mais, para extensões que só arrancam um
   servidor de linguagem, a ligação a um servidor LSP conhecido. Aqui: os tipos, a lista
   de ficheiros a ler do VSIX, o mapa extensão-de-ficheiro → linguagem e o toggle de
   comentário. PURO. */

import type { VsTheme } from "./theme";
import type { RawGrammar } from "./textmate";
import type { Snippet } from "./snippets";

/** O bloco `contributes` (só os campos declarativos que usamos). */
export interface Contributes {
  languages?: Array<{ id?: string; extensions?: string[]; aliases?: string[]; configuration?: string }>;
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

/** O que fica guardado de uma extensão depois de ler o VSIX. */
export interface ExtensionContributions {
  id: string;
  languages: Array<{ id: string; extensions: string[] }>;
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

/** Linguagem VS Code de cada extensão de ficheiro conhecida do editor. */
const DEFAULT_LANGUAGES: Record<string, string> = {
  rs: "rust", go: "go", py: "python", ts: "typescript", tsx: "typescriptreact", js: "javascript",
  jsx: "javascriptreact", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift", cs: "csharp",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", c: "c", h: "c", sql: "sql", md: "markdown",
  json: "json", toml: "toml", yaml: "yaml", yml: "yaml", html: "html", css: "css", sh: "shellscript",
  rb: "ruby", php: "php", lua: "lua", dart: "dart", zig: "zig", ex: "elixir", hs: "haskell",
};

/** A linguagem de uma extensão de ficheiro: primeiro as que as extensões instaladas
 *  declaram (`contributes.languages[].extensions`), depois o mapa por omissão. */
export function languageOf(fileExt: string, installed: ExtensionContributions[]): string | undefined {
  const dotted = "." + fileExt.toLowerCase();
  for (const c of installed) {
    for (const l of c.languages) if (l.extensions.some(e => e.toLowerCase() === dotted)) return l.id;
  }
  return DEFAULT_LANGUAGES[fileExt.toLowerCase()];
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
 *  que o dxtutor arranca no lugar delas. */
export const KNOWN_LANGUAGE_SERVERS: Record<string, { language: string; server: string }> = {
  "rust-lang.rust-analyzer": { language: "rust", server: "rust-analyzer" },
  "golang.go": { language: "go", server: "gopls" },
  "ms-python.python": { language: "python", server: "pyright-langserver" },
  "ms-pyright.pyright": { language: "python", server: "pyright-langserver" },
  "detachhead.basedpyright": { language: "python", server: "pyright-langserver" },
  "ms-python.vscode-pylance": { language: "python", server: "pyright-langserver" },
  "vscode.typescript-language-features": { language: "typescript", server: "typescript-language-server" },
  "llvm-vs-code-extensions.vscode-clangd": { language: "cpp", server: "clangd" },
  "ms-vscode.cpptools": { language: "cpp", server: "clangd" },
  "redhat.java": { language: "java", server: "jdtls" },
  "fwcd.kotlin": { language: "kotlin", server: "kotlin-language-server" },
  "jetbrains.kotlin": { language: "kotlin", server: "kotlin-lsp" },
  "ms-dotnettools.csharp": { language: "csharp", server: "csharp-ls" },
  "ms-dotnettools.csdevkit": { language: "csharp", server: "csharp-ls" },
  "swiftlang.swift-vscode": { language: "swift", server: "sourcekit-lsp" },
  "sswg.swift-lang": { language: "swift", server: "sourcekit-lsp" },
  "lighttiger2505.sqls": { language: "sql", server: "sqls" },
};
