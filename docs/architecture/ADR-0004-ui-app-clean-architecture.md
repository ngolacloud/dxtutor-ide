# ADR-0004 — Migração da ui-app para Clean Architecture (Etapa 4 do MIGRATION)

- **Estado:** aceite (recomendações do §9 aceites a 2026-11-23); U0–U3 feitas, U4 em curso (U4a–U4f, U4g1–U4g5)
- **Data:** 2026-11-23
- **Decisor:** responsável do projecto
- **Relacionado:** `MIGRATION.md` §6–§7 (Etapa 4 «UI»: estado por proprietário, bootstrap,
  serviços, fim de globais/substituições, tipagem; e partes das Etapas 5–6),
  `ARCHITECTURE.md` §2/§5/§6, `ADR-0002` (o padrão das features extraídas), passo 8 do
  roadmap da auditoria de 2026-11-23.

## 1. Objectivo

Uma `ui-app` com um ponto de entrada (`main.ts`) que compõe estado e serviços e arranca
uma vez; features que se importam umas às outras em vez de se resolverem pelo `window`;
o acesso ao desktop (Tauri) atrás de um adaptador tipado injectado; e nenhum ficheiro
`@ts-nocheck`. **UI e comportamento congelados** durante toda a migração: zero diff de
golden, os mesmos fluxos, sem dependência da ordem das tags no HTML.

## 2. Ponto de partida (medido no HEAD de 2026-11-23)

| Dimensão | Valor |
|---|---|
| Tags `<script type="module">` no `index.html` | **43**, por ordem de dependência implícita |
| Monólito restante | `bridge.ts` 78 KB · `app.ts` 64 KB · `pair.ts` 58 KB · `boot.ts` 40 KB · `v6.ts` 22 KB · `v5.ts` 13 KB |
| `@ts-nocheck` | **8** (`app`, `boot`, `v5`, `v6`, `startup`, `features/infra.ts`, `features/visualizer.ts`, `visualizer/domain/interpreter.ts`) |
| Globais | 199 atribuições `window.X =`; 40 `Object.assign(window, …)`; ~210 leituras `window.*` no monólito |
| Substituições em runtime | 31 decorações `const _x = x; x = …` (11 no `bridge.ts`), mais o `bootN`/`v5`/`v6` |
| Handlers inline | 165 atributos ` on*="…"` (HTML gerado + `index.html`) contra 164 `data-action` |
| IPC | 44 chamadas `inv("…")` cruas (`bridge.ts`/`pair.ts`); 19 comandos já por `platform/tauri/` tipado |
| CSP | `script-src 'self' 'unsafe-inline'` (precisa dos handlers inline) |
| Estilos / i18n | `styles.css` monolítico (954 linhas); i18n por correspondência de texto (≈940 pares) |
| Features já em camadas | `codev`, `codereview`, `scm`, `debug`, `board`, `visualizer`, `infra`, `ext` (+ `panel`, em curso noutra sessão) |

## 3. Princípios

1. **Estrangulamento por fases, cada commit corrível** (como o ADR-0002): nada de big-bang.
2. **A rede de segurança vem primeiro:** os goldens que já existem + um teste de arranque
   da app inteira (browser real, sem erros de página, painéis principais desenhados).
3. **A regra de dependências das features mantém-se** (A7/A8) e alarga-se ao resto:
   `window` só em adaptadores (`infrastructure/legacy-bridge.ts`, `platform/`), contados
   pelo `arch-check`.
4. **Fachadas window-backed durante a transição:** cada proprietário de estado nasce com
   getters/setters que ainda lêem o `window`, para os consumidores antigos continuarem a
   funcionar enquanto migram — o mesmo truque do `monolith` dos legacy-bridges.
5. **Métricas que só descem**, verificadas no `arch:check`: tags `<script>`, `@ts-nocheck`,
   `window.X =`, `on*=` inline.

## 4. Fases

