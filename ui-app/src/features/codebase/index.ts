/* ═════════ feature `codebase` — raiz de composição (A10, docs/v2/UI-AUDIT.md §3) ═════════
   Os separadores «Dependencies» e «Onboarding», só na app desktop com uma pasta: liga o serviço ao backend
   (infrastructure/tauri.ts), ao terminal/editor (infrastructure/legacy-bridge.ts) e ao Co-Dev. Sem `window`. */

import { VIEW } from "../../app/store/registry";
import { codevAsk } from "../../app/codev-ask";
import { translator } from "../../app/i18n";
import { isDesktop } from "../../platform/tauri/core";
import { makeCodebase } from "./application/codebase-service";
import { tauriCodebase } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { CODEBASE_MESSAGES, type CodebaseKey } from "./ui/messages";
import { renderDeps, renderMap } from "./ui/codebase-view";
import { bindActions, type ActionTable } from "./ui/actions";

const t = translator(CODEBASE_MESSAGES);
export const codebase = makeCodebase({
  port: tauriCodebase(),
  world: { root: () => B.root(), runInTerminal: (c) => B.runInTerminal(c), open: (r) => B.openRel(r), showTests: () => B.showTests() },
  human: { confirm: (m) => B.confirmBox(m), toast: (m) => B.notify(m) },
  codev: { available: () => codevAsk.available(), ask: (r) => { void codevAsk.ask(r); } },
  say: (k, p) => t(k as CodebaseKey, p),
});

const desktop = (): boolean => isDesktop() && !!B.root();
const hosts: Record<string, HTMLElement | null> = {};
const RENDER: Record<string, () => string> = {
  "codebase-deps": () => renderDeps(t, codebase.state(), codevAsk.available(), desktop()),
  "codebase-map": () => renderMap(t, codebase.state(), codevAsk.available(), desktop()),
};
const paint = (kind: string): void => { const h = hosts[kind]; if (h && h.isConnected) h.innerHTML = RENDER[kind](); };
VIEW["codebase-deps"] = (_t, h) => { hosts["codebase-deps"] = h; h.innerHTML = RENDER["codebase-deps"](); if (desktop() && !codebase.state().deps) void codebase.loadDeps(false); };
VIEW["codebase-map"] = (_t, h) => { hosts["codebase-map"] = h; h.innerHTML = RENDER["codebase-map"](); if (desktop() && !codebase.state().map) void codebase.loadMap(); };
codebase.subscribe(() => Object.keys(RENDER).forEach(paint));
document.addEventListener("dx:workspace", () => { const s = codebase.state(); s.deps = null; s.map = null; });

export const openDeps = (): void => B.openTab("codebase-deps", t("depsTab"));
export const openOnboarding = (): void => B.openTab("codebase-map", t("mapTab"));

const split = (s: string): [number, string] => { const i = s.indexOf("|"); return [Number(s.slice(0, i)), s.slice(i + 1)]; };
const ACTIONS: ActionTable = {
  "cb-online": { on: "change", run: (e) => { void codebase.loadDeps((e.el as HTMLInputElement).checked); } },
  "cb-check": { on: "click", run: () => { void codebase.loadDeps(); } },
  "cb-tests": { on: "click", run: () => codebase.showTests() },
  "cb-update": { on: "click", run: (e) => { const [i, n] = split(e.on); codebase.update(i, n, false); } },
  "cb-upgrade": { on: "click", run: (e) => { const [i, n] = split(e.on); codebase.update(i, n, true); } },
  "cb-plan": { on: "click", run: (e) => { const [i, n] = split(e.on); codebase.planUpgrade(i, n); } },
  "cb-why": { on: "click", run: (e) => { const [i, id] = split(e.on); codebase.explainVuln(i, id); } },
  "cb-map-refresh": { on: "click", run: () => { void codebase.loadMap(); } },
  "cb-tour": { on: "click", run: () => codebase.tour() },
  "cb-run": { on: "click", run: (e) => codebase.runEntry(Number(e.on)) },
  "cb-open": { on: "click", run: (e) => codebase.open(e.on) },
};
bindActions(ACTIONS);
