/* ═══════════ feature Explain · Code-Review · Under-the-Hood — domínio (pontuação) ═══════════
   Política de severidade: a ordem de gravidade (como a regra ordena os achados) e
   a penalização de cada severidade (como se calcula a nota /100). Puro. */

import type { Finding, Severity } from "./types";

/** Ordem de gravidade — a regra ordena os achados por este índice (ordenação
 *  estável: dentro da mesma severidade mantém-se a ordem de detecção). */
export const SEV_ORDER: Severity[] = ["bug", "risk", "perf", "style"];

/** Penalização de cada severidade na nota de revisão. */
export const SEV_PENALTY: Record<Severity, number> = { bug: 25, risk: 12, perf: 8, style: 3 };

/** Nota de 0 a 100: 100 menos a soma das penalizações dos achados. */
export function scoreFor(findings: Finding[]): number {
  return Math.max(0, 100 - findings.reduce((a, f) => a + SEV_PENALTY[f.sev], 0));
}
