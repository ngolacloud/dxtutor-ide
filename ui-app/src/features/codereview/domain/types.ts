/* ═══════════ feature Explain · Code-Review · Under-the-Hood — domínio (tipos) ═══════════
   Formas puras do motor de revisão. Sem DOM, sem `window`, sem Tauri; não importa
   de `application/`/`ui/`/`infrastructure/` (regra de dependências — A7/A8). */

/** As quatro severidades, por ordem de gravidade (ver `scoring.ts`). */
export type Severity = "bug" | "risk" | "perf" | "style";

/** Um achado da revisão: linha, severidade, título, porquê e sugestão. Os textos
 *  `t`/`why`/`fix` são HTML renderizado tal-e-qual na tab de Code review. */
export interface Finding {
  l: number;
  sev: Severity;
  t: string;
  why: string;
  fix: string;
}

/** Um achado de cor fixa do `dsLint` do monólito, já filtrado para este ficheiro.
 *  (O `dsLint` lê o workspace inteiro; a regra recebe só as entradas deste path.) */
export interface DsHex {
  line: number;
  hex: string;
}

/** Factos do lexer-protótipo (`crates/lexer/src/lib.rs`) resolvidos pelo monólito
 *  (v6.ts: `lexBug`/`LXL`). Só presente quando o ficheiro revisto É esse protótipo;
 *  `null` para qualquer outro. `peekLine` é a linha de `chars.peek()`. */
export interface LexerFacts {
  bug: boolean;
  peekLine: number;
}

/** Tudo o que a regra pura precisa para revisar um ficheiro — injectado pelo
 *  resíduo, que colhe `content`/`ext`/`dsLint`/`lexer` do mundo (FS/extOf/window). */
export interface ReviewInput {
  path: string;
  content: string;
  ext: string;
  lexer: LexerFacts | null;
  dsLint: DsHex[];
}
