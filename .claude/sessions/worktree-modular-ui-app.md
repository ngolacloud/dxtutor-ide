---
session: 11a9e12d-fe59-4e7b-81e7-3e492c1c4f61
opened: 2026-11-15T23:32:49+01:00
branch: worktree-modular-ui-app
status: open
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

Estado em 2026-11-16 (worktree `worktree-modular-ui-app`, 3 commits sobre a base):

**Feito e verificado (ui:build + cargo build + selftest headless `errors:[]`):**
1. `e992be8` — base: espelhadas as fases 4-5 de `main` para o worktree (main intocado).
2. `ae83818` — **camada v7 extraída** para `ui-app/src/v7.ts` (Visualize execution: lexer/parser/interpretador Rust-subset + overlay). Prova de late-binding: no bundle, `boot7()` fica literal (global) ao lado das outras `bootN` minificadas.
3. `6c2de6a` — **arranque separado** para `ui-app/src/startup.ts`. Cadeia actual: `boot → app(core) → v7 → startup → bridge → pair`.

**Mecanismo (confirmado):** o `app.ts` é decoração em camadas; cada módulo-camada DEFINE funções léxicas (chamadas internas directas) + publica no `window` via `Object.assign`; deps do core e funções decoradas cross-módulo são referências LIVRES (→ window, late-binding). Carregar camadas que decoram o core DEPOIS do core; arranque `bootN()` no `startup.ts` (último).

**Próximos passos — extrair v6, v5, v4, v3, i18n (nesta ordem, uma por fase, verificando ui:build+selftest a cada):**
- Fronteiras no `app.ts` actual: v3 `/*═ v7...` já saiu; localizar banners `═ v3/v4/v5/v6 ═` e `PAIRS`(i18n). Cortar cada bloco → `vN.ts`, inserir `<script>` em `index.html` ENTRE `app.ts` e `v7.ts` por ordem crescente (`app → v3 → v4 → v5 → v6 → v7 → startup`), remover nomes definidos do `Object.assign` do app.
- **ARMADILHA-CHAVE (window-backing):** uma função decorada por uma camada noutro módulo diverge se ficar `function X` léxica no core (o core chamaria a versão não-decorada). Antes de extrair cada camada, converter no core/camada-origem `function X(){…}` → `window.X = function(){…}` para TODAS as que a camada decora. Para v6 isso é: `approveIssue, drawStudio, diagnostics, paintEd, show, badges, applyTemplate` (+ verificar `runIssue`, `delegate` que são const/async). `dxDeploy`, `refresh` já são window-backed. Cuidado com HOISTING: `window.X=` não é hoisted — garantir que nada o chama no top-level antes da linha.
- **Verificação por fase:** `npm run ui:build` → `cargo build --manifest-path src-tauri/Cargo.toml` (com `CARGO_TARGET_DIR=<repo>/target`) → selftest com **HOME temp NOVO** (`rm -rf`+`mkdir`), `DISPLAY=:0`, redirect a ficheiro (NUNCA pipe `|head`), veredicto `report.errors===[]`. Ver memória `dxtutor-build-verify-workflow`.
- Fase B (sessão futura, fora deste contrato): consolidar por-feature (ex. `studio.ts` reúne base v3 + decoradores v5/v6).
