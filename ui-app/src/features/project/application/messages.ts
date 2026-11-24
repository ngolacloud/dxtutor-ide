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
  },
  ptAO: {
    badResponse: "resposta inválida do store do projecto",
    overrideReason: "{error}\n\nPara avançar mesmo assim, escreve o motivo (fica registado na actividade da issue):",
    notARepo: "Esta pasta não é um repositório git",
    needsAgent: "O Co-Dev com agente precisa da app desktop, de uma pasta aberta e de um provedor com agente",
    sprintNeeds: "A sprint precisa de nome, início e fim", releaseNeeds: "A release precisa de versão e data",
    noScm: "Source Control não está disponível",
  },
} satisfies Messages<string>;

export type ProjectEngineKey = keyof typeof PROJECT_ENGINE_MESSAGES.en;
export type ProjectCopy = (key: ProjectEngineKey, params?: Record<string, string | number>) => string;
/** Sem porta injectada: os textos de antes (português). */
export const ptCopy: ProjectCopy = fixedCopy(PROJECT_ENGINE_MESSAGES.ptAO);
