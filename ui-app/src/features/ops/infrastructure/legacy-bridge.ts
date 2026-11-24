/* ═════════ feature `ops` — legacy bridge (A9) ═════════
   O ÚNICO ficheiro da feature `ops` que toca em `window`: a pasta aberta (DXR), para onde o pane Infra
   aponta o kubectl (ENVS: kubeconfig, contexto, namespace, ligado ou não), correr um comando num
   terminal de tarefa, a confirmação, a paleta e os avisos. Tudo lido NO ACTO. */

import { toast } from "../../../core";
import type { KubeTarget } from "../domain/types";

interface Globals {
  DXR?: { root?: string | null };
  ENVS?: { kube?: string; ctx?: string; ns?: string; k8sOn?: boolean };
  runTask: (cmd: string) => unknown;
  confirm: (m: string) => boolean;
  palette: (pre: string, cfg: { ph?: string; verb?: string; text?: (q: string) => void }) => void;
  openTab: (t: { id: string; title: string; kind: string }) => void;
}
const G = window as unknown as Globals;

export const root = (): string | null => G.DXR?.root ?? null;
/** O kubeconfig/contexto/namespace do pane Infra, quando o cluster está ligado lá. */
export const kubeTarget = (): KubeTarget | null => {
  const e = G.ENVS;
  return e && e.k8sOn && e.ctx ? { kubeconfig: (e.kube || "").trim(), context: e.ctx, namespace: (e.ns || "default").trim() || "default" } : null;
};
export const runInTerminal = (cmd: string): void => { G.runTask(cmd); };
export const confirmBox = (m: string): boolean => G.confirm(m);
export const textPrompt = (ph: string, initial = ""): Promise<string | null> =>
  new Promise((res) => {
    let done = false;
    G.palette(initial, { ph, verb: "OK", text: (q) => { done = true; res(q); } });
    const watch = setInterval(() => { const pal = document.getElementById("pal"); if (done) { clearInterval(watch); return; } if (!pal || !pal.classList.contains("show")) { clearInterval(watch); res(null); } }, 300);
  });
export const notify = (m: string): void => toast(m);
export const openTab = (kind: string, title: string): void => G.openTab({ id: kind, title, kind });
