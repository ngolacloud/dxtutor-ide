# DXTUTOR IDE — matriz IPC detalhada (133 comandos)

Entregável da **Etapa 1**. Estende o índice do `MIGRATION.md §2` com a matriz
por comando: **args**, **retorno**, **erro**, **evento**, **consumidor na UI** e
**política**. Fonte autoritativa da lista: `src-tauri/src/lib.rs:2483`
(`tauri::generate_handler!`). Fonte das assinaturas: `#[tauri::command]` em
`lib.rs`, `bridge.rs`, `fsops.rs`, `lsp.rs`, `pty.rs`, `board.rs` (extracção
estática sobre o HEAD da Etapa 0, commit de referência).

> Documento de **referência**, não um contrato executável. As verificações
> automáticas (`scripts/arch-check.sh`) garantem que a *contagem* e a *lista*
> registada aqui não divergem do `generate_handler!`.

## Convenções

**Erro** — `String` = o comando devolve `Result<_, String>` (erro propagado à
UI como `string`); `—` = infalível (assinatura sem `Result`; não pode falhar
pelo contrato, embora possa entrar em `panic`).

**Args** — omitem-se os parâmetros de infra-estrutura injectados pelo Tauri
(`app: AppHandle`, `state/sessions: State<'_, …>`); a sua presença é assinalada
pela política **S** (usa estado/sessão viva). Os nomes dos args são os do Rust;
na UI chegam em *camelCase* (ex. `timeout_ms` → `timeoutMs`).

**Evento** — nome do evento Tauri emitido pelo comando (streaming/assíncrono);
`—` = resposta só por valor de retorno.

**Consumidor na UI** — ficheiro(s) de `ui-app/src` que invocam o comando.
`—` = **registado mas não consumido pela `ui-app`** (a UI oficial simula a
funcionalidade no browser, ou usa outro caminho — ver nota — ou o comando só é
consumido pela experiência `ui-next`, que está fora do grafo de build activo).

**Política** (tags acumuláveis):

| tag | significado |
|---|---|
| **R** | leitura pura — sem efeitos mutantes (pode ler FS/git/rede-local) |
| **W** | escreve no sistema de ficheiros (cria/muta/apaga) |
| **X** | **executa processo/shell** — execução de código arbitrário do hóspede |
| **G** | muta repositório git |
| **N** | rede externa / LLM — usa chaves de provedores |
| **K** | segredos — lê/grava chaves de API |
| **S** | usa estado/sessão viva da app (`State`/`AppHandle`) |
| **E** | emite eventos Tauri |

### Nota de arquitectura (fronteira IPC na UI)

Na `ui-app`, **toda** a invocação do backend passa por um único ponto:
`ui-app/src/bridge.ts` (`inv(c,a) = __TAURI__.core.invoke(c,a)`), mais
`pair.ts` (PairCode) e um par de usos em `features/codev.ts`. Não há wrapper
tipado por comando — é o alvo da **Etapa 4** (`platform/tauri/` + `contracts/`).

Dos 133 comandos, **28 são consumidos pela `ui-app`** e **105 não o são**: a UI
oficial é maioritariamente uma simulação de browser que `bridge.ts` substitui em
runtime (E06) apenas para o subconjunto ligado. Caso notável: as operações de
**git mutantes** (`git_stage/commit/checkout/…`) aparecem como *não-consumidas*
porque o painel SCM corre git real pela via genérica `exec("git", …)`, não pelos
comandos dedicados `git_*` (só `git_changes/log/show` são consumidos). Isto é
baseline para a Etapa 2 (primeira fatia vertical) e Etapa 3 (backend).

### Aprovação de ferramentas (E14)

A decisão de aprovar execuções do agente/Co-Dev vive **no frontend**:
`bridge.ts` (`askApproval(cmd)`, `R.approve`) e a matriz de política por modo
(Manual/Assistido/Auto) em `features/codev.ts` (`POLICY`). Mover esta decisão
para o backend é trabalho da **Etapa 5**. Os comandos `study_policy`/
`codev_policy` já devolvem o contrato de política a partir do backend, mas não
são hoje consumidos pela `ui-app`.

