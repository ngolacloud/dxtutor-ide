/* ═════════ feature `deploy` — a ponte legada (r23 F4c2) ═════════
   O ÚNICO ficheiro da subárvore que toca em `window` (A8): a pasta aberta (DXR), o kubeconfig do pane Infra
   (ENVS.kube), a paleta como campo de texto, os separadores. Lido NO ACTO. */
import { toast } from "../../../core";

interface Globals {
  DXR?: { root?: string | null };
  ENVS?: { kube?: string };
  palette: (pre: string, cfg: { ph?: string; verb?: string; text?: (q: string) => void }) => void;
  openTab: (t: { id: string; title: string; kind: string }) => void;
}
const G = window as unknown as Globals;

export const root = (): string | null => G.DXR?.root ?? null;
export const kubeconfig = (): string | null => (G.ENVS?.kube || "").trim() || null;
export const textPrompt = (ph: string, initial = ""): Promise<string | null> =>
  new Promise((res) => {
    let done = false;
    G.palette(initial, { ph, verb: "OK", text: (q) => { done = true; res(q); } });
    const watch = setInterval(() => { const pal = document.getElementById("pal"); if (done) { clearInterval(watch); return; } if (!pal || !pal.classList.contains("show")) { clearInterval(watch); res(null); } }, 300);
  });
export const notify = (m: string): void => toast(m);
export const openTab = (kind: string, title: string): void => G.openTab({ id: kind, title, kind });
