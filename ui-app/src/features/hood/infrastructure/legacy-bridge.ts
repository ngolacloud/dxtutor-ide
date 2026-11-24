/* ═════════ feature `hood` — legacy bridge (A8) ═════════
   O ÚNICO ficheiro da feature `hood` que toca em `window`: o ficheiro aberto no editor (o FS do
   monólito e o separador actual), abrir um ficheiro numa linha, abrir um separador, um aviso. Tudo
   lido NO ACTO. */

import { toast } from "../../../core";
import { editorStore } from "../../../app/store/editor";

interface Globals {
  FS: Record<string, { content: string } | undefined>;
  openPath: (p: string, line?: number) => void;
  openTab: (t: { id: string; title?: string; kind?: string }) => void;
}
const G = window as unknown as Globals;

/** O ficheiro do separador actual — ou aquele sobre o qual é a vista — (caminho do editor e texto), ou null. */
export const currentFile = (): { path: string; text: string } | null => {
  const t = editorStore.tabs.find((x) => x.id === editorStore.currentTabId);
  /* o editor de um ficheiro, ou uma vista sobre um ficheiro (o «Under the hood» tem `path`) */
  const p = t ? (typeof t.path === "string" ? t.path : t.kind === "file" ? t.id : "") : "";
  const f = p ? G.FS[p] : undefined;
  return p && f ? { path: p, text: f.content } : null;
};
export const openAt = (path: string, line: number): void => G.openPath(path, line);
export const openTab = (id: string, title: string, kind: string): void => G.openTab({ id, title, kind });
export const notify = (m: string): void => toast(m);
