/* Textos da faixa «Co-Devs» (Multi Co-Dev, fase 2 — texto novo, sem par no motor de tradução): en + ptAO. */
import type { Messages } from "../../../app/i18n";

export const CODEVS_MESSAGES = {
  en: {
    title: "Co-Devs",
    stripTitle: "The Co-Dev sessions of this folder: click one to show its chat",
    chat: "Chat",
    running: "working",
    done: "idle",
    failed: "failed",
    decision: "needs your decision",
    queued: "waits for {keys}",
    queuedTitle: "Starts when that Co-Dev closes: two Co-Devs in one working tree never change the same files",
    tokens: "{n} tokens",
    close: "Close this Co-Dev (its session ends)",
    unqueue: "Stop waiting (it will not start by itself)",
  },
  ptAO: {
    title: "Co-Devs",
    stripTitle: "As sessões Co-Dev desta pasta: clica numa para ver a conversa dela",
    chat: "Conversa",
    running: "a trabalhar",
    done: "parado",
    failed: "falhou",
    decision: "precisa da tua decisão",
    queued: "espera por {keys}",
    queuedTitle: "Começa quando esse Co-Dev fechar: dois Co-Devs na mesma árvore de trabalho nunca mudam os mesmos ficheiros",
    tokens: "{n} tokens",
    close: "Fechar este Co-Dev (a sessão acaba)",
    unqueue: "Deixar de esperar (não começa sozinha)",
  },
} satisfies Messages<string>;
