/* ═════════ cliente IPC: pesquisa no projecto — ADR-0005, R2b ═════════
   Contrato de `search_project` (src-tauri/src/commands/search.rs): procura literal em toda a
   pasta no disco (salta .git/node_modules/target/dist…, binários e ficheiros grandes). */
import { invoke, type Invoker } from "./core";

/** `tutor_eval::search::SearchHit`: caminho relativo à pasta, linha e coluna (1-based; a
 *  coluna é um offset em bytes) e a linha (aparada a 240 caracteres). */
export interface SearchHit {
  file: string;
  line: number;
  col: number;
  text: string;
}

export const searchClient = (inv: Invoker = invoke) => ({
  project: (root: string, query: string, max?: number, ignoreCase?: boolean): Promise<SearchHit[]> =>
    inv<SearchHit[]>("search_project", { root, query, max: max ?? null, ignoreCase: ignoreCase ?? null }),
});

export type SearchClient = ReturnType<typeof searchClient>;
