# ADR-0004 — Migração da ui-app para Clean Architecture (Etapa 4 do MIGRATION)

- **Estado:** aceite (recomendações do §9 aceites a 2026-11-23); U0–U3 feitas, U4 feita (U4a–U4j5: o v5/v6 e o app.ts já não existem; nenhum ficheiro com @ts-nocheck); U5 feita (U5a–U5e: 0 handlers inline, `script-src` sem `'unsafe-inline'`); U6 em curso (U6a–U6b)
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
- **U4g6 (2026-11-24) — o Studio.** O drift («design vs realidade») saiu do v6 para o
  dono, `features/studio.ts`: a base do desenho passa a `drawStudioBase` e o `drawStudio`
  publicado é a base + `paintDrift` (etiqueta de estado por nó e resumo «Design vs
  <ambiente>» no inspector). As chamadas internas da feature já resolviam `drawStudio` pelo
  global, por isso o efeito é o mesmo. A feature regista também o `VIEW.studio` (o corpo
  `renderStudioView` + o selector «Compare with…»), que o v6 definia; o `renderStudioView`
  deixa de ser publicado. `driftReport`/`DSTY`/`ENVL` vêm de `features/infra.ts` por import
  (o v6 deixa de importar a infra), e o `DRIFT` lê-se por uma fachada tipada. **Bug
  pré-existente reportado (não corrigido):** o botão «⎈ Deploy» que o v5 juntava à barra do
  Studio é código morto desde `f2eced4`: até aí o `app.ts` definia `VIEW.studio`, o v5
  juntava o botão e o v6 compunha por cima (`_studio6`); o `f2eced4` reescreveu a linha do v6
  para chamar directamente o `renderStudioView`, e o `_studio5` do v5 passou a capturar
  `undefined` (nada define `VIEW.studio` antes do v5) e a ser sobreposto antes de alguém o
  chamar. A linha morta sai do v5; o Deploy continua acessível pela página de boas-vindas,
  pelo cabeçalho da Infra, pelo comando «Project: Deploy to Kubernetes» e pelo `dx deploy`. Globais publicadas 419 → 418 e handlers inline 163 → 162
  (o `onclick` morto); lint 282; testes sem alteração. Verificado: 367 testes (snapshots
  sem diff), arranque no browser 4/4, comparação no browser entre a HEAD e esta árvore (a
  barra do Studio, o selector, o desenho e o inspector sem drift, com Local sem nada
  implantado, com Staging escolhido no selector — nós em sync, behind, failing e missing e
  um workload a mais —, com um nó seleccionado e ao reabrir a vista): idênticas, sem erros
  de página; auto-teste desktop idêntico ao da U4g5.
- **U4g7 (2026-11-24) — o arranque; o v5 e o v6 deixam de existir.** O que restava das
  camadas foi para os donos, e os dois ficheiros (`@ts-nocheck`) foram apagados:
  - **Boas-vindas:** a página efectiva era a do v5, que sobrepunha três versões anteriores
    antes de alguém as chamar (o shim do app.ts para o `renderWelcomePage` do codev.ts e duas
    páginas do próprio app.ts). Passou para um módulo novo e tipado, `features/welcome.ts`,
    que regista o `VIEW.welcome`; as duas páginas mortas e o shim saíram do app.ts. O
    `renderWelcomePage` do codev.ts fica: na app está inalcançável, mas o golden do codev
    caracteriza-o directamente.
  - **`boot5`/`boot6`:** foram verbatim para o app.ts, junto do `boot`/`boot3`/`boot4` — são
    da mesma natureza (ajustam `ACTS`/`MENUS`/`CMD`/`LANG`) e dissolvem-se quando cada
    feature registar os seus comandos. Prova de resolução de nomes: dos nomes livres dos
    dois, só `CMD`, `LANG` e `runTask` colidem com declarações de topo do app.ts, e são os
    mesmos objectos publicados no `window` (os dois primeiros só mutados, o `runTask` nunca
    reatribuído); o `esc` colidia só no `dlg`, que não foi para o app.ts.
  - **`dlg`:** tipado no `core.ts`; os legacy-bridges do debug/infra/board importam-no em
    vez de o lerem do `window` (deixa de ser publicado). O `nfmt` também deixa de ser
    publicado: o `features/tasks.ts` importa-o do core.
  - **Ícones:** os 7 do v6 (tasks/eye/review/bulb/bug/pulse/layers) entraram na biblioteca
    `P` do boot.ts. Prova: nenhum `svg()` corre no eval de um módulo e ninguém copia ou
    enumera o `P`, por isso existirem mais cedo não muda o markup da app.
  - **`tick`:** o relógio do boot.ts saiu, e as chamadas no `boot()` do app.ts também. O v5
    substituía-o por uma função vazia, por isso nunca corria — e o `#clock` nem existe no DOM.

  **Decisão registada — 8 goldens regenerados (aprovada pelo dono a 2026-11-24):** o harness
  nunca carregou o v6, por isso os goldens do debug (1), do ext (2) e do visualizer (5)
  tinham gravado o ícone `file` de recurso onde a app mostra `bug`, `bulb` e `layers`. Com os
  ícones no `P`, o harness passa a ver os ícones reais. Provei sobre o diff dos snapshots que
  as 12 linhas mudadas diferem apenas na troca do ícone de recurso pelo ícone real; na app
  nada muda. Métricas: `@ts-nocheck` 7 → 5, globais publicadas 418 → 412, handlers inline
  162 → 160 (as duas páginas mortas); lint 282 → 280. Verificado: 367 testes, arranque no
  browser 4/4, comparação no browser entre a HEAD e esta árvore (separador inicial e página
  de boas-vindas, barra de actividade, menus, os 92 comandos da paleta, `LANG`, ícones,
  separadores do painel, painéis laterais, barra de estado, modo, e o diálogo — aberto pela
  promoção a Production e pela explicação antes de validar, com foco, validação, `trim`,
  `onOk`, cancelar e clicar fora): idênticas, sem erros de página; auto-teste desktop
  idêntico ao da U4g6. A seguir: U4h (a parte desktop de cada feature, fora do `bridge.ts`).
- **U4h — plano (2026-11-24).** O `bridge.ts` era uma closure de ~1050 linhas com 11 grupos
  (terminal, pastas/autosave, git, LLM, delegação, contentores/K8s, demos, extensões,
  menus/boas-vindas, arranque, auto-teste) que se chamam uns aos outros e partilham estado
  (`R`, a fila `Q`, os processos). Mudar o sítio e trocar as decorações por injecção ao mesmo
  tempo seria um big-bang; por isso: **U4h1** muda o código de sítio, mecanicamente, para
  `platform/desktop/` (decorações intactas); **U4h2+** troca as decorações por portas
  injectadas, dono a dono (scm, terminal, infra, codev/LLM, workspace…), com a mesma análise
  de chamadas internas da U4g.
