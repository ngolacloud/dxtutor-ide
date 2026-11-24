/* ═════════ feature `codebase` — legacy bridge (A10) ═════════
   O ÚNICO ficheiro da feature que toca em `window`: a pasta aberta (DXR), correr num terminal de tarefa,
   abrir um ficheiro do projecto, ir ao pane Testing, abrir um separador, confirmar e avisar. No acto. */
import { toast } from "../../../core";

interface Globals {
  DXR?: { root?: string | null };
  ROOT: string;
  runTask: (cmd: string) => unknown;
  openPath: (p: string, l?: number) => void;
  goPane: (p: string) => void;
  openTab: (t: { id: string; title: string; kind: string }) => void;
  confirm: (m: string) => boolean;
}
const G = window as unknown as Globals;

export const root = (): string | null => G.DXR?.root ?? null;
export const runInTerminal = (cmd: string): void => { G.runTask(cmd); };
export const openRel = (rel: string): void => G.openPath(G.ROOT + rel);
export const showTests = (): void => G.goPane("test");
export const openTab = (kind: string, title: string): void => G.openTab({ id: kind, title, kind });
export const confirmBox = (m: string): boolean => G.confirm(m);
export const notify = (m: string): void => toast(m);
