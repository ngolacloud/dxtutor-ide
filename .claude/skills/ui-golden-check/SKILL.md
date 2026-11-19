---
name: ui-golden-check
description: >-
  Verifica que um refactor de UI deixou o markup renderizado byte-idêntico — corre
  os testes golden/caracterização do ui-app e confirma zero diff de snapshot. Usar
  depois de qualquer mudança em ui-app/src/ que se diz congelar o comportamento
  (extracção de feature, troca de onclick→data-action, mover render), antes de
  commitar; e para decidir se um diff de golden é regressão (corrige o código) ou
  mudança de UI deliberada (regenera o snapshot com aprovação). NÃO regenerar um
  golden para «fazer passar».
---

# ui-golden-check — o markup não mudou?

O golden é a rede de segurança do refactor da UI: um snapshot do markup
renderizado. **Diff de golden = o comportamento visual mudou.** Num trabalho que
se diz «UI congelada», qualquer diff é uma regressão a corrigir no código — nunca
se actualiza o snapshot para passar.

## Correr

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
npm run ui:test     # vitest: unitários + caracterização + golden
# confirmar que o snapshot não foi reescrito:
git status --porcelain ui-app/tests/__snapshots__
```

Verde + `git status` dos snapshots vazio = markup byte-idêntico. 68 testes é o
total esperado da feature Co-Dev (ajusta à medida que mais features ganham testes).

## Como o harness compara (`ui-app/tests/harness.ts`)

`golden(el)` serializa o elemento DEPOIS de remover um conjunto fixo de atributos:
`STRIPPED_ATTRS = ["onclick","onchange","oninput","data-action","data-on"]`.
Implicações ao refactorar handlers:

- Trocar `onclick="f()"` por `data-action="f"` + `data-on="…"` é **invisível** ao
  golden (ambos strippados) — por isso a Fase 4 não mexe no snapshot.
- Todo o payload de uma acção TEM de viajar em `data-on`. Um atributo à medida
  (`data-mode`, `data-ckpt`) **não** é strippado → vaza para o snapshot e parte-o.
- Escapar valor interpolado com `esc` só muda a saída nos pontos onde o valor tinha
  `&<>"`; reporta cada ponto onde muda, não mudes em silêncio.

## Se houver diff

1. **Refactor que se diz congelado** → é regressão. Lê o diff, encontra o que no
   código mudou o markup, corrige o código. Não toques no snapshot.
2. **Mudança de UI deliberada e aprovada** → regenera o snapshot
   (`vitest -u`/`--update`) num commit próprio, com a mudança de UI descrita, e
   actualiza os testes de caracterização afectados. Só com aprovação explícita.
