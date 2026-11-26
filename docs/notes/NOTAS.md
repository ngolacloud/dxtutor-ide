<!-- GERADO por `npm run docs:notes` a partir de `ui-app/src/features/*/notes.ts`. Não edites à mão: edita as notas da feature e regenera. -->

# dxtutor IDE — notas para a documentação oficial

Notas de trabalho, acção a acção: o que faz, como usar, o fluxo por dentro, dicas e limites. São a base da documentação oficial do dxtutor-ide e mantêm-se em dia sozinhas: cada feature descreve as suas acções em `ui-app/src/features/<feature>/notes.ts`, o teste `ui-app/tests/notes.docs.test.ts` falha se uma acção da interface não tiver nota ou se este ficheiro estiver desactualizado, e `npm run docs:notes` regenera-o.

## Índice

- [Co-Dev: o assistente escreve no editor e mostra quem está a trabalhar](#co-dev-o-assistente-escreve-no-editor-e-mostra-quem-esta-a-trabalhar) — 2 acções
- [Explain · Code review · Under the hood](#explain-code-review-under-the-hood) — 9 acções
- [Quadro (backlog, sprints e kanban)](#quadro-backlog-sprints-e-kanban) — 2 acções
- [Project](#project) — 2 acções
- [Testes](#testes) — 1 acção
- [Servidor de linguagem (LSP)](#servidor-de-linguagem-lsp) — 1 acção
- [Protecção de dados — nenhum segredo sai da máquina](#proteccao-de-dados-nenhum-segredo-sai-da-maquina) — 4 acções
- [Ops — infraestrutura, Kubernetes, runbooks e evidências](#ops-infraestrutura-kubernetes-runbooks-e-evidencias) — 12 acções
- [Platform — a minha fila, revisão de PR de infra e incidentes](#platform-a-minha-fila-revisao-de-pr-de-infra-e-incidentes) — 3 acções
- [Vault — segredos, sessão e credenciais dinâmicas](#vault-segredos-sessao-e-credenciais-dinamicas) — 3 acções
- [Deploy guiado — staging e produção](#deploy-guiado-staging-e-producao) — 3 acções

---

## Co-Dev: o assistente escreve no editor e mostra quem está a trabalhar

Quando o Co-Dev cria ou edita código, escreve-o no próprio editor: abre o ficheiro, escreve só as linhas que mudam, no sítio delas (as antigas riscadas, as novas a aparecer), e no fim aceitas ou rejeitas cada bloco com as diferenças à vista. Nada fica no ficheiro sem o teu «Aceitar».

<sub>Código: `ui-app/src/features/codev/domain/agent-map.ts`, `ui-app/src/features/codev/application/agent-map.ts`, `ui-app/src/features/codev/ui/agent-map-view.ts`, `ui-app/src/features/codev/application/hunk-review.ts`, `ui-app/src/features/codev/application/local-proposals.ts`, `ui-app/src/features/codev/domain/proposal.ts`, `crates/tutor-agent/src/hunks.rs` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Rever as mudanças no editor, bloco a bloco](#rever-as-mudancas-no-editor-bloco-a-bloco) | editor › barra de cada bloco (✓ Aceitar / ✗ Rejeitar / Explicar) · chat do Co-Dev › Aceitar tudo / Rejeitar tudo |
| [Mapa de agentes](#mapa-de-agentes) | chat do Co-Dev › barra do compositor › chip «● N agentes» |

### Rever as mudanças no editor, bloco a bloco

**Onde:** editor › barra de cada bloco (✓ Aceitar / ✗ Rejeitar / Explicar) · chat do Co-Dev › Aceitar tudo / Rejeitar tudo

Cada mudança que o Co-Dev propõe aparece no ficheiro como um bloco: as linhas que saem riscadas e as que entram escritas a seguir, a um ritmo legível. Aceitas ou rejeitas cada bloco; o que aceitas fica escrito, o resto não.

**Como usar**

1. Pede uma mudança ao Co-Dev (ou usa «Rever no editor» no painel Explain / Code review).
2. O ficheiro abre e o Co-Dev escreve cada bloco no sítio; podes acelerar, pausar ou continuar a editar o resto do ficheiro.
3. Em cada bloco: ✓ aceita, ✗ rejeita, «Explicar» pergunta porquê. Ctrl+Z desfaz o que aceitaste.

**Fluxo (por dentro)**

1. O agente v2 (desktop) manda as edições já por linhas (`edit`, `edit_lines`) e o backend emite as hunks (`hunk_start`/`chunk`/`end`/`review`).
2. Quem só tem o ficheiro inteiro — o chat ao vivo antigo em Manual/Assistido, o desktop sem ferramentas, o painel Explain / Code review — passa pelas propostas locais: o diff dá os blocos (só as linhas que mudam) e a mesma revisão de hunks mostra-os; no fim só os aceites são escritos e gravados.
3. Uma decisão sobre um bloco cujo sítio já mudou não se aplica (fica «desactualizado»).

**Dicas**

- Rejeitar um bloco não perde os outros: aceitas o que serve e pedes de novo o resto.

**Limites**

- Em modo Automático o agente v2 aplica sem esperar (e valida com os testes no fim do turno).

<sub>Cobre: `codev:hunk-accept`, `codev:hunk-reject`, `codev:local-proposal`</sub>

### Mapa de agentes

**Onde:** chat do Co-Dev › barra do compositor › chip «● N agentes»

O chip conta os agentes que estão a trabalhar agora; clicá-lo abre o mapa: a conversa num cartão à esquerda, ligada aos seus agentes à direita, cada um com o estado (verde a correr, cinzento concluído, vermelho falhou), o tempo e os tokens. Clicar num agente mostra o que lhe pediram, as ferramentas que correu, o relatório ou a última resposta, os tokens (entrada, saída, cache) e o custo quando o preço do modelo é conhecido.

**Como usar**

1. Pede ao Co-Dev uma investigação maior; ele lança sub-agentes (só leitura) e o chip passa a «● 2 agentes».
2. Clica no chip: o mapa abre com a sessão da conversa e os agentes dela.
3. Clica num agente para o detalhe; «Ver no chat» volta à conversa e «Abrir o Co-Dev run» mostra o turno passo a passo.
4. Fecha com ✕, Esc ou um clique fora do mapa.

**Fluxo (por dentro)**

1. O agente v2 (desktop) emite o progresso de cada sub-agente no mesmo evento do turno (`codev-agent://event`, `{kind: "subagent", call, step}`: arranque com o papel, cada ferramenta, os tokens acumulados); o relatório chega no resultado da chamada `task`.
2. O mapa ouve os eventos de TODAS as sessões (a conversa só segue a sua) e, ao abrir, pede as sessões abertas (`codev_agent_live`): numa sprint, cada Co-Dev de uma issue aparece como um agente, com os sub-agentes dele por baixo.
3. Os agentes que acabaram ficam no mapa até ao turno seguinte da sessão; o tempo dos que correm anda sozinho enquanto o mapa está aberto.

**Dicas**

- O custo usa a tabela de preços do Co-Dev; com um modelo fora dela o mapa mostra só os tokens.

**Limites**

- Só na app desktop (o agente v2): no browser o chip fica a zero e o mapa mostra só a conversa.
- O texto que um sub-agente vai escrevendo não aparece em tempo real: só as ferramentas, os tokens e, no fim, o relatório.

<sub>Cobre: `codev:agmap-open`, `codev:agmap-pick`, `codev:agmap-close`, `codev:agmap-chat`, `codev:agmap-run`</sub>

---

## Explain · Code review · Under the hood

Ajuda a perceber e a melhorar o ficheiro aberto sem sair do editor. O Explain e o Code review respondem num **painel de documento à direita do código** (não no chat do Co-Dev): o código continua à vista, as referências de linha são clicáveis e o código sugerido vem com realce, diferenças e testes. O Under the hood mostra o que acontece ao ficheiro por baixo (compilador, plano da query, camadas da imagem).

<sub>Código: `ui-app/src/features/codereview.ts`, `ui-app/src/features/codereview/application/doc-session.ts`, `ui-app/src/features/codereview/domain/markdown.ts`, `ui-app/src/features/codereview/domain/prompts.ts`, `ui-app/src/features/codereview/ui/doc-view.ts` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Explain](#explain) | barra do editor «Explain» · Ctrl+K E · paleta: «Co-Dev: Explain» |
| [Code review](#code-review) | barra do editor «Code review» · Ctrl+K R · paleta: «Co-Dev: Code Review» |
| [Revisão com IA](#revisao-com-ia) | painel Code review › separador «Revisão com IA» · tab de Code review › «Rever com IA» |
| [Corrigir com IA (um achado)](#corrigir-com-ia-um-achado) | cartão de um achado › «Corrigir com IA» |
| [Aplicar uma sugestão do Explain](#aplicar-uma-sugestao-do-explain) | documento do Explain › bloco de código › «Aplicar» |
| [Código melhorado: Rever no editor, Diferenças / Código, Copiar, Aceitar, Recusar, Reverter](#codigo-melhorado-rever-no-editor-diferencas-codigo-copiar-aceitar-recusar-reverter) | cartão «Código melhorado» no painel |
| [Aceitar e testar: onde quebrou e como corrigir](#aceitar-e-testar-onde-quebrou-e-como-corrigir) | cartão «Código melhorado» › «Aceitar e testar» · «Correr os testes outra vez» |
| [Barra do painel de documento](#barra-do-painel-de-documento) | cabeçalho do painel |
| [Under the hood](#under-the-hood) | barra do editor «Under the hood» · Ctrl+K U · paleta: «Co-Dev: Under the Hood» |

### Explain

**Onde:** barra do editor «Explain» · Ctrl+K E · paleta: «Co-Dev: Explain»

Explica o ficheiro aberto — ou só a selecção — num documento markdown no painel à direita: resumo, como funciona, peças principais, a que ter atenção e sugestões.

**Como usar**

1. Abre um ficheiro. Para explicar só um excerto, selecciona-o primeiro.
2. Carrega em «Explain» na barra por cima do código (ou Ctrl+K E).
3. Lê o documento a chegar no painel; clica numa referência como `L12` para saltar para essa linha.
4. Usa «Pré-visualização / Markdown», copiar, gerar de novo ou «Continuar no chat» na barra do painel.
5. Gostaste de uma sugestão? Carrega em «Aplicar» no bloco de código dela (ver «Aplicar uma sugestão do Explain»).

**Fluxo (por dentro)**

1. O motor (`review-engine.ts`) escolhe o ficheiro (o separador activo, senão a primeira alteração) e colhe a selecção e a linha onde começa.
2. O caso de uso `doc-session.ts` monta o pedido (`domain/prompts.ts`): código numerado, secções fixas, citar linhas como `L12`, na língua da interface.
3. Com um modelo ligado (desktop: qualquer provider activo; browser: o Claude ao vivo), pede o texto em streaming sem ferramentas e desenha-o a cada pedaço.
4. Sem modelo, mostra um resumo local tirado do código: símbolos, primeiro comentário, problemas actuais e achados das regras.
5. O markdown é analisado no domínio (`domain/markdown.ts`) e desenhado com o realce do editor (`ui/doc-view.ts`).

**Dicas**

- Explica uma selecção pequena para respostas mais precisas: as linhas citadas são as reais do ficheiro.
- Um pedido novo cancela o anterior; o painel nunca mistura respostas.
- O painel fica aberto quando trocas de separador; arrasta a margem esquerda para o alargar.

**Limites**

- O Explain não muda o ficheiro.
- O ficheiro vai até ~24 000 caracteres no pedido; o resto é cortado.

<sub>Cobre: `tabs:explainCmd`, `cmd:Co-Dev: Explain`</sub>

### Code review

**Onde:** barra do editor «Code review» · Ctrl+K R · paleta: «Co-Dev: Code Review»

Abre a revisão interactiva do ficheiro no painel: pontuação, achados das regras por severidade com o excerto do código, os analisadores do projecto e a revisão com IA.

**Como usar**

1. Com o ficheiro aberto, carrega em «Code review» (ou Ctrl+K R).
2. Vê a pontuação e filtra por severidade (bug, risk, perf, style) nos botões por cima da lista.
3. Em cada achado: «Ir para a linha», «Corrigir com IA» ou «Descartar».
4. Passa para «Revisão com IA» para uma revisão sénior com o ficheiro melhorado.

**Fluxo (por dentro)**

1. As regras locais (`domain/review.ts`) correm logo, sobre o conteúdo do editor; a pontuação é 100 menos as penalidades (`domain/scoring.ts`).
2. No desktop com pasta, os analisadores instalados (clippy/rustc, go vet, ruff, …) correm uma vez sobre o ficheiro gravado (`review_code`) e juntam-se por baixo.
3. Filtros e descartados guardam-se por ficheiro e valem no painel e na tab.

**Dicas**

- Descartar não apaga nada: «Mostrar» lista os descartados e «Repor» trá-los de volta; os descartados não vão para a revisão com IA.
- «Verificar de novo» volta a correr os analisadores (depois de gravares mudanças).

**Limites**

- As regras apontam evidência; não provam que o código está certo — os testes provam.

<sub>Cobre: `tabs:reviewCmd`, `cmd:Co-Dev: Code Review`, `cr:filter`, `cr:dismiss`, `cr:restore`, `cr:show-dismissed`, `cr:rerun`, `cr:tab`, `cr:goto`, `open-line`</sub>

### Revisão com IA

**Onde:** painel Code review › separador «Revisão com IA» · tab de Code review › «Rever com IA»

Uma revisão sénior do ficheiro inteiro: veredicto, achados confirmados, o ficheiro todo melhorado com as correcções aplicadas e como testar.

**Como usar**

1. No painel de Code review abre «Revisão com IA» e carrega em «Rever com IA».
2. Lê o veredicto e os achados; o código melhorado aparece num cartão à parte quando a resposta termina.

**Fluxo (por dentro)**

1. O pedido leva o código numerado e os achados das regras (sem os descartados) para o modelo confirmar ou descartar.
2. O modelo devolve o ficheiro inteiro num bloco ```<lang> improved; o painel tira-o do documento e mostra-o no cartão «Código melhorado».
3. Se o modelo não marcar o bloco, vale o maior bloco com pelo menos metade das linhas do original.

**Dicas**

- Sem modelo ligado, o separador diz como ligar um (Definições: Claude, OpenAI, Gemini ou Ollama).

<sub>Cobre: `cr:ai-review`</sub>

### Corrigir com IA (um achado)

**Onde:** cartão de um achado › «Corrigir com IA»

Pede ao modelo a correcção de UM achado: a causa, a correcção e o ficheiro inteiro corrigido.

**Como usar**

1. Num cartão de achado, carrega em «Corrigir com IA».
2. O painel passa para a «Revisão com IA» com a resposta.

**Fluxo (por dentro)**

1. O pedido foca a linha e o título do achado; o resto é igual à revisão com IA (o ficheiro corrigido no bloco `improved`).

<sub>Cobre: `cr:fix-ai`</sub>

### Aplicar uma sugestão do Explain

**Onde:** documento do Explain › bloco de código › «Aplicar»

Integra uma sugestão do Explain no ficheiro e mostra as diferenças para aceitares ou recusares — nada muda no ficheiro sem o teu «Aceitar».

**Como usar**

1. No documento do Explain, passa o rato por um bloco de código sugerido e carrega em «Aplicar».
2. Lê o «O que muda» e as diferenças (+/−) no cartão «Código melhorado».
3. «Aceitar e testar» aplica e corre os testes; «Recusar» deita a proposta fora.
4. «← Voltar à explicação» regressa ao documento do Explain.

**Fluxo (por dentro)**

1. O bloco (o trecho sugerido), o texto da explicação e o ficheiro numerado vão ao modelo com o pedido de integrar só aquela mudança (`applySuggestionPrompt`).
2. O modelo devolve o ficheiro inteiro num bloco ```<lang> improved; o painel compara-o com o ficheiro actual e abre nas diferenças.
3. A proposta guarda o documento de onde veio, para o «Voltar».

**Dicas**

- Os blocos de comandos e de saída (bash, texto, JSON…) não têm «Aplicar»: copia-os.
- Se a proposta mexer em mais do que devia, recusa e gera de novo — ou pede ao Co-Dev no chat.

**Limites**

- Precisa de um modelo ligado (o Explain sem modelo é só um resumo local).

<sub>Cobre: `cr:apply-block`, `cr:back`</sub>

### Código melhorado: Rever no editor, Diferenças / Código, Copiar, Aceitar, Recusar, Reverter

**Onde:** cartão «Código melhorado» no painel

Mostra o ficheiro proposto como diferenças (+/−) contra o actual ou com realce. «Rever no editor» escreve as mudanças no próprio ficheiro, só nas linhas que mudam, e aceitas ou rejeitas cada bloco lá; ou aceitas tudo de uma vez, ou recusas.

**Como usar**

1. «Rever no editor» (o botão principal): o ficheiro abre, cada bloco é escrito no sítio dele com as linhas antigas riscadas, e decides cada um com ✓ / ✗ no próprio bloco; quando acabas, os testes correm no separador «Tests».
2. O cartão abre nas «Diferenças»; «Código» mostra o ficheiro proposto inteiro.
3. «Aceitar e testar» escreve o código no ficheiro e corre logo os testes (no browser: «Aceitar», sem testes).
4. «Recusar» deita a proposta fora; o ficheiro não muda.
5. Depois de aceitar, «Reverter» repõe o ficheiro como estava.

**Fluxo (por dentro)**

1. As diferenças são linha a linha (`features/diff/domain/diff.ts`) contra o conteúdo actual do editor.
2. «Rever no editor» entrega a proposta às propostas locais do Co-Dev (`codev/application/local-proposals.ts`): os blocos saem do diff (`codev/domain/proposal.ts`) e passam pela mesma revisão de hunks do agente v2; no fim só os aceites são escritos.
3. Aceitar guarda primeiro o conteúdo anterior; Reverter (ou Recusar depois de aceite) escreve-o de volta.

**Dicas**

- O cabeçalho do cartão fica colado ao topo enquanto percorres o código, com as acções sempre à mão.

**Limites**

- Se o ficheiro mudar entretanto, «Reverter» repõe a versão de antes de aceitar (perde as mudanças feitas depois).

<sub>Cobre: `cr:code-view`, `cr:copy-improved`, `cr:accept`, `cr:deny`, `cr:revert`, `cr:review-editor`</sub>

### Aceitar e testar: onde quebrou e como corrigir

**Onde:** cartão «Código melhorado» › «Aceitar e testar» · «Correr os testes outra vez»

Aplica o código proposto e corre os testes do projecto com ele. Se falharem, diz ONDE quebrou (ficheiro:linha clicável), que testes falharam, uma dica pelo tipo de falha, e deixa pedir a correcção.

**Como usar**

1. Carrega em «Aceitar e testar».
2. Verde: fica aplicado e marcado «✓ Feito». Vermelho: lê a dica 💡 e clica no primeiro sítio de «Onde quebrou» para ir à linha.
3. Escolhe «✦ Corrigir os testes que falham» (o modelo propõe nova versão, que voltas a aceitar e testar), «Perguntar ao Co-Dev» (leva o ficheiro e a falha para o chat) ou «Reverter».

**Fluxo (por dentro)**

1. Aplica, grava o editor no disco e espera pela fila de escrita.
2. Corre a suite pelo comando detectado no projecto (`run_tests`, o mesmo que o agente usa para verificar; dentro do contentor quando há sessão).
3. A saída é lida por `domain/test-report.ts` (cargo/rustc, tsc, vitest/jest/node, pytest/unittest, go test): testes que falharam, sítios `ficheiro:linha` e o tipo — não compila, asserção, panic/excepção ou não percebido — que escolhe a dica.
4. «Corrigir os testes que falham» manda ao modelo a saída, os sítios e o ficheiro actual; continua a ser possível reverter até ao original.

**Dicas**

- Verde = «✓ Feito»: a proposta fica marcada como feita, os botões de aplicar desaparecem e a sugestão de onde veio mostra «✓ Feito» — não se aplica outra vez (só «Reverter» a desfaz).
- O primeiro sítio da lista costuma ser a causa; os seguintes, consequências.
- Numa asserção, decide o que está certo — o teste ou a mudança — antes de pedir a correcção.

**Limites**

- Só na app desktop com uma pasta aberta; no browser o «Aceitar» aplica e diz que os testes correm na app.
- Sem comando de testes detectado, o erro do backend aparece no cartão (define "test" em .dxtutor/commands.json).

<sub>Cobre: `cr:test`, `cr:fix-tests`, `cr:fix-in-chat`</sub>

### Barra do painel de documento

**Onde:** cabeçalho do painel

Controla o documento: ver formatado ou o markdown, copiar, parar, gerar de novo, continuar no chat, abrir a revisão em separador e fechar.

**Como usar**

1. «Pré-visualização / Markdown» troca entre o documento formatado e o texto.
2. ⧉ copia o documento; «Copiar» num bloco de código copia só esse bloco (funciona também no WebKitGTK da app desktop).
3. ■ pára a resposta a chegar; ↻ volta a pedir.
4. ✦ «Continuar no chat» põe o ficheiro e o documento como contexto no compositor do Co-Dev (não envia sozinho).
5. No Code review, «Abrir em separador» mostra a mesma revisão em ecrã inteiro; ✕ fecha o painel.

**Fluxo (por dentro)**

1. Fechar o painel pára o pedido em curso; o que já foi aplicado ao ficheiro fica.

<sub>Cobre: `cr:view`, `cr:copy-doc`, `cr:copy-block`, `cr:stop`, `cr:regenerate`, `cr:to-chat`, `cr:as-tab`, `cr:close`, `open-file`</sub>

### Under the hood

**Onde:** barra do editor «Under the hood» · Ctrl+K U · paleta: «Co-Dev: Under the Hood»

Abre uma tab que mostra o que acontece ao ficheiro por baixo: as fases do compilador (Rust), o plano de uma query SQL, o build e o runtime (TS/JS), as camadas de uma imagem (Dockerfile) ou a ordem de arranque (docker-compose).

**Como usar**

1. Com o ficheiro aberto, carrega em «Under the hood» (ou Ctrl+K U).

**Fluxo (por dentro)**

1. Deriva tudo do código do workspace: o plano da query vem do WHERE e dos CREATE INDEX das migrações; as camadas, das instruções do Dockerfile.
2. Não dá nada por verificado: para confirmar, compila ou corre `EXPLAIN QUERY PLAN` na base de dados.

<sub>Cobre: `tabs:hoodCmd`, `cmd:Co-Dev: Under the Hood`</sub>

---

## Quadro (backlog, sprints e kanban)

O backlog da actividade Tasks e o quadro kanban: as issues de cada sprint, que o agente implementa quando as delegas. **Cada issue pertence a um projecto**: o quadro vive com a pasta aberta (gravado por pasta, na app desktop) e, sem pasta, não se criam issues.

<sub>Código: `ui-app/src/features/board.ts`, `ui-app/src/features/board/application/board-engine.ts`, `ui-app/src/features/board/domain/persist.ts`, `src-tauri/src/board.rs` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Nova issue](#nova-issue) | botão «+ Issue» do quadro · «+» e «New issue…» do painel Tasks · paleta: «Projecto: Nova issue…» |
| [Gerar backlog a partir do Studio](#gerar-backlog-a-partir-do-studio) | botão «Generate backlog & delegate →» do Studio · botão do quadro vazio · menu Projecto · paleta: «Projecto: Gerar backlog a partir do Studio» |

### Nova issue

**Onde:** botão «+ Issue» do quadro · «+» e «New issue…» do painel Tasks · paleta: «Projecto: Nova issue…»

Cria uma issue no backlog do projecto aberto a partir de um título (o prefixo «fix:» faz dela uma correcção).

**Como usar**

1. Abre a pasta do projecto (File → Open Folder…, na app desktop).
2. Carrega em «+ Issue» (ou usa a paleta) e escreve o título.
3. A issue entra em «A fazer» no sprint que estás a ver.

**Fluxo (por dentro)**

1. O motor (`board-engine.ts`, `newIssue`) confirma que há uma pasta de projecto aberta (porta `store.project()`).
2. Sem pasta, mostra o aviso e não cria nada — nenhuma issue fica fora de um projecto.
3. Com pasta, abre a paleta, cria a issue (`mkIssue`) e o quadro grava-se por pasta (`board_save`).

**Limites**

- No browser não há pastas: o quadro mostra-se, mas não cria issues.
- O backend recusa ler ou gravar um backlog sem pasta (já não há um backlog «default»).

<sub>Cobre: `board:new-issue`, `tasks:newIssue`, `cmd:Projecto: Nova issue…`</sub>

### Gerar backlog a partir do Studio

**Onde:** botão «Generate backlog & delegate →» do Studio · botão do quadro vazio · menu Projecto · paleta: «Projecto: Gerar backlog a partir do Studio»

Cria as issues dos componentes planeados no Studio (o ADR, um serviço, aplicação web ou esquema por componente, os artefactos de execução e o teste de fumo) e envia-as como propostas para a caixa de entrada do Project.

**Como usar**

1. Abre a pasta do projecto.
2. No Studio, acrescenta componentes planeados (contorno tracejado) e corrige os erros do desenho.
3. Carrega em «Generate backlog & delegate →».

**Fluxo (por dentro)**

1. O motor (`genBacklog`) recusa sem pasta de projecto aberta, com o aviso.
2. Recusa também um desenho com erros ou sem componentes planeados novos.
3. Cria as issues (`genBacklogIssues`), marca os componentes como em curso e manda as propostas à caixa de entrada do Project (`projectInbox.propose`).

**Dicas**

- O contexto de cada componente vai na nota da issue, que segue para o agente.

<sub>Cobre: `board:gen-backlog`, `studio:genBacklog`, `cmd:Projecto: Gerar backlog a partir do Studio`</sub>

---

## Project

O Project guarda o trabalho da pasta aberta (issues, sprints, releases, relatórios) na base SQLite da app desktop. Na vista «Planning», cada sprint diz quantos Co-Devs a trabalham ao mesmo tempo e mostra o plano paralelo: que issue cada Co-Dev faz, por que ordem, e porque é que nenhum par mexe nos mesmos ficheiros ao mesmo tempo.

<sub>Código: `crates/tutor-board/src/project/plan.rs`, `src-tauri/src/board.rs (project_sprint_plan)`, `ui-app/src/features/project/domain/plan.ts`, `ui-app/src/features/project/ui/plan-view.ts` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Co-Devs da sprint](#co-devs-da-sprint) | Project › Planning › cartão da sprint, campo «Co-Devs» |
| [Plano paralelo](#plano-paralelo) | Project › Planning › cartão da sprint, botão «Parallel plan» |

### Co-Devs da sprint

**Onde:** Project › Planning › cartão da sprint, campo «Co-Devs»

Diz quantos Co-Devs (agentes de código) trabalham a sprint ao mesmo tempo, de 1 a 8. Fica gravado na sprint, na base do Project; vazio quer dizer um.

**Como usar**

1. Abre o Project e a vista «Planning».
2. No cartão da sprint, escreve o número no campo «Co-Devs» e sai do campo.

**Fluxo (por dentro)**

1. O campo manda a operação `set_sprint_codevs` ao `project_apply`; o store recusa um número fora de 1–8 (o campo também o diz antes).
2. A coluna `sprints.codevs` nasceu na migração 14 da base do Project.
3. Se o plano paralelo dessa sprint estiver aberto, é recalculado com o número novo.

**Limites**

- Nesta fase o número só desenha o plano: nada corre em paralelo ainda.

<sub>Cobre: `pj-sprint-codevs`</sub>

### Plano paralelo

**Onde:** Project › Planning › cartão da sprint, botão «Parallel plan»

Mostra como as issues Ready da sprint se repartiriam pelos Co-Devs: uma coluna por Co-Dev com as issues por ordem, as ondas (uma issue só começa quando as das ondas anteriores acabaram), as issues que ficaram de fora com o motivo, e as sobreposições (que ficheiros e que entradas do âmbito se cruzam). Só leitura: nada corre e nada muda.

**Como usar**

1. Dá a cada issue da sprint um âmbito de ficheiros (`src/cart/**`, `Cargo.toml`) e as dependências, e aprova-a como Ready.
2. Carrega em «Parallel plan» no cartão da sprint; «Recompute» volta a calcular e o ✕ fecha.
3. Clica num cartão ou numa linha para abrir a issue.

**Fluxo (por dentro)**

1. O comando `project_sprint_plan` (só leitura) junta as issues da sprint, os ficheiros da pasta (com o `.gitignore` respeitado), os ficheiros dos change sets do Co-Dev, dos commits ligados e do ramo de cada issue, e prevê com `git merge-tree` se o ramo tem conflitos com o HEAD.
2. O planeador (`tutor_board::project::plan`) põe de fora o que não está Ready (as dependências à parte), o que já está no fluxo, o que espera por uma dependência que não está em Done nem no plano, os ciclos, e o que se sobrepõe a uma issue já no fluxo.
3. Duas issues sobrepõem-se quando um ficheiro pode ser mudado pelas duas: um ficheiro da pasta (ou conhecido) apanhado por uma entrada do âmbito de cada uma, ou conhecido de ambas. Uma entrada literal conta como ficheiro mesmo antes de existir.
4. Por ondas: em cada onda entram, por prioridade e rank, as issues com as dependências feitas que não se sobrepõem a nenhuma já escolhida; a mais pesada vai para o Co-Dev com menos pontos.
5. Qualquer mudança no Project com o plano aberto volta a calculá-lo.

**Dicas**

- Âmbitos estreitos dão mais paralelismo: `src/cart/**` e `src/pay/**` correm lado a lado, `src/**` fica sozinho.
- Uma issue «serialised after» outra pode mexer nos mesmos ficheiros: vai na onda seguinte.

**Limites**

- Dois globs que só se cruzariam em ficheiros que ainda não existem (`src/*.rs` e `src/a*`) não são detectados.
- As ondas são barreiras: uma onda começa quando a anterior acabou toda (o tempo de cada issue não entra).
- Fases seguintes: uma sessão por Co-Dev, uma worktree e ficheiros reservados por Co-Dev, o revisor que integra num worktree temporário só com os testes a passar, e a autonomia delegada com PRs.

<sub>Cobre: `pj-sprint-plan`, `pj-plan-close`</sub>

---

## Testes

Os testes do projecto correm à vista, no separador «Tests» do painel inferior (ao lado do Terminal): cada teste a chegar com PASS/FAIL/SKIP, o progresso, o que está a acontecer agora, e cada falha com o sítio no código a um clique.

<sub>Código: `ui-app/src/features/testing/domain/live.ts`, `ui-app/src/features/testing/application/live-runner.ts`, `ui-app/src/features/testing/ui/live-view.ts` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Separador «Tests»: a corrida ao vivo](#separador-tests-a-corrida-ao-vivo) | painel inferior › «Tests» · paleta: «Tests: Run All (live)» · «Aceitar e testar» do painel Explain / Code review · o run_tests do Co-Dev |

### Separador «Tests»: a corrida ao vivo

**Onde:** painel inferior › «Tests» · paleta: «Tests: Run All (live)» · «Aceitar e testar» do painel Explain / Code review · o run_tests do Co-Dev

Corre a suite do projecto e mostra-a a acontecer: spinner, barra de progresso, contadores ✓ ✗ ○, o tempo, a linha do que está a correr, e a lista de testes a chegar com a duração. As falhas vêm abertas, com o sítio `ficheiro:linha` e o detalhe.

**Como usar**

1. Corre os testes pela paleta («Tests: Run All (live)») ou pelo «Aceitar e testar»; o separador abre sozinho.
2. Vê os testes a chegar; «Falharam» filtra só as falhas e «Saída» mostra a saída da ferramenta tal e qual.
3. Clica num teste (ou no sítio da falha) para abrir o código no editor nessa linha.
4. «Parar» mata a corrida (os processos filhos também); «Correr de novo» repete o mesmo pedido.

**Fluxo (por dentro)**

1. Grava o editor no disco e corre o comando de testes detectado no projecto, na pasta aberta, com a saída a chegar linha a linha (`run_shell` → `proc-line`).
2. O go corre com `-v` e o pytest com `-v` (para dizerem cada teste); o cargo, o unittest, o vitest e o jest correm tal e qual.
3. Cada linha alimenta `domain/live.ts`: a fase (a compilar, a correr), quantos testes há («running N tests», «collected N items», a percentagem do pytest), cada teste e o bloco de detalhe de cada falha, com o sítio lido por `domain/test-report.ts`.
4. Quem pediu recebe o resultado no fim (passou/falhou e a saída), como com o `run_tests` do backend; o Co-Dev recebe o mesmo que antes.
5. Abrir um teste: o sítio da falha, senão onde ele está definido (`fn`, `def`, `func`, `it(`/`test(` com o nome).

**Dicas**

- Uma corrida de cada vez: pedir outra pára a anterior.
- Sem nenhum teste na lista e a vermelho, quase sempre não compilou: o primeiro erro aparece em baixo.

**Limites**

- Só na app desktop com uma pasta aberta.
- Corre no anfitrião (não dentro da sessão de contentor, como o run_tests do backend faz quando há uma).
- O agente v2 do Co-Dev corre os testes no backend; esses ainda não aparecem aqui ao vivo.

<sub>Cobre: `live:open`, `live:stop`, `live:rerun`, `live:filter`, `live:log`</sub>

---

## Servidor de linguagem (LSP)

Na app desktop, o editor fala com o servidor de linguagem de cada ficheiro (rust-analyzer, typescript-language-server, pyright, gopls, jdtls…) para os diagnósticos ao vivo, o hover, o «ir para a definição», o rename e o completion. Quando o servidor não está instalado, o editor diz qual falta e ajuda a instalá-lo.

<sub>Código: `ui-app/src/features/lsp/application/lsp-client.ts`, `ui-app/src/features/lsp/domain/server-status.ts`, `src-tauri/src/lsp.rs` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Servidor de linguagem em falta: Copiar e Instalar](#servidor-de-linguagem-em-falta-copiar-e-instalar) | faixa amarela no topo do ficheiro «No … language server» |

### Servidor de linguagem em falta: Copiar e Instalar

**Onde:** faixa amarela no topo do ficheiro «No … language server»

Mostra o servidor que falta e o comando para o instalar. «Copy» copia o comando; «Install» corre-o num terminal com a tua shell de login (o node do nvm, o go, o dotnet, o rustup), depois de aprovares, e liga o servidor quando acaba.

**Como usar**

1. Abre um ficheiro da linguagem; se faltar o servidor, aparece a faixa com o comando.
2. «Install»: confirma o comando exacto no diálogo de aprovação; a instalação corre no painel Terminal.
3. Quando termina bem, a faixa sai e o editor passa a ter diagnósticos, hover e definição.
4. Prefere instalar à mão? «Copy» e cola no teu terminal. «Dismiss» esconde a faixa nesta sessão.

**Fluxo (por dentro)**

1. O backend diz se o servidor existe (`lsp_server_status`); a regra do aviso e o comando estão em `domain/server-status.ts`.
2. «Install» só existe quando a instalação é um comando (npm, go install, dotnet tool, rustup); para jdtls, clangd, sourcekit-lsp e kotlin-language-server é uma instrução para seguir.
3. Aprovação partilhada (`app/approval.ts`) com o comando e onde corre → registo de auditoria (`audit_record`, acção `lsp.install`) → terminal de tarefa (PTY com a shell de login, na pasta aberta) → código de saída.
4. Saída 0: esquece o estado em cache, volta a perguntar ao backend e arranca o servidor no ficheiro aberto.

**Dicas**

- Um erro de permissões no `npm install -g` costuma querer dizer que o node não é o do nvm: `nvm use --lts` (ou `npm config set prefix ~/.npm-global`) e volta a carregar em «Install».
- Se instalou mas o dxtutor não o encontra, reinicia a app para ela ler o PATH novo.

**Limites**

- Só na app desktop com uma pasta aberta. Sem auditoria possível, não instala.

<sub>Cobre: `lsp:notice-copy`, `lsp:notice-install`</sub>

---

## Protecção de dados — nenhum segredo sai da máquina

O IDE tira os segredos de qualquer pedido a um modelo, verifica cada commit que faz à procura de segredos, mascara-os no terminal e no depurador, e avisa no editor quando um `.tf` guarda um segredo no estado. As regras vivem no backend.

<sub>Código: `crates/tutor-protect/`, `crates/tutor-eval/src/iacfind.rs`, `src-tauri/src/commands/protect.rs`, `ui-app/src/features/protect/` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Redacção antes de qualquer pedido a um modelo](#redaccao-antes-de-qualquer-pedido-a-um-modelo) | barra de estado › «N redacted» |
| [Secret scan antes de cada commit](#secret-scan-antes-de-cada-commit) | Source Control › Commit · Commit Composer, lanes, quadro, Co-Dev |
| [Hook de pre-commit — o mesmo scan nos commits do terminal](#hook-de-pre-commit-o-mesmo-scan-nos-commits-do-terminal) | paleta: «Protect: Install the Pre-commit Hook…» |
| [Segredos mascarados e ficheiros de estado](#segredos-mascarados-e-ficheiros-de-estado) | terminal · depurador · editor (`.tf`, `.tfstate`) |

### Redacção antes de qualquer pedido a um modelo

**Onde:** barra de estado › «N redacted»

Antes de cada pedido ao Co-Dev, ao chat ou ao tutor, os segredos são tirados: os padrões conhecidos (URLs com credenciais, chaves de API…) e os valores dos `.env` da pasta aberta. A barra de estado conta quantos já saíram.

**Como usar**

1. Não há nada a fazer: abre a pasta e trabalha. Passa o rato sobre a contagem para ver o total.

**Fluxo (por dentro)**

1. O filtro corre no backend, no último passo antes de enviar; cada pedido que perdeu algum segredo fica no registo de auditoria.

<sub>Cobre: `protect:redact`</sub>

### Secret scan antes de cada commit

**Onde:** Source Control › Commit · Commit Composer, lanes, quadro, Co-Dev

Cada commit que a app faz é verificado: um segredo no que vai ser comitado, ou ficheiros como `.env`, `.tfstate` e chaves, bloqueiam-no. O diálogo mostra os achados mascarados.

**Como usar**

1. Tira o segredo do código (para uma variável de ambiente ou para o Vault) e comita outra vez.
2. Se for mesmo preciso, o diálogo deixa passar um commit com um motivo, que fica registado.

**Fluxo (por dentro)**

1. Usa o gitleaks se estiver instalado, senão as regras próprias; a excepção vale um commit durante 2 minutos.

**Limites**

- Um commit feito à mão no teu próprio terminal só passa por aqui com o hook de pre-commit instalado (abaixo).

<sub>Cobre: `protect:secret-scan`</sub>

### Hook de pre-commit — o mesmo scan nos commits do terminal

**Onde:** paleta: «Protect: Install the Pre-commit Hook…»

Instala no repositório aberto um hook de pre-commit que corre `dxt secret-scan --staged`: as mesmas regras da app, sobre o que o commit leva. Um commit feito num terminal com um segredo ou um `.env` fica bloqueado, com os achados mascarados.

**Como usar**

1. Instala o `dxt` uma vez, a partir do repositório do dxtutor-ide: `cargo install --path crates/tutor-cli`.
2. Abre a pasta do projecto, corre o comando na paleta e aprova: o diálogo mostra o ficheiro e o texto exactos que vão ser escritos.
3. Para o tirar, apaga o ficheiro `pre-commit` da pasta de hooks do repositório.

**Fluxo (por dentro)**

1. O backend descobre a pasta de hooks pelo git (respeita worktrees e `core.hooksPath`), regista a instalação no registo de auditoria antes de escrever o ficheiro, e a UI regista o resultado.
2. O `dxt secret-scan` usa o gitleaks se estiver instalado, senão as regras próprias, e junta os valores secretos dos `.env` do repositório. Sai com 0 (limpo), 1 (achados) ou 2 (não conseguiu correr).

**Dicas**

- `dxt secret-scan --all` verifica o que um `git commit -a` levaria; `--working`, todas as mudanças.

**Limites**

- Um hook de pre-commit que não seja do dxtutor (husky, lint-staged…) nunca é substituído: acrescenta-lhe `dxt secret-scan --staged` à mão.
- Sem o `dxt` no PATH, o hook bloqueia o commit e diz porquê.
- O git deixa saltar qualquer hook com `git commit --no-verify`; o hook não é uma barreira contra quem o quer contornar.

<sub>Cobre: `protect:hook`, `cmd:Protect: Install the Pre-commit Hook…`</sub>

### Segredos mascarados e ficheiros de estado

**Onde:** terminal · depurador · editor (`.tf`, `.tfstate`)

A saída do terminal e do programa depurado mostra `••••` no lugar de um segredo conhecido. Um `.tf` com um argumento secreto vindo de uma variável ou de um literal aparece como erro no editor e no Problems. Um `.tfstate` nunca se abre no editor.

**Como usar**

1. Num `.tf`, usa argumentos write-only (`password_wo`) ou valores efémeros do Vault, e marca as variáveis secretas `sensitive = true`.

**Fluxo (por dentro)**

1. A máscara do terminal trabalha pedaço a pedaço; os achados de `.tf` vêm do scan do Problems ao gravar.

**Limites**

- Um segredo partido entre duas leituras do terminal pode passar.

<sub>Cobre: `protect:mask`, `protect:tfstate`</sub>

---

## Ops — infraestrutura, Kubernetes, runbooks e evidências

O separador Ops lê as ferramentas reais do projecto: o pipeline de infraestrutura como código (plano revisto, achados, drift, estado), o Kubernetes para onde o pane Infra aponta, as CLIs de cloud, os runbooks do repositório e as fontes de dados. É só de leitura por omissão: tudo o que muda alguma coisa é um comando mostrado por inteiro, aprovado por ti, e fica no registo de auditoria.

<sub>Código: `crates/tutor-eval/src/iac.rs`, `crates/tutor-eval/src/ops.rs`, `crates/tutor-platform/src/runbook.rs`, `crates/tutor-platform/src/policy.rs`, `crates/tutor-platform/src/sources.rs`, `crates/tutor-board/src/project/evidence.rs`, `ui-app/src/features/ops/` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Abrir o Ops](#abrir-o-ops) | paleta: «Ops: IaC Plan, Kubernetes and Cloud» · pane Infra › «Ops — IaC · Kubernetes · Cloud» |
| [Pipeline de IaC](#pipeline-de-iac) | Ops › Infraestrutura como código › Pipeline |
| [Aplicar o plano revisto](#aplicar-o-plano-revisto) | Ops › Pipeline › «Apply in a terminal…» |
| [Plano: o que muda, o raio de impacto e o custo](#plano-o-que-muda-o-raio-de-impacto-e-o-custo) | Ops › Infraestrutura como código › Plano |
| [Segurança e política: achados e riscos aceites](#seguranca-e-politica-achados-e-riscos-aceites) | Ops › Infraestrutura como código › Segurança e política |
| [Drift](#drift) | Ops › Infraestrutura como código › Drift |
| [Estado](#estado) | Ops › Infraestrutura como código › Estado |
| [Kubernetes](#kubernetes) | Ops › Kubernetes |
| [Cloud](#cloud) | Ops › Cloud |
| [Runbooks como código](#runbooks-como-codigo) | Ops › Runbooks |
| [Fontes de dados](#fontes-de-dados) | Ops › Fontes de dados |
| [Exportar evidências (ISO 27001)](#exportar-evidencias-iso-27001) | Ops › «Export evidence (ISO 27001)» |

### Abrir o Ops

**Onde:** paleta: «Ops: IaC Plan, Kubernetes and Cloud» · pane Infra › «Ops — IaC · Kubernetes · Cloud»

Abre o separador Ops com as secções Infraestrutura como código, Kubernetes, Cloud, Runbooks e Fontes de dados.

**Como usar**

1. Abre uma pasta na app desktop.
2. Abre o Ops pela paleta ou pelo botão no topo do pane Infra.

**Fluxo (por dentro)**

1. O separador lê as pastas com `.tf`, o cluster do pane Infra, o estado das CLIs de cloud, os runbooks e as fontes, cada um pelo seu comando do backend.

**Limites**

- Só na app desktop, com uma pasta aberta: no browser não há ferramentas reais para ler.

<sub>Cobre: `ops-open`, `cmd:Ops: IaC Plan, Kubernetes and Cloud`</sub>

### Pipeline de IaC

**Onde:** Ops › Infraestrutura como código › Pipeline

Corre init, fmt, validate, as regras internas, tflint, checkov, trivy, os segredos guardados no estado, o plano, o drift, conftest e infracost sobre a pasta escolhida. Cada etapa diz ok, falhou, não instalado (com como instalar), não ligado ou saltado — uma ferramenta em falta nunca aparece a verde.

**Como usar**

1. Escolhe a pasta de IaC na lista.
2. Carrega em «Run the pipeline» e vê as etapas a chegar.
3. Clica numa etapa para ver o comando, a dica e a saída.

**Fluxo (por dentro)**

1. O backend (`iac_pipeline_run`) corre as ferramentas no ambiente da shell de login e emite `iac://stage` ao começar e acabar cada etapa.
2. O plano fica guardado na pasta de dados da app com o hash do ficheiro e da configuração (0600, apagado ao fim de um dia).
3. Uma etapa falhada bloqueia o apply — no Rust, não na interface.

**Dicas**

- Um ficheiro por formatar falha o `fmt`: corre `tofu fmt -recursive` na pasta.
- As ferramentas em falta não bloqueiam o pipeline; instala-as para teres as verificações.

**Limites**

- Terragrunt e Helm ainda não entram no pipeline.
- Cada corrida faz `init`, que pode descarregar providers.

<sub>Cobre: `ops-dir`, `ops-tab`, `ops-run`, `ops-res`</sub>

### Aplicar o plano revisto

**Onde:** Ops › Pipeline › «Apply in a terminal…»

Aplica o ficheiro do plano que leste — nunca um plano novo. O backend recusa se a corrida bloqueou, se o ficheiro não é o revisto, se os `.tf` mudaram depois ou se o plano tem mais de um dia.

**Como usar**

1. Corre o pipeline até ficar «All stages passed».
2. Carrega em «Apply in a terminal…», lê o comando e aprova (um apply que destrói pede o nome da pasta escrito).

**Fluxo (por dentro)**

1. `iac_apply_command` verifica as regras e devolve `… apply -input=false <ficheiro revisto>`.
2. A aprovação vai ao registo de auditoria, o comando corre num terminal e o código de saída também fica registado.

<sub>Cobre: `ops-apply`</sub>

### Plano: o que muda, o raio de impacto e o custo

**Onde:** Ops › Infraestrutura como código › Plano

Mostra cada recurso a criar, mudar, substituir ou destruir, com o módulo, o motivo de uma substituição, os atributos que a forçam, o que depende dele (raio de impacto), os argumentos write-only e o custo mensal (com o infracost).

**Como usar**

1. Corre o pipeline e abre o separador Plano.
2. Clica num recurso para ver os atributos antes e depois.
3. «✦ Explain this plan» pede ao Co-Dev que o explique; «✦ Propose a change» pede a alteração aos `.tf` como proposta.

**Fluxo (por dentro)**

1. O plano é lido do `show -json`; os valores sensíveis aparecem como «(sensitive)» e nunca saem do backend.
2. O raio de impacto vem das referências do `configuration`.

**Limites**

- O raio de impacto pára num módulo como um todo: não segue as variáveis lá dentro.

<sub>Cobre: `ops-ask-plan`, `ops-ask-iac`</sub>

### Segurança e política: achados e riscos aceites

**Onde:** Ops › Infraestrutura como código › Segurança e política

Lista os achados de todas as etapas (regras internas, tflint, checkov, trivy, conftest, segredos no estado). Um erro bloqueia o apply até ser corrigido ou aceite com um motivo, por 30 dias.

**Como usar**

1. Clica no sítio `ficheiro:linha` para abrir o código.
2. «Accept the risk…» pede um motivo; «Revoke» volta a bloquear.
3. «✦ Fix in the editor» pede a correcção ao Co-Dev.

**Fluxo (por dentro)**

1. Cada achado tem uma chave estável (fonte, regra, ficheiro e o texto da linha ou o recurso): mover a linha não perde a aceitação.
2. A aceitação vai primeiro ao registo de auditoria, no backend; sem auditoria não fica guardada.

**Dicas**

- Depois de aceitar ou revogar, corre o pipeline outra vez para o apply o ver.

<sub>Cobre: `ops-accept`, `ops-revoke`, `ops-fix`, `ops-open-finding`</sub>

### Drift

**Onde:** Ops › Infraestrutura como código › Drift

Mostra o que mudou fora do código (um plano só de refresh), verificado à mão e de 6 em 6 horas enquanto a pasta está aberta.

**Como usar**

1. «Check drift» verifica agora.
2. «Revert…» corre o pipeline só para esse recurso; «✦ Write into the code» pede ao Co-Dev que escreva a mudança nos `.tf`; «Ignore…» pede um motivo e dura 30 dias.

**Fluxo (por dentro)**

1. Um drift por resolver bloqueia o apply do pipeline.
2. Ignorar usa o mesmo mecanismo dos riscos aceites.

**Limites**

- Quem fez a mudança fica «não ligado»: precisa de uma fonte de auditoria da cloud (como o CloudTrail).

<sub>Cobre: `ops-drift`, `ops-drift-revert`, `ops-drift-code`, `ops-drift-ignore`</sub>

### Estado

**Onde:** Ops › Infraestrutura como código › Estado

Lista os recursos do estado (endereços e ids, nunca valores), o backend, o serial, o bloqueio e a cópia anterior (backend local).

**Como usar**

1. «Force unlock…» liberta um bloqueio preso (pede aprovação e o nome da pasta).
2. «Move…» e «✦ Import…» pedem ao Co-Dev um bloco `moved` ou `import` nos `.tf`.

**Fluxo (por dentro)**

1. O estado lê-se por `state pull` no backend; os segredos ficam lá.
2. O editor nunca abre, lê nem grava um `.tfstate`.

<sub>Cobre: `ops-state`, `ops-unlock`, `ops-move`, `ops-import`</sub>

### Kubernetes

**Onde:** Ops › Kubernetes

O namespace para onde o pane Infra aponta: pods (com o problema de cada um), deployments com o histórico, serviços e eventos.

**Como usar**

1. Liga o cluster no pane Infra (kubeconfig, contexto, namespace).
2. «Logs» abre logo num terminal; «Shell», «Restart», «Scale…», «Port-forward…», «Roll back to this…» e «Delete» pedem aprovação com o comando exacto.
3. «✦ Why?» num pod com problemas pede ao Co-Dev a causa provável.

**Fluxo (por dentro)**

1. O estado lê-se com `kubectl … -o json` e o contexto e o namespace sempre explícitos.
2. Cada acção aprovada vai ao registo de auditoria e corre num terminal.

<sub>Cobre: `ops-kube-reload`, `ops-logs-pod`, `ops-logs-deploy`, `ops-exec`, `ops-del-pod`, `ops-restart`, `ops-history`, `ops-undo`, `ops-scale`, `ops-port`, `ops-ask-pod`</sub>

### Cloud

**Onde:** Ops › Cloud

O estado das CLIs aws, gcloud e az (instalada, versão, conta) e um inventário só de leitura pela CLI instalada.

**Como usar**

1. Carrega em «Inventory» na CLI instalada.

**Fluxo (por dentro)**

1. O inventário corre os comandos de listagem da CLI e mostra-os em «Ran: …».

<sub>Cobre: `ops-inventory`</sub>

### Runbooks como código

**Onde:** Ops › Runbooks

Corre os runbooks do repositório (`runbooks/*.md`) passo a passo. As verificações correm sem perguntar mas só se forem só de leitura; as acções pedem aprovação e recebem as credenciais do Vault só para esse passo; as decisões registam as tuas palavras. Cada passo fica guardado como evidência.

**Como usar**

1. Escreve o runbook: passos `## 1. título [check|action|decision]`, um bloco de comando e `expect:` (entre crases ou `/regex/` verifica-se sozinho).
2. Escolhe o runbook e carrega «Run» em cada passo; «New run» começa outra execução.
3. Numa expectativa em prosa, diz se o resultado foi o esperado («As expected…»).
4. «✦ Ask Co-Dev» comenta a saída e sugere o passo seguinte, sem correr nada.

**Fluxo (por dentro)**

1. A regra está no Rust: cada comando de uma verificação tem de ser seguro para o classificador do agente ou um verbo de leitura de uma ferramenta de infra; escrever ficheiros (`>`) ou ler segredos é recusado com `not_read_only`.
2. Uma acção vai ao registo de auditoria antes de correr; o passo grava o comando, a saída mascarada, o código, o resultado, quem e quando.

**Dicas**

- Um runbook com `schedule: weekly` (ou daily, monthly, quarterly) entra na tua fila quando está em atraso.

<sub>Cobre: `ops-rb`, `ops-rb-run`, `ops-rb-new`, `ops-rb-edit`, `ops-rb-ok`, `ops-rb-no`, `ops-rb-ask`, `ops-rb-reload`</sub>

### Fontes de dados

**Onde:** Ops › Fontes de dados

Diz que fontes estão ligadas: o CI/CD pelo `gh` (só leitura); custo, métricas e logs e inventário da cloud aparecem «não ligada», com como ligar — nunca um número estimado.

**Como usar**

1. Para o CI/CD, instala o GitHub CLI e corre `gh auth login`.

**Fluxo (por dentro)**

1. `sources_status` vê se o `gh` tem sessão e se a origin do projecto está no GitHub.

**Limites**

- Ainda não há ligadores de custo, métricas/logs nem inventário.

<sub>Cobre: `sources_status`</sub>

### Exportar evidências (ISO 27001)

**Onde:** Ops › «Export evidence (ISO 27001)»

Escreve `docs/audit/evidence-AAAA-MM.md` dentro do projecto, a partir das linhas reais do registo de auditoria, dos deploys e das execuções de runbooks, arrumadas por controlo ISO/IEC 27001:2022, e abre-o para revisão.

**Como usar**

1. Carrega no botão; o ficheiro abre no editor.
2. Revê-o antes de o enviar ao auditor.

**Fluxo (por dentro)**

1. `audit_export_evidence` lê o mês corrente e agrupa por A.8.32, A.8.9, A.5.17/A.8.12, A.8.13, A.5.24–A.5.27, mais as operações não mapeadas; a exportação fica no registo.

**Dicas**

- O mapeamento é um ponto de partida: quem decide o que conta como evidência é o dono do sistema de gestão.

<sub>Cobre: `ops-evidence`</sub>

---

## Platform — a minha fila, revisão de PR de infra e incidentes

A actividade Platform mostra só o que é teu, com a acção e a prova de que funcionou: a fila calculada do estado real, a revisão de pull requests de infraestrutura com cada verificação e a sua fonte, e os incidentes locais com a cronologia e a confiança.

<sub>Código: `crates/tutor-platform/src/queue.rs`, `crates/tutor-platform/src/review.rs`, `crates/tutor-board/src/project/incidents.rs`, `ui-app/src/features/ops/application/platform-service.ts`, `ui-app/src/features/ops/ui/platform-view.ts` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [A minha fila](#a-minha-fila) | paleta: «Platform: My Queue» |
| [Revisão de PR de infra](#revisao-de-pr-de-infra) | paleta: «Platform: Review an Infrastructure PR…» · a fila › «Review the PR» |
| [Incidentes](#incidentes) | paleta: «Platform: Incidents» |

### A minha fila

**Onde:** paleta: «Platform: My Queue»

Lista o que está à tua espera, calculado do estado real: PRs que pedem a tua revisão (com a regra do CODEOWNERS), achados de IaC bloqueantes em `.tf` que mudaste, runbooks recorrentes em atraso, incidentes que comandas e o teu último deploy falhado. Cada item diz porque é teu e tem uma acção.

**Como usar**

1. Abre a fila pela paleta.
2. Usa a acção do item (rever o PR, abrir o ficheiro, correr o runbook, abrir o incidente ou o deploy).
3. Carrega «Verify»: só fica feito se o estado o provar, e a prova fica guardada.
4. «Hand over…» passa o item a outra pessoa, com um motivo; aparece na vista da equipa.

**Fluxo (por dentro)**

1. `queue_items` lê o `gh`, o `git log`, os runbooks, os incidentes e os deploys; `queue_verify` volta a verificar contra o estado e grava o feito.
2. «Medido neste workspace» são só contagens locais.

**Limites**

- O on-call e os alertas ficam «não ligados»: não há fonte de pager.
- Sem sessão no `gh`, as revisões pedidas não entram (a fila diz porquê).

<sub>Cobre: `pf:tab`, `pf:reload`, `pf:act`, `pf:verify`, `pf:handover`, `cmd:Platform: My Queue`</sub>

### Revisão de PR de infra

**Onde:** paleta: «Platform: Review an Infrastructure PR…» · a fila › «Review the PR»

Mostra o diff de um PR e «Antes do merge»: o CI, o plano, a política e o custo (o pipeline de IaC sobre a cabeça do PR), a janela de mudança, o rollback e incidentes semelhantes; capacidade, orçamento de erro e on-call aparecem «não ligados». Cada verificação diz de onde vem.

**Como usar**

1. Dá o número do PR.
2. Lê as verificações e o diff; «✦ Review with Co-Dev» pede-lhe um comentário.
3. «Approve…», «Request changes…» ou «Comment…» publicam a revisão depois de aprovares o comando `gh` exacto.

**Fluxo (por dentro)**

1. O backend busca a cabeça do PR para uma worktree temporária, corre o pipeline nas pastas de IaC que ele toca e remove-a.
2. Aprovar com uma verificação a falhar exige um motivo (no Rust), que vai para o PR; um PR que mudou depois da revisão é recusado. Fica no registo antes e com o resultado.

**Limites**

- Os comentários do Co-Dev vêm no chat, não ancorados às linhas do diff.

<sub>Cobre: `pf:ask-pr`, `pf:submit`, `pf:ask-codev-pr`, `cmd:Platform: Review an Infrastructure PR…`</sub>

### Incidentes

**Onde:** paleta: «Platform: Incidents»

Incidentes locais, abertos por uma pessoa: a cronologia (evidência, verificações feitas e não feitas, notas), o estado, a confiança e a pergunta «a causa principal estava certa?».

**Como usar**

1. «Open an incident…» pede o que está a acontecer e a gravidade (SEV-1 a SEV-4).
2. Junta evidência e verificações; uma verificação não feita pede o porquê.
3. «Mitigated…» e «Resolve…» (com o resumo do que aconteceu); depois de mitigado, responde se a causa principal estava certa.
4. «✦ Likely causes» pede ao Co-Dev as causas pela evidência; «✦ Draft the postmortem» escreve o rascunho em `docs/postmortems/INC-n.md` como proposta.

**Fluxo (por dentro)**

1. Os incidentes vivem na base do Project; abrir e mudar de estado vão ao registo de auditoria.
2. A confiança nunca passa de «baixa» sem uma fonte de métricas.

**Limites**

- Não há fonte de incidentes (PagerDuty, Opsgenie…): cada incidente é aberto à mão.

<sub>Cobre: `pf:new-incident`, `pf:reload-incidents`, `pf:incident`, `pf:add`, `pf:status`, `pf:feedback`, `pf:postmortem`, `pf:ask-cause`, `cmd:Platform: Incidents`</sub>

---

## Vault — segredos, sessão e credenciais dinâmicas

O separador Vault liga o IDE ao HashiCorp Vault sem que o token alguma vez chegue ao ecrã: a sessão vive no keychain do sistema. Mostra os metadados dos segredos de todos os ambientes, os valores só de `local`, e emite credenciais de curta duração para um terminal.

<sub>Código: `crates/tutor-platform/src/keychain.rs`, `crates/tutor-platform/src/vault.rs`, `src-tauri/src/commands/vault.rs`, `ui-app/src/features/vault/` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Ligar e entrar](#ligar-e-entrar) | paleta: «Vault: Secrets, Sign-in and Dynamic Credentials» · barra de estado › «Vault · …» |
| [Segredos (KV)](#segredos-kv) | Vault › Segredos (KV) |
| [Credenciais dinâmicas](#credenciais-dinamicas) | Vault › Credenciais dinâmicas |

### Ligar e entrar

**Onde:** paleta: «Vault: Secrets, Sign-in and Dynamic Credentials» · barra de estado › «Vault · …»

Aponta o IDE a um Vault (endereço, namespace, mount OIDC, papel) e entra pelo browser (OIDC) ou colando um token. O token vai para o keychain do sistema e nunca volta à interface.

**Como usar**

1. Escreve o endereço e, se precisares, o namespace e o papel OIDC.
2. «Sign in with the browser» abre o browser; volta sozinho quando entras.
3. Ou «Paste a token…» (um campo escondido).
4. «Renew» renova a sessão; «Sign out» revoga o token e apaga-o do keychain.

**Fluxo (por dentro)**

1. OIDC: o Rust pede o URL ao Vault, abre o browser e espera em `127.0.0.1:8250/oidc/callback` (o mesmo que o CLI do Vault usa — o papel tem de o permitir).
2. O token fica no keychain (Secret Service no Linux) na conta `vault:<endereço>#<namespace>`.
3. A barra de estado mostra quem está ligado e quanto tempo falta.

**Limites**

- No Linux precisa de um GNOME Keyring ou KWallet a correr.

<sub>Cobre: `vault:open-tab`, `vault:field`, `vault:oidc`, `vault:token`, `vault:renew`, `vault:signout`, `cmd:Vault: Secrets, Sign-in and Dynamic Credentials`</sub>

### Segredos (KV)

**Onde:** Vault › Segredos (KV)

Navega os segredos: metadados de todos os ambientes (versões, datas, metadados próprios); os nomes das chaves e os valores só de `local`. Os valores de staging e produção nunca saem do Vault.

**Como usar**

1. Escreve o caminho (ex.: `apps/shop/local/db`) e «Browse»; as pastas abrem-se com um clique.
2. Num segredo `local`, «Show…» pede um motivo e mostra o valor durante 20 segundos.
3. «Patch in a terminal…» abre um terminal com `vault kv patch … chave=-`: escreves o valor novo lá, e o IDE nunca o vê.

**Fluxo (por dentro)**

1. O ambiente lê-se do caminho (`…/local/…`, `…/staging/…`, `…/production/…`); um caminho sem ambiente é tratado como não-local. A recusa está no Rust.
2. Mostrar um valor vai primeiro ao registo de auditoria; o valor passa a ser filtrado dos pedidos aos modelos e do terminal.
3. O terminal recebe o token do backend (`VAULT_TOKEN`) e mascara-o na saída.

<sub>Cobre: `vault:path`, `vault:browse`, `vault:open`, `vault:up`, `vault:reveal`, `vault:hide`, `vault:patch`</sub>

### Credenciais dinâmicas

**Onde:** Vault › Credenciais dinâmicas

Pede a um motor de segredos (ex.: `database`) credenciais de curta duração. O ecrã só vê o lease; os valores vão para um terminal e o lease é revogado quando esse terminal acaba.

**Como usar**

1. Escreve o mount do motor e o papel e carrega «Issue credentials…» (pede um motivo).
2. «Open a terminal with them» abre uma shell com `VAULT_DYN_*`.
3. «Revoke» revoga já.

**Fluxo (por dentro)**

1. O pedido vai ao registo de auditoria antes; os valores ficam no backend até o terminal os receber.
2. Ao fechar o terminal, o backend revoga o lease e avisa.

<sub>Cobre: `vault:dynamic`, `vault:use-lease`, `vault:revoke-lease`</sub>

---

## Deploy guiado — staging e produção

Staging e produção mudam-se só pelo deploy guiado: oito passos (destino, identidade, segredos, verificações, estratégia, aprovar, rollout, registo), cada verificação com o seu estado, e o bloqueio decidido no backend. Os segredos não viajam com os manifestos: o cluster lê-os do Vault.

<sub>Código: `crates/tutor-platform/src/deploy.rs`, `src-tauri/src/commands/deploy.rs`, `crates/tutor-board/src/project/deploys.rs`, `ui-app/src/features/deploy/` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Planear um deploy](#planear-um-deploy) | paleta: «Deploy: Guided Deploy to Staging or Production» · pane Infra / Environments › «Promote…» e «Redeploy» |
| [Excepções com motivo](#excepcoes-com-motivo) | Deploy › Verificações › «Waive…» |
| [Fazer o deploy](#fazer-o-deploy) | Deploy › Aprovar › «Deploy…» |

### Planear um deploy

**Onde:** paleta: «Deploy: Guided Deploy to Staging or Production» · pane Infra / Environments › «Promote…» e «Redeploy»

Verifica tudo antes de mudar o que quer que seja: a versão (o commit em HEAD, sem alterações por commitar), SBOM, assinatura, vulnerabilidades, segredos, drift do IaC, a política de admissão do cluster, SLO, janela de mudança, migrações e, em produção, a saúde de staging e um segundo aprovador.

**Como usar**

1. Escolhe o cluster de cada ambiente em Environments.
2. Abre o deploy e escolhe Staging ou Production; «Check again» repete as verificações.
3. Clica numa verificação para ver o detalhe e como instalar o que falta.

**Fluxo (por dentro)**

1. `deploy_plan` lê os manifestos de `deploy/k8s` (os `Secret` ficam de fora: o cluster lê-os do Vault), corre cada verificação e devolve os comandos exactos.
2. O segredo vê-se só pelo nome no namespace e pelos metadados no Vault.
3. Configuração opcional em `.dxtutor/deploy.json`: manifestos, pasta de IaC e caminho do Vault de cada ambiente, política do cosign, janelas de mudança.

**Limites**

- Só rolling update; canary e blue-green ainda não.
- O `dx-secret-check` aparece «não disponível» até a imagem existir.

<sub>Cobre: `deploy:plan`, `deploy:toggle`, `cmd:Deploy: Guided Deploy to Staging or Production`</sub>

### Excepções com motivo

**Onde:** Deploy › Verificações › «Waive…»

Em produção, uma verificação «não instalada» ou «não ligada» bloqueia, a não ser que lhe dês uma excepção com motivo. Uma verificação falhada nunca tem excepção, nem o segundo aprovador ou a saúde de staging.

**Como usar**

1. Carrega «Waive…» na verificação e escreve porquê; «Undo» tira a excepção.

**Fluxo (por dentro)**

1. As excepções vão com o deploy para o registo de auditoria; o backend volta a verificá-las no rollout.

<sub>Cobre: `deploy:waive`, `deploy:unwaive`</sub>

### Fazer o deploy

**Onde:** Deploy › Aprovar › «Deploy…»

Aplica os manifestos (sem os `Secret`), anota a versão e espera pelo rollout de cada Deployment, com as linhas à vista; no fim fica o registo do deploy.

**Como usar**

1. Quando nada bloqueia, carrega «Deploy…» e aprova os comandos.
2. Em produção escreve um motivo e a palavra «production».
3. O segundo aprovador é um PR fundido com este commit, aprovado por outra pessoa no GitHub.

**Fluxo (por dentro)**

1. O backend verifica outra vez: excepções, HEAD, manifestos e um plano com menos de 30 minutos.
2. Vai ao registo de auditoria antes e com o resultado; o registo do deploy alimenta a coluna «environments» do ciclo de vida do commit e o histórico em Environments.

<sub>Cobre: `deploy:rollout`</sub>

---

## Ainda sem notas

Acções da barra do editor que ainda não têm nota (a lista só encolhe):

- `tabs:startDebug`
- `tabs:dxRun`
