/* Textos NOVOS da feature `lsp` para o editor sem servidor de linguagem (LSP P5): a lista de palavras do
   completion, o resumo do «Format Document» sem servidor e o aviso de uma linguagem sem comentário de bloco.
   Dados puros: a aplicação recebe-os por uma porta `copy(chave)` e a UI por `translator`. */
import type { Messages } from "../../../app/i18n";

export const LSP_FALLBACK_MESSAGES = {
  en: {
    wordsNote: "Words from your open files — no suggestions from a language server",
    wordHere: "word",
    wordIn: "word · {file}",
    fmtNone: "Already formatted — without a language server only whitespace is tidied",
    fmtNoneKept: "Nothing to change without a language server: {what}",
    fmtDone: "Formatted without a language server: {what}",
    fmtTrimmedOne: "trailing spaces removed on 1 line",
    fmtTrimmed: "trailing spaces removed on {n} lines",
    fmtTabsOne: "1 line re-indented with tabs, like the rest of the file",
    fmtTabs: "{n} lines re-indented with tabs, like the rest of the file",
    fmtSpacesOne: "1 line re-indented with {size} spaces, like the rest of the file",
    fmtSpaces: "{n} lines re-indented with {size} spaces, like the rest of the file",
    fmtAdded: "final newline added",
    fmtTrimmedEnd: "blank lines at the end removed",
    fmtKeptTrailing: "trailing spaces kept on {n} lines (in Markdown they are line breaks)",
    fmtKeptIndent: "indentation kept on {n} lines ({lang}: indentation is syntax)",
    fmtPatch: "A .diff or .patch file is left as it is",
    noBlockComment: "{lang} has no block comment — Ctrl+/ comments the lines",
    plainText: "Plain text",
  },
  ptAO: {
    wordsNote: "Palavras dos ficheiros abertos — sem sugestões de um servidor de linguagem",
    wordHere: "palavra",
    wordIn: "palavra · {file}",
    fmtNone: "Já está formatado — sem servidor de linguagem só se arrumam os espaços",
    fmtNoneKept: "Nada a mudar sem servidor de linguagem: {what}",
    fmtDone: "Formatado sem servidor de linguagem: {what}",
    fmtTrimmedOne: "tirados os espaços no fim de 1 linha",
    fmtTrimmed: "tirados os espaços no fim de {n} linhas",
    fmtTabsOne: "1 linha re-indentada com tabs, como o resto do ficheiro",
    fmtTabs: "{n} linhas re-indentadas com tabs, como o resto do ficheiro",
    fmtSpacesOne: "1 linha re-indentada com {size} espaços, como o resto do ficheiro",
    fmtSpaces: "{n} linhas re-indentadas com {size} espaços, como o resto do ficheiro",
    fmtAdded: "acrescentada a quebra de linha final",
    fmtTrimmedEnd: "tiradas as linhas vazias do fim",
    fmtKeptTrailing: "ficaram os espaços no fim de {n} linhas (no Markdown são quebras de linha)",
    fmtKeptIndent: "ficou a indentação de {n} linhas ({lang}: a indentação é sintaxe)",
    fmtPatch: "Um ficheiro .diff ou .patch fica como está",
    noBlockComment: "{lang} não tem comentário de bloco — o Ctrl+/ comenta as linhas",
    plainText: "Texto simples",
  },
} satisfies Messages<string>;

export type LspFallbackKey = keyof typeof LSP_FALLBACK_MESSAGES.en;
export type FallbackCopy = (key: LspFallbackKey, params?: Record<string, string | number>) => string;
