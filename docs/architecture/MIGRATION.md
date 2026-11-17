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

Registados em `src-tauri/src/lib.rs:2483` (`tauri::generate_handler!`).

| Módulo de origem | N.º | Comandos |
|---|---|---|
| `lib.rs` | 95 | PairCode (`pair_host/join/send/stop`), estudo/missões (`list_phases`, `submit`, `submit_step`, `request_hint/plan/fix`, `get_course`, `list_courses`, `run_drill`, `run_measured`, `compile_pipeline`, `trace_execution`, `get_glossary`, `get_study_guide`, `study_policy`, `codev_policy`), review (`review_code`, `list_review_analyzers`, `verify_review_fix`), code intel (`symbol_relations`, `list_symbols`, `symbol_ranges`, `file_outline`, `diff_lines`, `propose_entrypoint`, `project_entrypoint`, `resolve_definition/references/hover`), testes (`list_tests`, `run_test`, `run_all_tests`, `run_tests`, `run_path`), pesquisa (`search_project`, `list_files`, `read_folder_sources`, `detect_projects`), git (`git_changes/diff/clone/stage/unstage/stage_all/commit/branches/checkout/create_branch/log/show/branch`), agente (`agent_isolated_patch`, `agent_task_submit/status/cancel`), arch (`arch_validate`, `arch_scaffold`, `arch_scaffold_preview`), co-dev (`codev_session_start/deliver/discard/list`), assistant (`assistant_models/chat/chat_stream/cancel`), providers/keys (`list_providers`, `get_providers_config`, `save_providers_config`, `get_diagnostics`), debug (`debug_capabilities/available/launch/break/run/continue/step/locals/stack/stop`), devcontainers (`devcontainer_info/up/exec/session_up/exec/run/status/down`), sandbox (`get_sandbox_engine`, `set_sandbox_engine`, `compose_ps`) |
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
| 2 — Primeira fatia | 1 feature atravessa UI→adaptador→caso de uso→impl (ex. abrir workspace / board) | Testes do caso de uso + teste integrado | pendente |
| 3 — Backend | Extrair responsabilidades de `lib.rs`; portas e erros tipados; composição | APIs/dados/CLI/TUI preservados | pendente |
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
