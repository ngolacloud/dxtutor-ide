# CLAUDE.md — dxtutor IDE

Desktop IDE (Tauri 2 + Rust) para o protótipo Co-Dev. Este ficheiro é o harness
de arquitectura: o mapa das camadas, a regra de dependências, os invariantes que
não podem regredir, e os comandos para os verificar. Lê isto antes de tocar nas
features em Clean Architecture (`ui-app/src/features/codev/`,
`ui-app/src/features/codereview/`) ou de extrair uma feature nova.

## Comandos (correr da raiz)

> `node`/`npm` são via **nvm** nesta máquina:
> `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` antes de `npm …`.

| Objectivo | Comando |
|---|---|
| **Typecheck + build da UI** | `npm run ui:build` (`tsc --noEmit` + `vite build`) |
| **Testes unitários + golden** | `npm run ui:test` (vitest) |
| **Lint de arquitectura** | `npm run arch:check` (`scripts/arch-check.sh`) |
| App completa (embute a UI em compile-time) | `npm run dev` / `npm run build` |

O Tauri embute `ui-app/dist` em **compile-time** (`beforeBuildCommand` corre
`ui:build`): para ver uma mudança de UI na app, é preciso `ui:build` **e** rebuild
do binário. O binário fica em `<repo>/target/debug/` (não em `src-tauri/target/`).

## Invariantes (verificados por `arch:check`, não podem regredir)

`scripts/arch-check.sh` é a porta de CI leve (estática, sem compilar, sem
dependências — só `bash`/`awk`/`grep`). Verifica:

- **A1–A3** — os 164 comandos Tauri registados em `generate_handler!` batem certo
  com os `#[tauri::command]` por ficheiro e com a matriz `docs/architecture/IPC-MATRIX.md` (1:1).
- **A4–A5** — a cadeia de build aponta para a UI oficial única (`../ui-app/dist`);
  nenhuma config referencia `ui/` ou `ui-next/`. **Nunca** trocar `frontendDist`
  para `ui-next`.
- **A6** — baseline de `@ts-nocheck` (**directiva** `// @ts-nocheck`, não a palavra
  em prosa): **0 ficheiros** desde a U4j5b do ADR-0004 (era 11). Nenhum ficheiro da UI
  pode voltar a ter a directiva: código novo nasce tipado.
- **A7–A8** — fronteiras da Clean Architecture das features extraídas (abaixo).
  A var `FEATURES` do `arch-check.sh` lista quais governam (hoje `codev`, `ext`,
  `codereview`, `scm`, `debug`, `board`, `visualizer`, `infra`, `panel`, `learn`, `arch` e `testing`); cada nova
  extracção acrescenta-se lá. A `arch` (Studio de arquitectura de sistema, separador «Architecture»)
  é uma feature nova e tipada, separada do Studio do catálogo cloud (`features/studio.ts`). Nota: desde a U4i do ADR-0004 nenhuma
  feature tem `@ts-nocheck` (os resíduos `infra.ts`/`visualizer.ts` e o interpretador `vzRun`
  foram tipados), o `boot.ts` também (U4j1) e, por fim, o `app.ts` (U4j5b), que depois se dividiu
  em `app/commands.ts` (CMD/menus) e `app/boot-steps.ts` (boot, boot3–boot6) e deixou de existir (U4j5c).

## Arquitectura da feature Co-Dev (`ui-app/src/features/codev/`)

Piloto de Clean Architecture (ADR-0002). A feature está extraída do monólito
(`app.ts`/`v5.ts`/`v6.ts`) em camadas com fronteiras tipadas e verificadas:

```
features/codev/
  domain/          tipos, policy (approvalFor), composer, project-commands, agent-events,
                   provider-errors, pricing.
                   PURO: sem DOM, sem window, sem Tauri, sem importar de fora.
  application/     casos de uso: ports.ts + live-chat / agent-chat / tool-executor.
                   Deps injectadas por argumento; sem HTML. Cancelamento por AbortSignal.
  ui/              chat-view.ts (dono do DOM/markup) + actions.ts (1 listener
                   delegado no document: data-action + data-on, sem onclick inline).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.* (tipado).
  index.ts         raiz de composição: liga adapters (bridge) ↔ ui ↔ casos de uso.
features/codev.ts  RESÍDUO strangler (fora da subárvore): publica os shims window.*
                   que app.ts/board.ts ainda resolvem por global. Transitório.
```

### A regra de dependências (o centro não conhece a borda)

```
         domain  ←  application  ←  ui
            ↑            ↑           ↑
            └──────── index.ts ──────┘   (composição)
                         ↓
                 infrastructure (window)
```

- **`domain/` não importa `application/`, `ui/` nem `infrastructure/`.**
  Verificado por **A7** (reprova qualquer especificador de import com um segmento
  `application|ui|infrastructure`).
- **Só `infrastructure/legacy-bridge.ts` toca em `window`.** Todo o resto da
  subárvore (`domain/`/`application/`/`ui/`/`index.ts`) lê o mundo por imports do
  bridge ou por deps injectadas. Verificado por **A8** (`window` como código — pós
  strip de comentários — em qualquer outro ficheiro = falha).
