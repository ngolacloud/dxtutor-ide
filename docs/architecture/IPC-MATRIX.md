# DXTUTOR IDE — matriz IPC detalhada (304 comandos)

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

Dos 304 comandos, **222 são consumidos pela `ui-app`** e **82 não o são**: a UI
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
| `run_measured` | `code: String` | `MeasuredRunDto` | String | — | `features/hood` (A8) | **X** |
| `compile_pipeline` | `code: String` | `PipelineDto` | String | — | `features/hood` (A8) | **X** |
| `trace_execution` | `language: String`, `code: String` | `ExecutionTraceDto` | String | — | `features/hood` (A8) | **X** |
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

## 8. Git — `commands/git.rs` (41)

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
| `git_clone` | `url: String`, `parent_dir: String` | `String` (a pasta nova, `parent_dir/<nome>`; corre `git -C <parent> clone -- <url> <nome>` sem prompt de credenciais e recusa uma pasta que já existe — r23 F6) | String | — | `features/welcome` («Clone Git Repository…», depois da aprovação) | **N** · W · **G** |
| `git_clone_plan` | `url: String`, `parent_dir: String` | `ClonePlan {url, parent, name, target, exists, command}` (o comando exacto que o diálogo de aprovação mostra; a mesma validação do `git_clone`: https/http/ssh/git/file ou `user@host:path`, nada que comece por `-`, sem `ext::`) | String | — | `features/welcome` | R |
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
| `git_worktree` | `root: String`, `op: WorktreeOp` (`list` \| `add {path, branch, create}` \| `remove {path}` \| `add_pr {number, path, remote}` — r23 F3: `git fetch <remote> pull/<n>/head:pr/<n>` e a worktree) | `Vec<gitx::Worktree>` | String | — | `features/scm` (A4) | **G** · W |
| `git_refs` | `root: String` | `gitwork::Refs {head, headSha, branches[{name, sha, upstream, ahead, behind, gone, current}], remotes, remoteBranches, tags[{name, sha, annotated}], stashes, worktrees, contributors[{name, email, commits}]}` (a barra lateral do Commit Graph numa só leitura — r23 F3) | String | — | `features/scm` (Commit Graph) | R |
| `git_hunks` | `root: String`, `path: String`, `staged: bool` | `gitwork::FileHunks {path, staged, binary, hunks[{id, header, oldStart, oldLines, newStart, newLines, lines, added, removed}]}` (os hunks da árvore de trabalho, ou do índice com `staged`; `id` estável enquanto o texto do hunk for o mesmo — r23 F3, UI-SCM-10) | String | — | `features/scm` (pane, desktop) | R |
| `git_stage_hunks` | `root: String`, `path: String`, `ids: Vec<String>`, `unstage: bool` | `gitwork::FileHunks` (o lado de onde vieram, depois; um patch só com esses hunks, `git apply --cached [--reverse]`; um id que já não existe recusa tudo) | String | — | `features/scm` (pane, desktop) | **G** · W |
| `git_undo_snapshot` | `root: String`, `label: String` | `gitwork::UndoEntry {id, label, at, head, headSha, refs[{name, sha}], index, worktree}` (o estado antes de uma operação: HEAD, ramos e tags, a árvore do índice e um `git stash create`, num commit em `refs/dxtutor/undo/<n>` — o `gc` guarda tudo; ficam as 50 mais recentes — r23 F3, UI-SCM-12) | String | — | `features/scm` (antes de commit/checkout/merge/stash/amend/discard, desktop) | **G** · W |
| `git_undo_list` | `root: String` | `Vec<UndoEntry>` (da mais recente) | String | — | `features/scm` (lista «Undo») | R |
| `git_undo_plan` | `root: String`, `id: u32` | `UndoPlan {entry, commands, display}` (os comandos git exactos que a reposição corre, para o diálogo de aprovação) | String | — | `features/scm` | R |
| `git_undo_restore` | `root: String`, `id: u32` | `UndoEntry` (a fotografia do presente tirada antes de repor: o undo também se desfaz; corre exactamente o `git_undo_plan`; os ramos criados depois e os ficheiros não seguidos ficam) | String | — | `features/scm` (depois da aprovação; auditado) | **G** · W |
| `git_predict_conflicts` | `root: String`, `branches: Vec<String>` (até 100) | `Vec<gitwork::Prediction {branch, clean, files, error}>` (se juntar cada ramo ao HEAD daria conflito e em que ficheiros — `git merge-tree --write-tree --name-only`, git ≥ 2.38; nada muda no repositório — r23 F3, UI-SCM-13) | String | — | `features/scm` (Commit Graph) | R |
| `git_merge` | `root: String`, `op: MergeOp` (`status` \| `resolve {path, content}` \| `commit {message?}` \| `abort`) | `gitwork::MergeState {merging, message, conflicts, output}` (o merge em curso: escrever e fazer stage de um ficheiro resolvido — só dentro da pasta —, commit recusado enquanto houver ficheiros por juntar, ou `git merge --abort` — r23 F3, UI-SCM-13) | String | — | `features/scm` (separador do merge a três; commit depois da verificação do projecto e da aprovação) | **G** · W |
| `git_conflict_stages` | `root: String`, `path: String` | `gitwork::ConflictStages {path, base, ours, theirs, working}` (`git show :1:/:2:/:3:` e o ficheiro com os marcadores) | String | — | `features/scm` (merge a três) | R |
| `git_sync_plan` | `root: String`, `op: SyncOp` (`fetch` \| `pull` \| `push`) | `gitwork::SyncPlan {op, branch, upstream, remote, ahead, behind, setsUpstream, argv, display}` (o comando exacto: `git fetch --all --prune`, `git pull --rebase --autostash`, `git push <remote> <b>:<dst>` ou `git push -u <remote> <b>`; nunca `--force` — r23 F3) | String | — | `features/scm` (Commit Graph) | R |
| `git_sync` | `root: String`, `op: SyncOp`, `expected: String` | `String` (a saída do git; recusa se o comando já não for o `expected` aprovado; sem prompts de credenciais, `ssh -o BatchMode=yes`) | String | — | `features/scm` (depois da aprovação; auditado) | **G** · **N** · W |
| `gh_status` | — | `gh::GhStatus {installed, version, signedIn, notes}` (sem `gh`: «not installed» com a dica de instalação — r23 F3) | String | — | `features/scm` (Launchpad, ciclo de vida) | R |
| `gh_prs` | `root: String`, `filter: PrFilter` (`review` \| `mine` \| `open`) | `Vec<gh::Pr {number, title, author, head, base, url, draft, state, review, checks{passed, failed, pending}, updatedAt}>` (`gh pr list --json`, só leitura) | String | — | `features/scm` (Launchpad) | R · **N** |
| `gh_runs_for` | `root: String`, `sha: String` | `Vec<gh::Run {id, name, status, conclusion, url, createdAt}>` (`gh run list --commit`) | String | — | `features/scm` (ciclo de vida do commit) | R · **N** |
| `gh_prs_for` | `root: String`, `sha: String` | `Vec<gh::Pr>` (os PRs, em qualquer estado, que contêm o commit) | String | — | `features/scm` (ciclo de vida do commit) | R · **N** |
| `git_commit_paths` | `root: String`, `paths: Vec<String>`, `message: String` | `String` (o commit novo; `git add -A -- <paths>` + `git commit --only -- <paths>`: o resto do stage fica — r23 F3, Commit Composer) | String | — | `features/scm` (Composer; fotografia de undo antes) | **G** · W |
| `git_lane_commit` | `root: String`, `branch: String`, `paths: Vec<String>`, `message: String` | `String` (commit noutro ramo sem checkout: índice temporário da ponta, o diff dos ficheiros contra o HEAD aplicado, `commit-tree` + `update-ref` com o valor antigo verificado; a árvore e o HEAD ficam; um diff que não aplica recusa — r23 F3, UI-SCM-11, experimental) | String | — | `features/scm` (Composer com as lanes ligadas) | **G** · W |
| `git_rebase` | `root: String`, `op: RebaseOp` (`plan {onto}` \| `run {onto, steps}`) | `gitx::RebasePlan` | String (o rebase é desfeito se parar) | — | `features/scm` (A4) | **G** · W |
| `git_amend` | `root: String`, `message: Option<String>`, `allow_published: Option<bool>` | `String` (o hash curto novo) | String (`published: …` se já está num remoto) | — | `features/scm` (A4) | **G** · W |
| `git_diff_range` | `root`, `base`, `target`, `path: Option<String>` | `String` (o diff de `base...target`) | String | — | `features/scm` (A10, revisão de ramos) | R |

