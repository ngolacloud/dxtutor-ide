# DXTUTOR IDE — matriz IPC detalhada (179 comandos)

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

Dos 187 comandos, **101 são consumidos pela `ui-app`** e **86 não o são**: a UI
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

## 1. PairCode — `commands/pair.rs` (4)

Exclusivo do dxtutor-ide. Sessão de colaboração; emite estado/mensagens.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `pair_host` | `name: String`, `port: Option<u16>` | `String` (token) | String | `pair-status` | `platform/tauri/pair.ts` (via `pair.ts`) | S · E |
| `pair_join` | `token: String`, `via: Option<String>` | `String` | String | `pair-status`, `pair-msg` | `platform/tauri/pair.ts` (via `pair.ts`) | S · N · E |
| `pair_send` | `msg: String` | `()` | String | `pair-msg` | `platform/tauri/pair.ts` (via `pair.ts`) | S · E |
| `pair_stop` | — | `()` | — | `pair-status` | `platform/tauri/pair.ts` (via `pair.ts`) | S · E |

> **Etapa 3:** extraídos de `lib.rs` para `commands/pair.rs` (adaptadores finos) sobre o
> caso de uso Tauri-free `crate::pair` (mecanismo TCP + ChaCha20-Poly1305 + WebSocket, já
> Tauri-free — grupo de passagens como `debug`). O adaptador desembrulha o
> `tauri::State<pair::Pair>` e veste a emissão dos eventos `pair-status`/`pair-msg` (helper
> `pair_events`, migrado de `lib.rs`). Nomes, args, contratos serde, eventos e mensagens
> preservados (consumido por `pair.ts`).

## 2. v7 desktop bridge — `bridge.rs` + `fsops::pick_folder` (17)

Comandos genéricos da casca desktop; a espinha dorsal consumida pela `ui-app`.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `pick_folder` | — | `Option<String>` | — | — | `platform/tauri/fs.ts` (via `bridge.ts`) | S (diálogo) |
| `load_workspace` | `root: String` | `workspace::Loaded` | String | — | `bridge.ts` | R |
| `write_file` | `root: String`, `rel: String`, `content: String` | `()` | String | — | `platform/tauri/fs.ts` (via `bridge.ts`, `features/codev.ts`, `pair.ts`) | W |
| `delete_file` | `root: String`, `rel: String` | `()` | String | — | `platform/tauri/fs.ts` (via `bridge.ts`) | W |
| `expand_path` | `path: String` | `String` | — | — | `platform/tauri/fs.ts` (via `bridge.ts`) | R |
| `exec` | `program: String`, `args: Vec<String>`, `cwd: Option<String>`, `env: Option<HashMap<String,String>>`, `stdin: Option<String>`, `timeout_ms: Option<u64>` | `procs::ExecOut` | String | — | `platform/tauri/shell.ts` (via `bridge.ts`, `pair.ts`) | **X** |
| `run_shell` | `id: String`, `line: String`, `cwd: Option<String>`, `env: Option<HashMap<String,String>>` | `()` | String | `proc-line`, `proc-exit` | `platform/tauri/shell.ts` (via `bridge.ts`) | **X** · S · E |
| `kill_shell` | `id: String` | `bool` | — | — | `platform/tauri/shell.ts` (via `bridge.ts`) | X · S |
| `keys_status` | — | `HashMap<String,bool>` | String | — | — | K · S |
| `save_key` | `provider: String`, `key: String` | `()` | String | — | — | **K** · S |
| `llm_chat` | `req: llm::ChatReq`, `mode: Option<String>` | `llm::ChatResp` | String | — | `platform/tauri/providers.ts` (via `bridge.ts`) | **N** · K · S |
| `llm_plan` | `req: llm::ChatReq`, `mode: Option<String>` | `serde_json::Value` | — | — | — | N · K |
| `vsix_manifest` | `b64: String` | `serde_json::Value` | String | — | — | R |
| `vsix_fetch_open_vsx` | `id: String` (`publisher.name`) | `String` (VSIX em base64) | String | — | `platform/tauri/extensions.ts` | **N** (só open-vsx.org; valida que é um VSIX; ≤ 100 MiB) · async |
| `vsix_search_open_vsx` | `query: String`, `size: Option<u32>` (1..=50, 30 por omissão) | `Vec<vsix::OvsxHit>` | String | — | `platform/tauri/extensions.ts` | **N** (só open-vsx.org) · async |
| `app_info` | — | `serde_json::Value` | — | — | `platform/tauri/app.ts` (via `bridge.ts`) | R · S |
| `selftest_report` | `report: serde_json::Value` | `()` | — | — | `platform/tauri/app.ts` (via `bridge.ts`, `pair.ts`) | W · S |

## 3. Estudo / missões — `commands/study.rs` (11) + `commands/missions.rs` (4)

Núcleo do «cérebro» dxtutor (currículo/avaliação). **Nenhum consumido pela
`ui-app`** hoje (origem do protótipo de estudo / consumido por `ui-next`).

