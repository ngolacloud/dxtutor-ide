# ADR-0006 — IDE real: fim dos dados de demonstração

- **Estado:** aceite (2026-11-23); R1 feita (R0, R1b, R1a, R1c1, R1c2 e R1d; verificada no desktop); R2 feita (R2a–R2e2; verificada no desktop); R3 feita (R3a–R3c; verificada no desktop); R4 feita (sem gdb nesta máquina: verificada com IPC falso e o caminho honesto no desktop); R5a, R5b e R5c1 feitas, R5c2 e R6 por fazer
- **Data:** 2026-11-23
- **Decisor:** responsável do projecto
- **Relacionado:** `ADR-0004` (migração da ui-app; corre em paralelo noutra sessão),
  `ADR-0002` (features em camadas), `IPC-MATRIX.md` (comandos que já existem e a UI não chama).

## 1. Contexto

A `ui-app` nasceu como protótipo no browser: um projecto-exemplo `dxtutor/` em memória, missões
guionadas (cenários `a`/`b` do Co-Dev), um git simulado com 12 commits, testes e diagnósticos
derivados por regex de caminhos fixos (`P_LX`, `P_REPO`…), métricas de observabilidade aleatórias,
uma lista de pastas «irmãs» escrita à mão no explorador. A app desktop foi substituindo partes
(terminal, git, Problems, providers, compose/kubectl), mas o resto continua à vista — e uma parte
age sobre a pasta real (o «Delegar» do Board escreve código gerado no disco; o «Repor protótipo»
apagava a pasta aberta, ver R0).

Inventário de 2026-11-23 (o que um utilizador desktop vê e não é real):

| Área | Demo | Fonte real disponível |
|---|---|---|
| Explorador sem pasta | pastas `delonix-*`/DORM/dxjs fixas (`boot.ts`), «fora do workspace do protótipo» | `list_dir`/`workspace_tree` |
| Barra de estado | `✖ 2/3 testes`, `ctx N%` (palpite), blame vazio | `run_tests`, sessão do agente, `git blame` |
| Testing / Run | `runTests()` simulado; launch configs `cargo test -p lexer`… | `list_tests`/`run_test`/`run_all_tests`; `detect_projects`/`project_entrypoint` |
| Co-Dev | chips e missões demo, Manager/uso estimado, menu/paleta/`dx missao` | sessões `codev_agent_*`, `codev_session_*` |
| Welcome | cartões para missões demo e vistas simuladas | Open Folder/recentes (já reais) |
| Search / Outline | só ficheiros carregados; regex de símbolos | `search_project`; `file_outline`/`lsp_*` |
| Code review | texto fixo para os caminhos demo | `review_code` |
| Board / Tasks / Team | contadores semente, auto-teste falso, escopos do projecto demo | `board_load`/`board_save`, `run_tests`, agente real |
| Studio | desenho semente (`ST_SEED`) em LS global | `arch_validate`/`arch_scaffold` |
| Debug | traces guionados sobre `P_LX` | DAP `debug_*` |
| Infra | ambientes/promoções/CrashLoop simulados, métricas aleatórias, dev container falso | `devcontainer_*`, `compose_ps`, kubectl/docker por `exec` |
| Extensões | lista fixa de 13, «instalar» muda flags | Open VSX (HTTP) + `vsix_manifest` |
| Account / Remote | «walter · Team SYS», hosts SSH inventados | utilizador do SO; `~/.ssh/config` |

## 2. Decisão

1. **O demo apaga-se de vez** — não só se esconde no desktop. Saem a semente (`SEED`,
   `VITE_SEED`, `dev:seed`), os cenários guionados, o git simulado, os motores simulados
   (diagnósticos, testes, debug, infra, observabilidade) e as constantes `P_*`. Sem pasta aberta
   a IDE fica vazia (como o VS Code sem pasta). No browser (sem Tauri) a app arranca vazia; o
   PairCode simulado fica, porque é a sua forma de teste.
2. **Cada feature liga-se ao backend real**; onde ainda não houver comando, escreve-se. Uma feature
   não mostra dados inventados em nenhuma fase intermédia: até ser ligada, mostra um estado vazio
   honesto («abre uma pasta», «ainda não há testes detectados»).
3. **Goldens:** os snapshots que caracterizam o comportamento demo (missões guionadas, traces do
   debug, overlay do pane infra simulado…) são **apagados ou regenerados com esta decisão
   registada**, fase a fase, e cada commit diz quais. A regra «nunca regenerar para fazer passar»
   mantém-se para tudo o resto. Cada feature religada ganha testes novos sobre adaptadores falsos
   do IPC (os `Invoker` injectáveis da U2).

## 3. Fases

| Fase | Entrega | Critério de saída |
|---|---|---|
| **R0 — Perda de dados** | Sai o «Repor protótipo» (`resetAll`); o autosave recusa apagar a pasta quando o FS em memória ficou vazio por inteiro e relê o disco | feito |
| **R1 — Arranque limpo** | Em quatro passos: **R1b** missões guionadas do Co-Dev; **R1a** semente e árvore fixa do explorador; **R1c1** diagnósticos/testes simulados e o terminal emulado; **R1c2** debug simulado e os caminhos `P_*`; **R1d** git simulado. Estados vazios honestos | nenhum caminho `dxtutor/…` fixo no código; goldens demo retirados com registo |
| **R2 — Editor e testes reais** | Testing + `#st-tests` por `list_tests`/`run_test`/`run_all_tests`; Run por `detect_projects`; Search por `search_project`; Outline por `file_outline`; `ctx` pelo uso real da sessão; Account com o utilizador real; Code review por `review_code` | testes com IPC falso |
| **R3 — Board/Tasks/Team** | Backlog por workspace (`board_load`/`board_save`); «Delegar» só pelo agente real; auto-teste por `run_tests`; equipa e escopos lidos do projecto | sem `genBacklog` guionado |
| **R4 — Debug** | Run and Debug sobre DAP (`debug_launch`/`break`/`step`/`stack`/`locals`) | sessão real num projecto Rust e num Node |
| **R5 — Infra** | Dev container por `devcontainer_*`; scale/down/logs por kubectl; ambientes = contextos/namespaces reais; métricas por `kubectl top`/`docker stats` | nenhuma métrica aleatória |
| **R6 — Studio, Extensões, Remote** | Studio por workspace (`.dxtutor/`) com `arch_validate`/`arch_scaffold`; Extensões pelo Open VSX + contribuições declarativas (decisão do Learning Track); Remote por `~/.ssh/config` + ssh | nada fixo |

## 4. Coordenação

