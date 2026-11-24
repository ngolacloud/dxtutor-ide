/* ═════════ dxtutor IDE — feature: router de modelos (motor) ═════════
   Feature-folha (padrão de inversão Debug/SCM/ext): passa a DONA do motor «router
   de modelos» que vivia no monólito `app.ts`. Motor denso que cruza globais do
   monólito; já tipado (sem supressão de tipos): os globais consumidos resolvem-se por
   window via o contrato ambiente (pair.ts/core.ts) e os perfis estão tipados como Record.

   Fronteira: a feature DETÉM os perfis (`CAPL` rótulos de capacidade, `CAP` matriz
   provedor×capacidade, `TASKP` pesos por tipo de tarefa), a cache (`ROUTE_CACHE`),
   o estado `LIVE_OK` (amostragem ao vivo disponível) e as funções `rankModels`
   (ordena provedores ligados para uma tarefa) e `routeModel` (escolhe o modelo —
   fixado no harness, heurística por perfil, ou pergunta ao LLM via `SAMPLE`).

   Os CONSUMIDORES ficam no monólito e lêem por global: a secção «Router de modelos»
   do `VIEW.team` (tabela `CAP`/`CAPL` + ranking por `TASKP`/`rankModels`) e o motor
   Co-Dev (`genBacklog`/`runIssue` chamavam `routeModel`).

   ADR-0004, U7a: o `routeModel` e a sua cache `ROUTE_CACHE` saíram — já ninguém os chamava (nem por nome, nem pelo
   window); o `rankModels` e os perfis ficam.

   Mecânica (igual às migrações anteriores): esta feature avalia ANTES de `app.ts`
   (ordem do index.html), por isso publica o motor no `window` no eval — os nomes
   livres do monólito (`CAP`, `TASKP`, `rankModels(…)`, `routeModel(…)`) resolvem no
   escopo GLOBAL em runtime. Nada é lido ansiosamente no eval: os globais que o motor
   consome do monólito (`connected`, `AGENTS`, `ACTIVE`, `PROV`, `SAMPLE`) só são
   tocados DENTRO das funções, chamadas depois do arranque e do Object.assign de
   `app.ts`. `window.LIVE_OK=false` inicializa-se aqui (router carrega antes de app.ts
   e de bridge.ts, que o põe a `true` quando a amostragem ao vivo fica disponível). */

import { rankProviders } from "./router/domain/model-routing";

window.LIVE_OK=false;
/* perfis e pontuação: domain/model-routing.ts (puro, testado); aqui só o lado com efeitos */
export function rankModels(task: string){return rankProviders(task,connected());}

/* (ADR-0004, U7d) já não publica nada no window: o team importa o rankModels e os perfis vêm do domínio */
