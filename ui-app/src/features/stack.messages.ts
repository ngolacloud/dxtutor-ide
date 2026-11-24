/* Textos de RUN (stack) (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../app/i18n";

export const STACK_MESSAGES = {
  en: {
    stop: "■ Stop",
    nothingIsRunning: "Nothing is running.",
    buildsEveryDockerfileAnd: "builds every Dockerfile and starts the stack described by",
  },
  ptAO: {
    stop: "■ Parar",
    nothingIsRunning: "Nada em execução.",
    buildsEveryDockerfileAnd: "constrói todos os Dockerfiles e arranca a stack descrita em",
  },
} satisfies Messages<string>;
