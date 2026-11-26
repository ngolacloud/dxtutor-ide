<!-- GERADO por `npm run docs:notes` a partir de `ui-app/src/features/*/notes.ts`. Não edites à mão: edita as notas da feature e regenera. -->

# dxtutor IDE — notas para a documentação oficial

Notas de trabalho, acção a acção: o que faz, como usar, o fluxo por dentro, dicas e limites. São a base da documentação oficial do dxtutor-ide e mantêm-se em dia sozinhas: cada feature descreve as suas acções em `ui-app/src/features/<feature>/notes.ts`, o teste `ui-app/tests/notes.docs.test.ts` falha se uma acção da interface não tiver nota ou se este ficheiro estiver desactualizado, e `npm run docs:notes` regenera-o.

## Índice

- [Explain · Code review · Under the hood](#explain-code-review-under-the-hood) — 8 acções
- [Quadro (backlog, sprints e kanban)](#quadro-backlog-sprints-e-kanban) — 2 acções

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
| [Código melhorado: Código / Diferenças, Copiar, Aplicar, Reverter](#codigo-melhorado-codigo-diferencas-copiar-aplicar-reverter) | cartão «Código melhorado» no painel |
| [Aplicar e testar](#aplicar-e-testar) | cartão «Código melhorado» › «Aplicar e testar» |
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

### Código melhorado: Código / Diferenças, Copiar, Aplicar, Reverter

**Onde:** cartão «Código melhorado» no painel

Mostra o ficheiro proposto com realce ou como diferenças (+/−) contra o actual, e aplica-o ao ficheiro com possibilidade de voltar atrás.

**Como usar**

1. Escolhe «Código» ou «Diferenças» no cartão.
2. «Aplicar» escreve o código no ficheiro (o autosave do desktop leva-o ao disco).
3. «Reverter» repõe o ficheiro como estava antes de aplicar.

**Fluxo (por dentro)**

1. As diferenças são linha a linha (`features/diff/domain/diff.ts`) contra o conteúdo actual do editor.
2. Aplicar guarda primeiro o conteúdo anterior; Reverter escreve-o de volta.

**Dicas**

- O cabeçalho do cartão fica colado ao topo enquanto percorres o código, com as acções sempre à mão.

**Limites**

- Se o ficheiro mudar entretanto, «Reverter» repõe a versão de antes de aplicar (perde as mudanças feitas depois).

<sub>Cobre: `cr:code-view`, `cr:copy-improved`, `cr:apply`, `cr:revert`</sub>

### Aplicar e testar

**Onde:** cartão «Código melhorado» › «Aplicar e testar»

Aplica o código melhorado e corre os testes do projecto com ele; mostra se passaram e a saída.

**Como usar**

1. Carrega em «Aplicar e testar».
2. Se passarem, fica aplicado. Se falharem, lê a saída e escolhe «Corrigir os testes que falham» ou «Reverter».
3. Depois de mudar algo, «Correr os testes outra vez».

**Fluxo (por dentro)**

1. Aplica (se ainda não), grava o editor no disco e espera pela fila de escrita.
2. Corre a suite pelo comando detectado no projecto (`run_tests`, o mesmo que o agente usa para verificar; dentro do contentor quando há sessão).
3. A falhar, «Corrigir os testes que falham» manda ao modelo a saída e o ficheiro actual e pede o ficheiro corrigido; continua a ser possível reverter até ao original.

**Limites**

- Só na app desktop com uma pasta aberta; no browser o painel di-lo e não mexe no ficheiro.
- Sem comando de testes detectado, o erro do backend aparece no cartão (define "test" em .dxtutor/commands.json).

<sub>Cobre: `cr:test`, `cr:fix-tests`</sub>

### Barra do painel de documento

**Onde:** cabeçalho do painel

Controla o documento: ver formatado ou o markdown, copiar, parar, gerar de novo, continuar no chat, abrir a revisão em separador e fechar.

**Como usar**

1. «Pré-visualização / Markdown» troca entre o documento formatado e o texto.
2. ⧉ copia o documento; «Copiar» num bloco de código copia só esse bloco.
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

## Ainda sem notas

Acções da barra do editor que ainda não têm nota (a lista só encolhe):

- `tabs:startDebug`
- `tabs:dxRun`
