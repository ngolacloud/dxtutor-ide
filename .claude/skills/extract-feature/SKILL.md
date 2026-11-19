---
name: extract-feature
description: >-
  Extrai uma feature do monólito da UI (ui-app/src/app.ts/v5.ts/v6.ts) para
  Clean Architecture em features/<nome>/ (domain/application/ui/infrastructure),
  seguindo o precedente da feature Co-Dev (ADR-0002). Formaliza o procedimento
  das Fases 0–4: rede de segurança golden → bridge tipado → domínio puro → casos
  de uso → componentes (data-action), congelando UI e comportamento (zero diff de
  golden). Usar quando o utilizador quer componentizar/extrair uma feature
  (debug, ext, infra, scm, visualizer, board, ou o núcleo do monólito) por
  FUNCIONALIDADE com fronteiras tipadas, sem window-globals nem @ts-nocheck novos.
---

# extract-feature — extrair uma feature para Clean Architecture

Precedente: a feature Co-Dev (`ui-app/src/features/codev/`), ADR-0002
(`docs/architecture/ADR-0002-codev-clean-architecture.md`). Replica este caminho
para a próxima feature. **Lê o `CLAUDE.md` da raiz primeiro** (mapa de camadas,
regra de dependências, invariantes, comandos).

## Princípios inegociáveis

- **UI e comportamento congelados.** Zero diff de golden em todas as fases. Não
  mudar markup, não mover lógica para Rust, não renomear comandos públicos, não
  actualizar dependências. Bugs encontrados reportam-se, não se corrigem aqui.
- **Cada commit deixa a app corrível.** Estrangular por fases (strangler-fig), não
  reescrever big-bang.
- **Features novas nascem tipadas** — sem `@ts-nocheck` novo (A6 do `arch:check`
  não pode crescer) e sem `any` fora do bridge.

## Fases (cada uma = 1 sessão com contrato próprio e gate verde)

0. **Rede de segurança.** Modo de teste determinístico (relógio fixo, seed fixa);
   testes golden do markup da feature + caracterização dos fluxos. Goldens
   committed. A partir daqui, diff de golden = falhou → corrige o código, nunca o
   snapshot. (Ver skill `ui-golden-check`.)
1. **Bridge tipado.** `features/<nome>/infrastructure/legacy-bridge.ts` como ÚNICO
   ponto de leitura/escrita de `window.*`, com tipo real por global. Substituir
   leituras livres por imports do bridge; remover `@ts-nocheck`; zero `any` fora do
   bridge.
2. **Domínio puro.** Extrair `domain/` (tipos, policy, scoring, cenários) sem
   DOM/`window`/Tauri e sem importar de `application/`/`ui/`/`infrastructure/`.
   Testes unitários Vitest por função extraída.
3. **Portas e casos de uso.** `application/ports.ts` + mover a orquestração para
   `application/` sem HTML, com deps injectadas por argumento e cancelamento por
   `AbortSignal`; `ui/` implementa os presenters/gates; `index.ts` como raiz de
   composição.
4. **Componentes.** `ui/` puro (dados → markup); `onclick` inline → `data-action` +
   um listener delegado no `document`; escapar todo o valor interpolado (`esc`) e
   **reportar cada ponto onde escapar muda a saída** (não mudar em silêncio).

## Gate de cada fase (tudo verde antes de commitar)

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
npm run ui:build   # tsc --noEmit + vite build
npm run ui:test    # vitest: unitários + golden (zero diff)
npm run arch:check # A1–A8 verdes; A7/A8 impõem as fronteiras da feature
```

Commit convencional + resumo curto (o que mudou, o que ficou, riscos) +
**aprovação do dono antes da fase seguinte**.

## Fronteiras que o `arch:check` impõe (A7/A8)

A7/A8 estão escritos para `features/codev`. Ao extrair uma feature nova, **alarga
a lista de roots** verificados em `scripts/arch-check.sh` (variável `CODEV` →
generalizar para iterar sobre as features extraídas), para que a nova subárvore
também seja governada: `domain/` não importa de fora; só `legacy-bridge.ts` toca
`window`. O resíduo strangler (`features/<nome>.ts`, fora da subárvore) fica de
fora até os consumidores migrarem.

## Armadilhas aprendidas (feature Co-Dev)

- O golden strippa **exactamente** `onclick`/`onchange`/`oninput`/`data-action`/
  `data-on` — todo o payload viaja em `data-on`; um `data-*` à medida vazaria.
- O tipo de evento DOM fica na entrada da tabela de acções (change vs input vs
  click) para o listener único não disparar cruzado.
- Os shims `window.*` que outros ficheiros (app.ts/board.ts) ainda resolvem por
  global são legítimos e transitórios — mantêm-se até o passo 6 (window.FS → Tauri).
- Primitivos escritos no resíduo @ts-nocheck ficam window-puros (strict-mode);
  estado hidrata de `LS` PREGUIÇOSAMENTE (as features avaliam antes de app.ts).
