# UI-AUDIT — Fase A0 (auditoria e análise de lacunas)

> Estado: **à espera de decisão do dono** (o prompt da Parte A manda parar aqui).
> Base auditada: `develop` @ `cb0d02e` (2026-11-24), código commitado. A árvore de trabalho tinha
> alterações de outra sessão (U4j2 do ADR-0004) que não foram tocadas. As referências `ficheiro:linha`
> são dessa base e podem deslocar-se com os commits seguintes.
> Nenhum ficheiro de código foi alterado nesta fase.

## 0. Antes de tudo: o prompt não descreve este repositório

O prompt da Parte A foi escrito para outra forma do projecto. Divergências que mudam o plano:

| O prompt diz | Neste repositório |
|---|---|
| UI numa página `ui/index.html` + `ui/bridge.js`, `ui/pair.js`, `ui/pair-sim.js` | UI oficial é `ui-app/` (TypeScript, Vite, Clean Architecture por feature, ADR-0001/0002/0004). `ui/` e `ui-next/` **não existem** e o `arch-check` (A4–A5) reprova qualquer referência a eles. |
| "Novas áreas em ficheiros novos carregados pelo `index.html`" | Áreas novas nascem como features tipadas em `ui-app/src/features/<nome>/{domain,application,ui,infrastructure}` (governadas por A7/A8), sem `@ts-nocheck` novo (A6) e sem `window` fora do `legacy-bridge.ts`. |
| Testes de UI Playwright em `tests/ui/` | Já existe Playwright em `ui-app/e2e/` (`playwright.config.ts`, `arch.e2e.ts`, `boot.e2e.ts`, script `npm run ui:e2e`). Os testes por fase vão para aí. |
| Ler `docs/v2/PROMPT-backend.en.md` e `docs/v2/RF-backend.md` | **Não existem** (não havia pasta `docs/v2/`). O contrato `codev-*` citado (RF-BK-S03) não está escrito em lado nenhum. Ver Q1 em `QUESTIONS.md`. |
| Parte A só UI; backend na Parte B; dados de exemplo marcados "sample" | O dono instruiu: **o que é novo nasce com backend real; o que é persistente vai para SQLite; nada de dados de demonstração**. Esta auditoria segue essa instrução, que prevalece sobre o prompt. Ver §5. |
| `cargo test`, `scripts/selftest.sh`, `scripts/pairtest.sh` | Existem e continuam a ser a porta. Somam-se `npm run ui:build`, `npm run ui:test`, `npm run arch:check` (CLAUDE.md). |

Regras deste repositório que o prompt não conhece e que se mantêm em todas as fases:

- **Goldens** (`ui-app/tests/*.golden.test.ts`): qualquer mudança visual nas features com golden (codev,
  codereview, scm, debug, board, visualizer, infra) é **mudança de UI deliberada** e exige aprovação
  explícita para regenerar o snapshot. Nunca se actualiza um golden "para passar".
- **Métricas ADR-0004** (`scripts/ui-metrics.sh`) não podem subir: globais no `window` (409), handlers
  inline `on*=` (160), `@ts-nocheck` (2). UI nova usa `data-action` + listener delegado, não `onclick`.
- **IPC-MATRIX** (A1–A3): cada comando Tauri novo entra em `generate_handler!` **e** em
  `docs/architecture/IPC-MATRIX.md`.
- Mensagens de commit sem trailer de atribuição a IA (regra global do dono).

### Estado de base (verificado nesta sessão)

- `npm run ui:test`: **42 ficheiros, 438 testes, todos verdes**.
- `npm run arch:check`: **todas as verificações verdes**; métricas sem subida.
- `cargo test`, `selftest.sh` e `pairtest.sh` não foram corridos na A0 (são longos/precisam de display);
  correm no início da A1 para fixar a base.

## 1. Inventário do que existe hoje

Barra de actividades final (montada em `boot.ts:100`, reconstruída em `app.ts:179/257/312/319`):
Explorer · Search · Source Control · Run and Debug · Testing · Extensions | Co-Dev · Tasks · Studio ·
Infra · Learning Track | Settings.

