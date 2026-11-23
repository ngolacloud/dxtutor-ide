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

/** Tudo o que a regra pura precisa para revisar um ficheiro (o conteúdo vem do FS). */
export interface ReviewInput {
  path: string;
  content: string;
  ext: string;
}
