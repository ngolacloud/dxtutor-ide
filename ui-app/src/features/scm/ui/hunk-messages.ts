/* Textos do staging por hunk no pane Source Control (r23 F3, UI-SCM-10). Texto NOVO: o i18n.catalogs.test
   verifica-lhe a estrutura. */
import type { Messages } from "../../../app/i18n";

export const HUNK_MESSAGES = {
  en: {
    hunks: "Hunks", showHunks: "Stage part of this file (hunks)", reading: "Reading the hunks…", none: "No hunks (a new or binary file is staged whole).",
    binary: "Binary file: stage it whole.", notStaged: "Not staged", inIndex: "Staged", stageHunk: "Stage this hunk", unstageHunk: "Unstage this hunk",
    lines: "+{a} −{r}", partly: "partly staged",
  },
  ptAO: {
    hunks: "Hunks", showHunks: "Fazer stage de parte deste ficheiro (hunks)", reading: "A ler os hunks…", none: "Sem hunks (um ficheiro novo ou binário entra inteiro).",
    binary: "Ficheiro binário: faz stage dele inteiro.", notStaged: "Fora do stage", inIndex: "No stage", stageHunk: "Fazer stage deste hunk", unstageHunk: "Tirar este hunk do stage",
    lines: "+{a} −{r}", partly: "parte no stage",
  },
} satisfies Messages<string>;
export type HunkKey = keyof typeof HUNK_MESSAGES.en;
