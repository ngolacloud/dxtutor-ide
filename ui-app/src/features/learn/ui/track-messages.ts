/* Textos NOVOS do Learning Track (sem par no motor de tradução): a secção «Frameworks & tools»
   do selector e os passos de projecto (vários ficheiros). Dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const LEARN_TRACK_MESSAGES = {
  en: {
    frameworksAndTools: "Frameworks & tools",
    frameworksHint: "A separate track from the languages. Each course installs as a plugin, like the languages.",
    officialDocs: "Official docs",
    beforeYouStart: "Before you start",
    projectFiles: "Project files",
    readOnly: "read-only",
    readOnlyTitle: "Part of the project: you can read it, not change it.",
    projectNote: "Project step: Submit sends every file you can edit, and the hidden tests run on the whole project.",
  },
  ptAO: {
    frameworksAndTools: "Frameworks e ferramentas",
    frameworksHint: "Um percurso à parte das linguagens. Cada curso instala-se como um plugin, tal como as linguagens.",
    officialDocs: "Documentação oficial",
    beforeYouStart: "Antes de começar",
    projectFiles: "Ficheiros do projecto",
    readOnly: "só de leitura",
    readOnlyTitle: "Faz parte do projecto: podes lê-lo, não mudá-lo.",
    projectNote: "Passo de projecto: «Submit» envia todos os ficheiros que podes editar, e os testes ocultos correm sobre o projecto inteiro.",
  },
} satisfies Messages<string>;