| Fase | Entrega | Critério de saída |
|---|---|---|
| **U0 — Rede de segurança** | Teste de arranque com Playwright sobre o `dist` (sem erros de página; explorer, editor, Co-Dev, painel, SCM desenhados; screenshots de referência) e o mesmo no CI; métricas novas no `arch-check` (baseline actual, só podem descer) | CI verde com as métricas registadas |
| **U1 — Um grafo de imports** | `src/main.ts` importa os 43 módulos **pela mesma ordem** (a avaliação de ES modules é em profundidade e pela ordem dos imports — semântica idêntica); `index.html` fica com uma só tag; o harness dos goldens importa o `main.ts` | 1 tag; goldens sem diff; arranque igual |
| **U2 — Clientes IPC tipados** | As chamadas `inv("…")` cruas passam a clientes `platform/tauri/*` sobre um `Invoker` injectável | 0 `inv` cru fora de `platform/` *(feito — ver §10, U2a; a parte desktop das features passou para a U4, decisão de 2026-11-23)* |
| **U3 — Estado por proprietário + event bus** | `app/store/` com proprietários tipados — workspace (FS, árvore, raiz), editor (tabs, activa), agente (modo, provedor, chat), git, terminal, aprendizagem, colaboração — e um bus de eventos tipado (`files:changed`, `tab:activated`, `mode:changed`…) que substitui os `refresh()`/`badges()` globais | Os 17 globais de estado com dono; consumidores migrados por feature |
| **U4 — Absorver o monólito** | `boot`/`app`/`v5`/`v6`/`startup` dissolvem-se nas features donas (menus, actividade, painéis, atalhos); as decorações em runtime viram composição explícita no `main.ts`; **a parte desktop de cada feature** (as ~30 funções que o `bridge.ts` substitui — `commit`/`checkout`/`gitMerge`, `termExec`/`run`, `refresh`/`syncTree`, `dxRun`/`rtConnect`/`k8sConnect`, `updateAgentUI`, as vistas Settings/Observe/Welcome… — e o objecto `DXR`) passa a um adaptador `platform/desktop/<feature>` injectado na feature quando ela absorve as suas funções; `infra`/`visualizer` tipados | **0 `@ts-nocheck`**; nenhuma decoração em runtime; `bridge.ts` reduzido à composição desktop |
| **U5 — Handlers e CSP** | Os 165 `on*=` inline passam a `data-action` com listener delegado por feature; depois tira-se o `'unsafe-inline'` do `script-src` | 0 `on*=`; CSP sem `unsafe-inline` nos scripts |
| **U6 — i18n por chaves e CSS por feature** | Textos com chave (`t("codev.composer.placeholder")`) e catálogos `pt-AO`/`en`, com o motor de correspondência como recurso durante a transição; `styles.css` partido em `features/*/styles.css` importados pela feature (tokens globais num `theme.css`) | Sem pares de texto novos; CSS da feature junto da feature |
| **U7 — Consolidação** | Fim das fachadas window-backed e dos shims `Object.assign(window, …)` restantes; regras finais no `arch-check`; `MIGRATION.md`/`ARCHITECTURE.md` actualizados | Métricas no alvo; docs coerentes |

Ordem e paralelismo: U0 → U1 → U2 → U3 → U4 → U5 → U6 → U7. U6 (i18n/CSS) não depende
das outras e pode adiantar-se se for útil.

## 5. Métricas-alvo (`scripts/ui-metrics.sh`, corre no `npm run arch:check`)

| Métrica | Hoje | Alvo |
|---|---|---|
| `<script>` no `index.html` | 43 | 1 |
| `@ts-nocheck` | 8 | 0 |
| `window.X =` | 199 | 0 (fora de adaptadores) |
| `Object.assign(window, …)` | 40 | 0 |
| atributos ` on*="…"` inline | 165 | 0 |
| `inv("…")` cru | 44 | 0 |
| `script-src 'unsafe-inline'` | sim | não |

## 6. Testes

- Goldens existentes (8 features) — zero diff em todas as fases; regenerar só com mudança
  de UI aprovada.
- U0: arranque em browser real (Playwright, como o que já usei nas verificações do Co-Dev)
  + no desktop (Xvfb, o binário real).
- Cada proprietário de estado e o bus com testes unitários; cada feature migrada mantém os
  seus testes de dispatch delegado.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Ordem de avaliação muda ao passar para imports (U1) | Mesma ordem que as tags; teste de arranque + goldens; os módulos com efeitos de topo ficam iguais |
| Trabalho concorrente noutras sessões nos mesmos ficheiros (`bridge.ts`, `app.ts`, `v6.ts`, `index.html`, `styles.css` — hoje a feature `panel`) | Fases curtas, commits pequenos, rebase antes de cada fase; não começar U1/U2/U4 com essa sessão a meio (§9) |
| Fachadas window-backed eternizam-se | U7 tem critério de saída: zero fachadas |
| i18n por chaves é muito texto (≈940 pares) | Migração por feature, com o motor actual como recurso; nenhum par novo a partir da U6 |

## 8. Estimativa

U0–U1: uma sessão. U2 e U3: uma a duas cada. U4: duas a três (o grosso do monólito). U5,
U6: uma a duas cada. U7: uma. Cada fase fecha com commit próprio e verificação completa.

## 9. Decisões (aceites a 2026-11-23)

1. **Coordenação com a sessão da feature `panel`**, que está a mexer agora no `index.html`,
   `bridge.ts`, `app.ts`, `v6.ts` e `styles.css`. *Recomendado:* esperar que essa feature
   seja commitada antes da U1/U2/U4; até lá avanço com o que não colide — a U0 (rede de
   segurança, só ficheiros novos e o CI) e a fundação da U3 (`app/store/` e o bus, ficheiros
   novos, sem migrar consumidores).
2. **i18n por chaves (U6):** migrar tudo para chaves *(recomendado: sim, por feature, com o
   motor de texto como recurso até ao fim)* ou manter a correspondência de texto.
3. **CSP (U5):** tirar o `'unsafe-inline'` também do `style-src` *(recomendado: não nesta
   migração — há `style="…"` gerado em muitos sítios; fica para depois)*.

