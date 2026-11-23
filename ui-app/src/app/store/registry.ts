/* ═════════ dxtutor IDE — os registos de vistas (ADR-0004, U4g1) ═════════
   `RP` — o renderer de cada painel lateral, por nome (`RP.scm = () => …`).
   `VIEW` — o renderer de cada tipo de separador (`VIEW.file = (t, host) => …`).
   Nascem aqui, no primeiro import do main.ts, para que cada feature registe as suas
   vistas quando avalia (antes eram criados no app.ts, que avalia depois das features, e
   o v6 fazia os registos por elas). Os donos que os usam: `features/shell.ts` (painéis) e
   `features/tabs.ts` (separadores). Publicados no window — o app.ts e as camadas ainda
   registam/decoram por nome. */

import type { Tab } from "./editor";

export type PaneRenderer = () => void;
export type ViewRenderer = (t: Tab, host: HTMLElement) => void;

export const RP: Record<string, PaneRenderer> = {};
export const VIEW: Record<string, ViewRenderer> = {};

Object.assign(window, { RP, VIEW });