- O resíduo `features/codev.ts` é a excepção explícita: é o monólito a ser
  estrangulado, publica os shims e **não** é governado por A7/A8. Desaparece quando
  os consumidores (app.ts/board.ts) migrarem (passo 6 do ADR: trocar `window.FS`
  por comandos Tauri).

## Segunda feature extraída: Explain · Code review · Under the hood (`ui-app/src/features/codereview/`)

Primeira aplicação do procedimento da skill `extract-feature` a uma segunda
feature (ADR-0002, Fases 0–4 concluídas). Mesmas camadas e mesma regra de
dependências do Co-Dev, em menor escala:

```
features/codereview/
  domain/          types.ts, review.ts (reviewFindings), scoring.ts (severidade/score). PURO.
  application/     ports.ts + review-engine.ts (orquestração Explain/Code-Review/Hood, deps injectadas).
  ui/              actions.ts (1 listener delegado no document: data-action + data-on).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/codereview.ts  RESÍDUO strangler + raiz de composição: compõe o motor com os
                   adaptadores do bridge, é dono do DOM/markup (renderCreviewView/renderHoodView)
                   e re-publica os shims window.* (v6.ts/debug.ts ainda resolvem por global).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). No desktop com pasta, a tab de Code
review junta às regras locais os analisadores reais do projecto (`review_code`, âmbito
`file`, pelo adaptador `infrastructure/tauri.ts`; ADR-0006 R2e2). Nota: ao contrário do Co-Dev,
o markup (`renderCreviewView`/`renderHoodView`) vive no resíduo de composição
`features/codereview.ts`, não num `ui/*-view.ts` — por isso `ui/` só tem
`actions.ts`. A tabela de acções fica no resíduo (único sítio com o bridge à mão).

## Terceira feature extraída: Source Control + motor git (`ui-app/src/features/scm/`)

Terceira aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4
concluídas). Mesmas camadas e regra de dependências:

```
features/scm/
  domain/          types.ts, graph.ts (computeGraphLayout — lanes do DAG),
                   status.ts (statusOf/listChanges), gitflow.ts (isFlow/slug),
                   author.ts (resolveAuthor). PURO.
  application/     ports.ts + scm-engine.ts (makeScmEngine: gitInit/commit[v4]/
                   commitV2/checkout/gitMerge/gfStart/gfFinish/stage/discard, deps
                   injectadas; Date.now/Math.random como clock/ids; `store.repo()` e a
                   porta `flow` — ver abaixo).
  ui/              actions.ts (1 listener delegado: data-action + data-on).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/scm.ts    RESÍDUO strangler + raiz de composição: DONO do estado (GIT/LANE/
                   STAGED/BRANCH/COMMIT_MSG/COMMITS/AUTHOR/GSEL) e do DOM
                   (renderScmPane/gfGuide/gfPrompt/pickBranch/drawTimeline/openGraph);
                   compõe o motor com os adaptadores do bridge e re-publica os shims
                   window.* (app.ts/v5/v6/bridge/pair + VIEW.graph/XC.git/checkpoint
                   ainda resolvem o motor por global).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o codereview, o markup vive
no resíduo de composição `features/scm.ts` e `ui/` só tem `actions.ts`. **Sem git simulado
(ADR-0006, R1d):** `gitInit` dá um modelo VAZIO (sem ramo nem commits); só há repositório
quando `store.repo()` — no desktop `DXR.git` (a pasta aberta é um repo), no browser nunca.
Sem repo, commit/checkout/merge/gitflow recusam com aviso e o pane diz-o (com `git init` no
desktop com pasta); com repo, o motor é o espelho optimista e o git real vem da porta
`desktopPorts.scm` (platform/desktop/git.ts; o `syncGit` reconstrói o DAG do `git log`).
GOTCHA-commit: o botão «Commit» usa o commit v2 (`window.commit`); o Ctrl+Enter e os
auto-commits (board, terminal, agentes) usam o v4 git-aware (`window.commitGit`); no desktop
OS DOIS passam pela porta (commit real), tal como checkout/gitMerge/gfStart/gfFinish. As
acções do pane (commit, ramos, Ctrl+Enter, prompt e fim do gitflow) chamam as versões
PUBLICADAS (A0.5, docs/v2/UI-AUDIT.md: o bug aberto desde f07dbc1 está fechado), e o gitflow do motor (`gfStart`/`gfFinish`)
encadeia checkout/merge pela porta `flow`, ligada às mesmas — nunca às locais. Rede
de segurança em `tests/scm.golden.test.ts` (goldens do pane + caracterização do motor sobre
o histórico da fixture `tests/fixtures/sample-history.ts`, que o harness aplica com
`REPO=true`), `tests/scm.norepo.test.ts` (sem repositório + ligação do gitflow),
`tests/scm.desktop-port.test.ts` (cada entrada do pane consulta a porta desktop) e
`tests/scm.domain.test.ts` (domínio puro).

## Quarta feature extraída: Run and Debug (`ui-app/src/features/debug/`)

Quarta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Mesmas camadas e regra de dependências:

```
features/debug/
  domain/          breakpoints.ts (bpKey/bpLine/bpPath). PURO.
  application/     ports.ts + debug-engine.ts (makeDebugEngine: startDebug/dbgStep/dbgStop/
                   toggleBp, deps injectadas; store/editor/shell/view/notifier).
  ui/              actions.ts (1 listener delegado: data-action + data-on; chave própria).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/debug.ts  RESÍDUO strangler + raiz de composição: DONO do estado (BPS, window-
                   backed) e do DOM (drawDbg/refreshDbg/renderDebugPane); compõe o motor
                   com os adaptadores do bridge, tem a tabela ACTIONS, e re-publica os shims
                   window.* (keydown/menus de v6 + a fachada dbgBreaks que o editor lê).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o scm, o markup vive no
resíduo `features/debug.ts` e `ui/` só tem `actions.ts`. **Depuração real (ADR-0006, R4;
as sessões simuladas saíram na R1c2):** o motor é o gdb do backend (`debug_*`, adaptador
`infrastructure/tauri.ts`). F5 escolhe o programa (num projecto/workspace Cargo, `cargo
build` e o binário em `target/debug/` — `domain/session.ts::cargoTargets`; noutro, o
caminho do executável), lança o gdb, põe os breakpoints do gutter e corre; parado, o pane
mostra onde, as variáveis locais e a pilha, o editor pinta a linha (`dbgCurrent`), e
Continue/Step over (F10)/Step into (F11)/Stop (Shift+F5) seguem para o gdb. Sem gdb, di-lo
(com o que instalar). Os containers `#pane-debug`/`#pc-dbg` nascem no `boot6` (no `app/boot-steps.ts`
desde a U4j5c; o arranque não corre no harness) e são reproduzidos como fixtures no golden.
Rede de segurança em `tests/debug.golden.test.ts` (goldens do pane/assistente sem sessão e
com breakpoints, a sessão real com IPC falso — construir, lançar, breakpoints, parar,
variáveis, passo, fim —, sem gdb, sem binários, erro do gdb, e o dispatch dos breakpoints)
e `tests/debug.domain.test.ts` (domínio puro).

## Quinta feature extraída: backlog, sprints e kanban (`ui-app/src/features/board/`)

Quinta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Mesmas camadas e regra de dependências:

```
features/board/
  domain/          slug.ts (slug), issue.ts (STAGES + fábrica makeIssue),
                   kanban.ts (selectores inView/points/nodeStatus/autoSprint/
                   sprintCounts), types.ts. PURO.
  application/     ports.ts + board-engine.ts (makeBoardEngine: mkIssue/setStage/
                   autoTest/runIssue/delegate/runSprint/approveIssue/rejectIssue/
                   dropIssue/newIssue/openBoard/genBacklog/genBacklogIssues; deps
                   injectadas por 15 portas; handles opacos → toolResult/cardAppend/
                   cardSet — o motor NÃO toca window nem DOM).
  ui/              actions.ts (1 listener delegado: data-action + data-on; chave
                   própria __boardActionHandler__).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/board.ts  RESÍDUO strangler + raiz de composição: DONO do estado (BL/STAGES,
                   window-backed) e do DOM (renderBoardView); compõe o motor com os
                   adaptadores do bridge, tem a tabela ACTIONS, e re-publica os shims
                   window.* (onclick/VIEW.board de v5/v6 + o catálogo/geradores do
                   monólito que FICAM: composeYaml/appFiles/k8s*/cloudMap + TECH/KIND/
                   CLOUD/isApp/sl/appDir, lidos por global — decisão do dono).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o scm/debug, o markup vive no
