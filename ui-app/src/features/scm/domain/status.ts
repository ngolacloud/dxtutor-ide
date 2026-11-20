/* ═══════════ feature `scm` — domain: estado da árvore de trabalho (ADR-0002, Fase 2) ═══════════
   Regras PURAS do estado de um ficheiro face ao original e da lista de alterações.
   Sem DOM, sem `window` — recebem a entrada do `FS` por argumento. (Antes viviam
   em `features/scm.ts` como `stOf`/`changes`, lendo o global `FS`.) */

import type { FileEntry, Status } from "./types";

/** Estado de um ficheiro: '' limpo/sem versão, 'U' novo (sem original), 'M'
 *  modificado. Ficheiros sob `/learn/` nunca contam (não são versionados aqui). */
export function statusOf(file: FileEntry | undefined, path: string): Status {
  return !file || /\/learn\//.test(path) ? "" : file.orig == null ? "U" : file.content !== file.orig ? "M" : "";
}

/** Os caminhos com estado (modificado/novo), por ordem alfabética. */
export function listChanges(files: Record<string, FileEntry>): string[] {
  return Object.keys(files).filter((p) => statusOf(files[p], p)).sort();
}