## 10. Notas de execução

- **U0 (2026-11-23).** Teste de arranque em browser real: `ui-app/e2e/boot.e2e.ts`
  (Playwright 1.62.0, fixado; `npm run ui:e2e` sobre o `dist` servido pelo `vite preview`)
  — a app arranca sem erros de página nem `console.error`, os globais de que o resto depende
  existem, cada painel da barra de actividade abre, o painel inferior, a paleta e os
  popovers do compositor do Co-Dev respondem; screenshot do arranque guardado. No CI corre
  no job `ui` (relatório e traces como artefacto quando falha). Métricas da migração em
  `scripts/ui-metrics.sh` (também no `npm run arch:check`), com baseline medido no HEAD
  `3ea370d` e que só pode descer: 43 tags · 8 `@ts-nocheck` · 199 `window.X =` · 40
  `Object.assign(window, …)` · 165 handlers inline · 44 `inv("…")` crus. Os números do §2
  foram corrigidos para estas definições exactas (a primeira medição usou um `grep` com
  filtro de ficheiros ignorados que escondia o `interpreter.ts`). A feature `panel`, que
  bloqueava a U1/U2/U4 (decisão §9.1), foi commitada em `3ea370d`.

- **U1 (2026-11-23).** `ui-app/src/main.ts` importa os 43 módulos pela ordem exacta das
  antigas tags e o `index.html` fica com uma só (`<script type="module" src="/src/main.ts">`).
  A avaliação de módulos ES é em profundidade e pela ordem dos imports, por isso a
  semântica de arranque é a mesma; a única diferença — uma excepção no topo de um módulo
  passa a interromper os seguintes — está coberta pelo teste de arranque. O harness dos
  goldens lê a ordem do `main.ts` (deixou de ter uma cópia da lista). Verificado: 320
  testes (goldens sem diff), arranque no browser 3/3, e a app desktop real no Xvfb (bridge
  Tauri, explorador real, painel com o terminal do SO). Métrica: tags 43 → 1.

- **U2a (2026-11-23) — clientes IPC tipados.** As 43 chamadas `inv("…")` cruas do
  `bridge.ts` (31) e do `pair.ts` (10) passam a clientes de `platform/tauri/` por domínio —
  `shell` (exec, shell interactiva), `fs`, `git`, `providers` (config, lista, `llm_chat`,
  chat em streaming), `agent-tasks`, `app` (info, auto-teste) e `pair` —, cada um construído
  sobre um `Invoker` injectável (`core.ts`): o `bridge.ts` usa o `invoke` real e o `pair.ts`
  o seu (que pode ser a simulação do PairCode). Tipos de retorno fiéis ao backend
  (`ExecOut`, `GitCommit`, `GitChange`, `ProvidersConfig`, `ChatResp`, `AgentTask`…), em vez
  dos casts `as X` espalhados. Onde o `inv` cru aceitava `null` (raiz por definir, `R.proc`,
  token), o valor passado em runtime é o mesmo (cast explícito, sem mudança de
  comportamento). Verificado com o **auto-teste desktop** (`DXTUTOR_SELFTEST`, Xvfb): os 23
  passos dão resultados idênticos com e sem a U2a, sem erros. Métrica `inv` cru fora de
  `platform/`: 43 → 0 (a contagem passou a excluir `platform/`, que é onde os clientes vivem).
  IPC-MATRIX: o consumidor destes 25 comandos passa a ser o cliente tipado. **Falta (U2b):**
  o objecto `DXR` e as 11 substituições do `bridge.ts` para um `platform/desktop/` com portas
  injectadas pelo `main.ts`.

- **Replaneamento da U2 (2026-11-23, decisão do dono).** Ao mapear o `bridge.ts` para a
  U2b, as «11 substituições» são na verdade ~30 funções do monólito substituídas em runtime
  (mais as vistas Settings/Observe/Welcome). Só podem virar portas injectadas quando as
  features donas saírem do monólito — por isso a U2 fecha com a U2a e a parte desktop de
  cada feature passa para a U4 (adaptador `platform/desktop/<feature>` injectado quando a
  feature absorve as suas funções). Segue-se a U3.

- **U3a (2026-11-23) — bus e proprietários de estado.** `app/bus.ts`: bus de eventos
  tipado (`AppEvents`), síncrono, por ordem de subscrição, com isolamento de erros (um
  handler que lança não pára os outros). `app/store/`: os primeiros donos — `agentStore`
  (modo, limiar, provedor activo, contexto do editor, assistente), `layoutStore` (painel,
  tema, língua) e `editorStore` (separador activo). Cada dono guarda o valor e publica a
  global no window como **acessor** (`ownedGlobal`): as escritas do monólito
  (`window.MODE = …`, `cur = id`) passam pelo dono e emitem `agent:mode`, `editor:tab`,
  `layout:pane`… — os 30+ ficheiros que usam este estado passam a gerar eventos sem
  mudarem. O `main.ts` importa `app/store` primeiro; o `S` do `core.ts` e o legacy-bridge
  do Co-Dev delegam nos donos (`window.X =`: 199 → 194). Os acessores são shims de
  transição, contados como métrica informativa (9; alvo 0 na U7). Verificado: 328 testes
  (goldens sem diff), arranque no browser, e o auto-teste desktop idêntico (23 passos).
  **A seguir (U3b):** consumidores a subscrever o bus em vez de se chamarem por globais
  (`updateAgentUI`, `refresh`, `badges`), e os donos das colecções (`FS`, `TABS`, `CHAT`,
  `RUN`, `PROV`).