resíduo e `ui/` só tem `actions.ts`. GOTCHA-decoração: `runIssue`/`delegate`/`runSprint`/
`approveIssue` publicam-se já COMPOSTAS com as políticas que antes eram decorações do
app.ts/v5/v6 (Studio, revisão/explicação, `codeGuard`, dono humano, custo — ADR-0004 U4g3) — as arestas internas e os handlers data-action
resolvem a versão do `window` no acto (`decorated*` do bridge), nunca a função local base.
O `VIEW.board` composto regista-se no board.ts; `renderBoardView` é o corpo base (goldens). Os handlers de ARRASTAR
(`ondragstart`/`ondragover`/`ondragleave`/`ondrop`) ficam inline: não estão em
`STRIPPED_ATTRS`, migrá-los partia o golden. Rede de segurança em
`tests/board.golden.test.ts` (goldens do pane vazio/povoado, caracterização de
genBacklogIssues/mkIssue, testes de dispatch delegado — o «Delegar» com agente falso) e
`tests/board.domain.test.ts` (domínio puro). **Sem runner guionado (ADR-0006, R3a):** correr
uma issue (Delegar, Sprint, ⚡ Agente) é ramo gitflow → o agente real implementa-a (porta
`agent`, `codevAgentStory`, modo plano) → commit do que mudou → os testes do projecto
(`projectTests`) → «Validação funcional» ou volta a desenvolvimento; a porta `scm.settle()`
espera pela fila git/disco do desktop entre os passos. Sem agente, di-lo. Saíram os
produtores `gen`/`fix` (templates dos geradores), os testes-predicado, o router e as pausas
encenadas — e com eles o bug do `sleep(380)` global. O «Gerar backlog» do Studio cria issues
só com o enunciado e o contexto do desenho na nota. **Backlog por pasta (R3b):** no desktop com pasta, o
quadro carrega-se do backend ao abrir a pasta (`board_load`) e grava-se quando muda
(`board_save`, por detecção de mudança com debounce — `board/domain/persist.ts` mapeia
Issue ↔ Story, o que não tem coluna vai em `meta`); no browser fica em memória. **Equipa do
projecto (R3c):** os escopos dos assistentes (onde escrevem, que comandos correm) derivam-se
da estrutura da pasta aberta (`features/team-scopes.ts`, pura) e o `.dxtutor/team.json` do
projecto manda; gravar a equipa escreve-o lá (sem pasta, no LS). O custo das issues vem do uso
real do agente (porta `onUsage` do agente v2 → contador de uso e `ctx`).