- **U4h1 (2026-11-24) — a parte desktop sai do `bridge.ts` para `platform/desktop/`.**
  `context.ts` cria o contexto partilhado (o topo da closure, verbatim: clientes IPC, `R`
  publicado como `window.DXR`, `sh`/`git`/`gitOk`/`stream`, a fila — o `Q` passa a `idle()`,
  que devolve a fila no momento da chamada — e os utilitários) com lugares tardios para os
  serviços que um grupo define e outros usam (`envFor`, `termLine`, `runInTerm`, `realTerm`,
  `reloadDisk`, `markChanged`, `flushSave`, `syncGit`, `openFolder`, `loadKeys`,
  `desktopSample`, `provCaps`). Cada grupo foi verbatim para um módulo com um
  `install<Área>(ctx)` — `terminal`, `workspace` (+ `installFolderUi` para o menu File, a
  paleta, o Ctrl+O e as boas-vindas), `git`, `llm` (com a parte de UI que vinha depois da
  delegação: são independentes), `agent-tasks`, `infra`, `demos`, `ext` — e o auto-teste para
  `selftest.ts`; os tipos e o `declare global` para `types.ts`. O `bridge.ts` (1203 → 53
  linhas) cria o contexto, instala pela ordem das antigas secções e corre o arranque. Os
  módulos só definem funções no topo, por isso importá-los não tem efeitos; os efeitos no eval
  (decorações, listeners, `MENUS`/`CMD`, `PROV`) acontecem nos installers pela mesma ordem.
  **Provas:** (1) as dependências entre grupos foram calculadas pela AST antes de mover; (2)
  com o type checker, os 704 identificadores com nomes da antiga closure resolvem todos dentro
  do próprio módulo (destructuring, shim ou local) — nenhum cai num global do `declare
  global` por acaso, o risco silencioso desta mudança; (3) cada linha do original aparece
  tal-e-qual num módulo, à excepção de 26 com substituições previstas (`export`, `Q`→`idle()`,
  `ctx.`, a assinatura do `selftest`, o tipo `RunOpts`). Métricas sem mudança; lint 280.
  Verificado: 367 testes, arranque no browser 4/4, auto-teste desktop idêntico ao da U4g7
  (23 passos); e, com um passo de sonda temporário (fora do commit) corrido na app real com a
  UI da HEAD e com a desta árvore — botões das boas-vindas, menu File, paleta, pasta no
  explorador, prompt real, nota do agente, Settings (texto e placeholders das chaves), logs
  reais na observabilidade, sampler, `loadJSZip`, `drawStack` —, idênticos (só difere um nome
  minificado).
- **U4h2 (2026-11-24) — o scm: a primeira porta desktop injectada no dono.** Novo registo
  `app/desktop.ts` (`desktopPorts`), onde a app Tauri instala as portas; no browser e nos testes
  fica vazio. A interface `ScmDesktop` é do scm (`scm/application/ports.ts`): commit, checkout,
  gitMerge e gfFinish, cada um com a versão simulada como último argumento (sem repositório o
  adaptador delega nela; o commit corre-a primeiro e depois o `git commit`). O `scm.ts` publica
  `commit`/`checkout`/`gitMerge`/`gfFinish` compostos com a porta (consultada no acto); o
  `platform/desktop/git.ts` deixa de reatribuir os quatro globais e instala
  `desktopPorts.scm` com os mesmos corpos. **Equivalência:** antes, o `window` decorado era o
  único caminho para o git real; agora são as versões publicadas — os mesmos chamadores. As
  chamadas internas do `scm.ts` continuam no motor local, como antes. Dentro do `gfFinish`
  desktop, os `checkout(…)`/`gitMerge(…)` resolvem (provado com o type checker) para os globais
  publicados, que voltam a passar pela porta — como antes passavam pelos decorados. Ninguém
  captura estes nomes por valor (só `G.x`/`window.x` no acto e portas do board/codev).
  **Bugs pré-existentes reportados (não corrigidos):** (1) desde a Fase 4 do scm (`f07dbc1`),
  as acções do pane — Commit, mudar de ramo, fim de gitflow — e a paleta de ramos chamam o
  motor local em vez do `window` decorado, por isso no desktop não usam git real (os
  `onclick` antigos usavam); com a porta no dono, a correcção é usar as versões publicadas nas
  acções. (2) O `gfStart` nunca foi desktop: cria o ramo de gitflow só em memória, por isso o
  gitflow não chega ao git real — o passo `gitflow` do auto-teste acaba em `master` com um só
  ramo, e o `checkpoint` com `finishedViaAsk: false`, desde a primeira medição da sessão.
  Métricas sem mudança; lint 280. Verificado: 367 testes, arranque no browser 4/4, auto-teste
  desktop idêntico ao da U4h1 (os passos `commit` e `scm` confirmam o git real pela porta).
- **U4h3 (2026-11-24) — o terminal.** Porta `TerminalDesktop` (definida no
  `features/terminal.ts`, registada em `desktopPorts.terminal`): `run`, `termExec` e
  `promptHTML`, cada um com a versão emulada como último argumento. O terminal publica os três
  compostos com a porta (as bases passam a `promptBase`/`termExecBase`/`run`); o
  `platform/desktop/terminal.ts` deixa de reatribuir o `window.run` e o `termExec` e instala a
  porta com os mesmos corpos — e o prompt real, que vivia na secção «folders» do bridge (agora
  `workspace.ts`), passa para a mesma porta, porque é do terminal. **Equivalência:** os
  chamadores são os mesmos (o Enter pelo `TG.run`, o `newInput`/`echoCmd` pelo `promptHTML`
  global, o codev e o `runTask` pelo `termExec` global); ninguém os captura por valor antes do
  bridge; o pair.ts, que avalia depois, continua a decorar o `run`/`promptHTML` por cima — a
  cadeia passa de pair → desktop → base a pair → publicado → porta → base, pela mesma ordem.
  Globais publicadas 412 → 411 (sai o `window.run =` do desktop); lint 280. Verificado: 367
  testes, arranque no browser 4/4, auto-teste desktop idêntico ao da U4h2; e, como o auto-teste
  chama o `realTerm`/`stream` directamente, uma sonda temporária (fora do commit) na app real
  com a UI da HEAD e com a desta árvore — `run` (devolve a promessa, eco real, linha vazia),
  `termExec` (tarefa no PTY do painel, devolve `null`) e a estrutura do prompt real com o nome
  da pasta — idênticos. Nota de ambiente: entre corridas o `providers.json` real ganhou e
  perdeu uma chave OpenAI por fora destas corridas, e um `terminalUI` saiu `false` uma vez
  (repetido duas vezes: `true`) — sinais de outra sessão a usar o mesmo HOME.
