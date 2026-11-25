/* Textos novos do drift das regras por issue (RF-A05, sessão de fecho, bloco 4) — nascem com chave
   (ADR-0004, U6b): en + ptAO, sem pares no motor de tradução. */
import type { Messages } from "../../../app/i18n";

export const PROJECT_DRIFT_MESSAGES = {
  en: {
    driftTitle: "Architect's rules in this issue's files",
    driftNone: "No violations in the {n} file(s) Co-Dev changed",
    driftProblems: "Show in Problems",
    driftProblemsTitle: "The Problems panel with only the {n} file(s) Co-Dev changed for this issue",
  },
  ptAO: {
    driftTitle: "Regras do arquitecto nos ficheiros desta issue",
    driftNone: "Sem violações nos {n} ficheiro(s) que o Co-Dev alterou",
    driftProblems: "Mostrar no Problems",
    driftProblemsTitle: "O painel Problems só com os {n} ficheiro(s) que o Co-Dev alterou para esta issue",
  },
} satisfies Messages<string>;
