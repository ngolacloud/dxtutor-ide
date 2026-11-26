/* Textos novos da porta de integração (Multi Co-Dev, fase 2): as verificações obrigatórias nas Settings
   e a aprovação funcional no painel da issue — nascem com chave (ADR-0004, U6b): en + ptAO, sem pares
   no motor de tradução. */
import type { Messages } from "../../../app/i18n";

export const PROJECT_GATE_MESSAGES = {
  en: {
    checksLabel: "Mandatory checks (one per line: name: command)",
    checksHint: "A change is integrated only when every mandatory check passes on the current commit, the Co-Dev reviewer confirms the acceptance criteria and the responsible person records the functional approval.",
    checksDefault: "None set: the detected test command holds — {cmd}",
    checksNone: "None set and no test command was detected in this folder.",
    functional: "Functional approval",
    functionalBy: "Approved by {by} · {when}",
    functionalNone: "Not recorded yet.",
    functionalNeedsCriteria: "Needs acceptance criteria: the approval confirms them.",
    approve: "Record functional approval",
    approveTitle: "You confirm it does what its acceptance criteria ask — the issue's responsible ({who}), or a Product Owner / Tech Lead",
    nobody: "no assignee",
    revoke: "Withdraw",
    revokeTitle: "Withdraw the approval, with a reason (recorded and audited)",
  },
  ptAO: {
    checksLabel: "Verificações obrigatórias (uma por linha: nome: comando)",
    checksHint: "Uma alteração só é integrada quando todas as verificações obrigatórias passam no commit actual, o revisor Co-Dev confirma os critérios de aceitação e o responsável regista a aprovação funcional.",
    checksDefault: "Nenhuma definida: vale o comando de testes detectado — {cmd}",
    checksNone: "Nenhuma definida e nenhum comando de testes detectado nesta pasta.",
    functional: "Aprovação funcional",
    functionalBy: "Aprovada por {by} · {when}",
    functionalNone: "Ainda não registada.",
    functionalNeedsCriteria: "Precisa de critérios de aceitação: a aprovação confirma-os.",
    approve: "Registar a aprovação funcional",
    approveTitle: "Confirmas que faz o que os critérios de aceitação pedem — o responsável da issue ({who}), ou um Product Owner / Tech Lead",
    nobody: "sem responsável",
    revoke: "Retirar",
    revokeTitle: "Retirar a aprovação, com um motivo (fica registado e auditado)",
  },
} satisfies Messages<string>;
