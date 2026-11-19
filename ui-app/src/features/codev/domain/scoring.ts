/* ═══════════ Co-Dev — scoring & thresholds (ADR-0002, Phase 2) ═══════════
   The judge's rubric, the candidate score, the acceptance-check score, the
   deliver/retry threshold and the single retry-limit constant. These rules
   used to be scattered: `total()` in the council, the `score >= THRESH` check
   in `evaluate`, and the literal `2` in three places (`runMission` loop,
   `reflect` label). Pure: no DOM, no `window`, no Tauri. */

/** The judge's weighted rubric. `k` keys the per-candidate scores (`sc.c`,
 *  `sc.a`, …); `s`/`l` are short/long labels; `w` is the weight (sums to 100).
 *  This is the single definition of the rubric — `codev.ts` re-exports it as
 *  the `CRIT` global for the residual readers that still expect it. */
export const RUBRIC: Array<{ k: string; s: string; l: string; w: number }> = [
  { k: "c", s: "Corr.", l: "Correcção", w: 30 },
  { k: "a", s: "Arq.", l: "Arquitectura", w: 25 },
  { k: "t", s: "Testes", l: "Testes", w: 20 },
  { k: "r", s: "Risco", l: "Risco", w: 15 },
  { k: "k", s: "Custo", l: "Custo", w: 10 },
];

/** How many times the agent self-corrects before escalating to the human. */
export const RETRY_LIMIT = 2;

/** A candidate's total out of 10: weighted sum of its per-criterion scores,
 *  divided by 10 (weights sum to 100, each score is 0–10). */
export function candidateTotal(sc: Record<string, number>): number {
  return RUBRIC.reduce((s, k) => s + sc[k.k] * k.w, 0) / 10;
}

/** Sum of the weights of the checks that passed — the delivery score out of 100. */
export function scoreChecks(results: Array<{ w: number; ok: boolean }>): number {
  return results.reduce((s, k) => s + (k.ok ? k.w : 0), 0);
}

/** A delivery passes when its score reaches the configured threshold. */
export function passesThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}