## Sexta feature extraída: Visualize execution (`ui-app/src/features/visualizer/`)

Sexta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Um pipeline de compilador de um subconjunto de Rust + um overlay de execução
passo-a-passo. Mesmas camadas e regra de dependências:

```
features/visualizer/
  domain/          lexer.ts (vzLex+vzErr), parser.ts (vzParse→AST {fns}), hints.ts
                   (vzHints), narrate.ts (vzTell+VZSEEN, importa esc do core),
                   samples.ts (VZS), constants.ts (VZSZ/VZR/hex), types.ts. PURO.
                   interpreter.ts (vzRun + modelo de memória) — tipado desde a U4i3 do
                   ADR-0004 (o escalar `v` do valor fica `VzScalar = any`, o único any
                   deliberado). PURO (A7/A8 verdes).
  application/     ports.ts (VisualizePorts {run,narrate,resetSeen}) + visualize.ts
                   (buildVisualization: resetSeen→run→constrói notas; deps injectadas).
  ui/              actions.ts (bindActions: 1 listener delegado; guard no document, não
                   window; chave própria __vizActionHandler__).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/visualizer.ts  RESÍDUO strangler (tipado desde a U4i2 do ADR-0004; FORA da subárvore) + raiz de
                   composição: DONO do overlay (vizOpen/vzRender/vzArrows/vzGo/vzPlay/…)
                   e do boot7 (decora VIEW.lt/VIEW.hood, EACT/MENUS/CMD); importa o motor
                   do domínio e o caso de uso, constrói a TABELA de acções (data-action)
                   e re-publica os shims window.* (boot7/VZ/VZS/viz*/vz* — startup.ts,
                   i18n e onclick inline resolvem por global).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como scm/debug/board, o overlay/markup
vive no resíduo e `ui/` só tem `actions.ts`. Particularidades: (1) o motor é PURO e
auto-suficiente → `application/` não tem porta de infraestrutura (só injecta funções do
domínio); (2) o overlay injecta o seu próprio `#viz` no `document.body` e decora
`VIEW.lt`/`VIEW.hood` (shims do app.ts/registo do codereview) só em `boot7` (não corre no harness) — por
isso o golden caracteriza o overlay via `vizOpen` com fonte explícita, sem fixtures;
(3) `interpreter.ts` usa os bytes de controlo `U+0000`/`U+0001` como sentinelas no `fmt`
(não mexer). Rede de segurança em `tests/visualizer.golden.test.ts`: 14 snapshots (motor
puro vzLex/vzParse/vzHints/vzRun/vzTell + overlay `#viz`) + 6 testes de dispatch delegado
(o golden strippa data-action → não prova o wiring).

## Sétima feature extraída: Infra (`ui-app/src/features/infra/`)

Sétima aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas) e
o ÚLTIMO resíduo @ts-nocheck de feature. Dois motores num só pane: runtime de
contentores / dev-container / Kubernetes + environments / drift / observabilidade.
Decisão do dono: a subárvore nasce INTEIRAMENTE TIPADA (nenhum `@ts-nocheck` novo; A6
fica 8). Mesmas camadas e regra de dependências:

