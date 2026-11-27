/* Textos do Project (A5) que o motor e a composição mostram — nasceram em português sem par no motor de
   tradução; com chave (ADR-0004, U6b): en + ptAO, os valores ptAO iguais aos textos de antes. O motor recebe a
   porta `copy` (a composição, `../index.ts`, injecta `translator(…)`); sem ela, `ptCopy` (o de antes). */
import type { Messages } from "../../../app/i18n";
import { fixedCopy } from "../../../app/i18n-copy";

export const PROJECT_ENGINE_MESSAGES = {
  en: {
    badResponse: "invalid response from the project store",
    overrideReason: "{error}\n\nTo carry on anyway, write the reason (it is recorded in the issue's activity):",
    notARepo: "This folder is not a git repository",
    needsAgent: "Co-Dev with an agent needs the desktop app, a folder open and a provider with an agent",
    sprintNeeds: "The sprint needs a name, a start and an end", releaseNeeds: "The release needs a version and a date",
    noScm: "Source Control is not available",
    codevsRange: "A sprint has 1 to {max} Co-Devs", planNeedsDesktop: "The parallel plan is computed by the desktop app, with a folder open",
    planBad: "invalid response from the sprint planner",
    approveNote: "Functional approval of {key}: you confirm that it does what its acceptance criteria ask (recorded with your name and the time, and audited).\n\nA note (optional): how you checked it",
    revokeReason: "Withdraw the functional approval of {key} ({by}). The reason (recorded and audited):",
    approved: "{key}: functional approval recorded",
    revoked: "{key}: functional approval withdrawn",
    checksBad: "A mandatory check needs a command: «{line}»",
    methodPreviewBad: "invalid response from the method preview",
    startWip: "In progress is at its WIP limit ({count} of {limit}): {key} cannot start there.\n\nTo start it anyway, write the reason (it is recorded in the issue's activity):",
    backlogNeedsDesktop: "The Project is created by the desktop app, with a folder open",
    backlogCreateTitle: "Create the Project from the backlog: {issues} issues, {sprints} sprints",
    backlogCreateReady: "Create the Project from the backlog and approve as Ready the issues that lack nothing else: {issues} issues, {sprints} sprints",
    backlogBad: "invalid response from the Project store",
  },
  ptAO: {
    badResponse: "resposta inválida do store do projecto",
    overrideReason: "{error}\n\nPara avançar mesmo assim, escreve o motivo (fica registado na actividade da issue):",
    notARepo: "Esta pasta não é um repositório git",
    needsAgent: "O Co-Dev com agente precisa da app desktop, de uma pasta aberta e de um provedor com agente",
    sprintNeeds: "A sprint precisa de nome, início e fim", releaseNeeds: "A release precisa de versão e data",
    noScm: "Source Control não está disponível",
    codevsRange: "Uma sprint tem de 1 a {max} Co-Devs", planNeedsDesktop: "O plano paralelo é calculado pela app desktop, com uma pasta aberta",
    planBad: "resposta inválida do planeador da sprint",
    approveNote: "Aprovação funcional de {key}: confirmas que faz o que os critérios de aceitação pedem (fica registada com o teu nome e a hora, e auditada).\n\nUma nota (opcional): como o verificaste",
    revokeReason: "Retirar a aprovação funcional de {key} ({by}). O motivo (fica registado e auditado):",
    approved: "{key}: aprovação funcional registada",
    revoked: "{key}: aprovação funcional retirada",
    checksBad: "Uma verificação obrigatória precisa de um comando: «{line}»",
    methodPreviewBad: "resposta inválida da pré-visualização do método",
    startWip: "Em curso está no limite de WIP ({count} de {limit}): {key} não pode começar lá.\n\nPara começar mesmo assim, escreve o motivo (fica registado na actividade da issue):",
    backlogNeedsDesktop: "O Project é criado pela app desktop, com uma pasta aberta",
    backlogCreateTitle: "Criar o Project a partir do backlog: {issues} issues, {sprints} sprints",
    backlogCreateReady: "Criar o Project a partir do backlog e aprovar como Ready as issues a que não falta mais nada: {issues} issues, {sprints} sprints",
    backlogBad: "resposta inválida do store do projecto",
  },
} satisfies Messages<string>;

export type ProjectEngineKey = keyof typeof PROJECT_ENGINE_MESSAGES.en;
export type ProjectCopy = (key: ProjectEngineKey, params?: Record<string, string | number>) => string;
/** Sem porta injectada: os textos de antes (português). */
export const ptCopy: ProjectCopy = fixedCopy(PROJECT_ENGINE_MESSAGES.ptAO);
