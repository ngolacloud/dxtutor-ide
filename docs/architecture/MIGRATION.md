# DXTUTOR IDE — plano e baseline de migração

Documento vivo da reorganização Clean Architecture. Registo da **baseline**
(Etapa 0), do **mapa origem→destino** e dos **critérios de saída** por etapa.

## 0. Baseline

| Item | Valor |
|---|---|
| Branch base | `main` |
| Branch de trabalho | `develop` |
| Commit inicial (HEAD == referência) | `6017c120e15b4155a803c74eac86e39590f5c10a` |
| Data | 2026-11-17 |
| Toolchain Node | v25.0.0 / npm 11.6.2 (via nvm) |
| `node_modules` | presente |
| `npm run ui:build` | **verde** — `tsc --noEmit` passa + `vite build ✓ built in ~0.7s`, exit 0. Aviso de chunk > 500 kB (não bloqueante; conteúdo `learn.ts`) |
| `cargo` / testes Rust | **não executados nesta etapa** (pesados; Tauri + deps). A validar na etapa que tocar o backend |

### Comandos executados nesta etapa

| Comando | Ambiente | Resultado |
|---|---|---|
| `npm run ui:build` | nvm node v25, `node_modules` presente | exit 0, UI compila |
| Inspecção estática (grep/sed/find) | — | ver tabelas abaixo |

Falhas preexistentes vs regressões: nenhuma regressão introduzida (etapa
read-only sobre código de produção; só se acrescentou documentação e
`AGENTS.md`).

## 1. Revalidação dos achados E01–E15 contra o HEAD

> Regra: revalidar antes de tratar como problema actual. Estado = **confirmado**,
> **corrigido** ou **a confirmar** (na etapa própria).

| ID | Achado da avaliação | Estado no HEAD | Evidência |
|---|---|---|---|
| E01 | Workspace com 7 crates `tutor-*` + `src-tauri` | ✅ confirmado | `Cargo.toml` members |
| E02 | `ui-app` é a UI oficial | ✅ confirmado | `package.json:13`, `tauri.conf.json:7`, `README:77–96` |
| E03 | 39 TS em `ui-app/src`, 31 em `features/` | ✅ confirmado | `find` |
| E04 | 12 ficheiros com `@ts-nocheck` | ⚠️ **corrigido: 21** | ver §3 |
| E05 | `core.ts` fachada sobre `window`; features publicam globais; `startup` encadeia `bootN` | ✅ confirmado | `startup.ts:14`; §4 |
| E06 | `bridge.ts` substitui funções em runtime; `index.html` carrega sequência | ✅ confirmado | `bridge.ts`; §4 |
| E07 | `lib.rs` ~102 kB / ~2,7 k linhas; 95 `#[tauri::command]`; 133 registados | ✅ confirmado e quantificado | `lib.rs` 101 956 B / 2729 linhas; §2 |
| E08 | `learn.ts` ~549 kB, dados `COURSES` numa linha | ✅ confirmado | `learn.ts` = 548 732 B (maior feature) |
| E09 | Crates misturam contratos e implementações | ✅ confirmado (dimensão) | `tutor-eval` 27 fich./12 k linhas; §2 |
| E10 | `build` = só `tauri build`, sem `beforeBuildCommand`; release não corre `ui:build` | ✅ confirmado | `package.json`, `tauri.conf.json`, `build.yml` |
| E11 | CI só em tags `v*`/manual; `cargo test` em `src-tauri`; sem suites frontend | ✅ confirmado | `.github/workflows/build.yml` |
| E12 | `tutor-track` converte erros em `false`/vazio/linhas descartadas | 🟡 a confirmar (Etapa 3) | `sqlite.rs` (349 linhas) — só 1 sinal óbvio (`unwrap_or(0)`); auditar na extracção |
| E13 | Handlers inline; `unsafe-inline`; `dangerousDisableAssetCspModification: true` | ✅ confirmado | `tauri.conf.json:22–23`; onclick inline em `codev.ts`(27), `app.ts`(23)… |
| E14 | `bridge.ts` decide aprovação de ferramentas no frontend | ✅ confirmado (presença) | `bridge.ts`; política a mover p/ backend (Etapa 5) |
| E15 | Workspaces/ADRs simulados em strings do produto | ✅ confirmado (são dados) | caminhos `desktop/src/…` em conteúdo |

**Correcção material:** o `@ts-nocheck` não está em 12 ficheiros mas em **21**.
A avaliação omitiu `core.ts`, `generators`, `i18n`, `learn`, `studio`, `syntax`,
`team`, `terminal`, `pair`. A baseline de supressões de tipos é 21 (§3).

## 2. Inventário IPC (133 comandos)

Registados em `src-tauri/src/lib.rs:784` (`tauri::generate_handler!`).

