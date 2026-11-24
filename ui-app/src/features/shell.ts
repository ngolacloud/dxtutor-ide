/* ═════════ dxtutor IDE — feature: a «shell» da janela (ADR-0004, U4d1) ═════════
   Dona do layout: a barra de actividade (`buildActivity`, o menu de vistas extra
   `openOverflow`, os contadores `badges`), os painéis laterais (`setPane`/`goPane` — o
   registo de renderers `RP` vem de app/store/registry.ts —, o cabeçalho `hd`), a barra lateral e o painel inferior
   (`toggleSide`, `togglePanel`, `setPanelTab`, `sideOpen`) e os separadores
   redimensionáveis (`mkRz`). Vivia repartida entre o app.ts e o boot.ts (@ts-nocheck);
   aqui é tipada. O painel activo tem dono (`layoutStore.pane`, global `PANE`).

   Avalia ANTES do app.ts e publica tudo no window: o app.ts e o v6 registam os seus
   renderers em `RP` por nome (`RP.search = …`) logo ao carregar, e o resto do monólito
   e os onclick inline chamam estas funções por nome. O que ainda é do monólito
   (`ACTS`/`OVERFLOW`, `getVar`/`setVar`, `hydrate`, `closeMenus`, `scrollTerm`,
   `openSettings`, `changes`) lê-se em runtime pela fachada `G`. */

import { $, $$, hd, svg, toast, esc, hhmm } from "../core";
import { agentStore } from "../app/store/agent";
import { layoutStore } from "../app/store/layout";
import { RP } from "../app/store/registry";

interface Act {
  ic: string;
  title: string;
  pane?: string;
  run?: () => void;
  overflow?: boolean;
  spacer?: boolean;
  sep?: boolean;
  acc?: boolean;
}
interface OverflowItem {
  l?: string;
  pane?: string;
  sep?: boolean;
}
interface LegacyGlobals {
  ACTS: Act[];
  OVERFLOW: OverflowItem[];
  getVar: (k: string) => string;
  setVar: (k: string, v: string) => void;
  hydrate: () => void;
  closeMenus: () => void;
  scrollTerm: () => void;
  openSettings: () => void;
  changes: () => string[];
  BL: { issues: { stage: string }[] };
}
const G = window as unknown as LegacyGlobals;

/* ───── variáveis CSS do layout, ícones por data-ic e o canal Output (ADR-0004, U4j3 — eram do app.ts) ───── */
const setVar = (k: string, v: string): void => document.body.style.setProperty(k, v);
const getVar = (k: string): string => getComputedStyle(document.body).getPropertyValue(k).trim();
/** Insere o ícone de cada `[data-ic]` ainda por preencher (marca-o com `data-done`). */
function hydrate(): void { $$('[data-ic]').forEach(el=>{if(el.dataset.done)return;el.insertAdjacentHTML('afterbegin',svg(el.dataset.ic as string));(el.dataset as unknown as Record<string, unknown>).done=1;}); }
/** Uma linha no canal Output do painel inferior: `[hh:mm] origem mensagem`. */
function log(src: string, msg: string): void { const o=$('#pc-output')!;o.insertAdjacentHTML('beforeend',`<div>[${hhmm()}] <span class="r">${esc(src)}</span> ${esc(msg)}</div>`);o.scrollTop=o.scrollHeight; }


const sideOpen = (): boolean => G.getVar("--side-w") !== "0px";

/** Os contadores da barra de actividade: alterações por commitar e execução do Co-Dev. */
function badges(): void {
  const set = (p: string, v: string | number): void => {
    const b = $(`.act[data-pane="${p}"] .badge`) as HTMLElement | null;
    if (b) {
      b.textContent = String(v);
      b.style.display = v ? "grid" : "none";
    }
  };
  set("scm", G.changes().length || "");
  set("codev", agentStore.run && agentStore.run.active ? "●" : "");
  /* Tasks: issues à espera de validação. Era a decoração do v6.ts (ADR-0004, U4g5) — o badges
     não tem chamadas internas, por isso dobra-se aqui. (O contador do Debug contava os
     lançadores de crash dos ambientes simulados; saiu com eles, ADR-0006 R1c2.) */
  const b = $('.act[data-pane="tasks"] .badge') as HTMLElement | null;
  if (b) { const n = G.BL.issues.filter((i) => i.stage === "func").length; b.textContent = String(n || ""); b.style.display = n ? "grid" : "none"; }
}

