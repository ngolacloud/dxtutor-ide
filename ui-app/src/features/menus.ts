/* ═════════ dxtutor IDE — feature: barra de menus (ADR-0004, U4d2) ═════════
   Dona do MECANISMO dos menus: a barra (`buildMenubar`), abrir/fechar (`showMenu`,
   `closeMenus`) e o desenho de um menu com submenus (`renderPop`). Vivia no boot.ts
   (@ts-nocheck); aqui é tipada, e o menu aberto (`openMenu`) passa a ser estado do
   módulo em vez de uma global.

   O CONTEÚDO dos menus (`MENUS`) continua a ser montado pelo app.ts (`buildMenus`) e
   ajustado no arranque pelo v5/v6/bridge/pair/visualizer (`MENUS.find(…).items = …`) — é
   configuração com closures sobre funções de muitas features; dissolve-se quando cada
   feature registar os seus comandos. Lê-se em runtime pela fachada `G`. */

import { $, $$, toast } from "../core";
import { services } from "../app/services";

export interface MenuItem {
  l?: string;
  k?: string;
  sep?: boolean;
  on?: boolean;
  check?: boolean;
  sub?: MenuItem[];
  act?: (() => void) | string;
}
interface Menu {
  t: string;
  items: MenuItem[];
}
const G = window as unknown as { MENUS: Menu[] } & Record<string, unknown>;

/** O menu de topo aberto (índice em `MENUS`), ou `null`. */
let openMenu: number | null = null;

function buildMenubar(): void {
  const mb = $("#menubar") as HTMLElement;
  G.MENUS.forEach((m, i) => {
    const b = document.createElement("button");
    b.className = "menu-top";
    b.textContent = m.t;
    b.onclick = (e) => {
      e.stopPropagation();
      if (openMenu === i) closeMenus();
      else showMenu(i, b);
    };
    b.onmouseenter = () => {
      if (openMenu !== null && openMenu !== i) showMenu(i, b);
    };
    mb.appendChild(b);
  });
}

function closeMenus(): void {
  $$(".menu-pop").forEach((p) => p.remove());
  $$(".menu-top").forEach((b) => b.classList.remove("open"));
  openMenu = null;
}

function showMenu(i: number, btn: HTMLElement): void {
  closeMenus();
  openMenu = i;
  btn.classList.add("open");
  const r = btn.getBoundingClientRect();
  renderPop(G.MENUS[i].items, r.left, r.bottom + 2);
}

/** Desenha um menu (e os submenus ao passar o rato) na posição dada; devolve o elemento. */
function renderPop(items: MenuItem[], x: number, y: number): HTMLElement {
  const pop = document.createElement("div");
  pop.className = "menu-pop show";
  document.body.appendChild(pop);
  items.forEach((it) => {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "mi-sep";
      pop.appendChild(s);
      return;
    }
    const mi = document.createElement("div");
    mi.className = "mi" + (it.k ? " has-key" : "");
    let h = "";
    if (it.on !== undefined || it.check !== undefined) h += `<span class="mi-check">${it.on || it.check ? "✓" : ""}</span>`;
    h += `<span>${it.l}</span>`;
    if (it.k) h += `<span class="key">${it.k}</span>`;
    if (it.sub) h += `<span class="chev">▶</span>`;
    mi.innerHTML = h;
    if (it.sub) {
      const sub = it.sub;
      mi.onmouseenter = () => {
        pop.querySelectorAll(".menu-pop").forEach((p) => p.remove());
        const r = mi.getBoundingClientRect();
        const sp = renderPop(sub, r.right - 3, r.top - 5);
        pop.appendChild(sp);
      };
      mi.onclick = (e) => e.stopPropagation();
    } else
      mi.onclick = (e) => {
        e.stopPropagation();
        closeMenus();
        if (typeof it.act === "function") it.act();
        else if (it.act && G[it.act]) (G[it.act] as () => void)();
        else toast(it.l as string);
      };
    pop.appendChild(mi);
  });
  const w = pop.offsetWidth;
  if (x + w > innerWidth) x = innerWidth - w - 6;
  pop.style.left = x + "px";
  pop.style.top = y + "px";
  return pop;
}

/* publicação transitória no window (o monólito e as camadas chamam por nome) */

export { buildMenubar, closeMenus, showMenu, renderPop };
/* o boot, a paleta e o shell (avaliam antes) fecham os menus pelo registo (ADR-0004, U7h) */
services.menus = { closeMenus, buildMenubar };
