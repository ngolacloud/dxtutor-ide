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
  },
  ptAO: {
    blockedTitle: "O secret scan encontrou {n} problema(s) neste commit",
    blockedScope: "regras {tool} · {root}",
    refused: "Commit bloqueado pelo secret scan: {list}. Tira o segredo (uma variável de ambiente ou o vault) e volta a comitar.",
    redactedTitle: "Segredos tirados antes de qualquer pedido a um modelo: {n} até agora",
    redacted: "{n} redigidos",
  },
} satisfies Messages<string>;
export type ProtectMessageKey = keyof typeof PROTECT_MESSAGES.en;
