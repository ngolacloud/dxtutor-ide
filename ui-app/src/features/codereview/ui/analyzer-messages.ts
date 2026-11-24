/* Textos dos analisadores do projecto (Code review, ADR-0006 R2e2) que nasceram sem par no motor de tradução —
   com chave (ADR-0004, U6b): en + ptAO. Os valores ptAO são os textos de antes. */
import type { Messages } from "../../../app/i18n";

export const ANALYZER_MESSAGES = {
  en: {
    running: "Running the installed analyzers on the file saved on disk…",
    noneApplies: "No analyzer applies to this file.",
    noFindings: "No findings from the analyzers.",
  },
  ptAO: {
    running: "A correr os analisadores instalados sobre o ficheiro gravado no disco…",
    noneApplies: "Nenhum analisador se aplica a este ficheiro.",
    noFindings: "Nenhum achado dos analisadores.",
  },
} satisfies Messages<string>;