- **U3b (2026-11-23) — primeiros consumidores do bus.** O Co-Dev subscreve
  `agent:mode` (avisa a sessão do agente v2 e redesenha a UI), `agent:provider`
  (redesenha), `agent:context` e `editor:tab` (chip de contexto) — e deixa de depender de
  cada sítio que muda esse estado chamar `updateAgentUI`/`ctxPill`: o `setMode`, o
  `pickModel` e o `toggleCtx` do compositor perderam essas chamadas. Qualquer escritor —
  modebar, compositor, paleta, Definições, harness do projecto, o `loadCfg` do arranque, ou
  uma escrita directa no window — actualiza a barra de estado, o compositor e o chip.
  Testes: integração com o harness real (escritas pelo window → UI actualizada) e um
  arranque no browser com a configuração restaurada do `localStorage` (os eventos saem
  durante o arranque, sem erros). Auto-teste desktop idêntico. Nota: um `auto` guardado
  volta a `assist` no arranque — é o tecto do harness do projecto (v5), não a U3.

- **U3c (2026-11-23) — colecções com dono e os decoradores do `refresh` como subscritores.**
  Novos donos: `workspaceStore` (`FS`, `ROOT`, `OPEN`) e, no `agentStore`, `PROV`, `CHAT`,
  `RUN` — o app.ts continua a criá-los e o acessor adopta o mesmo objecto (sem cópia).
  Eventos novos: `workspace:changed` (emitido no fim do `refresh()` — o sinal de facto de
  «o workspace mudou», já que quase todas as mutações de `FS` acabam nele), `agent:run`
  (`runState`) e `agent:providers` (modelo/ligado de um provedor). O `refresh` era decorado
  três vezes (grafo/board/blame no app.ts, autosave no bridge.ts, sync do PairCode no
  pair.ts): os três viraram subscritores, pela mesma ordem (a de avaliação dos módulos), e
  um erro num deles já não cancela os outros. O compositor subscreve `agent:run` (o
  `chat-view` deixou de o chamar) e o Co-Dev `agent:providers` (o `toggleProv`, o seletor
  de modelo e o campo das Definições deixaram de chamar `updateAgentUI`). Ficam para a U4,
  com o app.ts: `TB` (os separadores — um `let` reatribuído, não adoptável por referência)
  e `USAGE` (*correcção na U4f: estava publicado — a nota estava errada*). Shims de estado: 15. Verificado: 335 testes, arranque no
  browser, auto-teste desktop (o passo `autosave` passa pelo novo subscritor do bridge;
  as diferenças nos passos `llm*`/`providers` vêm do ambiente — passou a haver uma chave
  da Anthropic guardada, sem créditos).

- **U4 — plano das fatias (2026-11-23).** Por dono, do menor risco para o maior, um commit
  cada: U4a arranque tipado + código morto provado; U4b editor/separadores (com o `TB`);
  U4c explorador; U4d «shell» (barra de actividade, menus, painel, barra de estado,
  `badges`); U4e terminal emulado; U4f workspace/configuração (`writeFile`, `loadSeed`,
  `save`/`loadCfg`, `USAGE`); U4g as camadas `v5`/`v6`; U4h a parte desktop de cada feature
  (fora do `bridge.ts`); U4i tipar `infra`/`visualizer`/`interpreter` (0 `@ts-nocheck`).

- **U4a (2026-11-23) — arranque tipado e código morto.** `startup.ts` tipado (a mesma
  sequência `boot → … → i18nBoot`, na mesma posição da cadeia — corre antes do
  bridge/pair/painel, e imports estáticos não permitem intercalar chamadas no main.ts; um
  passo em falta passa a ser um erro claro). Código morto removido, com prova: 9 funções do
  `boot.ts` que o `app.ts` republica antes de alguém as usar (`buildActivity`, `closeTab`,
  `hydrate`, `openFile`, `setActive`, `setPane`, `setPanelTab`, `togglePanel`,
  `toggleSide` — sem capturas `const _x = x`, sem referências por valor, sem chamadas no
  topo de módulos antes do app.ts) e 5 duplicados `$dup` do `app.ts` (só a própria
  definição). Remoção por AST e por linhas inteiras (uma primeira tentativa por intervalos
  do AST partiu linhas partilhadas — apanhado pelo typecheck/goldens). `@ts-nocheck` 8 → 7;
  lint 299 → 292 avisos. Verificado: 342 testes (goldens sem diff), arranque no browser
  4/4 e auto-teste desktop idêntico.

