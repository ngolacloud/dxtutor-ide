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

/** Uma extensão: instalada por VSIX (`EXS.vsix`), um resultado da pesquisa do Open VSX
 *  (`remote`) ou uma recomendação para o projecto (`why`). Já não há um catálogo fixo nem
 *  extensões «bundled»/«com efeito» a fingir (ADR-0006, R6b). */
export interface ExtItem {
  id: string;
  n: string;
  pub: string;
  d: string;
  ctx: string[];
  cmds?: ExtCmd[];
  /** Os números do Open VSX (só nos resultados da pesquisa). */
  remote?: { downloads: number; verified: boolean };
  /** Porque se recomenda (só nas recomendações, p.ex. «Rust project»). */
  why?: string;
  vsix?: number;
  ver?: string;
  engines?: string;
  cfg?: string[];
  act?: string[];
  contrib?: ContribSummary;
}

/** Estado instalado (`EXS`): mapa id→{on} das extensões instaladas por VSIX + a lista delas, e
 *  as funcionalidades do próprio dxtutor que se ligam e desligam (`builtin`). */
export interface ExsState {
  inst: Record<string, { on: number | boolean }>;
  vsix: ExtItem[];
  builtin: Record<string, boolean>;
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
