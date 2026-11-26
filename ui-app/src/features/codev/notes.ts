/* Notas para a documentação oficial do Co-Dev. Por agora a escrita no editor (as hunks); o resto do
   Co-Dev entra aqui quando for documentado. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const CODEV_NOTES: FeatureNotes = {
  id: "codev",
  title: "Co-Dev: o assistente escreve no editor e mostra quem está a trabalhar",
  summary:
    "Quando o Co-Dev cria ou edita código, escreve-o no próprio editor: abre o ficheiro, escreve só as linhas que mudam, no sítio delas (as antigas riscadas, as novas a aparecer), e no fim aceitas ou rejeitas cada bloco com as diferenças à vista. Nada fica no ficheiro sem o teu «Aceitar».",
  code: ["ui-app/src/features/codev/domain/agent-map.ts", "ui-app/src/features/codev/application/agent-map.ts", "ui-app/src/features/codev/ui/agent-map-view.ts", "ui-app/src/features/codev/application/hunk-review.ts", "ui-app/src/features/codev/application/local-proposals.ts", "ui-app/src/features/codev/domain/proposal.ts", "crates/tutor-agent/src/hunks.rs"],
  updated: "2026-11-26",
  actions: [
    {
      title: "Rever as mudanças no editor, bloco a bloco",
      where: ["editor › barra de cada bloco (✓ Aceitar / ✗ Rejeitar / Explicar)", "chat do Co-Dev › Aceitar tudo / Rejeitar tudo"],
      what: "Cada mudança que o Co-Dev propõe aparece no ficheiro como um bloco: as linhas que saem riscadas e as que entram escritas a seguir, a um ritmo legível. Aceitas ou rejeitas cada bloco; o que aceitas fica escrito, o resto não.",
      howTo: [
        "Pede uma mudança ao Co-Dev (ou usa «Rever no editor» no painel Explain / Code review).",
        "O ficheiro abre e o Co-Dev escreve cada bloco no sítio; podes acelerar, pausar ou continuar a editar o resto do ficheiro.",
        "Em cada bloco: ✓ aceita, ✗ rejeita, «Explicar» pergunta porquê. Ctrl+Z desfaz o que aceitaste.",
      ],
      flow: [
        "O agente v2 (desktop) manda as edições já por linhas (`edit`, `edit_lines`) e o backend emite as hunks (`hunk_start`/`chunk`/`end`/`review`).",
        "Quem só tem o ficheiro inteiro — o chat ao vivo antigo em Manual/Assistido, o desktop sem ferramentas, o painel Explain / Code review — passa pelas propostas locais: o diff dá os blocos (só as linhas que mudam) e a mesma revisão de hunks mostra-os; no fim só os aceites são escritos e gravados.",
        "Uma decisão sobre um bloco cujo sítio já mudou não se aplica (fica «desactualizado»).",
      ],
      tips: ["Rejeitar um bloco não perde os outros: aceitas o que serve e pedes de novo o resto."],
      limits: ["Em modo Automático o agente v2 aplica sem esperar (e valida com os testes no fim do turno)."],
      covers: ["codev:hunk-accept", "codev:hunk-reject", "codev:local-proposal"],
    },
    {
      title: "Mapa de agentes",
      where: ["chat do Co-Dev › barra do compositor › chip «● N agentes»"],
      what: "O chip conta os agentes que estão a trabalhar agora; clicá-lo abre o mapa: a conversa num cartão à esquerda, ligada aos seus agentes à direita, cada um com o estado (verde a correr, cinzento concluído, vermelho falhou), o tempo e os tokens. Clicar num agente mostra o que lhe pediram, as ferramentas que correu, o relatório ou a última resposta, os tokens (entrada, saída, cache) e o custo quando o preço do modelo é conhecido.",
      howTo: [
        "Pede ao Co-Dev uma investigação maior; ele lança sub-agentes (só leitura) e o chip passa a «● 2 agentes».",
        "Clica no chip: o mapa abre com a sessão da conversa e os agentes dela.",
        "Clica num agente para o detalhe; «Ver no chat» volta à conversa e «Abrir o Co-Dev run» mostra o turno passo a passo.",
        "Fecha com ✕, Esc ou um clique fora do mapa.",
      ],
      flow: [
        "O agente v2 (desktop) emite o progresso de cada sub-agente no mesmo evento do turno (`codev-agent://event`, `{kind: \"subagent\", call, step}`: arranque com o papel, cada ferramenta, os tokens acumulados); o relatório chega no resultado da chamada `task`.",
        "O mapa ouve os eventos de TODAS as sessões (a conversa só segue a sua) e, ao abrir, pede as sessões abertas (`codev_agent_live`): numa sprint, cada Co-Dev de uma issue aparece como um agente, com os sub-agentes dele por baixo.",
        "Os agentes que acabaram ficam no mapa até ao turno seguinte da sessão; o tempo dos que correm anda sozinho enquanto o mapa está aberto.",
      ],
      tips: ["O custo usa a tabela de preços do Co-Dev; com um modelo fora dela o mapa mostra só os tokens."],
      limits: [
        "Só na app desktop (o agente v2): no browser o chip fica a zero e o mapa mostra só a conversa.",
        "O texto que um sub-agente vai escrevendo não aparece em tempo real: só as ferramentas, os tokens e, no fim, o relatório.",
      ],
      covers: ["codev:agmap-open", "codev:agmap-pick", "codev:agmap-close", "codev:agmap-chat", "codev:agmap-run"],
    },
  ],
};
