/* Textos da Infra que nasceram sem par no motor de tradução — com chave (ADR-0004, U6b): en + ptAO.
   Os valores ptAO são os textos de antes. */
import type { Messages } from "../../../app/i18n";

export const INFRA_DESKTOP_MESSAGES = {
  en: {
    browserNote: "The socket and the KUBECONFIG connect the real container runtime and cluster in the desktop app; in the browser there is nothing to connect to.",
    noLogLines: "No log lines.", readingLogs: "Reading the logs…",
  },
  ptAO: {
    browserNote: "O socket e o KUBECONFIG ligam o runtime de contentores e o cluster reais na app desktop; no browser não há a que ligar.",
    noLogLines: "Sem linhas de log.", readingLogs: "A ler os logs…",
  },
} satisfies Messages<string>;
