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
   Co-Dev (`genBacklog`/`runIssue` chamam `routeModel`).

   Mecânica (igual às migrações anteriores): esta feature avalia ANTES de `app.ts`
   (ordem do index.html), por isso publica o motor no `window` no eval — os nomes
   livres do monólito (`CAP`, `TASKP`, `rankModels(…)`, `routeModel(…)`) resolvem no
   escopo GLOBAL em runtime. Nada é lido ansiosamente no eval: os globais que o motor
   consome do monólito (`connected`, `AGENTS`, `ACTIVE`, `PROV`, `SAMPLE`) só são
   tocados DENTRO das funções, chamadas depois do arranque e do Object.assign de
   `app.ts`. `window.LIVE_OK=false` inicializa-se aqui (router carrega antes de app.ts
   e de bridge.ts, que o põe a `true` quando a amostragem ao vivo fica disponível). */

import { CAPL, CAP, TASKP, rankProviders, topCapabilities, type TaskKind } from "./router/domain/model-routing";

window.LIVE_OK=false;const ROUTE_CACHE: Record<string, { p: string; why: string; by: string }>={};
/* perfis e pontuação: domain/model-routing.ts (puro, testado); aqui só o lado com efeitos */
export function rankModels(task: string){return rankProviders(task,connected());}
async function routeModel(agent: string,title: string){const a=AGENTS[agent] as { n: string; task: string; model: string },task=a.task,r=rankModels(task);if(!r.length)return{p:ACTIVE,why:'nenhum provedor ligado',by:'—'};
  if(a.model!=='auto'&&PROV[a.model].on)return{p:a.model,why:'fixado no harness do assistente',by:'harness'};
  const top=topCapabilities(task),heur={p:r[0].p,why:`tarefa de ${TASKP[task as TaskKind].l.toLowerCase()}: pesa mais ${top}`,by:'perfil'};
  if(!SAMPLE||!LIVE_OK)return heur;if(ROUTE_CACHE[task])return ROUTE_CACHE[task];
  try{const ac=new AbortController(),tm=setTimeout(()=>ac.abort(),7000);const res=await SAMPLE(`Escolhe o melhor modelo para esta tarefa de desenvolvimento.\nTarefa: ${title}\nTipo: ${TASKP[task as TaskKind].l}\nModelos disponíveis (capacidades 0-10): ${JSON.stringify(Object.fromEntries(r.map(x=>[x.p,CAP[x.p]])))}\nResponde só com JSON: {"provider":"<id>","why":"<uma frase em português>"}`,{modelTier:'quick',signal:ac.signal});clearTimeout(tm);
    const j=JSON.parse((res.text.match(/\{[\s\S]*\}/)||['{}'])[0]);if(PROV[j.provider]&&PROV[j.provider].on)return ROUTE_CACHE[task]={p:j.provider,why:String(j.why||'').slice(0,140),by:'LLM'};}catch(e){}
  return heur;}

/* publica o motor no window — o resíduo do monólito (VIEW.team, genBacklog, runIssue)
   resolve estes nomes como globais em runtime (padrão de inversão). */
Object.assign(window,{CAPL,CAP,TASKP,ROUTE_CACHE,rankModels,routeModel});
