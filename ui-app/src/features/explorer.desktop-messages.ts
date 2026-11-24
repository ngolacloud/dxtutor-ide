/* Textos do Explorer que nasceram sem par no motor de tradução (saíam em português com a interface em inglês) —
   com chave (ADR-0004, U6b): en + ptAO. Os valores ptAO são os textos de antes. */
import type { Messages } from "../app/i18n";

export const EXPLORER_DESKTOP_MESSAGES = {
  en: { noFolder: "No folder open.", emptyFolder: "empty folder", readingSymbols: "Reading the symbols…" },
  ptAO: { noFolder: "Nenhuma pasta aberta.", emptyFolder: "pasta vazia", readingSymbols: "A ler os símbolos…" },
} satisfies Messages<string>;
