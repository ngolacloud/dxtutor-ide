/* ═══════════ feature `scm` (Source Control + git) — domain types (ADR-0002) ═══════════
   Formas puras de TypeScript do domínio git/scm: o commit, o DAG, a árvore por
   ramo, a entrada de ficheiro da árvore de trabalho, o layout do grafo e o autor.

   Regra de dependências (ADR-0002, verificada por A7/A8): esta pasta não importa
   NADA — sem DOM, sem `window`, sem Tauri, sem `application/`/`ui/`/`infrastructure/`.
   São só dados: o motor (`application/`) e o resíduo de composição (`features/scm.ts`)
   consomem estas formas; o domínio nunca vai buscar nada ao mundo. */

/** Uma árvore de ficheiros por ramo: caminho → conteúdo carimbado. */
export type Tree = Record<string, string>;

/** Um commit do DAG: hash, mensagem, pais, ramo, autor, timestamp e ficheiros. */
export interface Commit {
  h: string;
  m: string;
  p: string[];
  b: string;
  a: string;
  t: number;
  files: string[];
}

/** O estado git: DAG de commits + ordem topológica + refs/árvores/bases/tags. */
export interface GitState {
  c: Record<string, Commit>;
  order: string[];
  refs: Record<string, string>;
  trees: Record<string, Tree>;
  base: Record<string, Tree>;
  tags: Record<string, string>;
}

/** Uma entrada da árvore de trabalho (`FS[p]`): conteúdo actual + original
 *  carimbado (`null` = ficheiro novo/não versionado). */
export interface FileEntry {
  content: string;
  orig: string | null;
}

/** Estado de um ficheiro face ao original: '' limpo, 'M' modificado, 'U' novo. */
export type Status = "" | "M" | "U";

/** Uma linha do grafo de commits: o commit, a sua coluna (lane) e as colunas dos pais. */
export interface GraphRow {
  h: string;
  col: number;
  pl: number[];
}

/** O layout completo do grafo: linhas + índice hash→posição + nº máximo de lanes. */
export interface GraphLayout {
  rows: GraphRow[];
  idx: Record<string, number>;
  max: number;
}

/** Um autor resolvido para apresentação: nome + cor. */
export interface Author {
  n: string;
  col: string;
}

/** Os tipos de ramo gitflow (prefixo antes de `/`). */
export type FlowKind = "feature" | "fix" | "hotfix" | "release";
