---
session: a6d6d2e8-f538-4db5-8af8-0df66cd4045d
opened: 2026-11-16T13:33:00+01:00
branch: worktree-modular-ui-app
status: closed
closed: 2026-11-16T14:05:00+01:00
---

# Objective
Migrar o pane-folha `RP.search` («Pesquisa») do monólito `app.ts` para `ui-app/src/features/search.ts`, consumindo o `core` tipado por import real e movendo também os leaves `doSearch`/`replaceAll`, sem quebrar a UI.

# Done when
- [x] `ui-app/src/features/search.ts` existe (strict, SEM `@ts-nocheck`), importa do `../core`, detém `doSearch`/`replaceAll` e publica `window.renderSearchPane`; `app.ts` delega `RP.search=()=>window.renderSearchPane()`.
- [x] `npm run ui:build` → `✓ 18 modules transformed` (N=18>17).
- [x] Probe CDP `errors:[]` após `window.setPane('search')` (preencher `#s-q` e disparar `oninput`); sem regressão nos panes já migrados.

# Out of scope
- Migrar os restantes panes (scm/ext/codev e outros) — só `search` nesta sessão.
- Tocar na lógica de `FS`/`refresh`/`fIcon`/`openPath` (ficam window-resolved).
- Desfazer as camadas transitórias v5/v6/v7.

# Handoff
Delivered: Pane «Pesquisa» migrado para `ui-app/src/features/search.ts` (strict, 0 `@ts-nocheck`, importa `{ $, hd, esc, toast }` de `../core`), detendo os DOIS leaves `doSearch`/`replaceAll` e publicando `window.renderSearchPane/doSearch/replaceAll`. `app.ts:182` delega `RP.search=()=>window.renderSearchPane()`. **GOTCHA C tratado:** mover os leaves removeu as defs de topo → limpei a def E a entrada no `Object.assign(window,…)` de `doSearch` e `replaceAll` (senão ReferenceError pára o chunk). `core.ts` ganhou fachadas tipadas `FS`/`fIcon`/`refresh` + decls `Window` `doSearch`/`replaceAll`/`renderSearchPane`; `index.html:137` carrega `search.ts` entre `test.ts` e `app.ts`. Provas re-corridas no fecho: `npm run ui:build` → `✓ 18 modules transformed`; probe CDP (`.../a6d6d2e8-…/scratchpad/probe.mjs`) → `errors:[]`, e exercitando os leaves (arranque limpo dá FS vazio → probe injecta 1 `.rs`): `searchRan`, `searchRows:1`, `searchHasFIcon` (window.fIcon correu), `replaceAllMutatedFS:true`, `afterReplaceRows:0`; regressões test(3)/run(6)/account/remote/notes verdes.
Not delivered: nada — 3/3 critérios confirmados. Sem commit (fora de âmbito; árvore fica com `core.ts`+`features/{account,remote,run,test,search}.ts`+`app.ts`+`index.html` por commitar sobre HEAD 3dceb7a).
Learned: `search` NÃO é render quase-puro (ao contrário de run/test): os leaves leem/mutam `FS`, compõem `fIcon` e chamam `refresh` → ficam window-resolved via fachadas tipadas no core (fachada de DADO = função/propriedade lazy, nunca capturada no eval). Os shims `window.doSearch` (comando Todo Tree em `v6.ts:251`) e `window.replaceAll` (botão `onclick="replaceAll()"`) são precisos porque o residual chama por nome livre — resolvidos no clique/comando, e `search.ts` carrega antes de `app.ts`. **Inventário do que falta à modularização (medido este turno):** registo `RP` tem 12 panes; 5 migrados (remote/account/run/test/search); faltam 7 — `scm`(2ª def app.ts:654, grande), `codev`(app.ts:891), `tutor`(app.ts:941), e `ext`/`infra`/`debug`/`tasks` cujo dono VIVO está em `v6.ts` (ext:266, infra:168, debug:230, tasks:50) → migrá-los obriga a mexer na camada transitória v6 (`@ts-nocheck`). Já não há pane-folha trivial só-em-app.ts. Modularização completa = 7 panes + desmontar v5(138)/v6(373)/v7(454) + extrair ~1200 linhas não-pane de app.ts (terminal/XC/git/co-dev/palette/editor).
Next session: Migrar os 7 panes restantes (scm/codev/tutor de app.ts + ext/infra/debug/tasks de v6) para `features/` — fan-out paralelo na análise/rascunho de cada pane, integração SERIAL com gate `ui:build`+probe a cada passo (os 7 tocam os mesmos app.ts/core.ts/index.html; merge cego = conflito/ReferenceError).