A U4 do ADR-0004 (outra sessão) dissolve `app.ts`/`boot.ts`/`v5.ts`/`v6.ts`/`bridge.ts` — os
mesmos ficheiros onde vive boa parte do demo. Este trabalho corre na branch `feat/ide-real`
(worktree própria) e faz rebase sobre a `develop` antes de cada fase; as fases que só tocam
`features/<x>/` (R2–R6) colidem pouco, a R1 colide mais e deve ser curta.

## 5. Notas de execução

- **R0 (2026-11-23).** `resetAll` esvaziava o `FS` (`loadSeed` sem semente não repõe nada) e
  emitia `workspace:changed`; o autosave do desktop (`flushSave`) trata cada caminho de `R.disk`
  ausente do `FS` como apagado e chamava `delete_file` (remoção definitiva, sem lixo) — apagava a
  pasta aberta. Removido o `resetAll` (função, menu File, paleta). No `flushSave`, se nenhum
  ficheiro do disco sobreviveu no `FS` e havia mais de um, não se apaga nada: relê-se a pasta. O
  mesmo padrão de «esvaziar o FS» existe no `checkout` simulado, no `restoreCkpt` e no PairCode;
  a rede apanha-os todos.

- **R1b (2026-11-23) — missões guionadas do Co-Dev.** Sai o motor de missões
  (`application/run-mission.ts`: clarificação, conselho de modelos, plano, auto-avaliação,
  correcção, entrega), os cenários `a`/`b` (`domain/scenarios/`), a rubrica (`domain/scoring.ts`)
  e os tipos que só eles usavam; o presenter perde os 18 métodos de missão e passa a chamar-se
  `ChatPresenter`. Saem todos os pontos de entrada: chips do chat, menu Co-Dev («Missões de
  demonstração»), paleta, cartão do Welcome (`v5.ts`), `dx missao` no terminal emulado, o
  decorador `codeGuard` do `v5.ts` e o `sampleOnly` do `bridge.ts` para missões. Texto livre vai
  sempre ao modelo (`codevEngine.chat`). Nas Definições sai a secção «Auto-avaliação» (limiar e
  rubrica: só as missões os usavam; o `THRESH` fica no store porque o template de harness da
  Team o escreve — revê-se na R3); no Gestor saem «Missões» e «Registo de decisões»; no pane sai
  «Missões». Os cartões «provedor simulado»/«ligação indisponível» do browser deixam de oferecer
  missões e mandam para a app desktop. Código morto removido de caminho: os três renderers do
  Welcome que o `v5.ts` sobrepunha (`app.ts` ×2, `codev.ts`), o `GAPS`, 19 acessores do
  `legacy-bridge` do Co-Dev. **Goldens (decisão deste ADR):** `codev.golden` perde o transcript
  da missão `a` e o Welcome morto; regenerados o chat após `newChat`, Definições e Gestor (diffs
  vistos: só as remoções acima); `#pane-codev` com título novo. Testes de caracterização das
  secções 3 (execSteps), 4–8 e 11 e os de domínio de scoring/cenários apagados com o código.
  Handlers inline 163 → 161.

- **R1a (2026-11-24) — semente e árvore fixa.** A semente (`features/workspace/seed.ts`,
  `VITE_SEED`, `npm run dev:seed`) sai da app e passa a fixture de teste
  (`tests/fixtures/sample-workspace.ts`, só os 21 ficheiros base — o `gen` era das missões); o
  harness aplica-a entre o `resetWorkspace()` (ex-`loadSeed`: esvazia o FS e o stage) e o
  `gitInit()`, reproduzindo o estado de antes — **todos os goldens passam sem diff**. A árvore
  do explorador nasce vazia (saem as 14 pastas escritas à mão em `boot.ts`, com estados git
  inventados); o `syncTree` deixa a árvore vazia sem ficheiros e o explorador mostra «Nenhuma
  pasta aberta.» com «Abrir pasta…» quando há desktop (`DXR.open`); uma pasta sem ficheiros diz
  «pasta vazia» (era «fora do workspace do protótipo»), e o `syncTree` do `bridge.ts` aguenta uma
  pasta real vazia. Sai do `boot.ts` o editor de demonstração v1 que já não corria (`DOCS`,
  `renderTabs`/`renderDocs`/`renderMinimap`, `agentShell` «opus-4.8», `welcome`/`wbtn`, `agSend`
  com respostas inventadas, `buildProblems` com o E0382 falso; os vivos são redefinidos pelas
  features) e o `cat` do terminal emulado que lia o `DOCS` (o `XC.cat` lê o FS); o pane
  Containers deixa de listar contentores e imagens inventados (estado vazio até à R5). Fica para a
  R1c: o terminal emulado do browser (identidade `walter@delonix`, `cargo`/`dx` simulados).
  Testes novos: estado vazio do explorador (browser e desktop); o do `loadSeed` passa a provar
  que o `resetWorkspace` não traz ficheiros. Métricas: globais no window 422 → 390, handlers
  inline 161 → 159.

- **R1c1 (2026-11-24) — diagnósticos, testes e terminal emulado.** Sai o motor simulado de
  `features/diagnostics.ts`: `runTests()` (testes derivados de caminhos fixos do projecto de
  demonstração), `dsLint()` (cores fixas só em `desktop/src/`) e as regras de `diagnostics()`
  (E0382 do lexer, `any` em `workspace.ts`, LIMIT sem ORDER BY no repositório de demonstração).
  `diagnostics()` devolve vazio no browser (no desktop o painel continua a pôr os problemas
  reais) e a barra de estado deixa de mostrar «✖ 2/3 testes». O arranque deixa de abrir um
  separador `lib.rs` do projecto de demonstração e de escrever «rust-analyzer · 2 crates
  indexados» no Output. **Testing:** mostra o comando de testes detectado no projecto aberto e
  corre-o a sério (sem pasta: «abre uma pasta»; sem comando: aponta `.dxtutor/commands.json`).
  **Board:** o auto-teste de uma issue sem testes próprios corre os comandos de testes/lint
  detectados (`DXR.exec`, código de saída real); sem nenhum, a issue não passa e o Output diz
  porquê. **Code review:** sai a regra do E0382 e o texto fixo `KNOW` dos ficheiros de
  demonstração; a regra das cores fixas passa a ser pura e genérica (`fixedColours`, qualquer
  CSS/SCSS/TS/JS/Vue/Svelte, sem contar definições `--token:`); «Under the hood» deixa de dar as
  fases do rustc por verificadas (nada compilou o ficheiro), perde a tabela de memória/posse do
  lexer de demonstração, e o plano de consulta passa a derivar-se do código (tabela e coluna do
  WHERE, CREATE INDEX do workspace — antes inventava uma query e o índice
  `idx_conversations_ws_created` quando o ficheiro não tinha SELECT); o rodapé deixa de prometer
  «CPU, memória e I/O medidos» que nada media. **Terminal emulado** (só browser; antecipa a
  R1c3): identidade neutra `user@browser` (era `walter@delonix`), sem `neofetch` inventado, sem
  `cargo`/`npm`/`dx lint`/`git push` simulados; um comando desconhecido aponta o terminal real da
  app desktop; `ls`/`cd`/`cat`/`git` sobre o workspace ficam (o git simulado sai na R1d).
  **Goldens (decisão deste ADR):** `codereview.golden` perde o review e o hood do lexer de
  demonstração e o hood de SQL com query inventada; ganha o hood de Rust honesto, o hood de SQL
  com SEARCH derivado de um CREATE INDEX e um teste do SCAN/«sem plano inventado»; o hood de TS
  muda só no rodapé. Teste novo da regra genérica das cores. Métricas: globais 390 → 388,
  handlers inline 159 → 156.
