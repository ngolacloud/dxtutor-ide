/* ═════════ feature `lsp` — o servidor da linguagem está instalado? ═════════
   Sem servidor, o backend não abre sessão nem dá erro (`lsp_server_status` diz porquê). Aqui, a
   regra PURA do aviso que o editor mostra: o nome da linguagem, o servidor que falta e como o
   instalar. Os comandos de instalação são os habituais de cada servidor. */

/** `lsp::ServerStatus` (camelCase). */
export interface ServerStatus {
  language: string;
  server: string;
  installed: boolean;
  problem?: string | null;
}

const LANGUAGE_NAME: Readonly<Record<string, string>> = {
  rust: "Rust", go: "Go", typescript: "TypeScript/JavaScript", python: "Python", cpp: "C/C++",
  swift: "Swift", csharp: "C#", java: "Java", kotlin: "Kotlin", sql: "SQL",
};

/** Como instalar cada servidor. */
const INSTALL: Readonly<Record<string, string>> = {
  "rust-analyzer": "rustup component add rust-analyzer",
  gopls: "go install golang.org/x/tools/gopls@latest",
  "typescript-language-server": "npm install -g typescript-language-server typescript",
  pyright: "npm install -g pyright",
  clangd: "install clangd from your package manager (e.g. apt install clangd)",
  "sourcekit-lsp": "it comes with the Swift toolchain (swift.org/install)",
  "csharp-ls": "dotnet tool install -g csharp-ls",
  jdtls: "download Eclipse JDT LS and put its bin folder on PATH (or in ~/.local/share/jdtls/bin)",
  "kotlin-language-server": "download kotlin-language-server and put its bin folder on PATH",
  sqls: "go install github.com/sqls-server/sqls@latest",
};

/** O nome da linguagem para o aviso. */
export const languageName = (id: string): string => LANGUAGE_NAME[id] ?? id;

/** O aviso para um servidor em falta, ou `null` se está instalado (ou o ficheiro não tem servidor). */
export function missingServerNotice(st: ServerStatus | null): { title: string; detail: string; install: string } | null {
  if (!st || st.installed) return null;
  return {
    title: `No ${languageName(st.language)} language server`,
    detail: `dxtutor looked for ${st.server} and did not find it, so this file has no live diagnostics, hover or go to definition.`,
    install: INSTALL[st.server] ?? `install ${st.server} and put it on PATH`,
  };
}
