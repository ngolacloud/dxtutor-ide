/* ═════════ feature `lsp` — portas ═════════
   O que o cliente LSP precisa do mundo, injectado pela raiz de composição (`index.ts`):
   o backend (comandos `lsp_*` + evento `lsp://diagnostics`), o workspace aberto e o editor. */

import type { InstallPlan, ServerStatus } from "../domain/server-status";
import type { FileReport, LspConfigView } from "../domain/overrides";
import type { LimitNotice, ServersView } from "../domain/servers";

/** Os comandos `lsp_*` do backend (caminhos absolutos; posições 0-based). */
export interface LspPort {
  start(root: string): Promise<void>;
  didOpen(path: string, text: string, languageId: string): Promise<void>;
  didChange(path: string, text: string, version: number): Promise<void>;
  /** O editor fechou o ficheiro (separador fechado, ficheiro apagado ou renomeado): `didClose` (LSP P6). */
  didClose(path: string): Promise<void>;
  /** A pasta fechou (ou abriu-se outra no lugar dela): os servidores dela param (LSP P6). */
  closeFolder(root: string): Promise<void>;
  hover(path: string, line: number, character: number): Promise<unknown>;
  definition(path: string, line: number, character: number): Promise<unknown>;
  references(path: string, line: number, character: number): Promise<unknown>;
  prepareRename(path: string, line: number, character: number): Promise<unknown>;
  rename(path: string, line: number, character: number, newName: string): Promise<unknown>;
  completion(path: string, line: number, character: number, triggerCharacter: string | null): Promise<unknown>;
  signatureHelp(path: string, line: number, character: number, triggerCharacter: string | null, isRetrigger: boolean): Promise<unknown>;
  codeAction(path: string, startLine: number, startCharacter: number, endLine: number, endCharacter: number): Promise<unknown>;
  documentSymbols(path: string): Promise<unknown>;
  /** `workspace/symbol` em cada servidor que já corre na pasta `root`: `[{ language, result }]`. */
  workspaceSymbols(root: string, query: string): Promise<unknown>;
  /** O tipo no cursor: `{ supported, items }` (`supported: false` se o servidor não tem hierarquia de tipos). */
  prepareTypeHierarchy(path: string, line: number, character: number): Promise<unknown>;
  /** Os supertipos ou subtipos de um `TypeHierarchyItem` (devolvido tal como veio). */
  typeHierarchy(path: string, item: unknown, direction: "supertypes" | "subtypes"): Promise<unknown>;
  /** Formata o documento (`range` nulo) ou só o intervalo; `null` se o servidor não formatou. */
  format(path: string, tabSize: number, insertSpaces: boolean, range: { start: { line: number; character: number }; end: { line: number; character: number } } | null): Promise<unknown>;
  executeCommand(path: string, command: string, args: unknown[] | null): Promise<unknown>;
  /** O servidor pediu para aplicar uma `WorkspaceEdit` (`workspace/applyEdit`). */
  onApplyEdit(cb: (edit: unknown) => void): void;
  /** Se o servidor da linguagem do ficheiro está instalado (`null` se o ficheiro não tem servidor). */
  serverStatus(path: string): Promise<ServerStatus | null>;
  /** Avisa quando o servidor publica diagnósticos de um ficheiro (URI). */
  onDiagnostics(cb: (uri: string) => void): void;
}

/** O workspace real aberto na app. */
export interface WorkspacePort {
  /** A pasta aberta no disco (`null` no workspace de exemplo / browser). */
  diskRoot(): string | null;
  /** O prefixo das chaves do `FS` (o `ROOT` da app). */
  virtualPrefix(): string;
  /** A chave do ficheiro do separador `tabId`, se for um separador de ficheiro. */
  fileKeyOfTab(tabId: string | null): string | null;
  /** A chave do ficheiro no separador activo. */
  currentFileKey(): string | null;
  /** O texto actual do ficheiro no editor. */
  text(key: string): string | null;
}

