/* Notas para a documentação oficial da feature Testing. Por agora o separador «Tests» do painel (a
   corrida ao vivo); o pane «Testing» entra aqui quando for documentado. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const TESTING_NOTES: FeatureNotes = {
  id: "testing",
  title: "Testes",
  summary:
    "Os testes do projecto correm à vista, no separador «Tests» do painel inferior (ao lado do Terminal): cada teste a chegar com PASS/FAIL/SKIP, o progresso, o que está a acontecer agora, e cada falha com o sítio no código a um clique.",
  code: ["ui-app/src/features/testing/domain/live.ts", "ui-app/src/features/testing/application/live-runner.ts", "ui-app/src/features/testing/ui/live-view.ts"],
  updated: "2026-11-26",
  actions: [
    {
      title: "Separador «Tests»: a corrida ao vivo",
      where: ["painel inferior › «Tests»", "paleta: «Tests: Run All (live)»", "«Aceitar e testar» do painel Explain / Code review", "o run_tests do Co-Dev"],
      what: "Corre a suite do projecto e mostra-a a acontecer: spinner, barra de progresso, contadores ✓ ✗ ○, o tempo, a linha do que está a correr, e a lista de testes a chegar com a duração. As falhas vêm abertas, com o sítio `ficheiro:linha` e o detalhe.",
      howTo: [
        "Corre os testes pela paleta («Tests: Run All (live)») ou pelo «Aceitar e testar»; o separador abre sozinho.",
        "Vê os testes a chegar; «Falharam» filtra só as falhas e «Saída» mostra a saída da ferramenta tal e qual.",
        "Clica num teste (ou no sítio da falha) para abrir o código no editor nessa linha.",
        "«Parar» mata a corrida (os processos filhos também); «Correr de novo» repete o mesmo pedido.",
      ],
      flow: [
        "Grava o editor no disco e corre o comando de testes detectado no projecto, na pasta aberta, com a saída a chegar linha a linha (`run_shell` → `proc-line`).",
        "O go corre com `-v` e o pytest com `-v` (para dizerem cada teste); o cargo, o unittest, o vitest e o jest correm tal e qual.",
        "Cada linha alimenta `domain/live.ts`: a fase (a compilar, a correr), quantos testes há («running N tests», «collected N items», a percentagem do pytest), cada teste e o bloco de detalhe de cada falha, com o sítio lido por `domain/test-report.ts`.",
        "Quem pediu recebe o resultado no fim (passou/falhou e a saída), como com o `run_tests` do backend; o Co-Dev recebe o mesmo que antes.",
        "Abrir um teste: o sítio da falha, senão onde ele está definido (`fn`, `def`, `func`, `it(`/`test(` com o nome).",
      ],
      tips: [
        "Uma corrida de cada vez: pedir outra pára a anterior.",
        "Sem nenhum teste na lista e a vermelho, quase sempre não compilou: o primeiro erro aparece em baixo.",
      ],
      limits: [
        "Só na app desktop com uma pasta aberta.",
        "Corre no anfitrião (não dentro da sessão de contentor, como o run_tests do backend faz quando há uma).",
        "O agente v2 do Co-Dev corre os testes no backend; esses ainda não aparecem aqui ao vivo.",
      ],
      covers: ["live:open", "live:stop", "live:rerun", "live:filter", "live:log"],
    },
  ],
};
