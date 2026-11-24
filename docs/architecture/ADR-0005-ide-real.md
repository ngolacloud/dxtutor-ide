# ADR-0005 — IDE real: fim dos dados de demonstração

- **Estado:** aceite (2026-11-23); R0, R1b, R1a e R1c1 feitas (verificadas no desktop), R1c2/R1d e R2–R6 por fazer
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
  Resolve-se na R1d, que tira o git simulado: o gitflow passa a ser só git real.
