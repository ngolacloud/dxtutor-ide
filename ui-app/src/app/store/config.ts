/* ═════════ dxtutor IDE — configuração persistida (ADR-0004, U4f) ═════════
   Guarda e restaura no `localStorage` (`dx2.cfg`) o modo de autonomia, o provedor activo,
   o limiar, o tema, o encaminhamento por papel e o estado (ligado/modelo) de cada
   provedor. Era o `save`/`loadCfg` do app.ts. Os valores com dono passam pelos stores
   (emitem os seus eventos no bus); os catálogos que ainda são do monólito (`MODES`,
   `THEMES`, `ROUTE`) lêem-se pela fachada `G`. */

import { agentStore } from "./agent";
import { layoutStore } from "./layout";
import { LS } from "./storage";

interface SavedConfig {
  MODE?: string;
  ACTIVE?: string;
  THRESH?: number;
  THEME?: string;
  ROUTE?: Record<string, string>;
  prov?: Record<string, { on?: boolean; model?: string }>;
}
const G = window as unknown as {
  MODES: Record<string, unknown>;
  THEMES: Record<string, unknown>;
  ROUTE: Record<string, string>;
};

export function save(): void {
  const PROV = agentStore.providers;
  LS.set("cfg", {
    MODE: agentStore.mode,
    ACTIVE: agentStore.provider,
    THRESH: agentStore.threshold,
    THEME: layoutStore.theme,
    ROUTE: G.ROUTE,
    prov: Object.fromEntries(Object.entries(PROV).map(([k, p]) => [k, { on: p.on, model: p.model }])),
  });
}

export function loadCfg(): void {
  const c = LS.get<SavedConfig | null>("cfg", null);
  if (!c) return;
  const PROV = agentStore.providers;
  if (c.MODE && G.MODES[c.MODE]) agentStore.mode = c.MODE;
  if (c.ACTIVE && PROV[c.ACTIVE]) agentStore.provider = c.ACTIVE;
  if (c.THRESH) agentStore.threshold = c.THRESH;
  if (c.THEME && G.THEMES[c.THEME]) layoutStore.theme = c.THEME;
  Object.keys(G.ROUTE).forEach((r) => {
    if (c.ROUTE && PROV[c.ROUTE[r]]) G.ROUTE[r] = c.ROUTE[r];
  });
  Object.keys(PROV).forEach((k) => {
    const saved = c.prov && c.prov[k];
    if (saved) {
      PROV[k].on = !!saved.on;
      if (saved.model) PROV[k].model = saved.model;
    }
  });
}

Object.assign(window, { save, loadCfg });