/** Abre o painel lateral `p`; com `tgl === true`, clicar no activo recolhe a barra. */
function setPane(p: string, tgl?: boolean): void {
  if (p === "settings") {
    G.openSettings();
    return;
  }
  if (tgl === true && layoutStore.pane === p && sideOpen()) {
    toggleSide();
    return;
  }
  if (!sideOpen()) toggleSide();
  layoutStore.pane = p;
  $$(".act").forEach((a) => a.classList.toggle("on", (a as HTMLElement).dataset.pane === p));
  $$(".pane").forEach((x) => x.classList.remove("show"));
  const pe = $("#pane-" + p);
  if (pe) pe.classList.add("show");
  if (RP[p]) RP[p]();
  G.hydrate();
}

const goPane = (p: string): void => setPane(p);

function toggleSide(): void {
  const o = sideOpen();
  G.setVar("--side-w", o ? "0px" : "250px");
  ($("#tgl-side") as HTMLElement).classList.toggle("on", !o);
}

function togglePanel(): void {
  const o = G.getVar("--panel-h") !== "0px";
  G.setVar("--panel-h", o ? "0px" : "230px");
  ($("#tgl-panel") as HTMLElement).classList.toggle("on", !o);
}

/** Mostra o separador `pt` do painel inferior (abre o painel se estiver fechado). */
function setPanelTab(pt: string, nofocus?: boolean): void {
  if (G.getVar("--panel-h") === "0px") togglePanel();
  $$(".ptab").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.pt === pt));
  $$(".pcontent").forEach((c) => c.classList.remove("show"));
  const el = $("#pc-" + pt);
  if (el) el.classList.add("show");
  if (pt === "terminal") {
    G.scrollTerm();
    if (!nofocus) {
      const c = $("#cmd") as HTMLElement | null;
      if (c) c.focus({ preventScroll: true });
    }
  }
}

function buildActivity(): void {
  const bar = $("#activity") as HTMLElement;
  bar.innerHTML = "";
  G.ACTS.forEach((a) => {
    const el = document.createElement("button");
    el.className = "act" + (a.spacer ? " spacer" : "") + (a.sep ? " sep" : "");
    el.title = a.title;
    el.dataset.pane = a.pane || "";
    el.innerHTML = svg(a.ic) + `<span class="badge${a.acc ? " acc" : ""}" style="display:none"></span>`;
    el.onclick = (e) => {
      e.stopPropagation();
      if (a.overflow) openOverflow(el);
      else if (a.run) a.run();
      else setPane(a.pane as string, true);
    };
    bar.appendChild(el);
  });
}

/** O menu «Additional Views» do botão «…» da barra de actividade. */
function openOverflow(btn: HTMLElement): void {
  G.closeMenus();
  const r = btn.getBoundingClientRect();
  const pop = document.createElement("div");
  pop.className = "menu-pop show";
  document.body.appendChild(pop);
  const title = document.createElement("div");
  title.className = "mi ov-title";
  title.textContent = "Additional Views";
  pop.appendChild(title);
  G.OVERFLOW.forEach((it) => {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "mi-sep";
      pop.appendChild(s);
      return;
    }
    const mi = document.createElement("div");
    mi.className = "mi";
    mi.innerHTML = `<span>${it.l}</span>` + (it.pane ? "" : '<span class="key">plugin</span>');
    mi.onclick = (e) => {
      e.stopPropagation();
      G.closeMenus();
      if (it.pane) setPane(it.pane);
      else toast(it.l + " — requer o plugin instalado");
    };
    pop.appendChild(mi);
  });
  const x = r.right + 4;
  let y = r.top;
  const h = pop.offsetHeight;
  if (y + h > innerHeight) y = innerHeight - h - 6;
  pop.style.left = x + "px";
  pop.style.top = y + "px";
}

/** Torna `el` um separador arrastável que ajusta a variável CSS `v` entre `min` e `max`. */
function mkRz(el: HTMLElement, v: string, base: number, min: number, max: number, inv?: boolean): void {
  el.onmousedown = (e) => {
    e.preventDefault();
    el.classList.add("drag");
    const sx = e.clientX,
      start = parseInt(getComputedStyle(document.body).getPropertyValue(v)) || base;
    const mv = (ev: MouseEvent): void => {
      let d = ev.clientX - sx;
      if (inv) d = -d;
      document.body.style.setProperty(v, Math.min(max, Math.max(min, start + d)) + "px");
    };
    const up = (): void => {
      el.classList.remove("drag");
      removeEventListener("mousemove", mv);
      removeEventListener("mouseup", up);
    };
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
  };
}

/* publicação transitória no window (o monólito, o v6 e os onclick inline usam por nome) */
Object.assign(window, { hd, setVar, getVar, hydrate, log, badges, sideOpen, setPane, goPane, toggleSide, togglePanel, setPanelTab, buildActivity, mkRz });

export { RP, setVar, getVar, hydrate, log, badges, sideOpen, setPane, goPane, toggleSide, togglePanel, setPanelTab, buildActivity, openOverflow, mkRz };
