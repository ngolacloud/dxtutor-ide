/* Textos da camada desktop que nasceram em português sem par no motor de tradução — com chave (ADR-0004,
   U6b): en + ptAO, os valores ptAO iguais aos textos de antes. */
import type { Messages } from "../../app/i18n";

export const DESKTOP_MESSAGES = {
  en: {
    noRuntime: "No container runtime connected. Connect the Docker or Podman socket in Infra.", noContainers: "No containers.", noImages: "No images.",
    dcUpCmd: "devcontainer up (project session)", dcNotStarted: "the dev container did not start", dcNotStartedToast: "The dev container did not start — see the terminal",
    dcRunning: "dev container {name} running on {engine} ({image}{built})", dcBuilt: ", built", dcStopFail: "Could not stop the dev container: {error}",
    notRunning: "{name} is not running",
    openFolderFirst: "open a folder first", delegationTimeout: "the delegation did not finish in time",
    delegation: "Isolated delegation: {title}", delegationRunning: "running…", cancel: "Cancel", patchReady: "✓ patch ready for review",
    discarded: "discarded — the isolated worktree did not touch your files",
    sshOk: "connection and authentication without prompts",
  },
  ptAO: {
    noRuntime: "Sem runtime de contentores ligado. Liga o socket do Docker ou do Podman em Infra.", noContainers: "Nenhum contentor.", noImages: "Nenhuma imagem.",
    dcUpCmd: "devcontainer up (sessão do projecto)", dcNotStarted: "o dev container não arrancou", dcNotStartedToast: "O dev container não arrancou — vê o terminal",
    dcRunning: "dev container {name} a correr em {engine} ({image}{built})", dcBuilt: ", construída", dcStopFail: "Não consegui parar o dev container: {error}",
    notRunning: "{name} não está a correr",
    openFolderFirst: "abre uma pasta primeiro", delegationTimeout: "a delegação não terminou a tempo",
    delegation: "Delegação isolada: {title}", delegationRunning: "a correr…", cancel: "Cancelar", patchReady: "✓ patch pronto para revisão",
    discarded: "descartado — o worktree isolado não tocou nos teus ficheiros",
    sshOk: "ligação e autenticação sem perguntas",
  },
} satisfies Messages<string>;