- **U4h4 (2026-11-24) — o stack e a infra.** Duas portas, uma por dono: `StackDesktop`
  (`features/stack.ts`: `dxRun`, `dxStop`, `drawStack`) e `InfraDesktop`
  (`infra/application/ports.ts`: `rtConnect`, `k8sConnect`, `dxDeploy`, `observe`), registadas
  em `desktopPorts.stack`/`desktopPorts.infra`. Os donos publicam as versões compostas com a
  porta (as bases passam a `dxRunGuarded`/`dxStopGuarded`/`drawStackBase` e, na infra, o
  `rtConnect`/`k8sConnect` do motor, o `dxDeployPrimed` e o `renderObserveView`); o
  `platform/desktop/infra.ts` deixa de reatribuir os seis globais e o `VIEW.observe` e instala
  as duas portas com os mesmos corpos (o `drawStack` real deixa de passar os argumentos à base,
  que não os lê). As chamadas internas do stack (o `drawStack` no fim do `dxRunBase`/
  `dxStopBase`) já resolviam o global, por isso continuam a passar pelo desktop; dentro das
  portas, `drawStack`/`needRt`/`infraDraw`/`k8sDocs`/`goPane` resolvem para os globais
  (provado com o type checker). **Decisão registada — mudança de comportamento aprovada pelo
  dono a 2026-11-24:** o `boot4`/`boot5`/`boot6` guardam o `dxRun`/`dxStop`/`dxDeploy` por
  valor em 9 entradas efectivas (paleta: «Project: RUN the whole stack», «Project: Stop the
  stack», «Project: Deploy to Kubernetes»; menus Project e Run: RUN, Stop, Deploy). Como o
  arranque corre antes do bridge, na app desktop essas entradas ficavam com as versões
  SIMULADAS, enquanto o Ctrl+F5 e os botões da Infra usavam as reais. Com a porta no dono, a
  versão publicada já a consulta desde o início, por isso as 9 entradas passam a usar o
  desktop real; no browser nada muda. Lint 280 → 277 (saem três `any` das decorações). Verificado:
  367 testes, arranque no browser 4/4, auto-teste desktop idêntico ao da U4h3 (o passo `infra`
  exercita o `rtConnect`/`k8sConnect` reais e as guardas do deploy pela porta); e uma sonda
  temporária na app real, HEAD vs árvore: as 9 entradas passam de «não são as publicadas» a
  «são as publicadas», e o RUN da paleta/menu passa do resultado simulado
  (`{ok:false, sum:"no runtime"}`) ao do caminho desktop (`{ok:false}`, o mesmo do Ctrl+F5);
  idênticos o `window.dxRun`/`dxDeploy`, o deploy, os logs reais na observabilidade e os
  outros 23 passos.
- **U4h5a (2026-11-24) — o Co-Dev (modelos reais) e as guardas das demos.** Portas com membros
  opcionais, porque as preenchem módulos desktop diferentes: `CodevDesktop`
  (`codev/application/ports.ts`: `updateAgentUI`, `testProv`, `provState`, `settings` — preenchidos
  pelo `llm.ts` — e `runMission` — pelo `demos.ts`) e `BoardDesktop` (`runSprint`, pelo
  `demos.ts`). Os donos publicam as versões compostas: o `codev.ts` (`updateAgentUI`, `testProv`,
  `runMission` — base `harnessRunMission`), o `board.ts` (`runSprint` — base `runSprintGuarded`) e
  o `app.ts`, onde vivem o `provState` e o `VIEW.settings` composto (corpo do codev + secção
  Language; a porta embrulha esse composto, como antes o desktop o embrulhava). O `SAMPLE` e o
  `LIVE_OK` ficam como estado que o desktop configura — não são decorações. Os chamadores
  internos do Co-Dev já usavam o `window.X` e os do board os `decorated*`, por isso continuam a
  passar pelo desktop; dentro da `settings` desktop, o `updateAgentUI()` resolve para o global
  composto (type checker); o `selftest` passa o `provState` por valor, mas depois da instalação.
  Nenhuma captura por valor no arranque. **Nota:** a meio desta fatia, o `develop` recebeu o merge
  do PR #1 (`feat/learning-plugins`, `2905a41`), feito por fora desta sessão; a compilação Rust
  coincidiu com o merge e falhou uma vez (transitório), por isso a comparação foi refeita sobre
  a base nova — worktree em `2905a41`, lint de referência 288 → 282 com esta fatia, 414 testes.
  Lint −6 (saem `any` das decorações). Verificado: arranque no browser 4/4, auto-teste desktop
  idêntico ao da HEAD `2905a41`; e uma sonda temporária na app real, HEAD vs árvore: nota
  «desktop» do agente, `provState` de cada provedor, Settings (texto, placeholders das chaves,
  capacidades, secção Language), «Test connection» real e as guardas de missões e sprints com
  a pasta aberta — idênticos.
- **U4h5b (2026-11-24) — explorador, boas-vindas, changelog e extensões.** Quatro portas
  pequenas, cada uma definida pelo dono: `ExplorerDesktop` (`features/explorer.ts`: `syncTree` —
  a raiz com o nome da pasta), `WelcomeDesktop` (`features/welcome.ts`: os botões «Open Folder…»
  e as pastas recentes), `ChangelogDesktop` (`features/changelog.ts`: o `git log`/`git show`
  reais) e `ExtDesktop` (`ext/application/ports.ts`: o JSZip embutido na app). Os donos publicam
  as versões compostas (o `syncTree` publicado, o `VIEW.welcome`, o `window.clLog`/`clShow` e o
  `window.loadJSZip` que o legacy-bridge do ext publica); o desktop (`workspace.ts`, `git.ts`,
  `ext.ts`) instala as portas com os mesmos corpos (o `syncTree` real deixa de passar argumentos
  à base, que não os lê). O `syncTree` só é chamado pelo app.ts, pelo global; os outros três são
  lidos no acto (`window.clLog()`, `G.loadJSZip()`, `VIEW[t.kind]`); nenhum é capturado por valor
  no arranque. **Ficam como contribuições do desktop, não portas:** os itens do menu File (um
  getter sobre o `MENUS`, o mesmo padrão que o `boot6` usa nos menus Co-Dev/View), as entradas da
  paleta (`CMD.unshift`) e o Ctrl+O — são registos do desktop no conteúdo dos menus/paleta do
  app.ts, que se dissolvem quando as features registarem os seus comandos (U7). Com isto, o
  desktop já não reatribui nenhuma função publicada pelos donos. Globais publicadas 411 → 409;
  lint 282 → 276. Verificado: 414 testes, arranque no browser 4/4, auto-teste desktop idêntico ao
  da HEAD `fcdc98a`; e uma sonda temporária na app real, HEAD vs árvore — raiz do explorador,
  botões de pasta nas boas-vindas, changelog sobre git real (`git show`), JSZip carregado do
  ficheiro embutido — idênticos.
- **U4i — plano (2026-11-24).** Tirar o `@ts-nocheck` aos três ficheiros que restam fora do
  monólito: `features/infra.ts` (86 erros sem a directiva), `features/visualizer.ts` (129) e
  `visualizer/domain/interpreter.ts` (376) — um commit cada, do menor para o maior. Regra: só
  anotações, `as`, `!` e declarações; a prova é que o JavaScript emitido (tipos retirados,
  comentários fora, parênteses canonizados pela AST) é o mesmo antes e depois, e qualquer
  desvio aparece nessa comparação. As verificações correm numa worktree limpa da HEAD com só
  as alterações da fatia, porque outra sessão está a criar `features/arch/` na mesma árvore e
  o código dela ainda não compila.
- **U4i1 (2026-11-24) — o `features/infra.ts` tipado.** As globais que o resíduo publica e lê e
  que o contrato ainda não declarava (`saveEnv`, `saveEnvx`, `SHOWSEC`, `DRIFT`, `OBS`, `XC`,
  `ctlLogs`, `promote`, `redeployEnv`, `openEnvs`, `k8sScale`, `k8sDown`, `startDebug`) entram
  por `declare global`; os parâmetros e o estado ganham os tipos do domínio (`ActionTable`,
  `ObsData`, `ObserveTab`, `SecretSets`, `EnvDep`, `K8sDep`); os acessos que podem dar `null`
  levam `!`/`as`. JavaScript emitido idêntico, à excepção de um parâmetro não usado (`t` →
  `_t`, exigido pelo `noUnusedParameters`). `@ts-nocheck` 5 → 4; lint 276 → 275. Verificado
  na worktree limpa: tsc, 414 testes (snapshots sem diff), arch:check, build, arranque no
  browser 4/4 e auto-teste desktop idêntico ao da HEAD.