> **Etapa 3 (13º e último grupo):** extraídos de `lib.rs` — os 11 comandos de
> estudo para `commands/study.rs` (adaptadores finos sobre o caso de uso
> Tauri-free `crate::study`: classificação de passos, política, carregamento com
> erro tipado `StudyError`, avaliação honesta `grade_phase`/`grade_step`), e os 4
> de missões/execução para `commands/missions.rs` (passagens sobre `tutor_eval`;
> única regra isolada = o despacho `missions::drill_language`). Nomes, args, serde
> e mensagens de erro preservados; `lib.rs` fica sem `#[tauri::command]` e guarda
> só os DTOs/mappers `pub(crate)`.
>
> `get_diagnostics` saiu desta secção para `commands/assistant.rs` (§5) — fica
> documentado com o grupo `assistant`, com que partilha agora o ficheiro.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `list_phases` | — | `ProjectDto` | String | — | — | R |
| `submit` | `phase_id: String`, `code: String` | `AssessmentDto` | String | — | — | R |
| `submit_step` | `step_id: String`, `code: String`, `language: Option<String>` (procura só nos cursos dessa linguagem: Rust e Go repetem ids de passo) | `AssessmentDto` | String | — | `platform/tauri/learn.ts` | R |
| `request_hint` | `phase_id: String`, `code: String`, `level: u8` | `HintDto` | String | — | — | R |
| `request_plan` | `phase_id: String`, `comment: String`, `code: String` | `PlanDto` | String | — | — | R |
| `request_fix` | `phase_id: String`, `code: String`, `line: u32`, `message: String` | `String` | String | — | — | R |
| `get_course` | `language: String` | `CourseDto` (+ `overview`, unidade + `concepts`) | String | — | `platform/tauri/learn.ts` | R |
| `list_courses` | — | `Vec<CourseSummaryDto>` (embutidos + plugins) | — | — | `platform/tauri/learn.ts` | R |
| `get_glossary` | `language: String` | `GlossaryDto` | String | — | — | R |
| `get_study_guide` | `language: String`, `unit_id: String` | `StudyGuideDto` | String | — | — | R |
| `run_drill` | `code: String`, `language: String`, `dependencies: Vec<String>` | `RunDto` (Rust/Go nativos; Python/C/drop-ins pelo descritor de `tutor_eval::plugin`) | String | — | — | **X** |
| `run_measured` | `code: String` | `MeasuredRunDto` | String | — | — | **X** |
| `compile_pipeline` | `code: String` | `PipelineDto` | String | — | — | **X** |
| `trace_execution` | `language: String`, `code: String` | `ExecutionTraceDto` | String | — | — | **X** |
| `study_policy` | `mode: String`, `step_id: Option<String>` | `StudyPolicy` | — | — | — | R |

## 4. Review de código — `commands/review.rs` (3)