- **Verificação desktop após R1c1 (2026-11-24).** Binário construído na worktree
  (`cargo build -p dxtutor-ide`, UI embutida) e selftest corrido em `xvfb-run` com `HOME`
  temporário, sem modelo local. **Com pasta** (repo git temporário, como `scripts/selftest.sh`):
  `errors: []`, `stepErrors: {}`; open/autosave/commit/graph/changelog/scm/infra/terminal/
  terminalUI/termgit/codereview/agentTask/panel/providers verdes; passos de LLM `skipped — no
  model reachable` (esperado). **Sem pasta** (o arranque limpo da R1a): `errors: []`,
  `stepErrors: {}`, `files: 0`, PTY/integração de shell verdes, `scanned: false` (sem raiz,
  esperado). **BUG pré-existente reportado (não corrigido aqui; idêntico no selftest de
  `fe47f3d`, antes da R0):** `gfStart`/`gfFinish` em `scm/application/scm-engine.ts` chamam o
  `checkout`/`gitMerge` LOCAIS do motor (só o DAG em memória), não as versões decoradas pelo
  `bridge.ts` que correm git real — no desktop o repositório nunca sai de `main`
  (o passo `gitflow` acaba em `main` em vez de `develop`, sem ramo `feature/*`; os commits
  «feat: flow»/«feat: ckpt ask finish» ficam em `main`), e por isso `checkpoint.finishedViaAsk`
  e `checkpoint.stayedOpen` dão `false`. O selftest não o apanhava porque só falha em `errors`.
  Resolve-se na R1d, que tira o git simulado: o gitflow passa a ser só git real. (Resolvido na R1d.)
- **R1c2 (2026-11-24) — debug simulado e caminhos `P_*`.** Saem as sessões guionadas do
  Run and Debug: a sessão `pre` (a oferta do `.clone()` do rustc sobre o lexer de
  demonstração), a sessão `code` (passo-a-passo com variáveis, watch e call stack
  inventados) e a sessão `ops` (sondas `kubectl` com saídas inventadas a um pod em
  CrashLoopBackOff), com os geradores `lexer-trace`/`crash-trace`/`launch` do domínio, os
  helpers `lexVariant`/`LXL`/`lexBug`, a sessão `window.DBG`, a linha corrente do depurador
  no editor, o contador de lançadores de crash na barra de actividade, o botão «Debug
  this» da vista de observabilidade (ambientes simulados) e o «explicar esta sessão» do
  Explain (`explainCmd(true)`). Não há adaptador de depuração ligado: «Start debugging» (F5,
  menus, barra do editor) abre o pane e o assistente e diz isso; Step/Stop avisam que não há
  sessão; os breakpoints ficam (reais, persistidos, pintados no gutter) à espera do DAP da
  R4. No desktop com pasta, o #pc-dbg continua a ser o assistente real do painel (o teste
  `dbgSession` saiu — nunca há sessão simulada). Saem também as constantes `P_LX`/`P_REPO`/
  `P_MIG`/`P_TEST`/`P_HIST`/`P_ADR`/`P_STORE` (caminhos fixos do projecto de demonstração);
  os testes que as usavam passam a nomear o ficheiro da fixture. Fica `has` (o board usa-o).
  **Goldens (decisão deste ADR):** `debug.golden` perde os goldens das sessões pre/code e do
  pane sem sessão com a lista Launch, as caracterizações `lexTrace-*`/`crashTrace-dns`/
  `debugConfigs` e os testes de dispatch de start/step/watch-add; ganha os goldens do pane e
  do assistente sem depurador e do pane com breakpoints, um teste de que os nomes simulados
  já não se publicam e um de dispatch do `open-bp`. `debug.domain` fica só com as chaves de
  breakpoint. Nenhum outro golden mudou. Rebase sobre a U4g5 (conflitos: o harness do
  projecto dobrado no `codev.ts` perde o `harnessRunMission`; o YAML da extensão dobrado no
  `diagnostics.ts` fica, sobre a base vazia). Rebase seguinte sobre a U4g6/U4g7 (o v5/v6
  deixam de existir): o cartão «Mission: persistent chat history» sai do `features/welcome.ts`,
  os comentários do v6 ficam com ele, e o golden do assistente sem depurador ganha o ícone
  `bug` real (a U4g7 regenerou o golden do debug pelo mesmo motivo). Métricas após o rebase:
  globais 412 → 370, handlers inline 160 → 155.
- **R1d (2026-11-24) — git simulado.** O `gitInit` deixa de semear um histórico inventado
  (12 commits, `main`/`develop`, dois ramos de feature fundidos, tags v0.1.0/v0.2.0): o modelo
  nasce vazio, sem ramo nem commits. Saem a lista fixa `BRANCHES` (main/develop/
  feat/learning-paths), os três commits fixos de `COMMITS`, o «main» fixo da barra de estado,
  a fonte simulada do changelog no browser (derivava do histórico inventado), o `git push`
  fingido do terminal emulado, o fallback do blame para o hash semeado `1a2b3c4`, e código
  morto que mostrava o histórico (o `RP.scm` v3 do app.ts e o `git` base do terminal.ts).
  **Só há repositório quando há git real:** `store.repo()` lê `DXR.git` no desktop (a pasta
  aberta é um repo; o pair também o actualiza) e é falso no browser. Sem repo,
  commit/checkout/merge/gitflow recusam com «Sem repositório git — abre uma pasta com git na
  app desktop» em vez de inventar commits e ramos em memória; o pane Source Control diz-o (no
  desktop com pasta sem git, com um botão `git init`); o terminal emulado responde
  `fatal: not a git repository`. **Com repo, tudo vai ao git real:** o gitflow encadeia
  checkout/merge pela porta `flow`, ligada às versões publicadas (decoradas pelo `bridge.ts`)
  — corrige o bug pré-existente registado acima —, e o `bridge.ts` passa a ligar ao git real
  também o `commitGit` (o commit v4 do board, do terminal e dos agentes, que antes ficava só
  no espelho em memória no desktop); o `commit` v4 já não rebenta num repo acabado de criar
  (ramo sem árvore). **Selftest desktop** (repo temporário): `errors: []`; `gitflow` acaba em
  `develop` com merges `--no-ff` reais dos ramos `feature/*`; `checkpoint.finishedViaAsk` e
  `stayedOpen` passam a `true`; `termgit.pushOk` passa a `false` (o push já não é fingido);
  sem pasta, `errors: []`. **Testes:** o histórico passa a fixture
  (`tests/fixtures/sample-history.ts`, cópia fiel do antigo `gitInit`, que liga o espelho com
  `REPO=true`), aplicada pelo harness — todos os goldens existentes ficam byte-idênticos;
  teste novo `scm.norepo` (modelo vazio, goldens do pane sem repo no browser e no desktop com
  pasta, recusas, `DXR.git` manda, terminal e changelog sem repo, push, e o gitflow pelas
  versões publicadas). Rebase prévio sobre a U4g6/U4g7. Métricas: handlers inline 155 → 149.