- **U4b (2026-11-23) — separadores do editor.** `features/tabs.ts` (tipado) é dono da barra
  de separadores e da navegação: `tabOf`, `openTab`, `openPath`, `openFile`, `setActive`,
  `show` (escolhe o renderer em `VIEW`), `closeTab`, `stepTab`, `drawTabs`, `tabIc`,
  `parkAgent`, `miniOff` — saíram do app.ts (e da sua lista de publicação) e são
  publicados por esta feature, que avalia antes do app.ts; o v6 continua a decorar o
  `show` (agora esta versão). A lista `TB` passou a ter dono (`editorStore.tabs`): ao
  deixar de ser declarada no app.ts, as 23 utilizações — incluindo a reatribuição
  `TB=[…]` do arranque — passam pelo acessor. Métrica: «chamadas `Object.assign(window`»
  passou a «nomes publicados» (251) — mover uma função de módulo não deve contar como
  recuo, deixar de a publicar sim; o número é igual ao do HEAD anterior (os nomes mudaram
  de dono, não se multiplicaram). E2E: expectativas a 10 s (falsos negativos
  intermitentes no 1.º teste com a máquina carregada — já tinha acontecido na U1).
  Verificado: 346 testes (goldens sem diff; 4 novos dos separadores), arranque no browser
  4/4 e auto-teste desktop idêntico.

- **U4c (2026-11-23) — explorador.** O `features/explorer.ts` já era dono da árvore; ficaram
  com ele também a selecção de linha `sel` (era do boot.ts e ainda usada pelo
  `renderLevel` da feature), a reconstrução da árvore a partir do FS `syncTree` e o ícone
  por extensão `fIcon` (eram do app.ts) — tipados; o bridge.ts continua a decorar o
  `syncTree` (agora esta versão). Código morto removido do boot.ts, com a mesma prova da
  U4a: `buildExplorer`, `renderLevel` e `collapseAll` (a feature, que avalia depois,
  substitui-os) e `iconFor`/`iconClass` (só usados por esses); o `wireSections` fica (é
  dos contentores, `buildDocker`). Métrica: as duas formas de publicar no window
  (`window.X =` e os nomes em `Object.assign`) fundiram-se numa só — «globais publicadas»
  (430; era 435 no HEAD anterior) —, porque mover uma função pode trocar de sintaxe sem
  mudar nada (aqui: `sel`/`syncTree` passaram de `window.X =` para a lista da feature).
  Vitest com 15 s por teste: com a máquina carregada (carga 17–26 pelas outras sessões) o
  golden que arranca a app inteira passava os 5 s — o HEAD sem a U4c falhava igual.
  Verificado: 349 testes (goldens sem diff; 3 novos), arranque no browser 4/4 e
  auto-teste desktop idêntico.

- **U4d1 (2026-11-23) — a «shell» da janela.** `features/shell.ts` (tipado) é dono do
  layout: a barra de actividade (`buildActivity`, o menu de vistas extra `openOverflow`,
  os contadores `badges`), os painéis laterais (`setPane`/`goPane` e o registo de
  renderers `RP`, que o app.ts e o v6 continuam a preencher por nome ao carregar), a barra
  lateral e o painel inferior (`toggleSide`, `togglePanel`, `setPanelTab`, `sideOpen`) e
  os separadores arrastáveis (`mkRz`). Saíram do app.ts (9 funções + `RP` + a cópia de
  `hd`, que passa a ser a do core) e do boot.ts (`openOverflow`, `mkRz`); o painel activo
  passa pelo dono (`layoutStore.pane`) e o contador do Co-Dev lê `agentStore.run`.
  Globais publicadas: 430 (as mesmas — mudaram de dono). Lint 291 → 289. Verificado: 353
  testes (goldens sem diff; 4 novos), arranque no browser 4/4 e auto-teste desktop
  idêntico. A seguir, U4d2: menus.

- **U4d2 (2026-11-23) — barra de menus.** `features/menus.ts` (tipado) é dono do mecanismo
  dos menus — `buildMenubar`, `showMenu`, `closeMenus`, `renderPop` (com submenus) — e o
  menu aberto (`openMenu`) passou a estado do módulo (deixou de ser global: 430 → 429). O
  conteúdo (`MENUS`, montado pelo `buildMenus` do app.ts e ajustado pelo v5/v6/bridge/
  pair/visualizer) fica onde está: é configuração com closures sobre funções de muitas
  features e dissolve-se quando cada feature registar os seus comandos. **Apanhado pelos
  testes:** o boot.ts registava `document.addEventListener('click', closeMenus)` no eval —
  uma referência por valor que a verificação desta fatia (só chamadas) não procurou;
  passou a `() => closeMenus()` (mesma ordem de registo, resolvido na hora) e a prova
  completa (capturas + referências por valor) foi repetida para todos os nomes movidos
  desde a U4b, sem mais casos. Verificado: 356 testes (goldens sem diff; 3 novos),
  arranque no browser 4/4 e auto-teste desktop idêntico.

