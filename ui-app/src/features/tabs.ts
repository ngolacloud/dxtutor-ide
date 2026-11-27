/* ═════════ dxtutor IDE — feature: separadores do editor (ADR-0004, U4b) ═════════
   Dona da barra de separadores e da navegação entre eles: abrir (`openTab`/`openPath`/
   `openFile`), mostrar (`show` — escolhe o renderer do tipo em `VIEW`), fechar
   (`closeTab`), percorrer (`stepTab`), desenhar a barra (`drawTabs`) e o ícone de cada
   tipo (`tabIc`). Vivia no app.ts (@ts-nocheck); aqui é tipada. A lista de separadores
   tem dono — `editorStore.tabs` (global `TB`) — e o separador activo também
   (`editorStore.currentTabId`, global `cur`, que emite `editor:tab` no bus).

   Avalia ANTES do app.ts (ordem do main.ts) e publica as funções no window, como o
   app.ts fazia: o resto do monólito (app/v5/v6/bridge/pair) e os onclick inline chamam-
   -nas por nome. O `show` publicado é o composto com a barra de acções (fim do ficheiro).
   O registo dos renderers por tipo (`VIEW`) vem de app/store/registry.ts. O que ainda
   vive no monólito (`hydrate`, `drawOutline`, `markActive`,
   `ctxPill`, `setVar`, `short`, `fIcon`, `gotoLine`, `stLang`) lê-se em runtime pela
   fachada `G` — nunca no eval do módulo. */

import { tabMarks } from "../app/tab-marks";
import { $, esc, svg, toast } from "../core";
import { editorStore, type Tab } from "../app/store/editor";
import { bus } from "../app/bus";
import { VIEW } from "../app/store/registry";
import { translator } from "../app/i18n";
import { isStateFile } from "./protect/domain/report";
import { PROTECT_MESSAGES } from "./protect/ui/messages";
import { registerActions, callGlobal } from "../app/actions";
import { services } from "../app/services";
import { ctxPill } from "./codev";
import { stLang } from "./editor";
import { explainCmd, reviewCmd } from "./codereview";
import { startDebug } from "./debug";
import { dxRun } from "./stack";

interface LegacyGlobals {
  FS: Record<string, { content: string; orig: string | null }>;
  short: (p: string) => string;
  fIcon: (name: string) => string;
  gotoLine: (line: number) => void;
  show: (id: string | null) => void;
}
const G = window as unknown as LegacyGlobals;

const TB = (): Tab[] => editorStore.tabs;

const tabOf = (id: string | null): Tab | undefined => TB().find((o) => o.id === id);

function openTab(t: Tab, act?: boolean): void {
  const x = tabOf(t.id);
  if (x) Object.assign(x, t);
  else TB().push(t);
  if (act === false) drawTabs();
  else G.show(t.id);
}

const tp = translator(PROTECT_MESSAGES);

function openPath(p: string, line?: number): void {
  /* r23 F4b (P05): um ficheiro de estado nunca se abre no editor */
  if (isStateFile(p)) {
    toast(tp("stateFile", { file: p.split("/").pop() as string }));
    return;
  }
  if (!G.FS[p]) {
    toast("Ficheiro não existe: " + G.short(p));
    return;
  }
  openTab({ id: p, title: p.split("/").pop() as string, kind: "file", path: p });
  if (line) G.gotoLine(line);
}

function openFile(name: string): void {
  const p = Object.keys(G.FS).find((k) => k.endsWith("/" + name));
  if (p) openPath(p);
}

function setActive(id: string): void {
  if (tabOf(id)) G.show(id);
}

function tabIc(t: Tab): string {
  if (t.kind === "file") return G.fIcon(t.title);
  if (t.kind === "lt") return `<span class="ic acc">${svg("book")}</span>`;
  const m: Record<string, string> = {
    agent: "sparkle",
    welcome: "sparkle",
    diff: "scm",
    settings: "settings",
    manager: "graph",
    analysis: "book",
    graph: "scm",
    team: "account",
    studio: "cube",
    board: "split",
  };
  return `<span class="ic acc">${svg(m[t.kind] || "file")}</span>`;
}

