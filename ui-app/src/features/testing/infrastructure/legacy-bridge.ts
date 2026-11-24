/* ═════════ feature `testing` — legacy bridge (ADR-0006, R2a) ═════════
   O ÚNICO ficheiro da feature `testing` que toca em `window`. Lê a pasta aberta e o comando
   de testes detectado (`window.DXR`, a parte desktop — `platform/desktop/`), e resolve no
   acto as funções do monólito que a feature chama (abrir ficheiro, correr no terminal,
   pane activo). Tudo é lido NO ACTO (a feature avalia antes de `app.ts` publicar). */

import { editorStore } from "../../../app/store/editor";

interface Dxr { root?: string | null; projectCmd?: (kind: "test" | "lint") => { cmd: string } | null; flush?: () => void; idle?: () => Promise<unknown> }
/** Os globais do monólito/desktop que a feature lê, tipados (sem `any`). */
interface Globals {
  DXR?: Dxr;
  ROOT: string;
  PANE: string;
  openPath: (p: string, line?: number) => void;
  runTask: (cmd: string) => unknown;
  FS: Record<string, { content: string } | undefined>;
}
const G = window as unknown as Globals;
const dxr = (): Dxr | undefined => G.DXR;

/** A pasta aberta no desktop (null sem pasta e no browser). */
export const root = (): string | null => dxr()?.root ?? null;
/** O comando de testes detectado no projecto aberto (null se nenhum). */
export const projectTestCmd = (): string | null => dxr()?.projectCmd?.("test")?.cmd ?? null;

/** Grava o editor no disco (autosave do desktop) e espera pela fila de escrita. */
export const save = async (): Promise<void> => { const d = dxr(); d?.flush?.(); await d?.idle?.(); };

/** Abre o ficheiro `rel` (relativo à pasta) na linha `line`: o FS do monólito usa
 *  chaves `ROOT + caminho relativo`. */
export const openFile = (rel: string, line: number): void => G.openPath(G.ROOT + rel, line);
/** Corre um comando num terminal de tarefa (no desktop, um PTY real). */
export const runTask = (cmd: string): void => { G.runTask(cmd); };
/** O ficheiro activo no editor, relativo à pasta (A6, «Write a missing test»); null sem ficheiro do projecto. */
export const currentFile = (): { path: string; text: string } | null => {
  const t = editorStore.tabs.find((x) => x.id === editorStore.currentTabId);
  const p = t ? (typeof t.path === "string" ? t.path : t.id) : "";
  const f = p ? G.FS[p] : undefined;
  return f && G.ROOT && p.startsWith(G.ROOT) ? { path: p.slice(G.ROOT.length), text: f.content } : null;
};
/** O pane lateral activo (para só redesenhar quando o Testing está à vista). */
export const activePane = (): string => G.PANE;

/** Publica no `window` o renderer do pane (o `RP.test` do app.ts delega aqui). */
export const publish = (surface: Record<string, unknown>): void => { Object.assign(window, surface); };
