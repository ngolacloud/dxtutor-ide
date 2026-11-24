/* ═════════ dxtutor IDE — feature: tema (aparência) ═════════
   Primeira feature-folha da reestruturação por funcionalidade (Fase 0). Consome o
   `core` tipado por import real (prova de que a fundação serve os consumidores) e
   detém a lógica de tema que vivia no monólito `app.ts`.

   Shim transitório: publica `THEMES`/`THEME`/`setTheme` no `window` porque o residual
   do monólito ainda os resolve pelos nomes livres — `save()`/`loadCfg()` lêem/escrevem
   `THEME`, as vistas lêem `THEMES`, e os `onclick="setTheme(...)"` inline precisam de
   `window.setTheme`. À medida que esses consumidores migrarem para features, o espelho
   cai. */

import { S, show } from "../core";
import { layoutStore } from "../app/store";

/** Mapa de temas → overrides de custom properties CSS. */
const THEMES: Record<string, Record<string, string>> = {'Grafite laranja':{},
 'Slate índigo':{'--accent':'#6d7cff','--accent-hover':'#8f9bff','--accent-grad':'linear-gradient(135deg,#6d7cff,#8f9bff)','--accent-soft':'rgba(109,124,255,.14)','--sh-acc':'0 4px 14px rgba(109,124,255,.3)','--bg-base':'#0e1016','--bg-editor':'#141722','--bg-elevated':'#191d2a','--bg-side':'#161a26','--bg-activity':'#11141d','--bg-title':'#11141d','--bg-status':'#11141d','--bg-panel':'#141722','--bg-tab-inactive':'#161a26','--bg-input':'#1e2331','--bg-hover':'#232939','--bg-sel':'#2a3145','--bg-sel-inactive':'#252b3c','--bg-menu':'#1a1f2c','--border':'#272d3d','--border-strong':'#343b50','--seam':'#1e2331','--guide':'#2c3346'},
 'Papel claro':{'--bg-base':'#f4f2ec','--bg-editor':'#fbfaf6','--bg-elevated':'#f6f4ee','--bg-side':'#efede6','--bg-activity':'#e9e6de','--bg-title':'#e9e6de','--bg-status':'#e9e6de','--bg-panel':'#fbfaf6','--bg-tab-inactive':'#efede6','--bg-input':'#ffffff','--bg-hover':'#e6e3da','--bg-sel':'#dcd8cc','--bg-sel-inactive':'#e3e0d6','--bg-menu':'#ffffff','--border':'#dcd8cc','--border-strong':'#c9c4b6','--seam':'#e2dfd5','--guide':'#d6d2c6','--fg':'#1d1c1a','--fg-dim':'#5f5d57','--fg-muted':'#86837b','--fg-bright':'#000000','--accent':'#c8562a','--accent-hover':'#b84a20','--purple':'#8b3fc0','--blue':'#1f6fd6','--cyan':'#0f7f8c','--green':'#1e8a63','--git-u':'#1e8a63','--git-m':'#a66a00','--git-d':'#c8323f','--red':'#c8323f','--yellow':'#9a7400','--folder':'#7a7669','--sh-card':'0 1px 2px rgba(0,0,0,.06),0 6px 18px rgba(0,0,0,.06)','--sh-pop':'0 10px 30px rgba(0,0,0,.18)'}};

/** Aplica o tema `n`: limpa os overrides de todos os temas, aplica os de `n`,
 *  persiste e, se a vista activa for as Definições, re-renderiza-a. */
function setTheme(n: string): void {
  const r = document.documentElement.style;
  Object.values(THEMES).forEach((t) =>
    Object.keys(t).forEach((k) => r.removeProperty(k)),
  );
  Object.entries(THEMES[n] ?? {}).forEach(([k, v]) => r.setProperty(k, v));
  layoutStore.theme = n;
  r.colorScheme = n === "Papel claro" ? "light" : "dark";
  window.save();
  const id = S.cur;
  const t = window.tabOf(id);
  if (id && t && t.kind === "settings") show(id);
}

/* ── publicação transitória no window (shim para o monólito e os onclick inline) ── */
window.THEMES = THEMES;
window.setTheme = setTheme;