function drawTabs(): void {
  const host = $("#tabs") as HTMLElement;
  host.innerHTML = "";
  const cur = editorStore.currentTabId;
  TB().forEach((t) => {
    const el = document.createElement("div");
    el.className = "tab" + (t.id === cur ? " active" : "");
    el.title = t.path ? G.short(t.path) : t.title;
    const dup = t.path && TB().some((o) => o !== t && o.kind === "file" && o.title === t.title);
    el.innerHTML = `${tabIc(t)}<span class="nm">${esc(t.title)}${
      dup ? ` <span style="color:var(--fg-muted)">${esc((t.path as string).split("/").slice(-3, -2)[0] || "")}</span>` : ""
    }</span><button class="x">${svg("close")}</button>`;
    el.onclick = (e) => {
      if ((e.target as Element).closest(".x")) {
        e.stopPropagation();
        closeTab(t.id);
        return;
      }
      G.show(t.id);
    };
    el.onauxclick = (e) => {
      if (e.button === 1) closeTab(t.id);
    };
    tabMarks.decorate(t, el);
    host.appendChild(el);
  });
  tabMarks.after(host);
  const a = host.querySelector(".active");
  if (a && a.scrollIntoView) a.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** O painel do Co-Dev volta à doca lateral (quando a vista central o largou). */
function parkAgent(): void {
  const b = $("#ag-body") as HTMLElement;
  if ((b.parentElement as HTMLElement).id !== "agent") ($("#agent") as HTMLElement).appendChild(b);
}

function miniOff(): void {
  ($("#minimap") as HTMLElement).classList.add("hidden");
  ($("#ebody") as HTMLElement).classList.remove("with-mm");
}

/** Mostra o separador `id` (`null` = nenhum: o ecrã vazio com os atalhos). */
function show(id: string | null): void {
  const t = tabOf(id),
    host = $("#ebody") as HTMLElement;
  parkAgent();
  host.innerHTML = "";
  host.scrollTop = 0;
  host.scrollLeft = 0;
  if (!t) {
    editorStore.currentTabId = null;
    drawTabs();
    miniOff();
    ($("#breadcrumbs") as HTMLElement).innerHTML = "";
    host.innerHTML = `<div class="empty"><div><b style="color:var(--fg-dim);font-size:14px">dxtutor IDE</b><br><kbd>Ctrl+P</kbd> ir para ficheiro &nbsp; <kbd>Ctrl+Shift+P</kbd> comandos<br><kbd>Ctrl+L</kbd> falar com o Co-Dev &nbsp; <kbd>Ctrl+\`</kbd> terminal</div></div>`;
    services.explorer!.drawOutline();
    stLang();
    return;
  }
  editorStore.currentTabId = id;
  drawTabs();
  /* os segmentos de um caminho não se traduzem (`.crumb` está no TR_SKIP); o título de um separador sem caminho
     («Bem-vindo», «Quadro», …) sim, como no separador — por isso vai fora da classe `.crumb` */
  ($("#breadcrumbs") as HTMLElement).innerHTML = (t.path ? t.path.split("/") : ["dxtutor", t.title])
    .map((s, i, a) => `<span class="${t.path || i === 0 ? "crumb" : "crumb-t"}"${i === a.length - 1 ? ' style="color:var(--fg)"' : ""}>${esc(s)}</span>`)
    .join('<span class="sep">›</span>');
  if (t.kind !== "file") miniOff();
  VIEW[t.kind](t, host);
  services.shell!.hydrate();
  services.explorer!.drawOutline();
  services.explorer!.markActive();
  stLang();
  ctxPill();
}

function closeTab(id: string): void {
  const i = TB().findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = TB()[i];
  TB().splice(i, 1);
  bus.emit("editor:tab-closed", { id, path: t.kind === "file" && typeof t.path === "string" ? t.path : null });
  if (t.kind === "agent") {
    parkAgent();
    services.shell!.setVar("--agent-w", "380px");
    ($("#tgl-agent") as HTMLElement).classList.add("on");
  }
  if (editorStore.currentTabId === id) G.show(TB().length ? TB()[Math.max(0, i - 1)].id : null);
  else drawTabs();
}

/** Ctrl+Tab / Ctrl+Shift+Tab: o separador seguinte/anterior, em ciclo. */
function stepTab(d: number): void {
  if (!TB().length) return;
  const i = TB().findIndex((t) => t.id === editorStore.currentTabId);
  G.show(TB()[(i + d + TB().length) % TB().length].id);
}

/* ───── a barra de acções do editor (ADR-0004, U4g5 — era a decoração do v6.ts) ─────
   Nos separadores de ficheiro e de diff, os breadcrumbs ganham Explain / Code review /
   Debug / RUN / Under the hood (o visualizer acrescenta «Visualize» ao `EACT` no boot7). O
   `show` publicado é este; as chamadas internas acima passam pelo `window.show`, como
   faziam antes da U4b (o `show` era `window.show` no app.ts) — a U4b tinha-as tornado
   locais e a barra deixara de aparecer ao abrir um ficheiro (regressão corrigida aqui). */
const EACT: [string, string, string, string][] = [['bulb', 'Explain', 'Ctrl+K E', 'explainCmd'], ['review', 'Code review', 'Ctrl+K R', 'reviewCmd'], ['bug', 'Debug', 'F5', 'startDebug'], ['run', 'RUN', 'Ctrl+F5', 'dxRun'], ['eye', 'Under the hood', 'Ctrl+K U', 'hoodCmd']];
/* os botões da barra de acções do editor chamam a função publicada, no acto (eram `onclick="f()"` — ADR-0004, U5a) */
/* os da barra que já não vão ao window chamam a função importada (ADR-0004, U7p5/U7p6); o hoodCmd a publicada */
const EACT_LOCAL: Record<string, () => unknown> = { explainCmd: () => explainCmd(), reviewCmd: () => reviewCmd(), startDebug: () => startDebug(), dxRun: () => dxRun() };
registerActions(Object.fromEntries(EACT.map((a) => [`tabs:${a[3]}`, { click: () => void (EACT_LOCAL[a[3]] ? EACT_LOCAL[a[3]]() : callGlobal(a[3])) }])));
function showWithActions(id: string | null): void {
  show(id);
  const t = tabOf(editorStore.currentTabId), b = $("#breadcrumbs");
  if (!b || !t || !["file", "diff"].includes(t.kind)) return;
  b.insertAdjacentHTML("beforeend", `<span class="ed-acts">${EACT.map((a) => `<button title="${a[1]} (${a[2]})" data-action="tabs:${a[3]}">${svg(a[0])}<span>${a[1]}</span></button>`).join("")}</span>`);
}

/* publicação transitória no window (o monólito e os onclick inline chamam por nome) */
/** Volta a desenhar o separador activo se for do tipo `kind`, mantendo o scroll (era do app.ts,
 *  ADR-0004 U4j3; como lá, usa o `show` publicado — o da barra de acções). */
function rerender(kind: string): void { const t=tabOf(editorStore.currentTabId);if(t&&t.kind===kind){const top=$('#ebody')!.scrollTop;G.show(editorStore.currentTabId);$('#ebody')!.scrollTop=top;} }

Object.assign(window, { tabOf, openTab, openPath, show: showWithActions });

export { EACT, rerender, tabOf, openTab, openPath, openFile, setActive, tabIc, drawTabs, parkAgent, miniOff, show, closeTab, stepTab };
/* o que a ponte do Co-Dev, a equipa e o Learning Track lêem — avaliam antes (ADR-0004, U7h) */
services.tabs = { miniOff, closeTab, rerender, EACT };