- **U4i2 (2026-11-24) — o `features/visualizer.ts` tipado.** O estado do overlay ganha um tipo
  (`VzOverlay`: fonte, passo, temporizador, profundidade, modo prever, resultado, notas,
  pergunta pendente, pontuação); o `VZ` declara-se com esse tipo desde o início (é `null` até
  ao primeiro `vizOpen`, e as guardas `if(!VZ)` ficam onde já estavam). O domínio
  (`visualizer/domain/types.ts`) passa a descrever o retrato que o `snap()` do interpretador
  produz — `VzSlot`, `VzSlotRef`, `VzFrame`, `VzHeapBlock`, `VzRoData` — em vez de
  `unknown[]`, o que a U4i3 reutiliza. As globais do arranque que o overlay lê (`P`, `EACT`,
  `LTS`, `md`) e o `window.VZ` entram por `declare global`; os acessos ao DOM ganham
  `!`/`as`/`querySelectorAll<HTMLElement>`. JavaScript emitido idêntico, à excepção de uma
  variável de desestruturação não usada (`k` → `_k`). A meio, a outra sessão commitou o
  Studio de arquitectura (`817ccde`); a referência passou a essa HEAD (lint 275 → 274, 438
  testes). `@ts-nocheck` 4 → 3. Verificado na worktree limpa: tsc, 438 testes (snapshots
  sem diff — os goldens do overlay incluídos), arch:check, build, arranque no browser 5/5 e
  auto-teste desktop idêntico ao da U4i1.
- **U4i3 (2026-11-24) — o interpretador `vzRun` tipado.** Era o `@ts-nocheck` deliberado da
  ADR-0002 (AST polimórfico + objectos-valor densos). Tipos internos: `VzVal` (o valor; `t`
  discrimina as ~13 variantes), `VzLoc`/`VzPlace`, `VzSlotState`/`VzFrameState`, `VzHeapObj`,
  `VzRoEntry`, o estado `S`, `VzThrow` (panic/compilação/limite/`ret`/`brk`/`cont`) e `VzFmt`;
  as 48 funções com assinatura; `panic`/`comp` com tipo `never` explícito (o que corrige o
  fluxo de controlo dos `switch`). **Decisão:** o escalar `v` do valor fica `VzScalar = any` —
  o único `any` deliberado, documentado no ficheiro — porque a variante `t` decide em runtime
  se é número, booleano ou carácter e o TypeScript não segue esse estreitamento através do
  `dz()`; os ~60 casts `as number` que a alternativa exigia seriam tão pouco verificados como
  o `any`. Os `!` dos «possibly undefined/null» (≈270) foram inseridos por um script sobre os
  diagnósticos do TypeScript. **Apanhado pela prova de equivalência:** em dois erros de
  atribuição o TypeScript aponta o alvo, e o script pôs o `!` antes do `=` —
  `caller.callLine!=l` e `line0.v!=s.line`, que sem espaços se lêem como o operador `!=` e
  apagavam a atribuição; o diff do JavaScript emitido mostrou-os, corrigiram-se para
  `= l!`/`= s.line!`, e as contagens de `!=`/`!==`/`==`/`===` ficaram iguais às do original.
  O JavaScript emitido final só difere do original em código morto removido (`STOP = {}` e
  um `const s = …` sem uso nem efeitos) e em quatro parâmetros/variáveis não usados
  renomeados com `_`. Corrigidos dois tipos da U4i2: os ids de heap são strings (`h1`), por
  isso `VzSlot.ptr`/`VzHeapBlock.id` passam a `string`. As sentinelas U+0000/U+0001 do `fmt`
  ficaram intactas (verificado em cada passo). **Bug pré-existente reportado (não
  corrigido):** `println!()` sem argumentos escreve `undefined` — o `fmt` devolve `''` quando
  não há argumentos e o `mac` lê `.s` disso (confirmado a correr o `vzRun`: `"a\nundefined\nb\n"`).
  `@ts-nocheck` 3 → 2 (só `app.ts` e `boot.ts`); lint do ficheiro 21 → 17. Verificado na
  worktree limpa sobre a HEAD `c9d8290`: tsc, 438 testes (os goldens que pinam a saída do
  `vzRun` byte-a-byte sem diff), arch:check, build, arranque no browser 5/5 (numa corrida
  anterior o `arch.e2e.ts` da outra sessão falhou uma vez; na HEAD sem estas alterações e na
  repetição com elas passou — transitório) e auto-teste desktop idêntico ao da U4i2.
- **U4j — plano (2026-11-24): dissolver o `app.ts` e o `boot.ts`.** Do menor risco para o maior,
  um commit cada: **U4j1** o `boot.ts` (código morto provado nome a nome; o resto tipado);
  **U4j2** os shims `VIEW.*`/`RP.*` do `app.ts` (cada feature regista a sua vista, como na
  U4g1); **U4j3** o núcleo de helpers e estado do `app.ts` (`esc`/`hhmm`/`setVar`/`hydrate`,
  `FS`/`ROOT`, `P_*`, `log`, `runTask`…) para os donos; **U4j4** o estado do Co-Dev que ainda
  vive no `app.ts` (`PROV`/`MODE`/`SAMPLE`/`RUN`…) e os comandos de terminal decorados
  (`XC.git`/`docker`/`make`/`dx`); **U4j5** menus, paleta, atalhos e arranque (`boot`…`boot6`)
  para registo de comandos por feature — o maior.
- **U4j1 (2026-11-24) — o `boot.ts` sem código morto e tipado.** Saem 17 definições, provadas
  nome a nome: 11 sem nenhuma referência fora do ficheiro (`tabIcon`, `renderTabs`,
  `renderDocs`, `agentShell`, `placeAgentCenter`/`Dock`, `cid`, `renderMinimap`, `welcome`,
  `wbtn`, `buildProblems` — o `welcome()`/`wbtn()` globais só eram chamados pelo `renderDocs`)
  e 6 que o `features/codev.ts` redefine antes de qualquer leitura (`agCtl`,
  `assistantCenter`/`Dock`, `toggleAgent`/`On`, `agSend`: entre o `boot.ts` e o `codev.ts`
  nenhum módulo os referencia). Ficam, tipados (sem `@ts-nocheck`): as globais de base
  (`$`/`$$`/`P`/`svg`/`toast`), os dados iniciais (`ACTS`/`OVERFLOW`/`MENUS`/`TREE`/`DOCS` — vão
  com a U4j5), o painel de contentores de demonstração (`buildDocker`/`wireSections`, chamado
  pelo `boot()`) e os dois listeners (o do teclado do agente está vivo: chama o `agCtl` do
  codev no acto). JavaScript emitido igual, à excepção das definições removidas e do
  `import { esc }` que deixou de ser usado (o `core.ts` só define funções no topo, por isso a
  ordem em que avalia não muda nada). O `String.replaceAll` (usado em runtime, fora da `lib`
  ES2020 do projecto) declara-se só para este uso, sem mexer no tsconfig. `@ts-nocheck` 2 →
  1; globais publicadas 409 → 392; handlers inline 160 → 158; lint 270 → 269. Verificado na
  worktree limpa: tsc, 438 testes, arch:check, build, arranque no browser 5/5, auto-teste
  desktop idêntico ao da U4i3.
