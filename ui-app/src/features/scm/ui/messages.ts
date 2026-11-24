/* Textos do pane Source Control (ADR-0004, U6b — o piloto dos textos por chave). Os valores são os que o
   motor de tradução produzia para o texto que estava no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const SCM_MESSAGES = {
  en: {
    title: "Source Control", graph: "Commit graph", refresh: "Refresh", message: "Commit message",
    commit: "✓ Commit{staged} to {branch}", staged: "Staged", changes: "Changes", clean: "Working tree clean.",
    gitflowNext: "Gitflow — next step", branches: "Branches", commits: "Commits", openFile: "Open file",
    discard: "Discard", unstage: "Unstage", openGraph: "Open commit graph",
  },
  ptAO: {
    title: "Source Control", graph: "Grafo de commits", refresh: "Actualizar", message: "Mensagem de commit",
    commit: "✓ Commit{staged} em {branch}", staged: "Staged", changes: "Alterações", clean: "Área de trabalho limpa.",
    gitflowNext: "Gitflow — próximo passo", branches: "Ramos", commits: "Commits", openFile: "Abrir ficheiro",
    discard: "Descartar", unstage: "Retirar do stage", openGraph: "Abrir grafo de commits",
  },
} satisfies Messages<string>;
export type ScmKey = keyof typeof SCM_MESSAGES.en;