## 9. Agente / arquitectura — `commands/agent.rs` (16)

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
| `arch_conformance` | `root: String` | `Option<Vec<Violation {rule, message, path, line}>>` (o repositório contra `.dxtutor/architecture.toml`: bibliotecas proibidas/não aprovadas, dependências entre camadas, nomes; menos o que um ADR aceite desculpa — RF-A05) | String | — | `features/panel` (Problems, com a fonte «arquitectura»); `platform/tauri/project.ts` (o drift das regras por issue no painel da issue, RF-A05) | R |
| `arch_rules_load` | `root: String` | `RulesDoc {exists, rules, error, canEdit, note}` (`.dxtutor/architecture.toml` como formulário para o Studio e se quem está ao teclado o pode alterar — F5.2/F5.7) | — | — | `features/arch` (painel «Rules») | R · X (`git config`) |
| `arch_rules_save` | `root: String`, `rules: Rules` | `RulesDoc` (validadas por `conformance::validate`; só o Arquitecto quando o `team.json` nomeia pessoas) | String | — | `features/arch` | **W** (só `.dxtutor/architecture.toml`) |
| `adr_list` | `root: String` | `Vec<Adr {path, id, title, status, accepted}>` (`docs/adr/`, `docs/decisions/`, `docs/architecture/ADR*`) | — | — | `features/arch` | R |
| `adr_accept` | `root: String`, `path: String` | `Adr` (o estado passa a aceite e fica escrito quem aprovou; só o Arquitecto — F5.5) | String | — | `features/arch` | **W** (só o ADR) · X (`git config`) |
| `arch_rules_commit` | `root: String`, `paths: Vec<String>`, `message: String` | `String` (hash curto; `git commit --only` do ficheiro de regras, dos ADR e dos templates de prompt `.dxtutor/prompts/*.md`, o resto preparado fica de fora; só o Arquitecto — só templates: também o Tech Lead (F4.4) —, com identidade git humana) | String | — | `features/arch`, `features/project` («Commit template») | **G** · X |

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

## 10b. Agente Co-Dev v2 — `commands/codev_agent.rs` (18)

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
| `codev_agent_start` | `root: String`, `model: Option<String>`, `effort: Option<String>`, `test_cmd: Option<String>`, `lint_cmd: Option<String>`, `mode: Option<String>`, `resume: Option<String>`, `provider: Option<String>`, `review_edits: Option<bool>`, `issue: Option<String>` (as alterações aceites ficam ligadas a esta issue do Project), `language: Option<String>` (a língua da interface, `en`/`ptAO`: o Co-Dev e os sub-agentes respondem nela; fica gravada com a sessão), `architecture: Option<bool>` (conjunto 9: sessão de arquitectura — o Studio aberto ou o primeiro pedido sobre arquitectura —, a única que leva `arch_propose`; fica gravada com a sessão, como o `issue` dá o `finish_issue`) | `String` (id da sessão) | String | — | `platform/tauri/codev-agent.ts` | **K** · S |
| `codev_agent_send` | `session_id: String`, `text: Option<String>` | `()` (via eventos) | — | `codev-agent://event` `{session,event}`, `codev-agent://approval` `{session,request:{call,reason,dangerous,suggestedRule}}`, `codev-agent://error` `{session,error}` | `platform/tauri/codev-agent.ts` | **N** · K · **W** · **X** · S · E |
| `codev_agent_approve` | `session_id: String`, `tool_use_id: String`, `allow: bool`, `reason: Option<String>`, `remember: Option<bool>` | `bool` | — | — | `platform/tauri/codev-agent.ts` | S · W (`remember` grava `.dxtutor/permissions.json`) |
| `codev_agent_review` | `session_id: String`, `call: String`, `decisions: Vec<{hunk: String, accept: bool, reason?: String}>` | `()` | String | — | `platform/tauri/codev-agent.ts` | S · **W** (escreve só os hunks aceites) |
| `codev_agent_override` | `session_id: String`, `call: String`, `adr: String` | `()` (o override do Arquitecto a uma alteração em revisão que viola as regras: só com o papel Arquitecto e um ADR aceite; fica no registo de auditoria; depois disso os hunks podem ser aceites — RF-A03/A04) | String | — | `platform/tauri/codev-agent.ts` | S · X (`git config`) |
| `codev_agent_set_mode` | `session_id: String`, `mode: String` | `bool` | — | — | `platform/tauri/codev-agent.ts` | S |
| `codev_agent_sessions` | `root: String` | `Vec<session::SessionSummary>` | — | — | `platform/tauri/codev-agent.ts` | R |
| `codev_agent_live` | — | `Vec<LiveSession {id, root, model, issue, busy, opened}>` (as sessões abertas nesta execução da app, para o mapa de agentes; os sub-agentes de cada uma chegam no `codev-agent://event` como `{kind: "subagent", call, step}`) | — | — | `platform/tauri/codev-agent.ts` | R |
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

## 11. Debug (DAP) — `commands/debug_cmds.rs` (34)

> **Etapa 3:** extraídos de `lib.rs` para `commands/debug_cmds.rs` (adaptadores finos)
> sobre o caso de uso Tauri-free `debug` — grupo de **passagens** (o motor gdb/MI já era
> Tauri-free; a fatia ganhou a fachada `capabilities()`). Nomes/args/serde/mensagens
> preservados; A1 mantém-se em 133.

