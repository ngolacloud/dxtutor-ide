---
session: 133528e9-94bd-4462-b407-e5a9e11679e7
opened: 2026-11-16T13:21:38+01:00
branch: worktree-modular-ui-app
status: closed
closed: 2026-11-16T13:26:22+01:00
---

# Objective
Migrar o pane-folha `RP.test` («Testing») do monólito `app.ts` para `ui-app/src/features/test.ts`, consumindo o `core` tipado por import real, sem quebrar a UI.

# Done when
- [x] `ui-app/src/features/test.ts` existe (strict, SEM `@ts-nocheck`), importa do `../core`, publica `window.renderTestPane`; `app.ts` delega `RP.test=()=>window.renderTestPane()`.
- [x] `npm run ui:build` → `✓ 17 modules transformed` (N>16).
- [x] Probe CDP `errors:[]` após `window.setPane('test')` (testPaneShown/testHasHeader/testHasRunAllOnclick/testRows:3 verdes; sem regressão em run/account/remote/notificações).

# Out of scope
- Migrar os restantes panes (`search` e outros) — só `test` nesta sessão.
- Tocar na lógica de `runTests`/`openPath`/`runTask` (ficam window-resolved).
- Desfazer as camadas transitórias v5/v6/v7.

# Handoff
Delivered: Pane «Testing» migrado para `ui-app/src/features/test.ts` (strict, 0 `@ts-nocheck`, importa `{ $, hd, svg, esc }` de `../core`, publica `window.renderTestPane`). `app.ts:205` delega `RP.test=()=>window.renderTestPane()` (só reescreveu o corpo da prop → sem GOTCHA C). `core.ts` ganhou decls `Window.runTests` (tipada: `(pkg?)=>{build,err,ok,tests[]}`) + `renderTestPane`; `index.html:135` carrega `test.ts` entre `run.ts` e `app.ts`. Provas re-corridas no fecho: `npm run ui:build` → `✓ 17 modules transformed`; probe CDP (`.../133528e9-…/scratchpad/probe.mjs`) → `errors:[]`, `testPaneShown/testHasHeader/testHasRunAllOnclick/testHasSvgIcon`=true, `testRows:3`, regressões run(`runRows:6`)/account/remote verdes.
Not delivered: nada — 3/3 critérios confirmados. Não foi feito commit (fora de âmbito; a árvore fica com `core.ts`+`features/{account,remote,run,test}.ts`+`app.ts`+`index.html` por commitar sobre HEAD 3dceb7a).
Learned: `runTests` fica no monólito e resolve-se via window — bastou tipá-lo no `declare global` do core (`Window.runTests`) para a folha o chamar sem cast. Os `onclick="runTask(...)"`/`openPath(P_LX,10)` inline já eram window-resolved (`Object.assign` do app.ts). Único pane SEGURO restante (só em app.ts): `search` (app.ts:182) — mas é corpo GRANDE com leaves `doSearch`/`replaceAll` + lê `FS`, não é render quase-puro como run/test.
Next session: Migrar o pane `RP.search` («Pesquisa») para `features/search.ts`, movendo também os leaves `doSearch`/`replaceAll`.
