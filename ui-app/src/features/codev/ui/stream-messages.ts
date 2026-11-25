/* Textos novos do streaming no chat (F3.2/F3.3 dos RF restantes) — nascem com chave (ADR-0004, U6b):
   en + ptAO, sem pares no motor de tradução. O pedido `applyAsk` vai para o modelo. */
import type { Messages } from "../../../app/i18n";

export const CODEV_STREAM_MESSAGES = {
  en: {
    writing: "Writing", openAt: "Open {path} at line {line}",
    aheadOfPlan: "ahead of the plan: step {step}, before {pending}", outsidePlan: "not in the plan", planStep: "step {step} of the plan",
    outsideLines: "outside the planned lines ({planned})", blocksOutside: "{n} block(s) outside the planned lines ({planned})",
    applyCode: "Ask Co-Dev to make the change",
    applyAsk: "Make in the editor the change whose code you put in your last reply: change the files with edit_lines or edit (never paste the code in the chat).",
  },
  ptAO: {
    writing: "A escrever", openAt: "Abrir {path} na linha {line}",
    aheadOfPlan: "à frente do plano: passo {step}, antes de {pending}", outsidePlan: "fora do plano", planStep: "passo {step} do plano",
    outsideLines: "fora das linhas do plano ({planned})", blocksOutside: "{n} bloco(s) fora das linhas do plano ({planned})",
    applyCode: "Pedir ao Co-Dev para fazer a alteração",
    applyAsk: "Faz no editor a alteração cujo código puseste na tua última resposta: muda os ficheiros com edit_lines ou edit (nunca colando o código no chat).",
  },
} satisfies Messages<string>;
export type CodevStreamKey = keyof typeof CODEV_STREAM_MESSAGES.en;
