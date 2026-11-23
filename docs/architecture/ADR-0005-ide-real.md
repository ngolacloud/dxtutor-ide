# ADR-0005 — IDE real: fim dos dados de demonstração

- **Estado:** aceite (2026-11-23); R0 feita, R1–R6 por fazer
- **Data:** 2026-11-23
- **Decisor:** responsável do projecto
- **Relacionado:** `ADR-0004` (migração da ui-app; corre em paralelo noutra sessão),
  `ADR-0002` (features em camadas), `IPC-MATRIX.md` (comandos que já existem e a UI não chama).

## 1. Contexto

A `ui-app` nasceu como protótipo no browser: um projecto-exemplo `dxtutor/` em memória, missões
guionadas (cenários `a`/`b` do Co-Dev), um git simulado com 12 commits, testes e diagnósticos
derivados por regex de caminhos fixos (`P_LX`, `P_REPO`…), métricas de observabilidade aleatórias,
uma lista de pastas «irmãs» escrita à mão no explorador. A app desktop foi substituindo partes
(terminal, git, Problems, providers, compose/kubectl), mas o resto continua à vista — e uma parte
age sobre a pasta real (o «Delegar» do Board escreve código gerado no disco; o «Repor protótipo»
apagava a pasta aberta, ver R0).

Inventário de 2026-11-23 (o que um utilizador desktop vê e não é real):

| Área | Demo | Fonte real disponível |
|---|---|---|
| Explorador sem pasta | pastas `delonix-*`/DORM/dxjs fixas (`boot.ts`), «fora do workspace do protótipo» | `list_dir`/`workspace_tree` |
| Barra de estado | `✖ 2/3 testes`, `ctx N%` (palpite), blame vazio | `run_tests`, sessão do agente, `git blame` |
| Testing / Run | `runTests()` simulado; launch configs `cargo test -p lexer`… | `list_tests`/`run_test`/`run_all_tests`; `detect_projects`/`project_entrypoint` |
| Co-Dev | chips e missões demo, Manager/uso estimado, menu/paleta/`dx missao` | sessões `codev_agent_*`, `codev_session_*` |
| Welcome | cartões para missões demo e vistas simuladas | Open Folder/recentes (já reais) |
| Search / Outline | só ficheiros carregados; regex de símbolos | `search_project`; `file_outline`/`lsp_*` |
| Code review | texto fixo para os caminhos demo | `review_code` |
| Board / Tasks / Team | contadores semente, auto-teste falso, escopos do projecto demo | `board_load`/`board_save`, `run_tests`, agente real |
| Studio | desenho semente (`ST_SEED`) em LS global | `arch_validate`/`arch_scaffold` |
| Debug | traces guionados sobre `P_LX` | DAP `debug_*` |
| Infra | ambientes/promoções/CrashLoop simulados, métricas aleatórias, dev container falso | `devcontainer_*`, `compose_ps`, kubectl/docker por `exec` |
| Extensões | lista fixa de 13, «instalar» muda flags | Open VSX (HTTP) + `vsix_manifest` |
| Account / Remote | «walter · Team SYS», hosts SSH inventados | utilizador do SO; `~/.ssh/config` |

## 2. Decisão

1. **O demo apaga-se de vez** — não só se esconde no desktop. Saem a semente (`SEED`,
   `VITE_SEED`, `dev:seed`), os cenários guionados, o git simulado, os motores simulados
   (diagnósticos, testes, debug, infra, observabilidade) e as constantes `P_*`. Sem pasta aberta
   a IDE fica vazia (como o VS Code sem pasta). No browser (sem Tauri) a app arranca vazia; o
   PairCode simulado fica, porque é a sua forma de teste.
2. **Cada feature liga-se ao backend real**; onde ainda não houver comando, escreve-se. Uma feature
   não mostra dados inventados em nenhuma fase intermédia: até ser ligada, mostra um estado vazio
   honesto («abre uma pasta», «ainda não há testes detectados»).
3. **Goldens:** os snapshots que caracterizam o comportamento demo (missões guionadas, traces do
   debug, overlay do pane infra simulado…) são **apagados ou regenerados com esta decisão
   registada**, fase a fase, e cada commit diz quais. A regra «nunca regenerar para fazer passar»
   mantém-se para tudo o resto. Cada feature religada ganha testes novos sobre adaptadores falsos
   do IPC (os `Invoker` injectáveis da U2).

## 3. Fases

| Fase | Entrega | Critério de saída |
|---|---|---|
| **R0 — Perda de dados** | Sai o «Repor protótipo» (`resetAll`); o autosave recusa apagar a pasta quando o FS em memória ficou vazio por inteiro e relê o disco | feito |
| **R1 — Arranque limpo** | Sem semente, sem árvore fixa, sem cenários (chips, menu, paleta, Welcome, terminal), sem git simulado, sem diagnósticos/testes simulados, sem `P_*`; estados vazios | nenhum caminho `dxtutor/…` fixo no código; goldens demo retirados com registo |
| **R2 — Editor e testes reais** | Testing + `#st-tests` por `list_tests`/`run_test`/`run_all_tests`; Run por `detect_projects`; Search por `search_project`; Outline por `file_outline`; `ctx` pelo uso real da sessão; Account com o utilizador real; Code review por `review_code` | testes com IPC falso |
| **R3 — Board/Tasks/Team** | Backlog por workspace (`board_load`/`board_save`); «Delegar» só pelo agente real; auto-teste por `run_tests`; equipa e escopos lidos do projecto | sem `genBacklog` guionado |
| **R4 — Debug** | Run and Debug sobre DAP (`debug_launch`/`break`/`step`/`stack`/`locals`) | sessão real num projecto Rust e num Node |
| **R5 — Infra** | Dev container por `devcontainer_*`; scale/down/logs por kubectl; ambientes = contextos/namespaces reais; métricas por `kubectl top`/`docker stats` | nenhuma métrica aleatória |
| **R6 — Studio, Extensões, Remote** | Studio por workspace (`.dxtutor/`) com `arch_validate`/`arch_scaffold`; Extensões pelo Open VSX + contribuições declarativas (decisão do Learning Track); Remote por `~/.ssh/config` + ssh | nada fixo |

## 4. Coordenação

A U4 do ADR-0004 (outra sessão) dissolve `app.ts`/`boot.ts`/`v5.ts`/`v6.ts`/`bridge.ts` — os
mesmos ficheiros onde vive boa parte do demo. Este trabalho corre na branch `feat/ide-real`
(worktree própria) e faz rebase sobre a `develop` antes de cada fase; as fases que só tocam
`features/<x>/` (R2–R6) colidem pouco, a R1 colide mais e deve ser curta.

## 5. Notas de execução

- **R0 (2026-11-23).** `resetAll` esvaziava o `FS` (`loadSeed` sem semente não repõe nada) e
  emitia `workspace:changed`; o autosave do desktop (`flushSave`) trata cada caminho de `R.disk`
  ausente do `FS` como apagado e chamava `delete_file` (remoção definitiva, sem lixo) — apagava a
  pasta aberta. Removido o `resetAll` (função, menu File, paleta). No `flushSave`, se nenhum
  ficheiro do disco sobreviveu no `FS` e havia mais de um, não se apaga nada: relê-se a pasta. O
  mesmo padrão de «esvaziar o FS» existe no `checkout` simulado, no `restoreCkpt` e no PairCode;
  a rede apanha-os todos.
