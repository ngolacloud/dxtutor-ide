/* Textos das worktrees e das reservas de ficheiros do Co-Dev (Multi Co-Dev, fase 3 — texto novo, sem par
   no motor de tradução): en + ptAO. O caso de uso recebe-os pela porta `copy`; a composição injecta o
   `translator`. */
import type { Messages } from "../../../app/i18n";
import { fixedCopy } from "../../../app/i18n-copy";

export const CODEV_WORKTREE_MESSAGES = {
  en: {
    wtTitle: "Give {key}'s Co-Dev its own worktree",
    wtScope: "branch {branch} · folder {path} (outside the project; the main tree does not change)",
    wtRefused: "{key} not started: its worktree was not approved.",
    wtFailed: "{key} not started: the worktree could not be created — {error}",
    wtStarted: "{key} works in its own worktree ({branch}).",
    wtOverlap: "{key} may change the same files as {others} ({files}): each works in its own worktree, and the first to write a file claims it — the other is refused that file.",
    wtLeftovers: "{n} Co-Dev worktree(s) from an earlier run: {keys} — see the Co-Devs strip.",
    wtKept: "{key}'s worktree stays: uncommitted changes ({files}). Commit them from the Co-Devs strip, or start {key} again to carry on.",
    wtRemoved: "{key}'s worktree was removed (the branch {branch} stays).",
    wtRemoveTitle: "Remove {key}'s worktree",
    wtRemoveScope: "folder {path} · the branch {branch} stays",
    wtCommitAsk: "Commit message for {key} (on {branch}, in its worktree)",
    wtCommitted: "{key}: committed {sha} on {branch} (in its worktree; nothing was merged).",
    wtNothing: "{key}'s worktree has nothing to show.",
    wtReadOnly: "{branch} · {key}'s worktree (read-only)",
    wtProposal: "proposal in {branch} · {key}'s worktree (read-only)",
    wtNoFile: "{path} could not be read from {key}'s worktree — {error}",
  },
  ptAO: {
    wtTitle: "Dar ao Co-Dev de {key} uma worktree própria",
    wtScope: "ramo {branch} · pasta {path} (fora do projecto; a árvore principal não muda)",
    wtRefused: "{key} não começou: a worktree dele não foi aprovada.",
    wtFailed: "{key} não começou: a worktree não foi criada — {error}",
    wtStarted: "{key} trabalha numa worktree própria ({branch}).",
    wtOverlap: "{key} pode mudar os mesmos ficheiros que {others} ({files}): cada um trabalha na sua worktree, e o primeiro a escrever um ficheiro reserva-o — ao outro, esse ficheiro é recusado.",
    wtLeftovers: "{n} worktree(s) do Co-Dev de uma execução anterior: {keys} — vê a faixa dos Co-Devs.",
    wtKept: "A worktree de {key} fica: alterações por commitar ({files}). Commita-as na faixa dos Co-Devs, ou começa {key} de novo para continuar.",
    wtRemoved: "A worktree de {key} saiu (o ramo {branch} fica).",
    wtRemoveTitle: "Remover a worktree de {key}",
    wtRemoveScope: "pasta {path} · o ramo {branch} fica",
    wtCommitAsk: "Mensagem do commit de {key} (em {branch}, na worktree dele)",
    wtCommitted: "{key}: commit {sha} em {branch} (na worktree dele; nada foi integrado).",
    wtNothing: "A worktree de {key} não tem nada para mostrar.",
    wtReadOnly: "{branch} · worktree de {key} (só de leitura)",
    wtProposal: "proposta em {branch} · worktree de {key} (só de leitura)",
    wtNoFile: "{path} não se leu da worktree de {key} — {error}",
  },
} satisfies Messages<string>;

export type WorktreeCopy = (key: keyof (typeof CODEV_WORKTREE_MESSAGES)["en"], params?: Record<string, string | number>) => string;

/** Sem porta (testes): o português. */
export const ptWorktreeCopy: WorktreeCopy = fixedCopy(CODEV_WORKTREE_MESSAGES.ptAO);