- **U4e (2026-11-23) — terminal emulado.** O `features/terminal.ts` (que já tinha o prompt,
  o `termExec` e o registo `XC`) ganhou o terminal de base que vivia no boot.ts: os
  primitivos do ciclo de input (`echo`, `echoCmd`, `scrollTerm`, `termClear`, `termNew`,
  `onKey`, `complete`), a navegação na árvore (`dirAt`, `curDir`) e o interpretador `run`
  (`ls`/`cd`/`pwd`/`cat`/`tree`/`git`/`cargo`/… com o `XC` por cima), tipados. O
  histórico (`HIST`/`hidx`) passou a estado do módulo. O `run` e o `promptHTML` são
  decorados depois pelo bridge.ts e pelo pair.ts: o Enter e o prompt chamam-nos pelo
  window em runtime (a versão decorada, como antes). Código morto removido do boot.ts com
  prova: `promptHTML` e `newInput` (o terminal.ts já publicava os seus, que avaliam
  depois). Globais publicadas 429 → 423. Verificado: 360 testes (goldens sem diff; 4 novos
  do terminal), arranque no browser e auto-teste desktop idêntico (os passos `terminal`,
  `terminalUI` e `termgit` passam pelo `run` decorado). **Risco conhecido:** as outras
  sessões correm `ui:build` no mesmo `ui-app/dist` que o teste de arranque serve — uma
  reconstrução a meio troca os ficheiros por baixo do servidor (uma falha isolada nesta
  fatia, 3/3 verdes a seguir).

- **U4f (2026-11-23) — workspace e configuração.** Saíram do app.ts, tipados:
  `features/workspace.ts` (`writeFile`, `loadSeed`) com a semente em
  `features/workspace/seed.ts` (os 12 KB de `SEED`, copiados tal e qual); e em `app/store/`
  o armazenamento local `LS` (`storage.ts`), a configuração persistida `save`/`loadCfg`
  (`config.ts` — os valores com dono passam pelos stores e emitem os seus eventos) e, no
  `agentStore`, o uso por provedor `USAGE` (agora com dono) com `use`/`connected`. Os
  goldens — que partem todos do workspace semeado — ficaram sem diff. Globais publicadas
  423 → 422; lint 287 → 283. Nota da métrica: a contagem de nomes num `Object.assign`
  conta o que vem depois de cada vírgula — funções em linha com parâmetros inflacionam-na;
  publica-se sempre com nomes curtos (`{ use, connected }`). Verificado: 365 testes
  (goldens sem diff; 5 novos), arranque no browser 4/4 (incluindo o restauro do
  `loadCfg`) e auto-teste desktop idêntico.
- **U4g1 (2026-11-23) — os registos de vistas.** A U4g (camadas `v5`/`v6`) parte-se em
  sub-fatias: primeiro os registos, depois as decorações por grupo (infra, board,
  codev/harness, editor, studio/team). Os registos `RP` (painéis laterais) e `VIEW`
  (separadores) ganham dono em `app/store/registry.ts`, que avalia antes de tudo — antes o
  `VIEW` nascia no app.ts, depois das features, e era o `v6` que registava as vistas delas.
  Agora cada feature regista as suas: `tasks` (`RP.tasks`, `VIEW.issue`), `infra`
  (`RP.infra`, `VIEW.envs`, `VIEW.observe`), `debug` (`RP.debug`), `ext` (`RP.ext`,
  `VIEW.extd`) e `codereview` (`VIEW.creview`, `VIEW.hood`) — directamente, sem o shim
  preguiçoso (nenhum destes renderers é reatribuído no `window`). As decorações que vêm
  depois continuam a apanhar estas versões: o `bridge.ts` decora o `VIEW.observe` ao
  carregar e o `visualizer` decora o `VIEW.hood` no `boot7`. Saiu também o `RP.ext` antigo
  do app.ts (o painel de provedores de LLM), que era código morto — o `v6` sobrepunha-o ao
  carregar e ninguém o lia entre os dois; com o registo a passar para antes do app.ts, ficar
  com ele tê-lo-ia ressuscitado. Os registos que o app.ts ainda faz (com sobreposições
  dentro do próprio ficheiro: `RP.scm` duas vezes, `VIEW.welcome` três) ficam para a fatia
  do app.ts. Handlers inline 165 → 163 (os dois `onclick` do `RP.ext` morto); globais
  publicadas 422 (o `VIEW` passa do app.ts para o registo, o `RP` da shell para o registo).
  Verificado: 365 testes (goldens sem diff), arranque no browser 4/4, uma sonda no browser
  (cada `RP.*` é o renderer da feature; as 13 vistas existem; os quatro painéis e as vistas
  creview/hood/observe desenham sem erros, com a decoração do visualizer no hood) e
  auto-teste desktop idêntico ao da U4f (23 passos).