> **Etapa 3:** extraídos de `lib.rs` para `commands/review.rs` (adaptadores finos)
> sobre o caso de uso Tauri-free `review::run_review` (erro tipado `ReviewError`).
> O erro de `review_code` continua a ser `String` na fronteira, com as mesmas
> mensagens (`"file scope needs a path"`, `"review failed: …"`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `review_code` | `root: String`, `scope: String`, `path: Option<String>`, `version: Option<String>` | `review::ReviewReport` | String | — | `features/codereview` | R |
| `list_review_analyzers` | — | `Vec<review::AnalyzerInfo>` | — | — | — | R |
| `verify_review_fix` | `current_source: String`, `analyzed_version: String`, `fix: review::SuggestedFix` | `review::FixVerification` | — | — | — | R |

## 5. Assistant / provedores — `commands/assistant.rs` (8)

> **Etapa 3:** extraídos de `lib.rs` para `commands/assistant.rs` (adaptadores finos)
> sobre o caso de uso Tauri-free `crate::assistant`. A *regra* (política de estudo +
> validação de provider, erro tipado `StreamError` com a mensagem histórica), o dispatch
> SSE e o registo de cancelamento vivem no caso de uso; a emissão dos eventos
> `llm://token|done|error` e a thread ficam no adaptador. `get_diagnostics` junta-se aqui
> (partilha o ficheiro) mapeando `tutor_eval::diagnostics_for` → DTO `assistant::Diagnostic`
> (antes `DiagnosticDto` em `lib.rs`; mesmo serde). Nomes, args, contratos serde, eventos e
> mensagens preservados.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `assistant_models` | — | `Vec<String>` | — | — | `platform/tauri/assistant.ts` (lista de modelos do Ollama no compositor do Co-Dev) | R |
| `assistant_chat` | `messages: Vec<assistant::ChatMsg>`, `model: Option<String>` | `assistant::ChatReply` | String | — | — | **N** · K |
| `assistant_chat_stream` | `messages: Vec<assistant::ChatMsg>`, `provider: Option<String>`, `model: Option<String>`, `request_id: String`, `mode: Option<String>`, `step_id: Option<String>` | `()` (via eventos) | — | `llm://token` `{requestId,delta}`, `llm://done` `{requestId,model}`, `llm://error` `{requestId,error}` | `platform/tauri/providers.ts` (via `bridge.ts`) | **N** · K · S · E |
| `assistant_cancel` | `request_id: String` | `()` | — | — | `platform/tauri/providers.ts` (via `bridge.ts`) | S |
| `list_providers` | — | `Vec<assistant::ProviderInfo>` | — | — | `platform/tauri/providers.ts` (via `bridge.ts`) | R |
| `get_providers_config` | — | `assistant::ProvidersConfig` | — | — | `platform/tauri/providers.ts` (via `bridge.ts`) | K (lê config) |
| `save_providers_config` | `config: assistant::ProvidersConfig` | `()` | String | — | `platform/tauri/providers.ts` (via `bridge.ts`) | **K** · W |
| `get_diagnostics` | `step_id: String`, `code: String` | `Vec<assistant::Diagnostic>` | String | — | — | R |

## 6. Inteligência de código — `commands/codeintel.rs` (10)

Análise estática + resolução (definições/referências/hover). Não consumidos
pela `ui-app` (editor usa simulação/`ui-next`); baseline para a Etapa 2.

> **Etapa 3:** extraídos de `lib.rs` para `commands/codeintel.rs` (adaptadores
> finos) sobre o caso de uso Tauri-free `codeintel` (erro tipado `CodeIntelError`,
> DTO `ResolvedDef`, tradução de coordenadas editor↔LSP e a coordenação
> «servidor-de-língua primeiro, mapa sintáctico como recurso» do outline).
> `symbol_ranges`/`list_symbols`/`diff_lines`/`propose_entrypoint`/
> `project_entrypoint` são passagens directas (sem regra) e não têm camada nova.
> O erro continua a ser `String` na fronteira, com as mesmas mensagens.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `symbol_relations` | `root: String`, `symbol: String` | `codemap::Relations` | String | — | — | R |
| `list_symbols` | `root: String`, `max: Option<usize>` | `Vec<codemap::SymbolRef>` | String | — | — | R |
| `symbol_ranges` | `code: String`, `name: String` | `Vec<codemap::SymbolRange>` | String | — | — | R |
| `file_outline` | `code: String`, `lang: String`, `root: Option<String>`, `file: Option<String>` | `Vec<codemap::SymbolRange>` | String | — | `features/explorer.ts` | R |
| `diff_lines` | `old: String`, `new: String` | `Vec<textdiff::DiffLine>` | String | — | — | R |
| `propose_entrypoint` | `lang: String`, `code: String` | `Option<entrypoint::EntrypointProposal>` | String | — | — | R |
| `project_entrypoint` | `root: String` | `Option<String>` | — | — | — | R |
| `resolve_definition` | `root: String`, `file: String`, `line: u32`, `col: u32`, `text: Option<String>` | `Option<ResolvedDef>` | String | — | — | R |
| `resolve_references` | `root: String`, `file: String`, `line: u32`, `col: u32`, `text: Option<String>` | `Vec<ResolvedDef>` | String | — | — | R |
| `resolve_hover` | `root: String`, `file: String`, `line: u32`, `col: u32`, `text: Option<String>` | `Option<String>` | String | — | — | R |

## 7. Testes e execução — `commands/tests.rs` (8)

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `list_tests` | `root: String` | `Vec<testnav::TestItem>` | String | — | `features/testing` | R |
| `run_test` | `root: String`, `path: String`, `lang: Option<String>` | `testnav::TestRun` | String | — | `features/testing` | **X** |
| `run_all_tests` | `root: String` | `testnav::TestRun` | String | — | `features/testing` | **X** |
| `run_tests` | `root: String` | `SuiteRun` | String | — | `bridge.ts`, `features/codev.ts` | **X** |
| `run_path` | `path: String`, `args: Option<String>` | `RunDto` | String | — | — | **X** |
| `test_runners` | `root: String` | `Vec<testrun::Runner>` (cargo/go/pytest/unittest/vitest/jest/maven/gradle; `available` + motivo) | String | — | `features/testing` (A6) | R |
| `test_run` | `root: String`, `runner: String`, `scope: Scope` (`all` \| `case {name}` \| `changed {files}`; `files` vazio = `git diff HEAD` + não seguidos) | `testrun::TestRunReport` (um resultado por teste: estado, duração, mensagem, saída) | String | — | `features/testing` (A6) | **X** · **W** (guarda a execução no histórico SQLite) |
| `test_history` | `root: String` | `testhist::TestHistory` (execuções recentes; por teste: resultados recentes, trocas, flaky, duração média) | String | — | `features/testing` (A6) | R |

> **Etapa 3:** extraídos de `lib.rs` para `commands/tests.rs` (adaptadores finos)
> sobre o caso de uso Tauri-free `testexec` — despacho por língua de `run_test`
> (`TestLang`/`run_one`), escolha sessão-vs-host de `run_tests` (erro tipado
> `TestError`, DTO `SuiteRun`, antes `TestRun` em `lib.rs`) e split de argumentos de
> `run_path` (`split_args`). `list_tests`/`run_all_tests` são passagens directas (sem
> regra). O erro continua a ser `String` na fronteira, com as mesmas mensagens
> (`"No known test command for this project."`). `run_path` reusa `RunDto` (partilhado
> com `run_drill`/`run_measured`, que ficam em `lib.rs`).
>
> `run_tests` (o único consumido) coexiste com `run_test`/`run_all_tests`
> (dedicados, não consumidos) — sobreposição a resolver na Etapa 3.

## 8. Git — `commands/git.rs` (21)

Só `git_changes/git_log/git_show` são consumidos; os mutantes correm por
`exec("git", …)` no `bridge.ts` (ver nota de arquitectura). **Etapa 3**:
adaptadores finos sobre o caso de uso Tauri-free `gitops` (página por omissão do
histórico, default de diff, erro tipado `GitError` — mesmas mensagens).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `git_changes` | `root: String` | `Vec<git::GitChange>` | String | — | `platform/tauri/git.ts` (via `bridge.ts`) | R |
| `git_diff` | `root: String`, `file: Option<String>`, `staged: Option<bool>` | `String` | String | — | — | R |
| `git_log` | `root: String`, `max: Option<usize>` | `Vec<git::GitCommit>` | String | — | `platform/tauri/git.ts` (via `bridge.ts`) | R |
| `git_show` | `root: String`, `hash: String` | `String` | String | — | `platform/tauri/git.ts` (via `bridge.ts`) | R |
| `git_branch` | `root: String` | `Option<String>` | String | — | — | R |
| `git_branches` | `root: String` | `Vec<String>` | String | — | — | R |
| `git_clone` | `url: String`, `parent_dir: String` | `String` | String | — | — | **N** · W |
| `git_stage` | `root: String`, `path: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_unstage` | `root: String`, `path: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_stage_all` | `root: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_commit` | `root: String`, `message: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_checkout` | `root: String`, `branch: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_create_branch` | `root: String`, `name: String` | `()` | String | — | — (via `exec`) | **G** |
| `git_blame` | `root: String`, `path: String` | `gitx::Blame` (por linha: commit, autor, data, assunto; autores com linhas/percentagem/última) | String | — | `features/scm` (A4) | R |
| `git_history` | `root: String`, `path: String`, `start/end: Option<u32>`, `max: Option<usize>` | `Vec<gitx::HistCommit>` (`--follow`, ou `-L` com linhas) | String | — | `features/scm` (A4) | R |
| `git_show_path` | `root: String`, `hash: String`, `path: String` | `String` (mensagem + diff desse ficheiro) | String | — | `features/scm` (A4) | R |
| `git_compare` | `root: String`, `base: String`, `target: String` | `gitx::Compare` (à frente, atrás, ficheiros desde a base comum) | String | — | `features/scm` (A4) | R |
| `git_stash` | `root: String`, `op: StashOp` (`list` \| `push {message, untracked}` \| `apply {index, pop}` \| `drop {index}` \| `show {index}`) | `gitx::StashResult` | String (o do git) | — | `features/scm` (A4) | **G** · W |
| `git_worktree` | `root: String`, `op: WorktreeOp` (`list` \| `add {path, branch, create}` \| `remove {path}`) | `Vec<gitx::Worktree>` | String | — | `features/scm` (A4) | **G** · W |
| `git_rebase` | `root: String`, `op: RebaseOp` (`plan {onto}` \| `run {onto, steps}`) | `gitx::RebasePlan` | String (o rebase é desfeito se parar) | — | `features/scm` (A4) | **G** · W |
| `git_amend` | `root: String`, `message: Option<String>`, `allow_published: Option<bool>` | `String` (o hash curto novo) | String (`published: …` se já está num remoto) | — | `features/scm` (A4) | **G** · W |

## 9. Agente / arquitectura — `commands/agent.rs` (10)

> **Etapa 3:** extraídos de `lib.rs` para `commands/agent.rs` (adaptadores finos)
> sobre o caso de uso Tauri-free `agent` — regra do scaffold com erro tipado
> `ScaffoldError`, registo de tarefa cloud-shaped (RF-AG-01) como orquestração pura,
> executor isolado `worktree_patch` re-exportado. Nomes/args/serde/mensagens preservados.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `agent_isolated_patch` | `root: String`, `writes: Vec<(String,String)>` | `String` | String | — | — | **W** |
| `agent_task_submit` | `root: String`, `writes: Vec<(String,String)>` | `String` (id) | String | — | `platform/tauri/agent-tasks.ts` (via `bridge.ts`) | **W** · S |
| `agent_task_status` | `id: String` | `Option<AgentTask>` | — | — | `platform/tauri/agent-tasks.ts` (via `bridge.ts`) | R · S |
| `agent_task_cancel` | `id: String` | `bool` | — | — | `platform/tauri/agent-tasks.ts` (via `bridge.ts`) | S |
| `arch_validate` | `arch: arch::Architecture` | `Vec<arch::Finding>` | String | — | `platform/tauri/arch.ts` (`features/arch`) | R |
| `arch_scaffold` | `root: String`, `arch: arch::Architecture` | `Vec<String>` | String | — | `platform/tauri/arch.ts` (`features/arch`) | **W** |
| `arch_scaffold_preview` | `arch: arch::Architecture` | `Vec<(String,String)>` | — | — | `platform/tauri/arch.ts` (`features/arch`) | R |
| `arch_export_mermaid` | `arch: arch::Architecture` | `String` | — | — | `platform/tauri/arch.ts` (`features/arch`) | R |
| `arch_import_mermaid` | `source: String` | `arch::mermaid::MermaidImport` (`{ arch, warnings }`) | String | — | `platform/tauri/arch.ts` (`features/arch`) | R |
| `arch_save_export` | `root: String`, `rel: String`, `bytes: Vec<u8>` | `String` (caminho relativo escrito) | String | — | `platform/tauri/arch.ts` (`features/arch`) | **W** (só dentro de `root`, só svg/png/mmd/md/json) |

## 10. Co-Dev — `commands/codev.rs` (5)

> **Etapa 3:** extraídos de `lib.rs` para `commands/codev.rs` (adaptadores finos)
> sobre o caso de uso Tauri-free `crate::codev`: a regra `policy_for_mode` (parse da
> modebar → `CoDevPolicy`) e a fachada do mecanismo de sessões (worktrees `codev/<slug>`
> re-exportado de `tutor_eval::git`). Mesmos nomes/args/serde/mensagens — a modebar e
> `features/codev.ts` governam-se por este contrato.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `codev_policy` | `mode: String` | `CoDevPolicy` | — | — | — | R |
| `codev_session_start` | `root: String`, `name: String` | `git::SessionInfo` | String | — | — | **G** |
| `codev_session_deliver` | `root: String`, `slug: String`, `message: String` | `git::DeliverInfo` | String | — | — | **G** |
| `codev_session_discard` | `root: String`, `slug: String` | `()` | String | — | — | **G** |
| `codev_session_list` | `root: String` | `Vec<git::SessionInfo>` | String | — | — | R |

## 10b. Agente Co-Dev v2 — `commands/codev_agent.rs` (16)

> **ADR-0003 (F1):** adaptadores finos sobre o caso de uso Tauri-free
> `crate::codev_agent`, que gere sessões do loop do crate `tutor-agent` (tool use
> nativo, histórico append-only). O turno corre numa thread e responde por eventos.
> F4: consumidos pela UI através de `platform/tauri/codev-agent.ts` (porta `AgentGateway`
> da feature Co-Dev). F5: sessões gravadas em `~/.config/dxtutor/sessions/<projecto>/`
> (JSONL append-only, 0600); `resume` reabre uma com o prefixo do pedido tal como foi
> gravado (system prompt, ferramentas, modelo). F6: modo plano, checkpoints de ficheiros
> (commits git em refs ocultas `refs/dxtutor/cp/<sessão>/<n>`, sem tocar no index nem nos
> ramos) e rewind. F7: `codev_agent_start` passa a assíncrono (liga servidores MCP) e
> o `send` pode correr hooks do projecto (só se confiados — `codev_agent_trust`); a
> sessão inclui `lsp_diagnostics` (cache dos diagnósticos que o `lsp.rs` já publica). F8:
> `codev_agent_start` aceita `provider` (`claude`/`codex`/`gemini`/`ollama`; a chave é a desse
> provedor, e numa retoma vale o gravado na sessão); os não-Claude usam o adaptador
> OpenAI-compatível de `tutor_agent::openai`. Um modelo sem tool calling devolve no
> `codev-agent://error` um erro com o prefixo `[sem-ferramentas] ` (a UI recua para o harness antigo). F2: o turno usa as ferramentas reais
> (ler/pesquisar/editar/escrever ficheiros, `bash`, git só leitura, testes/lint) —
> F3: as permissões decidem-se no backend (`tutor_agent::permissions`: modo + regras
> `.dxtutor/permissions.json` + piso de segurança); só o que pergunta chega à UI pelo
> evento `codev-agent://approval`, com a razão e a regra que «permitir sempre» gravaria.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `codev_agent_start` | `root: String`, `model: Option<String>`, `effort: Option<String>`, `test_cmd: Option<String>`, `lint_cmd: Option<String>`, `mode: Option<String>`, `resume: Option<String>`, `provider: Option<String>`, `review_edits: Option<bool>`, `issue: Option<String>` (as alterações aceites ficam ligadas a esta issue do Project) | `String` (id da sessão) | String | — | `platform/tauri/codev-agent.ts` | **K** · S |
| `codev_agent_send` | `session_id: String`, `text: Option<String>` | `()` (via eventos) | — | `codev-agent://event` `{session,event}`, `codev-agent://approval` `{session,request:{call,reason,dangerous,suggestedRule}}`, `codev-agent://error` `{session,error}` | `platform/tauri/codev-agent.ts` | **N** · K · **W** · **X** · S · E |
| `codev_agent_approve` | `session_id: String`, `tool_use_id: String`, `allow: bool`, `reason: Option<String>`, `remember: Option<bool>` | `bool` | — | — | `platform/tauri/codev-agent.ts` | S · W (`remember` grava `.dxtutor/permissions.json`) |
| `codev_agent_review` | `session_id: String`, `call: String`, `decisions: Vec<{hunk: String, accept: bool, reason?: String}>` | `()` | String | — | `platform/tauri/codev-agent.ts` | S · **W** (escreve só os hunks aceites) |
| `codev_agent_set_mode` | `session_id: String`, `mode: String` | `bool` | — | — | `platform/tauri/codev-agent.ts` | S |
| `codev_agent_sessions` | `root: String` | `Vec<session::SessionSummary>` | — | — | `platform/tauri/codev-agent.ts` | R |
| `codev_agent_history` | `session_id: String` | `Vec<session::HistoryItem>` | String | — | `platform/tauri/codev-agent.ts` | S |
| `codev_agent_set_plan` | `session_id: String`, `on: bool` | `()` | String | — | `platform/tauri/codev-agent.ts` | S |
| `codev_agent_checkpoints` | `session_id: String` | `Vec<CheckpointView>` (o checkpoint + `conversation`: a conversa também pode voltar a esse ponto) | String | — | `platform/tauri/codev-agent.ts` | S |
| `codev_agent_rewind` | `session_id: String`, `checkpoint: u32`, `conversation: Option<bool>` («Rewind to here»: a conversa volta também, e o JSONL da sessão é reescrito) | `String` | String | — | `platform/tauri/codev-agent.ts` | **W** · S |
| `codev_agent_permissions` | `root: String` | `PermissionsView {project, user, projectFile, userFile}` | — | — | `platform/tauri/codev-agent.ts` | R |
| `codev_agent_save_permissions` | `root: String`, `rules: Rules {allow, deny}` | `()` | String (regra inválida) | — | `platform/tauri/codev-agent.ts` | **W** (`.dxtutor/permissions.json`; aplica às sessões abertas da pasta) |
| `codev_agent_extensions` | `root: String` | `ExtensionsStatus` | — | — | `platform/tauri/codev-agent.ts` | R |
| `codev_agent_trust` | `root: String`, `kind: String` | `()` | String | — | `platform/tauri/codev-agent.ts` | W (`~/.config/dxtutor/trusted.json`) |
| `codev_agent_cancel` | `session_id: String` | `bool` | — | — | `platform/tauri/codev-agent.ts` | S |
| `codev_agent_close` | `session_id: String` | `bool` | — | — | `platform/tauri/codev-agent.ts` | S |

## 10c. Ditado local (whisper.cpp) — `commands/dictation.rs` (4)

> Microfone do compositor do Co-Dev no desktop (o WebKitGTK não tem reconhecimento de voz).
> Caso de uso `crate::dictation` (Tauri-free): um gravador do sistema (`pw-record`,
> `parecord`, `arecord` ou `ffmpeg`) grava WAV 16 kHz mono num temporário; ao parar, o
> `whisper-cli` transcreve-o com um modelo `ggml-*.bin` local (`scripts/setup-whisper.sh`
> instala ambos em `~/.local/share/dxtutor/whisper`). O áudio não sai da máquina e o WAV
> é apagado depois da transcrição. Uma gravação de cada vez (estado global no caso de uso).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `dictation_status` | — | `dictation::Status` (`ready`, `binary`, `model`, `recorder`, `missing`, `recording`, `device`) | — | — | `platform/tauri/dictation.ts` | R |
| `dictation_start` | — | `()` | String | — | `platform/tauri/dictation.ts` | **X** · S |
| `dictation_stop` | `lang: Option<String>` | `String` (texto) | String | — | `platform/tauri/dictation.ts` | **X** · S (async: whisper numa thread de bloqueio) |
| `dictation_cancel` | — | `()` | — | — | `platform/tauri/dictation.ts` | S |

## 10d. Plugins de curso — `commands/plugins.rs` (3)

> Adaptador fino sobre o crate `tutor-plugins` (manifesto `dxtutor-plugin.json`, validação,
> origem GitHub/zip/pasta, registo `installed.json`), partilhado com o CLI `dxt plugin`.
> Os plugins ficam em `$DXTUTOR_PLUGINS_DIR` ou na pasta de dados do utilizador
> (`~/.local/share/dxtutor/plugins`). Plugins são **dados**: a instalação não executa nada
> do plugin. Os cursos instalados entram em `list_courses`/`get_course`/`submit_step` via
> `study::all_courses` (cache invalidada pelo mtime do registo). Guia de autoria:
> `docs/plugins/README.md`.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `plugin_list` | — | `Vec<tutor_plugins::Installed>` (`entry`, `manifest`, `error`) | String | — | `platform/tauri/learn.ts` | R |
| `plugin_install` | `source: String` | `tutor_plugins::Outcome` (`entry`, `language`, `courseIds`, `replaced`, `warnings`) | String | — | `platform/tauri/learn.ts` | **N** (HTTPS GitHub/zip) · W (pasta de plugins) · async |
| `plugin_remove` | `id: String` | `String` (id removido) | String | — | `platform/tauri/learn.ts` | W (pasta de plugins) |

## 11. Debug (DAP) — `commands/debug_cmds.rs` (10)

> **Etapa 3:** extraídos de `lib.rs` para `commands/debug_cmds.rs` (adaptadores finos)
> sobre o caso de uso Tauri-free `debug` — grupo de **passagens** (o motor gdb/MI já era
> Tauri-free; a fatia ganhou a fachada `capabilities()`). Nomes/args/serde/mensagens
> preservados; A1 mantém-se em 133.

Motor de depuração; os que precisam de sessão usam `State<DebugSessions>`. Consumidos pela
`ui-app` desde a R4 do ADR-0006 (`features/debug/infrastructure/tauri.ts`): o pane Run and
Debug corre sessões reais pelo gdb. `debug_launch`/`debug_run`/`debug_continue`/`debug_step`
são `async` (esperam pelo gdb; síncronos congelavam a thread principal).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `debug_capabilities` | — | `dap::DebugCapability` | — | — | — | R |
| `debug_available` | — | `bool` | — | `features/debug` | — | R |
| `debug_launch` | `id: String`, `program: String`, `cwd: Option<String>` | `()` | String | — | `features/debug` | **X** · S |
| `debug_break` | `id: String`, `file: String`, `line: u32` | `u32` | String | — | `features/debug` | S |
| `debug_run` | `id: String` | `debug::Stop` | String | — | `features/debug` | X · S |
| `debug_continue` | `id: String` | `debug::Stop` | String | — | `features/debug` | X · S |
| `debug_step` | `id: String`, `into: bool` | `debug::Stop` | String | — | `features/debug` | X · S |
| `debug_locals` | `id: String` | `Vec<debug::Var>` | String | — | `features/debug` | R · S |
| `debug_stack` | `id: String` | `Vec<debug::Frame>` | String | — | `features/debug` | R · S |
| `debug_stop` | `id: String` | `()` | String | — | `features/debug` | S |

## 12. Devcontainers — `commands/devcontainer.rs` (8)

Todos lançam processos de container (no motor do sandbox do backend: delonix/docker/podman). A sessão (`up`/`status`/`down`) é consumida pelo pane Infra no desktop (ADR-0006, R5b); os outros não são consumidos pela `ui-app`.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `devcontainer_info` | `root: String` | `DevcontainerInfo` | String | — | — | R |
| `devcontainer_up` | `root: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_exec` | `root: String`, `cmd: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_session_up` | `root: String` | `DevcontainerUp` | String | — | `platform/tauri/devcontainer.ts` (via `platform/desktop/infra.ts`) | **X** |
| `devcontainer_session_exec` | `root: String`, `cmd: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_session_run` | `root: String`, `file: String` | `DevcontainerUp` | String | — | — | **X** |
| `devcontainer_session_status` | `root: String` | `SessionStatus` | String | — | `platform/tauri/devcontainer.ts` (via `platform/desktop/infra.ts`) | R |
| `devcontainer_session_down` | `root: String` | `()` | String | — | `platform/tauri/devcontainer.ts` (via `platform/desktop/infra.ts`) | **X** |

## 13. Projecto / sandbox / run — `commands/sandbox.rs` (3)

> Os três comandos de sandbox/run saíram na **Etapa 3** de `lib.rs` para
> `commands/sandbox.rs` (adaptadores finos) sobre o caso de uso Tauri-free
> `crate::sandbox` (shaping puro do `docker compose ps` + validação de motor com
> erro tipado `SandboxError`). Antes, `run_path` (correr um ficheiro do Explorer)
> saíra para `commands/tests.rs` (grupo testes/execução — ver §7) e os quatro
> comandos de pesquisa/projecto (`search_project`, `list_files`,
> `read_folder_sources`, `detect_projects`) para `commands/search.rs` (ver §18).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `compose_ps` | `root: String` | `Vec<ComposeService>` | String | — | — | **X** |
| `get_sandbox_engine` | — | `String` | — | — | `platform/tauri/devcontainer.ts` (via `platform/desktop/infra.ts`) | R |
| `set_sandbox_engine` | `engine: String` | `String` | String | — | — | W (config) |

## 14. Sistema de ficheiros — `fsops.rs` (9)

`pick_folder` está na secção 2 (registado no bloco bridge). Nenhum dos restantes
é consumido pela `ui-app` (acesso a disco passa por `write_file`/`load_workspace`
do `bridge.rs`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `list_dir` | `path: String` | `Vec<EntryDto>` | String | — | — | R |
| `read_text_file` | `path: String` | `String` | String | — | `platform/tauri/arch.ts` (`features/arch`: abrir do projecto) | R |
| `write_text_file` | `path: String`, `contents: String` | `()` | String | — | — | **W** |
| `create_path` | `path: String`, `is_dir: bool` | `()` | String | — | — | **W** |
| `delete_path` | `path: String` | `()` | String | — | — | **W** |
| `rename_path` | `from: String`, `to: String` | `()` | String | — | — | **W** |
| `workspace_tree` | `root: String`, `max_depth: u32`, `max_entries: u32` | `String` | String | — | — | R |
| `workspace_resolve` | `root: String`, `path: String` | `String` | String | — | — | R |
| `workspace_action` | `root: String`, `op: String`, `path: String`, `content: Option<String>` | `String` | String | — | — | **W** |

## 15. LSP — `lsp.rs` (14)

Todos usam `State<LspState>` + `AppHandle`. Na app desktop, a feature `features/lsp` liga o
editor: `lsp_start` (uma vez por pasta aberta, que também passa a ser a raiz de reserva de um
ficheiro sem marcador de projecto), `lsp_did_open`/`lsp_did_change` (ao abrir/editar),
`lsp_hover` (rato parado), `lsp_definition` (F12 / Ctrl+clique), `lsp_references` (Shift+F12) e
`lsp_prepare_rename` + `lsp_rename` (F2; a UI aplica a `WorkspaceEdit` aos ficheiros da pasta) e
`lsp_completion` (Ctrl+Espaço, depois de `.` ou ao escrever um nome), `lsp_signature_help` (depois de `(`/`,` ou Ctrl+Shift+Espaço: a assinatura com o
parâmetro activo), `lsp_server_status` (o aviso no editor quando o servidor da linguagem
não está instalado) e `lsp_code_action` + `lsp_execute_command` (Ctrl+.: correcções e
refactorings; as edições de um comando voltam do servidor por `workspace/applyEdit`, que o
backend emite como `lsp://apply-edit`) e `lsp_format` (Shift+Alt+F: o documento, ou só a selecção;
sem servidor, ou se ele não formatar, fica o «Format Document» do dxtutor).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `lsp_start` | `root: String` | `()` | String | `lsp://status` | `features/lsp` | **X** · S |
| `lsp_did_open` | `path: String`, `text: String`, `language_id: String` | `()` | String | `lsp://diagnostics` | `features/lsp` | S |
| `lsp_did_change` | `path: String`, `text: String`, `version: i64` | `()` | String | `lsp://diagnostics` | `features/lsp` | S |
| `lsp_definition` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | `features/lsp` | R · S |
| `lsp_references` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | `features/lsp` | R · S |
| `lsp_hover` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | `features/lsp` | R · S |
| `lsp_completion` | `path: String`, `line: u32`, `character: u32`, `trigger_character: Option<String>` | `Value` (CompletionList \| CompletionItem[]) | String | — | `features/lsp` | R · S |
| `lsp_signature_help` | `path: String`, `line: u32`, `character: u32`, `trigger_character: Option<String>`, `is_retrigger: Option<bool>` | `Value` (SignatureHelp \| null) | String | — | `features/lsp` | R · S |
| `lsp_code_action` | `path: String`, `start_line: u32`, `start_character: u32`, `end_line: u32`, `end_character: u32` | `Value` ((Command \| CodeAction)[] \| null) | String | — | `features/lsp` | R · S |
| `lsp_execute_command` | `path: String`, `command: String`, `arguments: Option<Value>` | `Value` | String | `lsp://apply-edit` | `features/lsp` | W · S |
| `lsp_format` | `path: String`, `tab_size: u32`, `insert_spaces: bool`, `start_line`/`start_character`/`end_line`/`end_character: Option<u32>` | `Value` (TextEdit[] \| null) | String | — | `features/lsp` | R · S |
| `lsp_rename` | `path: String`, `line: u32`, `character: u32`, `new_name: String` | `Value` | String | — | `features/lsp` | R · S |
| `lsp_prepare_rename` | `path: String`, `line: u32`, `character: u32` | `Value` | String | — | `features/lsp` | R · S |
| `lsp_server_status` | `path: String` | `Option<lsp::ServerStatus>` (`{ language, server, installed, problem }`) | String | — | `features/lsp` (aviso no editor quando falta o servidor) | R · async |

## 16. PTY — `pty.rs` (7)

Terminais reais (várias instâncias por `id`); `State<PtyState>` (mapa id → sessão) +
`AppHandle`. Consumidos pelo painel inferior (`features/panel/infrastructure/tauri.ts`,
xterm.js). `pty://data` = `{ id, data }` (só caracteres UTF-8 completos); `pty://exit` =
`{ id, code }` (código de saída real). Shells bash/zsh arrancam com integração de shell
(`shell_integration.rs`: OSC 7 cwd + OSC 633 comando/código).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `pty_spawn` | `id: String`, `rows: u16`, `cols: u16`, `cwd: Option<String>`, `shell: Option<String>`, `command: Option<String>`, `env: Option<HashMap<String,String>>` | `()` | String | `pty://data`, `pty://exit` | `features/panel` | **X** · S · E |
| `pty_spawn_in_session` | `id: String`, `rows: u16`, `cols: u16`, `root: String` | `()` | String | `pty://data`, `pty://exit` | — | **X** · S · E |
| `pty_write` | `id: String`, `data: String` | `()` | String | — | `features/panel` | X · S |
| `pty_resize` | `id: String`, `rows: u16`, `cols: u16` | `()` | String | — | `features/panel` | S |
| `pty_kill` | `id: String` | `bool` | — | `pty://exit` | `features/panel` | X · S |
| `pty_shells` | — | `Vec<ShellProfile>` | — | — | `features/panel` | R |
| `pty_info` | `id: String` | `PtyInfo` (shell, processo em 1.º plano, cwd) | String | — | `features/panel` | R · S |

## 16b. Painel inferior — `commands/panel.rs` (2)

Adaptadores finos sobre `problems.rs` (checkers do projecto com saída estruturada, no
ambiente da shell de login resolvido por `shellenv.rs`) e `ports.rs` (portas TCP em escuta).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `problems_scan` | `root: String` | `problems::ScanResult` | String | `problems://check` | `features/panel` | **X** · R |
| `ports_list` | `root: Option<String>` | `Vec<ports::PortInfo>` | String | — | `features/panel` | R |

## 17. Project (SQLite) e quadro Tasks — `board.rs` (6)

Project (docs/v2/UI-AUDIT.md, item 5; fase A5): Kanban, Scrum, XP ou Scrum + XP sobre o store
`tutor_board::project` (`app_local_data_dir/board.sqlite3`, tabela `schema_version` e migrações só
para a frente; a migração 1 importa o Board antigo que lá estivesse). O quadro da actividade Tasks
(ADR-0006, R3b) continua com `board_load`/`board_save`, mas num ficheiro próprio
(`app_local_data_dir/tasks.sqlite3`): o `sprints` do Project tem outro esquema. Os dois coexistem
até a Q3 decidir se o Tasks passa a ser o Project. As regras de fluxo (um passo, WIP, DoR, DoD, bloqueio) são verificadas no store, numa
transacção por operação; uma regra só se ultrapassa com motivo, registado na actividade. Erros:
`ProjectError {code, message, overridable}`. Quem age = `git config user.name` do projecto (ou o
utilizador do SO).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `board_load` | `root: Option<String>` | `Option<Backlog>` | String | — | `features/board` | R · S |
| `board_save` | `root: Option<String>`, `backlog: Backlog` | `()` | String | — | `features/board` | **W** · S |
| `project_load` | `root: String` | `Project` | `ProjectError` | — | `platform/tauri/project.ts` | R · **W** (cria o projecto vazio no 1.º uso) · S |
| `project_apply` | `root: String`, `op: Op` (`{op: "create_issue" \| "move" \| "settings" \| …}`) | `Project` | `ProjectError` | — | `platform/tauri/project.ts` | **W** · S |
| `project_issue` | `root: String`, `key: String` | `IssueDetail {activity, changeSets}` | `ProjectError` | — | `platform/tauri/project.ts` | R |
| `project_reports` | `root: String` | `Reports` (cycle time, throughput, CFD, burndown, velocity — do histórico) | `ProjectError` | — | `platform/tauri/project.ts` | R |

## 18. Pesquisa / projecto — `commands/search.rs` (4)

Saíram de `lib.rs` (§13) na **Etapa 3** para adaptadores finos sobre o caso de uso
Tauri-free `crate::search` (defaults de página como contrato + walk de projectos/fontes;
grupo infalível, sem erro tipado). Não consumidos via `invoke` pela `ui-app` (as
ocorrências de `list_files` em `bridge.ts`/`features/codev.ts` são o **nome de uma
ferramenta LLM** local, não o comando IPC).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `search_project` | `root: String`, `query: String`, `max: Option<usize>`, `ignore_case: Option<bool>` | `Vec<search::SearchHit>` | String | — | `features/search.ts` | R |
| `list_files` | `root: String`, `max: Option<usize>` | `Vec<String>` | String | — | — | R |
| `read_folder_sources` | `dir: String`, `max_files: Option<usize>`, `max_bytes: Option<usize>` | `Vec<FolderSource>` | String | — | — | R |
| `detect_projects` | `root: String` | `Vec<ProjectInfo>` | String | — | `features/run.ts` | R |

---

## Resumo quantitativo

| Dimensão | Valor |
|---|---|
| Comandos registados | **187** |
| Por ficheiro | `lib.rs` 0 · `commands/study.rs` 11 · `commands/missions.rs` 4 · `commands/review.rs` 3 · `commands/codeintel.rs` 10 · `commands/tests.rs` 8 · `commands/git.rs` 21 · `commands/codev.rs` 5 · `commands/codev_agent.rs` 16 · `commands/dictation.rs` 4 · `commands/search.rs` 4 · `commands/agent.rs` 10 · `commands/assistant.rs` 8 · `commands/debug_cmds.rs` 10 · `commands/devcontainer.rs` 8 · `commands/sandbox.rs` 3 · `commands/pair.rs` 4 · `commands/plugins.rs` 3 · `bridge.rs` 16 · `fsops.rs` 10 · `lsp.rs` 14 · `pty.rs` 7 · `commands/panel.rs` 2 · `board.rs` 6 |
| Consumidos pela `ui-app` | **101** (`bridge.ts` 24 e `pair.ts` 4 — desde a U2 do ADR-0004 por clientes tipados de `platform/tauri/` (`shell`, `fs`, `git`, `providers`, `agent-tasks`, `app`, `pair`), sem `invoke` cru · `features/codev.ts` 3, com sobreposição · `platform/tauri/codev-agent.ts` 16 · `platform/tauri/dictation.ts` 4 · `platform/tauri/assistant.ts` 1 · `platform/tauri/learn.ts` 6 · `platform/tauri/extensions.ts` 2 · `features/panel` 8 · `platform/tauri/arch.ts` 7 · `features/lsp` 14 · `platform/tauri/project.ts` 4 · `features/testing` 3 da A6: `test_runners`/`test_run`/`test_history` · `features/scm` 8 da A4: `git_blame`/`git_history`/`git_show_path`/`git_compare`/`git_stash`/`git_worktree`/`git_rebase`/`git_amend`) |
| Não consumidos pela `ui-app` | **86** |
| Eventos distintos | **17** — `arch://proposal` (a ferramenta `arch_propose` do agente → Studio de arquitectura), `llm://token`, `llm://done`, `llm://error`, `proc-line`, `proc-exit`, `pty://data`, `pty://exit`, `pair-status`, `pair-msg`, `codev-agent://event`, `codev-agent://approval`, `codev-agent://error`, `lsp://diagnostics`, `lsp://status`, `lsp://apply-edit`, `problems://check` |
| Executam processo/shell (**X**) | 30+ (estudo-run, testes, debug, devcontainers, exec/run_shell/run_path, lsp_start, pty, dictation_start/stop) |
| Tocam segredos (**K**) | `save_key`, `keys_status`, `llm_chat`, `llm_plan`, `assistant_chat*`, `get/save_providers_config`, `codev_agent_start/send` |
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