| Entrada | Ficheiros | Desktop: real ou simulado | Envia contexto ao Co-Dev? |
|---|---|---|---|
| Explorer | `features/explorer.ts`, `platform/desktop/workspace.ts` | **Real** (`load_workspace`, autosave `write_file`/`delete_file`, `pick_folder`) | Só via editor ("Enviar selecção", `app.ts:169`) e @-menção no composer |
| Search | `features/search.ts` | Procura no `FS` em memória (ficheiros reais, limitados por `LoadPolicy`). `search_project` (Rust) **não é usado** | Não |
| Source Control | `features/scm.ts`, `scm/**`, `platform/desktop/git.ts` | **Parcial**. Ler histórico é real; commit/checkout/merge/gfFinish publicados vão ao git real; **as acções do próprio painel, `pickBranch`, `gfStart`, `commitGit`, stage/discard usam o motor local** (bug já registado no CLAUDE.md, confirmado activo) | Não |
| Run and Debug | `features/debug.ts`, `debug/**` | **Simulado** (traços guionados do lexer e de um crash K8s). Os 10 comandos `debug_*` (driver gdb/MI3 real) **não são chamados** | Aba própria "Debug assistant", não o chat |
| Testing | `features/test.ts`, `diagnostics.ts` | **Simulado** (regex sobre o workspace de exemplo). Clicar corre o comando real num PTY, mas o resultado não volta às luzes. `list_tests`/`run_test`/`run_all_tests` **não são chamados** | Não |
| Extensions | `features/ext.ts`, `ext/**` | **Real** (`vsix_fetch_open_vsx`, contribuições declarativas; sem extension host) | Não |
| Co-Dev | `features/codev.ts`, `codev/**`, `platform/desktop/llm.ts`, `agent-tasks.ts` | **Real** (agente v2 `codev_agent_*` no `tutor-agent`; 4 provedores). Missões/conselho guionados (bloqueados no desktop com pasta aberta) | É o destino |
| Tasks / Board | `features/tasks.ts`, `board.ts`, `board/**` | **Simulado e só em memória** (`BL`, perde-se ao recarregar). `board_load`/`board_save` (SQLite) **existem e nunca são chamados** | Sim (delegar → `focusAgent`) |
| Studio (catálogo cloud) | `features/studio.ts` | Canvas simulado; os geradores escrevem compose/k8s no `FS` (vão para disco por autosave) | Não |
| Studio de arquitectura | `features/arch/**` (menu/paleta, não na barra) | **Real** (`arch_validate`, `arch_scaffold_preview`, `arch_scaffold`) — em desenvolvimento noutra sessão | Não |
| Infra | `features/infra.ts`, `infra/**`, `platform/desktop/infra.ts` | **Misto** (ver item 10) | Não |
| Learning Track | `features/tutor.ts`, `learn.ts`, `learn/**` | **Real** (`list_courses`, `get_course`, `submit_step`, `plugin_*`) | Sim (`ltAsk`) |
| Visualize | `features/visualizer.ts`, `visualizer/**` | **Simulado**: interpretador TS de um subconjunto de Rust. `trace_execution` (Rust/Python reais) **não é chamado** | "Ask why" via `SAMPLE` |
| Under the hood / Explain / Review | `features/codereview.ts` | Heurísticas locais por regex; "deeper review" vai ao LLM real | Sim (`liveChat`) |
| Team & harness | `features/team.ts` | Configuração local (LS) | Sim |
| Settings | `app.ts:296` + `desktopPorts.codev.settings` | **Real** (`get/save_providers_config`, `list_providers`) | — |
| Welcome | `features/welcome.ts` | Abrir pasta e recentes reais (porta desktop) | Não |
| PairCode | `pair.ts`, `src-tauri/src/pair.rs` | **Real** (WebSocket cifrado ChaCha20-Poly1305, WebRTC + relay) | Não |
| Remote, Containers, Account | `remote.ts`, `account.ts` | Estáticos e **inacessíveis** (o `boot6` tirou o botão "…" e o `boot5` tirou Account) | Não |
| Painel inferior | `features/panel/**` | **Real** (`pty_*`, `problems_scan`, `ports_list`, compose) | Sim (`askCodev` de comando falhado/problema) |

**i18n**: não há dicionários; `features/i18n.ts` traduz o DOM em runtime com a tabela `PAIRS` (pt↔en) e
`RULES` (regex). Inglês por omissão, pt-AO nas Definições (LS `locale`). As strings-fonte estão misturadas
(pt e en). Cada string nova entra no `PAIRS` com o par certo (regra 4 do prompt).

## 2. Os 12 itens: estado, lacuna, proposta, esforço

Legenda de esforço: **S** ≤ 1 dia · **M** 2–5 dias · **L** > 1 semana. "Backend" indica o que tem de
existir ou ser ligado no Rust para cumprir a regra "nasce com backend real".

### Item 1–2 · PairCode: separadores partilhados e painel da chamada

| Req. | Estado actual | Lacuna | Proposta | Esf. |
|---|---|---|---|---|
| UI-PAIR-01 | Ausente. O host envia **todo** o workspace (`realFiles`, `pair.ts:359`); o guest fecha os seus separadores e segue o ficheiro do condutor. | Sem modelo de partilha por separador; sem privado. | Conjunto `privatePaths` no host, aplicado **antes** de enviar em `sendSnapshot`/`syncOut`/`applyView` (o filtro tem de estar no envio, não no desenho). Marcadores 👥/olho fechado no `drawTabs`. Menu do separador e da pasta "Tornar privado". | M |
| UI-PAIR-02 | Ausente. Só o item `#st-pair` na barra de estado. | Sem legenda; o guest vê tudo. | Chip "Shared with X · N tabs" na barra de separadores; guest recebe só os separadores partilhados (mensagem `tabs` nova no protocolo). | S |
| UI-PAIR-03 | `#pair-dock` é `position:fixed`, 272 px, flutua no canto do editor (`pair.ts:805-907`), arrastável, com auto-minimizar. | Não está encaixado no painel lateral; não colapsa para a barra de estado. | Encaixar no fundo do painel lateral activo (180 px, colapsável para 36 px), reservar a altura no painel, item de estado quando a lateral está escondida. O protótipo já tem a lógica `placeDock`. | M |

Persistência: nenhuma (sessão efémera, correcto). O protótipo HTML anexo já mostra estes três requisitos
a funcionar; servem de referência visual.

**Estado após a A1 (2026-11-24):** feito. UI-PAIR-01 com o filtro no envio (snapshot, sync, vista, separadores
e escritas do convidado), `.env` e chaves sempre privados, clique direito num separador ou pasta do explorador
para tornar privado; UI-PAIR-02 com a legenda e a mensagem `tabs` (o convidado espelha só os separadores
partilhados); UI-PAIR-03 com a chamada encaixada no fundo da barra lateral (36 px minimizada) e no item de
estado quando a lateral está escondida. Os caminhos privados duram a sessão (não são gravados).

