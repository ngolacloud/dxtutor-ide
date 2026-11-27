/* ═════════ feature `newproject` — legacy bridge ═════════
   O ÚNICO ficheiro da feature que toca em `window` (A8): a app desktop (`DXR`: a pasta aberta, a pasta pessoal,
   abrir uma pasta como workspace). Lido NO ACTO (o desktop avalia depois desta feature). */

interface Globals {
  DXR?: { root?: string; open?: (path?: string) => Promise<void> | void; info?: { home?: string } };
}
const G = window as unknown as Globals;

export const desktopApp = (): boolean => !!G.DXR;
export const openRoot = (): string | null => G.DXR?.root ?? null;
export const home = (): string | null => G.DXR?.info?.home ?? null;
export const openFolder = async (path: string): Promise<void> => { await G.DXR?.open?.(path); };
