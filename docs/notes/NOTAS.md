<!-- GERADO por `npm run docs:notes` a partir de `ui-app/src/features/*/notes.ts`. Não edites à mão: edita as notas da feature e regenera. -->

# dxtutor IDE — notas para a documentação oficial

Notas de trabalho, acção a acção: o que faz, como usar, o fluxo por dentro, dicas e limites. São a base da documentação oficial do dxtutor-ide e mantêm-se em dia sozinhas: cada feature descreve as suas acções em `ui-app/src/features/<feature>/notes.ts`, o teste `ui-app/tests/notes.docs.test.ts` falha se uma acção da interface não tiver nota ou se este ficheiro estiver desactualizado, e `npm run docs:notes` regenera-o.

## Índice

- [Co-Dev: o assistente escreve no editor](#co-dev-o-assistente-escreve-no-editor) — 1 acção
- [Explain · Code review · Under the hood](#explain-code-review-under-the-hood) — 9 acções
- [Quadro (backlog, sprints e kanban)](#quadro-backlog-sprints-e-kanban) — 2 acções
- [Project](#project) — 2 acções
- [Testes](#testes) — 1 acção
- [Servidor de linguagem (LSP)](#servidor-de-linguagem-lsp) — 1 acção

---

## Co-Dev: o assistente escreve no editor

Quando o Co-Dev cria ou edita código, escreve-o no próprio editor: abre o ficheiro, escreve só as linhas que mudam, no sítio delas (as antigas riscadas, as novas a aparecer), e no fim aceitas ou rejeitas cada bloco com as diferenças à vista. Nada fica no ficheiro sem o teu «Aceitar».

<sub>Código: `ui-app/src/features/codev/application/hunk-review.ts`, `ui-app/src/features/codev/application/local-proposals.ts`, `ui-app/src/features/codev/domain/proposal.ts`, `crates/tutor-agent/src/hunks.rs` · revisto em 2026-11-26</sub>

| Acção | Onde |
|---|---|
| [Rever as mudanças no editor, bloco a bloco](#rever-as-mudancas-no-editor-bloco-a-bloco) | editor › barra de cada bloco (✓ Aceitar / ✗ Rejeitar / Explicar) · chat do Co-Dev › Aceitar tudo / Rejeitar tudo |

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
2. A coluna `sprints.codevs` nasceu na migração 13 da base do Project.
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

## Ainda sem notas

Acções da barra do editor que ainda não têm nota (a lista só encolhe):

- `tabs:startDebug`
- `tabs:dxRun`