- **U4j2 (2026-11-24) — cada feature regista as suas vistas.** Os 15 shims do `app.ts` que
  delegavam num `window.renderX` passam a registos na feature dona: `VIEW.file` (editor),
  `VIEW.diff`, `VIEW.graph`, `VIEW.lt` (learn), `VIEW.agent`/`VIEW.manager` (codev),
  `VIEW.analysis` (changelog), `RP.search`, `RP.scm`, `RP.run`, `RP.test`, `RP.remote`,
  `RP.account`, `RP.codev`, `RP.tutor`; sai também o `RP.scm` antigo (corpo completo do pane),
  código morto — sobreposto no mesmo eval pelo shim. **Equivalência:** nenhum desses
  `window.renderX` é reatribuído depois de publicado (o `renderTutorPane` só é publicado pelo
  `tutor.ts`), por isso o registo directo chama a mesma função que o shim; as leituras por
  valor do registo são todas tardias (o pair.ts decora o `VIEW.file` depois; o visualizer o
  `VIEW.lt` no `boot7`); e os testes chamam os `renderX` directamente. O `VIEW.settings` fica
  no `app.ts` até à U4j3, porque é composto lá com a secção Language do i18n e a porta
  desktop. Handlers inline 158 → 152 (os do `RP.scm` morto). Verificado na worktree limpa:
  tsc, lint 269, 438 testes, arch:check, build, auto-teste desktop idêntico ao da U4j1; o
  arranque no browser passou 4/5 — falhou o `arch.e2e.ts` da outra sessão (a paleta responde
  «No results» a «>System architecture»). Medido à parte: o comando está sempre no `CMD`
  depois do arranque (8/8 nas duas builds) e o teste falha também na HEAD sem estas
  alterações (1 em 10; no total, 1/17 na HEAD e 3/16 com elas) — instabilidade do próprio
  teste (uma corrida entre a paleta e a escrita do Playwright), reportada, não corrigida aqui.
- **U4j3 (2026-11-24) — o núcleo de helpers e estado do `app.ts` vai para os donos.** O
  workspace (`features/workspace.ts` e o store) passa a criar e publicar o `FS`/`ROOT`/`OPEN`
  (o `OPEN` inicial com as 6 pastas que o app.ts criava), o `SECOPEN`, os caminhos
  `extOf`/`short`/`norm`, as constantes `P_*` e o `LF`; o `shell.ts` o
  `setVar`/`getVar`/`hydrate` e o `log` (canal Output); o `editor.ts` o `LANG`; o
  `terminal.ts` o `runTask` (chama o `termExec` PUBLICADO, para manter a porta desktop); o
  `tabs.ts` o `rerender` (chama o `show` publicado, o da barra de acções); o `core.ts` ganha o
  `rel` e o `mdFull`, publicados com o `esc`/`hhmm` (iguais aos do core) por um módulo novo,
  `app/globals.ts` (shim de transição: há quem ainda os leia pelo global — fachadas `G.rel`/
  `bridge.hhmm`, learn.ts e pair.ts por nome livre). Saem como código morto `slug`/`pascal`/
  `rid`/`COMMITS0` (sem uso). **Provas:** só o app.ts publicava estes nomes (varredura pela AST
  de todas as publicações no `window`), por isso publicá-los mais cedo não colide com
  ninguém; nenhum módulo os lê no eval antes do app.ts; ninguém reatribui o `FS`/`ROOT`/
  `OPEN` (o app.ts guardava-os em `const` local); o JavaScript emitido de cada função movida
  é igual ao original (`mdFull`, `rel`, `hydrate`, `log`, `extOf`, `short`, `norm`, `P_*`,
  `LF`), e o `runTask`/`rerender` só diferem na forma de resolver os mesmos nomes. **Apanhado
  pelo build, não pelo tsc:** o app.ts ainda tem `@ts-nocheck`, por isso um import de um nome
  não exportado (`LANG`, `rerender`) só falhou no `vite build`; acrescentaram-se os exports e
  confirmou-se pela AST que todos os imports do app.ts resolvem. Um comentário dentro do
  `Object.assign(window, …)` do app.ts fazia a métrica contar nomes a mais; saiu do bloco.
  Globais publicadas 392 → 389; lint 269 → 266. Verificado na worktree limpa sobre a HEAD
  `195ee02` (a outra sessão commitou o arch F2 a meio): tsc, 438 testes, arch:check, build,
  arranque no browser 5/5, auto-teste desktop idêntico ao da U4j2. O `arch.e2e.ts` falhou numa
  verificação intermédia; medido de novo, 10 corridas: HEAD 1 falha, com estas alterações 0
  (no total, 2/27 contra 3/26) — a instabilidade já reportada.
- **U4j4a (2026-11-24) — comandos de terminal, blame, redesenhos, GAPS e AGENTS vão para os donos.**
  O `XC.git` passa a ser o `gitCmd` registado pelo `termgit.ts`; o `docker compose up|down|ps`, o
  `make run|stop` e o `dx run|stop` vão para a `infra.ts` (já dona dos comandos de contentores e a
  primeira, depois do terminal, que os pode registar — o `stack.ts` avalia antes de o `XC`
  existir); o `dx test|sprint` vai para o `board.ts`. Os dois chamam as versões PUBLICADAS
  (`window.dxRun`/`dxStop` com a porta do stack; `window.runSprint`/`dropIssue` com as guardas),
  como o app.ts fazia pelo global. A cadeia do `XC.dx` muda de ordem (antes run/stop → test/sprint
  → deploy → base; agora test/sprint → run/stop → deploy → base), mas os subcomandos são
  disjuntos entre si e da base (lint/status/modo/missao), por isso nenhum muda de resultado. O
  `blame` e a decoração do `stLang` vão para o `editor.ts`: o `stLang` publicado é `stLang` +
  `blame`, e as chamadas internas ao `stLang` local continuam sem ele, como antes. O subscritor do
  `workspace:changed` que redesenhava o grafo/board e chamava o `blame` divide-se pelos donos
  (board, graph, editor — por esta ordem de avaliação, o redesenho continua antes do `blame`; a
  diferença é que, com o isolamento de erros do bus, um redesenho que lance já não impede o
  `blame`). O `GAPS.push` vai para o `codev.ts`, logo a seguir ao `GAPS`, e o
  `Object.assign(AGENTS.*)` para o `team.ts`, logo a seguir ao `AGENTS`. **Provas:** nenhum
  módulo entre o novo dono e o app.ts lê estes nomes no eval (varredura pela AST). Globais
  publicadas 389 → 388. **Correcção ao método de verificação:** o `ui:e2e` local reutiliza
  qualquer servidor na porta 4179 (`reuseExistingServer` fora do CI), e outra sessão verifica
  commits com um `vite preview` nessa porta — por isso, nas verificações desta sessão até à
  U4j3, o arranque no browser pode ter testado a build dela; o auto-teste desktop, o tsc, os
  testes e as comparações no browser com portas próprias são independentes disso. A partir
  daqui o e2e corre com `CI=1` numa porta própria, e o auto-teste desktop da HEAD corre na
  mesma verificação, como referência. Verificado na worktree limpa sobre a HEAD `b700732` (a
  outra sessão commitou o arch F3 a meio, sem tocar nestes ficheiros): tsc, lint 266 (igual),
  458 testes, arch:check, build, e2e 6/6 isolado, auto-teste desktop idêntico ao da HEAD.
