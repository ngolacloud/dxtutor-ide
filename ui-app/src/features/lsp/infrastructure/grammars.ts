/* ═════════ feature `lsp` — adaptador: os ficheiros das gramáticas que vêm com o dxtutor ═════════
   Cada gramática é um `import()` próprio: o Vite põe-na num pedaço à parte, que só se carrega quando
   se abre o primeiro ficheiro dessa linguagem (a do Python tem 100 KB). Uma gramática nova no
   `manifest.json` precisa da sua linha aqui (o teste `lsp.fallback-grammars.test.ts` confere). */

import type { RawGrammar } from "../../ext/domain/textmate";
import type { GrammarFiles } from "../application/fallback-highlight";

const FILES: Record<string, () => Promise<unknown>> = {
  "python.tmLanguage.json": () => import("../../../../../languages/grammars/python.tmLanguage.json").then((m) => m.default),
  "dockerfile.tmLanguage.json": () => import("../../../../../languages/grammars/dockerfile.tmLanguage.json").then((m) => m.default),
};

export const bundledGrammarFiles: GrammarFiles & { files(): string[] } = {
  files: () => Object.keys(FILES),
  load: async (file) => {
    const load = FILES[file];
    return load ? ((await load()) as RawGrammar) : null;
  },
};
