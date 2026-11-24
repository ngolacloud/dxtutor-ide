# ADR-0005 — IDE real: fim dos dados de demonstração

- **Estado:** aceite (2026-11-23); R1 feita (R0, R1b, R1a, R1c1, R1c2 e R1d; verificada no desktop); R2a feita, R2b–R2e e R3–R6 por fazer
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