| Módulo de origem | N.º | Comandos |
|---|---|---|
| `lib.rs` | 0 | **Etapa 3 (13º e último grupo):** já não regista `#[tauri::command]` — só compõe/regista (+ `enable_media`/`run`/`setup`) e guarda os DTOs serializáveis do «cérebro» (`ProjectDto`/`AssessmentDto`/…) com os seus mappers `pub(crate)`, a fronteira para o webview partilhada entre grupos |
| `commands/study.rs` | 11 | estudo (`list_phases`, `submit`, `submit_step`, `request_hint`, `request_plan`, `request_fix`, `get_course`, `list_courses`, `study_policy`, `get_glossary`, `get_study_guide`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `crate::study` (classificação de passos `course_step`/`step_language`/`step_is_autonomous` partilhada com `assistant`, política de estudo, carregamento de conteúdo com erro tipado `StudyError`, avaliação honesta `grade_phase`/`grade_step` que reusa `tutor_eval::assess`; `PROJECT_ID` + a regra offline `curated_hint` migraram para o caso de uso, os provedores LLM ficam no adaptador) |
| `commands/missions.rs` | 4 | missões/execução (`run_drill`, `run_measured`, `compile_pipeline`, `trace_execution`) — **Etapa 3**: passagens sobre `tutor_eval` (já Tauri-free: runner, medição `wait4`/`rusage`, pipeline do toolchain, tracer); a única regra isolada é o despacho Go-vs-Rust do drill (`missions::drill_language`, puro e testável) |
| `commands/pair.rs` | 4 | PairCode (`pair_host`, `pair_join`, `pair_send`, `pair_stop`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `crate::pair` (mecanismo TCP + ChaCha20-Poly1305 + WebSocket, já Tauri-free — grupo de passagens como `debug`); o adaptador desembrulha o `tauri::State<pair::Pair>` e veste a emissão dos eventos `pair-status`/`pair-msg` (helper `pair_events`) |
| `commands/sandbox.rs` | 3 | sandbox/run (`compose_ps`, `get_sandbox_engine`, `set_sandbox_engine`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `crate::sandbox` (shaping puro do `docker compose ps` via `parse_compose_ps` + validação de motor com erro tipado `SandboxError`; a precedência runtime→env→host do motor fica em `tutor_eval`) |
| `commands/devcontainer.rs` | 8 | devcontainers (`devcontainer_info`, `devcontainer_up`, `devcontainer_exec`, `devcontainer_session_up`, `devcontainer_session_exec`, `devcontainer_session_run`, `devcontainer_session_status`, `devcontainer_session_down`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `crate::devcontainer` (descoberta do `devcontainer.json`, parsing JSONC, resolução de imagem, `postCreateCommand`, guarda de sessão + erro tipado `DevcontainerError`) |
| `commands/debug_cmds.rs` | 10 | debug/DAP (`debug_capabilities`, `debug_available`, `debug_launch`, `debug_break`, `debug_run`, `debug_continue`, `debug_step`, `debug_locals`, `debug_stack`, `debug_stop`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `debug` (grupo de passagens — o motor gdb/MI já era Tauri-free; ganhou a fachada `capabilities()`; sem erro tipado novo) |
| `commands/search.rs` | 4 | pesquisa/projecto (`search_project`, `list_files`, `read_folder_sources`, `detect_projects`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `search` (defaults de página como contrato + walk de projectos/fontes; grupo infalível, sem erro tipado) |
| `commands/review.rs` | 3 | review (`review_code`, `list_review_analyzers`, `verify_review_fix`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `review::run_review` |
| `commands/codeintel.rs` | 10 | code intel (`symbol_relations`, `list_symbols`, `symbol_ranges`, `file_outline`, `diff_lines`, `propose_entrypoint`, `project_entrypoint`, `resolve_definition/references/hover`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `codeintel` |
| `commands/tests.rs` | 5 | testes/execução (`list_tests`, `run_test`, `run_all_tests`, `run_tests`, `run_path`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `testexec` (despacho por língua, sessão-vs-host + erro tipado, split de argumentos) |
| `commands/git.rs` | 13 | git/SCM (`git_changes/diff/clone/stage/unstage/stage_all/commit/branches/checkout/create_branch/log/show/branch`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `gitops` (página por omissão do histórico, default de diff, erro tipado `GitError`) |
| `commands/codev.rs` | 5 | co-dev (`codev_policy`, `codev_session_start/deliver/discard/list`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `codev` (regra `policy_for_mode` + fachada do mecanismo de sessões `tutor_eval::git`) |
| `commands/agent.rs` | 7 | agente/arquitectura (`arch_validate`, `arch_scaffold`, `arch_scaffold_preview`, `agent_isolated_patch`, `agent_task_submit/status/cancel`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `agent` (regra do scaffold com erro tipado `ScaffoldError`; registo de tarefa cloud-shaped como orquestração pura; executor isolado `worktree_patch` re-exportado) |
| `commands/assistant.rs` | 8 | assistant/providers (`assistant_models`, `assistant_chat`, `assistant_chat_stream`, `assistant_cancel`, `list_providers`, `get_providers_config`, `save_providers_config`, `get_diagnostics`) — **Etapa 3**: adaptadores finos sobre o caso de uso Tauri-free `assistant` (preparação do stream com política de estudo + validação de provider/erro tipado `StreamError`; dispatch SSE e registo de cancelamento como orquestração pura; mapeamento de diagnósticos → DTO `Diagnostic`; emissão dos eventos `llm://*` fica no adaptador) |
| `bridge.rs` | 14 | `load_workspace`, `write_file`, `delete_file`, `expand_path`, `exec`, `run_shell`, `kill_shell`, `keys_status`, `save_key`, `llm_chat`, `llm_plan`, `vsix_manifest`, `app_info`, `selftest_report` |
| `fsops.rs` | 10 | `pick_folder`, `list_dir`, `read_text_file`, `write_text_file`, `create_path`, `delete_path`, `rename_path`, `workspace_tree`, `workspace_action`, `workspace_resolve` |
| `lsp.rs` | 8 | `lsp_start/did_open/did_change/definition/references/hover/rename/prepare_rename` |
| `pty.rs` | 4 | `pty_spawn`, `pty_spawn_in_session`, `pty_write`, `pty_resize` |
| `board.rs` | 2 | `board_load`, `board_save` |

> A matriz detalhada (args, retorno, erro, evento, consumidor na UI, política)
> é entregável da Etapa 1 — ver **`docs/architecture/IPC-MATRIX.md`** (133
> comandos, 1:1 com o `generate_handler!`, verificado por `scripts/arch-check.sh`).
> Esta lista é o índice de referência.

## 3. Baseline `@ts-nocheck` — 21 ficheiros

Meta: reduzir a zero com tipos reais, sem `any` generalizado / `@ts-ignore` /
`as unknown as`. A baseline **não pode crescer**.

Topo (7): `app.ts`, `boot.ts`, `core.ts`, `startup.ts`, `pair.ts`, `v5.ts`, `v6.ts`.
Features (14): `board`, `codev`, `debug`, `ext`, `generators`, `i18n`, `infra`,
`learn`, `scm`, `studio`, `syntax`, `team`, `terminal`, `visualizer`.

(7 de topo + 14 features = 21.)

## 4. Baseline de acoplamento da UI

- **Arranque encadeado:** `startup.ts:14` → `boot();boot3();boot4();boot5();boot6();boot7();i18nBoot();`.
- **Publicações `window.X =` (top 8):** `boot.ts` 63, `codev.ts` 19,
  `palette.ts`/`debug.ts` 12, `board.ts` 9, `app.ts`/`scm.ts` 8/8,
  `diagnostics.ts` 7. Total espalhado por ~35 ficheiros.
- **Handlers inline (top):** `codev.ts` 27, `app.ts` 23, `infra.ts` 15,
  `boot.ts` 14, `pair.ts` 12, `scm.ts` 11, `v6.ts`/`v5.ts` 10.
- **Substituições em runtime:** `bridge.ts` troca a fonte simulada pela real
  (execução, Git, infra, missões, changelog).

### Inventário de features (bytes) — concentração de dados

| Feature | Bytes | Nota |
|---|---|---|
| `learn` | 548 732 | **Dados `COURSES` embutidos** — separar conteúdo/regras/view (Etapa 5) |
| `visualizer` | 76 690 | motor denso |
| `i18n` | 64 816 | tabelas de tradução |
| `codev` | 56 712 | agente + política no frontend |
| `infra` | 27 700 | |
| `debug` | 25 432 | |
| `board` | 23 330 | |
| `studio` | 18 868 | |
| `scm` | 16 622 | |
| `ext` | 13 633 | |
| restantes 21 | < 12 k cada | `generators, team, terminal, changelog, explorer, stack, search, editor, diagnostics, router, tasks, palette, diff, tutor, theme, syntax, test, account, remote, run, notifications` |

Ficheiros de topo: `app.ts, boot.ts, bridge.ts, core.ts, pair.ts, startup.ts, v5.ts, v6.ts`.

## 5. Estatuto das UIs (CA-03)

| Pasta | Ficheiros | Imports activos de prod? | Estatuto |
|---|---|---|---|
| `ui-app/` | 48 | — (é a UI) | **Oficial** |
| `ui-next/` | 48 | Não (só comentários «harvest» em `ui-app`) | Experimental |
| `ui/` | 5 | Não | Histórica |

Configs de build (`package.json`, `vite.config`, `tauri.conf.json`) não
referenciam `ui/` nem `ui-next/`.

## 6. Mapa origem → destino (proposta)

| Responsabilidade (origem) | Destino |
|---|---|
| `lib.rs` DTOs/comandos por feature | `src-tauri/src/commands/<feature>.rs`, `dto/` |
| `lib.rs` orquestração/regras | casos de uso Rust independentes de Tauri (`tutor-application/` se justificar) |
| `lib.rs` montagem/registo | `composition.rs` + `lib.rs` fino |
| `tutor-llm` HTTP vs políticas | separar contratos/políticas de implementação HTTP |
| `tutor-track`/`tutor-board` modelos vs SQLite | separar contratos de implementação (reexports de compat OK) |
| `tutor-eval` análise vs coordenação vs ferramentas externas | adaptadores por caso de uso migrado |
| UI `bootN` + substituições | `ui-app/src/main.ts` + serviços injectados |
| UI globais `window.X` | imports/exports + proprietários de estado |
| UI `invoke`/casts dispersos | `ui-app/src/platform/tauri/` tipado + `contracts/` |
| `learn.ts` dados+regras+view | dados em catálogo tipado/ficheiros + estado + regras + view |

## 7. Etapas e critérios de saída

| Etapa | Entrega | Condição de avanço | Estado |
|---|---|---|---|
| **0 — Baseline** | Inventário, build baseline, registos permanentes (AGENTS/ADR/ARCHITECTURE/MIGRATION/README) | Evidência suficiente p/ distinguir regressões e localizar consumidores | **em curso** |
| 1 — Build e contratos | `ui:build` na cadeia de `build`; docs coerentes; matriz IPC; 1ªs verificações de arquitectura | Build limpo + contratos de referência verificados | **feito** (ver §9) |
| 2 — Primeira fatia | 1 feature atravessa UI→adaptador→caso de uso→impl (ex. abrir workspace / board) | Testes do caso de uso + teste integrado | **feito** (ver §10) |
| 3 — Backend | Extrair responsabilidades de `lib.rs`; portas e erros tipados; composição | APIs/dados/CLI/TUI preservados | **feito** — 1º grupo (`review`) §11; 2º (`code-intel`) §12; 3º (`testes`/execução) §13; 4º (`git`) §14; 5º (`co-dev`) §15; 6º (`pesquisa`) §16; 7º (`agente`) §17; 8º (`assistant`) §18; 9º (`debug`) §19; 10º (`devcontainers`) §20; 11º (`sandbox`/run) §21; 12º (`PairCode`) §22; **13º e último (`estudo`/`missões`) §23 — `lib.rs` fica sem `#[tauri::command]`** |
| 4 — UI | Estado por proprietário, bootstrap, serviços, fim de globais/substituições, tipagem | Mesmos fluxos, sem dependência da ordem HTML | pendente |
| 5 — Learning e fronteiras | Conteúdo separado, progresso preservado, políticas e CSP verificadas | Testes específicos + compatibilidade de dados | pendente |
| 6 — Consolidação | Remoção de shims, CI PR/main, docs finais, revisão do grafo | Critérios de aceitação ou pendências claras | pendente |

Cada etapa = uma sessão (`.claude/sessions/develop.md`).

## 8. Impedimentos e notas

- **cargo/testes Rust não corridos** na Etapa 0 (custo). Primeira execução na
  Etapa 1/3; registar falhas preexistentes então.
- **E12** (erros SQLite → vazio/false) requer leitura detalhada de
  `tutor-track/src/sqlite.rs` + `tutor-board` na Etapa 3.
- Selftest GUI headless tem limites conhecidos (uma corrida curta, janela real
  no desktop); PairCode/LLM ao vivo validam-se na máquina do utilizador.

## 9. Etapa 1 — build na cadeia e contratos (feito)

**Cadeia de build.** `src-tauri/tauri.conf.json` ganhou
`build.beforeBuildCommand: "npm run ui:build"` (mantendo
`frontendDist: "../ui-app/dist"`). O `npm run build` (= `tauri build`) passa a
regenerar `ui-app/dist` **antes** de o Tauri o embutir. Sem recursão: o hook
chama `ui:build` (tsc + vite), nunca `npm run build`.

- **Prova (checkout sem dist):** `rm -rf ui-app/dist && npm run build` →
  `beforeBuildCommand` regenera `ui-app/dist` (`vite ✓ 41 modules`) → o
  `build.rs` re-embute → `cargo build --release` → **3 bundles** em
  `target/release/bundle/` (`.deb` 5.74 MiB, `.rpm` 5.74 MiB, `.AppImage`
  83.48 MiB), exit 0, sem erro de assets em falta.

**Matriz IPC.** `docs/architecture/IPC-MATRIX.md` — args / retorno / erro /
evento / consumidor-UI / política para os **133 comandos**, com legenda de
políticas (R/W/X/G/N/K/S/E), 9 eventos distintos, e o facto arquitectural de
que **28 comandos são consumidos pela `ui-app`** e 105 não (simulação de
browser / via `exec` / `ui-next`). Fecha com a dívida mapeada p/ Etapas 2–5.

**Verificações automáticas.** `scripts/arch-check.sh` (`npm run arch:check`) —
porta estática barata que falha (exit 1) se a documentação divergir do código:

- A1 `generate_handler!` regista exactamente 133 comandos.
- A2 `#[tauri::command]` por ficheiro == baseline (95/14/10/8/4/2; soma 133).
- A3 `IPC-MATRIX.md` cobre os 133 comandos **1:1** com o registo (sem lacunas
  nem extras) — garante que a matriz não envelhece em silêncio.
- A4 cadeia de build: `frontendDist == ../ui-app/dist`, `beforeBuildCommand`
  corre `ui:build` e **não** é recursivo; `package.json` coerente.
- A5 nenhuma config de build referencia `ui/` ou `ui-next/` (UI oficial única).
- A6 baseline `@ts-nocheck` não cresce acima de 21.

Estado na entrega: **todas verdes (exit 0)**.

## 10. Etapa 2 — primeira fatia vertical: abrir workspace (feito)

Fatia escolhida: **`load_workspace`** (abrir pasta no editor). Já corria real
ponta-a-ponta, mas a chamada era uma string solta sem contrato. A etapa dá-lhe a
forma-alvo UI→adaptador→caso de uso→impl, com fronteiras tipadas e testes, sem
tocar nos outros 27 comandos ligados. (O board/SQLite foi descartado como fatia:
o modelo da UI — `BL.issues` — e o do backend — `Backlog` sprints/stories — divergem,
exigindo uma camada de mapeamento; não é uma fatia fina.)

**Caso de uso Rust (independente de Tauri).** `src-tauri/src/workspace.rs` ganhou:
- `LoadPolicy` — a *regra* (quantos ficheiros / que tamanho máximo), com `Default`
  = contrato público actual (4000 ficheiros, 768 KiB). Deixa de ser um número preso
  no comando.
- `OpenError` — erro **tipado** (`NotADirectory` | `Io`), primeiro passo dos erros
  tipados ponta-a-ponta (Etapa 3). `Display` mantém a mensagem histórica
  `"not a folder"` estável na UI.
- `open_workspace(root, policy) -> Result<Loaded, OpenError>` — o caso de uso:
  aplica a política, delega o walk de disco a `load` (o *mecanismo*, intocado) e
  devolve resultado/erro tipados.

**Adaptador IPC (backend).** `bridge::load_workspace` passa a ser um adaptador fino:
invoca `open_workspace(…, LoadPolicy::default())` e só mapeia `OpenError` → `String`
na fronteira Tauri (mesmo `spawn_blocking`, mesma mensagem de erro — comportamento
idêntico). `bridge.rs` continua com 14 comandos (A2 verde); `mod workspace` passou a
`pub` para o teste integrado alcançar a API.

**Adaptador IPC (frontend) — `ui-app/src/platform/tauri/`.** Primeiro tijolo da
fronteira tipada prevista no §6 (UI `invoke`/casts dispersos → cliente tipado):
- `core.ts` — `invoke<T>(cmd, args)` tipado + `isDesktop()`; único ponto onde o cast
  do valor cru de `invoke` acontece.
- `workspace.ts` — contrato `LoadedWorkspace` (espelho de `workspace::Loaded`, serde
  camelCase) + `loadWorkspace(root): Promise<LoadedWorkspace>`.

`bridge.ts` deixa de chamar `inv("load_workspace", { root })` à solta (2 sítios:
`openFolder`, `reloadDisk`) e passa por `loadWorkspace(root)`; a `interface Workspace`
local virou alias de `LoadedWorkspace`. Os restantes 27 comandos migram
comando-a-comando em etapas seguintes.

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes do caso
  de uso em `workspace.rs` (`default_policy_is_the_public_contract`,
  `open_workspace_applies_the_policy_limits`, `open_workspace_reports_not_a_directory_typed`,
  `open_workspace_reports_io_error_for_missing_root`) + 3 testes integrados em
  `src-tauri/tests/workspace_open.rs` (projecto real, política apertada, erro tipado),
  todos verdes. 1.ª corrida da suite Rust nesta reorg: 0 falhas em todos os crates
  (muitos `ignored` preexistentes nos e2e do `tutor-eval` são por design — exigem
  toolchains externas).
- `npm run ui:build` verde (tsc tipa o adaptador; `vite ✓ 43 modules`, +2 vs 41).
- **Selftest desktop REAL** (xvfb, `HOME` temp, Ollama morto): `errors: []`,
  `stepErrors: {}`; passo `open` = `{root, git:true, commits:1, files:2}` — a pasta
  foi carregada pelo adaptador tipado `loadWorkspace` contra o backend real (sem
  simulação de browser). Passos de git/terminal/scm/agentTask verdes; passos de LLM
  `skipped — no model reachable` (esperado sem modelo).
- `npm run arch:check` **exit 0** (A1–A6; bridge.rs 14 comandos; @ts-nocheck 21).

## 11. Etapa 3 — backend: 1º grupo extraído (`review`) (feito)

Primeiro grupo saído do monólito `lib.rs`, escolhido por isolamento: os três
comandos de **review de código** (`review_code`, `list_review_analyzers`,
`verify_review_fix`) são R/puros e **não consumidos pela `ui-app`** — extrair não
arrisca a UI. Aplica o padrão provado na Etapa 2 (caso de uso Tauri-free + adaptador
IPC fino), agora na direcção `lib.rs` → `commands/<feature>.rs`.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/review.rs`.** O comando
`review_code` tinha embutida uma *regra* (traduzir o selector de escopo da UI —
`"file"`/`"changes"`/`"project"` — num `ReviewScope` tipado, rejeitando `"file"` sem
caminho). Essa regra sai para:
- `ReviewError` — erro **tipado** (`FileScopeNeedsPath` | `Analysis(String)`). `Display`
  mantém estáveis as mensagens históricas da UI (`"file scope needs a path"`,
  `"review failed: …"`).
- `parse_scope(scope, path) -> Result<ReviewScope, ReviewError>` — a regra isolada
  (fail-open para projecto em escopo desconhecido, histórico).
- `run_review(root, scope, path, version) -> Result<ReviewReport, ReviewError>` — o caso
  de uso: aplica a regra e delega o trabalho pesado a `tutor_eval::review::review` (o
  mecanismo, intocado).

**Adaptadores IPC (backend) — `src-tauri/src/commands/review.rs` (+ `commands/mod.rs`).**
Pasta nova por feature. `review_code` corre `run_review` em `spawn_blocking` (um
analisador de vários segundos nunca trava a janela) e mapeia `ReviewError` → `String` só
na fronteira; `list_review_analyzers`/`verify_review_fix` são passagens directas para
funções já Tauri-free de `tutor_eval::review` (não precisam de camada nova).
`lib.rs` importa os três por nome (`use commands::review::…`), por isso o registo de
handlers continua a listá-los sem prefixo e **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes unitários
  do caso de uso em `review.rs` (`parse_scope_maps_the_ui_selector`,
  `file_scope_without_path_is_a_typed_error`,
  `run_review_rejects_file_scope_without_path_before_touching_disk`,
  `analysis_error_wears_the_historical_prefix`) + 3 integrados em
  `src-tauri/tests/review_run.rs` (projecto Rust real, erro tipado de escopo,
  fail-open), todos verdes. Suites preexistentes inalteradas (os `ignored` dos e2e do
  `tutor-eval` são por design).
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  95→92 e novo `commands/review.rs`=3 em `scripts/arch-check.sh`; A3 1:1 mantido; §2 e
  IPC-MATRIX §4/Resumo coerentes).

## 12. Etapa 3 — backend: 2º grupo extraído (`code-intel`) (feito)

Segundo grupo saído de `lib.rs`, escolhido pelo mesmo isolamento do `review`: os dez
comandos de **inteligência de código** (`symbol_relations`, `list_symbols`,
`symbol_ranges`, `file_outline`, `diff_lines`, `propose_entrypoint`,
`project_entrypoint`, `resolve_definition`, `resolve_references`, `resolve_hover`) são
R/puros e **não consumidos pela `ui-app`** (o editor usa simulação/`ui-next`) — extrair
não arrisca a UI. Mesmo padrão: caso de uso Tauri-free + adaptadores IPC finos.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/codeintel.rs`.** Cinco dos
comandos tinham *regras* embutidas que não são do mecanismo de análise; saem para aqui:
- `CodeIntelError` — erro **tipado** (`Codemap(String)`). `Display` mantém estável a
  mensagem histórica da UI (`"codemap failed: …"`).
- `ResolvedDef` — DTO (serde camelCase, 1-based) que nasceu em `lib.rs` ao lado do
  comando; vive agora no caso de uso que o produz.
- `editor_to_lsp`/`resolved_from` — a **tradução de coordenadas** editor (1-based) ↔ LSP
  (0-based), que os três comandos de resolução repetiam inline.
- `relations` — tipa a falha de `codemap::symbol_relations`.
- `outline` — a coordenação **«servidor-de-língua primeiro, mapa sintáctico como
  recurso»** que estava inline em `file_outline`.
- `definition`/`references`/`hover` — resolução via servidor de língua já em coordenadas
  do editor, dando forma a `ResolvedDef`.

Os outros cinco (`symbol_ranges`, `list_symbols`, `diff_lines`, `propose_entrypoint`,
`project_entrypoint`) são passagens directas para funções já Tauri-free
(`tutor_eval`/`crate::fsops`) — sem regra para isolar, não ganham camada, tal como
`detect_analyzers`/`verify_fix` no grupo review.

**Adaptadores IPC (backend) — `src-tauri/src/commands/codeintel.rs` (+ `commands/mod.rs`).**
Os dez comandos: os com regra correm o caso de uso em `spawn_blocking` e mapeiam
`CodeIntelError` → `String` só na fronteira; os directos chamam o motor directamente.
`lib.rs` importa os dez por nome (`use commands::codeintel::…`), por isso o registo de
handlers continua a listá-los sem prefixo e **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes unitários
  do caso de uso em `codeintel.rs` (`editor_1_based_maps_to_lsp_0_based_and_saturates`,
  `resolved_from_shapes_the_dto_back_to_1_based`,
  `outline_falls_back_to_the_syntactic_map_without_root`,
  `codemap_error_wears_the_historical_prefix`) + 2 integrados em
  `src-tauri/tests/codeintel_nav.rs` (mapa de símbolos sobre projecto Rust real; outline
  sobre ficheiro real), todos verdes. Suites preexistentes inalteradas.
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  92→82 e novo `commands/codeintel.rs`=10 em `scripts/arch-check.sh`; A3 1:1 mantido; §2 e
  IPC-MATRIX §6/Resumo coerentes).

## 13. Etapa 3 — backend: 3º grupo extraído (`testes`/execução) (feito)

Terceiro grupo saído de `lib.rs`: os cinco comandos de **execução** — os testes
(`list_tests`, `run_test`, `run_all_tests`, `run_tests`) e o ficheiro do Explorer
(`run_path`). Ao contrário de `review`/`code-intel`, `run_tests` é consumido pela `ui-app`
(protocolo co-dev / `features/codev.ts`), por isso a extracção preserva **nome, args, retorno
serde e mensagens de erro** exactamente — o registo de handlers continua a listar os cinco
sem prefixo (mover ≠ remover). Mesmo padrão: caso de uso Tauri-free + adaptadores IPC finos.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/testexec.rs`.** Três dos comandos
tinham *regras* embutidas que não são do mecanismo de execução (compilar/correr, que vive em
`tutor_eval`/`crate::fsops`, intocado); saem para aqui:
- `TestLang` + `run_one` — o **despacho por língua** de `run_test` (`go`/`python`/rust → runner
  certo; desconhecido/`None` → Rust, fail-open histórico). `run_one` é infalível ao nível do
  caso de uso (um teste que não corre devolve `TestRun { ran: false, .. }`, como antes).
- `TestError` (erro **tipado**: `NoTestCommand` | `Exec`) + `SuiteRun` (DTO, antes `TestRun` em
  `lib.rs`) + `run_project_suite` — a **escolha sessão-de-contentor-vs-host** de `run_tests`,
  com a mensagem histórica estável (`"No known test command for this project."`; os erros de
  execução passam crus, `"could not start tests: …"`).
- `split_args` — a **tradução de argumentos** de `run_path` (string → `argv`).

`list_tests`/`run_all_tests` são passagens directas para funções já Tauri-free
(`tutor_eval::testnav::discover_tests`/`run_suite`) — sem regra para isolar, não ganham camada,
tal como `detect_analyzers` no grupo review. `run_path` reusa `RunDto` (partilhado com
`run_drill`/`run_measured`), que fica em `lib.rs` como `pub(crate)`.

**Adaptadores IPC (backend) — `src-tauri/src/commands/tests.rs` (+ `commands/mod.rs`).** Os
cinco comandos: os com regra correm o caso de uso em `spawn_blocking` (compilar/correr testes é
trabalho longo — nunca na thread da janela) e mapeiam o erro tipado → `String` só na fronteira;
os directos chamam o motor directamente. `lib.rs` importa os cinco por nome
(`use commands::tests::…`), por isso **A1 fica em 133**.

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes unitários do caso
  de uso em `testexec.rs` (`test_lang_maps_the_ui_selector`,
  `no_test_command_is_a_typed_error_with_the_historical_message`,
  `exec_error_is_passed_through_verbatim`, `split_args_tokenizes_on_whitespace`) + 2 integrados
  em `src-tauri/tests/tests_run.rs` (suite `cargo test` sobre um crate Rust real que passa; erro
  tipado `NoTestCommand` numa pasta sem projecto), todos verdes. Suites preexistentes inalteradas.
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  82→77 e novo `commands/tests.rs`=5 em `scripts/arch-check.sh`; A3 1:1 mantido; §2 e
  IPC-MATRIX §7/§13/Resumo coerentes).

## 14. Etapa 3 — backend: 4º grupo extraído (`git`/SCM) (feito)

Quarto grupo saído de `lib.rs`: os treze comandos `git_*` — as leituras (`git_changes`,
`git_log`, `git_show`, `git_branch`, `git_branches`, `git_diff`) e as mutações (`git_stage`,
`git_unstage`, `git_stage_all`, `git_commit`, `git_checkout`, `git_create_branch`,
`git_clone`). É o módulo mais **coeso** que restava — um só namespace de mecanismo
(`tutor_eval::git`) e um padrão uniforme (`spawn_blocking` + mapeamento de erro). Como
`run_tests`, parte do grupo é **consumida pela `ui-app`** (o pane SCM, via `bridge.ts`), por
isso a extracção preserva **nome, args, retorno serde e mensagens de erro** exactamente — o
registo de handlers continua a listar os treze sem prefixo (mover ≠ remover). Mesmo padrão:
caso de uso Tauri-free + adaptadores IPC finos.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/gitops.rs`.** Três *regras* que
estavam embutidas nos `#[tauri::command]` (e não são do mecanismo de disco) saem para aqui:
- `DEFAULT_LOG_LIMIT` (+ `log_limit`) — a **página por omissão do histórico**, que era o
  literal `200` dentro de `git_log`; passa a contrato nomeado, não número mágico no comando.
- `want_staged` — o **default de `git_diff`** (sem `staged` → árvore de trabalho vs HEAD).
- `GitError` — erro **tipado** que unifica as DUAS superfícies de falha do git, com o
  `Display` a preservar as mensagens estáveis: `Task(String)` veste o prefixo histórico
  `"git task failed: …"` (falha da tarefa bloqueante) e `Git(String)` passa o `stderr` do
  git **cru**, sem prefixo (como o `?` sobre o `Result<_, String>` interno já deixava passar).

As mutações (`stage`/`unstage`/`stage_all`/`commit`/`checkout`/`create_branch`/`clone`) e as
leituras com regra (`history`/`diff`) são funções do caso de uso; as leituras sem regra
(`changed_files`/`show`/`branches`/`current_branch`) ficam passagens directas para
`tutor_eval::git` no adaptador — tal como `detect_analyzers` no grupo review.

**Adaptadores IPC (backend) — `src-tauri/src/commands/git.rs` (+ `commands/mod.rs`).** Os
treze comandos correm o trabalho num worker bloqueante (tocar no git é I/O de processo —
nunca na thread da janela) e mapeiam o erro → `String` só na fronteira: as mutações fazem
`.map_err(|e| format!("git task failed: {e}"))?.map_err(|e| e.to_string())` (join → prefixo;
`GitError::Git` → stderr cru), idêntico ao comportamento anterior. `lib.rs` importa os treze
por nome (`use commands::git::…`), por isso **A1 fica em 133**.

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes unitários do
  caso de uso em `gitops.rs` (`log_limit_defaults_to_the_public_page_size`,
  `want_staged_defaults_to_the_working_tree`, `git_error_task_wears_the_historical_prefix`,
  `git_error_git_passes_stderr_through_verbatim`) + 3 integrados em
  `src-tauri/tests/git_ops.rs` (repo git real: página por omissão + limite explícito;
  `stage`+`commit` round-trip; `checkout` inválido → `GitError::Git` com o stderr cru), todos
  verdes. Suites preexistentes inalteradas.
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  77→64 e novo `commands/git.rs`=13 em `scripts/arch-check.sh`; A3 1:1 mantido; §2 e
  IPC-MATRIX §8/Resumo coerentes).

## 15. Etapa 3 — backend: 5º grupo extraído (`co-dev`) (feito)

Quinto grupo saído de `lib.rs`: os cinco comandos **co-dev** — a política de aprovação da
modebar (`codev_policy`) e o ciclo de vida das sessões isoladas (`codev_session_start`,
`codev_session_deliver`, `codev_session_discard`, `codev_session_list`). Como `run_tests`/`git_*`,
parte do grupo é **consumida pela `ui-app`** (a modebar / `features/codev.ts`), por isso a
extracção preserva **nome, args, retorno serde e mensagens de erro** exactamente — o registo de
handlers continua a listar os cinco sem prefixo (mover ≠ remover). Mesmo padrão: caso de uso
Tauri-free + adaptadores IPC finos.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/codev.rs`.** O grupo tem duas
naturezas e só uma traz *regra* isolável:
- `policy_for_mode(mode) -> CoDevPolicy` — a **regra** que estava embutida em `codev_policy`:
  traduzir a string da modebar (Manual/Assist/Auto, desconhecida → a mais estrita, *fail-closed*)
  no retrato de política que a UI consulta. Composição nomeada de `CoDevMode::parse` + `codev_policy`
  de `tutor_llm::policy`, agora com fronteira e testes próprios.
- As **sessões** (`codev_session_*`) eram passagens directas ao *mecanismo* de worktrees git
  (`codev/<slug>`), que vive em `tutor_eval::git` e **não tem regra** para isolar — tal como as
  leituras sem regra do grupo git. Re-exportam-se aqui (`session_start`/`session_deliver`/
  `session_discard`/`sessions` + `SessionInfo`/`DeliverInfo`) para a fatia ter **uma** fachada
  Tauri-free que o adaptador IPC e o teste integrado atravessam (o crate de teste só vê
  `dxtutor_ide_lib`, não `tutor_eval`).

**Adaptadores IPC (backend) — `src-tauri/src/commands/codev.rs` (+ `commands/mod.rs`).**
`codev_policy` corre a regra pura; as sessões correm num worker bloqueante (tocar no git é I/O de
processo, nunca na thread da janela) e vestem o prefixo histórico `"git task failed: …"` numa falha
da tarefa, com o erro interno do git a passar cru pelo `?`. `lib.rs` importa os cinco por nome
(`use commands::codev::…`), por isso **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes unitários do caso
  de uso em `codev.rs` (`policy_parses_the_modebar_mode_and_fails_closed`,
  `manual_asks_for_everything_assist_and_auto_do_not`, `only_auto_chains_steps`,
  `destructive_always_asks_in_every_mode`) + 3 integrados em `src-tauri/tests/codev_session.rs`
  (repo git real: `start`→`list`→`discard` sobre worktree isolada; `start` fora de repo → erro
  `"not a git repository"`; `policy_for_mode` alcançável e *fail-closed* na fronteira do crate),
  todos verdes. Suites preexistentes inalteradas (os `ignored` dos e2e do `tutor-eval` são por design).
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  64→59 e novo `commands/codev.rs`=5 em `scripts/arch-check.sh`; A3 1:1 mantido; §2 e
  IPC-MATRIX §3/§10/Resumo coerentes).

## 16. Etapa 3 — backend: 6º grupo extraído (`pesquisa`/projecto) (feito)

Sexto grupo saído de `lib.rs`: os quatro comandos de **pesquisa e projecto** — a busca
literal (`search_project`), o quick-open (`list_files`), a detecção de projectos
(`detect_projects`) e a recolha de fontes para Explain de módulo (`read_folder_sources`).
Nenhum é hoje invocado via `invoke` pela `ui-app` (as ocorrências de `list_files` em
`bridge.ts`/`features/codev.ts` são o **nome de uma ferramenta LLM** local, não o comando
IPC) — extrair não arrisca a UI. Ainda assim, por serem contrato público, preservam-se
**nome, args, retorno serde, defaults e mensagens** exactamente; o registo de handlers
continua a listar os quatro sem prefixo (mover ≠ remover). Mesmo padrão: caso de uso
Tauri-free + adaptadores IPC finos.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/search.rs`.** Duas *regras* que
viviam dentro dos `#[tauri::command]` (e não são do mecanismo de disco) saem para aqui:
- Os **tamanhos de página por omissão** — `DEFAULT_SEARCH_MAX` (500), `DEFAULT_LIST_MAX`
  (5000), `DEFAULT_FOLDER_MAX_FILES` (10), `DEFAULT_FOLDER_MAX_BYTES` (48 000) — que eram
  literais presos em `max.unwrap_or(…)` dentro de cada comando; passam a contrato nomeado.
- O **walk de detecção/recolha** — `detect_projects` (raiz + um nível, saltando ocultos e
  `node_modules`/`target`/`dist`/`build`/`vendor`) e `read_folder_sources` (recursivo,
  mesmos saltos, extensões de fonte, truncagem honesta por caps). Os DTOs `ProjectInfo` e
  `FolderSource` nasceram ao lado dos comandos em `lib.rs`; vivem agora no caso de uso que
  os produz.

`search`/`list_files` são finas: aplicam o default de página e delegam ao mecanismo
`tutor_eval::search`, intocado. O grupo é **infalível** ao nível do caso de uso (o walk
engole E/S como antes — uma pasta ilegível é saltada), por isso **não ganha erro tipado**,
tal como `testexec::run_one`; a única falha que resta é o *join* da tarefa bloqueante.

**Adaptadores IPC (backend) — `src-tauri/src/commands/search.rs` (+ `commands/mod.rs`).** Os
quatro comandos correm o caso de uso num worker bloqueante (varrer disco nunca trava a
janela) e só vestem o prefixo histórico `"… task failed: …"` na fronteira. `lib.rs` importa
os quatro por nome (`use commands::search::…`), por isso **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes unitários do
  caso de uso em `search.rs` (`default_page_sizes_are_the_public_contract`,
  `detect_projects_finds_the_root_and_one_level_down`,
  `read_folder_sources_caps_the_file_count`,
  `read_folder_sources_skips_build_dirs_and_non_source`) + 3 integrados em
  `src-tauri/tests/search_files.rs` (projecto real: busca+quick-open; detecção multi-projecto
  com `target/` saltado; recolha com cap e `dist/` saltado), todos verdes. Suites
  preexistentes inalteradas (os `ignored` dos e2e do `tutor-eval` são por design).
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  59→55 e novo `commands/search.rs`=4 em `scripts/arch-check.sh`; A3 1:1 mantido; §2 e
  IPC-MATRIX §13/§18/Resumo coerentes).

## 17. Etapa 3 — backend: 7º grupo extraído (`agente`/`arquitectura`) (feito)

Sétimo grupo saído de `lib.rs`: os sete comandos de **agente e arquitectura** — a validação
de um System Design (`arch_validate`), a sua materialização (`arch_scaffold`) e
pré-visualização (`arch_scaffold_preview`), o executor isolado directo
(`agent_isolated_patch`) e a API de tarefa cloud-shaped RF-AG-01
(`agent_task_submit`/`agent_task_status`/`agent_task_cancel`). Os três `agent_task_*` **são
invocados** pela `ui-app` (`bridge.ts`, ciclo submit → status → cancel do gestor de missões),
por isso preservam-se **nome, args, retorno serde e mensagens** exactamente; os restantes
quatro não têm consumidor hoje, mas são contrato público e mantêm-se igual. O registo de
handlers continua a listar os sete sem prefixo (mover ≠ remover). Mesmo padrão: caso de uso
Tauri-free + adaptadores IPC finos.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/agent.rs`.** Reúne duas naturezas,
ambas Tauri-free:
- **Arquitectura.** `validate`/`scaffold_preview` são passagens puras ao mecanismo
  `tutor_eval::arch` (`Architecture::validate`/`scaffold`). O `scaffold` traz a *regra* que
  vivia no `#[tauri::command]`: um desenho **inválido** (scaffold vazio — `is_valid()` falso,
  p.ex. uma aresta pendente) **não** se materializa, e ficheiros existentes **nunca** se
  sobrescrevem. Essa regra ganha erro tipado [`ScaffoldError`] (`InvalidDesign` vs `Io`), com
  `Display` que reproduz as mensagens históricas (`"design has errors — fix them before
  scaffolding"` e o erro de E/S cru), como `gitops::GitError`/`testexec::TestError`.
- **Tarefa cloud-shaped (RF-AG-01).** O ciclo submit → status → collect sobre o executor
  isolado local (`worktree_patch`) é **orquestração pura**: o registo de tarefas (`AgentTask`,
  serde camelCase), a geração de id (`new_task_id`), a transição `running` (`register_running`)
  → `done|error` (`run_and_store`), o `status` e o `cancel`. Vivia preso em estáticos de
  `lib.rs`; vem para o caso de uso sem o `spawn_blocking` do Tauri. O executor isolado
  (`worktree_patch`, o mecanismo git intocado) e os tipos de `arch` re-exportam-se como fachada
  da fatia, para o crate de teste atravessar `crate::agent` sem ver `tutor_eval`.

**Adaptadores IPC (backend) — `src-tauri/src/commands/agent.rs` (+ `commands/mod.rs`).**
`arch_validate`/`arch_scaffold_preview` são passagens puras; `arch_scaffold` corre a regra num
worker bloqueante e aplana `ScaffoldError` → `String` na fronteira; `agent_isolated_patch` e
`agent_task_submit` vestem o `spawn_blocking` + o prefixo histórico `"… task failed: …"`, com
o estado e as transições no caso de uso. `lib.rs` importa os sete por nome
(`use commands::agent::…`), por isso **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 5 testes unitários do
  caso de uso em `agent.rs` (`scaffold_preview_matches_scaffold_payload`,
  `scaffold_writes_a_valid_design_and_never_overwrites`,
  `scaffold_of_an_invalid_design_is_a_typed_error`, `task_ids_are_unique`,
  `task_lifecycle_registers_runs_and_cancels`) + 3 integrados em
  `src-tauri/tests/agent_tasks.rs` (scaffold de desenho válido materializa + nunca sobrescreve
  + inválido → erro tipado; ciclo de tarefa sobre repo git real: `running` → `done` com patch
  sem tocar na working tree → `cancel`; `agent_isolated_patch` devolve o diff sem tocar na
  árvore), todos verdes. Suites preexistentes inalteradas (os `ignored` dos e2e do `tutor-eval`
  são por design).
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  55→48 e novo `commands/agent.rs`=7 em `scripts/arch-check.sh`; A3 1:1 mantido; §2 e
  IPC-MATRIX §9/§Resumo coerentes).

## 18. Etapa 3 — backend: 8º grupo extraído (`assistant`/providers) (feito)

Oitavo grupo saído de `lib.rs`: os oito comandos do **Dev-Assistant / providers** — os
modelos locais (`assistant_models`), o chat não-streaming (`assistant_chat`), o chat em
streaming com eventos (`assistant_chat_stream`), o cancelamento (`assistant_cancel`), o
catálogo de providers (`list_providers`), a config persistida (`get_providers_config`/
`save_providers_config`) e os diagnósticos do editor (`get_diagnostics`). Cinco **são
invocados** pela `ui-app` (`bridge.ts`: `get_providers_config`/`list_providers`/
`save_providers_config` no formulário de settings + `assistant_chat_stream`/`assistant_cancel`
no ciclo de stream com botão Stop), por isso preservam-se **nome, args, retorno serde,
eventos e mensagens** exactamente; os outros três (`assistant_models`, `assistant_chat`,
`get_diagnostics`) não têm consumidor hoje mas são contrato público e mantêm-se igual. O
registo de handlers continua a listar os oito sem prefixo. Mesmo padrão: caso de uso
Tauri-free + adaptadores IPC finos.

Este grupo é — como o `agente` — mais de **orquestração/estado** que puro: tem streaming,
eventos `llm://token|done|error` e cancelamento partilhado. A fronteira traçou-se assim: a
**emissão de eventos Tauri e a thread são infra** → ficam no adaptador; tudo o resto isola-se.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/assistant.rs`.** Reúne:
- **Passagens de providers/config** — `ollama_models`/`list_providers`/`load_config`/
  `save_config`/`ollama_chat`, fachada única sobre `tutor_llm::chat` (erros aplanados →
  `String` na fronteira), para `lib.rs` deixar de lhe tocar e o crate de teste atravessar
  `crate::assistant`.
- **Diagnósticos (`diagnostics`)** — a *regra* que vivia no `#[tauri::command]`: correr
  `tutor_eval::diagnostics_for` e mapear para o DTO [`Diagnostic`] (string de severidade +
  sugestão offline de `advise`). O DTO migra de `lib.rs` (`DiagnosticDto`) com o mesmo serde.
- **Preparação do stream (`prepare_stream`)** — a *regra* central: aplica a política de
  estudo (prepende a directiva de tutor quando `chat_is_tutor`) e **valida o provider** (só
  `ollama|claude|openai|gemini` têm adaptador SSE), com erro tipado [`StreamError`] cujo
  `Display` reproduz **exactamente** a mensagem histórica do evento `llm://error`, como
  `gitops::GitError`/`agent::ScaffoldError`.
- **Dispatch do stream (`run_stream`)** — escolhe o adaptador SSE do provider resolvido e
  aplana o erro → `String`; genérico sobre o sink `FnMut(&str) -> bool` (o `emit` que captura
  a `Window` é do adaptador, aqui é Tauri-free).
- **Registo de cancelamento (`register_cancel`/`remove_cancel`/`cancel`)** — orquestração
  pura do estado partilhado das streams em voo (os estáticos `LLM_CANCELS` de `lib.rs`), como
  o registo de tarefas de `crate::agent`.

Os tipos do contrato (`ChatMsg`/`ChatReply`/`ProviderInfo`/`ProvidersConfig`) re-exportam-se
como fachada da fatia, para o crate de teste atravessar `crate::assistant` sem ver `tutor_llm`.

**Adaptadores IPC (backend) — `src-tauri/src/commands/assistant.rs` (+ `commands/mod.rs`).**
Os cinco providers/config/diagnostics são passagens; `assistant_chat` veste o `spawn_blocking`
(HTTP bloqueante) + o prefixo histórico `"assistant task failed: …"`; `assistant_chat_stream`
fica dono da **infra Tauri** — resolve `step_is_autonomous` (lookup de curso, que fica em
`lib.rs`, agora `pub(crate)`), chama `prepare_stream`/`run_stream` do caso de uso, e emite os
eventos `llm://*` numa thread com o sink cancel-aware sobre a flag do registo; `assistant_cancel`
encaminha para `assistant::cancel`. `lib.rs` importa os oito por nome
(`use commands::assistant::…`), por isso **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 7 testes unitários do
  caso de uso em `assistant.rs` (`study_mode_prepends_the_tutor_directive`,
  `project_mode_leaves_the_messages_untouched`, `missing_provider_defaults_to_ollama`,
  `unsupported_provider_is_a_typed_error_with_the_historical_message`,
  `cancel_registry_registers_flags_and_cancels_by_id`,
  `diagnostics_maps_broken_js_to_error_severities`, `diagnostics_of_valid_js_is_empty`) + 4
  integrados em `src-tauri/tests/assistant_group.rs` (política de estudo prepende a directiva e
  valida provider; provider sem adaptador → erro tipado com a mensagem exacta; registo de
  cancelamento regista/cancela por id; diagnósticos JS offline → DTOs). Todos verdes; suites
  preexistentes inalteradas. **GOTCHA:** `Mode::parse` só trata `project`/`workspace` como
  `Project` (não-tutor); qualquer outro (`codev` incluído) cai em `Study` (STRICT, prepende) —
  o caso «modo livre» testa-se com `"project"`.
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  48→40 e novo `commands/assistant.rs`=8 em `scripts/arch-check.sh`, nas DUAS listas; A3 1:1
  mantido; §2 e IPC-MATRIX §3/§5/§Resumo coerentes — `get_diagnostics` reclassificado da §3
  para a §5, que passa a ter o ficheiro `commands/assistant.rs`).

## 19. Etapa 3 — backend: 9º grupo extraído (`debug`/DAP) (feito)

Nono grupo saído de `lib.rs`: os dez comandos de **depuração real** (DAP, secção 5) — a
detecção honesta de capacidade (`debug_capabilities`, `debug_available`) e o motor gdb/MI
(`debug_launch`, `debug_break`, `debug_run`, `debug_continue`, `debug_step`, `debug_locals`,
`debug_stack`, `debug_stop`). Nenhum é hoje invocado via `invoke` pela `ui-app` (o pane de
debug usa o motor de instrumentação / `features/debug.ts`) — extrair não arrisca a UI. Ainda
assim, por serem contrato público, preservam-se **nome, args, retorno serde e mensagens**
exactamente; o registo de handlers continua a listar os dez sem prefixo (mover ≠ remover).

Ao contrário dos grupos com regra (review/git/agente/assistant), este é um **grupo de
passagens puro**, como as leituras directas do grupo git ou o `search` infalível: o motor
gdb/MI (`debug.rs`, driver sobre o Machine Interface) **já era Tauri-free** — o `driver::*`
recebe `&DebugSessions`, não `tauri::State`, e encapsula todo o parsing de MI. Os
`#[tauri::command]` em `lib.rs` eram wrappers que só desembrulhavam o
`tauri::State<'_, DebugSessions>` para `&DebugSessions`. Não há regra nova para isolar.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/debug.rs`.** O motor fica onde
está (intocado); a fatia ganha apenas o que faltava para ser **uma** fachada Tauri-free que o
adaptador IPC e o crate de teste atravessam sem ver `tutor_eval`:
- `mod debug` passou a `pub mod debug` (o crate de teste só vê `dxtutor_ide_lib`).
- `capabilities()` — passagem única sobre `tutor_eval::dap::detect_debug_adapter()` (que o
  `debug_capabilities` chamava directamente em `lib.rs`), com `DebugCapability` re-exportado.
  Agora todo o grupo — detecção + driver — se alcança por `crate::debug`.

**Adaptadores IPC (backend) — `src-tauri/src/commands/debug_cmds.rs` (+ `commands/mod.rs`).**
Ficheiro novo (o nome `debug.rs` já é do motor — evita colisão). Os dez comandos são
adaptadores finos: desembrulham o `State` e encaminham para `debug::capabilities`/
`debug::available`/`debug::driver::*`; o `String` de erro do driver passa cru (mesmas
mensagens). O registo da sessão (`.manage(DebugSessions::default())`) continua gerido pelo
Tauri em `lib.rs`. `lib.rs` importa os dez por nome (`use commands::debug_cmds::…`), por isso
**A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: testes do caso de uso em
  `debug.rs` (`capabilities_are_honest_and_consistent_with_available`,
  `registry_rejects_unknown_sessions_without_a_debugger` + os preexistentes
  `mi_field_unescapes_and_finds`/`parses_vars_and_frames` e o vivo
  `live_gdb_breakpoint_reads_real_state`) + 3 integrados em `src-tauri/tests/debug_cmds.rs`
  (detecção de capacidade honesta e alcançável; registo rejeita id desconhecido com a mensagem
  `"no such debug session"`; ciclo vivo break→run→locais→backtrace→stop pela API pública,
  `ignored` sem gdb/cc). Todos verdes nesta máquina (gdb+cc presentes). Suites preexistentes
  inalteradas (os `ignored` dos e2e do `tutor-eval` são por design).
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  40→30 e novo `commands/debug_cmds.rs`=10 em `scripts/arch-check.sh`, nas DUAS listas; A3 1:1
  mantido — os nomes dos comandos não mudaram; §2 e IPC-MATRIX §11/Resumo coerentes).

## 20. Etapa 3 — backend: 10º grupo extraído (`devcontainers`) (feito)

Décimo grupo saído de `lib.rs`: os oito comandos de **Dev Containers** — a detecção para a
Remote view (`devcontainer_info`), o one-shot (`devcontainer_up`, `devcontainer_exec`) e o
ciclo da sessão persistente (`devcontainer_session_up`, `devcontainer_session_exec`,
`devcontainer_session_run`, `devcontainer_session_status`, `devcontainer_session_down`).
Nenhum é hoje invocado via `invoke` pela `ui-app` (o pane infra é **simulado no browser** —
as ocorrências de «devcontainer» em `v5.ts` desenham o terminal, sem IPC) — extrair não
arrisca a UI. Ainda assim, por serem contrato público, preservam-se **nome, args, retorno
serde e mensagens** exactamente; o registo de handlers continua a listar os oito sem prefixo
(mover ≠ remover). Mesmo padrão: caso de uso Tauri-free + adaptadores IPC finos.

Ao contrário do grupo `debug` (passagens puras), este **traz regra**: embutidas nos
`#[tauri::command]` viviam a **descoberta** do `devcontainer.json`, o parsing **JSONC**, a
**resolução de imagem** e a montagem do `postCreateCommand` — nenhuma delas é do *mecanismo*
de contentores (`tutor_eval` — `build_image`/`run_in_container`/`session_*`, intocado).

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/devcontainer.rs`.** Reúne:
- `DevcontainerError` — erro **tipado** (`NoConfig` | `InvalidJson` | `NoImageOrBuild` |
  `NoDockerfile` | `NoSession` | `NoRunner` | `Engine`), com `Display` a reproduzir
  EXACTAMENTE as mensagens históricas (`"No devcontainer.json in this folder."`,
  `"devcontainer.json is not valid JSON: …"`, `"… has neither \`image\` nor
  \`build.dockerfile\`."`, `"build has no \`dockerfile\`."`, `"No running session — press
  Reopen in Container first."`, `"No in-container runner for \`…\`."`); a variante `Engine`
  passa o erro do próprio motor **cru**, sem prefixo, como `gitops::GitError::Git`.
- `read_config` — a **descoberta** (`.devcontainer/devcontainer.json` ou top-level) + leitura
  + parsing JSONC, antes partilhada por quatro comandos.
- `resolve_image` (ex-`devcontainer_image`) — a **resolução de imagem** (`image` explícita vs.
  `build.dockerfile`, construindo quando preciso) com os erros tipados.
- `post_create_command` — a regra do `postCreateCommand` (string / array / sonda por omissão).
- `strip_jsonc_comments` — o despojador de comentários JSONC (só este grupo o usava; migrou
  de `lib.rs`).
- Os DTOs (`DevcontainerInfo`, `DevcontainerUp`, `SessionStatus`) nasceram ao lado dos
  comandos em `lib.rs`; vivem agora no caso de uso que os produz.
- As operações (`info`/`up`/`exec`/`session_up`/`session_exec`/`session_run`/
  `session_status`/`session_down`) — `info`/`session_status` são infalíveis (best-effort),
  as restantes falam em `DevcontainerError`.

**Adaptadores IPC (backend) — `src-tauri/src/commands/devcontainer.rs` (+ `commands/mod.rs`).**
Os oito comandos correm o caso de uso num worker bloqueante (tocar no motor de contentores é
I/O de processo — nunca na thread da janela) e mapeiam o erro → `String` só na fronteira: o
`join` da tarefa veste o prefixo histórico `"devcontainer task failed: …"`, o erro do caso
de uso passa pelo seu `Display`. `lib.rs` importa os oito por nome
(`use commands::devcontainer::…`), por isso **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 8 testes unitários do
  caso de uso em `devcontainer.rs` (`errors_wear_the_historical_messages`,
  `read_config_discovers_strips_jsonc_and_reports_typed_errors`,
  `resolve_image_prefers_explicit_image_and_never_builds`,
  `resolve_image_typed_errors_when_neither_image_nor_dockerfile`,
  `post_create_command_handles_string_array_and_default`,
  `session_exec_without_a_running_session_is_a_typed_error`,
  `info_reads_name_and_image_from_a_real_config`,
  `info_falls_back_to_a_dockerfile_reference_for_display`) + 5 integrados offline em
  `src-tauri/tests/devcontainer_group.rs` (config JSONC real; `up` sem config / sem
  image-ou-build / JSON partido → erro tipado antes do motor; sessão sem container → erro
  tipado + estado honesto) + 1 teste vivo `#[ignore]` (ciclo `session_up`→`exec`→`down`,
  exige docker/podman com daemon). Todos verdes. Suites preexistentes inalteradas (os
  `ignored` dos e2e do `tutor-eval` são por design).
- `npm run arch:check` **exit 0** (A1 133; **A2 actualizada deliberadamente**: `lib.rs`
  30→22 e novo `commands/devcontainer.rs`=8 em `scripts/arch-check.sh`, nas DUAS listas; A3
  1:1 mantido — os nomes dos comandos não mudaram; §2 e IPC-MATRIX §12/Resumo coerentes).

## 21. Etapa 3 — backend: 11º grupo extraído (`sandbox`/run) (feito)

Décimo-primeiro grupo saído de `lib.rs`: os três comandos de **sandbox / run** — a lista de
serviços da stack Compose (`compose_ps`, F8/Services) e a selecção do motor de sandbox em
runtime (`get_sandbox_engine`, `set_sandbox_engine`). Nenhum é hoje invocado via `invoke`
pela `ui-app`; ainda assim, por serem contrato público, preservam-se **nome, args, retorno
serde e mensagens** exactamente; o registo de handlers continua a listar os três sem prefixo
(mover ≠ remover). Mesmo padrão: caso de uso Tauri-free + adaptadores IPC finos.

Como os grupos `devcontainer`/`search`, este **traz regra** (não é passagem pura): embutidos
nos `#[tauri::command]` viviam o **shaping** da saída do `docker compose ps` e a **validação**
do nome de motor. A *precedência* do motor efectivo (runtime → ambiente → host) **não** é
regra deste grupo — já vive em `tutor_eval` (um átomo global, não um `tauri::State`); o
arranque em `run()` continua a chamar `tutor_eval::set_engine` directamente.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/sandbox.rs`.** Reúne:
- `ComposeService` — o DTO (serde `camelCase`) que a vista Services consome; nasceu ao lado
  do comando em `lib.rs`, vive agora no caso de uso que o produz.
- `parse_compose_ps` — o parser **PURO** da saída do `docker compose ps --format json`
  (NDJSON ou array JSON único), tolerante a campos em falta (`serde_json::Value`) e às portas
  publicadas (published->target). Testável sem processo.
- `compose_ps` — corre o `docker compose ps` e devolve `Vec<ComposeService>` ou o erro
  tipado. (Faz I/O de processo — o adaptador corre-a num worker bloqueante.)
- `current_engine_name` / `set_engine` — passagens sobre `tutor_eval` (precedência +
  `parse_engine`/`set_engine`/`engine_name`); `set_engine` veste o erro tipado quando o nome
  é desconhecido.
- `SandboxError` — erro **tipado** (`Docker` | `Compose` | `UnknownEngine`), com `Display` a
  reproduzir EXACTAMENTE as mensagens históricas (`"could not run docker: …"`, o stderr do
  compose cru ou `"docker compose ps failed"`, `"unknown engine \`…\` (use
  host|delonix|docker|podman)"`).

**Adaptadores IPC (backend) — `src-tauri/src/commands/sandbox.rs` (+ `commands/mod.rs`).**
`compose_ps` corre o caso de uso num worker bloqueante (correr `docker` é I/O de processo —
nunca na thread da janela) e mapeia o erro → `String` só na fronteira: o `join` da tarefa
pelo seu `to_string` (sem prefixo, como `lib.rs` fazia), o erro do caso de uso pelo seu
`Display`. `get_sandbox_engine`/`set_sandbox_engine` são **síncronos** (leitura/escrita dum
átomo global, sem I/O de processo). `lib.rs` importa os três por nome
(`use commands::sandbox::…`), por isso **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: 4 testes unitários do
  caso de uso em `sandbox.rs` (`parse_compose_ps_ndjson_extracts_fields_and_ports`,
  `parse_compose_ps_handles_array_form_and_empty`,
  `set_engine_roundtrips_known_and_types_unknown`, `errors_wear_the_historical_messages`) +
  3 integrados offline em `src-tauri/tests/sandbox_group.rs` (parser NDJSON/array/vazio +
  roundtrip de motor com erro tipado) + 1 teste vivo `#[ignore]` (`compose_ps` honesto
  contra um docker real). Todos verdes. Suites preexistentes inalteradas (os dois testes de
  `parse_compose_ps` saíram de `lib.rs` para o caso de uso).
- `bash scripts/arch-check.sh` **exit 0** (A1 133; **A2 actualizada deliberadamente**:
  `lib.rs` 22→19 e novo `commands/sandbox.rs`=3 em `scripts/arch-check.sh`, nas DUAS listas;
  A3 1:1 mantido — os nomes dos comandos não mudaram; §2 e IPC-MATRIX §13 coerentes).

## 22. Etapa 3 — backend: 12º grupo extraído (`PairCode`) (feito)

Décimo-segundo grupo saído de `lib.rs`: os quatro comandos de **PairCode** — iniciar
sessão como anfitrião (`pair_host`), juntar-se a uma (`pair_join`), enviar uma mensagem ao
par (`pair_send`) e terminar (`pair_stop`). Os quatro **são invocados** pela `ui-app`
(`ui-app/src/pair.ts`: ciclo host/join → send → stop do pane de colaboração), por isso a
extracção preserva **nome, args, retorno serde, eventos e mensagens** exactamente — o
registo de handlers continua a listar os quatro sem prefixo (mover ≠ remover). Mesmo
padrão: caso de uso Tauri-free + adaptadores IPC finos.

Como o grupo `debug`/DAP, este é um **grupo de passagens puro** (sem regra nova para
isolar): o mecanismo par-a-par (`crate::pair` — anfitrião TCP, handshake selado
ChaCha20-Poly1305 que tem de abrir em dez segundos, uma sessão WebSocket de cada vez, token
`dxp_…` com as moradas + chave de 256 bits) **já era Tauri-free** — `Pair`,
`Pair::{host,join,send,stop}` e o canal de reporte `pair::Events` não tocam em tipos Tauri;
os contratos do token (`Token`, `encode_token`/`decode_token`) e as moradas alcançáveis
(`local_addrs`) também. Os `#[tauri::command]` em `lib.rs` eram wrappers que desembrulhavam
o `tauri::State<'_, pair::Pair>` e **vestiam a emissão** dos eventos sobre a `AppHandle`.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/pair.rs`.** O mecanismo fica
onde está (intocado); a fatia ganha apenas o que faltava para ser alcançável como **uma**
fachada Tauri-free que o adaptador IPC e o crate de teste atravessam sem ver `tutor_eval`:

- `mod pair` passou a `pub mod pair` (o crate de teste só vê `dxtutor_ide_lib`). Tudo o que
  a fatia precisa de expor (`Pair`, `Events`, `Token`, `encode_token`/`decode_token`,
  `DEFAULT_PORT`, `local_addrs`) já era `pub`.

**Adaptadores IPC (backend) — `src-tauri/src/commands/pair.rs` (+ `commands/mod.rs`).** Os
quatro comandos são adaptadores finos: desembrulham o `State<pair::Pair>` para o `Pair`
gerido e encaminham; o `pair_events(app)` — o helper que liga os callbacks do caso de uso
aos eventos Tauri `pair-status`/`pair-msg` sobre a `AppHandle` — **migrou de `lib.rs` para
o adaptador** (é infra de fronteira, como a emissão dos `llm://*` em `commands::assistant`).
`pair_stop` mantém a emissão do `pair-status {state: idle}` após `stop()`. O `String` de
erro de `pair::Pair` passa cru (mesmas mensagens). O registo do estado
(`.manage(pair::Pair::default())`) e o setup `enable_media` da câmara/microfone WebKitGTK
continuam em `lib.rs`. `lib.rs` importa os quatro por nome (`use commands::pair::…`), por
isso **A1 fica em 133** (mover ≠ remover).

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: os testes unitários
  do mecanismo em `pair.rs` (`token_round_trip_and_damage`,
  `sealed_frames_open_only_with_the_key`,
  `host_and_guest_exchange_messages_and_wrong_keys_are_refused`) + 3 integrados em
  `src-tauri/tests/pair_session.rs` que atravessam a fronteira do crate via
  `dxtutor_ide_lib::pair` (`token_round_trips_through_the_public_facade`;
  `send_without_a_peer_is_an_error` → `"no one is connected"`;
  `host_and_guest_exchange_over_loopback_through_the_facade` — anfitrião+par reais sobre
  loopback TCP, troca mensagem nos dois sentidos, token de outra chave recusado no
  handshake, `disconnected` após `stop`), todos verdes. Suites preexistentes inalteradas (os
  `ignored` dos e2e do `tutor-eval` são por design). O WebRTC do webview não é coberto
  headless — valida-se na máquina do utilizador; o que é testável (o canal TCP+ChaCha) prova-se.
- `bash scripts/arch-check.sh` **exit 0** (A1 133; **A2 actualizada deliberadamente**:
  `lib.rs` 19→15 e novo `commands/pair.rs`=4 em `scripts/arch-check.sh`, nas DUAS listas;
  A3 1:1 mantido — os nomes dos comandos não mudaram; §2 e IPC-MATRIX §1/Resumo coerentes).

## 23. Etapa 3 — backend: 13º e ÚLTIMO grupo extraído (`estudo`/`missões`) (feito)

Décimo-terceiro grupo saído de `lib.rs` — o **núcleo do «cérebro» dxtutor** (currículo +
avaliação) — e o **último** da Etapa 3: com ele `lib.rs` deixa de registar qualquer
`#[tauri::command]` próprio e fica só com composição/registo (`enable_media`/`run`/`setup`) +
os DTOs serializáveis partilhados. São **15 comandos**, repartidos por **dois** ficheiros de
adaptadores conforme o acoplamento real:

- **estudo (11)** → `commands/study.rs`: `list_phases`, `submit`, `submit_step`,
  `request_hint`, `request_plan`, `request_fix`, `get_course`, `list_courses`, `study_policy`,
  `get_glossary`, `get_study_guide`;
- **missões/execução (4)** → `commands/missions.rs`: `run_drill`, `run_measured`,
  `compile_pipeline`, `trace_execution`.

Nenhum é hoje invocado pela `ui-app` (origem do protótipo de estudo / consumido por
`ui-next`), mas são contrato público — a extracção preserva **nome, args, retorno serde e
mensagens de erro** exactamente; o registo de handlers lista os 15 sem prefixo (mover ≠
remover), por isso **A1 fica em 133**.

**Caso de uso Rust (independente de Tauri) — `src-tauri/src/study.rs`.** Reúne as *regras* de
estudo que não pertencem a nenhum mecanismo externo, com **erro de contrato tipado**
[`study::StudyError`] (`ProjectNotFound`/`PhaseNotFound`/`StepNotFound`/`NotAChallenge`/
`NoCourse`/`NoGlossary`/`NoStudyGuide`/`Eval`), cujo `Display` reproduz EXACTAMENTE as
mensagens que `lib.rs` emitia:

- **classificação pedagógica** de um passo guiado (`course_step`, `step_language`,
  `step_is_autonomous`) e a **política de estudo** que daí decorre (`study_policy`); estas
  servem também o grupo `assistant` (`crate::study::step_language`/`step_is_autonomous` —
  `commands/assistant.rs` passou a referi-las por este caminho);
- **carregamento** de conteúdo (`load_project`/`load_phase`/`course`/`courses`/`glossary`/
  `study_guide`) com o erro tipado — o `PROJECT_ID` migrou para aqui;
- **avaliação honesta** (`grade_phase`, `grade_step`): localizam o alvo, constroem o `Phase` e
  reusam `tutor_eval::assess` (a fonte de verdade), devolvendo `(Assessment, Phase)` ao
  adaptador (o gabarito viaja com a fase, revelado só em sucesso);
- a **regra offline curada** da sugestão (`curated_hint`) e o contexto do passo
  (`hint_context`); os **provedores LLM** de `request_hint`/`plan`/`fix` ficam no adaptador
  (infra de fronteira: constrói o pedido `tutor_llm` e chama `default_*_provider`).

**Caso de uso Rust — `src-tauri/src/missions.rs`.** As quatro execuções são **passagens**
sobre `tutor_eval` (já Tauri-free: runner, medição `wait4`/`rusage`, pipeline do toolchain,
tracer), por isso não re-alojam regra. A única que não estava isolada era o **despacho de
linguagem** do drill — extraído como `missions::drill_language` (→ `DrillLang::{Go,Rust}`),
função PURA e testável sem toolchain.

**Adaptadores IPC (backend) — `commands/study.rs` + `commands/missions.rs` (+ `commands/mod.rs`).**
Adaptadores finos: `spawn_blocking` onde o trabalho compila/corre código (`submit`,
`submit_step` e as quatro missões — nunca na thread da janela), mapeamento do erro → `String`
só na fronteira (o `Display` de `StudyError` / as mensagens `"run failed: …"` etc.), e a
montagem dos DTOs. Os **DTOs serializáveis** (`ProjectDto`/`AssessmentDto`/`CourseDto`/
`CourseSummaryDto`/`GlossaryDto`/`StudyGuideDto`/`HintDto`/`PlanDto`/`RunDto`/`MeasuredRunDto`/
`PipelineDto`/`ExecutionTraceDto`) + os seus mappers continuam em `lib.rs` como `pub(crate)` —
são a fronteira de serialização para o webview, partilhada entre grupos.

**Provas.**
- `cargo test --workspace` (= `npm test`) **exit 0**, sem regressões: os testes unitários em
  `study.rs`/`missions.rs` (projecto carrega; erros de contrato tipados; classificação +
  política; despacho Go-vs-Rust) + 5 integrados em `src-tauri/tests/study_group.rs` que
  atravessam a fronteira do crate via `dxtutor_ide_lib::{study,missions}` (fachadas
  alcançáveis; `grade_step`/`grade_phase` de alvo inexistente falham ANTES de compilar, com as
  mensagens históricas; `StudyPolicy` serializa). Os caminhos pesados de `tutor_eval::assess` e
  dos runners validam-se na máquina do utilizador / nos e2e `#[ignore]` do `tutor-eval`.
  Suites preexistentes inalteradas.
- `bash scripts/arch-check.sh` **exit 0** (A1 133; **A2 actualizada deliberadamente**:
  `lib.rs` 15→0 e novos `commands/study.rs`=11 + `commands/missions.rs`=4 em
  `scripts/arch-check.sh`, nas DUAS listas; corrigido também o `grep -c || echo 0` que
  duplicava em "0\n0" agora que `lib.rs` tem 0 comandos; A3 1:1 mantido — os nomes não mudaram;
  §2 e IPC-MATRIX §3 coerentes). **GOTCHA A2:** o literal `#[tauri::command]` não pode aparecer
  em comentário de `commands/*.rs` (o `grep -c` conta-o) — reescrito o comentário de
  `missions.rs` sem o token.
