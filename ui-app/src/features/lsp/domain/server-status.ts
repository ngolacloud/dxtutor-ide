/* ═════════ feature `lsp` — o servidor da linguagem está instalado? ═════════
   Sem servidor, o backend não abre sessão nem dá erro (`lsp_server_status` diz porquê). Aqui, a
   regra PURA do aviso que o editor mostra: o nome da linguagem, o servidor que falta e como o
   instalar. Os nomes e as instruções de instalação vêm do registo de linguagens (`registry.ts`);
   o que o dxtutor pode CORRER continua a ser a lista fixa `RUNNABLE`, aqui no código. */

import { REGISTRY, serverById } from "./registry";

/** `lsp::ServerStatus` (camelCase). */
export interface ServerStatus {
  language: string;
  server: string;
  installed: boolean;
  problem?: string | null;
}

/** O nome da linguagem (do servidor) e como instalar cada servidor vêm do registo de linguagens. */
const installOf = (server: string): string | undefined => REGISTRY.servers.find((s) => s.label === server)?.install;

/** Os servidores cuja instalação é UM comando que o dxtutor pode correr num terminal (com a shell de
 *  login, para o `npm`/`go`/`dotnet`/`rustup` do utilizador), com o comando EXACTO. Os outros são
 *  instruções. A lista fica no código, não nos dados: o registo só pode mostrar um texto; só corre
 *  o que for igual, letra a letra, ao comando permitido aqui. */
const RUNNABLE: Readonly<Record<string, string>> = {
  "rust-analyzer": "rustup component add rust-analyzer",
  gopls: "go install golang.org/x/tools/gopls@latest",
  "typescript-language-server": "npm install -g typescript-language-server typescript",
  pyright: "npm install -g pyright",
  "csharp-ls": "dotnet tool install -g csharp-ls",
  sqls: "go install github.com/sqls-server/sqls@latest",
};

/** O nome da linguagem para o aviso. */
export const languageName = (id: string): string => serverById(id)?.name ?? id;

/** O aviso para um servidor em falta, ou `null` se está instalado (ou o ficheiro não tem servidor). */
export interface MissingNotice {
  title: string;
  detail: string;
  /** como instalar (comando ou instrução) */
  install: string;
  /** o comando a correr no terminal, quando a instalação é um comando; `null` se é uma instrução */
  command: string | null;
  server: string;
  language: string;
}

export function missingServerNotice(st: ServerStatus | null): MissingNotice | null {
  if (!st || st.installed) return null;
  const install = installOf(st.server) ?? `install ${st.server} and put it on PATH`;
  return {
    title: `No ${languageName(st.language)} language server`,
    detail: `dxtutor looked for ${st.server} and did not find it, so this file has no live diagnostics, hover or go to definition.`,
    install,
    command: RUNNABLE[st.server] === install ? install : null,
    server: st.server,
    language: st.language,
  };
}