- **U4g2 (2026-11-23) — as decorações de infra do v5/v6.** Cada decoração foi dobrada no
  dono do que decorava, em vez de ser recriada como `window.X = …` noutro sítio: o guard do
  runtime de contentores e o redesenho do Infra no `dxRun`/`dxStop` foram para o
  `features/stack.ts` (dono da base); o `dxDeploy` que prepara os secrets publica-se já
  composto pelo `features/infra.ts`; e o override do `ctlLogs` (abrir o tab de
  observabilidade) entrou no próprio motor de infra. A versão antiga do `ctlLogs` (três
  linhas no terminal) era código morto: o v6 sobrepunha-a ao carregar e o motor nunca a
  chamava. Os comandos de terminal `kubectl`, `devcontainer` e `dx deploy` são registados
  pelo infra.ts no `XC` — por isso o `features/terminal.ts` (dono do `XC`, que no eval só
  define e publica) passou a avaliar antes do infra no main.ts. O `dx deploy` passa a
  decorar o `XC.dx` antes do app.ts (test/sprint, run/stop), mas os subcomandos são
  disjuntos, por isso o resultado é o mesmo. Prova de ordem: entre o infra.ts e o v5/v6
  nenhum módulo lia estes nomes por valor no eval (só chamadas tardias). Métricas sem
  mudança; a primeira versão (decorações como `window.X =` no infra.ts) subia as globais
  publicadas 422 → 426 e foi trocada pela versão dobrada. Verificado: 365 testes (goldens
  sem diff), arranque no browser 4/4, uma comparação no browser entre a HEAD e esta árvore
  (27 passos: kubectl/devcontainer/dx/docker/make com e sem runtime e cluster ligados,
  ctlLogs, dxRun/dxStop/dxDeploy incluindo um deploy bem-sucedido com `K8S.ver` fixado —
  saída do terminal, retornos e separadores byte-idênticos, sem erros de página) e
  auto-teste desktop idêntico ao da U4g1.
- **U4g3 (2026-11-24) — as políticas que decoravam o board.** As decorações de
  `approveIssue`, `delegate`, `runSprint`, `runIssue` e `VIEW.board`, espalhadas pelo app.ts,
  v5.ts e v6.ts, são agora compostas no `features/board.ts`, pela mesma ordem de dentro para
  fora: (app) validar uma issue de infra fecha os componentes do Studio; (v5) revisão do
  diff antes de validar e «o código é teu» (`codeGuard`) antes de delegar ou correr um
  sprint; (v6) explicação antes de validar, dono humano (`owner === "you"`), custo medido
  das corridas e, no quadro, duplo-clique, dono e custo. Publicam-se já compostas; o
  bridge.ts continua a decorar o `runSprint` por cima. O `VIEW.board` composto regista-se no
  board.ts (o shim do app.ts saiu); `renderBoardView` continua publicado como o corpo base que
  os goldens caracterizam. O `codeGuard` passou do v5 para o `features/team.ts` (é uma
  política do harness; a decoração do `runMission` no v5 continua a chamá-lo por nome), o
  `nfmt` passou do v6 para o `core.ts`, e saiu o `_todo6` do v6 (morto: nunca lido). Prova de
  ordem: entre o board.ts e o app/v5/v6 nenhum módulo lia estes nomes por valor no eval.
  **Teste ajustado (decisão registada):** como o harness dos testes inclui o board.ts e
  exclui o v5/v6, as políticas passaram a correr nos testes. O teste de dispatch «approve»
  usava uma issue em `func` por rever, e o harness por omissão (`HARN.review`) bloqueia a
  validação — na app real sempre bloqueou. A issue do teste passa a estar revista (a
  pré-condição real) e entram dois testes novos que prendem os gates (revisão e dono
  humano). Os snapshots dos goldens não mudaram. **Bugs pré-existentes reportados (não
  corrigidos):** desde que o quadro emite `data-action`, a camada v5 do `VIEW.board` já não
  encontra `approveIssue('…')` no HTML para trocar o «Validar» por «Review diff», e a camada
  v6 já não encontra `delegate` no `onclick` para tirar o «Delegar» das issues tuas. Os
  gates nas funções continuam a proteger o clique. Lint 283 → 282; métricas sem mudança.
  Verificado: 367 testes, arranque no browser 4/4, comparação no browser HEAD vs árvore
  (quadro com dono/custo/duplo-clique, os gates de revisão, explicação, dono humano e
  `codeGuard`, validação e delegação normais — idênticos, sem erros de página; não cobre
  uma corrida completa do runner nem o fecho dos componentes do Studio) e auto-teste
  desktop idêntico ao da U4g2.