- **Rebase sobre a U4h1 (2026-11-24).** A U4h1 mudou a parte desktop do `bridge.ts` para
  `platform/desktop/` (um módulo por grupo, verbatim). As mudanças desta série no `bridge.ts`
  foram re-aplicadas no módulo onde o código vive agora: a rede do `flushSave` (R0) e o
  fallback do `syncTree` (R1a) em `workspace.ts`; o decorador do `runMission` (R1b) sai do
  `demos.ts` e do `types.ts`; o tipo do `explainCmd` (R1c2) em `types.ts` e o fallback do
  `P_LX` no `selftest.ts`; o `realCommit` (R1d) em `git.ts`. Selftest desktop idêntico ao da R1d.
- **R2 em cinco passos.** R2a Testing; R2b Search (`search_project`); R2c Outline
  (`file_outline`); R2d Run (`detect_projects`); R2e `ctx`, Account e Code review (`review_code`).
- **R2a (2026-11-24) — Testing real.** Feature nova `features/testing/` (tipada, em camadas,
  governada por A7/A8 — entra em `FEATURES`), que substitui `features/test.ts`. O pane
  descobre os testes Rust/Go/Python da pasta aberta (`list_tests`), agrupados por ficheiro;
  ▶ corre um (`run_test`, com a língua do teste) e «Run all» corre a suíte (`run_all_tests`);
  o estado de cada teste lê-se da saída da suíte (cargo/go/unittest), e o que a saída não
  nomeia numa suíte que falhou fica por decidir em vez de inventado; os testes que falham
  mostram a saída real. O `#st-tests` passa a ser da feature (contagens reais; vazio sem
  resultados) — o painel e o `diagnostics.ts` deixam de o limpar. O comando de testes
  detectado (p.ex. `npm test`, que a descoberta não cobre) continua a correr num terminal de
  tarefa. Sem pasta (browser), o pane diz como abrir uma. **Testes com IPC falso:**
  `testing.domain` (parser das três línguas, regras de estado, barra), `testing.application`
  (serviço contra uma `TestsPort` falsa: descoberta, erro de IPC, uma corrida de cada vez,
  troca de pasta a meio) e `testing.wiring` (cadeia real com `__TAURI__` falso: pane via
  `RP.test`, ▶, «Run all», abrir na linha, comando no terminal). **Selftest desktop:** passo
  `testing` novo — escreve um teste Python com um caso verde e um vermelho, e o pane real
  lista-os (list_tests), «Run all» dá `✓ 1 ✗ 1` (run_all_tests) e o ▶ corre um (run_test);
  `errors: []`. IPC-MATRIX: os três comandos ganham consumidor. Métricas: globais 370 → 369.
- **R2b (2026-11-24) — Search real.** No desktop com pasta aberta, o pane Search procura em
  toda a pasta no disco pelo backend (`search_project`, sem distinguir maiúsculas, até 2000
  ocorrências — o corte diz-se), em vez de só nos ficheiros carregados: apanha também o que
  o carregamento saltou (grande, binário, além do limite), que aparece esbatido e, ao clicar,
  explica porque não abre. Debounce de 200 ms; uma resposta atrasada nunca pinta por cima de
  uma mais recente; um erro do backend diz-se no pane. No browser continua a procurar nos
  ficheiros carregados. Os resultados abrem-se por um só listener em `#s-res`
  (`data-p`/`data-l`) em vez de `onclick` inline (handlers inline 149 → 147). Cliente IPC novo
  `platform/tauri/search.ts`.
  **Testes com IPC falso:** `search.r2b` (FS no browser, `search_project` com agrupamento e
  ordem, ficheiro não carregado, debounce, resposta atrasada, erro). **Selftest desktop:**
  passo `search` novo — o pane encontra, sem distinguir maiúsculas, a linha 9 do teste Python
  gravado pelo passo `testing`; `errors: []`. IPC-MATRIX: `search_project` ganha consumidor.
- **R2c (2026-11-24) — Outline real.** No desktop com pasta aberta, o Outline do Explorer
  pede os símbolos de um ficheiro de código (Rust/Go/Python/JS/TS) ao backend
  (`file_outline`: servidor de língua quando há, com o caminho absoluto; senão `syn` ou o
  scanner sintáctico) — com as linhas reais e os tipos (struct/fn/method/…). Como cada pedido
  arranca um servidor de língua: cache por ficheiro+conteúdo (redesenhar ou teclar sem mudar
  o texto não pede de novo), debounce de 400 ms, um pedido de cada vez, e o último resultado
  fica à vista até chegar o novo; com o backend em erro, cai na extracção local. Markdown,
  SQL e o browser ficam com a extracção local (`symbols()`, sobre o conteúdo real). Um
  ficheiro aberto sem símbolos diz «Sem símbolos neste ficheiro» (antes pedia para abrir um
  ficheiro). Os símbolos vão para a linha por um listener delegado (`data-on`), sem `onclick`
  inline (handlers inline 147 → 146). Cliente IPC novo `platform/tauri/codeintel.ts`. **Testes com IPC falso:**
  `outline.r2c` (extracção local no browser, clique, backend com língua/pasta/caminho, cache e
  novo pedido ao mudar o texto, Markdown fora, erro → local). **Selftest desktop:** passo
  `outline` novo — o teste Python gravado dá `T`, `test_soma`, `test_falha` (a extracção local
  não lê Python, logo vieram do backend); `errors: []`. IPC-MATRIX: `file_outline` ganha
  consumidor.
