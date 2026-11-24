/* ═══════════ feature `debug` — application: casos de uso (ADR-0002, Fase 3) ═══════════
   Puros face ao mundo: recebem as capacidades por portas (`DebugDeps`) e dependem só de
   `domain/`. Sem DOM, sem `window`, sem Tauri — a composição (`features/debug.ts`)
   injecta os adaptadores do legacy-bridge e as funções de desenho.

   ADR-0006, R1c2: as sessões guionadas (o E0382 do lexer de demonstração e o crash de
   DNS com saídas de `kubectl` inventadas) saíram. Não há adaptador de depuração ligado,
   por isso «Start debugging» abre o pane e o assistente e diz isso mesmo; os breakpoints
   são reais (alternados no gutter/F9, guardados em LS, pintados pelo editor) e ficam à
   espera do DAP (R4). O Set é mutado no SÍTIO (mesma referência que o resíduo publica em
   `window.BPS`/`dbgBreaks`). */

import { bpKey } from "../domain/breakpoints";
import type { DebugDeps, DebugEngine } from "./ports";

/** Mensagem única de «ainda sem depurador» (toast do F5 e de Step/Stop sem sessão). */
export const NO_DEBUGGER = "No debugger attached — debug sessions need a debug adapter (DAP), not connected yet";

export function makeDebugEngine(deps: DebugDeps): DebugEngine {
  const { store, editor, shell, view, notifier } = deps;

  function startDebug(): void {
    store.hydrate();
    shell.goPane("debug");
    shell.setPanelTab("dbg");
    view.refresh();
    notifier.toast(NO_DEBUGGER);
  }

  const noSession = (): void => notifier.toast("No debug session");

  function toggleBp(p: string, l: number): void {
    store.hydrate();
    const BPS = store.breakpoints(), k = bpKey(p, l);
    if (BPS.has(k)) BPS.delete(k); else BPS.add(k);
    store.save(); view.refresh();
    const t = editor.currentTab(); if (t && t.path === p) editor.paintEd(p);
  }

  return { startDebug, dbgStep: noSession, dbgStop: noSession, toggleBp };
}
