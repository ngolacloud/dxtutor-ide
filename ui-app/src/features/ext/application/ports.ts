/* ═══════════ feature `ext` (Open VSX) — application ports (ADR-0002, Fase 3) ═══════════
   O motor nesta pasta (`ext-engine.ts`) depende SÓ de `domain/` e das interfaces
   declaradas aqui. Nunca toca no DOM, em `window`, no Tauri ou no legacy-bridge —
   essas capacidades são fornecidas, no acto da composição (`features/ext.ts`, o
   resíduo strangler), por adaptadores sobre `infrastructure/legacy-bridge.ts`.

   É isto que torna o motor testável e livre de `window`: dá-se-lhe um catálogo, um
   acesso ao estado instalado e um punhado de portas (paleta/editor/separadores/VSIX/
   notificações/rerender) e as instalações, toggles e formatações correm sem browser.
   A regra de dependências aponta para dentro: as portas importam `domain/`, nunca o
   contrário. (Verificado por A7/A8 do `arch-check`.)

   Estado window-backed atravessa o bridge, não a application: `EXS` (o estado
   instalado) vive em `window.EXS` no resíduo e hidrata de `LS` preguiçosamente; o
   motor só vê, através da porta `InstalledState`, o objecto JÁ hidratado, e muta-o
   no sítio. A hidratação (que lê `LS`) fica do lado do resíduo/bridge. */

import type { ExtItem, ExsState } from "../domain/types";

/* ───────── superfície mínima do JSZip de que o carregador de VSIX precisa ─────────
   Espelha a forma tipada no `infrastructure/legacy-bridge.ts` (`JSZipLib` et al.),
   repetida aqui para que `application/` não importe `infrastructure/`. */
export interface JSZipFile {
  async(type: string): Promise<string>;
}
export interface JSZipArchive {
  file(path: string): JSZipFile | null;
}
export interface JSZipLib {
  loadAsync(data: unknown): Promise<JSZipArchive>;
}

/** O argumento com que o motor abre um separador de detalhe de extensão. */
export interface OpenTabArg {
  id: string;
  title?: string;
  kind?: string;
  ext?: string;
}

/* ───────── portas (o que o motor pede ao mundo) ───────── */

/** O estado instalado (`EXS`): window-backed no resíduo e hidratado de `LS`
 *  preguiçosamente. O motor só vê o objecto JÁ hidratado — `read()` garante a
 *  hidratação — e muta-o no sítio (as mutações persistem porque é a mesma
 *  referência que o resíduo publica em `window.EXS`). */
export interface InstalledState {
  read(): ExsState;
}

/** Persistência do estado instalado (`LS`, dono do monólito). */
export interface Storage {
  save(state: ExsState): void;
}

/** Uma entrada da paleta de comandos (`CMD`): rótulo, atalho, acção, tag. */
export type PaletteEntry = [string, string, (() => unknown)?, string?];

/** A paleta de comandos: um array mutável que o motor corta/empurra (splice/push)
 *  para registar e desregistar os comandos das extensões activas (tag `'ext'`). */
export interface Palette {
  entries(): PaletteEntry[];
}

/** Capacidades de editor/ficheiros de que o formatador e as acções precisam. */
export interface Editor {
  files(): Record<string, { content: string; orig: string | null }>;
  current(): string | null;
  tabOf(id: string | null): { kind?: string; path?: string } | null;
  extOf(path: string): string;
  refresh(fromEd?: boolean, force?: boolean): unknown;
}

/** Abertura de separadores (o detalhe da extensão após instalar um VSIX). */
export interface Tabs {
  open(tab: OpenTabArg): void;
}

/** Carregamento preguiçoso da biblioteca de unzip (JSZip) para ler VSIX. */
export interface Vsix {
  load(): Promise<JSZipLib>;
}

/** Notificações de utilizador (toast). */
export interface Notifier {
  toast(msg: string): void;
}

/** Re-render da UI de extensões após uma mudança de estado (pane + tab de detalhe
 *  + editor). Dona do resíduo/view; injectada para o motor ficar sem DOM. */
export type Rerender = () => void;

/* ───────── pacote de dependências entregue ao motor ───────── */

export interface ExtDeps {
  /** O catálogo Open VSX (`EXT`). Construído na composição porque os `cmds` com
   *  efeito capturam acções do bridge (dxRun/dxStop/…); não é dado puro. */
  catalogue: ExtItem[];
  state: InstalledState;
  storage: Storage;
  palette: Palette;
  editor: Editor;
  tabs: Tabs;
  vsix: Vsix;
  notifier: Notifier;
  rerender: Rerender;
  /** Contribuições declarativas (temas, gramáticas, snippets…) — Fase 4. Opcional: sem
   *  ela o VSIX instala-se só com o manifesto, como antes. */
  contrib?: import("./contributions-engine").ContribEngine;
}
