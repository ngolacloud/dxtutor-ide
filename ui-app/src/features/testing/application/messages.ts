/* Os pedidos ao Co-Dev a partir dos resultados dos testes (A6) — aparecem na conversa como a mensagem do humano,
   por isso seguem a língua da interface. Nasceram em português sem par no motor de tradução; com chave
   (ADR-0004, U6b): en + ptAO, os valores ptAO iguais aos de antes. Sem a porta `copy`, `ptCopy`. */
import type { Messages } from "../../../app/i18n";
import { fixedCopy } from "../../../app/i18n-copy";

export const RUNS_MESSAGES = {
  en: {
    explainFailure: "Explain why this test fails.",
    fixFailure: "Fix the code so the test «{name}» passes (do not change the test unless it is wrong). Then run `{command}`.",
    explainFlaky: "This test passes and fails without the code changing. What is the likely cause and how can it be made deterministic?",
    how: " with {kind} (the project runs `{command}`)",
    missingTestFor: "Write the missing test for {path}{how}: cover the behaviour the current tests do not check.",
    missingTest: "Write the missing test{how}.",
  },
  ptAO: {
    explainFailure: "Explica porque é que este teste falha.",
    fixFailure: "Corrige o código para o teste «{name}» passar (não alteres o teste, a não ser que esteja errado). Depois corre `{command}`.",
    explainFlaky: "Este teste passa e falha sem o código mudar. Qual é a causa provável e como o tornar determinista?",
    how: " com {kind} (o projecto corre `{command}`)",
    missingTestFor: "Escreve o teste em falta para {path}{how}: cobre o comportamento que os testes actuais não verificam.",
    missingTest: "Escreve o teste em falta{how}.",
  },
} satisfies Messages<string>;

export type RunsKey = keyof typeof RUNS_MESSAGES.en;
export type RunsCopy = (key: RunsKey, params?: Record<string, string | number>) => string;
/** Sem porta injectada: os textos de antes (português). */
export const ptCopy: RunsCopy = fixedCopy(RUNS_MESSAGES.ptAO);
