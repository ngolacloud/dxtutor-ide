# ADR-0004 — Migração da ui-app para Clean Architecture (Etapa 4 do MIGRATION)

- **Estado:** aceite (recomendações do §9 aceites a 2026-11-23); U0–U2 feitas, U3 em curso
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
