/* ═════════ feature `lsp` — o servidor da linguagem está instalado? ═════════
   Sem servidor, o backend não abre sessão nem dá erro (`lsp_server_status` diz porquê). Aqui, a
   regra PURA do aviso que o editor mostra: a linguagem, o servidor que falta e as maneiras de o
   instalar. As maneiras vêm do backend (`lsp_install_plan`, LSP P3): ele constrói o comando EXACTO a
   partir das receitas do registo de linguagens e diz que gestores de pacotes estão presentes; a UI
   nunca compõe um comando. */

import { serverById } from "./registry";

/** `lspconf::Approval` (camelCase): um servidor que o `.dxtutor/lsp.json` do projecto pede (novo, com
 *  outro comando, ou com outras definições/initOptions). Com outro arranque, só arranca depois de o humano
 *  aprovar o comando exacto; só com definições, corre com as de confiança até ele aprovar as do projecto. */
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
  /** o projecto mudou o arranque: não arranca até ser aprovado (`false`: só definições/initOptions — corre
   *  com as de confiança até lá) */
  blocksStart: boolean;
  /** as definições/initOptions que o projecto dá e o que substituem (`null` se não mudou nenhuma) */
  config: string | null;
}

/** `lsp::ServerStatus` (camelCase). */
export interface ServerStatus {
  language: string;
  server: string;
  installed: boolean;
  problem?: string | null;
  /** onde foi encontrado: o programa que arranca (LSP P3) */
  foundAt?: string | null;
  /** foi o dxtutor que o instalou (`<dados da app>/lsp-servers`) */
  managed?: boolean;
  /** o projecto pede um comando ainda não aprovado (o servidor não arranca até lá) */
  approval?: ServerApproval | null;
}

/** Como corre uma maneira de instalar: num terminal de tarefa (o dxtutor corre-a), um download que o
 *  dxtutor faz e confere (release do GitHub), ou à mão (apt, brew: podem pedir sudo, o dxtutor não as corre). */
export type InstallMode = "terminal" | "download" | "manual";

/** `lspinstall::InstallOption` (camelCase): uma receita do registo para esta máquina. */
export interface InstallOption {
  /** o gestor (uma receita por gestor) */
  id: string;
  manager: string;
  mode: InstallMode;
  /** o gestor está no PATH da shell de login (e, para uma release, há um ficheiro para esta plataforma) */
  available: boolean;
  /** porque não: o programa que falta (`npm`, `python3`, `tar`) ou `platform` */
  missing?: string | null;
  /** a linha de comando exacta (ou, para uma release, o que o dxtutor vai fazer) */
  command: string;
  steps: string[][];
  /** onde corre o terminal de tarefa e com que ambiente (o PATH da shell de login) */
  cwd: string;
  env: Record<string, string>;
  /** onde fica: uma pasta, `toolchain` (rustup) ou `system` (apt, brew) */
  target: string;
  packages: string[];
  url?: string | null;
  sha256?: string | null;
}

/** `lspinstall::InstallPlan` (camelCase): todas as maneiras de instalar o servidor de um ficheiro. */
export interface InstallPlan {
  server: string;
  label: string;
  name: string;
  /** `<dados da app>/lsp-servers/<servidor>` */
  dir: string;
  platform: string;
  options: InstallOption[];
  /** a maneira que o aviso propõe */
  recommended?: string | null;
  /** a instrução à mão do registo (`install`) */
  manual?: string | null;
  /** porque não há receitas: `project` (o servidor, ou como arranca, vem do projecto), `command` (o teu
   *  lsp.json corre outro programa) */
  withheld?: "project" | "command" | null;
}

/** O nome da linguagem para o aviso. */
export const languageName = (id: string): string => serverById(id)?.name ?? id;

/** O pedido de aprovação pendente de um servidor (`null` se não há nenhum, ou se ele nem está instalado). */
export const pendingApproval = (st: ServerStatus | null): ServerApproval | null => (st && st.installed && st.approval ? st.approval : null);

/** O que o aviso de servidor em falta mostra, sem texto (o texto vem do catálogo, na língua da interface). */
export interface MissingNotice {
  language: string;
  languageName: string;
  server: string;
  /** as maneiras de instalar (pela ordem do registo) */
  options: InstallOption[];
  /** a maneira escolhida à partida (`null`: nenhuma está disponível) */
  selected: string | null;
  /** a instrução à mão, quando não há maneira disponível */
  manual: string | null;
  withheld: "project" | "command" | null;
  /** esta máquina (`linux-x64`, …), para dizer que uma release não tem versão para ela */
  platform: string;
}

/** O aviso para um servidor em falta, ou `null` se está instalado (ou o ficheiro não tem servidor). Sem
 *  plano (o backend não respondeu), só a instrução que o `problem` dá. */
export function missingServerNotice(st: ServerStatus | null, plan: InstallPlan | null = null): MissingNotice | null {
  if (!st || st.installed) return null;
  const options = plan?.options ?? [];
  const selected = plan?.recommended && options.some((o) => o.id === plan.recommended && o.available) ? plan.recommended : null;
  return {
    language: st.language,
    languageName: plan?.name ?? languageName(st.language),
    server: plan?.label ?? st.server,
    options,
    selected,
    manual: plan?.manual ?? null,
    withheld: plan?.withheld ?? null,
    platform: plan?.platform ?? "",
  };
}

/** Uma maneira que o dxtutor pode correr (terminal ou download) e está disponível. */
export const runnable = (o: InstallOption | undefined | null): boolean => !!o && o.available && o.mode !== "manual";

/** O nome de cada gestor como se conhece (nomes próprios: não se traduzem; a release tem texto no catálogo). */
export const MANAGER_NAMES: Readonly<Record<string, string>> = {
  npm: "npm",
  pip: "pip (venv)",
  pipx: "pipx",
  go: "go install",
  cargo: "cargo install",
  dotnet: "dotnet tool",
  gem: "gem",
  rustup: "rustup",
  brew: "Homebrew",
  apt: "apt",
};
