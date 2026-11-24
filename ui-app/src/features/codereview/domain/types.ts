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

/* ───── os analisadores reais do projecto (`review_code`, ADR-0006 R2e2) ─────
   Espelham `tutor_eval::review` (camelCase): clippy/rustc, go vet, ruff, … sobre o ficheiro
   no disco. A classe é o contrato de honestidade do backend: um lint de estilo nunca é um
   bug, um erro de compilação nunca é uma sugestão. */

export type AnalyzerClass = "bug" | "risk" | "opportunity";
export type AnalyzerSeverity = "error" | "warning" | "info";

export interface AnalyzerSpan {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
  label: string | null;
}

export interface AnalyzerFinding {
  analyzer: string;
  rule: string | null;
  class: AnalyzerClass;
  severity: AnalyzerSeverity;
  message: string;
  primary: AnalyzerSpan;
  related: AnalyzerSpan[];
  evidence: string | null;
  consequence: string | null;
  verification: string | null;
}

/** `AnalyzerStatus`: correu, falhou, não está instalado, ou não se aplica ao âmbito. */
export type AnalyzerStatus = "ran" | "failed" | "unavailable" | "skipped";

export interface AnalyzerRun {
  id: string;
  language: string;
  status: AnalyzerStatus;
  detail: string | null;
  filesCovered: number;
}

export interface AnalyzerReport {
  findings: AnalyzerFinding[];
  analyzers: AnalyzerRun[];
  version: string | null;
}
