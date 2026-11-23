# ADR-0004 — Migração da ui-app para Clean Architecture (Etapa 4 do MIGRATION)

- **Estado:** aceite (recomendações do §9 aceites a 2026-11-23); U0 em curso
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
| `@ts-nocheck` | **7** (`app`, `boot`, `v5`, `v6`, `startup`, `features/infra.ts`, `features/visualizer.ts`) |
| Globais | 174 nomes atribuídos a `window.X`; 40 `Object.assign(window, …)`; ~210 leituras `window.*` no monólito |
| Substituições em runtime | 31 decorações `const _x = x; x = …` (11 no `bridge.ts`), mais o `bootN`/`v5`/`v6` |
| Handlers inline | 219 `on*=` no HTML gerado (+25 no `index.html`) contra 164 `data-action` |
| IPC | 21 comandos ainda por `inv("…")` cru no `bridge.ts`; 19 já por `platform/tauri/` tipado |
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
| **U2 — Adaptador desktop tipado** | Os 21 `inv("…")` passam a clientes `platform/tauri/*`; o objecto `DXR` e as 11 substituições do `bridge.ts` passam a um `platform/desktop/` com portas injectadas pelo `main.ts` (o modo browser injecta a simulação) | `bridge.ts` sem `inv` cru nem substituições; tipado |
| **U3 — Estado por proprietário + event bus** | `app/store/` com proprietários tipados — workspace (FS, árvore, raiz), editor (tabs, activa), agente (modo, provedor, chat), git, terminal, aprendizagem, colaboração — e um bus de eventos tipado (`files:changed`, `tab:activated`, `mode:changed`…) que substitui os `refresh()`/`badges()` globais | Os 17 globais de estado com dono; consumidores migrados por feature |
| **U4 — Absorver o monólito** | `boot`/`app`/`v5`/`v6`/`startup` dissolvem-se nas features donas (menus, actividade, painéis, atalhos); as 31 decorações viram composição explícita no `main.ts`; `infra`/`visualizer` tipados | **0 `@ts-nocheck`**; nenhuma decoração em runtime |
| **U5 — Handlers e CSP** | Os 244 `on*=` inline passam a `data-action` com listener delegado por feature; depois tira-se o `'unsafe-inline'` do `script-src` | 0 `on*=`; CSP sem `unsafe-inline` nos scripts |
| **U6 — i18n por chaves e CSS por feature** | Textos com chave (`t("codev.composer.placeholder")`) e catálogos `pt-AO`/`en`, com o motor de correspondência como recurso durante a transição; `styles.css` partido em `features/*/styles.css` importados pela feature (tokens globais num `theme.css`) | Sem pares de texto novos; CSS da feature junto da feature |
| **U7 — Consolidação** | Fim das fachadas window-backed e dos shims `Object.assign(window, …)` restantes; regras finais no `arch-check`; `MIGRATION.md`/`ARCHITECTURE.md` actualizados | Métricas no alvo; docs coerentes |

Ordem e paralelismo: U0 → U1 → (U2 ∥ U3) → U4 → U5 → U6 → U7. U6 (i18n/CSS) não depende
das outras e pode adiantar-se se for útil.

## 5. Métricas-alvo (arch-check)

| Métrica | Hoje | Alvo |
|---|---|---|
| `<script>` no `index.html` | 43 | 1 |
| `@ts-nocheck` | 7 | 0 |
| `window.X =` fora de adaptadores | 174 | 0 |
| `on*=` inline | 244 | 0 |
| `inv("…")` cru | 21 | 0 |
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
