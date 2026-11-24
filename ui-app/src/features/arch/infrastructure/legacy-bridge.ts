/* ═════════ feature `arch`: legacy bridge (ADR-0002) ═════════
   O ÚNICO ficheiro da subárvore `features/arch/` autorizado a tocar no `window` (A8).
   Lê a pasta aberta pelo desktop (`DXR.root`), abre separadores pelo `openTab` do
   monólito, guarda o desenho no `localStorage` e mostra os diálogos do humano. Não
   publica nada no `window`: quem abre o Studio importa `openArch` (features/arch/index). */

import type { DesignStore, Workspace } from "../application/ports";

const G = window as unknown as {
  DXR?: { root?: string | null };
  openTab?: (t: { id: string; title: string; kind: string }) => void;
};

export const workspace: Workspace = {
  root: () => G.DXR?.root ?? null,
  confirm: (message) => window.confirm(message),
  prompt: (message, initial) => window.prompt(message, initial),
};

export const designStore: DesignStore = {
  load(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return null;
    }
  },
  save(key, design) {
    try {
      window.localStorage.setItem(key, JSON.stringify(design));
    } catch {
      /* sem storage: o desenho vive só nesta sessão */
    }
  },
};

export const openTab = (t: { id: string; title: string; kind: string }): void => G.openTab?.(t);
