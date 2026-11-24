/* Textos que nasceram em português sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO,
   os valores ptAO iguais aos textos de antes. */
import type { Messages } from "../app/i18n";

export const ACCOUNT_DESKTOP_MESSAGES = {
  en: { noSession: "No local session: the account (user, machine and git identity) only exists in the desktop app." },
  ptAO: { noSession: "Sem sessão local: a conta (utilizador, máquina e identidade git) só existe na app desktop." },
} satisfies Messages<string>;
