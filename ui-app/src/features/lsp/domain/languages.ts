/* ═════════ feature `lsp` — que linguagem é este ficheiro (para o servidor) ═════════
   O `languageId` do LSP por extensão. Alinhado com a tabela `LANGS` de
   `src-tauri/src/lsp.rs`: uma extensão que o backend não conhece não abre sessão nenhuma,
   por isso também não vale a pena enviá-la. PURO. */

const BY_EXTENSION: Readonly<Record<string, string>> = {
  rs: "rust",
  go: "go",
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  c: "c",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  hxx: "cpp",
  swift: "swift",
  cs: "csharp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  sql: "sql",
};

/** O `languageId` LSP do ficheiro, ou `null` se nenhum servidor o trata. */
export function languageIdFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null;
}
