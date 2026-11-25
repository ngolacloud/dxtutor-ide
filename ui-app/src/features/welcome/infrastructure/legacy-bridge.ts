/* ═════════ feature `welcome` — legacy bridge (r23 F6) ═════════
   O ÚNICO ficheiro da feature `welcome` que toca em `window` (A8): a app desktop (`DXR`: abrir uma pasta, a
   pasta pessoal), a paleta, o PairCode e as funções publicadas que outros decoram
   (`openBoard`, `hoodCmd`). Tudo lido NO ACTO (o desktop e o PairCode avaliam depois desta feature). */

import { isDesktop } from "../../../platform/tauri/core";

interface PaletteItem { l: string; d?: string; run: () => void }
interface Globals {
  DXR?: { open?: (path?: string) => Promise<void> | void; info?: { home?: string } };
  palette: (pre: string, cfg?: { ph?: string; verb?: string; items?: PaletteItem[]; text?: (q: string) => void }) => void;
  PAIR?: { ui?: { open: () => void; tab: (t: "start" | "join") => void } };
  openBoard?: () => void;
  hoodCmd?: () => void;
}
const G = window as unknown as Globals;

export const desktop = (): boolean => isDesktop() && !!G.DXR;
export const home = (): string | null => G.DXR?.info?.home ?? null;
export const openFolder = async (path?: string): Promise<void> => { await G.DXR?.open?.(path); };

export const palette = (pre: string): void => G.palette(pre);
export const pick = (ph: string, items: PaletteItem[]): void => G.palette("", { ph, items });
export const textPrompt = (ph: string, initial = ""): Promise<string | null> =>
  new Promise((res) => {
    let done = false;
    G.palette(initial, { ph, verb: "OK", text: (q) => { done = true; res(q); } });
    const watch = setInterval(() => { const pal = document.getElementById("pal"); if (done) { clearInterval(watch); return; } if (!pal || !pal.classList.contains("show")) { clearInterval(watch); res(null); } }, 300);
  });

export const pair = (tab: "start" | "join"): void => { const ui = G.PAIR?.ui; if (!ui) return; ui.open(); ui.tab(tab); };
export const openBoard = (): void => { G.openBoard?.(); };
export const hood = (): void => { G.hoodCmd?.(); };