Motor de depuração; os que precisam de sessão usam `State<DebugSessions>`. Consumidos pela
`ui-app` desde a R4 do ADR-0006 (`features/debug/infrastructure/tauri.ts`): o pane Run and
Debug corre sessões reais pelo gdb. `debug_launch`/`debug_run`/`debug_continue`/`debug_step`
são `async` (esperam pelo gdb; síncronos congelavam a thread principal).

**A7 (docs/v2/UI-AUDIT.md item 4):** com um adaptador DAP no PATH (lldb-dap), `debug_launch` abre uma
sessão DAP (`tutor_eval::dapc`, registo `State<DapSessions>`) e os mesmos comandos seguem por ela; sem
adaptador, o gdb/MI. Os nove novos (breakpoints com condição/contagem/logpoint, parar em panic, threads,
variáveis com diff, watch, pause, breakpoints guardados, snapshot) — a saída do programa chega pelo evento
`debug://output` `{id, category, text}`.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `debug_capabilities` | — | `dap::DebugCapability` (+ `timeTravel {available, reason, perfEventParanoid, error}`, r23 F2; F2b: uma gravação de teste do rr decide o `rr-cannot-record`) | — | — | `features/debug` (r23 F2: uma vez por sessão, esconde o que não há) | R |
| `debug_available` | — | `bool` | — | `features/debug` | — | R |
| `debug_launch` | `id: String`, `program: String`, `cwd: Option<String>`, `engine: Option<String>` (`"gdb"` força o gdb), `args: Option<Vec<String>>` (r23 F2: `--exact <teste> --nocapture`) | `LaunchInfo {engine, adapter, caps}` (`caps`: `dapc::SessionCaps` do `initialize`, r23 F2) | String | — | `features/debug` | **X** · S |
| `debug_break` | `id: String`, `file: String`, `line: u32` | `u32` | String | — | `features/debug` | S |
| `debug_run` | `id: String` | `debug::Stop` | String | — | `features/debug` | X · S |
| `debug_continue` | `id: String` | `debug::Stop` | String | — | `features/debug` | X · S |
| `debug_step` | `id: String`, `into: bool`, `kind: Option<String>` (`"out"`, DAP) | `debug::Stop` | String | — | `features/debug` | X · S |
| `debug_locals` | `id: String` | `Vec<debug::Var>` | String | — | `features/debug` | R · S |
| `debug_stack` | `id: String`, `thread: Option<i64>` (DAP) | `Vec<debug::Frame>` | String | — | `features/debug` | R · S |
| `debug_stop` | `id: String` | `()` | String | — | `features/debug` | S |
| `debug_set_breakpoints` | `id: String`, `file: String`, `breakpoints: Vec<BreakpointSpec {line, condition?, hitCondition?, logMessage?}>` | `Vec<dapc::BreakpointState>` | String | — | `features/debug` (A7) | S |
| `debug_stop_on_panic` | `id: String`, `on: bool` | `bool` (o adaptador encontrou `rust_panic`) | String | — | `features/debug` (A7) | S |
| `debug_threads` | `id: String` | `Vec<dapc::DapThread>` | String | — | `features/debug` (A7) | R · S |
| `debug_variables` | `id: String`, `frame: u32`, `reference: Option<i64>` | `Vec<dapc::VarNode>` (com `changed` desde a paragem anterior) | String | — | `features/debug` (A7) | R · S |
| `debug_evaluate` | `id: String`, `expression: String`, `frame: u32`, `context: Option<String>` (`watch`\|`repl`\|`hover`, r23 F2) | `dapc::VarNode` | String | — | `features/debug` (A7) | R · S |
| `debug_pause` | `id: String` | `()` | String | — | `features/debug` (A7) | S |
| `debug_run_to` | `id`, `file`, `line: u32` | `debug::Stop` (breakpoint temporário + continue; sai onde quer que pare) | String | — | `features/debug` (r23 F2) | X · S |
| `debug_restart_frame` | `id`, `frame: u32` | `debug::Stop` (só com `supportsRestartFrame`; o lldb-dap não o tem) | String | — | `features/debug` (r23 F2) | X · S |
| `debug_data_breakpoints` | `id`, `add: Option<DataTarget {frame, reference?, name, accessType?}>`, `remove: Option<String>` (dataId) | `Vec<dapc::DataBreakpoint>` (`dataBreakpointInfo` + `setDataBreakpoints`) | String | — | `features/debug` (r23 F2) | S |
| `debug_read_memory` | `id`, `memoryReference`, `offset: i64`, `count: u32` (≤ 4096) | `dapc::MemoryBlock {address, bytes, unreadable}` | String | — | `features/debug` (r23 F2) | R · S |
| `debug_exception_filters` | `id`, `filters: Vec<String>` | `Vec<String>` (os filtros postos: só os que o adaptador oferece) | String | — | `features/debug` (r23 F2) | S |
| `debug_test_targets` | `root: String` | `Vec<testbins::TestBinary {target, kind, executable, cwd, tests}>` (`cargo test --no-run --message-format=json` + `--list`) | String | — | `features/debug` (r23 F2: «Debug Test…») | X |
| `debug_record` | `id`, `program`, `args: Option<Vec<String>>`, `cwd` | `rr::Recording {trace, program, exitCode, output}` (`rr record --bind-to-cpu=<núcleo P>`; guarda as 5 últimas) | String | — | `features/debug` (r23 F2b) | X |
| `debug_replay` | `id`, `trace`, `program`, `cwd` | `LaunchInfo` (`rr replay -s 0` + `gdb -i dap -x <rr gdbinit>`; `caps.stepBack`) | String | `debug://output` | `features/debug` (r23 F2b) | X · S |
| `debug_reverse` | `id`, `kind` (`next`\|`step`\|`out`\|`continue`) | `debug::Stop` (`reverse-*` do gdb) | String | — | `features/debug` (r23 F2b) | S |
| `debug_position` | `id` | `dapc::Position {event, ticks, startEvent, startTicks, endEvent, endTicks}` (`when`/`when-ticks` do rr) | String | — | `features/debug` (r23 F2b) | R · S |
| `debug_travel` | `id`, `event: u64`, `ticks: u64`, `file`, `line` (file vazio: início/fim), `watch: Option<String>` (uma escrita: viaja pelo watchpoint, que pára a meio da linha) | `debug::Stop` (breakpoint temporário, para trás ou para a frente até o momento (evento, ticks) bater: os ticks são por thread) | String | — | `features/debug` (r23 F2b) | S |
| `debug_last_write` | `id`, `frame: u32`, `expression` | `debug::Stop` (`watch -l` + `reverse-continue`; `description` = o valor) | String | — | `features/debug` (r23 F2b) | S |
| `debug_writes` | `id`, `frame: u32`, `expression`, `max: Option<usize>` | `Vec<dapc::WriteHit {event, ticks, location, func, file, line, values}>` (cada mudança enquanto a função corre) | String | — | `features/debug` (r23 F2b) | S |
| `debug_snapshot` | `root`, `id`, `issue: Option<String>`, `title`, `markdown` | `()` (artefacto na base do projecto, ligado à issue) | String | — | `features/debug` (A7) | W |
| `breakpoints_load` | `root: String` | `Vec<project::breakpoints::Breakpoint>` | String | — | `features/debug` (A7) | R |
| `breakpoints_save` | `root`, `file`, `breakpoints: Vec<Breakpoint>` | `()` | String | — | `features/debug` (A7) | W |
| `debug_attach_targets` | `target: attach::Target {kind: local\|docker\|podman\|kubectl, name, context, namespace, kubeconfig}` | `attach::Targets` (contentores/pods, ou processos e o adaptador que lá existe) | String | — | `features/debug` (A10) | **X** · R |
| `debug_attach` | `id`, `target`, `pid: u32`, `adapter: Option<String>`, `root`, `remote_root` (sourceMap) | `LaunchInfo` (o adaptador corre onde o processo corre: `docker exec -i … lldb-dap`) | String | `debug://output` | `features/debug` (A10) | **X** · S |