```
features/infra/
  domain/          types.ts, constants.ts (RTN/KCTX/ENVL/DSTY + defaultEnvs/Envx),
                   kubernetes.ts (projectContext/devcontainerJson/appEnv/k8sInfra/k8sDocs),
                   secrets.ts (urlHosts/designApps/dbSlugs/localSecrets/deriveSecrets/
                   secretCheck), environments.ts (envDeps/envStateOf/envHealthOf/
                   driftReport/commitsBetween), observability.ts (seeded/spark/obsLine/
                   buildObs — relógio injectado). PURO e TIPADO; recebe o mundo por arg.
  application/     ports.ts (State/CatalogPort/Workspace/Scm/Persist/Terminal/Nav/
                   Notifier/View/Clock) + infra-engine.ts (makeInfraEngine: orquestração
                   rtConnect/k8sConnect/dcAttach/dxDeploy/k8sScale/k8sDown/promote/
                   redeployEnv/initSecrets/envState/driftReport/… + wrappers dos
                   geradores; deps injectadas; hidratação de LS preguiçosa em closure).
  ui/              actions.ts (1 listener delegado: data-action + data-on; chave própria
                   __infraActionHandler__).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/infra.ts  RESÍDUO strangler (tipado desde a U4i1 do ADR-0004; FORA da subárvore) + raiz de composição:
                   DONO do estado (ENVS/ENVX/K8S/DEVC/OBS window-backed) e do DOM
                   (renderInfraPane base v5+decoração v6 dobradas, renderEnvsView,
                   renderObserveView, drawRemote/infraDraw, cache OBS/polling); compõe o
                   motor com os adaptadores do bridge, tem a tabela ACTIONS, e re-publica
                   os shims window.* (envPrime/envDrift/envDriftStyle; rtConnect/k8sConnect/
                   dxDeploy publicados consultam a porta desktopPorts.infra (U4h4), e dcAttach/dcDetach/
                   k8sScale/k8sDown também (ADR-0006 R5b: sessão devcontainer_session_* e kubectl
                   reais; no browser não fingem); os ambientes staging/production lêem-se e
                   promovem-se pela porta EnvCluster (desktopPorts.infra.cluster, R5c1: kubectl
                   get/apply -f - com os segredos do ambiente) e a observabilidade pela porta
                   ObsSource (desktopPorts.infra.obs, R5c2: stats/compose logs, kubectl top/logs;
                   sem séries semeadas) — ACTIONS chama window.X).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Particularidades: (1) o domínio é
TODO tipado — interfaces locais (Design/TechSpec/KindSpec/K8sState/Secrets/…) no centro,
os `any`/casts das formas opacas do monólito confinam-se ao bridge; (2) o `#pane-infra` nasce no `boot5`
(no `app/boot-steps.ts` desde a U4j5c), que não corre no harness → `infra.golden.test.ts` reproduz esta
fixture (e o antigo shim `RP.infra`) em `provideFixtures()`; (3) o estado window-backed PERSISTE entre testes no
jsdom mas a reavaliação de `infra.ts` reassigna `window.ENVS/ENVX/K8S/…` por `bootApp`;
LS é inoperante em headless (persistência é porta de infra, não se caracteriza). Rede de
segurança em `tests/infra.golden.test.ts` (3 goldens de #pane-infra + caracterização do
motor runtime/K8s/secrets/drift/obs + 6 testes de dispatch delegado) e
`tests/infra.domain.test.ts` (domínio puro, fixture sintética de design+catálogo).

## Oitava feature: painel inferior real (`ui-app/src/features/panel/`)

Não é uma extracção do monólito: é a feature NOVA que, **só na app desktop**, substitui a
demo do painel inferior por dados reais do workspace (sessão `develop-painel-inferior`).
Nasceu tipada e em camadas (governada por A7/A8):

```
features/panel/
  domain/          types.ts, shell-integration.ts (OSC 633/OSC 7), links.ts (ficheiro:linha,
                   URLs), problems.ts (agrupar/filtrar/juntar LSP), naming.ts. PURO.
  application/     ports.ts + terminals.ts (instâncias, grupos de divisão, tarefas com código
                   de saída real, histórico de comandos), problems-service.ts (scan em voo
                   único + debounce), output.ts (canais).
  ui/              terminal-view.ts (xterm.js), problems/output/services/assistant-view.ts,
                   actions.ts (chave __panelActionHandler__).
  infrastructure/  tauri.ts (pty_*, problems_scan, ports_list, eventos) + legacy-bridge.ts
                   (ÚNICO com window: DXR/FS/openPath; publica DXR.term, termOwnsKey,
                   diagnostics/drawProblems/drawStack reais).
  index.ts         raiz de composição; só arranca com `isDesktop()`.
```

Backend: `pty.rs` (várias sessões por id, UTF-8 inteiro entre leituras, código de saída),
`shell_integration.rs` (bash `--init-file` com marcador `PS0`; zsh `ZDOTDIR`), `shellenv.rs`
(ambiente da shell de login, para os checkers verem o node do nvm/cargo do rustup),
`problems.rs` (cargo check/tsc/go vet/ruff/eslint → Problem; eslint segue o script `lint`
do `package.json`), `ports.rs` (`/proc/net/tcp`), `commands/panel.rs`.
Particularidades: (1) não entra no harness de goldens — o caminho do browser/testes continua
a demo e os goldens ficam intactos; a rede é `tests/panel.{domain,application}.test.ts` +
o passo `panel` do auto-teste desktop (`platform/desktop/selftest.ts`: PTY real, /dev/pts,
integração de shell, scan); (2) `runInTerm` (`platform/desktop/terminal.ts`) delega em `DXR.term.runTask` (tarefas num PTY); o terminal de
linha `#term` fica para o terminal partilhado do PairCode; (3) `features/shortcuts.ts` chama
`termOwnsKey(e)` nos atalhos globais — com o foco no xterm, as teclas são da shell excepto
a lista curta de `isAppKey` (estilo `commandsToSkipShell` do VS Code).

## A camada desktop (`ui-app/src/platform/desktop/`, ADR-0004 U4h)