/** O editor e as notificações. */
export interface EditorPort {
  /** Volta a pintar o ficheiro (gutter/realce com os diagnósticos novos), se estiver aberto. */
  repaint(key: string): void;
  /** Abre o ficheiro na linha (1-based) e põe o cursor na coluna (0-based). */
  open(key: string, line: number, character: number): void;
  notify(message: string): void;
  /** Grava o texto novo de um ficheiro no editor (o autosave leva-o ao disco). */
  writeFile(key: string, text: string): void;
  /** Volta a mostrar o ficheiro, se for o activo (o texto mudou por fora da textarea). */
  reload(key: string): void;
  /** Troca o texto do ficheiro activo e põe o cursor em `caret` (como uma edição: o editor
   *  actualiza o `FS` e o servidor recebe o `didChange`). */
  replaceText(key: string, text: string, caret: number): void;
  /** O «Format Document» do dxtutor (sem servidor, ou quando ele não formata). */
  builtinFormat(): void;
  /** Mostra (ou tira, com `null`) o aviso de servidor em falta no ficheiro `key`, se estiver aberto;
   *  `onDismiss` corre quando o utilizador o fecha; `acts` são os botões («Copy», «Install», «Check again»…). */
  notice(key: string, notice: EditorNotice | null, onDismiss?: () => void, acts?: NoticeActions): void;
}

/** A faixa do editor: o servidor em falta (`missing`, com o comando de instalação) ou um servidor que o
 *  projecto pede e espera pela aprovação do humano (`approval`). */
export interface EditorNotice {
  kind?: "missing" | "approval";
  title: string;
  detail: string;
  /** como instalar à mão, quando não há maneira (só `missing`) */
  install?: string;
  /** as maneiras de instalar (só `missing`, LSP P3) e a escolhida à partida */
  ways?: NoticeWay[];
  way?: string | null;
  /** uma linha a mais (o lembrete dos overrides, ou «o programa está dentro do projecto») */
  hint?: string;
  /** os textos dos botões e rótulos da faixa de servidor em falta, na língua da interface */
  labels?: NoticeLabels;
}

/** Uma maneira de instalar, já com o texto: o que se mostra no `<code>`, se o dxtutor a pode correr. */
export interface NoticeWay {
  id: string;
  label: string;
  /** o comando exacto (ou, para uma release, o que o dxtutor faz) */
  shown: string;
  /** o dxtutor corre-a («Install»); `false`: só se mostra e copia (apt, brew, ou o gestor em falta) */
  runnable: boolean;
  available: boolean;
  /** uma frase: onde fica e como corre */
  note: string;
}

export interface NoticeLabels {
  toInstall: string;
  way: string;
  copy: string;
  install: string;
  installTip: string;
  recheck: string;
  dismiss: string;
  configure: string;
}

/** Os botões da faixa. `install(maneira)` só serve uma maneira que o dxtutor corre; `copy(maneira)` copia o
 *  comando da maneira (ou a instrução, sem maneira); `recheck` volta a procurar o servidor (depois de o
 *  instalares à mão); `configure` abre o `lsp.json` do utilizador; `review` abre o diálogo de aprovação. */
export interface NoticeActions {
  copy?: (way: string | null) => void;
  install?: (way: string) => void;
  recheck?: () => void;
  configure?: () => void;
  review?: () => void;
}

/** Os comandos dos overrides do registo (LSP P2): `lsp_config`, `lsp_config_file`,
 *  `lsp_user_config_save`, `lsp_approve_server` e o evento `lsp://config`. */
