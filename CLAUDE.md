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

- **A1–A3** — os 133 comandos Tauri registados em `generate_handler!` batem certo
  com os `#[tauri::command]` por ficheiro e com a matriz `docs/architecture/IPC-MATRIX.md` (1:1).
- **A4–A5** — a cadeia de build aponta para a UI oficial única (`../ui-app/dist`);
  nenhuma config referencia `ui/` ou `ui-next/`. **Nunca** trocar `frontendDist`
  para `ui-next`.
- **A6** — baseline de `@ts-nocheck` (**directiva** `// @ts-nocheck`, não a palavra
  em prosa): 11 ficheiros, não pode crescer. Features novas nascem tipadas.
- **A7–A8** — fronteiras da Clean Architecture das features extraídas (abaixo).
  A var `FEATURES` do `arch-check.sh` lista quais governam (hoje `codev`, `ext`,
  `codereview`, `scm`, `debug`, `board`, `visualizer`, `infra` e `learn`); cada nova extracção
  acrescenta-se lá. Nota: desde a `visualizer`, A6 = 8 (o interpretador `vzRun` é
  o único `@ts-nocheck` dentro de uma subárvore — ver abaixo). A `infra` nasceu com a
  subárvore inteiramente TIPADA (decisão do dono): nenhum `@ts-nocheck` novo, A6 fica 8.

## Arquitectura da feature Co-Dev (`ui-app/src/features/codev/`)

Piloto de Clean Architecture (ADR-0002). A feature está extraída do monólito
(`app.ts`/`v5.ts`/`v6.ts`) em camadas com fronteiras tipadas e verificadas:

```
features/codev/
  domain/          tipos, policy (approvalFor), scoring, scenarios/.
                   PURO: sem DOM, sem window, sem Tauri, sem importar de fora.
  application/     casos de uso: ports.ts + run-mission / live-chat / tool-executor.
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

Governada pelas mesmas A7/A8 (está em `FEATURES`). Nota: ao contrário do Co-Dev,
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
                   injectadas; Date.now/Math.random como clock/ids).
  ui/              actions.ts (1 listener delegado: data-action + data-on).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/scm.ts    RESÍDUO strangler + raiz de composição: DONO do estado (GIT/LANE/
                   STAGED/BRANCH/COMMIT_MSG/COMMITS/BRANCHES/AUTHOR/GSEL) e do DOM
                   (renderScmPane/gfGuide/gfPrompt/pickBranch/drawTimeline/openGraph);
                   compõe o motor com os adaptadores do bridge e re-publica os shims
                   window.* (app.ts/v5/v6/bridge/pair + VIEW.graph/XC.git/checkpoint
                   ainda resolvem o motor por global).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o codereview, o markup vive
no resíduo de composição `features/scm.ts` e `ui/` só tem `actions.ts`. GOTCHA-commit:
o botão «Commit» usa o commit v2 (`window.commit`, só FS+COMMITS); o Ctrl+Enter e os
auto-commits do monólito usam o v4 git-aware (`window.commitGit`). Rede de segurança
em `tests/scm.golden.test.ts` (goldens do pane + caracterização do motor) e
`tests/scm.domain.test.ts` (domínio puro).

## Quarta feature extraída: Run and Debug (`ui-app/src/features/debug/`)

Quarta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Mesmas camadas e regra de dependências:

```
features/debug/
  domain/          types.ts, lexer-trace.ts (buildLexTrace — passos da sessão code),
                   crash-trace.ts (buildCrashTrace — sondas da sessão ops; importa `esc`
                   puro de core), launch.ts (buildLaunchConfigs), breakpoints.ts
                   (bpKey/bpLine/bpPath). PURO (geradores recebem o mundo por argumento).
  application/     ports.ts + debug-engine.ts (makeDebugEngine: startDebug/dbgFeed/
                   dbgApplyClone/dbgStep/dbgContinue/dbgFinish/dbgStop/dbgFix/toggleBp,
                   deps injectadas; store/workspace/lexer/scenarios/editor/shell/view/…).
  ui/              actions.ts (1 listener delegado: data-action + data-on; chave própria).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/debug.ts  RESÍDUO strangler + raiz de composição: DONO do estado (DBG/BPS,
                   window-backed) e do DOM (DBGK/drawDbg/refreshDbg/renderDebugPane);
                   compõe o motor com os adaptadores do bridge + as funções de desenho
                   (porta view), tem a tabela ACTIONS, e re-publica os shims window.*
                   (onclick/keydown/menus de v6 + fachadas dbgState/dbgBreaks/dbgLaunch).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o scm, o markup vive no
