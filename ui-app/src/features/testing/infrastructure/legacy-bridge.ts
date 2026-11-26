/* ═════════ feature `testing` — legacy bridge (ADR-0006, R2a) ═════════
   O ÚNICO ficheiro da feature `testing` que toca em `window`. Lê a pasta aberta e o comando
   de testes detectado (`window.DXR`, a parte desktop — `platform/desktop/`), e resolve no
   acto as funções do monólito que a feature chama (abrir ficheiro, correr no terminal,
   pane activo). Tudo é lido NO ACTO (a feature avalia antes de `app.ts` publicar). */

import { editorStore } from "../../../app/store/editor";

interface Dxr {
  root?: string | null; projectCmd?: (kind: "test" | "lint") => { cmd: string } | null; flush?: () => void; idle?: () => Promise<unknown>;
  streamCmd?: (line: string, o: { line: (l: string, err?: boolean) => void; onId?: (id: string) => void }) => Promise<number>;
  killCmd?: (id: string) => Promise<boolean>;
}
/** Os globais do monólito/desktop que a feature lê, tipados (sem `any`). */
interface Globals {
  DXR?: Dxr;
  ROOT: string;
  PANE: string;
  openPath: (p: string, line?: number) => void;
  runTask: (cmd: string) => unknown;
  FS: Record<string, { content: string } | undefined>;
  setPanelTab?: (pt: string, nofocus?: boolean) => void;
  CMD?: [string, string, () => void][];
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

/* ───── o runner ao vivo do painel «Tests» ───── */
/** Corre uma linha na pasta aberta com a saída linha a linha (desktop); sem o serviço, rejeita. */
export const streamCmd = (line: string, o: { line: (l: string) => void; onId: (id: string) => void }): Promise<number> => {
  const d = dxr();
  if (!d?.streamCmd) return Promise.reject(new Error("streaming is only available in the desktop app"));
  return d.streamCmd(line, { line: (l) => o.line(l), onId: o.onId });
};
export const killCmd = (id: string): Promise<boolean> => dxr()?.killCmd?.(id) ?? Promise.resolve(false);
/** Mostra um separador do painel inferior (abre o painel se estiver fechado). */
export const setPanelTab = (pt: string): void => { G.setPanelTab?.(pt, true); };
/** Os ficheiros do workspace (chave do FS → texto), para encontrar onde um teste está definido. */
export const workspaceFiles = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(G.FS ?? {})) if (v && G.ROOT && k.startsWith(G.ROOT)) out[k] = v.content;
  return out;
};
/** A chave do FS de um caminho que a saída dos testes cita (relativo à pasta, ou absoluto dentro dela). */
export const keyOf = (file: string): string | null => {
  const root = dxr()?.root ?? "", pre = G.ROOT ?? "";
  const rel = root && file.startsWith(root + "/") ? file.slice(root.length + 1) : file.replace(/^\.\//, "");
  if (G.FS?.[pre + rel]) return pre + rel;
  return Object.keys(G.FS ?? {}).find((k) => k.startsWith(pre) && k.endsWith("/" + rel)) ?? null;
};
/** Abre uma chave do FS numa linha. */
export const openKey = (key: string, line: number): void => G.openPath(key, line);

/** Publica no `window` o renderer do pane (o `RP.test` do app.ts delega aqui). */
export const publish = (surface: Record<string, unknown>): void => { Object.assign(window, surface); };
/** Acrescenta um comando à paleta (se ainda não existe). */
export const addPaletteCommand = (label: string, key: string, run: () => void): void => {
  const cmd = G.CMD;
  if (cmd && !cmd.some((c) => c[0] === label)) cmd.push([label, key, run]);
};