- **U4j4b (2026-11-24) — o estado do Co-Dev sai do `app.ts`.** O `PROV`, o `CHAT`, o `RUN`, o
  `SAMPLE`, o `STOP`/`SAFE`/`DANGER`, o `provFor`/`who`, o `provState` com a porta desktop e o
  `VIEW.settings` composto (página do codev + secção Language do i18n + porta desktop) vão para
  o fim do `features/codev.ts`. **Porquê no fim:** o compositor do Co-Dev monta-se no eval do
  codev.ts e lê os provedores tolerando-os por definir; criá-los no `agentStore` (que avalia
  primeiro) mudaria essa montagem inicial. Depois do `mountComposer` a ordem é a mesma que com
  o app.ts, e entre o codev e o app.ts ninguém lê estes nomes no eval (varredura pela AST, e o
  `hydrateHarn` que o team.ts chama no eval não lhes toca). O `MODE`/`ACTIVE`/`THRESH`/`CTX_ON`
  nascem no `agentStore` com os mesmos valores que o app.ts lhes voltava a atribuir, e ninguém
  os escreve antes — as quatro atribuições saem sem efeito. Globais publicadas 388 → 383 (as
  quatro, e o `SAMPLE = null` deixa de ser um `window.X =`). Verificado na worktree limpa sobre
  a HEAD `0aa95b6`: tsc, lint 266 (igual), 458 testes (goldens do Co-Dev sem diff — a montagem
  inicial do compositor ficou igual), arch:check, build, e2e 6/6 isolado, auto-teste desktop
  idêntico ao da HEAD. O app.ts fica com o arranque (`boot`…`boot6`), os menus/paleta/atalhos,
  o `refresh`, o `resetAll` e o `LCUR` — a U4j5.
- **U4j5 — plano (2026-11-24).** O resto do app.ts em duas fatias: **U4j5a** as peças
  autocontidas (o `refresh` e o `resetAll` para o workspace, os atalhos globais para o
  `shortcuts.ts`, o fecho das notificações para o `notifications.ts`, o `cur`/`PANE` que já nascem
  nos stores); **U4j5b** o conteúdo dos menus/paleta (`CMD`/`buildMenus`/`LCUR`) e o arranque
  (`boot`…`boot6`) para módulos tipados — e o app.ts deixa de existir. *Revisto na execução:* a
  U4j5b tipa o app.ts no próprio sítio (só tipos, JS emitido idêntico) e a **U4j5c** divide-o
  em módulos de comandos e de arranque (mover sem mudar) — separar as duas coisas mantém cada
  prova simples.
