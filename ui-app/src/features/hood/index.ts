/* ═════════ feature `hood` — raiz de composição (A8, docs/v2/UI-AUDIT.md item 7) ═════════
   O «Under the hood» REAL e o traço de execução REAL, só na app desktop: liga o serviço
   (application/hood-service.ts) ao backend (infrastructure/tauri.ts), ao editor
   (infrastructure/legacy-bridge.ts) e ao Co-Dev (`codev.ask`); regista os separadores «hood-real» e
   «exec-trace», as acções `hd-*`/`tr-*`, e acrescenta ao «Under the hood» existente (VIEW.hood, do
   codereview) os botões para eles — só no desktop: no browser e nos goldens nada muda. Sem `window`
   aqui (só pelo bridge). */

import { VIEW } from "../../app/store/registry";
import { codevAsk } from "../../app/codev-ask";
import { translator } from "../../app/i18n";
import { isDesktop } from "../../platform/tauri/core";
import { langOf } from "./domain/rules";
import { makeHood, type Stage } from "./application/hood-service";
import { tauriHood } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { HOOD_MESSAGES, type HoodKey } from "./ui/messages";
import { renderHood } from "./ui/hood-view";
import { renderTrace } from "./ui/trace-view";
import { bindActions, type ActionTable } from "./ui/actions";

const t = translator(HOOD_MESSAGES);

export const hood = makeHood({
  hood: tauriHood(),
  source: { current: () => B.currentFile(), open: (p, l) => B.openAt(p, l) },
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  tabs: { open: (id, title, kind) => B.openTab(id, title, kind) },
  notifier: { toast: (m) => B.notify(m) },
  say: (k, p) => t(k as HoodKey, p),
});

const hosts: Record<string, HTMLElement | null> = {};
const RENDER: Record<string, () => string> = {
  "hood-real": () => renderHood(t, hood.hood(), codevAsk.available()),
  "exec-trace": () => renderTrace(t, hood.trace(), codevAsk.available()),
};
function paint(kind: string): void {
  const h = hosts[kind];
  if (!h || !h.isConnected) return;
  const a = document.activeElement;
  if (a && h.contains(a) && a.tagName === "INPUT" && (a as HTMLInputElement).type !== "range") return;
  h.innerHTML = RENDER[kind]();
}
for (const kind of Object.keys(RENDER)) VIEW[kind] = (_t, host) => { hosts[kind] = host; host.innerHTML = RENDER[kind](); };
hood.subscribe(() => Object.keys(RENDER).forEach(paint));

const desktopOnly = (f: () => unknown) => (): void => { if (!isDesktop()) { B.notify(t("needDesktop")); return; } void f(); };
/** Abre o «Under the hood (real)» do ficheiro no ecrã. */
export const openHoodReal = desktopOnly(() => hood.openHood());
/** Abre o traço de execução real do ficheiro no ecrã. */
export const openTrace = desktopOnly(() => hood.openTrace());

/* o «Under the hood» existente ganha, no desktop e para Rust/Python, os botões para as vistas reais */
const prevHood = VIEW.hood;
if (prevHood) {
  VIEW.hood = (tab, host) => {
    prevHood(tab, host);
    const p = (tab as { path?: string }).path ?? "";
    if (!isDesktop() || !langOf(p)) return;
    host.querySelector(".page h1")?.insertAdjacentHTML("afterend", `<div class="hd-entry"><button class="mini pri" data-action="hd-open-real">${t("openReal")}</button><button class="mini" data-action="hd-open-trace">${t("openTrace")}</button></div>`);
  };
}

const n = (s: string): number => Number(s) || 0;
const ACTIONS: ActionTable = {
  "hd-open-real": { on: "click", run: () => openHoodReal() },
  "hd-open-trace": { on: "click", run: () => openTrace() },
  "hd-line": { on: "click", run: (e) => hood.selectLine(n(e.on)) },
  "hd-stage": { on: "click", run: (e) => { void hood.setStage(e.on as Stage); } },
  "hd-profile": { on: "click", run: (e) => { void hood.setRelease(e.on === "release"); } },
  "hd-run": { on: "click", run: () => { void hood.runMeasured(); } },
  "hd-sizes": { on: "input", run: (e) => hood.setSizes(e.value) },
  "hd-growth": { on: "click", run: () => { void hood.measureGrowth(); } },
  "hd-ask-line": { on: "click", run: () => hood.askLine() },
  "hd-ask-growth": { on: "click", run: () => hood.askGrowth() },
  "tr-step": { on: "click", run: (e) => hood.goStep(n(e.on)) },
  "tr-seek": { on: "input", run: (e) => hood.goStep(n(e.value)) },
  "tr-play": { on: "click", run: () => hood.togglePlay() },
  "tr-open": { on: "click", run: (e) => hood.openSource(n(e.on)) },
  "tr-ask": { on: "click", run: () => hood.askStep() },
};
bindActions(ACTIONS);