### Item 12 + 6 · Co-Dev escreve no editor, ao vivo, e está em todos os ecrãs

**Estado actual (mais avançado do que o protótipo no motor):**

- O agente v2 é **real** e corre no backend (`crates/tutor-agent`, `src-tauri/src/codev_agent.rs`,
  `commands/codev_agent.rs`). Ferramentas: read, glob, grep, edit, write, bash, git_status, git_diff,
  run_tests/lint, todo_write, exit_plan, task, skill, lsp_diagnostics, `mcp__*`.
- Eventos: `codev-agent://event` (stream, tool_start, tool_result, usage, checkpoint, done…),
  `codev-agent://approval`, `codev-agent://error`.
- `edit` é substituição exacta old→new (`tools/fs.rs:127-145`); `write` reescreve o ficheiro. **Ambos
  escrevem no disco no backend**; o editor só recarrega no fim do turno (`agent-chat.ts:211`). Antes da
  aprovação há um link "ver diff".

| Req. | Lacuna | Proposta | Esf. |
|---|---|---|---|
| UI-CODEV-01 | Não existe o contrato `codev-plan`/`codev-hunk-start/chunk/end`/`codev-text`/`codev-done`. | **Backend primeiro** (regra do dono): no `tutor-agent`, a ferramenta `edit` passa a produzir um *hunk proposto* (ficheiro, intervalo, texto novo) emitido em streaming como eventos `codev-hunk-*`; em Manual/Assisted o hunk fica **pendente** até Accept; em Auto só é aceite se a validação passar. O disco só é escrito no Accept. `write` de ficheiro existente converte-se em hunks pelo diff (nunca reescrita inteira). Documentar o contrato num RF novo (ver Q1). | L |
| UI-CODEV-02 | Sem realce de linha, marca de bloco, Accept/Reject/Explain por bloco, pausa, ritmo, scroll que segue. | Overlay no editor (Monaco já está nas dependências: decorações + zonas de vista) alimentado pelos eventos; ritmo 40 c/s configurável. O protótipo tem o comportamento de referência (`V9.stream`). | M |
| UI-CODEV-03 | Sem `codev.ask({intent,context,scope})`, sem Ctrl+I. Hoje cada ecrã chega ao Co-Dev à sua maneira (`askCodev`, `liveChat`, `handlePrompt`, `ltAsk`, `agentStory`, pré-preencher `#ag-input`). | Porta única na feature codev (`application/ports.ts`: `AskPort`), registo de *context providers* por feature, chips removíveis no composer (já existem chips de anexo/menção, reaproveitar). Migrar os 6 caminhos actuais para o contrato. | M |

### Item 11 · Co-Dev como harness de primeira classe

| Req. | Estado actual | Lacuna | Proposta | Esf. |
|---|---|---|---|---|
| HARNESS-01 plano | `/plano` + `codev_agent_set_plan`; `exit_plan` mostra cartão de plano no chat. | Sem vista de plano com ficheiros e intervalos de linhas. | Vista "Run" ao lado do chat, com o plano e os ficheiros/intervalos que a ferramenta `exit_plan` já recebe. | S |
| HARNESS-02 tarefas | `todo_write` → `agentTodos` dentro do cartão. | Não é visível fora do chat. | Lista viva na vista Run e no painel Tasks. | S |
| HARNESS-03 checkpoints | **Real**: refs git escondidas `refs/dxtutor/cp/<sessão>/<n>`, `/reverter` → `codev_agent_rewind`. | Conversa é append-only (sem rewind da conversa); sem lista navegável. | Backend: truncar o JSONL da sessão no ponto do checkpoint (ou marcar ramo) para "Rewind to here" repor código **e** conversa. UI: lista de checkpoints. | M |
| HARNESS-04 contexto | Só a pílula `@ ficheiro activo`; anexos/menções. Lê `AGENTS.md`, `CLAUDE.md`, `.dxtutor/regras.md`; compactação server-side Anthropic. | Sem medidor; sem @symbol/@test/@issue/@commit/@terminal; sem `DELONIX.md`. | Medidor a partir do evento `usage` real; chips novos ligados aos *providers* do item 6; acrescentar `DELONIX.md` à lista do `context.rs`. | M |
| HARNESS-05 permissões | **Real** em Rust (`permissions::Policy`, `.dxtutor/permissions.json`). | Sem painel. | Painel por workspace que lê/escreve o mesmo ficheiro via comando novo. | S |
| HARNESS-06 subagentes | Só o investigador genérico `task` (read-only), listado num popover. | Sem reviewer/tester/architect; sem execuções em segundo plano. | Papéis como *skills/agentes* do `tutor-agent` com cartões; `codev_session_*` (worktrees, já registados e sem UI) servem as execuções em fundo. | L |
| HARNESS-07 artefactos | Ausente. | Sem walkthrough/relatório/diff resumido ligado à issue. | Gerados no fim da execução a partir dos eventos reais; guardados em SQLite ligados à issue (item 5). | M |
| HARNESS-08 MCP e hooks | **Real** (`mcp.json`, `.dxtutor/hooks.json`, commands, skills), geridos só pelo fluxo `/comandos`. | Sem secção nas Definições. | Secção nas Definições sobre os mesmos ficheiros. | S |

