/* ═════════ feature `lsp` — o servidor da linguagem está instalado? ═════════
   Sem servidor, o backend não abre sessão nem dá erro (`lsp_server_status` diz porquê). Aqui, a
   regra PURA do aviso que o editor mostra: o nome da linguagem, o servidor que falta e como o
   instalar. Os nomes e as instruções de instalação vêm do registo de linguagens (`registry.ts`);
   o que o dxtutor pode CORRER continua a ser a lista fixa `RUNNABLE`, aqui no código. */

import { REGISTRY, activeRegistry, serverById } from "./registry";

/** `lspconf::Approval` (camelCase): um servidor que o `.dxtutor/lsp.json` do projecto pede (novo, ou
 *  com outro comando) e que só arranca depois de o humano aprovar o comando exacto. */
export interface ServerApproval {
  /** a pasta aberta cujo ficheiro o pede */
  project: string;
  server: string;
  label: string;
  /** o programa (caminho absoluto) e os argumentos */
  program: string;
  args: string[];
  /** onde corre */
  cwd: string;
  /** o ficheiro que o pede */
  file: string;
  /** a que a aprovação fica presa (muda quando o comando muda) */
  hash: string;
  /** o programa está dentro da pasta do projecto (veio com o repositório) */
  insideProject: boolean;
  /** os campos de arranque que o projecto mudou */
  changed: string[];
  /** a linha de comando tal como o diálogo e a auditoria a mostram */
  command: string;
}

/** `lsp::ServerStatus` (camelCase). */
export interface ServerStatus {
  language: string;
  server: string;
  installed: boolean;
  problem?: string | null;
  /** o projecto pede um comando ainda não aprovado (o servidor não arranca até lá) */
  approval?: ServerApproval | null;
}

/** O nome da linguagem (do servidor) e como instalar cada servidor vêm do registo de linguagens. */
const installOf = (server: string): string | undefined => activeRegistry().servers.find((s) => s.label === server)?.install;

/** O servidor em uso ainda arranca o programa do registo embutido? Um override que troca o `command`
 *  (p.ex. o basedpyright no lugar do pyright) herdaria a instalação do embutido — que instalaria outro
 *  programa —, por isso aí não há «Install», só a instrução. */
function bundledCommand(server: string): boolean {
  const now = activeRegistry().servers.find((s) => s.label === server);
  const was = now ? REGISTRY.servers.find((s) => s.id === now.id) : undefined;
  return !!now && !!was && now.command === was.command && now.install === was.install;
}

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

/** O pedido de aprovação pendente de um servidor (`null` se não há nenhum, ou se ele nem está instalado). */
export const pendingApproval = (st: ServerStatus | null): ServerApproval | null => (st && st.installed && st.approval ? st.approval : null);

export function missingServerNotice(st: ServerStatus | null): MissingNotice | null {
  if (!st || st.installed) return null;
  const install = installOf(st.server) ?? `install ${st.server} and put it on PATH`;
  return {
    title: `No ${languageName(st.language)} language server`,
    detail: `dxtutor looked for ${st.server} and did not find it, so this file has no live diagnostics, hover or go to definition.`,
    install,
    command: RUNNABLE[st.server] === install && bundledCommand(st.server) ? install : null,
    server: st.server,
    language: st.language,
  };
}