O que só existe na app Tauri (pastas no disco, autosave, terminal e git reais, modelos reais,
docker/kubectl) vive em `platform/desktop/`: `context.ts` (os clientes IPC, o objecto `R` =
`window.DXR`, processos `sh`/`git`/`stream`, a fila `enqueue`/`idle`, e os serviços tardios
`ctx.flushSave`/`ctx.syncGit`/`ctx.envFor`/`ctx.runInTerm`/… que cada módulo preenche) e um
módulo por área com um `install<Área>(ctx)` (terminal, workspace, git, llm, agent-tasks,
infra, remote, ext; o `demos` saiu na R3a do ADR-0006) + `selftest.ts`. O `bridge.ts` é só a composição: sai no browser, cria o
contexto, instala os módulos pela ordem das antigas secções (a ordem dos efeitos no eval
importa) e corre o arranque. Regra ao mexer: um módulo usa os serviços de outro SEMPRE por
`ctx.x(...)` no acto (nunca capturado no install), e nada de nomes soltos que resolvam para
um global por acaso. A U4h1 só mudou o código de sítio; a partir da U4h2 cada decoração
`window.X = …` passa a uma PORTA definida pela feature dona (`application/ports.ts`) e
registada em `app/desktop.ts` (`desktopPorts.<feature>`): o dono consulta-a no acto, nas
versões que publica, e a porta recebe a versão simulada como último argumento. Já migrado:
`scm` (commit/checkout/gitMerge/gfFinish — U4h2), `terminal` (run/termExec/promptHTML — U4h3), `stack` (dxRun/dxStop/drawStack) e `infra`
(rtConnect/k8sConnect/dxDeploy/VIEW.observe) — U4h4, `codev` (updateAgentUI/testProv/provState/
VIEW.settings/runMission) e `board` (runSprint) — U4h5a. O `SAMPLE`/`LIVE_OK` são estado que o
desktop configura (não decorações). `explorer` (syncTree), `welcome` (VIEW.welcome), `changelog`
(clLog/clShow) e `ext` (loadJSZip) — U4h5b. Ficam como CONTRIBUIÇÕES do desktop (não portas):
os itens do menu File, as entradas da paleta e o Ctrl+O — dissolvem-se quando as features
registarem os seus comandos (U7).

## Learning Track + plugins de curso (`ui-app/src/features/learn/`, `crates/tutor-plugins/`)

ADR-0005. Os cursos de linguagem são **plugins** (dados, não código): um repo GitHub com
`dxtutor-plugin.json` + cursos no formato `tutor_core::Course` (TOML/JSON), com
`Course.overview` e `Unit.concepts` (o texto de leitura de cada tópico). Os oficiais vivem em
`github.com/ngolacloud/dxtutor-course-<id>`. O catálogo oficial tem no máximo 10 linguagens
(`learn/domain/catalog.ts`): rust, go, python, typescript, java, kotlin, swift, csharp,
cpp, sql.

- **Fonte única dos cursos Rust/Go: `courses/<id>/`** (plugin oficial completo, publicado em
  `ngolacloud/dxtutor-course-<id>` com `scripts/publish-course.sh`). O `tutor-core` embute o TOML. O JSON
  da UI (`ui-app/src/content/courses/*.json`) é **gerado**: editar só o TOML e correr
  `python3 scripts/sync-ui-courses.py`. O teste `crates/tutor-core/tests/ui_json.rs` falha se
  divergirem.
- A avaliação procura o passo por **(linguagem, id)** (`submit_step` com `language`), porque Rust e
  Go repetem ids de passo. Um plugin com o mesmo id de curso de um embutido substitui-o.
