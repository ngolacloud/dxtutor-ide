---
name: add-port-adapter
description: >-
  Acrescenta uma porta (interface em application/ports.ts) e o seu adaptador
  (implementação em infrastructure/legacy-bridge.ts ou futuro adaptador Tauri) a
  uma feature já em Clean Architecture, mantendo os casos de uso puros e o acesso
  a window confinado ao bridge. Usar quando um caso de uso precisa de uma
  capacidade nova do mundo exterior (ficheiros, terminal, provider LLM, scm,
  checkpoints, relógio, notificações) e queremos injectá-la por porta em vez de
  chamar window.* directamente, ou ao trocar o adaptador legacy-bridge (window.FS)
  por um comando Tauri real (ADR-0002, passo 6).
---

# add-port-adapter — porta + adaptador sem furar as camadas

Uma **porta** é uma interface em `application/ports.ts` (o que o caso de uso
precisa, em termos do domínio). Um **adaptador** implementa-a contra o mundo real
(`infrastructure/legacy-bridge.ts` hoje; comando Tauri amanhã). O caso de uso
recebe a porta **por argumento** — nunca chama `window.*` nem importa o bridge.

## Procedimento

1. **Define a porta** em `application/ports.ts`: uma interface mínima, em
   vocabulário do domínio, não da implementação. Ex.: `Workspace.readFile(path):
   Promise<string>`, não `fsRead(p)`. Sem tipos de DOM/Tauri na assinatura.
2. **Implementa o adaptador** em `infrastructure/legacy-bridge.ts` (único ficheiro
   que toca `window.*`), com tipo real por global. Para um adaptador Tauri novo,
   usa um ficheiro irmão em `infrastructure/` (ex. `tauri-fs.ts`) que invoca o
   comando — mas mantém `window` só no bridge.
3. **Injecta na composição** (`index.ts`): passa o adaptador ao caso de uso ao
   compô-lo. O caso de uso continua a depender só da interface.
4. **Caso de uso puro**: consome a porta pelo parâmetro. Nada de DOM/`window`/HTML;
   cancelamento por `AbortSignal`.
5. **Teste unitário** do caso de uso com um **fake** da porta (objecto simples que
   implementa a interface) — sem jsdom, sem bridge. Prova que a lógica é testável
   sem o mundo.

## Invariantes a respeitar (verificados por `arch:check`)

- `application/` e `domain/` **nunca** importam `infrastructure/` nem tocam
  `window` (A8). A direcção é: `index.ts` conhece ambos e liga-os.
- `domain/` não conhece `application/`/`ui/`/`infrastructure/` (A7) — uma porta vive
  em `application/`, não em `domain/`.
- Sem `@ts-nocheck` novo (A6); sem `any` fora do bridge.

## Gate

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
npm run ui:build && npm run ui:test && npm run arch:check
```

Zero diff de golden (uma porta nova não muda markup). Ver `ui-golden-check`.

## Ao trocar window.FS → comando Tauri (passo 6 do ADR-0002)

Troca-se **só o adaptador**: a porta `Workspace` (e a interface) fica igual, os
casos de uso e o domínio não mudam, o golden não mexe. É a prova de que as
fronteiras valem a pena — a implementação do mundo muda sem tocar no núcleo.
