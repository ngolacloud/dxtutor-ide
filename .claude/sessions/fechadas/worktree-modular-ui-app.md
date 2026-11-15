---
session: 11a9e12d-fe59-4e7b-81e7-3e492c1c4f61
opened: 2026-11-15T23:32:49+01:00
branch: worktree-modular-ui-app
status: closed
closed: 2026-11-16T00:20:00+01:00
---

# Objective
Modularizar o monólito `ui-app/src/app.ts` extraindo as suas camadas de geração (v3–v7 + i18n) para módulos ESM próprios em `ui-app/src/*.ts` (Fase A, por camada temporal — ver nota), por extracção incremental verificável, preservando o mecanismo window/late-binding e o system design — sem quebrar a UI e sem copiar código do dxtutor.

> Nota de arquitectura: o `app.ts` não é vistas lado-a-lado mas decoração progressiva em camadas (cada geração decora funções/vistas das anteriores por ordem de execução). A Fase A fatia por camada (seguro/mecânico). A consolidação por-feature (studio.ts reúne as suas 3 camadas) é Fase B, sessão futura.

# Done when
- [ ] As camadas v3–v7 (+i18n) do `app.ts` vivem em módulos próprios sob `ui-app/src/`, carregados na ordem correcta, e o `app.ts` fica reduzido ao núcleo (v2) + publicação/arranque
- [ ] `npm run ui:build` (tsc --noEmit + vite build) passa verde no estado final e foi verificado verde a cada fase de extracção
- [ ] Selftest headless arranca a UI sem erros de consola (cargo build + `DXTUTOR_SELFTEST`)

# Out of scope
- Runner de testes elegante (ciclo, progressos, auto-detecção de unittests) — sessão própria
- Melhor ferramenta de Debug — sessão própria
- Bugtrack inteligente (detectar bugs no projecto activo, abrir issues com prova automática) — sessão própria
- Tipar a sério os módulos (remover `@ts-nocheck`) — fase posterior; esta sessão só componentiza
- Qualquer alteração a `main` ou troca de `frontendDist` para `ui-next` (proibido por memória)

# Handoff

Delivered: Dos 3 critérios, nenhum totalmente cumprido, mas progresso verificado — 4 commits sobre a base, `main` intocado, worktree limpo (HEAD `bfb3fdf`). (1) base `e992be8` (fases 4-5 de main espelhadas p/ o worktree). (2) `ae83818` — camada **v7** (Visualize execution: lexer/parser/interpretador Rust-subset + overlay) extraída p/ `ui-app/src/v7.ts` (454 linhas). (3) `6c2de6a` — arranque `boot();…boot7();i18nBoot()` separado p/ `ui-app/src/startup.ts`. Cadeia: `boot→app(core)→v7→startup→bridge→pair`. Evidência: `npm run ui:build` verde (8 módulos, `✓ built`); `cargo build` 13-17s; selftest headless `errors:[]` em 2 pontos (v7 e startup), UI completa (8 menus, `sample:function`). Prova estrutural de late-binding: no bundle minificado `boot7()` fica LITERAL (global) ao lado das `bootN` léxicas renomeadas (`Tr();qr();…`).

Not delivered: Critério 1 — faltam extrair v6, v5, v4, v3, i18n (`app.ts` ainda 1669 linhas). Bloqueio: não é mecânico como v7 — v6-v3 DECORAM funções do core (`const _x=x;x=function`), que divergem se ficarem `function X` léxica noutro módulo; exige window-backing no core ANTES de cada extracção, com verificação cuidada (o selftest não apanha divergências visuais). Parado deliberadamente p/ não arriscar quebrar a UI no fim de sessão longa. Critérios 2 e 3 só verdes no estado PARCIAL, não no final.

Learned: (a) `app.ts` é decoração progressiva em camadas v2→v7, NÃO vistas lado-a-lado; fronteiras feature≠camada. (b) Padrão de extracção por camada = define léxico + `Object.assign(window,…)`; camadas-que-decoram carregam DEPOIS do core; arranque explícito no último módulo. (c) window-backing: `refresh`/`dxDeploy` já são `window.X=`; `diagnostics/show/paintEd/approveIssue/badges/drawStudio/applyTemplate` ainda `function X` léxica → converter antes de extrair a camada que as decora. (d) Gotchas de verificação (→ memória `dxtutor-build-verify-workflow`): HOME temp SEMPRE novo (reusar → exit 1 silencioso), NUNCA pipe `|head` (SIGPIPE→falso timeout), `DISPLAY=:0` real funciona, `pkill -x` (não `-f`, mata o shell).

Next session: Extrair a camada v6 do `app.ts` para `ui-app/src/v6.ts` (window-backing das funções que decora + verificação ui:build/selftest), como primeira das restantes v6→v3+i18n.