---

## 1. PairCode — `lib.rs` (4)

Exclusivo do dxtutor-ide. Sessão de colaboração; emite estado/mensagens.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `pair_host` | `name: String`, `port: Option<u16>` | `String` (token) | String | `pair-status` | `pair.ts` | S · E |
| `pair_join` | `token: String`, `via: Option<String>` | `String` | String | `pair-status`, `pair-msg` | `pair.ts` | S · N · E |
| `pair_send` | `msg: String` | `()` | String | `pair-msg` | `pair.ts` | S · E |
| `pair_stop` | — | `()` | — | `pair-status` | `pair.ts` | S · E |

## 2. v7 desktop bridge — `bridge.rs` + `fsops::pick_folder` (14)

Comandos genéricos da casca desktop; a espinha dorsal consumida pela `ui-app`.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `pick_folder` | — | `Option<String>` | — | — | `bridge.ts` | S (diálogo) |
| `load_workspace` | `root: String` | `workspace::Loaded` | String | — | `bridge.ts` | R |
| `write_file` | `root: String`, `rel: String`, `content: String` | `()` | String | — | `bridge.ts`, `features/codev.ts`, `pair.ts` | W |
| `delete_file` | `root: String`, `rel: String` | `()` | String | — | `bridge.ts` | W |
| `expand_path` | `path: String` | `String` | — | — | `bridge.ts` | R |
| `exec` | `program: String`, `args: Vec<String>`, `cwd: Option<String>`, `env: Option<HashMap<String,String>>`, `stdin: Option<String>`, `timeout_ms: Option<u64>` | `procs::ExecOut` | String | — | `bridge.ts`, `pair.ts` | **X** |
| `run_shell` | `id: String`, `line: String`, `cwd: Option<String>`, `env: Option<HashMap<String,String>>` | `()` | String | `proc-line`, `proc-exit` | `bridge.ts` | **X** · S · E |
| `kill_shell` | `id: String` | `bool` | — | — | `bridge.ts` | X · S |
| `keys_status` | — | `HashMap<String,bool>` | String | — | — | K · S |
| `save_key` | `provider: String`, `key: String` | `()` | String | — | — | **K** · S |
| `llm_chat` | `req: llm::ChatReq`, `mode: Option<String>` | `llm::ChatResp` | String | — | `bridge.ts` | **N** · K · S |
| `llm_plan` | `req: llm::ChatReq`, `mode: Option<String>` | `serde_json::Value` | — | — | — | N · K |
| `vsix_manifest` | `b64: String` | `serde_json::Value` | String | — | — | R |
| `app_info` | — | `serde_json::Value` | — | — | `bridge.ts` | R · S |
| `selftest_report` | `report: serde_json::Value` | `()` | — | — | `bridge.ts`, `pair.ts` | W · S |

## 3. Estudo / missões — `lib.rs` (17)

