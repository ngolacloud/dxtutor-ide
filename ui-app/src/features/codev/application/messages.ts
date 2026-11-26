/* ═══════════ Co-Dev — os textos que os casos de uso mostram ao humano ═══════════
   Nasceram em português sem par no motor de tradução (apareciam em português com a interface em inglês) —
   com chave (ADR-0004, U6b): en + ptAO, os valores ptAO iguais aos textos de antes. O motor não importa o
   `translator` (lê o window): recebe a porta `copy` e a composição (`../index.ts`) injecta `translator(…)`.
   Sem porta (fakes dos testes antigos) fica `ptCopy` — o comportamento de antes. Os textos para o MODELO
   (system prompts, descrições de ferramentas) ficam em português: a língua da resposta é a regra de
   `domain/reply-language`. */
import type { Messages } from "../../../app/i18n";
import { fixedCopy } from "../../../app/i18n-copy";

export const CODEV_ENGINE_MESSAGES = {
  en: {
    validRunning: "Validating the provisional changes ({cmds})…", validBaseline: "Measuring the baseline before the changes (tests/lint)…",
    validPassed: "Validation passed ({cmds}): the provisional changes stay.", validFailed: "Validation failed: {list}", validSkipped: "Validation did not run.",
    checkpointSaved: "Checkpoint {id} saved before the changes — /reverter to go back.",
    stopKept: "Kept — the changes of the stopped turn stay.", stopDiscarded: "Discarded — the files are back as at checkpoint {id}.",
    stopDiscardConfirm: "Discard what the stopped turn changed ({n} file(s)) and go back to checkpoint {id}? The files return to how they were before the request.", servedBy: "Answered by {model} (server fallback).",
    noText: "(no text)", cancelled: "Interrupted by you. The history is consistent: you can carry on.",
    noNativeTools: "The model {model} does not support native tools — this conversation continues in text mode (blocks).",
    noSessions: "There are no earlier conversations in this project yet.", pickSession: "Earlier conversations in this project — pick one to continue:",
    cancel: "Cancel", toolsOnly: "(tool calls only)", toolCalls: "{n} call(s): {list}",
    resumed: "Conversation resumed. Keep writing — the agent has the full history.",
    noCheckpoints: "No checkpoints in this conversation yet (they only exist in git repositories, from the first turn that changes files).",
    pickCheckpoint: "Take the files back to before which request? (the conversation stays; the agent is told)",
    commandsHeader: "**Project commands** (`.dxtutor/commands/`):",
    noCommands: "No project commands — create `.dxtutor/commands/<name>.md` (the text is the request; `$ARGUMENTS` gets the rest of the line).",
    notDefined: "not defined", trusted: "trusted ✓", toTrust: "**to be trusted**", none: "none",
    mcpLine: "**MCP servers**: {servers} — the project's (`.dxtutor/mcp.json`) {state}",
    trustHooks: "Trust the project's hooks", trustMcp: "Trust the project's MCP servers", notNow: "Not now",
    trustWarn: "Hooks and MCP servers run commands defined by the repository: only trust them if you know the project. The trust stops counting if the file changes.",
    trustedHooks: "Hooks trusted. They apply from the next message (new session).", trustedMcp: "MCP servers trusted. They apply from the next message (new session).",
    story: "Implement issue {id} from the Board: «{title}» ({kind}, {pts} points).{note}\nStart by investigating the code (find the files the issue touches; when the note names a folder that does not exist yet, the issue creates it) and propose the plan with exit_plan: each file with what changes. Once it is approved, implement it — create the files that do not exist yet — record the steps with todo_write, check with the tests and summarise what changed. Ask only when something is truly blocking.",
    storyNote: "\nIssue note: {note}", storyFix: "fix", storyFeature: "feature",
    rewindAll: "the files and the conversation", rewindFiles: "the files",
    rewindConfirm: "Take {what} back to checkpoint #{id}? What changed after that request is no longer on disk.",
    permsSaved: "Permissions saved in .dxtutor/permissions.json",
    trustHooksConfirm: "Trust the project's hooks? They run commands defined by the repository.",
    trustMcpConfirm: "Trust the project's MCP servers? They run commands defined by the repository.",
    trustedNext: "Trusted. It applies from the next conversation.",
    hunksApplied: "✓ {n} change(s) applied", hunksRejected: "✗ changes rejected", hunksPartial: "{ok} of {n} applied{stale}", hunksStale: " · {n} out of date",
    rejectedEditLog: "rejected the edit of {path}", notRun: "✗ not run", notRunNoTerminal: "not run: no terminal available",
    askExplain: "Explain this.", askFix: "Fix this.", askReview: "Review this.", askPlan: "Propose a plan for this.",
    overlapAsk: "{key} cannot start now: another Co-Dev works in this folder and both may change the same files —\n{list}\n\nTwo Co-Devs in one working tree never change the same files. Wait for {others} to close, and start {key} then?",
    overlapRefused: "{key} not started: it may change the same files as {others} ({files}).",
    overlapQueued: "{key} waits for {others}: it starts when that Co-Dev closes.",
    overlapCheckFailed: "{key} not started: the scope check failed — {error}",
    queuedStarted: "{key} started: the Co-Dev it waited for closed.",
    bgDecision: "{label} needs your decision — open it in the Co-Devs strip.",
    moreFiles: "+{n} more",
  },
  ptAO: {
    validRunning: "A validar as alterações provisórias ({cmds})…", validBaseline: "A medir a base antes das alterações (testes/lint)…",
    validPassed: "Validação passou ({cmds}): as alterações provisórias ficam.", validFailed: "Validação falhou: {list}", validSkipped: "Validação não correu.",
    checkpointSaved: "Checkpoint {id} guardado antes das alterações — /reverter para voltar atrás.",
    stopKept: "Mantido — as alterações do turno parado ficam.", stopDiscarded: "Descartado — os ficheiros voltaram ao checkpoint {id}.",
    stopDiscardConfirm: "Descartar o que o turno parado alterou ({n} ficheiro(s)) e voltar ao checkpoint {id}? Os ficheiros voltam a como estavam antes do pedido.", servedBy: "Respondido por {model} (fallback do servidor).",
    noText: "(sem texto)", cancelled: "Interrompido por ti. O histórico ficou consistente: podes continuar.",
    noNativeTools: "O modelo {model} não suporta ferramentas nativas — esta conversa segue pelo modo de texto (blocos).",
    noSessions: "Ainda não há conversas anteriores neste projecto.", pickSession: "Conversas anteriores deste projecto — escolhe uma para continuar:",
    cancel: "Cancelar", toolsOnly: "(só chamadas de ferramentas)", toolCalls: "{n} chamada(s): {list}",
    resumed: "Conversa retomada. Continua a escrever — o agente tem o histórico completo.",
    noCheckpoints: "Ainda não há checkpoints nesta conversa (só existem em repositórios git, a partir do primeiro turno que altera ficheiros).",
    pickCheckpoint: "Voltar os ficheiros para antes de qual pedido? (a conversa fica; o agente é avisado)",
    commandsHeader: "**Comandos do projecto** (`.dxtutor/commands/`):",
    noCommands: "Sem comandos do projecto — cria `.dxtutor/commands/<nome>.md` (o texto é o pedido; `$ARGUMENTS` recebe o resto da linha).",
    notDefined: "não definidos", trusted: "confiados ✓", toTrust: "**por confiar**", none: "nenhum",
    mcpLine: "**Servidores MCP**: {servers} — os do projecto (`.dxtutor/mcp.json`) {state}",
    trustHooks: "Confiar nos hooks do projecto", trustMcp: "Confiar nos servidores MCP do projecto", notNow: "Agora não",
    trustWarn: "Hooks e servidores MCP correm comandos definidos pelo repositório: confia só se conheces o projecto. A confiança deixa de valer se o ficheiro mudar.",
    trustedHooks: "Hooks confiados. Valem a partir da próxima mensagem (sessão nova).", trustedMcp: "Servidores MCP confiados. Valem a partir da próxima mensagem (sessão nova).",
    story: "Implementa a issue {id} do Board: «{title}» ({kind}, {pts} pontos).{note}\nComeça por investigar o código (encontra os ficheiros em que a issue mexe; quando a nota fala de uma pasta que ainda não existe, a issue cria-a) e propõe o plano com exit_plan: cada ficheiro com o que muda. Depois de aprovado, implementa — cria os ficheiros que ainda não existem —, regista os passos com todo_write, verifica com os testes e resume o que mudou. Só perguntes quando algo te bloquear mesmo.",
    storyNote: "\nNota da issue: {note}", storyFix: "correcção", storyFeature: "funcionalidade",
    rewindAll: "os ficheiros e a conversa", rewindFiles: "os ficheiros",
    rewindConfirm: "Voltar {what} ao checkpoint #{id}? O que mudou depois desse pedido deixa de estar no disco.",
    permsSaved: "Permissões gravadas em .dxtutor/permissions.json",
    trustHooksConfirm: "Confiar nos hooks do projecto? Correm comandos definidos pelo repositório.",
    trustMcpConfirm: "Confiar nos servidores MCP do projecto? Correm comandos definidos pelo repositório.",
    trustedNext: "Confiado. Vale a partir da próxima conversa.",
    hunksApplied: "✓ {n} alteração(ões) aplicada(s)", hunksRejected: "✗ alterações rejeitadas", hunksPartial: "{ok} de {n} aplicada(s){stale}", hunksStale: " · {n} desactualizada(s)",
    rejectedEditLog: "rejeitou a edição de {path}", notRun: "✗ não executado", notRunNoTerminal: "não executado: sem terminal disponível",
    askExplain: "Explica isto.", askFix: "Corrige isto.", askReview: "Revê isto.", askPlan: "Propõe um plano para isto.",
    overlapAsk: "{key} não pode começar agora: outro Co-Dev trabalha nesta pasta e os dois podem mudar os mesmos ficheiros —\n{list}\n\nDois Co-Devs na mesma árvore de trabalho nunca mudam os mesmos ficheiros. Esperar que {others} feche e começar {key} nessa altura?",
    overlapRefused: "{key} não começou: pode mudar os mesmos ficheiros que {others} ({files}).",
    overlapQueued: "{key} espera por {others}: começa quando esse Co-Dev fechar.",
    overlapCheckFailed: "{key} não começou: a verificação de âmbito falhou — {error}",
    queuedStarted: "{key} começou: o Co-Dev por que esperava fechou.",
    bgDecision: "{label} precisa da tua decisão — abre-o na faixa dos Co-Devs.",
    moreFiles: "+{n} mais",
  },
} satisfies Messages<string>;

export type CodevEngineKey = keyof typeof CODEV_ENGINE_MESSAGES.en;
/** A porta dos textos: a chave (e os parâmetros) → o texto na língua da interface. */
export type CodevCopy = (key: CodevEngineKey, params?: Record<string, string | number>) => string;

/** Sem porta injectada: os textos de antes (português). */
export const ptCopy: CodevCopy = fixedCopy(CODEV_ENGINE_MESSAGES.ptAO);
