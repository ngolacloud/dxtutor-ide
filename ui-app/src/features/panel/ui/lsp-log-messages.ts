/* Textos NOVOS do painel para o registo dos servidores de linguagem (LSP P6): os eventos do ciclo de vida de cada
   servidor no canal «Language servers» do Output. Dados puros (o painel usa-os por `translator`). */
import type { Messages } from "../../../app/i18n";

export const PANEL_LSP_LOG_MESSAGES = {
  en: {
    started: "started (pid {pid})",
    stopped: "stopped: {why}",
    killed: "stopped: {why} — it did not exit in time and was killed",
    crashed: "exited unexpectedly; it starts again when a file needs it",
    crashedCode: "exited unexpectedly (code {code}); it starts again when a file needs it",
    overLimit: "{running} language servers are running (the limit is {max}); none was stopped because each has open files",
    "why.idle": "no open file for the idle time",
    "why.limit": "too many language servers were running",
    "why.user": "you stopped it",
    "why.restart": "restarting",
    "why.folder": "its folder was closed",
    "why.config": "its configuration changed",
    "why.app-exit": "dxtutor is closing",
    "why.replaced": "another start of the same server won",
    "why.failed": "it did not answer initialize",
  },
  ptAO: {
    started: "arrancou (pid {pid})",
    stopped: "parou: {why}",
    killed: "parou: {why} — não saiu a tempo e foi morto",
    crashed: "saiu sem ninguém pedir; arranca de novo quando um ficheiro precisar dele",
    crashedCode: "saiu sem ninguém pedir (código {code}); arranca de novo quando um ficheiro precisar dele",
    overLimit: "estão a correr {running} servidores de linguagem (o limite é {max}); nenhum parou porque todos têm ficheiros abertos",
    "why.idle": "nenhum ficheiro aberto durante o tempo de inactividade",
    "why.limit": "havia servidores de linguagem a mais",
    "why.user": "paraste-o",
    "why.restart": "a reiniciar",
    "why.folder": "a pasta dele fechou",
    "why.config": "a configuração dele mudou",
    "why.app-exit": "o dxtutor está a fechar",
    "why.replaced": "outro arranque do mesmo servidor ganhou",
    "why.failed": "não respondeu ao initialize",
  },
} satisfies Messages<string>;
