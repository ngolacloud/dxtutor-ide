/* ═════════ feature `arch`: legacy bridge (ADR-0002) ═════════
   O ÚNICO ficheiro da subárvore `features/arch/` autorizado a tocar no `window` (A8).
   Lê a pasta aberta pelo desktop (`DXR.root`), abre separadores pelo `openTab` do
   monólito, guarda o desenho no `localStorage`, mostra os diálogos do humano, descarrega
   ficheiros no browser e lê as cores do tema (para a exportação SVG/PNG). Não
   publica nada no `window`: quem abre o Studio importa `openArch` (features/arch/index). */

import type { DesignStore, Files, Workspace } from "../application/ports";

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

/** No browser (sem Tauri), uma exportação é um download. */
export const files: Files = {
  download(name, bytes, mime) {
    const url = window.URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  },
};

/** Os valores actuais das variáveis CSS do tema (ex.: `--bg-base` → `#0f0f11`). */
export function themeVars(names: readonly string[]): Record<string, string> {
  const cs = window.getComputedStyle(document.documentElement);
  return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()]));
}
