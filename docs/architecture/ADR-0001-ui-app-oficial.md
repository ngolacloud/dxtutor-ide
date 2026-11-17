# ADR-0001 — A UI oficial do DXTUTOR IDE é `ui-app/`

- **Estado:** aceite
- **Data:** 2026-11-17
- **Decisor:** responsável do projecto (angolardevops)
- **Contexto do commit:** `6017c120e15b4155a803c74eac86e39590f5c10a` (base `main`)

## Contexto

O repositório contém três pastas de interface na raiz: `ui/` (5 ficheiros,
referência antiga), `ui-app/` (UI activa) e `ui-next/` (48 ficheiros,
experimental). A coexistência destas pastas gera ambiguidade sobre qual é a
interface de produção.

A configuração activa é inequívoca:

- `package.json` → `ui:build` compila `ui-app/tsconfig.json` + `ui-app/vite.config.ts`.
- `src-tauri/tauri.conf.json` → `frontendDist: "../ui-app/dist"`.
- `src-tauri/build.rs` → observa `../ui-app/dist` para re-embutir a UI.
- `README.md` → identifica `ui-app/` como a UI que embarca.

Verificou-se no HEAD que **não existem imports activos** de `ui/` ou `ui-next/`
a partir de `ui-app/` ou `src-tauri/`. As únicas menções a `ui-next` em
`ui-app/` são comentários de proveniência (o «harvest» da feature `changelog`),
não `import` de código.

## Decisão

1. A UI oficial e activa do DXTUTOR IDE é `ui-app/`. Todo o desenvolvimento da
   interface de produção ocorre nos fontes de `ui-app/`.
2. `ui-app/dist/` é saída gerada; as alterações fazem-se nos fontes.
3. `ui/` e `ui-next/` ficam como referências históricas/experimentais. Podem
   ser inventariadas para aproveitamento pontual («harvest»), mas não são
   aplicações activas nem recebem automaticamente correcções da UI oficial.
4. Não se cria nem promove uma segunda UI (`desktop/`, `frontend/`, `web/`,
   `apps/web/`, raiz ou outra) sem instrução expressa do responsável.

## Estatuto das pastas de UI

| Pasta | Estatuto | No grafo de build? |
|---|---|---|
| `ui-app/` | **Oficial, activa** | Sim (`frontendDist`, `build.rs`, `ui:build`) |
| `ui-next/` | Experimental / fonte de harvest | Não |
| `ui/` | Histórica | Não |

## Implicações

- **Build:** a cadeia de build deve garantir que `ui-app/dist` é gerado antes
  de o Tauri o embutir (ver `MIGRATION.md`, lacuna E10).
- **Testes/CI:** a validação da UI aponta para `ui-app`; a CI deve falhar se
  surgirem imports activos de `ui/` ou `ui-next/` no código de produção.
- **Alterações futuras:** mudar a UI oficial exige um novo ADR e instrução
  expressa do responsável.

## Alternativas consideradas

- **Promover `ui-next/` a UI activa:** rejeitada. Contraria a configuração
  activa e a decisão do responsável; exigiria reescrever a cadeia de build e o
  bridge já integrado em `ui-app/`.
- **Remover `ui/` e `ui-next/`:** fora de escopo desta decisão. Mantêm-se como
  referência; a sua eventual remoção é uma decisão separada.