- **R2d (2026-11-24) — Run real.** Sai a lista fixa do pane Run (`cargo test -p lexer`,
  `cargo test -p store`, `dx lint`, `npm run dev`…). No desktop com pasta, o pane lista os
  projectos da pasta pelo backend (`detect_projects`: a raiz e as sub-pastas de primeiro nível,
  pelo ficheiro-marca) e os comandos de cada um pela regra pura nova `features/run-commands.ts`
  (Rust/Go/Python/Java/PHP/Ruby com os comandos habituais; Node com os `scripts` reais do
  package.json e o gestor do lockfile; tipo desconhecido diz «sem comandos conhecidos» em vez de
  inventar); cada comando corre num terminal de tarefa (PTY) na pasta do projecto. Sem pasta, o
  pane diz como abrir uma. O pane passa a abrir-se pelo menu Run («Run Project…», «Run Tests») e
  pela paleta («Run: Projectos e comandos…»), que deixam de correr `cargo test`/`cargo build`/
  `dx lint` fixos; os menus v1 do `boot.ts` perdem os recentes inventados (`delonix-runtime`,
  `DORM`) e o «Run Task…» fixo. O chat ao vivo do Co-Dev no browser deixa de oferecer as
  ferramentas `run_tests`/`design_lint` (eram `cargo test -p lexer|store` e `dx lint`, que o
  terminal emulado já não conhece desde a R1c1) e o prompt diz que ali não há onde correr testes;
  no desktop continuam com os comandos detectados. Cliente IPC novo `platform/tauri/projects.ts`.
  **Testes com IPC falso:** `run.r2d` (regra dos comandos por ecossistema, pane sem pasta, menus
  e paleta, projectos e comandos do backend, terminal de tarefa com `cwd`, `cd` sem PTY, erro).
  **Selftest desktop:** passo `run` novo — um package.json com um script dá o projecto `node` e o
  comando `npm run hello`; `errors: []`. IPC-MATRIX: `detect_projects` ganha consumidor.
  Métricas: handlers inline 146 → 145 (os comandos correm por um listener, sem `onclick`).
- **R2e em dois passos.** R2e1 `ctx` e Conta; R2e2 Code review (`review_code`).
- **R2e1 (2026-11-24) — `ctx` e Conta reais.** **Backend:** o `ChatReply` do `tutor-llm`
  ganha `input_tokens`/`output_tokens` e os quatro adaptadores de streaming lêem o uso que o
  provider reporta (`absorb_usage`, pura: Claude `message_start`/`message_delta` com os tokens
  de cache, OpenAI o chunk final — o pedido passa a levar `stream_options.include_usage` —,
  Gemini `usageMetadata`, Ollama `prompt_eval_count`/`eval_count`; 0 quando não reporta, com
  4 testes unitários); o `llm://done` leva `inputTokens`/`outputTokens`. **UI:** o
  `streamChat` do desktop usa esses números (antes 0 de entrada e texto/4 de saída,
  inventados) e anuncia o uso de cada volta (`dx:llm-usage`); o `ctx` da barra de estado
  deixa de ser uma percentagem de um orçamento inventado (caracteres/4 sobre 2000 tokens) e
  mostra os tokens de entrada da última volta (o tamanho do contexto enviado), com a soma da
  conversa no título; vazio antes da primeira volta, no browser e quando o provider não
  reporta; «Nova conversa» repõe-no. A Conta deixa a identidade fixa «walter · Team SYS»: no
  desktop mostra o utilizador e a máquina (whoami/hostname, já lidos no arranque) e a
  identidade git que assina os commits (`git config user.name`/`user.email`, lida no
  arranque); no browser diz que não há sessão local; «Uso e missões» passa a «Uso».
  **Testes:** `ctx-account.r2e1` (ctx vazio, última volta e soma, provider sem uso, reposição;
  Conta no browser, no desktop e sem user.name) + os 4 testes Rust do uso. **Selftest
  desktop:** passo `account` novo — mostra o utilizador e a máquina reais; `errors: []`. O uso
  real dos providers só se vê com um modelo a responder (o selftest corre sem modelo).
- **R2e2 (2026-11-24) — Code review real.** No desktop com pasta aberta, a tab de Code review
  junta às regras locais (instantâneas) os analisadores instalados no projecto, pelo backend
  (`review_code`, âmbito `file`, caminho relativo; adaptador novo
  `codereview/infrastructure/tauri.ts`, tipos novos no domínio): cada achado traz o
  analisador e a regra (p.ex. `rustc · E0382`), a classe honesta do backend (bug / risco /
  oportunidade — um lint nunca é um bug), a evidência, a consequência e como verificar, e um
  «line N» que abre o ficheiro na linha; a secção diz que analisadores correram, falharam,
  não estão instalados ou não se aplicam. Um resultado que chega depois de a tab mudar não
  pinta. No browser a secção não aparece — os goldens do Code review ficam byte-idênticos.
  **Testes com IPC falso:** `codereview.r2e2` (browser sem secção, pedido e achados com a
  classe, abrir na linha, resultado atrasado, sem achados, erro). **Selftest desktop:** passo
  `review` novo — o teste Python dá `ruff · não instalado` (dito, não escondido); `errors: []`.
  IPC-MATRIX: `review_code` ganha consumidor. **Com isto a R2 fica feita.**