**Estado após a A3 (2026-11-24):** feito — o separador «Co-Dev run» (menu Co-Dev e paleta) com o plano e os
ficheiros/linhas de cada passo (`exit_plan` com `steps`, conjunto de ferramentas 5), as tarefas vivas, os
sub-agentes com papéis (explorer/reviewer/tester/architect, todos só leitura), o medidor de contexto do evento
`usage`, o relatório de cada turno (feito dos eventos, guardado em SQLite com a issue e mostrado no chat e no
painel da issue), os checkpoints com «Rewind to here» (ficheiros e conversa: o JSONL da sessão é reescrito),
as regras de permissões do projecto (`codev_agent_permissions`/`codev_agent_save_permissions`) e MCP/hooks/
comandos/skills, e `DELONIX.md` nas instruções. Por fazer: chips @symbol/@test/@issue/@commit/@terminal no
compositor (HARNESS-04), execuções de sub-agentes em segundo plano em worktrees (`codev_session_*`, HARNESS-06),
a lista de tarefas no painel Tasks antigo (Q3), e as secções nas Definições (estão no separador, para não mexer
nos goldens das Definições — decisão do dono). Uma sessão retomada só volta os ficheiros, não a conversa.

Coisas a **retirar** (contra a regra "nada de demo"): as missões guionadas, o "conselho de modelos" com
pontuações pré-feitas e os custos fictícios das missões (`application/run-mission.ts`,
`domain/scenarios/*`). Propõe-se substituí-los pelo agente v2 real e pelos custos do evento `usage`.

### Item 9 · Source Control ao nível do GitLens

Backend hoje (`crates/tutor-eval/src/git.rs`, `commands/git.rs`): log, show, diff, stage, unstage, commit,
checkout, branches, worktree_patch, sessões. **Não há** blame, merge, rebase, stash, lista de worktrees nem
bisect. Dos 13 comandos `git_*`, a UI usa 3 (`git_log`, `git_show`, `git_changes`).

| Req. | Estado | Proposta (backend + UI) | Esf. |
|---|---|---|---|
| **Pré-requisito** | Bug do motor local no painel (acima). | Ligar todas as acções do painel, `pickBranch`, `gfStart`, `commitGit`, stage/discard às portas desktop e aos `git_*` já existentes. Sem isto, tudo o resto mente no desktop. | M |
| SCM-01 blame inline | Ausente (só `#st-blame` por ficheiro, que no desktop nunca acerta porque `files: []`). | `git_blame` (porcelain) em Rust + decoração no fim da linha + hover. | M |
| SCM-02 CodeLens | Ausente. | Sobre `git_blame` + `symbol_relations` (já existe, sem UI). | M |
| SCM-03 grafo | SVG real no desktop (400 commits). Sem pesquisa, filtros, minimapa, arrastar. | Filtros sobre `git log` com argumentos; arrastar ramo → confirmação com o comando git exacto → `git_merge`/`git_rebase` novos. | M |
| SCM-04 histórico | Ausente (o Changelog é global, 30 commits). | `git log --follow -- <path>` e `-L` para linhas; navegação revisão anterior/seguinte. | M |
| SCM-05 refs, worktrees, stash, rebase | Ausente (`git_diff` existe sem uso). | `git_diff <a>..<b>`, `git_worktree_list`, `git_stash_*`, editor de rebase interactivo que gera o *todo* e corre com aprovação. | L |
| SCM-06 heatmap, "quem conhece" | Ausente. | Agregação do blame por autor/idade (Rust). | S |
| SCM-07 Co-Dev | Agente tem `git_status`/`git_diff` read-only; nada dedicado. | Acções "Explicar commit", "Mensagem de commit (inglês)", "Rever staged", "Bisect assistido" pelo contrato do item 6; o humano faz o commit. | M |

### Item 5 · Project: Kanban, Scrum, XP ou Scrum + XP

**Estado actual:** quadro em memória (`BL`, `board.ts:59`) com 6 colunas fixas (`STAGES`), filtros
Sprint 1/Sprint 2 fixos, arrastar sem regras (só Done exige `func`; `autoTest` simulado e com o bug do
`sleep` não publicado), painel de issue em `tasks.ts:95-110`. A actividade chama-se "Tasks". O Studio gera
issues **directamente** no quadro (`genBacklog`), sem caixa de entrada.

**Backend existente e desligado:** `crates/tutor-board` (SQLite, `board.sqlite3` em
`app_local_data_dir`): `boards`, `sprints`, `stories(role, want, so_that, acceptance, points, stage, kind,
prompt, note, branch, ord)`, exposto por `board_load`/`board_save` — **nenhum chamador na UI**. O esquema
não coincide com o tipo `Issue` da UI e não tem metodologia, WIP, DoR/DoD, actividade, responsável, pares,
releases nem cerimónias. Sem migrações (`CREATE IF NOT EXISTS`, sem `user_version`).

