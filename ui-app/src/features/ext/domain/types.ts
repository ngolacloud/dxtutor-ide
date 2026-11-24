/* ═══════════ feature `ext` (Open VSX) — domain types (ADR-0002, Fase 2) ═══════════
   Formas puras de TypeScript do domínio de extensões: o item do catálogo, o
   estado instalado, a entrada de comando e o manifesto de um VSIX.

   Regra de dependências (ADR-0002): esta pasta não importa NADA — sem DOM, sem
   `window`, sem Tauri, sem `application/`/`ui/`/`infrastructure/`. São só dados:
   o motor (`features/ext.ts`) e o bridge consomem estas formas, o domínio nunca
   vai buscar nada ao mundo. (Antes viviam no legacy-bridge; mudaram-se para cá.) */

import type { Contributes } from "./contributions";

/** Resumo do que uma extensão instalada por VSIX contribui e o dxtutor aplica (Fase 4). */
export interface ContribSummary {
  themes: string[];
  grammars: string[];
  snippets: number;
  languages: string[];
  /** Servidor LSP conhecido que substitui a extensão (ex.: `clangd`). */
  lsp?: string;
  warnings: string[];
}

/** Uma entrada de comando: rótulo, atalho e (opcional) acção. Os comandos do
 *  catálogo com efeito trazem a acção; os do VSIX trazem só rótulo+atalho. */
export type ExtCmd = [string, string, (() => void)?];

/** Um item do catálogo (`EXT`) ou instalado por VSIX (`EXS.vsix`). */
export interface ExtItem {
  id: string;
  n: string;
  pub: string;
  d: string;
  ctx: string[];
  bundled?: number;
  eff?: string;
  cmds?: ExtCmd[];
  vsix?: number;
  ver?: string;
  engines?: string;
  cfg?: string[];
  act?: string[];
  contrib?: ContribSummary;
}

/** Estado instalado (`EXS`): mapa id→{on} + lista de VSIX. */
export interface ExsState {
  inst: Record<string, { on: number | boolean }>;
  vsix: ExtItem[];
}

/** Manifesto `package.json` de um VSIX (só os campos que lemos; o resto ignora-se). */
export interface VsixManifest {
  publisher: string;
  name: string;
  displayName?: string;
  description?: string;
  version?: string;
  engines?: { vscode?: string };
  activationEvents?: string[];
  contributes?: Contributes & {
    keybindings?: Array<{ command?: string; key?: string }>;
    commands?: Array<{ category?: string; title: string; command?: string }>;
    configuration?: { properties?: Record<string, unknown> };
  };
}