export interface LspConfigPort {
  /** o registo efectivo da pasta aberta e o estado dos ficheiros de overrides */
  config(root: string | null): Promise<LspConfigView>;
  /** o texto de um ficheiro de overrides (ou o modelo comentado, se não existe) */
  configFile(kind: "user" | "project", root: string | null): Promise<{ path: string; exists: boolean; text: string }>;
  /** grava o ficheiro do utilizador (o backend decide onde) e aplica-o; o relatório diz se foi ignorado */
  saveUserConfig(text: string): Promise<FileReport>;
  /** a decisão do humano sobre um servidor que o projecto pede (o backend audita-a primeiro) */
  approveServer(root: string, server: string, hash: string, approved: boolean, reason: string, decidedAt: number): Promise<void>;
  /** um ficheiro de overrides mudou (o backend já reiniciou os servidores afectados) */
  onConfig(cb: () => void): void;
}

/** O diálogo de aprovação partilhado (`app/approval.ts`, tipagem estrutural). */
export interface HumanPort {
  approve(r: { title: string; command: string; scope: string }): Promise<{ approved: boolean; reason: string; decidedAt: number }>;
}

/** Os ecrãs dos overrides (`ui/config-view.ts`). */
export interface OverridesView {
  /** edita o ficheiro do utilizador: `save` grava e devolve o relatório (erros, se for ignorado) */
  editUserFile(file: { path: string; exists: boolean; text: string }, save: (text: string) => Promise<FileReport>): void;
  /** mostra a configuração efectiva (`review` abre a aprovação de um servidor pendente) */
  showEffective(view: LspConfigView, selected: string | null, review: (serverId: string) => void): void;
  /** mostra (ou tira, com `[]`) o aviso dos ficheiros ignorados; `open` abre um deles */
  showInvalid(files: FileReport[], open: (f: FileReport) => void): void;
}

/** Instalar o servidor em falta (LSP P3): o backend dá as maneiras com o comando EXACTO
 *  (`lsp_install_plan`); copiar o comando, ou — depois de aprovado e auditado (r23 F1: muda algo fora do
 *  editor) — corrê-lo num terminal de tarefa, ou pedir ao backend o download conferido de uma release
 *  (`lsp_install_download`, com o id da maneira, nunca um URL). */
export interface InstallPort {
  /** as maneiras de instalar o servidor de um ficheiro (`null`: o ficheiro não tem servidor) */
  plan(path: string): Promise<InstallPlan | null>;
  /** descarrega, confere e desempacota a release (maneira `option`); devolve o estado novo do servidor */
  download(path: string, option: string): Promise<ServerStatus | null>;
  copy(text: string): Promise<boolean>;
  approve(r: { title: string; command: string; scope: string }): Promise<{ approved: boolean; reason: string; decidedAt: number }>;
  audit(root: string, e: { action: string; command: string; scope: string; approved: boolean; reason: string; decidedAt: number; outcome?: "sent" | "ok" | "failed" }): Promise<void>;
  /** corre a linha no terminal (PTY), na pasta e com o ambiente do plano, e resolve com o código de saída */
  run(command: string, cwd: string, env: Record<string, string>, label: string): Promise<number>;
}

/** Os servidores de linguagem vivos (LSP P6): `lsp_servers`, `lsp_server_stop`, `lsp_server_restart` e os
 *  eventos `lsp://servers` (a lista mudou) e `lsp://limit` (o tecto não se cumpre: todos têm ficheiros abertos). */
export interface ServersPort {
  list(): Promise<ServersView>;
  stop(key: string): Promise<void>;
  restart(key: string): Promise<void>;
  onChanged(cb: () => void): void;
  onLimit(cb: (l: LimitNotice) => void): void;
}

/** O ecrã da lista de servidores (`ui/servers-view.ts`). */
export interface ServersScreen {
  /** abre a lista (ou redesenha-a, se já está aberta) */
  show(view: ServersView, acts: ServersActions): void;
  /** está aberta? */
  isOpen(): boolean;
}

export interface ServersActions {
  stop(key: string): void;
  restart(key: string): void;
  /** abre o canal «Language servers» do Output */
  showLog(): void;
}

/** Adiar uma acção (o relógio, injectado para os testes). */
export type Defer = (f: () => void) => void;