| Req. | Proposta | Esf. |
|---|---|---|
| **Backend** | Evoluir `tutor-board` com **migrações versionadas** (`schema_version`) e o modelo completo: `projects(method, cadence, wip, dor, dod)`, `issues` (tipo, chave, prioridade, estimativa, responsável, par, épico, classe de serviço, bloqueio, rank, estado canónico), `acceptance`, `activity`, `sprints/iterations`, `releases`, `retro_notes`, `inbox` (propostas do Studio), `issue_links` (commits, change sets, testes, CI, deploy). Comandos Tauri finos (`project_*`) e operações **atómicas** (mover com regras de WIP/fluxo validadas no Rust, não só na UI). Migrar o `board_load/board_save` actual. | L |
| PROJ-01 | Actividade "Project" própria; Studio só envia para a **inbox**; o PO aceita ou descarta. | S |
| PROJ-02 | Metodologia por projecto: os 5 estados canónicos com nomes, limites e práticas por método. | M |
| PROJ-03 | Quadro estilo Jira: swimlanes, filtros rápidos, pesquisa, cartões ricos, arrastar só um passo, WIP forçado, Done com DoD (override com motivo visível e registado em `activity`). | M |
| PROJ-04 | Painel de issue com critérios, DoR/DoD, actividade e secção **Development** com dados **reais**: ramo (cria com o comando git exacto), commits que citam a chave (`git log --grep`), change sets aceites do Co-Dev (eventos reais), testes (item 3), CI/deploy (quando existir fonte). | M |
| PROJ-05 | Vistas Backlog, Planning (capacidade, objectivo, planning poker), Releases, Reports (burndown, velocity, CFD, cycle time **calculados do histórico em `activity`**, não inventados), Daily, Retro, Team & pairs, Settings. | L |
| PROJ-06 | Commits com `DX-123` actualizam a issue (hook pós-commit ou leitura do `git log`); contagem de change sets; sprint na barra de estado. | M |

**Estado após a A5 (2026-11-24):** feito — store SQLite com migrações e regras no Rust (backend), os comandos
`project_load/apply/issue/reports`, a actividade "Project" (PROJ-01) com quadro, backlog + caixa de entrada,
planning (sprints e capacidade), releases, reports do histórico, retro e settings (PROJ-02/03/05), o painel da
issue com Development real (PROJ-04: ramo pelo comando git exacto, commits que citam a chave, change sets do
Co-Dev) e a ligação dos commits por "Sync commits" (PROJ-06). Por fazer: sprint na barra de estado e ligação
automática dos commits (hook pós-commit) (PROJ-06), as vistas Daily e Team & pairs e o planning poker
(PROJ-05), exportar/importar `.dxtutor/board.json` (Q7). O painel "Tasks" (o quadro simulado antigo) continua
como estava, à espera da Q3.

Nota: o protótipo HTML (`project.js`) é uma boa referência visual, mas os relatórios dele usam séries
fixas marcadas "sample". Aqui só se desenha o que se consegue calcular; com pouco histórico, os gráficos
mostram estado vazio em vez de números inventados.

### Item 3 · Testes com a experiência do Cypress, usando as ferramentas nativas

**Estado actual:** painel Testing simulado; backend real sem uso: `testnav::discover_tests` (Rust via syn,
Go, Python unittest), `run_test`/`run_go_test`/`run_python_test`/`run_suite`, `run_project_suite`
(dentro do contentor se houver). O parsing é por substrings de texto, não JSON/JUnit. O "pytest" é na
verdade `unittest`. Há ainda `measured.rs` (wall, CPU, RSS de pico, I/O — real) sem uso.

| Req. | Proposta | Esf. |
|---|---|---|
| TEST-01 | Ligar `list_tests`/`run_test`/`run_all_tests` ao painel; agrupar por projecto/ficheiro; run um/ficheiro/todos, re-run falhados, watch (via watcher de ficheiros do backend), tags. | M |
| TEST-02 | Registo de comandos por teste a partir de saída estruturada; snapshots DOM/vídeo **só** onde o projecto usa Playwright/Cypress (ler os artefactos que eles já geram). | L |
| TEST-03 | Cartões calculados de execuções reais **guardadas em SQLite** (histórico → tendência e flaky por repetição); cobertura por `cargo llvm-cov`/`c8`/`coverage.py`/`go test -cover` quando instalados; latências de `criterion`/`k6`/`go test -bench` lidas dos seus ficheiros. | L |
| TEST-04 | Detecção por projecto e parsing estruturado: `cargo test -- -Z unstable-options --format json` ou `cargo nextest --message-format libtest-json`, `go test -json`, `pytest --junitxml`, `vitest --reporter=json`, JUnit XML (Java), `odoo --test-tags`. Nunca inventar runner. | L |
| TEST-05 | Testes afectados a partir do grafo de dependências (crates/módulos tocados pelo diff). | M |
| TEST-06 | Pelo contrato do item 6: explicar falha, hunk de correcção no editor, escrever teste em falta, causa provável de flaky. | M |

