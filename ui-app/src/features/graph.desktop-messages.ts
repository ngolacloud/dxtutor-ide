/* Textos que nasceram em português sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO,
   os valores ptAO iguais aos textos de antes. */
import type { Messages } from "../app/i18n";

export const GRAPH_DESKTOP_MESSAGES = {
  en: { noFileList: "Commit from before the prototype — no file list.", notInBranch: "The file does not exist in this branch" },
  ptAO: { noFileList: "Commit anterior ao protótipo — sem lista de ficheiros.", notInBranch: "O ficheiro não existe neste ramo" },
} satisfies Messages<string>;
