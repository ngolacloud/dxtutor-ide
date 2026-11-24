/* ═════════ feature `lsp` — portas ═════════
   O que o cliente LSP precisa do mundo, injectado pela raiz de composição (`index.ts`):
   o backend (comandos `lsp_*` + evento `lsp://diagnostics`), o workspace aberto e o editor. */

import type { ServerStatus } from "../domain/server-status";

/** Os comandos `lsp_*` do backend (caminhos absolutos; posições 0-based). */
export interface LspPort {
  start(root: string): Promise<void>;
  didOpen(path: string, text: string, languageId: string): Promise<void>;
  didChange(path: string, text: string, version: number): Promise<void>;
  hover(path: string, line: number, character: number): Promise<unknown>;
  definition(path: string, line: number, character: number): Promise<unknown>;
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
  /** Mostra (ou tira, com `null`) o aviso de servidor em falta no ficheiro `key`, se estiver aberto;
   *  `onDismiss` corre quando o utilizador o fecha. */
  notice(key: string, notice: { title: string; detail: string; install: string } | null, onDismiss?: () => void): void;
}

/** Adiar uma acção (o relógio, injectado para os testes). */
export type Defer = (f: () => void) => void;