**Estado após a A6 (2026-11-24):** feito — `tutor_eval::testrun` detecta os runners que o projecto tem de facto
(cargo, go, pytest, unittest, vitest/jest só se instalados em `node_modules/.bin`, maven, gradle; na raiz e nas
pastas filhas; um runner sem a ferramenta aparece com o motivo) e lê a saída estruturada de cada um (`go test
-json`, JUnit XML do pytest/maven/gradle, JSON do vitest/jest; no cargo, a saída libtest estável — o JSON do
libtest exige nightly). Comandos `test_runners`, `test_run` (âmbito todos / um teste / afectados — os crates ou
pacotes que os ficheiros alterados tocam, pelo `git diff HEAD` ou pelos ficheiros gravados) e `test_history`.
Cada execução fica em SQLite (migração 3: `test_runs`, `test_cases`) e dá os cartões do pane: última execução,
tendência da taxa de sucesso, testes instáveis (mudanças de resultado nas últimas 10 execuções) e mais lentos.
O pane mostra os runners, os resultados por suite com duração, o detalhe da falha (mensagem e saída), correr um
teste só, «Watch» (os afectados a cada gravação), e pede ao Co-Dev pelo `codev.ask`: explicar a falha, corrigir
(o agente propõe os hunks no editor, como no item 6), escrever o teste em falta do ficheiro aberto e a causa
provável de um teste instável. Vive na feature `features/testing/` (PR #6, ADR-0006 R2a): `domain/runs.ts`,
`application/runs-service.ts` (uma corrida de cada vez, também contra as da descoberta), `ui/runs-view.ts`,
`styles.css`; a lista sintáctica (`list_tests`) fica por baixo como «Tests in the code» e acende-se com os
resultados dos runners. Sem runners (ou com um backend sem os comandos), o pane fica exactamente como antes. Por fazer: TEST-02 (registo de comandos e snapshots dos artefactos do Playwright/Cypress),
cobertura (`cargo llvm-cov`/`c8`/`coverage.py`/`go test -cover`) e latências (`criterion`/`k6`/`-bench`) do
TEST-03, `cargo nextest`, `odoo --test-tags`, tags, e o watch pelo watcher de ficheiros do backend (hoje é pelas
gravações do editor).

### Item 4 · Debug que resolve as maiores dores

Dores alvo (a registar como critério): reproduzir o bug; "porque é que esta variável tem este valor";
stacks async e multi-thread; debug dentro de contentores e Kubernetes; heisenbugs; testes flaky;
demasiados cliques para breakpoints condicionais; perder o estado ao reiniciar.

**Estado actual:** o "Debug assistant" é **guionado** (sessões pre/code/ops com passos, hipóteses e
saídas de `kubectl` inventadas). Backend real e sem uso: driver **gdb/MI3** (`src-tauri/src/debug.rs`,
break/run/continue/step/next/locals/stack, com teste live). `tutor-eval/src/dap.rs` só **detecta**
codelldb/lldb-dap. Não há cliente DAP. No desktop com pasta aberta, o `panel` já mostra uma vista **real**
de comandos falhados enviados ao Co-Dev.

| Req. | Proposta | Esf. |
|---|---|---|
| DBG-01 | Cliente **DAP** em Rust (um só protocolo para todos): CodeLLDB/lldb-dap (Rust/C++), debugpy (Python, Odoo), Delve (Go), js-debug (Node), java-debug. Launch e attach (pid, `docker exec`, `kubectl exec`/port-forward). O driver gdb/MI3 fica como fallback ou sai. | L |
| DBG-02 | Valores inline, árvore de variáveis com diff desde a última paragem (o backend guarda a paragem anterior), watch, stacks por thread/async (o DAP já dá threads). | M |
| DBG-03 | Menu único no gutter: condicional, hit-count, logpoint, data breakpoint, excepções com cadeia causal (o DAP suporta todos). Breakpoints persistidos por workspace em SQLite. | M |
| DBG-04 | Time travel com `rr` no Linux (sessões gravadas; `rr replay` também fala gdb/MI e há adaptador DAP). "De onde veio este valor" = reverse-continue com watchpoint. Indisponível fora do Linux, e a UI di-lo. | L |
| DBG-05 | Snapshot de sessão (stack, variáveis, logs) em SQLite, anexado à issue. | S |
| DBG-06 | Co-Dev no debugger com os frames **reais** como contexto; hipóteses e próximo breakpoint como sugestões; "transformar sessão em teste" como hunk proposto. | M |

**Retirar:** os traços guionados (`lexer-trace.ts`, `crash-trace.ts`, lançadores falsos). Ver Q4 (há
golden de debug sobre eles).

### Item 7 · Visualize e Under the hood

**Estado actual:** o visualizer é um interpretador TS de um subconjunto de Rust, com memória simulada
(endereços "ilustrativos"); o rodapé afirma "The desktop app traces real binaries", **o que hoje não é
verdade**. O Hood é uma lista de etapas por regex. Backend real e sem uso: `trace_execution` (Python via
`sys.settrace`; Rust por instrumentação syn — linhas, locais, profundidade; sem heap), `compile_pipeline`
(`rustc --emit=mir/llvm-ir/asm` + `objdump`, sem mapeamento de linhas), `run_measured`, `complexity::estimate`.

| Req. | Proposta | Esf. |
|---|---|---|
| VIZ-01 | Ligar `trace_execution` (Rust/Python) para o modo "real"; o modelo TS fica como modo de **aprendizagem** explícito (útil, é o que tem "predict"). Grafo de heap real exige estender os tracers (Python: `gc.get_referents`; Rust: instrumentar alocações) — passo seguinte. | L |
| VIZ-02 | Ligar `compile_pipeline`; mapeamento fonte↔asm com `-C debuginfo=2` + `objdump -l` (ou `addr2line`); bytecode Python com `dis`; JVM com `javap -c`. Registos só com o debugger (item 4). | M |
| VIZ-03 | Tokens/AST via `syn` (Rust) e `ast` (Python), MIR/LLVM IR/asm de `compile_pipeline`, todos ligados às linhas. | M |
| VIZ-04 | Linha temporal de threads/tarefas/locks a partir do DAP (threads) e de `tokio-console`/`tracing` quando o projecto os tiver. Sem inventar dicas de deadlock. | L |
| VIZ-05 | Flame graph de `perf`/`cargo flamegraph` (Linux), `pprof` (Go), `py-spy` (Python); complexidade empírica com `complexity::estimate` (já real) sobre `run_measured` com entradas crescentes. | M |
| VIZ-06 | Mantém-se (modelo TS com "predict"), alargando estruturas. | M |
| VIZ-07 | Pelo contrato do item 6, com o que a vista mostra como contexto. | S |

Correcção imediata proposta (texto, não código de motor): tirar a frase "The desktop app traces real
binaries" enquanto não for verdade.

### Item 10 · DevOps, platform engineering e SRE com AWS, GCP e Azure

**Real hoje:** `docker|podman info`, `kubectl config get-contexts`/`get ns`, `kubectl get deploy -o json`,
compose up/down/ps, script de deploy (build, load, apply, rollout status), logs `-f` no terminal.
**Simulado mesmo no desktop:** `k8sScale`/`k8sDown`, `dcAttach`, promoção entre ambientes, métricas
"Observe" (PRNG), o comando `kubectl` do terminal emulado. Backend sem uso: `devcontainer_*` ×8,
`compose_ps`, `get/set_sandbox_engine`. **Nenhuma chamada a `aws`/`gcloud`/`az`.**
Problema de segurança: `envx6` guarda **segredos de staging/produção em claro no localStorage**.
As acções Infra que correm comandos reais não mostram o comando exacto para aprovação.

| Req. | Proposta | Esf. |
|---|---|---|
| OPS-01 | Explorer cloud lendo **só via CLIs oficiais** (`aws`, `gcloud`, `az`) e os seus perfis; read-only por omissão. Sem CLI ou sem sessão → estado vazio com a instrução, nunca recursos de exemplo. Cache dos inventários em SQLite. | L |
| OPS-02 | Invocar funções e logs ao vivo (`aws logs tail`, `gcloud logging tail`, `az monitor`), emulação local (SAM, Functions Core Tools, emuladores gcloud) — tudo com aprovação do comando. | L |
| OPS-03 | `terraform plan -json` / `pulumi preview --json` / `cdk diff` / `az deployment what-if` como diff visual; drift com `terraform plan -refresh-only`; custo só com Infracost se instalado. | L |
| OPS-04 | SLO/error budget a partir de métricas reais (Prometheus/CloudWatch) quando configuradas; caso contrário, estado vazio. Retirar as séries PRNG. | L |
| OPS-05 | Pods, eventos, serviços, port-forward, exec, rollout history/undo, scale/delete **reais** (hoje simulados), cada um com o comando mostrado. | M |
| OPS-06 | Co-Dev explica plano/alerta e propõe IaC como hunks; qualquer mudança cloud passa pela aprovação com o comando exacto (o classificador `permissions/shell.rs` já marca `terraform apply`, `kubectl delete`, etc. como perigosos). | M |

## 3. Item 8 · Comparação com outros IDEs e dores recorrentes

Base: conhecimento público dos produtos até meados de 2026; **não houve pesquisa web nesta fase**. Antes
da A10 convém validar os pontos marcados (?) com pesquisa actualizada.

| Capacidade | VS Code | JetBrains | Cursor / Windsurf | Zed | Xcode | Antigravity | delonix-ide hoje |
|---|---|---|---|---|---|---|---|
| Edição do agente no editor com aceitar/rejeitar por bloco | via extensões (Copilot edits) | AI Assistant / Junie | **forte** (diff inline) | forte | Swift Assist (?) | forte, com artefactos | ausente (diff separado) |
| Plano/artefactos verificáveis | parcial | Junie (?) | parcial | parcial | — | **forte** | parcial (no chat) |
| Debug multi-linguagem DAP | **forte** | **forte** (próprio) | herda VS Code | em evolução | forte (LLDB) | herda VS Code (?) | gdb/MI3 sem UI |
| Testes com UI rica | Test Explorer | **forte** | herda | básico | forte (XCTest) | herda | simulado |
| Git avançado | GitLens (extensão) | **forte** nativo | herda | básico | básico | herda | só leitura + bug |
| Pair programming | Live Share | Code With Me | — | **nativo** | — | — | **real e cifrado** (falta partilha por separador) |
| Cloud | Toolkits oficiais | plugins | herda | — | — | Google Cloud (?) | ausente |
| Gestão de projecto ligada ao código | extensões | YouTrack | — | — | — | — | simulado, backend desligado |
| Aprender a linguagem | extensões | EduTools | — | — | Playgrounds | — | **Learning Track real** |

Por linguagem (resumo): **Rust** — rust-analyzer dá o essencial em todos; diferencia-se em debug
(CodeLLDB) e em ver ownership (aqui o visualizer é um trunfo se ligado ao tracer real). **TS/JS** —
VS Code domina; o diferencial possível é testes E2E com time travel. **Python/Odoo** — PyCharm lidera em
Django/Odoo; o diferencial é debug dentro do contentor Odoo e `--test-tags` integrado. **Go** — GoLand e
VS Code+Delve; diferencial: pprof integrado. **Java** — IntelliJ é a referência; competir aqui é caro.

Dores recorrentes e o que este IDE pode fechar:

| Dor | Pode fechar? | Como |
|---|---|---|
| Configurar o ambiente | Sim | `devcontainer_*` já existe no backend; ligar à UI (um clique). |
| Feedback lento | Parcial | Testes afectados (TEST-05) e watch. |
| Testes flaky | Sim | Histórico em SQLite + detecção por repetição. |
| Debug de sistemas distribuídos | Parcial | Attach em contentor/pod via DAP; logs entre serviços. |
| Entrar numa base de código | Sim | Mapa de onboarding (`symbol_relations`, `arch_validate`, Studio de arquitectura). |
| Actualizar dependências | Parcial | Assistente com `cargo outdated`/`npm outdated` + vulnerabilidades (`cargo audit`, `npm audit`). |
| Mudança de contexto | Sim | Issue ↔ ramo ↔ testes ↔ Co-Dev no mesmo sítio (item 5). |
| Rever diffs grandes | Parcial | Review agrupado por ficheiro com Co-Dev. |
| Igualar o ecossistema de extensões do VS Code | **Não** | Não há extension host (decisão do ADR-0005); só contribuições declarativas. |
| Igualar a profundidade Java/Kotlin do IntelliJ | **Não** (a curto prazo) | — |

## 4. Mapa de persistência e proposta SQLite

| Dado | Hoje | Deve ir para |
|---|---|---|
| Issues/quadro | memória (`BL`) | **SQLite** (`tutor-board` evoluído) |
| Missões, decisões, checkpoints da UI | memória | Retirar (simulados); checkpoints reais já são refs git |
| Conversas do Co-Dev | JSONL `~/.config/dxtutor/sessions/` | Mantém-se (formato do agente); índice opcional em SQLite |
| Progresso do Learning Track | LS `lt3` | **SQLite** (`tutor-track` existe, sem consumidor) |
| Ambientes e **segredos** | LS `env5`, `envx6` (segredos em claro) | Config em SQLite; **segredos no keyring do SO**, nunca em LS nem em SQLite em claro |
| Harness, equipa | LS `harn5`, `team3` | `.dxtutor/harness.toml` (versionado com o projecto) |
| Desenhos dos Studios | LS `studio3`, `dxnext-studio:<root>` | Ficheiro do projecto (`.dxtutor/`) ou SQLite por projecto — ver Q6 |
| Breakpoints | LS `bps6` | SQLite por workspace |
| Histórico de testes, snapshots de debug, artefactos de execução | — | **SQLite** (novo) |
| Preferências (tema, idioma, ritmo, modo) | LS `cfg`, `locale`… | Podem ficar em LS (são preferências do dispositivo) |

Proposta técnica: uma camada de persistência única no backend (crate `tutor-store` ou alargar
`tutor-board`), rusqlite já no workspace, **com tabela `schema_version` e migrações numeradas só para a
frente**, um ficheiro por instalação em `app_local_data_dir`, comandos Tauri finos e testes de
ida-e-volta em memória (`Connection::open_in_memory`). Os dois stores actuais não têm migrações e passam
a ter.

## 5. Conflitos entre o prompt, o protótipo e as instruções do dono

1. **"Nada de demo data"** vs protótipo/prompt com dados "sample": segue-se o dono. Sem fonte real →
   estado vazio com instrução de como ligar a fonte, nunca números inventados. Isto implica **remover**
   simulações existentes (missões, conselho, debug guionado, métricas PRNG, painel Testing por regex).
2. **"Backend depois" (Parte B)** vs **"nasce com backend"**: cada fase entrega UI + comando Tauri +
   persistência juntos. Os RF de backend vão sendo escritos em `docs/v2/` à medida que cada fase os
   define (o `RF-backend.md` não existe — Q1).
3. **Goldens**: quase todos os itens alteram markup de features com golden. Cada alteração de golden é
   pedida e justificada antes de regenerar (Q4).
4. **Interface existente mais avançada do que o protótipo** (não substituir): agente v2 real com
   ferramentas/MCP/hooks/skills/checkpoints; PairCode cifrado com WebRTC e relay; Learning Track com
   plugins e avaliação real; Studio de arquitectura real; painel inferior com PTY, problemas e portas reais;
   extensões Open VSX. O protótipo serve de referência **visual e de interacção**, não de motor.

## 6. Ordem proposta das fases

A ordem do prompt (A1 PairCode → A10) é aceitável, mas há dependências que pedem outra:

1. **A0.5 — Base honesta (S/M):** corrigir o bug do motor local no SCM, ligar o painel Testing aos
   comandos reais, tirar as afirmações falsas ("traces real binaries"), mover os segredos de `envx6`
   para o keyring. Pré-requisito de quase tudo.
2. **A2 — Co-Dev no editor + `codev.ask`** (L): é o centro do produto e quase todos os itens dependem do
   contrato de contexto.
3. **A5 — Project com SQLite** (L): backend parcialmente existente; liga tudo (issue ↔ ramo ↔ testes ↔ Co-Dev).
4. **A1 — PairCode** (M): independente e rápido.
5. **A3 — Harness** (M/L): constrói sobre A2.
6. **A6 — Testes** (L) e **A4 — SCM** (L).
7. **A7 — Debug DAP** (L), **A8 — Visualize** (L), **A9 — Cloud** (L), **A10 — lacunas** aprovadas.

Cada fase termina com `ui:build` + `ui:test` + `arch:check` + `cargo test` + `selftest.sh` +
`pairtest.sh` verdes, testes Playwright em `ui-app/e2e/` com capturas a 1440×900 vistas antes de dar a
fase por concluída, e pára para revisão.
