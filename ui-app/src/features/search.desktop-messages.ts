/* Textos da pesquisa que nasceram sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO.
   Os valores ptAO são os textos de antes. */
import type { Messages } from "../app/i18n";

export const SEARCH_DESKTOP_MESSAGES = {
  en: {
    typeFolder: "Type to search the whole open folder.", typeOpen: "Type to search the open files.", searching: "Searching…",
    files: "files", capped: " (the first {n})", notLoadedTitle: "not loaded in the IDE",
    notLoaded: "This file is not loaded in the IDE (large, binary or past the file limit)", replaced: "{n} occurrences replaced",
  },
  ptAO: {
    typeFolder: "Escreve para procurar em toda a pasta aberta.", typeOpen: "Escreve para procurar nos ficheiros abertos.", searching: "A procurar…",
    files: "ficheiros", capped: " (os primeiros {n})", notLoadedTitle: "não carregado na IDE",
    notLoaded: "Este ficheiro não está carregado na IDE (grande, binário ou além do limite de ficheiros)", replaced: "{n} ocorrências substituídas",
  },
} satisfies Messages<string>;