- As 8 linguagens novas (**Python**, **C++**, **TypeScript**, **SQL**, **Java**, **Kotlin**, **C#** e **Swift**, em `courses/<id>/`) estão embutidas só no backend: o browser não traz o JSON. São avaliados
  pelos descritores embutidos em `crates/tutor-eval/src/plugin.rs` (Python com `unittest`; C++ com um mini-framework `TEST`/`CHECK`; TypeScript no Node com `dxt.test`; SQL no SQLite do Python com `query`/`script`; Java no source launcher do JDK 21 com `test(...)`; Kotlin com `kotlinc` e coroutines; C# com o Roslyn do SDK do .NET 8; Swift com `swiftc` em modo Swift 6). As linguagens novas
  seguem a mesma receita: um descritor ou runner, um curso, e `dxt plugin test courses/<id>`
  com 0 falhas antes de commitar.
- `crates/tutor-plugins` — manifesto, validação, origem, instalação e registo. É partilhado
  pelos comandos Tauri `plugin_*` (`commands/plugins.rs`) e pelo `dxt plugin …` (tutor-cli).
- `src-tauri/src/study.rs::all_courses()` — fonte única de cursos (embutidos + plugins, em
  cache pelo mtime do registo). Nunca chamar `tutor_core::builtin_courses()` directamente no
  backend.
- `features/learn/` (governada por A7/A8, tipada): `domain/` (catalog, course-adapter), `application/`
  (CourseGateway + catalog-service), `ui/actions.ts`, `infrastructure/legacy-bridge.ts`. O
  resíduo `features/learn.ts` é dono do DOM e do motor. Rust/Go embutidos continuam com
  avaliação simulada no browser; os cursos do backend usam `submit_step` real.
- Testes: `cargo test -p tutor-plugins`, `ui-app/tests/learn.domain.test.ts`,
  `learn.onboarding.test.ts`. Guia de autoria: `docs/plugins/README.md`.

## Extensões VS Code — contribuições declarativas (ADR-0005, Fase 4)

Não há extension host: o JavaScript de uma extensão nunca corre. O que um VSIX contribui de
forma declarativa é aplicado por código tipado em `features/ext/`, governado por A7/A8.

- **`domain/`:** `jsonc.ts`, `theme.ts` (tema → CSS confinado a `.ed`), `snippets.ts`,
  `textmate.ts` (tokenizador TextMate «lite», sem Oniguruma: traduz as regex para JS e
  ignora as que não compilam) e `contributions.ts` (ficheiros a ler, linguagens, toggle de
  comentário, `KNOWN_LANGUAGE_SERVERS`).
- **`application/contributions-engine.ts`:** lê o VSIX, guarda (LS `vsx-contrib`) e serve ao
  editor. O resíduo `ext.ts` publica `vsxHighlight` (usado pelo `paintEd`), `vsxSnippet`
  (Tab), `vsxToggleComment` (Ctrl+/), `vsxApplyTheme` e `vsxInstallOpenVsx`.
- **`ui/actions.ts`:** listener delegado da `ext` (chave `__extActionHandler__`). Os botões da
  Fase 4 (`vsx-theme`, `vsx-open-vsx`) e, desde a R6b do ADR-0006, as linhas, o detalhe e o «+»
  usam `data-action`.
- **Sem catálogo fixo (ADR-0006, R6b):** instaladas = VSIX reais; recomendadas = ids reais do Open
  VSX pela pilha (`domain/recommend.ts`); a pesquisa vai ao Open VSX (`vsix_search_open_vsx`,
  desktop); instalar descarrega o VSIX. Error Lens/YAML/Prettier eram código do dxtutor: são as
  funcionalidades «Built into dxtutor» (`window.builtinOn(key)`, lido pelo editor e pelos
  diagnósticos); Shift+Alt+F formata sempre.
- **Backend:** `vsix_fetch_open_vsx` e `vsix_search_open_vsx` (só open-vsx.org) e os servidores LSP das linguagens novas
  em `lsp.rs`.
- **Testes:** `ext.contributions.test.ts`, `ext.contrib-engine.test.ts` e
  `ext.phase4-harness.test.ts`. A página de detalhe só muda para itens VSIX, por isso os
  goldens do catálogo ficam intactos.

## Nona feature: Testing real (`ui-app/src/features/testing/`)

Feature NOVA (ADR-0006, R2a) que substitui `features/test.ts`: o pane «Testing» e o
`#st-tests` sobre os comandos reais do backend. Nasceu tipada e em camadas (governada por A7/A8):

```
features/testing/
  domain/          types.ts (TestItem/TestRun/TestState), results.ts (testKey/groupByFile;
                   parseSuiteOutput — estado de cada teste na saída de «Run all»: cargo
                   `test x ... ok|FAILED|ignored`, go `--- PASS|FAIL|SKIP`, unittest -v;
                   statesAfterSuite/countStates/statusBarText). PURO.
  application/     ports.ts (TestsPort/WorkspacePort) + testing-service.ts (descoberta, uma
                   corrida de cada vez, trocar de pasta descarta resultados em voo).
  ui/              testing-view.ts (markup) + actions.ts (chave __testingActionHandler__).
  infrastructure/  tauri.ts (list_tests/run_test/run_all_tests) + legacy-bridge.ts (ÚNICO com
                   window: DXR.root/projectCmd, openPath, runTask, PANE; publica renderTestPane).
  index.ts         raiz de composição; dona do `#st-tests` (o panel/diagnostics já não o limpam).
```

A descoberta do backend cobre Rust/Go/Python; para o resto (p.ex. `npm test`) o pane mostra o
comando de testes detectado e corre-o num terminal de tarefa. Sem pasta (browser), o pane diz
como abrir uma e nada chama o backend. Rede: `tests/testing.{domain,application,wiring}.test.ts`
(o wiring arranca a cadeia real com um `__TAURI__` falso) + o passo `testing` do selftest
desktop (teste Python real: list_tests → run_all_tests → run_test).

## O editor ligado ao servidor de linguagem (`ui-app/src/features/lsp/`)

Feature nova e tipada, só na app desktop (governada por A7/A8). Até aqui a UI oficial nunca
chamava os comandos `lsp_*` (quem os usava era a `ui-next`, apagada em `e2a89b3`).

- **`domain/`:** `languages.ts` (extensão → `languageId`, alinhado com `LANGS` do `lsp.rs`),
  `positions.ts` (offset ↔ `{line, character}` e ponto do rato → offset, com tabs),
  `results.ts` (hover e definição normalizados; `plainMarkdown` limpa o markdown do servidor),
  `paths.ts` (chave do `FS` ↔ caminho absoluto). PURO.
- **`application/lsp-client.ts`:** `lsp_start` uma vez por pasta, `didOpen` uma vez por
  ficheiro (bus `editor:tab`), `didChange` com versões (bus `workspace:changed`), hover,
  definição, e repinta o editor quando chegam diagnósticos do ficheiro aberto.
- **`ui/editor-hooks.ts`:** rato parado → cartão `#lsp-hover`; F12 ou Ctrl+clique → definição;
  Shift+F12 → lista de referências; F2 → caixa de rename (`ui/popups.ts`: `#lsp-refs`,
  `#lsp-rename`). Listeners delegados no `document`, sem mexer no `editor.ts`; não publica globais.
- **Completion** (`domain/completion.ts`, `ui/completion-hooks.ts` + `ui/completion-view.ts`, comando
  `lsp_completion`): Ctrl+Espaço, depois de `.` ou com 2+ letras de um nome; ↑/↓, Enter/Tab, Esc
  apanhados na fase de captura (antes do Tab do editor). Aceitar expande o snippet e aplica os
  `additionalTextEdits`. Filtro: prefixo, depois início de palavra (camelCase), sem repetidos.
- **Sincronização:** antes de QUALQUER pedido o cliente envia o texto actual (`didChange`), se mudou
  — o `didChange` normal só sai 180 ms depois da última tecla. Um rename que volta `null` (o jdtls
  logo após uma edição) é perguntado mais duas vezes.
- **Rename:** o cliente aplica a `WorkspaceEdit` (`changes` ou `documentChanges`; `domain/edits.ts`)
  aos ficheiros da pasta pelo `writeFile` (o autosave leva-as ao disco), envia `didChange` dos que o
  servidor tem abertos e conta o que salta (fora da pasta, operações de ficheiro).
- **Servidor em falta:** sem servidor instalado o backend não abre sessão nem dá erro; o cliente
  pergunta `lsp_server_status` (uma vez por linguagem) e o editor mostra uma faixa
  (`#lsp-missing`, `domain/server-status.ts`) com o servidor que falta e como o instalar, reposta
  a cada desenho da vista pelo evento `editor:file-view` do bus; «Dismiss» fecha-a para essa
  linguagem na sessão.
- Os diagnósticos já chegavam ao Problems e ao gutter pelo `features/panel`. O backend usa a pasta
  aberta como raiz de reserva de um ficheiro sem marcador de projecto (o SQL não tem nenhum).
- **Testes:** `lsp.domain.test.ts`, `lsp.client.test.ts`, `lsp.editor-hooks.test.ts`, e o passo
  `lsp-java`/`lsp-kotlin` do auto-teste desktop (`DXTUTOR_SELFTEST`, Xvfb), que conduz o editor real.
  GOTCHA: o backend procura o `jdtls` no PATH e em `$HOME/.local/share/jdtls/bin`; sem servidor não
  abre sessão (sem erro). Correndo o auto-teste com um HOME temporário, põe essa pasta no PATH
  (`PATH="$HOME/.local/share/jdtls/bin:$PATH" HOME=/tmp/… DXTUTOR_SELFTEST=…`) — senão o passo
  `lsp-java` diz que o servidor não foi encontrado (e verifica que o editor mostra o aviso).

### O golden é a rede de segurança — nunca o actualizes para passar

`ui-app/tests/codev.golden.test.ts`, `codereview.golden.test.ts`,
`scm.golden.test.ts`, `debug.golden.test.ts`, `board.golden.test.ts`,
`visualizer.golden.test.ts` e `infra.golden.test.ts` comparam o markup renderizado contra snapshots (`__snapshots__/`). O harness (`ui-app/tests/harness.ts`) **strippa exactamente**
`onclick`/`onchange`/`oninput`/`data-action`/`data-on` antes de comparar — logo
todo o payload de uma acção viaja em `data-on` (um `data-*` à medida vazaria para o
snapshot e partia-o). Um diff de golden = **o código mudou de comportamento visual**:
corrige o código, não o snapshot. Só se regenera um golden com decisão deliberada e
registada (mudança de UI aprovada), nunca para «fazer passar».

## Regras ao mexer aqui

1. **UI e comportamento congelados** em todo o trabalho de refactor: zero diff de
   golden, zero mudança de markup, não mover lógica para Rust (fica para sessão
   própria), não renomear comandos públicos, não actualizar dependências.
2. **Cada commit deixa a app corrível.** Sem big-bang; estrangula a feature por fases.
3. Bugs encontrados **reportam-se**, não se corrigem dentro do refactor.
4. Antes de commitar refactor não-trivial: `ui:build` + `ui:test` + `arch:check`
   verdes. Ver as skills `extract-feature`, `add-port-adapter`, `ui-golden-check`.

## Referências

- `docs/architecture/ADR-0002-codev-clean-architecture.md` — a decisão e as 6 fases.
- `docs/architecture/ADR-0005-learning-track-plugins.md` — plugins de curso, 10 linguagens, VS Code.
- `docs/architecture/ADR-0006-ide-real.md` — o fim dos dados de demonstração e cada feature no backend real (R0–R6).
- `docs/plugins/README.md` — guia para quem escreve cursos (em inglês, para contribuidores).
- `docs/architecture/ARCHITECTURE.md` — visão geral; §6 (CSP) liga a migração dos
  `onclick` inline ao endurecimento de `script-src 'unsafe-inline'`.
- `docs/architecture/IPC-MATRIX.md` / `MIGRATION.md` — backend (comandos Tauri).
- Contratos de sessão em `.claude/sessions/` (ver protocolo de sessão).