- **Renumeração e rebase sobre a U4h2–U4h4 + learning-plugins (2026-11-24).** Este ADR nasceu
  como `ADR-0005-ide-real.md`; o `develop` recebeu entretanto o `ADR-0005-learning-track-plugins.md`
  (PR #1, primeiro a entrar), por isso passou a **ADR-0006**. As mensagens de commit anteriores
  (R0…R2e2) e os nomes de passos dizem «ADR-0005»: são este ADR. As referências no código e nos
  testes desta série foram renumeradas (só as linhas acrescentadas pela série — as do
  learning-plugins ficam). No rebase: a U4h2 passou a decoração git do desktop a uma porta
  injectada (`desktopPorts.scm`); o `realCommit` da R1d deu lugar a essa porta, e o `commitGit`
  (board, terminal, agentes) passa a consultá-la como o `commit` (antes ficava só no espelho em
  memória). As acções do pane Source Control (botão Commit, mudar de ramo, Ctrl+Enter, finalizar
  gitflow) passam a chamar as versões publicadas — o `develop` registava como bug pré-existente
  (desde f07dbc1) que no desktop iam ao motor local sem git real; corrigido aqui por ser «git só
  real» (R1d). Selftest desktop completo (todos os passos da R1 e da R2): `errors: []`; o gitflow
  acaba em `develop` com merges reais. Métricas: globais 411 → 368.
- **R3 em três passos.** R3a o runner só com o agente real; R3b o backlog por workspace
  (`board_load`/`board_save`); R3c a equipa e os escopos do projecto, e Tasks com sprints e
  custos reais.
- **R3a (2026-11-24) — o Board sem runner guionado.** Correr uma issue («Delegar», «Executar
  Sprint», «⚡ Agente» — os três passam a ser o mesmo) é: ramo gitflow (git real) → o agente
  real implementa-a (`codevAgentStory`, modo plano: o humano aprova o plano) → commit do que o
  agente mudou (`commitGit`, pela porta do git) → os testes do projecto (`projectTests`:
  comandos detectados / `.dxtutor/commands.json`, código de saída real) → «Validação
  funcional» se passam, volta a desenvolvimento com a nota se não; o agente sem alterações
  deixa a issue em desenvolvimento com essa nota. Sem agente (browser, sem pasta, provedor sem
  ferramentas), o runner di-lo e não mexe na issue. Saem: os produtores `gen`/`fix` das issues
  (os templates dos geradores — Dockerfiles, compose, k8s, esqueletos — que o «Delegar»
  escrevia no disco de uma pasta real), os testes-predicado sobre o FS (`tests`), o
  encaminhamento de modelo e as contagens de tokens inventadas (`router.route`/`use(…, 2600)`),
  as pausas encenadas e as sub-issues «fora do escopo»; o guarda desktop do `runSprint`
  (`platform/desktop/demos.ts`, «Sprint runs are scripted demos») sai com o ficheiro. O
  «Gerar backlog» do Studio mantém a decomposição (ADR do arquitecto, serviço/aplicação
  web/esquema por componente, artefactos de execução, teste de fumo) mas só com o enunciado e
  o contexto do desenho na nota (que segue para o agente) — sem código e sem o teatro do
  «arquitecto a ler o desenho». **Encontrado e corrigido:** (1) o `autoTest` chamava um
  `sleep(380)` global nunca publicado — o runner rebentava ao entrar em Teste (bug registado
  como pré-existente); sai com as pausas; (2) no desktop o checkout do ramo é assíncrono e o
  runner lançava o agente sem esperar — os ficheiros podiam cair no ramo errado; a porta nova
  `scm.settle()` (`DXR.idle()`) espera pela fila entre o ramo, o agente, o commit e os testes.
  **Goldens (decisão deste ADR):** `genBacklogIssues-seed` e `mkIssue-default` regenerados (as
  mesmas issues, agentes e sprints, sem `genPaths`/`tests` e com a nota); o teste «delegate de
  issue custom → dev» dá lugar a três (com agente falso: ramo, commit do que o agente escreveu,
  testes do projecto, «func» e volta a develop; agente sem alterações; sem agente). **Selftest
  desktop:** passo `board` novo — com um agente falso (o selftest não tem modelo) e o resto
  real: ramo `feature/dx-11-…`, commit `feat: Selftest do board (DX-11)` no git, os testes do
  projecto (unittest via `.dxtutor/commands.json`) passam, a issue fica em «Validação
  funcional» e o repositório volta a `develop`; `errors: []`. Métricas: handlers inline 145 → 143.
- **R3b (2026-11-24) — o backlog por pasta.** O quadro deixa de ser só sessão em memória: no
  desktop com pasta aberta, carrega-se do backend quando a pasta abre (`board_load`, um backlog
  por pasta num SQLite da app) e grava-se quando muda (`board_save`). As mutações vivem em vários
  sítios (motor, políticas do quadro, Tasks, revisão), por isso grava-se por detecção de mudança:
  depois de cada interacção (clique/alteração/largar) e de cada passo do runner, uma verificação
  com debounce compara o backlog serializado com o último gravado. Nunca se grava antes de
  carregar a pasta actual, nem o quadro de uma pasta sobre outra; ao trocar de pasta o quadro é o
  dela. No browser fica em memória. **Backend:** o `Story` do `tutor-board` ganha `meta`
  (JSON opcional, numa coluna nova, com migração aditiva para bases antigas e um teste) para os
  campos do quadro sem coluna (agente, dono humano, merge, componente do Studio, revisão,
  explicação, custo, resultado dos testes). **UI:** mapeamento puro novo
  `board/domain/persist.ts` (título → `want`, tipo → `kind`, o resto em `meta`; os defaults não
  se guardam; um backlog vindo de fora com `seq` atrasado fica coerente) e adaptador
  `board/infrastructure/tauri.ts`. **Testes com IPC falso:** `board.persist` (mapeamento e ida e
  volta, browser sem IPC, carregar ao abrir a pasta, gravar só depois de carregar e só se mudou,
  trocar de pasta sem misturar) + o teste Rust da coluna `meta`. **Selftest desktop:** o passo
  `board` confirma que a issue ficou gravada no SQLite real (`func`, agente `be`) e que reabrir a
  pasta a carrega de volta; `errors: []`. IPC-MATRIX: `board_load`/`board_save` ganham consumidor.
- **R3c (2026-11-24) — a equipa do projecto e Tasks reais.** Os escopos dos assistentes deixam
  de ser os do projecto de demonstração (`crates/**`, `desktop/src/**`, `db/migrations/**`,
  `crates/*/tests/**`, mais os `apps/APP/…` que o `app.ts` acrescentava para o layout que os
  geradores do Board produziam): a regra pura nova `features/team-scopes.ts` deriva-os da
  estrutura real da pasta aberta (as pastas com manifestos de backend, as com package.json, as
  migrações, os testes, o deploy; `node_modules`/`target`/… não contam) e dos comandos de
  testes/lint detectados, e o `.dxtutor/team.json` do projecto manda por cima (entradas
  inválidas ignoram-se; JSON inválido diz-se no log). Aplicam-se ao abrir a pasta e passam a
  ser os defaults que os templates de harness repõem; gravar a equipa escreve o
  `.dxtutor/team.json` no projecto (versionável; sem pasta, no LS como antes). Sem pasta, os
  especialistas de backend/frontend ficam «só leitura» (não há projecto de onde derivar). A
  descrição do Backend deixa «Crates Rust e comandos Tauri» (o repositório de demonstração).
  **Tasks:** os filtros de sprint vêm do backlog (eram «Sprint 1/2» fixos) e, sem custo medido,
  o conselho de delegação já não inventa «1200 tokens por ponto» ao preço do Claude — diz que a
  primeira corrida o mede. **Custo e `ctx` reais do agente:** o agente v2 só mostrava o uso numa
  nota; a porta nova `onUsage` envia o uso de cada pedido (entrada com cache, saída) para o
  contador de uso (que o custo medido das issues lê) e para o `ctx` (`dx:llm-usage`). Também:
  as pastas abertas do explorador nasciam com as do projecto de demonstração
  (`dxtutor/crates/lexer/src`, …) — nascem só com a raiz. **Goldens (decisão deste ADR):** o do
  `#pane-codev` muda só na lista de escopos da equipa (sem pasta). **Testes:** `team.r3c`
  (derivação em vários layouts, nada do demo, `team.json` válido/inválido e ida e volta, aplicar
  ao abrir a pasta com o `team.json` a mandar, gravar no projecto, sprints e conselho do Tasks)
  e um teste novo no `codev.agent-chat` (uso por pedido, com cache). **Selftest desktop:** passo
  `team` novo — o frontend derivado do package.json real, o QA do `team.json`, e gravar a equipa
  escreve-a no disco; `errors: []`. **Com isto a R3 fica feita.**
- **R4 (2026-11-24) — depuração real.** O backend já tinha um motor de depuração real — o gdb
  sobre a Machine Interface (`debug_*`, `src-tauri/src/debug.rs`) — que a UI nunca consumia; o
  pane Run and Debug (sem sessões desde a R1c2) passa a usá-lo. «Start debugging» (F5) escolhe
  o programa — num projecto ou workspace Cargo, `cargo build` (código de saída real) e o binário
  em `target/debug/` (pergunta qual se houver vários; um workspace só de bibliotecas diz que não
  há programa para correr); noutro projecto, pergunta pelo executável —, lança o gdb na pasta,
  põe os breakpoints do gutter e corre. Quando pára: o pane mostra onde (função, ficheiro, linha,
  razão), as variáveis locais e a pilha que o gdb dá (clicar numa linha da pilha abre-a), o
  editor abre o ficheiro e pinta a linha corrente (`dbgCurrent`); Continue (F5 com a sessão
  parada), Step over (F10), Step into (F11, novo, também no menu Run) e Stop (Shift+F5) seguem
  para o gdb; um breakpoint novo durante a sessão vai para o gdb; o fim do programa diz o código
  de saída. Sem gdb, o pane di-lo com o que instalar; um erro do gdb diz-se e fecha a sessão.
  **Backend:** `debug_launch`/`debug_run`/`debug_continue`/`debug_step` passam a `async` — um
  comando síncrono do Tauri corre na thread principal, e estes esperam pelo gdb até o programa
  parar (a janela congelava). **Domínio novo** `debug/domain/session.ts` (contratos do gdb;
  `cargoBins`/`cargoTargets`; `fsKeyFor` — o caminho do gdb → a chave do editor, fora da pasta
  não abre). **Goldens (decisão deste ADR):** os do pane/assistente sem sessão e com breakpoints
  mudam do «no debugger attached» para o botão «Start debugging» e a explicação do gdb.
  **Testes com IPC falso:** a sessão inteira (construir, lançar com o programa e a pasta,
  breakpoints relativos, parar com variáveis e pilha, editor na linha, passo, F5 a continuar até
  ao fim e `debug_stop`), sem pasta, sem gdb, workspace só com bibliotecas, erro do gdb, e as
  regras puras. **Selftest desktop:** passo `debug` novo — esta máquina não tem gdb (só o
  `rust-gdb`, que precisa dele): confirma o caminho honesto (`saysNoGdb: true`); com gdb, o
  mesmo passo corre uma sessão real sobre um binário Cargo pequeno (pára no breakpoint, lê a
  variável, dá um passo e corre até ao fim). `errors: []`. IPC-MATRIX: os nove `debug_*` ganham
  consumidor. **A verificar na máquina do utilizador:** instalar o gdb e correr o selftest (ou F5
  num projecto Cargo).
- **Rebase sobre a U4h5, U4i1–U4i3 e o Studio F0/F1 (2026-11-24).** A U4h5 passou mais três
  decorações do desktop a portas injectadas (`desktopPorts.codev.runMission`,
  `desktopPorts.board.runSprint`, `desktopPorts.welcome`/`changelog`/`explorer`); a U4i tipou o
  `boot.ts`, o `infra.ts` e o `visualizer.ts`. As mudanças desta série foram re-aplicadas por cima:
  o `runMission` sai da porta do Co-Dev (as missões saíram na R1b); a porta do `runSprint` sai
  inteira (`BoardDesktop`, a entrada no registo `app/desktop.ts` e o embrulho no `board.ts` — a
  única implementação era o guarda «Sprint runs are scripted demos» do `demos.ts`, que a R3a tira);
  o Welcome mantém a porta sem o cartão da missão de demonstração; o changelog mantém a porta com
  a fonte sem repositório vazia (sem a simulação); a porta do explorador mantém o fallback da
  pasta vazia (R1a); o `boot.ts` tipado fica sem a árvore, o `DOCS` e os contentores inventados;
  o `infra.ts` tipado fica sem o «Debug this». Selftest desktop completo (R1–R4): `errors: []`.
  Métricas após o rebase: globais 392 → 366, handlers inline 158 → 143.
- **Rebase sobre a U4j2 e o Studio F2 (2026-11-24).** A U4j2 tirou os shims `RP.x=()=>window.renderX()`
  do `app.ts`: cada feature regista o seu pane. As que esta série reescreveu passam a registá-lo
  elas próprias (`features/testing` → `RP.test`, `run.ts` → `RP.run`, `account.ts` → `RP.account`;
  o `search.ts` já o fazia). Selftest desktop completo: `errors: []`. Métricas: handlers inline
  152 → 143.
- **R5 em três passos.** R5a runtime, stack e Containers; R5b o dev-container (`devcontainer_*`) e
  o scale/delete do K8s reais; R5c os ambientes e a observabilidade a partir do cluster e do
  runtime reais.
- **R5a (2026-11-24) — a Infra sem fingir no browser; o pane Containers real.** No desktop, a
  ligação ao runtime (`docker`/`podman info` pelo socket), ao cluster (`kubectl`), o deploy (com a
  pasta aberta) e a stack (`compose up/down/ps`) já eram reais (portas `desktopPorts.infra`/
  `stack`). As versões de base — as que o browser corre, e o desktop sem pasta — deixam de fingir:
  ligar o runtime/cluster diz que precisa da app desktop (era um interruptor com «(simulated)» no
  log; uma ligação presa de uma sessão antiga ainda se desliga); o deploy mantém os erros reais
  (falta `deploy/k8s`, faltam Dockerfiles) mas já não fabrica um cluster com «N deployments
  ready»; o ▶ RUN mantém os erros reais do compose mas já não inventa builds, pulls e serviços a
  correr; o terminal emulado deixa de responder `kubectl get …`/`devcontainer up` com o estado
  simulado; o rodapé «Everything here is simulated in the browser» dá lugar a uma frase honesta
  (só no browser). A etiqueta da stack passa a «live» (o `STACK` só vem do `compose ps` real).
  **Pane Containers real (desktop):** `docker`/`podman ps -a` e `images` em JSON pelo socket do
  pane Infra (`platform/desktop/infra.ts`, regista o `RP.containers`; redesenha ao ligar/desligar o
  runtime e depois da stack); sem runtime ligado, di-lo; no browser, diz de onde vêm.
  **Goldens (decisão deste ADR):** os três do pane Infra mudam só no rodapé. **Testes:**
  `infra.r5a` (cluster, ▶ RUN com e sem compose, deploy com manifestos, terminal emulado) e o
  teste do «Connect socket» passa ao comportamento honesto. **Selftest desktop:** passo
  `containers` novo — liga o Docker real e o pane lista o contentor e as 2 imagens desta máquina
  (`backend-postgres-1 · postgres:16-alpine · Up 2 days (healthy)`); `errors: []`.
- **R5b (2026-11-24) — o dev container e o scale/delete do K8s reais.** **Desktop** (porta
  `desktopPorts.infra`, métodos novos opcionais `dcAttach`/`dcDetach`/`k8sScale`/`k8sDown`; cliente
  `platform/tauri/devcontainer.ts`): «Attach» escreve o `.devcontainer/devcontainer.json` se falta,
  grava, e arranca a sessão do projecto (`devcontainer_session_up`, saída no terminal); o `DEVC`
  vem do `devcontainer_session_status` real e diz o motor (`get_sandbox_engine`); «Detach» faz
  `devcontainer_session_down`; ao abrir uma pasta, uma sessão que já corre é reposta. **O motor é o
  do sandbox do backend** (aqui o delonix, o mesmo da Learning Track), não o runtime ligado no
  pane: diz-se qual é em vez de o trocar em silêncio (`set_sandbox_engine` é global e mudaria a
  avaliação dos cursos). Scale/delete correm o `kubectl … scale deploy/N --replicas=X` / `delete
  -f deploy/k8s` reais num terminal de tarefa e relêem o cluster. **Browser** (versões de base):
  «Attach» só escreve o `devcontainer.json` e diz que arrancá-lo precisa da app desktop (já não
  inventa um `DEVC`); scale/delete dizem que precisam do kubectl real e não mexem no `K8S` (antes
  ecoavam «scaled»/«deleted» e alteravam as réplicas em memória). **Testes:** `infra.r5b` (attach
  com e sem runtime, detach, scale/delete sem mexer no cluster, as versões publicadas passam pela
  porta e uma porta sem os métodos novos cai na base). **Selftest desktop:** passo
  `devcontainer` novo — um `devcontainer.json` com uma imagem local (`postgres:16-alpine`),
  attach → o contentor `dxtutor-sess-…` aparece no `ps` do motor (delonix) → detach → desaparece;
  `errors: []`. Sem goldens tocados.
- **Rebase sobre a U4j3 e o Studio F3 (2026-11-24).** A U4j3 levou os helpers e o estado do
  `app.ts` para os donos: os caminhos `P_*` do projecto de demonstração (que a R1c2 tirou)
  tinham ido para o `features/workspace.ts` — saem de lá; o `resetWorkspace` (R1a) junta-se ao
  `writeFile`/`extOf`/`short`/`norm`/`LF` publicados pelo `workspace.ts`; as pastas abertas que
  nascem só com a raiz (R3c) passam ao `app/store/workspace.ts` (o novo dono do `OPEN`).
  Selftest desktop completo (34 passos): `errors: []`. Métricas: globais 389 → 363.
- **R5c em dois passos.** R5c1 os ambientes (staging/production no cluster real); R5c2 a
  observabilidade (métricas e logs reais em vez das séries semeadas).
- **R5c1 (2026-11-24) — os ambientes vêm do cluster real.** Cada ambiente é um contexto do
  kubeconfig + um namespace: o local é o do pane Infra; staging e production escolhem-se na vista
  Environments entre os contextos reais (`kubectl config get-contexts`, lidos ao ligar o cluster —
  a lista `KCTX` deixa de ser kind/minikube/k3d/docker-desktop inventados e nasce vazia; os
  contextos «staging»/«production» por omissão saem). **Estado:** lido do cluster pela porta nova
  `EnvCluster` (`desktopPorts.infra.cluster`): `kubectl get deploy|pods|ingress -o json`
  interpretado por `parseClusterState` (domínio puro) — réplicas, prontos, reinícios e o motivo de
  um contentor preso (`CrashLoopBackOff`, `ImagePullBackOff`…) vêm dos pods; a versão e a hora vêm
  das anotações `dxtutor.io/version`/`deployed-at` que o deploy e a promoção põem nos
  Deployments (o `K8S.ver` deixa de ser o `develop` e o relógio no fim do deploy). O estado não se
  guarda (a chave do LS passa a `envx7`, largando o estado inventado da `envx6`). **Sai o
  fabricado:** os segredos de staging «torcidos» (`st4g1ng`, o host `.staging` para provocar um
  crash) — staging e production nascem com as chaves do design por preencher (excepto `PORT`); o
  crash derivado dos segredos e os `restarts: 6`; a promoção que escrevia um estado e ecoava
  «simulated». **Promover/Redeploy (desktop):** o diálogo mantém-se (commits, segredos em falta ou
  vazios, confirmação «production»); aprovar faz `kubectl apply -f -` do manifesto do ambiente
  (`envManifest`: os `deploy/k8s` com os Secrets `<app>-env` reescritos com os segredos desse
  ambiente, pela entrada padrão — nunca no disco nem na linha de comandos), anota a versão, espera
  pelo `rollout status` de cada Deployment e relê o ambiente; só um deploy que correu bem entra no
  histórico. Production bloqueada por staging a falhar aponta para os logs (o «Attach» do debugger
  simulado já não existe). **Browser:** sem cluster, staging/production não têm estado e aprovar
  uma promoção diz que precisa da app desktop. **Goldens (decisão deste ADR):** os três do pane
  Infra mudam no selector de contexto (só o contexto configurado até se lerem os reais) e o de
  staging no motivo do crash; `initSecrets-sec`/`secretCheck` passam a chaves por preencher; o
  `envDeps-crash` sai (era o crash fabricado). **Testes:** `infra.r5c1` (9: browser sem estado nem
  promoção; desktop com porta falsa — o manifesto leva os segredos de staging e não os locais, um
  deploy falhado não entra no histórico, `refreshEnvs` só lê ambientes com contexto e cluster
  ligado, production bloqueada → logs, o selector de contexto) e `infra.domain` (parser do kubectl,
  `envManifest`, `deploymentsIn`). **Selftest desktop:** passo `environments` — NUNCA contra os
  clusters do utilizador: um kubeconfig temporário com um contexto cujo servidor não responde; os
  contextos lidos são os reais do ficheiro, a leitura do namespace falha com a mensagem do kubectl
  e o apply por stdin falha sem registar nada; `errors: []`.