Núcleo do «cérebro» dxtutor (currículo/avaliação). **Nenhum consumido pela
`ui-app`** hoje (origem do protótipo de estudo / consumido por `ui-next`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `list_phases` | — | `ProjectDto` | String | — | — | R |
| `submit` | `phase_id: String`, `code: String` | `AssessmentDto` | String | — | — | R |
| `submit_step` | `step_id: String`, `code: String` | `AssessmentDto` | String | — | — | R |
| `get_diagnostics` | `step_id: String`, `code: String` | `Vec<DiagnosticDto>` | String | — | — | R |
| `request_hint` | `phase_id: String`, `code: String`, `level: u8` | `HintDto` | String | — | — | R |
| `request_plan` | `phase_id: String`, `comment: String`, `code: String` | `PlanDto` | String | — | — | R |
| `request_fix` | `phase_id: String`, `code: String`, `line: u32`, `message: String` | `String` | String | — | — | R |
| `get_course` | `language: String` | `CourseDto` | String | — | — | R |
| `list_courses` | — | `Vec<CourseSummaryDto>` | — | — | — | R |
| `get_glossary` | `language: String` | `GlossaryDto` | String | — | — | R |
| `get_study_guide` | `language: String`, `unit_id: String` | `StudyGuideDto` | String | — | — | R |
| `run_drill` | `code: String`, `language: String`, `dependencies: Vec<String>` | `RunDto` | String | — | — | **X** |
| `run_measured` | `code: String` | `MeasuredRunDto` | String | — | — | **X** |
| `compile_pipeline` | `code: String` | `PipelineDto` | String | — | — | **X** |
| `trace_execution` | `language: String`, `code: String` | `ExecutionTraceDto` | String | — | — | **X** |
| `study_policy` | `mode: String`, `step_id: Option<String>` | `StudyPolicy` | — | — | — | R |
| `codev_policy` | `mode: String` | `CoDevPolicy` | — | — | — | R |

## 4. Review de código — `lib.rs` (3)

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `review_code` | `root: String`, `scope: String`, `path: Option<String>`, `version: Option<String>` | `review::ReviewReport` | String | — | — | R |
| `list_review_analyzers` | — | `Vec<review::AnalyzerInfo>` | — | — | — | R |
| `verify_review_fix` | `current_source: String`, `analyzed_version: String`, `fix: review::SuggestedFix` | `review::FixVerification` | — | — | — | R |

## 5. Assistant / provedores — `lib.rs` (7)

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `assistant_models` | — | `Vec<String>` | — | — | — | R |
| `assistant_chat` | `messages: Vec<chat::ChatMsg>`, `model: Option<String>` | `chat::ChatReply` | String | — | — | **N** · K |
| `assistant_chat_stream` | `messages: Vec<chat::ChatMsg>`, `provider: Option<String>`, `model: Option<String>`, `request_id: String`, `mode: Option<String>`, `step_id: Option<String>` | `()` (via eventos) | — | `llm://token` `{requestId,delta}`, `llm://done` `{requestId,model}`, `llm://error` `{requestId,error}` | `bridge.ts` | **N** · K · S · E |
| `assistant_cancel` | `request_id: String` | `()` | — | — | `bridge.ts` | S |
| `list_providers` | — | `Vec<chat::ProviderInfo>` | — | — | `bridge.ts` | R |
| `get_providers_config` | — | `chat::ProvidersConfig` | — | — | `bridge.ts` | K (lê config) |
| `save_providers_config` | `config: chat::ProvidersConfig` | `()` | String | — | `bridge.ts` | **K** · W |

## 6. Inteligência de código — `lib.rs` (10)

Análise estática + resolução (definições/referências/hover). Não consumidos
pela `ui-app` (editor usa simulação/`ui-next`); baseline para a Etapa 2.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `symbol_relations` | `root: String`, `symbol: String` | `codemap::Relations` | String | — | — | R |
| `list_symbols` | `root: String`, `max: Option<usize>` | `Vec<codemap::SymbolRef>` | String | — | — | R |
| `symbol_ranges` | `code: String`, `name: String` | `Vec<codemap::SymbolRange>` | String | — | — | R |
| `file_outline` | `code: String`, `lang: String`, `root: Option<String>`, `file: Option<String>` | `Vec<codemap::SymbolRange>` | String | — | — | R |
| `diff_lines` | `old: String`, `new: String` | `Vec<textdiff::DiffLine>` | String | — | — | R |
| `propose_entrypoint` | `lang: String`, `code: String` | `Option<entrypoint::EntrypointProposal>` | String | — | — | R |
| `project_entrypoint` | `root: String` | `Option<String>` | — | — | — | R |
| `resolve_definition` | `root: String`, `file: String`, `line: u32`, `col: u32`, `text: Option<String>` | `Option<ResolvedDef>` | String | — | — | R |
| `resolve_references` | `root: String`, `file: String`, `line: u32`, `col: u32`, `text: Option<String>` | `Vec<ResolvedDef>` | String | — | — | R |
| `resolve_hover` | `root: String`, `file: String`, `line: u32`, `col: u32`, `text: Option<String>` | `Option<String>` | String | — | — | R |

## 7. Testes — `lib.rs` (4)

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `list_tests` | `root: String` | `Vec<testnav::TestItem>` | String | — | — | R |
| `run_test` | `root: String`, `path: String`, `lang: Option<String>` | `testnav::TestRun` | String | — | — | **X** |
| `run_all_tests` | `root: String` | `testnav::TestRun` | String | — | — | **X** |
| `run_tests` | `root: String` | `TestRun` | String | — | `bridge.ts`, `features/codev.ts` | **X** |

> `run_tests` (o único consumido) coexiste com `run_test`/`run_all_tests`
> (dedicados, não consumidos) — sobreposição a resolver na Etapa 3.

## 8. Git — `lib.rs` (13)

Só `git_changes/git_log/git_show` são consumidos; os mutantes correm por
`exec("git", …)` no `bridge.ts` (ver nota de arquitectura).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `git_changes` | `root: String` | `Vec<git::GitChange>` | String | — | `bridge.ts` | R |
| `git_diff` | `root: String`, `file: Option<String>`, `staged: Option<bool>` | `String` | String | — | — | R |
| `git_log` | `root: String`, `max: Option<usize>` | `Vec<git::GitCommit>` | String | — | `bridge.ts` | R |
| `git_show` | `root: String`, `hash: String` | `String` | String | — | `bridge.ts` | R |
| `git_branch` | `root: String` | `Option<String>` | String | — | — | R |
| `git_branches` | `root: String` | `Vec<String>` | String | — | — | R |
| `git_clone` | `url: String`, `parent_dir: String` | `String` | String | — | — | **N** · W |
| `git_stage` | `root: String`, `path: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_unstage` | `root: String`, `path: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_stage_all` | `root: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_commit` | `root: String`, `message: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_checkout` | `root: String`, `branch: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_create_branch` | `root: String`, `name: String` | `()` | String | — | — (via `exec`) | **G** |

## 9. Agente / arquitectura — `lib.rs` (7)

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `agent_isolated_patch` | `root: String`, `writes: Vec<(String,String)>` | `String` | String | — | — | **W** |
| `agent_task_submit` | `root: String`, `writes: Vec<(String,String)>` | `String` (id) | String | — | `bridge.ts` | **W** · S |
| `agent_task_status` | `id: String` | `Option<AgentTask>` | — | — | `bridge.ts` | R · S |
| `agent_task_cancel` | `id: String` | `bool` | — | — | `bridge.ts` | S |
| `arch_validate` | `arch: arch::Architecture` | `Vec<arch::Finding>` | String | — | — | R |
| `arch_scaffold` | `root: String`, `arch: arch::Architecture` | `Vec<String>` | String | — | — | **W** |
| `arch_scaffold_preview` | `arch: arch::Architecture` | `Vec<(String,String)>` | — | — | — | R |

## 10. Co-Dev (sessões git) — `lib.rs` (4)

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `codev_session_start` | `root: String`, `name: String` | `git::SessionInfo` | String | — | — | **G** |
| `codev_session_deliver` | `root: String`, `slug: String`, `message: String` | `git::DeliverInfo` | String | — | — | **G** |
| `codev_session_discard` | `root: String`, `slug: String` | `()` | String | — | — | **G** |
| `codev_session_list` | `root: String` | `Vec<git::SessionInfo>` | String | — | — | R |

## 11. Debug (DAP) — `lib.rs` (10)

Motor de depuração; todos usam `State<DebugSessions>`. Não consumidos pela
`ui-app` (painel Debug é simulado — ver `features/debug.ts`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `debug_capabilities` | — | `dap::DebugCapability` | — | — | — | R |
| `debug_available` | — | `bool` | — | — | — | R |
| `debug_launch` | `id: String`, `program: String`, `cwd: Option<String>` | `()` | String | — | — | **X** · S |
| `debug_break` | `id: String`, `file: String`, `line: u32` | `u32` | String | — | — | S |
| `debug_run` | `id: String` | `debug::Stop` | String | — | — | X · S |
| `debug_continue` | `id: String` | `debug::Stop` | String | — | — | X · S |
| `debug_step` | `id: String`, `into: bool` | `debug::Stop` | String | — | — | X · S |
| `debug_locals` | `id: String` | `Vec<debug::Var>` | String | — | — | R · S |
| `debug_stack` | `id: String` | `Vec<debug::Frame>` | String | — | — | R · S |
| `debug_stop` | `id: String` | `()` | String | — | — | S |

## 12. Devcontainers — `lib.rs` (8)

Todos lançam processos de container (docker/podman). Não consumidos pela `ui-app`.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `devcontainer_info` | `root: String` | `DevcontainerInfo` | String | — | — | R |
| `devcontainer_up` | `root: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_exec` | `root: String`, `cmd: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_session_up` | `root: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_session_exec` | `root: String`, `cmd: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_session_run` | `root: String`, `file: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_session_status` | `root: String` | `SessionStatus` | String | — | — | R |
| `devcontainer_session_down` | `root: String` | `()` | String | — | — | **X** |

## 13. Projecto / sandbox / run — `lib.rs` (8)

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `search_project` | `root: String`, `query: String`, `max: Option<usize>`, `ignore_case: Option<bool>` | `Vec<search::SearchHit>` | String | — | — | R |
| `list_files` | `root: String`, `max: Option<usize>` | `Vec<String>` | String | — | `bridge.ts`, `features/codev.ts` | R |
| `read_folder_sources` | `dir: String`, `max_files: Option<usize>`, `max_bytes: Option<usize>` | `Vec<FolderSource>` | String | — | — | R |
| `detect_projects` | `root: String` | `Vec<ProjectInfo>` | String | — | — | R |
| `run_path` | `path: String`, `args: Option<String>` | `RunDto` | String | — | — | **X** |
| `compose_ps` | `root: String` | `Vec<ComposeService>` | String | — | — | **X** |
| `get_sandbox_engine` | — | `String` | — | — | — | R |
| `set_sandbox_engine` | `engine: String` | `String` | String | — | — | W (config) |

## 14. Sistema de ficheiros — `fsops.rs` (9)

`pick_folder` está na secção 2 (registado no bloco bridge). Nenhum dos restantes
é consumido pela `ui-app` (acesso a disco passa por `write_file`/`load_workspace`
do `bridge.rs`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `list_dir` | `path: String` | `Vec<EntryDto>` | String | — | — | R |
| `read_text_file` | `path: String` | `String` | String | — | — | R |
| `write_text_file` | `path: String`, `contents: String` | `()` | String | — | — | **W** |
| `create_path` | `path: String`, `is_dir: bool` | `()` | String | — | — | **W** |
| `delete_path` | `path: String` | `()` | String | — | — | **W** |
| `rename_path` | `from: String`, `to: String` | `()` | String | — | — | **W** |
| `workspace_tree` | `root: String`, `max_depth: u32`, `max_entries: u32` | `String` | String | — | — | R |
| `workspace_resolve` | `root: String`, `path: String` | `String` | String | — | — | R |
| `workspace_action` | `root: String`, `op: String`, `path: String`, `content: Option<String>` | `String` | String | — | — | **W** |

## 15. LSP — `lsp.rs` (8)

Todos usam `State<LspState>` + `AppHandle`. Não consumidos pela `ui-app`
(editor usa Monaco local/simulação); alvo de ligação real na Etapa 2.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `lsp_start` | `root: String` | `()` | String | — | — | **X** · S |
| `lsp_did_open` | `path: String`, `text: String`, `language_id: String` | `()` | String | — | — | S |
| `lsp_did_change` | `path: String`, `text: String`, `version: i64` | `()` | String | — | — | S |
| `lsp_definition` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | — | R · S |
| `lsp_references` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | — | R · S |
| `lsp_hover` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | — | R · S |
| `lsp_rename` | `path: String`, `line: u32`, `character: u32`, `new_name: String` | `Value` | String | — | — | R · S |
| `lsp_prepare_rename` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | — | R · S |

## 16. PTY — `pty.rs` (4)

Terminal real; `State<PtyState>` + `AppHandle`. Não consumidos pela `ui-app`
(terminal usa `run_shell`/`exec` + xterm); alvo da Etapa 2.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `pty_spawn` | `rows: u16`, `cols: u16` | `()` | String | `pty://data`, `pty://exit` | — | **X** · S · E |
| `pty_spawn_in_session` | `rows: u16`, `cols: u16`, `root: String` | `()` | String | `pty://data`, `pty://exit` | — | **X** · S · E |
| `pty_write` | `data: String` | `()` | String | — | — | X · S |
| `pty_resize` | `rows: u16`, `cols: u16` | `()` | String | — | — | S |

## 17. Board (SQLite) — `board.rs` (2)

Backlog persistido em SQLite (`tutor-board`). Não consumidos pela `ui-app`
(board simulado em `features/board.ts`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `board_load` | `root: Option<String>` | `Option<Backlog>` | String | — | — | R · S |
| `board_save` | `root: Option<String>`, `backlog: Backlog` | `()` | String | — | — | **W** · S |

---

## Resumo quantitativo

| Dimensão | Valor |
|---|---|
| Comandos registados | **133** |
| Por ficheiro | `lib.rs` 95 · `bridge.rs` 14 · `fsops.rs` 10 · `lsp.rs` 8 · `pty.rs` 4 · `board.rs` 2 |
| Consumidos pela `ui-app` | **28** (`bridge.ts` 24 · `pair.ts` 4 · `features/codev.ts` 3, com sobreposição) |
| Não consumidos pela `ui-app` | **105** |
| Eventos distintos | **9** — `llm://token`, `llm://done`, `llm://error`, `proc-line`, `proc-exit`, `pty://data`, `pty://exit`, `pair-status`, `pair-msg` |
| Executam processo/shell (**X**) | 30+ (estudo-run, testes, debug, devcontainers, exec/run_shell/run_path, lsp_start, pty) |
| Tocam segredos (**K**) | `save_key`, `keys_status`, `llm_chat`, `llm_plan`, `assistant_chat*`, `get/save_providers_config` |
| Mutam git (**G**) | `git_stage/unstage/stage_all/commit/checkout/create_branch`, `git_clone`, `codev_session_*` |

## Dívida mapeada (entrada para Etapas 2–5)

1. **Fronteira IPC por tipar** — toda a invocação passa por `bridge.ts` sem
   contrato tipado por comando (Etapa 4: `platform/tauri/` + `contracts/`).
2. **105 comandos não consumidos** — a `ui-app` simula no browser; a primeira
   fatia vertical (Etapa 2) deve ligar um fluxo real ponta-a-ponta (ex.
   `load_workspace`/`board_*`).
3. **Git por duas vias** — mutações por `exec("git",…)` em vez dos `git_*`
   dedicados; convergir na Etapa 3 (preservando `Assisted-by`, âmbito-de-ficheiro
   e autor, que os `git_*` ainda não cobrem).
4. **Sobreposição `run_tests` vs `run_test`/`run_all_tests`** — consolidar.
5. **Política de aprovação no frontend (E14)** — mover para o backend na Etapa 5;
   `study_policy`/`codev_policy` já existem no backend mas por consumir.
