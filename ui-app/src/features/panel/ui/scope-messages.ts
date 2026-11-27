/* Textos novos do filtro por issue no Problems (RF-A05, sessão de fecho, bloco 4) — nascem com chave
   (ADR-0004, U6b): en + ptAO, sem pares no motor de tradução. */
import type { Messages } from "../../../app/i18n";

export const PANEL_SCOPE_MESSAGES = {
  en: { pbScope: "Issue {scope}", pbScopeTitle: "Only the {n} file(s) Co-Dev changed for this issue — click to show all problems" },
  ptAO: { pbScope: "Issue {scope}", pbScopeTitle: "Só os {n} ficheiro(s) que o Co-Dev alterou para esta issue — clica para ver todos os problemas" },
} satisfies Messages<string>;
