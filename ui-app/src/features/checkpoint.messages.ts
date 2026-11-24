/* Textos de checkpoints (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const CHECKPOINT_MESSAGES = {
  en: {
    gitflowTheBranch: "Gitflow: the branch",
    staysOpenWithUncommitted: "stays open with uncommitted changes.",
    branchDeletedTheRelease: "), branch deleted. The release to",
    alwaysStaysWithYou: "always stays with you.",
  },
  ptAO: {
    gitflowTheBranch: "Gitflow: o ramo",
    staysOpenWithUncommitted: "fica aberto com alterações por commitar.",
    branchDeletedTheRelease: "), ramo apagado. A release para",
    alwaysStaysWithYou: "fica sempre contigo.",
  },
} satisfies Messages<string>;
