/* Textos que o motor do git mostra — nasceram em português sem par no motor de tradução; com chave
   (ADR-0004, U6b): en + ptAO, os valores ptAO iguais aos textos de antes. O motor recebe a porta `copy`
   (a composição, `../../scm.ts`, injecta `translator(…)`); sem ela, `ptCopy` (o comportamento de antes). */
import type { Messages } from "../../../app/i18n";
import { fixedCopy } from "../../../app/i18n-copy";

export const SCM_ENGINE_MESSAGES = {
  en: {
    noRepo: "No git repository — open a folder with git in the desktop app",
    committed: "Commit {h} on {b} · {n} file(s)", branchExists: "The branch already exists: {b}",
    flowStart: "start of {b} from {from}", discarded: "Changes discarded: {name}",
  },
  ptAO: {
    noRepo: "Sem repositório git — abre uma pasta com git na app desktop",
    committed: "Commit {h} em {b} · {n} ficheiro(s)", branchExists: "O ramo já existe: {b}",
    flowStart: "início de {b} a partir de {from}", discarded: "Alterações descartadas: {name}",
  },
} satisfies Messages<string>;

export type ScmEngineKey = keyof typeof SCM_ENGINE_MESSAGES.en;
export type ScmCopy = (key: ScmEngineKey, params?: Record<string, string | number>) => string;
/** Sem porta injectada: os textos de antes (português). */
export const ptCopy: ScmCopy = fixedCopy(SCM_ENGINE_MESSAGES.ptAO);
