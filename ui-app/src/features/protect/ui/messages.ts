/* Textos da protecção de dados (r23 F4a). Texto NOVO, sem par no motor de tradução (ADR-0004, U6b):
   o i18n.catalogs.test verifica-lhe só a estrutura. */
import type { Messages } from "../../../app/i18n";

export const PROTECT_MESSAGES = {
  en: {
    blockedTitle: "The secret scan found {n} problem(s) in this commit",
    blockedScope: "{tool} rules · {root}",
    refused: "Commit blocked by the secret scan: {list}. Remove the secret (an environment variable or the vault) and commit again.",
    redactedTitle: "Secrets removed before any request to a model: {n} so far",
    redacted: "{n} redacted",
    stateFile: "{file} is a state file: it holds the infrastructure's secrets, so it is not opened in the editor. Read the state in Ops › State (addresses and ids only).",
    hookNoFolder: "Open a folder that is a git repository to install the pre-commit hook.",
    hookTitle: "Install the pre-commit hook: commits made in a terminal go through the secret scan too",
    hookAlready: "The pre-commit hook is already installed: {path}",
    hookForeign: "{path} already has a pre-commit hook that is not dxtutor's; it is kept. Add `dxt secret-scan --staged` to it by hand.",
    hookInstalled: "Pre-commit hook installed: {path}. It needs dxt on the PATH (cargo install --path crates/tutor-cli); without it, commits are blocked and say why.",
    hookFailed: "The pre-commit hook was not installed: {error}",
    hookDeclined: "The pre-commit hook was not installed.",
  },
  ptAO: {
    blockedTitle: "O secret scan encontrou {n} problema(s) neste commit",
    blockedScope: "regras {tool} · {root}",
    refused: "Commit bloqueado pelo secret scan: {list}. Tira o segredo (uma variável de ambiente ou o vault) e volta a comitar.",
    redactedTitle: "Segredos tirados antes de qualquer pedido a um modelo: {n} até agora",
    redacted: "{n} redigidos",
    stateFile: "{file} é um ficheiro de estado: guarda os segredos da infraestrutura, por isso não se abre no editor. Lê o estado em Ops › Estado (só endereços e ids).",
    hookNoFolder: "Abre uma pasta que seja um repositório git para instalar o hook de pre-commit.",
    hookTitle: "Instalar o hook de pre-commit: os commits feitos num terminal também passam pelo secret scan",
    hookAlready: "O hook de pre-commit já está instalado: {path}",
    hookForeign: "{path} já tem um hook de pre-commit que não é do dxtutor; fica como está. Acrescenta-lhe `dxt secret-scan --staged` à mão.",
    hookInstalled: "Hook de pre-commit instalado: {path}. Precisa do dxt no PATH (cargo install --path crates/tutor-cli); sem ele, os commits ficam bloqueados e dizem porquê.",
    hookFailed: "O hook de pre-commit não foi instalado: {error}",
    hookDeclined: "O hook de pre-commit não foi instalado.",
  },
} satisfies Messages<string>;
export type ProtectMessageKey = keyof typeof PROTECT_MESSAGES.en;
