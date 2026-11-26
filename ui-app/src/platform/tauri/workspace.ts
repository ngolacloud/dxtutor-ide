/* ═════════ dxtutor IDE — adaptador tipado: abrir workspace (Etapa 2) ═════════
   Contrato e cliente do comando `load_workspace`. É a fronteira tipada da primeira fatia
   vertical UI→adaptador→caso de uso→impl: o backend (`bridge::load_workspace` → caso de uso
   `workspace::open_workspace`) devolve `workspace::Loaded` (serde camelCase), espelhado aqui
   por `LoadedWorkspace`. `bridge.ts` passa a chamar `loadWorkspace(root)` em vez da string
   solta `inv("load_workspace", { root })`. */

import { invoke } from "./core";

/** Um ficheiro de texto carregado no editor (relativo à raiz, com o conteúdo). */
export interface WorkspaceFile {
  path: string;
  content: string;
}

/**
 * Workspace carregado — espelho tipado de `workspace::Loaded` do backend (serde camelCase).
 * `skipped`/`truncated` são sempre devolvidos pelo comando (binários/grandes ignorados; limite
 * de ficheiros ou de tamanho total atingido), por isso não são opcionais.
 */
export interface LoadedWorkspace {
  root: string;
  name: string;
  files: WorkspaceFile[];
  skipped: number;
  truncated: boolean;
  /** Pastas que o git ignora por inteiro (build, caches, coverage…), não carregadas (P2). */
  ignoredDirs?: number;
}

/**
 * Abre uma pasta como workspace do editor, pelo caso de uso tipado do backend. `root` é o
 * caminho absoluto da pasta; o backend canonicaliza-o e devolve-o em {@link LoadedWorkspace.root}.
 * Rejeita com a mensagem do backend (ex. `"<root>: not a folder"`) se `root` não for uma pasta.
 */
export function loadWorkspace(root: string): Promise<LoadedWorkspace> {
  return invoke<LoadedWorkspace>("load_workspace", { root });
}
