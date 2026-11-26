/* Notas para a documentação oficial da feature Explain · Code review · Under the hood. Dados
   puros (ver `app/notes/types.ts`); `npm run docs:notes` escreve-as em `docs/notes/NOTAS.md`.
   Ao acrescentar ou mudar uma acção desta feature, actualiza a nota aqui — o teste
   `tests/notes.docs.test.ts` falha se uma acção da tabela não estiver em nenhum `covers`. */

import type { FeatureNotes } from "../../app/notes/types";

export const CODEREVIEW_NOTES: FeatureNotes = {
  id: "codereview",
  title: "Explain · Code review · Under the hood",
  summary:
    "Ajuda a perceber e a melhorar o ficheiro aberto sem sair do editor. O Explain e o Code review respondem num **painel de documento à direita do código** (não no chat do Co-Dev): o código continua à vista, as referências de linha são clicáveis e o código sugerido vem com realce, diferenças e testes. O Under the hood mostra o que acontece ao ficheiro por baixo (compilador, plano da query, camadas da imagem).",
  code: [
    "ui-app/src/features/codereview.ts",
    "ui-app/src/features/codereview/application/doc-session.ts",
    "ui-app/src/features/codereview/domain/markdown.ts",
    "ui-app/src/features/codereview/domain/prompts.ts",
    "ui-app/src/features/codereview/ui/doc-view.ts",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Explain",
      where: ["barra do editor «Explain»", "Ctrl+K E", "paleta: «Co-Dev: Explain»"],
      what: "Explica o ficheiro aberto — ou só a selecção — num documento markdown no painel à direita: resumo, como funciona, peças principais, a que ter atenção e sugestões.",
      howTo: [
        "Abre um ficheiro. Para explicar só um excerto, selecciona-o primeiro.",
        "Carrega em «Explain» na barra por cima do código (ou Ctrl+K E).",
        "Lê o documento a chegar no painel; clica numa referência como `L12` para saltar para essa linha.",
        "Usa «Pré-visualização / Markdown», copiar, gerar de novo ou «Continuar no chat» na barra do painel.",
        "Gostaste de uma sugestão? Carrega em «Aplicar» no bloco de código dela (ver «Aplicar uma sugestão do Explain»).",
      ],
      flow: [
        "O motor (`review-engine.ts`) escolhe o ficheiro (o separador activo, senão a primeira alteração) e colhe a selecção e a linha onde começa.",
        "O caso de uso `doc-session.ts` monta o pedido (`domain/prompts.ts`): código numerado, secções fixas, citar linhas como `L12`, na língua da interface.",
        "Com um modelo ligado (desktop: qualquer provider activo; browser: o Claude ao vivo), pede o texto em streaming sem ferramentas e desenha-o a cada pedaço.",
        "Sem modelo, mostra um resumo local tirado do código: símbolos, primeiro comentário, problemas actuais e achados das regras.",
        "O markdown é analisado no domínio (`domain/markdown.ts`) e desenhado com o realce do editor (`ui/doc-view.ts`).",
      ],
      tips: [
        "Explica uma selecção pequena para respostas mais precisas: as linhas citadas são as reais do ficheiro.",
        "Um pedido novo cancela o anterior; o painel nunca mistura respostas.",
        "O painel fica aberto quando trocas de separador; arrasta a margem esquerda para o alargar.",
      ],
      limits: [
        "O Explain não muda o ficheiro.",
        "O ficheiro vai até ~24 000 caracteres no pedido; o resto é cortado.",
      ],
      covers: ["tabs:explainCmd", "cmd:Co-Dev: Explain"],
    },
    {
      title: "Code review",
      where: ["barra do editor «Code review»", "Ctrl+K R", "paleta: «Co-Dev: Code Review»"],
      what: "Abre a revisão interactiva do ficheiro no painel: pontuação, achados das regras por severidade com o excerto do código, os analisadores do projecto e a revisão com IA.",
      howTo: [
        "Com o ficheiro aberto, carrega em «Code review» (ou Ctrl+K R).",
        "Vê a pontuação e filtra por severidade (bug, risk, perf, style) nos botões por cima da lista.",
        "Em cada achado: «Ir para a linha», «Corrigir com IA» ou «Descartar».",
        "Passa para «Revisão com IA» para uma revisão sénior com o ficheiro melhorado.",
      ],
      flow: [
        "As regras locais (`domain/review.ts`) correm logo, sobre o conteúdo do editor; a pontuação é 100 menos as penalidades (`domain/scoring.ts`).",
        "No desktop com pasta, os analisadores instalados (clippy/rustc, go vet, ruff, …) correm uma vez sobre o ficheiro gravado (`review_code`) e juntam-se por baixo.",
        "Filtros e descartados guardam-se por ficheiro e valem no painel e na tab.",
      ],
      tips: [
        "Descartar não apaga nada: «Mostrar» lista os descartados e «Repor» trá-los de volta; os descartados não vão para a revisão com IA.",
        "«Verificar de novo» volta a correr os analisadores (depois de gravares mudanças).",
      ],
      limits: ["As regras apontam evidência; não provam que o código está certo — os testes provam."],
      covers: ["tabs:reviewCmd", "cmd:Co-Dev: Code Review", "cr:filter", "cr:dismiss", "cr:restore", "cr:show-dismissed", "cr:rerun", "cr:tab", "cr:goto", "open-line"],
    },
    {
      title: "Revisão com IA",
      where: ["painel Code review › separador «Revisão com IA»", "tab de Code review › «Rever com IA»"],
      what: "Uma revisão sénior do ficheiro inteiro: veredicto, achados confirmados, o ficheiro todo melhorado com as correcções aplicadas e como testar.",
      howTo: [
        "No painel de Code review abre «Revisão com IA» e carrega em «Rever com IA».",
        "Lê o veredicto e os achados; o código melhorado aparece num cartão à parte quando a resposta termina.",
      ],
      flow: [
        "O pedido leva o código numerado e os achados das regras (sem os descartados) para o modelo confirmar ou descartar.",
        "O modelo devolve o ficheiro inteiro num bloco ```<lang> improved; o painel tira-o do documento e mostra-o no cartão «Código melhorado».",
        "Se o modelo não marcar o bloco, vale o maior bloco com pelo menos metade das linhas do original.",
      ],
      tips: ["Sem modelo ligado, o separador diz como ligar um (Definições: Claude, OpenAI, Gemini ou Ollama)."],
      covers: ["cr:ai-review"],
    },
    {
      title: "Corrigir com IA (um achado)",
      where: ["cartão de um achado › «Corrigir com IA»"],
      what: "Pede ao modelo a correcção de UM achado: a causa, a correcção e o ficheiro inteiro corrigido.",
      howTo: ["Num cartão de achado, carrega em «Corrigir com IA».", "O painel passa para a «Revisão com IA» com a resposta."],
      flow: ["O pedido foca a linha e o título do achado; o resto é igual à revisão com IA (o ficheiro corrigido no bloco `improved`)."],
      covers: ["cr:fix-ai"],
    },
    {
      title: "Aplicar uma sugestão do Explain",
      where: ["documento do Explain › bloco de código › «Aplicar»"],
      what: "Integra uma sugestão do Explain no ficheiro e mostra as diferenças para aceitares ou recusares — nada muda no ficheiro sem o teu «Aceitar».",
      howTo: [
        "No documento do Explain, passa o rato por um bloco de código sugerido e carrega em «Aplicar».",
        "Lê o «O que muda» e as diferenças (+/−) no cartão «Código melhorado».",
        "«Aceitar e testar» aplica e corre os testes; «Recusar» deita a proposta fora.",
        "«← Voltar à explicação» regressa ao documento do Explain.",
      ],
      flow: [
        "O bloco (o trecho sugerido), o texto da explicação e o ficheiro numerado vão ao modelo com o pedido de integrar só aquela mudança (`applySuggestionPrompt`).",
        "O modelo devolve o ficheiro inteiro num bloco ```<lang> improved; o painel compara-o com o ficheiro actual e abre nas diferenças.",
        "A proposta guarda o documento de onde veio, para o «Voltar».",
      ],
      tips: [
        "Os blocos de comandos e de saída (bash, texto, JSON…) não têm «Aplicar»: copia-os.",
        "Se a proposta mexer em mais do que devia, recusa e gera de novo — ou pede ao Co-Dev no chat.",
      ],
      limits: ["Precisa de um modelo ligado (o Explain sem modelo é só um resumo local)."],
      covers: ["cr:apply-block", "cr:back"],
    },
    {
      title: "Código melhorado: Rever no editor, Diferenças / Código, Copiar, Aceitar, Recusar, Reverter",
      where: ["cartão «Código melhorado» no painel"],
      what: "Mostra o ficheiro proposto como diferenças (+/−) contra o actual ou com realce. «Rever no editor» escreve as mudanças no próprio ficheiro, só nas linhas que mudam, e aceitas ou rejeitas cada bloco lá; ou aceitas tudo de uma vez, ou recusas.",
      howTo: [
        "«Rever no editor» (o botão principal): o ficheiro abre, cada bloco é escrito no sítio dele com as linhas antigas riscadas, e decides cada um com ✓ / ✗ no próprio bloco; quando acabas, os testes correm no separador «Tests».",
        "O cartão abre nas «Diferenças»; «Código» mostra o ficheiro proposto inteiro.",
        "«Aceitar e testar» escreve o código no ficheiro e corre logo os testes (no browser: «Aceitar», sem testes).",
        "«Recusar» deita a proposta fora; o ficheiro não muda.",
        "Depois de aceitar, «Reverter» repõe o ficheiro como estava.",
      ],
      flow: [
        "As diferenças são linha a linha (`features/diff/domain/diff.ts`) contra o conteúdo actual do editor.",
        "«Rever no editor» entrega a proposta às propostas locais do Co-Dev (`codev/application/local-proposals.ts`): os blocos saem do diff (`codev/domain/proposal.ts`) e passam pela mesma revisão de hunks do agente v2; no fim só os aceites são escritos.",
        "Aceitar guarda primeiro o conteúdo anterior; Reverter (ou Recusar depois de aceite) escreve-o de volta.",
      ],
      tips: ["O cabeçalho do cartão fica colado ao topo enquanto percorres o código, com as acções sempre à mão."],
      limits: ["Se o ficheiro mudar entretanto, «Reverter» repõe a versão de antes de aceitar (perde as mudanças feitas depois)."],
      covers: ["cr:code-view", "cr:copy-improved", "cr:accept", "cr:deny", "cr:revert", "cr:review-editor"],
    },
    {
      title: "Aceitar e testar: onde quebrou e como corrigir",
      where: ["cartão «Código melhorado» › «Aceitar e testar»", "«Correr os testes outra vez»"],
      what: "Aplica o código proposto e corre os testes do projecto com ele. Se falharem, diz ONDE quebrou (ficheiro:linha clicável), que testes falharam, uma dica pelo tipo de falha, e deixa pedir a correcção.",
      howTo: [
        "Carrega em «Aceitar e testar».",
        "Verde: fica aplicado e marcado «✓ Feito». Vermelho: lê a dica 💡 e clica no primeiro sítio de «Onde quebrou» para ir à linha.",
        "Escolhe «✦ Corrigir os testes que falham» (o modelo propõe nova versão, que voltas a aceitar e testar), «Perguntar ao Co-Dev» (leva o ficheiro e a falha para o chat) ou «Reverter».",
      ],
      flow: [
        "Aplica, grava o editor no disco e espera pela fila de escrita.",
        "Corre a suite pelo comando detectado no projecto (`run_tests`, o mesmo que o agente usa para verificar; dentro do contentor quando há sessão).",
        "A saída é lida por `domain/test-report.ts` (cargo/rustc, tsc, vitest/jest/node, pytest/unittest, go test): testes que falharam, sítios `ficheiro:linha` e o tipo — não compila, asserção, panic/excepção ou não percebido — que escolhe a dica.",
        "«Corrigir os testes que falham» manda ao modelo a saída, os sítios e o ficheiro actual; continua a ser possível reverter até ao original.",
      ],
      tips: [
        "Verde = «✓ Feito»: a proposta fica marcada como feita, os botões de aplicar desaparecem e a sugestão de onde veio mostra «✓ Feito» — não se aplica outra vez (só «Reverter» a desfaz).",
        "O primeiro sítio da lista costuma ser a causa; os seguintes, consequências.",
        "Numa asserção, decide o que está certo — o teste ou a mudança — antes de pedir a correcção.",
      ],
      limits: [
        "Só na app desktop com uma pasta aberta; no browser o «Aceitar» aplica e diz que os testes correm na app.",
        "Sem comando de testes detectado, o erro do backend aparece no cartão (define \"test\" em .dxtutor/commands.json).",
      ],
      covers: ["cr:test", "cr:fix-tests", "cr:fix-in-chat"],
    },
    {
      title: "Barra do painel de documento",
      where: ["cabeçalho do painel"],
      what: "Controla o documento: ver formatado ou o markdown, copiar, parar, gerar de novo, continuar no chat, abrir a revisão em separador e fechar.",
      howTo: [
        "«Pré-visualização / Markdown» troca entre o documento formatado e o texto.",
        "⧉ copia o documento; «Copiar» num bloco de código copia só esse bloco (funciona também no WebKitGTK da app desktop).",
        "■ pára a resposta a chegar; ↻ volta a pedir.",
        "✦ «Continuar no chat» põe o ficheiro e o documento como contexto no compositor do Co-Dev (não envia sozinho).",
        "No Code review, «Abrir em separador» mostra a mesma revisão em ecrã inteiro; ✕ fecha o painel.",
      ],
      flow: ["Fechar o painel pára o pedido em curso; o que já foi aplicado ao ficheiro fica."],
      covers: ["cr:view", "cr:copy-doc", "cr:copy-block", "cr:stop", "cr:regenerate", "cr:to-chat", "cr:as-tab", "cr:close", "open-file"],
    },
    {
      title: "Under the hood",
      where: ["barra do editor «Under the hood»", "Ctrl+K U", "paleta: «Co-Dev: Under the Hood»"],
      what: "Abre uma tab que mostra o que acontece ao ficheiro por baixo: as fases do compilador (Rust), o plano de uma query SQL, o build e o runtime (TS/JS), as camadas de uma imagem (Dockerfile) ou a ordem de arranque (docker-compose).",
      howTo: ["Com o ficheiro aberto, carrega em «Under the hood» (ou Ctrl+K U)."],
      flow: [
        "Deriva tudo do código do workspace: o plano da query vem do WHERE e dos CREATE INDEX das migrações; as camadas, das instruções do Dockerfile.",
        "Não dá nada por verificado: para confirmar, compila ou corre `EXPLAIN QUERY PLAN` na base de dados.",
      ],
      covers: ["tabs:hoodCmd", "cmd:Co-Dev: Under the Hood"],
    },
  ],
};
