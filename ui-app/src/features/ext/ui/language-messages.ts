/* Textos NOVOS da página de uma extensão (LSP P4: as linguagens que um VSIX contribui — sem par no motor de tradução,
   por isso à parte do `messages.ts`; o teste dos catálogos verifica-lhes só a estrutura). Dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const EXT_LANGUAGE_MESSAGES = {
  en: {
    langNew: "Language {name} — new in the editor (highlighting, comments with Ctrl+/, its name in the status bar): {claims}",
    langKnown: "Language {name} — already a dxtutor language; this extension adds: {claims}",
    langServer: "Language server: {server}, from dxtutor's language registry",
    langNoServer: "No language server: dxtutor only starts a server its language registry names for this language",
    langConflict: "{claim} stays {kept}: dxtutor's language registry wins over this extension's {language}",
    langReinstall: "Installed before dxtutor read file names, patterns and first lines: reinstall it to use them",
    langFirstLine: "first line {pattern}",
    langNone: "no files of its own",
  },
  ptAO: {
    langNew: "Linguagem {name} — nova no editor (realce, comentários com Ctrl+/, o nome na barra de estado): {claims}",
    langKnown: "Linguagem {name} — já é uma linguagem do dxtutor; esta extensão acrescenta: {claims}",
    langServer: "Servidor de linguagem: {server}, do registo de linguagens do dxtutor",
    langNoServer: "Sem servidor de linguagem: o dxtutor só arranca um servidor que o registo de linguagens nomeie para esta linguagem",
    langConflict: "{claim} fica {kept}: o registo de linguagens do dxtutor ganha à linguagem {language} desta extensão",
    langReinstall: "Instalada antes de o dxtutor ler nomes de ficheiro, padrões e primeiras linhas: reinstala-a para os usar",
    langFirstLine: "primeira linha {pattern}",
    langNone: "nenhum ficheiro próprio",
  },
} satisfies Messages<string>;
