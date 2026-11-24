/* Textos do quadro que nasceram sem par no motor de tradução (o agente real e o backlog por pasta, ADR-0006
   R3a/R3b) — com chave (ADR-0004, U6b): en + ptAO, os valores ptAO iguais aos textos de antes. Ficam fora de
   `./messages` porque esse catálogo é de texto MIGRADO (cada entrada é um par do motor). A porta `copy` do
   motor aceita as chaves dos dois; a composição (`../../board.ts`) junta os dois tradutores. */
import type { Messages } from "../../../app/i18n";

export const BOARD_DESKTOP_MESSAGES = {
  en: {
    noTests: "{id}: no tests — open the project's folder in the desktop app (detected test command or .dxtutor/commands.json)",
    noAgent: "There is no agent available to implement the issue: it needs the desktop app, with a folder open and a provider with tools (Settings).",
    agentRefused: "The agent did not accept the request.",
    readFail: "could not read this folder's backlog: {error}", saveFail: "could not save the backlog: {error}",
  },
  ptAO: {
    noTests: "{id}: sem testes — abre a pasta do projecto na app desktop (comando de testes detectado ou .dxtutor/commands.json)",
    noAgent: "Não há um agente disponível para implementar a issue: precisa da app desktop, com uma pasta aberta e um provedor com ferramentas (Definições).",
    agentRefused: "O agente não aceitou o pedido.",
    readFail: "não consegui ler o backlog desta pasta: {error}", saveFail: "não consegui gravar o backlog: {error}",
  },
} satisfies Messages<string>;

export type BoardDesktopKey = keyof typeof BOARD_DESKTOP_MESSAGES.en;
