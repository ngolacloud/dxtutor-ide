/* ═════════ feature `protect` — a ponte legada (r23 F4a) ═════════
   O ÚNICO ficheiro da subárvore que toca em `window` (A8): a pasta aberta (`DXR.root`). */
const G = window as unknown as { DXR?: { root?: string | null } };

export const root = (): string | null => (G.DXR && G.DXR.root) || null;
