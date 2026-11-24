/* ═══════════ feature `debug` — application ports (ADR-0002, Fase 3) ═══════════
   O motor nesta pasta (`debug-engine.ts`) depende SÓ de `domain/` e das interfaces
   declaradas aqui. Nunca toca no DOM, em `window`, no Tauri ou no legacy-bridge — essas
   capacidades são fornecidas, no acto da composição (`features/debug.ts`), por
   adaptadores sobre `infrastructure/legacy-bridge.ts`.

   Sem sessões simuladas (ADR-0005, R1c2): saíram o passo-a-passo guionado do lexer de
   demonstração e as sondas inventadas a um pod em crash, e com eles as portas que só
   eles usavam (variante/linhas do lexer, geradores de traço, ambientes, checkpoint,
   humano, diálogo, relógio). Fica o que é real — os breakpoints, guardados e pintados no
   editor — e a entrada «Start debugging», que diz com honestidade que ainda não há
   adaptador de depuração (DAP) ligado. As sessões reais chegam na R4 (`debug_*`).

   O Set de breakpoints é window-backed no resíduo; o motor vê-o e muta-o pela porta
   `DebugStore` (MESMA referência que o resíduo publica). As funções de DESENHO
   (drawDbg/refreshDbg/renderDebugPane) vivem no resíduo e entram por `DebugView`. */

/** O Set de breakpoints (`path:line`) e a sua persistência em LS (hidratação
 *  preguiçosa + gravação), implementados no resíduo sobre o bridge. */
export interface DebugStore {
  breakpoints(): Set<string>;
  hydrate(): void;
  save(): void;
}

/** O editor: separador actual e repintar os gutters (breakpoints). */
export interface Editor {
  currentTab(): { path?: string; kind?: string } | null;
  paintEd(path: string): void;
}

/** A casca da UI: navegação para o pane e separador do painel inferior. */
export interface Shell {
  goPane(p: string): void;
  setPanelTab(pt: string, nofocus?: boolean): void;
}

/** As funções de desenho, donas do DOM (vivem no resíduo). */
export interface DebugView {
  refresh(): void;
}

export interface Notifier { toast(m: string): void }

/* ───────── pacote de dependências entregue ao motor ───────── */

export interface DebugDeps {
  store: DebugStore;
  editor: Editor;
  shell: Shell;
  view: DebugView;
  notifier: Notifier;
}

/** A superfície que o motor devolve. Sem sessão de depuração possível ainda,
 *  `dbgStep`/`dbgStop` só avisam que não há sessão (os menus/atalhos de v6 e
 *  `features/shortcuts.ts` continuam a chamá-los por nome). */
export interface DebugEngine {
  startDebug(): void;
  dbgStep(): void;
  dbgStop(): void;
  toggleBp(p: string, l: number): void;
}
