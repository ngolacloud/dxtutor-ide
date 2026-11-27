/* Textos do diálogo de aprovação partilhado (app/approval.ts, r23 F1). Texto NOVO, sem par no motor de
   tradução: o i18n.catalogs.test verifica-lhe só a estrutura (ADR-0004, U6b). */
import type { Messages } from "./i18n";

export const APPROVAL_MESSAGES = {
  en: {
    lede: "This changes something outside the editor. It runs only if you approve it.",
    command: "Command",
    scope: "Where",
    reason: "Reason (goes to the audit log)",
    reasonPh: "Why this is needed now",
    reasonNeeded: "Give a reason to approve this.",
    typeToConfirm: "Type {word} to confirm",
    cancel: "Cancel",
    approve: "Approve and run",
  },
  ptAO: {
    lede: "Isto muda algo fora do editor. Só corre se o aprovares.",
    command: "Comando",
    scope: "Onde",
    reason: "Motivo (fica no registo de auditoria)",
    reasonPh: "Porque é preciso agora",
    reasonNeeded: "Dá um motivo para aprovar isto.",
    typeToConfirm: "Escreve {word} para confirmar",
    cancel: "Cancelar",
    approve: "Aprovar e correr",
  },
} satisfies Messages<string>;
export type ApprovalKey = keyof typeof APPROVAL_MESSAGES.en;
