/* Textos do «O que mudou e porquê» (changelog) que nasceram sem par no motor de tradução — com chave
   (ADR-0004, U6b): en + ptAO. Os valores ptAO são os textos de antes. */
import type { Messages } from "../app/i18n";

export const CHANGELOG_DESKTOP_MESSAGES = {
  en: {
    title: "What changed and why",
    readError: "The real timeline of the repository (git). Could not read it:",
    none: "No commits to show. Open a folder with a git repository.",
    sub: "The real timeline of this repository: each row is a commit, and the «why» is the message whoever changed it wrote — nothing is summarised or rewritten. Click to see the diff.",
  },
  ptAO: {
    title: "O que mudou e porquê",
    readError: "A linha temporal real do repositório (git). Não consegui lê-la:",
    none: "Sem commits para mostrar. Abre uma pasta com um repositório git.",
    sub: "A linha temporal real deste repositório: cada linha é um commit, e o «porquê» é a mensagem que quem mudou escreveu — nada é resumido nem reescrito. Clica para ver o diff.",
  },
} satisfies Messages<string>;