resíduo `features/debug.ts` e `ui/` só tem `actions.ts`. Particularidades: a sessão
`DBG` é polimórfica (`pre`/`code`/`ops`) — tipada por união + casts por `kind`; os
helpers de lexer (`lexVariant`/`LXL`) e os containers `#pane-debug`/`#pc-dbg` vivem em
`v6.ts`/`boot6` (fora da cadeia do harness) e são reproduzidos como fixtures no golden.
Rede de segurança em `tests/debug.golden.test.ts` (goldens de #pane-debug/#pc-dbg nos
estados sem-sessão/pre/code, caracterização dos geradores, e 4 testes de dispatch
delegado que disparam eventos reais — o golden strippa data-action, não prova o wiring)
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
`approveIssue` são DECORADAS em runtime pelo monólito (app.ts/v5/v6) — as arestas internas
e os handlers data-action resolvem a versão DECORADA por `window` no acto
(`decorated*` do bridge), nunca a função local base. Os handlers de ARRASTAR
(`ondragstart`/`ondragover`/`ondragleave`/`ondrop`) ficam inline: não estão em
`STRIPPED_ATTRS`, migrá-los partia o golden. Rede de segurança em
`tests/board.golden.test.ts` (goldens do pane vazio/povoado, caracterização de
genBacklogIssues/mkIssue, 3 testes de dispatch delegado) e `tests/board.domain.test.ts`
(domínio puro). **BUG pré-existente reportado (não corrigido no refactor): `autoTest`
chama `sleep(380)` como global, mas `sleep` nunca é publicado no `window` (é `const` local
em `codev/ui/chat-view.ts`) → o runner lança ao entrar em Teste. Preservado tal e qual.**

## Sexta feature extraída: Visualize execution (`ui-app/src/features/visualizer/`)

Sexta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Um pipeline de compilador de um subconjunto de Rust + um overlay de execução
passo-a-passo. Mesmas camadas e regra de dependências:

```
features/visualizer/
  domain/          lexer.ts (vzLex+vzErr), parser.ts (vzParse→AST {fns}), hints.ts
                   (vzHints), narrate.ts (vzTell+VZSEEN, importa esc do core),
                   samples.ts (VZS), constants.ts (VZSZ/VZR/hex), types.ts. PURO.
                   interpreter.ts (vzRun + modelo de memória) — ÚNICO @ts-nocheck da
                   subárvore (decisão do dono: AST polimórfico + objectos-valor densos;
                   tipagem fica p/ passagem futura). É PURO à mesma (A7/A8 verdes).
  application/     ports.ts (VisualizePorts {run,narrate,resetSeen}) + visualize.ts
                   (buildVisualization: resetSeen→run→constrói notas; deps injectadas).
  ui/              actions.ts (bindActions: 1 listener delegado; guard no document, não
                   window; chave própria __vizActionHandler__).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/visualizer.ts  RESÍDUO strangler (@ts-nocheck, FORA da subárvore) + raiz de
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
`VIEW.lt`/`VIEW.hood` (definidas no v6.ts) só em `boot7` (não corre no harness) — por
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
features/infra.ts  RESÍDUO strangler (@ts-nocheck, FORA da subárvore) + raiz de composição:
                   DONO do estado (ENVS/ENVX/K8S/DEVC/OBS window-backed) e do DOM
                   (renderInfraPane base v5+decoração v6 dobradas, renderEnvsView,
                   renderObserveView, drawRemote/infraDraw, cache OBS/polling); compõe o
                   motor com os adaptadores do bridge, tem a tabela ACTIONS, e re-publica
                   os shims window.* (envPrime/envDrift/envDriftStyle; rtConnect/k8sConnect/
                   dxDeploy são reatribuídos por bridge.ts/v5/v6 — ACTIONS chama window.X).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Particularidades: (1) o domínio é
TODO tipado — interfaces locais (Design/TechSpec/KindSpec/K8sState/Secrets/…) no centro,
os `any`/casts das formas opacas do monólito confinam-se ao bridge; (2) o harness exclui
v5.ts (`#pane-infra` de `boot5`) e v6.ts (`RP.infra`) → `infra.golden.test.ts` reproduz
estas fixtures em `provideFixtures()`; (3) o estado window-backed PERSISTE entre testes no
jsdom mas a reavaliação de `infra.ts` reassigna `window.ENVS/ENVX/K8S/…` por `bootApp`;
LS é inoperante em headless (persistência é porta de infra, não se caracteriza). Rede de
segurança em `tests/infra.golden.test.ts` (3 goldens de #pane-infra + caracterização do
motor runtime/K8s/secrets/drift/obs + 6 testes de dispatch delegado) e
`tests/infra.domain.test.ts` (domínio puro, fixture sintética de design+catálogo).