- **U4j5a (2026-11-24) — refresh, resetAll, atalhos e notificações para os donos.** O `refresh`
  (o sinal «o workspace mudou») e o `resetAll` vão para o `features/workspace.ts`, tipados por uma
  fachada que lê as funções publicadas no acto (o `show` da barra de acções, o `paintEd` com
  breakpoints — as que o app.ts resolvia por nome livre); o listener dos atalhos globais (F1,
  F8, Ctrl+Shift+E/F/G/M/A, Ctrl+P/B/J/`/,/L/G/S, Escape) vai para o `shortcuts.ts`, a seguir ao
  que lá estava (entre os dois módulos nenhum outro regista teclado, por isso a ordem é a mesma);
  o que fecha as notificações num clique fora vai para o `notifications.ts` (nenhum listener de
  clique no document usa `stopImmediatePropagation`, por isso a posição não muda nada). A
  entrada «Repor protótipo» do `CMD`, que guarda o `resetAll` por valor, continua a apanhar a
  mesma função, publicada antes de o app.ts avaliar. **Apanhado pelos testes — e corrigido
  também para a U4j4b:** a atribuição `cur=null`/`PANE='explorer'` do app.ts não tinha efeito
  na app, mas no harness dos testes, que reavalia os módulos a cada teste, o `ownedGlobal`
  herda o valor que ficou no `window` — era o app.ts que os repunha a cada arranque; sem ela, o
  `cur` herdava um separador do teste anterior e dois testes do debug falhavam. O mesmo valia
  para o `MODE`/`ACTIVE`/`THRESH`/`CTX_ON` que a U4j4b tirou (os testes passaram, mas ficou uma
  dependência escondida da ordem). A reposição passa para os donos: cada store repõe o valor
  inicial ao avaliar, logo a seguir a criar o acessor — na app é o valor que já tem; nos testes,
  cada arranque começa limpo. Globais publicadas 383 → 381. Verificado na worktree limpa sobre a
  HEAD `187e36e`: tsc, lint 266 (igual), 458 testes, arch:check, build, e2e 6/6 isolado,
  auto-teste desktop idêntico ao da HEAD.
- **U4j5b (2026-11-24) — o app.ts tipado; nenhum ficheiro com `@ts-nocheck`.** O último ficheiro
  com a directiva passa a ser verificado pelo tsc sem mudar de sítio nem de comportamento: só
  entram tipos. Os nomes livres que o app.ts usa continuam a resolver o global no acto (a versão
  publicada, eventualmente decorada): os que ainda não tinham tipo global declaram-se num bloco
  `declare global` no próprio ficheiro, em vez de se importarem — um import trocaria a resolução
  tardia pela função local do módulo. O `MENUS` vê-se, neste módulo, com o tipo completo dos itens
  (separadores, submenus, `on`) por uma declaração só de tipo; o `CMD` é uma lista de tuplos
  `[rótulo, atalho, acção]`; o resto são asserções não-nulas (`!`, inseridas pela posição exacta
  de cada diagnóstico do tsc) e casts de elementos (`HTMLTextAreaElement`, `Element`). **Prova:**
  o JS emitido (tipos e comentários fora, parênteses canonizados) é idêntico ao da HEAD, à parte
  os parênteses à volta de um parâmetro único de arrow; as contagens de `!=`/`!==`/`==`/`===` não
  mudam. O baseline do A6 (`arch-check.sh`) desce de 11 para 0 e o da métrica do
  `ui-metrics.sh` de 1 para 0. Verificado na worktree limpa sobre a HEAD `f973a74`: tsc, lint
  266 (267 na HEAD), 470 testes, arch:check, build, e2e 6/6 isolado, auto-teste desktop idêntico
  ao da HEAD (25 passos). Falta a U4j5c: dividir o app.ts em módulos e apagá-lo.
- **U4j5c (2026-11-24) — o app.ts divide-se e deixa de existir.** O que restava move-se sem mudar
  para dois módulos de composição, na posição que o app.ts tinha no `main.ts`: o
  `app/commands.ts` (a paleta `CMD`, o `cmd`, o `buildMenus`, o `LCUR` e os comandos da camada
  v3) e o `app/boot-steps.ts` (o `boot` e o `boot3`…`boot6`, que o `startup.ts` chama). Os tipos
  dos globais lidos por nome livre (o bloco `declare global` da U4j5b) passam para o
  `app/ide-globals.d.ts`, só de tipos. Os passos de arranque importam o `CMD`, o `buildMenus` e o
  `LCUR` do `app/commands.ts`: no app.ts eram ligações locais do mesmo módulo, e o import mantém
  isso (não passam a ler a versão do `window`). A publicação divide-se em duas (`CMD`/`buildMenus`
  no fim dos comandos, `PANE`/`boot`… no fim do arranque), com os mesmos nomes; a cadeia do harness
  dos testes vai agora até ao `app/boot-steps.ts`. **Prova:** as instruções de topo do JS emitido
  dos dois módulos, sem imports/exports/publicação, são as do app.ts: as 6 funções iguais (são
  içadas) e as 4 instruções restantes iguais e pela mesma ordem (o `CMD`, o `cmd`, o `LCUR`, o
  `CMD.push` da v3). Verificado na worktree limpa sobre a HEAD `c8a3b38`: tsc, lint 266 (igual),
  484 testes, arch:check, build, e2e 6/6 isolado, auto-teste desktop idêntico ao da HEAD (25
  passos). Fecha a U4j: o monólito deixou de existir; o que fica nos dois módulos
  (o conteúdo dos menus/paleta e o ajuste das listas no arranque) dissolve-se quando cada feature
  registar os seus comandos (U7).
- **U5 — plano (2026-11-24).** Restam 152 handlers inline (contados pela métrica; dois são prosa:
  o texto de um achado da revisão, `<img src=x onerror=…>`, e um comentário do `tasks.ts`). Um
  despachante partilhado, `app/actions.ts`, serve os módulos que não têm o seu: o markup emite
  `data-action="dono:nome"` (+ `data-on`) e o dono regista a tabela. Para que nada mude, o
  despachante faz o que o inline fazia: é o primeiro listener do document (primeiro import do
  `main.ts`), corre cada antepassado com acção pela ordem da borbulha (caminho fixado no início),
  `stop()` faz o `event.stopPropagation()` (pára os antepassados e, por ser o primeiro, os outros
  listeners do document), e cede quando o código troca o handler por `el.onclick = f` (o
  `drawRemote` do infra e o `boot5` fazem-no aos botões da barra). Fatias: **U5a** o despachante e
  a moldura (index.html, os dois botões do arranque, a barra de acções do editor e a página de
  boas-vindas, que guardavam código em string); **U5b** os resíduos sem despachante (pair, tasks,
  team, studio, tutor, graph, search, test, run, remote, explorer, diff, diagnostics, account,
  stack); **U5c** as features com despachante próprio (ext, learn, codev, board) nas suas tabelas
  e o desktop (`DXR.*`); **U5d** o arrastar do kanban (`ondragstart/over/leave/drop`), que os
  goldens do board mostram (o harness não os tira) — pede decisão sobre os snapshots; **U5e** o
  CSP sem `'unsafe-inline'` no `script-src` e a métrica sem a prosa.
- **U5a (2026-11-24) — o despachante partilhado e a moldura do IDE.** O `app/actions.ts` (com
  testes da semântica: borbulha, `stop()`, ordem face aos outros listeners do document, cedência
  ao `el.onclick = f`, caminho fixo quando um handler redesenha, nó de texto como alvo, tipos de
  evento, nomes com dono) e o `app/chrome-actions.ts`: os 27 botões fixos do index.html e os dois
  que o arranque acrescenta (`#pill-agent`, `#st-stack`) passam a `data-action="chrome:f"` e
  chamam a mesma função publicada no acto (`callGlobal`, como o inline, que resolvia o nome no
  window ao clicar). A barra de acções do editor (`tabs.ts`) e a página de boas-vindas guardavam
  o código do handler em string (`'explainCmd()'`, `"goPane('infra')"`); passam a guardar o nome
  da acção (e o argumento) e registam `tabs:*`/`welcome:*`. Nenhum dos nomes chamados colide com
  uma propriedade do elemento ou do document (o inline procurava aí primeiro). Inline 152 → 121.
- **U5b (2026-11-24) — os resíduos sem despachante.** O pair (19), tasks (16), team (15), studio
  (12), graph (8), tutor (4), test (3), search (3), account (2), stack (2), run, remote, explorer, diff
  e diagnostics (1 cada) passam a `data-action="dono:nome"`; cada um regista as suas acções no fim do
  módulo. As acções lêem e escrevem o estado no `window` no acto (`TK`, `BL`, `HARN`, `AGENT`,
  `AGENTS`, `SD`/`SSEL`/`SLINK`/`SCAT`, `DRIFT`, `GSEL`, `LTS`, `FS`, `cur`, `PANE`…) e chamam as funções
  publicadas por nome (`callGlobal`), como o código inline fazia — não passam a usar ligações locais
  dos módulos. O `this` passa a `c.el`, o `this.value` a `c.value`, o `event.target===this` a
  `c.ev.target===c.el`, o `event.stopPropagation()` a `c.stop()`; os números (sprint, linha, índice
  da aresta) voltam a número; os pares (caminho + linha, grupo + estado) viajam em JSON no `data-on`.
  O despachante ganha uma regra: um controlo desactivado não corre a sua acção (o browser não chamava
  o handler inline). Testes de cablagem (`tests/app.actions-wiring.test.ts`): os panes e as vistas
  sem handlers inline, todo o `dono:nome` com dono, e cliques que provam os payloads e o `stop()`.
  **Reportado, não corrigido:** o `board.ts` tira o botão «▶ Delegar» dos cartões do kanban que são
  teus procurando `delegate` no atributo `onclick` — mas esse botão usa `data-action="delegate"` desde
  a extracção do board (Fase 4 do ADR-0002), por isso a procura nunca encontra nada e o botão fica.
  Inline 121 → 31.
- **U5c (2026-11-24) — as features com despachante próprio e o desktop.** O ext (7: a linha da
  lista, os botões da linha com `event.stopPropagation()`, a página de detalhe e o «Install from
  VSIX»), o learn (7: onboarding e editor de exercícios, sobre o `ONB`/`LT_HOOD`/`LTS` do window), o
  codev (a escolha da língua), o board (o «Review diff» do cartão e os três botões dos cartões do
  Co-Dev que o motor emite) e o desktop (`DXR.logs`/`approve`/`gitInit`/`open`) passam a
  `data-action`. Vão pelo **despachante partilhado** (`ext:*`, `learn:*`, `codev:*`, `board:*`,
  `desktop:*`), não pelas tabelas das features: estas só vêem o `[data-action]` mais próximo e correm
  depois dos outros listeners do document (o `closeMenus`, o fecho das notificações), o que mudaria o
  efeito dos `event.stopPropagation()` da lista de extensões. Testes de cablagem acrescentados. Ficam
  os quatro handlers de arrastar do kanban (U5d) e a prosa do achado da revisão. Inline 31 → 5.
- **U5d (2026-11-24) — o arrastar do kanban; goldens do quadro regenerados.** O cartão
  (`board:card`, `dragstart`: põe o id no `dataTransfer`) e a coluna (`board:col`: `dragover` marca e
  previne, `dragleave` desmarca, `drop` desmarca, previne e chama o `dropIssue` publicado com o id e o
  estágio) passam ao despachante partilhado. Nenhum antepassado das colunas e dos cartões tem acção
  da tabela do board, por isso o novo `data-action` não tapa nenhum clique. **Goldens regenerados por
  decisão do dono (2026-11-24):** `board-all` e `board-sprint0` mostravam os atributos `ondrag*`/
  `ondrop`, que o harness não tira; provou-se que o snapshot novo é o antigo com exactamente esses 44
  atributos removidos e nada mais. Teste de cablagem do arrastar (com um `dataTransfer` falso — o
  jsdom não tem). Inline 5 → 1 (a prosa do achado da revisão, que a U5e tira da métrica).
- **U5e (2026-11-24) — o CSP sem `'unsafe-inline'` no `script-src`.** O `tauri.conf.json` passa a
  `script-src 'self'`. O `style-src` mantém `'unsafe-inline'` (decisão §9.3) e, com ele, o
  `dangerousDisableAssetCspModification: true` — se o Tauri injectasse nonces/hashes no `style-src`,
  o browser passaria a ignorar o `'unsafe-inline'` e os `style="…"` gerados deixavam de valer. Nada
  mais precisava de script inline: a única tag do index.html é o módulo `src="/src/main.ts"`, e o
  JSZip do desktop carrega-se de um ficheiro local (`'self'`). A métrica dos handlers passa a contar
  só atributos de verdade (o valor abre com aspas, escapadas ou não), o que tira a prosa do achado da
  revisão (`<img src=x onerror=…>`): 1 → 0. Métrica nova, baseline 0: `script-src` com
  `'unsafe-inline'` no CSP. O auto-teste desktop ganha o passo `csp`: regista as violações do CSP
  durante o auto-teste, procura atributos `on*` no DOM vivo depois de abertas as vistas, e prova que
  o CSP está activo (um handler inline plantado não corre). Fecha a U5.
- **U6 — plano (2026-11-24, decisões do dono).** Duas metades. **CSS primeiro** (decisão do dono):
  o `styles.css` parte-se por dono com prova de que a cascata não muda. **Depois i18n por chaves**
  (§9.2): antes de migrar textos, o harness dos goldens passa a normalizar cada snapshot para inglês
  com o motor actual (decisão do dono: regenerar TODOS os goldens uma vez, com o diff provado igual à
  tradução); a partir daí cada texto que passa a `t("chave")` mantém os goldens iguais, e o golden
  prova que o inglês da chave é o que o motor produzia.
- **U6a (2026-11-24) — o `styles.css` partido por dono.** O `public/styles.css` (1073 linhas, servido
  à parte e ligado no index.html) dá 28 ficheiros: os tokens em `app/styles/theme.css`, a base partilhada
  (reset, controlos, botões, campos, cartões, tabelas, linhas de lista, diálogo) em `app/styles/base.css`,
  a moldura em `features/shell.css`, e cada feature no seu (`features/<f>/styles.css` quando a feature tem
  pasta, senão `features/<f>.css`). O `src/app/styles.ts` importa-os por uma ordem fixa — é a ordem da
  cascata (o Vite junta o CSS pela ordem dos imports) — e é o primeiro import do `main.ts`. Cada regra foi
  para o dono pelo token do seu selector (ou da secção, quando a lista de selectores mistura donos); as
  regras de um dono mantêm a ordem relativa. **Prova:** (1) os blocos dos 28 ficheiros são exactamente os
  do original; (2) análise estática de cada par de regras que trocou de ordem e PODE colidir (mesma
  especificidade, propriedade em comum ou da mesma família de shorthands, sujeito com um token em comum ou
  sem classes): 202 candidatos, e num browser só dois casam o mesmo elemento em algum dos 44 estados — o
  `.sec-hd` (as duas regras põem o mesmo `cursor:pointer`) e o `.cmd-center` com as suas `@media`, um bug
  real que a análise apanhou e se corrigiu (os blocos `@media`/`@container` passam a ter o dono das regras
  que contêm, não o da secção); (3) os estilos computados de todos os elementos, e dos `::before`/`::after`,
  em 46 estados da app (panes, painel, vistas, overlays, menus, uma missão do Co-Dev, o separador «Co-Dev
  run») — 64 576 amostras —
  são iguais antes e depois, com ruído zero entre duas corridas da mesma build, e a ferramenta apanha uma
  mudança de um carácter no CSS (60 212 amostras diferentes). As regras `.lsp-*` que o PR #6 acrescentou
  ao `styles.css` no `origin/develop` (que o `develop` local ainda não tem) foram trazidas tal e qual para
  `features/lsp/styles.css`: quando se juntar o `origin/develop`, o `styles.css` dá um conflito
  modificado/apagado que se resolve mantendo o apagado. O mesmo para os ramos que ainda o editem: as regras novas vão para o
  ficheiro do dono. **O separador «Co-Dev run» (A3, que entrou no `develop` a meio desta fatia) tem o seu
  ficheiro, `features/codev/harness.css`, logo a seguir aos tokens e ANTES da base** — foi o diff dos estilos
  computados que o apanhou (a análise estática só olha para sujeitos com uma classe em comum): o `.hx` do
  separador também casa o `<div class="rowline hx">` da página Team e, no `styles.css`, perdia o `padding`
  para o `.rowline`, que vinha depois; com o separador junto do resto do Co-Dev, depois da base, o `.rowline.hx`
  ganhava 14px 20px 28px em vez de 8px 12px. **Reportado, não corrigido:** o nome `.hx` colide entre o
  separador «Co-Dev run» e a página Team (`team.ts`), por isso o `.hx` do separador aplica `height:100%`,
  `overflow:auto` e a fonte à linha «Detected context» da página Team. **Corrigido no merge da A6
  (2026-11-24):** a raiz do separador passou a `.hx-run` (`harness-view.ts`, `harness.css`, e2e); o `.hx` volta a
  ser só da página Team, e a linha «Detected context» fica com o `padding` 8px 12px do `.rowline` e sem as regras
  do separador.
- **U6b (2026-11-24) — goldens em inglês e a fundação dos textos por chave (piloto: Source Control).**
  (1) O `golden()` do harness passa o clone pelo motor de tradução (`trNode`, `LOCALE='en'`), salvo se um
  antepassado estiver no `TR_SKIP` (que sai para o módulo puro `features/i18n/skip.ts`, partilhado com o harness).
  Regeneraram-se, por decisão do dono, os 11 goldens que tinham texto por traduzir (board ×3, codev ×4, scm ×4):
  provou-se que cada snapshot novo é exactamente o antigo passado pelo motor, e os outros ficaram iguais.
  (2) `src/app/i18n.ts`: `translator(catálogo)` dá o `t` tipado de uma feature — o texto na língua actual (`LOCALE`,
  do motor), `{nome}` → parâmetro, inglês como recurso. Os catálogos (`en` + `ptAO`) nascem do motor: os valores
  são os que ele produzia para o texto que estava no markup. Convive com o motor: o texto já sai na língua certa e o
  motor não tem par para o trocar. (3) Piloto: o pane Source Control (`features/scm/ui/messages.ts`, 15 chaves —
  títulos, placeholder, botão de commit com `{staged}`/`{branch}`, grupos, linhas). Os 4 goldens do pane ficaram
  iguais com as chaves (prova do inglês de cada uma); `tests/i18n.catalogs.test.ts` prova cada entrada contra os
  pares do motor no sentido da origem (algumas regras só vão de português para inglês) e desenha o pane em `ptAO`.
  (4) Métrica nova, só desce: pares de texto do motor (`PAIRS`), hoje 1005 — os textos novos nascem com chave e os
  pares saem quando deixarem de ter quem os use. **Reportado, não migrado:** as duas mensagens do pane sem
  repositório git («Esta pasta não é um repositório git…», «Nenhum repositório git aberto…») não têm par no motor e
  aparecem em português na interface em inglês; dar-lhes inglês muda o que se vê, por isso ficam fora do piloto.