- **U4g4 (2026-11-24) — o harness do projecto e o Co-Dev.** As políticas do harness que o
  v5/v6 aplicavam ao Co-Dev foram dobradas no `features/codev.ts`, dono das funções, sem
  republicar: o tecto de autonomia no `setMode`, os direitos humanos (`code` e os caminhos de
  arquitectura/migrações/dependências, com «your call») no `doTool` publicado, e o
  `codeGuard` no `runMission`. O resto foi para o `features/team.ts`, dono do `HARN`: o
  arranque do `explain` (dentro do `hydrateHarn`), o acerto do `explain` no `applyTemplate`
  (também quando a base recusa por haver uma execução a correr, como antes), o `VIEW.team`
  composto com a linha «explain before validating» (o shim do app.ts saiu), o `VIEW.review`
  e o `openTeam`. O `HARN` hidrata do LS logo ao carregar o team.ts — antes era o v5 que
  chamava `hydrateHarn()`, à espera de que o app.ts criasse o `LS`; desde a U4f o `LS` nasce
  no `app/store`, antes de tudo. Entre o team.ts e o v5 nada lia o `HARN` no eval nem
  escrevia o `harn5`, por isso os valores vistos são os mesmos. **Comportamento
  pré-existente, reportado (não corrigido):** só o `doTool` publicado leva o gate de
  direitos; as missões e o chat usam o `doTool` local do motor (`codev/index.ts`), que nunca
  o teve. As missões são barradas à entrada pelo `codeGuard` quando o `code` é humano, mas o
  chat livre não tem `codeGuard`, e nenhum dos dois passa pelo «your call» dos direitos de
  caminho (arquitectura/migrações/dependências) — fica só a aprovação do próprio motor. No v5 restam o `VIEW.studio` (Deploy), o `VIEW.welcome`, o `boot5` e o `tick`
  (sem efeito, cala o relógio do boot.ts). Lint 282 (sai o `jsa` sem uso no v5); métricas
  sem mudança. Verificado: 367 testes (nenhuma asserção mudou; saiu o stub do `VIEW.review`
  do teste do board, que agora existe no harness), arranque no browser 4/4, comparação no
  browser HEAD vs árvore (tecto do setMode, bloqueio de edição com `code` humano, pedido e
  rejeição de um direito, `codeGuard` numa missão, `openTeam` com a linha do explain,
  `applyTemplate` normal e durante uma execução, a vista de revisão, e um arranque com o
  harness guardado no localStorage — idênticos, sem erros de página) e auto-teste desktop
  idêntico ao da U4g3.
- **U4g5 (2026-11-24) — o editor (e uma regressão da U4b corrigida).** As decorações do
  editor saíram do v6 para os donos: a barra de acções nos breadcrumbs (`EACT` + `show`) para
  o `features/tabs.ts`; os breakpoints, a linha do depurador e o Error Lens no `paintEd`
  publicado para o `features/editor.ts`; o lint de YAML no `window.diagnostics` para o
  `features/diagnostics.ts`; os contadores Tasks/Debug para o `badges` do `features/shell.ts`
  (sem chamadas internas, dobra-se no corpo); o `lexVariant`/`LXL` para o
  `features/debug.ts`; e os atalhos globais (acordes Ctrl+K, F5/F9/F10, Ctrl+Shift+D/X/T,
  Shift+Alt+F) para um módulo novo, `features/shortcuts.ts`. O listener de atalhos é de
  captura no document e avalia depois do visualizer (que faz `stopImmediatePropagation` com
  o overlay aberto) e antes do app.ts, cujo listener de captura trata teclas disjuntas — o
  `stopPropagation` de um não impede o outro (mesmo nó). **Regressão da U4b, corrigida:**
  antes da U4b o `show` era `window.show` no app.ts, e o `openTab`, `setActive`, `closeTab`,
  `stepTab` e o clique num separador chamavam a versão decorada pelo v6. A U4b tornou essas
  chamadas locais, e a barra de acções deixou de aparecer ao abrir um ficheiro. Voltam a
  passar pelo `window.show`. Procurei o mesmo padrão em tudo o que saiu do app.ts/boot.ts
  desde a U4b: dos nomes decorados por outros módulos, `run`/`promptHTML` já passavam pelo
  `window` (U4e), `syncTree`/`termExec` só são chamados pelo `window`, e o `badges` não tem
  chamadas internas — só o `show` tinha regredido. **Bug pré-existente reportado (não
  corrigido):** desde a extracção do editor (`923a2a5`), o `renderFileView` e o `oninput`
  chamam o `paintEd` local, por isso as marcas do v6 (breakpoints, linha do depurador, Error
  Lens) só aparecem quando alguém chama o `window.paintEd`; antes, no app.ts, o `paintEd` era
  `window.paintEd`. Globais publicadas 422 → 419; lint 282; testes sem alteração (os testes
  do codereview/debug ainda injectam cópias exactas do `lexVariant`/`LXL` depois do arranque,
  com comentários que os dão como do v6). Verificado: 367 testes (snapshots sem diff),
  arranque no browser 4/4, comparação no browser entre três builds — HEAD, esta árvore e o
  commit anterior à U4b — com a barra de acções ao abrir e ao mostrar, o `EACT` (com o
  «Visualize» do boot7), o `lexVariant`/`LXL` nas cinco variantes, o lint de YAML com a
  extensão desligada e ligada, um breakpoint pintado, o contador de Tasks e os atalhos
  (acorde Ctrl+K E, Ctrl+Shift+T, F9): esta árvore é idêntica ao commit anterior à U4b, e a
  única diferença para a HEAD é a barra ao abrir um ficheiro; auto-teste desktop idêntico ao
  da U4g4.