## 16c. Protecção de dados — `commands/protect.rs` (5)

r23 F4a (docs/v2/AUDIT-r23.md §4.4, X02/X03): adaptadores finos sobre `tutor_protect` (crate sem Tauri). Todo o
pedido a um modelo sai filtrado (`tutor_protect::redact::guard_*`, no `tutor-llm`, no `tutor-agent` e no `llm.rs`); a
contagem chega pelo evento `protect://redacted` `{origin, count, total}`. O secret scan corre antes de CADA commit
que a app faz (o `exec` de um `git commit`, o merge/Composer/lanes do `gitwork`, `git::commit`, as regras de
arquitectura e o bash do agente): bloqueado, devolve `SECRET_SCAN_BLOCKED:{relatório}` (pré-visualizações mascaradas).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `protect_learn` | `root: String` | `usize` (total já redigido) — os valores secretos dos `.env` da pasta passam a ser filtrados | String | — | `features/protect` (r23 F4a) | R |
| `secret_scan` | `root`, `scope: Option<String>` (`staged`\|`tracked`\|`working`\|`paths`), `paths: Option<Vec<String>>` | `scan::ScanReport {tool, files, findings[{file, line, rule, preview}]}` (gitleaks se instalado, senão as regras próprias) | String | — | `features/protect` (r23 F4a) | R |
| `secret_scan_allow` | `root`, `reason: String` (obrigatório) | `()` — o próximo commit nessa pasta passa (um, 2 min); a UI audita antes | String | — | `features/protect` (r23 F4a) | W |
| `protect_hook_plan` | `root: String` | `hook::HookPlan {path, state (`missing`\|`installed`\|`foreign`), content}` — onde o git procura o `pre-commit` (`rev-parse --git-path hooks`) e o texto que se escreveria | String (não é um repositório git) | — | `features/protect` (endurecimento r23) | R |
| `protect_hook_install` | `root: String` | `HookPlan` (`state: installed`) — escreve o hook (0755) que corre `dxt secret-scan --staged`; vai primeiro para o registo de auditoria (sem auditoria não instala); um hook que não é do dxtutor nunca é substituído | String | — | `features/protect` (endurecimento r23; a UI aprova antes) | W |

## 16d. Pipeline de IaC — `commands/iac.rs` (3)