## Learning Track + plugins de curso (`ui-app/src/features/learn/`, `crates/tutor-plugins/`)

ADR-0004. Os cursos de linguagem são **plugins** (dados, não código): um repo GitHub com
`dxtutor-plugin.json` + cursos no formato `tutor_core::Course` (TOML/JSON), com
`Course.overview` e `Unit.concepts` (o texto de leitura de cada tópico). Os oficiais vivem em
`github.com/dxtutor-courses/<id>`. O catálogo oficial tem no máximo 10 linguagens
(`learn/domain/catalog.ts`): rust, go, python, typescript, java, kotlin, swift, csharp,
cpp, sql.

- **Fonte única dos cursos Rust/Go: `courses/<id>/`** (plugin oficial completo, publicado em
  `dxtutor-courses/<id>` com `scripts/publish-course.sh`). O `tutor-core` embute o TOML. O JSON
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

## Extensões VS Code — contribuições declarativas (ADR-0004, Fase 4)

Não há extension host: o JavaScript de uma extensão nunca corre. O que um VSIX contribui de
forma declarativa é aplicado por código tipado em `features/ext/`, governado por A7/A8.

- **`domain/`:** `jsonc.ts`, `theme.ts` (tema → CSS confinado a `.ed`), `snippets.ts`,
  `textmate.ts` (tokenizador TextMate «lite», sem Oniguruma: traduz as regex para JS e
  ignora as que não compilam) e `contributions.ts` (ficheiros a ler, linguagens, toggle de
  comentário, `KNOWN_LANGUAGE_SERVERS`).
- **`application/contributions-engine.ts`:** lê o VSIX, guarda (LS `vsx-contrib`) e serve ao
  editor. O resíduo `ext.ts` publica `vsxHighlight` (usado pelo `paintEd`), `vsxSnippet`
  (Tab), `vsxToggleComment` (Ctrl+/), `vsxApplyTheme` e `vsxInstallOpenVsx`.
- **Backend:** `vsix_fetch_open_vsx` (só open-vsx.org) e os servidores LSP das linguagens novas
  em `lsp.rs`.
- **Testes:** `ext.contributions.test.ts`, `ext.contrib-engine.test.ts` e
  `ext.phase4-harness.test.ts`. A página de detalhe só muda para itens VSIX, por isso os
  goldens do catálogo ficam intactos.

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
- `docs/architecture/ADR-0004-learning-track-plugins.md` — plugins de curso, 10 linguagens, VS Code.
- `docs/plugins/README.md` — guia para quem escreve cursos (em inglês, para contribuidores).
- `docs/architecture/ARCHITECTURE.md` — visão geral; §6 (CSP) liga a migração dos
  `onclick` inline ao endurecimento de `script-src 'unsafe-inline'`.
- `docs/architecture/IPC-MATRIX.md` / `MIGRATION.md` — backend (comandos Tauri).
- Contratos de sessão em `.claude/sessions/` (ver protocolo de sessão).
