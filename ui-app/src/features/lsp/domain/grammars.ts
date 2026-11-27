/* ═════════ feature `lsp` — as gramáticas TextMate que vêm com o dxtutor (LSP P5) ═════════
   `languages/grammars/manifest.json` diz que gramáticas vêm com o dxtutor, de que linguagem do registo
   é cada uma e de onde vieram (o ficheiro EXACTO do repositório do VS Code num commit fixo, com o
   sha256). O editor usa-as quando nenhuma extensão instalada traz a gramática da linguagem; só estão
   aqui as que o tokenizador «lite» (`ext/domain/textmate.ts`) faz bem. PURO. */

import manifest from "../../../../../languages/grammars/manifest.json";

export interface BundledGrammar {
  /** o `id` da linguagem no registo (`languages/registry.json`) */
  language: string;
  scopeName: string;
  /** o ficheiro em `languages/grammars/` */
  file: string;
  /** o caminho no repositório de origem */
  path: string;
  bytes: number;
  sha256: string;
  upstream: string;
  upstreamCommit: string;
  license: string;
}

export interface GrammarManifest {
  source: { repository: string; tag: string; commit: string; license: string };
  grammars: BundledGrammar[];
}

export const GRAMMAR_MANIFEST: GrammarManifest = manifest as GrammarManifest;

/** A gramática que vem com o dxtutor para uma linguagem do registo, se há. */
export function bundledGrammarFor(languageId: string | null | undefined): BundledGrammar | null {
  return languageId ? (GRAMMAR_MANIFEST.grammars.find((g) => g.language === languageId) ?? null) : null;
}