r23 F4b (docs/v2/AUDIT-r23.md §4.4, P01/P02/P05): adaptadores finos sobre `tutor_eval::iac`, com as ferramentas
resolvidas no ambiente da shell de login. As regras vivem no módulo: uma etapa falhada bloqueia o apply, o apply
aplica o FICHEIRO do plano revisto (guardado em `app_local_data_dir/iac-plans/<sha256>.bin`, 0600, apagado ao fim de
um dia), e o estado sai só com endereços e ids. Os riscos aceites vêm da base do Project (§17, `iac_risk_*`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `iac_pipeline_run` | `root`, `dir` (relativo), `target: Option<String>` (um plano dirigido, para reverter um drift) | `PipelineRun {id (sha256 do plano), tool, dir, target, stages[{id, status (ok\|failed\|not_installed\|not_connected\|skipped), summary, detail, hint, command, findings[{source, rule, file, line, severity, message, resource, key, accepted}], ms}], plan: IacPlan (módulos, motivo do replace, raio de impacto, write-only, custo), blocked, blockers, notes}` — init, fmt, validate, regras internas, tflint, checkov, trivy, segredos no estado, plan, drift, conftest, infracost | String | `iac://stage` `{root, dir, stage}` (ao começar e ao acabar cada etapa) | `features/ops` (r23 F4b) | X (`tofu`/`terraform`, os scanners) · **W** (o ficheiro do plano nos dados da app) |
| `iac_apply_command` | `root`, `dir`, `planId` | `ApplyInfo {command, planFile, tool, dir, destroy}` — o comando exacto `… apply -input=false <plano>`; recusado (Err) se a corrida bloqueou, se o ficheiro não é o revisto, se a configuração mudou depois ou se tem mais de um dia | String | — | `features/ops` (aprovação → terminal → auditoria com o resultado) | R |
| `iac_state` | `root`, `dir` | `IacState {ok, tool, dir, backend, serial, lineage, resources[{address, kind, mode, module, id, sensitive (nomes, nunca valores)}], lock {id, who, operation, created}, lockReadable, backupSerial, notes}` (`state pull`; o lock e a cópia só no backend local) | String | — | `features/ops` (separador Estado) | X (`state pull`, `init` se o pedir) |

## 23. Under the hood real — `commands/hood.rs` (3)

A8 (docs/v2/UI-AUDIT.md item 7): passagens directas para `tutor_eval::hood`, num worker bloqueante. Com os
já existentes `compile_pipeline`, `run_measured` e `trace_execution` (secção dos missions), alimentam o
separador «Under the hood (real)» e o «Execution trace» (`features/hood`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `hood_line_asm` | `code: String`, `release: bool` | `hood::LineAsm` (por linha do `main.rs`: funções e instruções; `rustc -C debuginfo=2` + `objdump -d -l`) | String | — | `features/hood` (A8) | **X** |
| `hood_python_bytecode` | `code: String` | `hood::Bytecode` (por linha e por função: as operações do `dis`) | String | — | `features/hood` (A8) | **X** |
| `measure_growth` | `code: String`, `sizes: Vec<u64>` | `hood::Growth` (tempo por N, linha de base descontada, classe de complexidade, R², confiança) | String | — | `features/hood` (A8) | **X** |

## 24. DevOps em só leitura — `commands/ops.rs` (6)

A9 (docs/v2/UI-AUDIT.md item 10): passagens directas para `tutor_eval::ops`, num worker bloqueante. Nada
muda infraestrutura: aplicar, fazer rollback, escalar ou apagar são comandos que o humano aprova e corre
num terminal (`features/ops` mostra-os por extenso).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `ops_iac_dirs` | `root: String` | `Vec<String>` (pastas com `.tf`) | String | — | `features/ops` (A9) | R |
| `ops_iac_plan` | `root`, `dir`, `refresh_only: bool` | `ops::IacPlan` (diff por recurso/atributo, drift, o comando de apply) | String | — | `features/ops` (A9) | **X** · R |
| `ops_kube_state` | `context`, `namespace`, `kubeconfig: Option<String>` | `ops::KubeState` (pods, serviços, deployments, eventos) | String | — | `features/ops` (A9) | **X** · R |
| `ops_kube_history` | `context`, `namespace`, `deployment`, `kubeconfig: Option<String>` | `Vec<ops::Revision>` | String | — | `features/ops` (A9) | **X** · R |
| `ops_cloud_status` | — | `Vec<ops::CloudCli>` (aws/gcloud/az: instalado, versão, perfil local) | String | — | `features/ops` (A9) | **X** · R |
| `ops_cloud_inventory` | `provider: String` | `ops::CloudInventory` (recursos e os comandos só de leitura corridos) | String | — | `features/ops` (A9) | **X** · R |

## 25. Base de código — `commands/codebase.rs` (2)

A10 (docs/v2/UI-AUDIT.md §3): passagens directas, só leitura (`features/codebase`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `deps_report` | `root: String`, `online: bool` | `deps::DepsReport` (por ecossistema: desactualizadas — compatível/última/salto/directa — e vulnerabilidades/avisos; os comandos corridos) | String | — | `features/codebase` (A10) | **X** · R |
| `onboard_map` | `root: String` | `onboard::OnboardMap` (linguagens, pontos de entrada com o comando para correr, docs, ficheiros mais mexidos, pessoas, módulos) | String | — | `features/codebase` (A10) | R |

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

## 15. LSP — `lsp.rs` (18)

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
sem servidor, ou se ele não formatar, fica o «Format Document» do dxtutor) e `lsp_document_symbols`
(Ctrl+Shift+O / Go → Go to Symbol…, e o Outline das linguagens que o `file_outline` não cobre) e
`lsp_workspace_symbols` (Ctrl+T / «Go to Symbol in Workspace…»: pergunta a cada servidor já a
correr na pasta) e `lsp_prepare_type_hierarchy` + `lsp_type_hierarchy` (Shift+Alt+T / «Show Type
Hierarchy»: supertipos e subtipos; `supported: false` quando o servidor não a anuncia).

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
| `lsp_document_symbols` | `path: String` | `Value` (DocumentSymbol[] \| SymbolInformation[] \| null) | String | — | `features/lsp` | R · S |
| `lsp_workspace_symbols` | `root: String`, `query: String` | `Value` (`[{ language, result: SymbolInformation[] \| WorkspaceSymbol[] }]`) | String | — | `features/lsp` | R · S |
| `lsp_prepare_type_hierarchy` | `path: String`, `line: u32`, `character: u32` | `Value` (`{ supported, items: TypeHierarchyItem[] }` \| null) | String | — | `features/lsp` | R · S |
| `lsp_type_hierarchy` | `path: String`, `item: Value`, `direction: String` (`supertypes` \| `subtypes`) | `Value` (TypeHierarchyItem[] \| null) | String | — | `features/lsp` | R · S |
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
| `pty_spawn` | `id: String`, `rows: u16`, `cols: u16`, `cwd: Option<String>`, `shell: Option<String>`, `command: Option<String>`, `env: Option<HashMap<String,String>>`, `vault: Option<PtyVault {addr, namespace?, lease?}>` (r23 F4c: o backend põe o token e as credenciais do lease no ambiente; revoga o lease no fim) | `()` | String | `pty://data`, `pty://exit`, `vault://lease-revoked` | `features/panel` | **X** · S · E |
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

## 16e. Vault — `commands/vault.rs` (10)

r23 F4c (docs/v2/AUDIT-r23.md §4.4, K01–K05): adaptadores finos sobre `tutor_platform::vault` (crate sem Tauri),
com o token no keychain do sistema (`tutor_platform::keychain`, crate `keyring`: Secret Service no Linux). **Nenhum
comando devolve o token.** Um caminho KV diz o ambiente por um segmento (`…/local/…`, `…/staging/…`,
`…/production/…`); os valores de staging/produção nunca saem do Vault (recusado no Rust). O `pty_spawn` ganhou
`vault: {addr, namespace?, lease?}`: o backend põe `VAULT_ADDR`/`VAULT_NAMESPACE`/`VAULT_TOKEN` (e, com o lease,
`VAULT_DYN_*`) no ambiente do terminal e revoga o lease quando ele acaba (evento `vault://lease-revoked`).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `vault_status` | `addr`, `namespace?` | `Status {addr, namespace, reachable, initialized, sealed, version, signedIn, displayName, policies, ttl, renewable, notes, cli, keychain, keychainNote}` (`sys/health` + `auth/token/lookup-self` com o token do keychain) | String | — | `features/vault` | R |
| `vault_login_token` | `addr`, `namespace?`, `token` | `Status` — o token colado é verificado no Vault e vai para o keychain; nunca volta | String | — | `features/vault` | **W** (keychain) |
| `vault_login_oidc` | `addr`, `namespace?`, `mount?` (`oidc`), `role` | `Status` — `auth_url` → o browser abre (no Rust) → volta a `127.0.0.1:8250/oidc/callback` → `callback` → token no keychain (espera até 3 min) | String | — | `features/vault` | **W** (keychain) · X (browser) |
| `vault_renew` | `addr`, `namespace?` | `Status` (`renew-self`) | String | — | `features/vault` | **W** |
| `vault_revoke` | `addr`, `namespace?` | `Status` — `revoke-self` e o token sai do keychain (mesmo sem Vault) | String | — | `features/vault` | **W** |
| `vault_kv_meta` | `addr`, `namespace?`, `mount`, `path` | `KvMeta {mount, path, env, exists, currentVersion, versions[], created, updated, customMetadata, keys (só local), children}` — nunca valores | String | — | `features/vault` | R |
| `vault_reveal_local` | `root`, `addr`, `namespace?`, `mount`, `path`, `key`, `reason?` | `Reveal {id, path, key, ttlMs: 20000}` — só `local` (recusado no Rust), auditado ANTES (`vault` · `reveal-local`); o valor entra na redacção | String | — | `features/vault` | R · **W** (auditoria) |
| `vault_reveal_read` | `id` | `String` (o valor, durante 20 s; depois Err) | String | — | `features/vault` | R |
| `vault_dynamic` | `root`, `addr`, `namespace?`, `mount`, `role`, `reason?` | `Lease {leaseId, ttl, renewable, fields, env}` (`<mount>/creds/<role>`) — os valores ficam no backend até um terminal os levar; auditado antes | String | — | `features/vault` | **W** · S |
| `vault_lease_revoke` | `root`, `addr`, `namespace?`, `lease` | `()` (`sys/leases/revoke`, auditado) | String | — | `features/vault` | **W** |

## 16f. Deploy guiado — `commands/deploy.rs` (2)

r23 F4c2 (docs/v2/AUDIT-r23.md §4.4, D01–D04): adaptadores finos sobre `tutor_platform::deploy`. A regra vive lá: uma
verificação falhada bloqueia sempre; em produção, «not installed»/«not connected» também, salvo excepção com motivo;
o rollout verifica outra vez (excepções, HEAD, manifestos, idade ≤ 30 min). Os `Secret` dos manifestos NÃO são
aplicados (o cluster lê-os do Vault pelo Vault Secrets Operator). O segundo aprovador da produção é um PR fundido com
o commit, aprovado por outra pessoa (`gh`). Configuração opcional em `.dxtutor/deploy.json` (manifestos, pasta de IaC e
caminho do Vault por ambiente, política do cosign, janelas de mudança).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `deploy_plan` | `root`, `target: TargetArg {env (staging\|production), context, namespace, kubeconfig?, stagingContext?, stagingNamespace?, vaultAddr?, vaultNamespace?, kvMount?}` | `DeployPlan {id, env, context, namespace, version, subject, issue, identity {git, cluster, vault}, manifests, deployments, images, secretsFromVault, gates[{id, status (ok\|failed\|not_installed\|not_connected\|skipped), summary, detail, hint}], strategy, blockers, waivable, commands, approver}` — verificações: version, sbom (syft), signature (cosign), vulns (trivy/grype), secrets (nomes no namespace + metadados no Vault), secret-check («not available»), drift (IaC), admission (`apply --dry-run=server`), slo, window, migrations, staging e approver (produção) | String | — | `features/deploy` | X (`git`, `kubectl` só leitura, `gh`, scanners) |
| `deploy_rollout` | `root`, `planId`, `confirm?` (produção: `production`), `reason?` (produção: obrigatório), `waivers: [{gate, reason}]` | `DeployRecord` — auditado ANTES (`deploy` · `rollout`), o namespace, `kubectl apply -f -` sem os Secrets, a anotação da versão, `rollout status`; o registo na base do Project e a auditoria do resultado | String | `deploy://output` `{planId, line}` | `features/deploy` (aprovação partilhada) | **W** (cluster) · S |

## 16g. Runbooks e fontes de dados — `commands/runbook.rs` (5)

r23 F5a (docs/v2/AUDIT-r23.md §4.5, RF-BK-R01–R03, Q03): adaptadores finos sobre `tutor_platform::runbook`/`policy`/
`sources`. Gramática de `runbooks/*.md`: `## n. título [check|action|decision]`, um bloco de comando, `expect:` (entre
crases ou `/regex/` verifica-se contra a saída; prosa julga-a a pessoa). A regra vive no crate: um `check` só corre se
cada comando for só de leitura (o classificador do agente + os verbos de leitura das ferramentas de infra; nada de
`>` nem de verbos que leiam segredos) — senão `not_read_only`; uma `action` só com aprovação (auditada aqui, antes) e
com o ambiente do Vault só para esse passo; uma `decision` regista palavras, não corre nada.

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `runbook_list` | `root` | `Vec<Runbook {path, title, about, schedule, steps[{n, title, kind, command, expect, refused}], problems}>` | — | — | `features/ops` | R |
| `runbook_parse` | `root`, `path` (só `runbooks/…md`) | `Runbook` | String | — | `features/ops` | R |
| `runbook_step` | `root`, `path`, `n`, `runId`, `approval?: {reason}` (acção), `vault?: {addr, namespace?}` (acção) | `RunbookStepRun {id, runId, path, runbook, n, title, kind, command, exitCode, output (mascarada, ≤ 20 000), expect, matched, note, actor, at, ms}` — guardado (migração 12) | String (`not_read_only: …`, «an action runs only with an approval») | — | `features/ops` | X · **W** (acção) · S |
| `runbook_decide` | `root`, `path`, `n`, `runId`, `note` | `RunbookStepRun` (uma decisão, auditada) | String | — | `features/ops` | **W** (registo) |
| `sources_status` | `root` | `Vec<Source {kind (cicd\|cost\|obs\|cloud), connected, via, notes, hint}>` — CI/CD pelo `gh` (só leitura); o resto «not connected» | String | — | `features/ops` | R |

## 16h. A actividade Platform — `commands/platform.rs` (11)

r23 F5b (docs/v2/AUDIT-r23.md §4.5, RF-BK-Q01/Q02, UI-PLAT-09/11/12): adaptadores finos sobre `tutor_platform::queue`/
`review` e `tutor_board::project::incidents` (migração 13: `incidents`, `incident_events`, `queue_events`). Quem e quando
decide-os o backend; o que muda alguma coisa vai primeiro ao registo de auditoria. Decisão do dono (§5 Q9): os
incidentes são registos locais; o on-call e os alertas ficam «not connected».

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `queue_items` | `root` | `Queue {me {name, email, gh}, items[{id, kind (review\|iac\|recurring\|incident\|deploy), title, why, action, arg, line, done, proof}], done[], team[], measured[[chave, valor]], missing[]}` — itens do estado real (revisões pedidas pelo `gh` + CODEOWNERS, achados de IaC bloqueantes em `.tf` que a pessoa mudou, runbooks com `schedule:` em atraso, incidentes que comanda, o seu último deploy falhado); sem os verificados nem os passados | String | — | `features/ops` (Platform) | R · X (`git`, `gh`) |
| `queue_verify` | `root`, `id`, `title` | `{done, proof}` — verifica contra o estado real agora; feito só se passar (gravado com a prova) | String | — | `features/ops` | R · **W** (registo) |
| `queue_handover` | `root`, `id`, `title`, `recipient`, `reason` (obrigatórios) | `i64` — passa o item (vista Team), auditado | String | — | `features/ops` | **W** · S |
| `pr_infra_review` | `root`, `pr: u64` | `PrReview {number, title, url, author, head, base, headSha, files, diff (mascarado), checks[{id, status (ok\|failed\|pending\|not_installed\|not_connected\|skipped), summary, source}], failing}` — ci (`statusCheckRollup`), plan/policy/cost (o pipeline de IaC numa worktree temporária da cabeça do PR), window, rollback, incidents (locais), capacity/error-budget/on-call («not connected») | String | — | `features/ops` | R · X (`gh`, `git fetch`/`worktree`, `tofu`) |
| `pr_review_submit` | `root`, `pr`, `decision` (approve\|request-changes\|comment), `body`, `reason?` | `String` (saída do `gh pr review`) — recusa um PR não revisto aqui ou que mudou; aprovar com verificações a falhar exige motivo (vai para o PR); auditado antes e com o resultado | String | — | `features/ops` | **W** (PR) · S |
| `incident_open` | `root`, `title`, `severity` (SEV-1…4) | `Incident {id, key (INC-n), title, severity, status, commander, openedAt, mitigatedAt, resolvedAt}` (auditado) | String | — | `features/ops` | **W** · S |
| `incident_list` | `root` | `Vec<Incident>` | String | — | `features/ops` | R |
| `incident_get` | `root`, `id` | `IncidentView {incident, events[{kind, text, reason, actor, at}], confidence {level, reasons} (nunca acima de «low» sem fonte de métricas), precision (certas, julgadas)}` | String | — | `features/ops` | R |
| `incident_add` | `root`, `id`, `kind` (evidence\|checked\|not-checked\|note), `text`, `reason?` (obrigatório em not-checked) | `()` | String | — | `features/ops` | **W** |
| `incident_status` | `root`, `id`, `status` (mitigated\|resolved\|investigating), `note` (resolver exige o resumo) | `Incident` (auditado) | String | — | `features/ops` | **W** · S |
| `incident_feedback` | `root`, `id`, `right: bool` | `()` — uma vez, depois de mitigado: mede a precisão do Co-Dev | String | — | `features/ops` | **W** |

## 17. Project (SQLite) e quadro Tasks — `board.rs` (20)

Project (docs/v2/UI-AUDIT.md, item 5; fase A5): Kanban, Scrum, XP ou Scrum + XP sobre o store
`tutor_board::project` (`app_local_data_dir/board.sqlite3`, tabela `schema_version` e migrações só
para a frente; a migração 1 importa o Board antigo que lá estivesse). O quadro da actividade Tasks
(ADR-0006, R3b) continua com `board_load`/`board_save`, mas num ficheiro próprio
(`app_local_data_dir/tasks.sqlite3`): o `sprints` do Project tem outro esquema. Sem pasta (`root`
vazio ou ausente) recusam — já não há backlog `"default"`. A Q3 decidiu juntá-los no Project; os dois
coexistem até à fase 5, que retira o `tasks.sqlite3` e estes dois comandos. As regras de fluxo (um passo, WIP, DoR, DoD, bloqueio) são verificadas no store, numa
transacção por operação; uma regra só se ultrapassa com motivo, registado na actividade. Erros:
`ProjectError {code, message, overridable}`. Quem age = `git config user.name` do projecto (ou o
utilizador do SO).

| Comando | Args | Retorno | Erro | Evento | Consumidor UI | Política |
|---|---|---|---|---|---|---|
| `board_load` | `root: Option<String>` | `Option<Backlog>` | String | — | `features/board` | R · S |
| `board_save` | `root: Option<String>`, `backlog: Backlog` | `()` | String | — | `features/board` | **W** · S |
| `project_load` | `root: String` | `Project` | `ProjectError` | — | `platform/tauri/project.ts` | R · **W** (cria o projecto vazio no 1.º uso) · S |
| `project_apply` | `root: String`, `op: Op` (`{op: "create_issue" \| "move" \| "settings" \| …}`) | `Project` | `ProjectError` | — | `platform/tauri/project.ts` | **W** · S |
| `project_issue` | `root: String`, `key: String` | `IssueDetail {activity, changeSets, reports, usage}` (`usage`: turnos, sessões, modelos, tokens e custo do Co-Dev na issue, somados do registo de auditoria — RF-B08/T04) | `ProjectError` | — | `platform/tauri/project.ts` | R |
| `project_change_sets` | `root: String` | `Vec<ChangeSetGroup {issueKey, title, rows}>` (os change sets do Co-Dev aceites depois do commit do `HEAD`, agrupados por issue — RF-E08) | `ProjectError` | — | `features/scm` (secção «Co-Dev change sets» do Source Control) | R · X (`git log -1`) |
| `project_reports` | `root: String` | `Reports` (cycle time, throughput, CFD, burndown, velocity — do histórico) | `ProjectError` | — | `platform/tauri/project.ts` | R |
| `project_audit` | `root: String`, `issue: Option<String>` | `Vec<AuditEntry>` (cada decisão do Co-Dev sobre uma acção, mudança de modo e turno: origem, quem pediu, modo, ferramenta, ficheiro/linhas, comando, veredicto, quem decidiu e quando, modelo, tokens; segredos mascarados — RF-T01/T05) | `ProjectError` | — | `platform/tauri/project.ts` («Export audit log» no painel da issue) | R |
| `audit_record` | `root: String`, `entry: IdeAudit {feature, action, command, scope?, approved, reason?, outcome? (sent\|ok\|failed), decidedAt?}` | `()` (uma linha no mesmo registo do `project_audit`, com origem `ide`: o backend decide quem (`git config user.name`) e quando, e mascara os segredos do `.env` e os padrões conhecidos no comando, no âmbito e no motivo — r23 F1, RF-BK-L01) | `ProjectError` (`invalid`: feature/action fora de `[a-z0-9._-]`, comando vazio ou > 8 KiB, resultado desconhecido) | — | `platform/tauri/audit.ts` (as aprovações do `app/approval.ts`: Ops) | **W** · S |
| `test_results_record` | `root: String`, `run: NewTestRun {runner, command, passed, failed, ignored?}` | `bool` (`false` sem commit: nada gravado; o commit é o HEAD e `dirty` se a árvore tinha alterações — decididos no backend — r23 F3, UI-SCM-09) | `ProjectError` | — | `features/testing` (depois de cada corrida, desktop) | **W** · S |
| `test_results_for` | `root: String`, `shas: Vec<String>` (hashes ou prefixos de 7+) | `Vec<TestResult {sha, dirty, at, runner, command, passed, failed, ignored, ok}>` (da mais recente) | `ProjectError` | — | `features/scm` (ciclo de vida do commit) | R |
| `iac_risk_accept` | `root`, `key`, `kind` (`finding`\|`drift`), `label`, `reason` (obrigatório) | `AcceptedRisk {id, key, kind, label, reason, actor, at, expires}` — guardado 30 dias (migração 10, `iac_accepted`); vai primeiro para o registo de auditoria (`iac` · `risk.accept`/`drift.ignore`): sem auditoria não se guarda — r23 F4b, P03/P04 | `ProjectError` | — | `features/ops` (Segurança e política, Drift) | **W** · S |
| `iac_risks` | `root` | `Vec<AcceptedRisk>` (as que ainda valem) | `ProjectError` | — | `features/ops` | R |
| `iac_risk_revoke` | `root`, `id: i64` | `bool` (expira-a agora, auditado: o pipeline volta a bloquear nela) | `ProjectError` | — | `features/ops` | **W** · S |
| `deploy_records` | `root`, `shas: Option<Vec<String>>` (7+) | `Vec<DeployRecord {id, env, context, namespace, version, issue, actor, approver, at, ok, failedStep, waivers (JSON), gates (JSON), reason}>` (migração 11, `deploys`; da mais recente) — r23 F4c2, D04 | `ProjectError` | — | `features/deploy` (histórico), `features/scm` (ciclo de vida: «environments») | R |
| `runbook_judge` | `root`, `id`, `matched: bool`, `note` | `bool` (o juízo da pessoa sobre um resultado com expectativa em prosa) — r23 F5a | `ProjectError` | — | `features/ops` | **W** · S |
| `runbook_runs` | `root`, `path: Option<String>` | `Vec<RunbookStepRun>` (últimos 90 dias) | `ProjectError` | — | `features/ops` | R |
| `audit_export_evidence` | `root`, `from?`, `to?` (ms; por omissão o mês corrente) | `EvidenceFile {path, content}` — escreve `docs/audit/evidence-AAAA-MM.md` DENTRO do projecto (`workspace::write`), a partir das linhas reais do registo de auditoria (origem `ide`), dos registos de deploy e das execuções de runbooks, por controlo ISO/IEC 27001:2022 (A.8.32, A.8.9, A.5.17/A.8.12, A.8.13, A.5.24–A.5.27, e «não mapeadas»); a exportação vai ao registo — r23 F5a, RF-BK-A03 | `ProjectError` | — | `features/ops` | **W** (ficheiro no projecto) · S |
| `project_issue_prompt` | `root: String`, `key: String`, `lang: Option<String>` (`pt`/`en`; omisso = pelo texto da issue) | `Rendered {text, lang, source, version, tokens}` (o prompt exacto com que a issue vai ao Co-Dev: template do projecto em `.dxtutor/prompts/issue.{pt,en}.md` ou o embutido, versão do template, tokens estimados — RF-B03/B04) | `ProjectError` | — | `platform/tauri/project.ts` («Ver prompt» e «Work on it with Co-Dev») | R |
| `project_sprint_plan` | `root: String`, `sprint: Option<String>` (omisso = a activa, ou a próxima planeada), `codevs: Option<u32>` (1–8; omisso = o da sprint, ou 1) | `SprintPlan {sprint, codevs, lanes: [{codev, points, unestimated, issues: [{key, title, points, priority, wave, after, serialisedAfter, branchConflicts}]}], waves, leftOut: [{key, title, reason (`not_ready`\|`in_flow`\|`blocked_by_deps`\|`dep_cycle`\|`overlaps_in_flow`), missing, keys}], overlaps: [{a, b, paths, total, globs}], files}` (o plano paralelo da sprint: uma lane por Co-Dev, ondas pelas dependências, duas issues que podem mudar o mesmo ficheiro nunca na mesma onda; lê a pasta com o `.gitignore`, os change sets, os commits ligados, o ramo de cada issue e o `merge-tree` dos ramos com o HEAD — Multi Co-Dev, fase 1) | `ProjectError` (`invalid`: Co-Devs fora de 1–8; `not_found`: sem sprint) | — | `platform/tauri/project.ts` («Parallel plan» no Planning) | R |

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
| Comandos registados | **304** |
| Por ficheiro | `lib.rs` 0 · `commands/study.rs` 11 · `commands/missions.rs` 4 · `commands/review.rs` 3 · `commands/codeintel.rs` 10 · `commands/tests.rs` 8 · `commands/git.rs` 41 · `commands/codev.rs` 5 · `commands/codev_agent.rs` 18 · `commands/dictation.rs` 4 · `commands/search.rs` 4 · `commands/agent.rs` 16 · `commands/assistant.rs` 8 · `commands/debug_cmds.rs` 34 · `commands/hood.rs` 3 · `commands/ops.rs` 6 · `commands/codebase.rs` 2 · `commands/devcontainer.rs` 8 · `commands/sandbox.rs` 3 · `commands/pair.rs` 4 · `commands/plugins.rs` 3 · `bridge.rs` 16 · `fsops.rs` 10 · `lsp.rs` 18 · `pty.rs` 7 · `commands/panel.rs` 2 · `commands/protect.rs` 5 · `board.rs` 12 |
| Consumidos pela `ui-app` | **222** (`bridge.ts` 24 e `pair.ts` 4 — desde a U2 do ADR-0004 por clientes tipados de `platform/tauri/` (`shell`, `fs`, `git`, `providers`, `agent-tasks`, `app`, `pair`), sem `invoke` cru · `features/codev.ts` 3, com sobreposição · `platform/tauri/codev-agent.ts` 16 · `platform/tauri/dictation.ts` 4 · `platform/tauri/assistant.ts` 1 · `platform/tauri/learn.ts` 6 · `platform/tauri/extensions.ts` 2 · `features/panel` 8 · `platform/tauri/arch.ts` 7 · `features/lsp` 18 · `platform/tauri/project.ts` 4 · `features/testing` 3 da A6: `test_runners`/`test_run`/`test_history` · `features/scm` 8 da A4: `git_blame`/`git_history`/`git_show_path`/`git_compare`/`git_stash`/`git_worktree`/`git_rebase`/`git_amend` · `features/debug` 9 da A7 · `features/hood` 6 da A8: `hood_line_asm`/`hood_python_bytecode`/`measure_growth` e os já existentes `trace_execution`/`compile_pipeline`/`run_measured` · `features/ops` 6 da A9 · 5 da A10: `deps_report`/`onboard_map` (`features/codebase`), `git_diff_range` (`features/scm`), `debug_attach_targets`/`debug_attach` (`features/debug`) · `project_change_sets` (`features/scm`, RF-E08) · 5 do bloco 3: `arch_rules_load`/`arch_rules_save`/`adr_list`/`adr_accept`/`arch_rules_commit` (`platform/tauri/arch.ts`, F5.2/F5.5) · `audit_record` (`platform/tauri/audit.ts`, r23 F1) · `git_clone`/`git_clone_plan` (`features/welcome`, r23 F6) · `git_refs` (`features/scm`, r23 F3) · `git_hunks`/`git_stage_hunks` (`features/scm`, r23 F3) · `git_undo_*` (4: `features/scm`, r23 F3) · `git_predict_conflicts` (`features/scm`, r23 F3) · `git_merge`/`git_conflict_stages` (`features/scm`, r23 F3) · `git_sync_plan`/`git_sync` (`features/scm`, r23 F3) · `gh_status`/`gh_prs`/`gh_runs_for`/`gh_prs_for` (`features/scm`, r23 F3) · `test_results_record` (`features/testing`) e `test_results_for` (`features/scm`), r23 F3 · `git_commit_paths`/`git_lane_commit` (`features/scm`, r23 F3) · `protect_learn`/`secret_scan`/`secret_scan_allow` (`features/protect`, r23 F4a) e `protect_hook_plan`/`protect_hook_install` (`features/protect`, endurecimento r23) · `iac_pipeline_run`/`iac_apply_command`/`iac_state`/`iac_risks`/`iac_risk_accept`/`iac_risk_revoke` (`features/ops`, r23 F4b) · os 10 `vault_*` (`features/vault`, r23 F4c) · `deploy_plan`/`deploy_rollout` (`features/deploy`) e `deploy_records` (`features/deploy`, `features/scm`), r23 F4c2 · os 5 de `commands/runbook.rs` e `runbook_judge`/`runbook_runs`/`audit_export_evidence` (`features/ops`, r23 F5a) · os 11 de `commands/platform.rs` (`features/ops`, vista Platform, r23 F5b)) |
| Não consumidos pela `ui-app` | **82** |
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
