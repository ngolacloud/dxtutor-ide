/* ═══════════ feature `scm` — domain: política gitflow (ADR-0002, Fase 2) ═══════════
   Regras PURAS do gitflow: que ramos são de fluxo (feature/fix/hotfix/release) e
   como se gera o slug de um nome de ramo. Sem DOM, sem `window`. (Antes viviam em
   `features/scm.ts` como `isFlow`/`slug`.) */

/** Um ramo é «de fluxo» (gitflow) se tem um dos prefixos conhecidos antes de `/`. */
export const isFlow = (b: string): boolean => /^(feature|fix|hotfix|release)\//.test(b);

/** Normaliza um nome para o segmento de um ramo: minúsculas, sem acentos, só
 *  `[a-z0-9]` e hífenes, sem hífenes nas pontas. */
export const slug = (s: string): string =>
  String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
