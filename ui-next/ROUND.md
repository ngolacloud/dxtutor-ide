# ROUND — fecho de lacunas ui-next ↔ protótipo navegável (3)

Data: 2026-11-15 · Fontes: `~/Downloads/dxtutor IDE — protótipo navegável(3).html`
(1,16 MB, 360 funções, 12 painéis), `desktop/ui-next/src/*` (20 módulos, ~3,3 k
linhas), `desktop/src-tauri/src/main.rs` (130 comandos registados), `desktop/src/shell/*`
(referência v7). Perfil do executor: **profissional Tauri desktop** (Rust + TS).

## Regras transversais (valem para TODAS as fases)

- **Zero demo é sagrado.** O protótipo simula quase tudo do lado do cliente; porta-se
  a CASCA ligada a um comando real do backend, nunca o conteúdo demo. Se uma peça não
  tiver backend real, o âmbito muda — parar e decidir antes de editar.
- **Um gate por superfície** em `scripts/selftest-next.sh`: passo de prova no
  `runSelftest` de `src/main.ts` + verificação python, à imagem dos gates
  `providers`/`team`. Gates host-tolerantes: SKIP explícito quando a ferramenta
  falta no host, nunca um falso verde.
- **Node via nvm**: `export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh` antes de `npx`.
- **Ciclo rápido** = `npx tsc --noEmit -p desktop/ui-next/tsconfig.json`; o
  selftest completo reconstrói vite + cargo sob xvfb (lento) — correr no fim.
- Assets Tauri são comprimidos — provar por comportamento, nunca por grep ao binário.
- Os nomes de comando Tauri são o nome da função (o prefixo de módulo no
  `invoke_handler`, p.ex. `board::board_load`, invoca-se como `board_load`).
- A arquitectura ui-next é: classe por superfície (`src/<nome>.ts`, padrão
  `Providers`/`Team`), botão `data-view` em `index.html`, ligação em `main.ts`
  (import, campo, construção, `showView`, paleta/menu), CSS por prefixo em
  `style.css`, tipos de wire em `tauri.ts`.
- **Skills do repo a carregar por fase** (`.claude/skills/` do dxtutor): F4 →
  `assistance-providers` (streaming/cancel/no-provider); F6 → `pedagogy-authoring`
  (contrato de honestidade do estudo); F7 → `editor-code-intelligence`
  (identidade de revisão buffer↔resultado); todas → `validation-release` ao
  preparar o fecho da fase.

## Estado actual (38 gates verdes)

explorer · search · scm+grafo · remote · debug(gdb) · explain · providers · equipa ·
editor Monaco (minimap/find nativos) · terminal(run_shell) · kill · Co-Dev sessões
worktree · LSP hover/definition · outline · review · welcome · palette · menu ·
tabs · **i18n pt-AO** · **temas (grafite/escuro/claro)** ·
**Definições (chaves save_key/keys_status + motor sandbox)** · **gitflow
(iniciar/finalizar com merge real)** · **diff por ficheiro (SCM → Monaco diff)** ·
**fileops (CRUD Explorer em disco+árvore)** · **testing (list_tests + run_test com
veredicto real do cargo)** · **statusbar rica (problemas/testes/blame/linguagem)** ·
**painel inferior Output·Co-Dev / Services (compose_ps ou erro honesto)** ·
**PTY interactivo (pty_spawn/pty_write; `read` respondido via stdin)** ·
**Co-Dev streaming (llm://token parciais + Stop que cancela + selector de modelo)** ·
**Quadro (user stories SQLite reais via board_load/board_save; nasce vazio)** ·
**Studio de arquitectura (arch_validate real + preview do scaffold sem escrever + gerar
backlog → stories reais no Quadro)** ·
**Percurso de aprendizagem (list_courses/get_course reais + pistas request_hint
offline-safe)** · **Gestor de missões (codev_session_list espelhado + missão isolada
agent_task_* com diff)** · **matriz de política Co-Dev (renderizada de codev_policy)**.

---

## Inventário de lacunas

### Tier 1 — superfícies inteiras COM backend real pronto

| # | Lacuna | Protótipo | Backend REAL registado | Ref. v7 | Fase |
|---|--------|-----------|------------------------|---------|------|
| 1 | Quadro (Board/kanban): backlog, sprints, executar sprint, issues | `openBoard`, `runSprint`, `genBacklogIssues` | `board_load`, `board_save` (crate tutor-board, SQLite) | `shell/board.ts` | F5 |
| 2 | GitFlow: iniciar feature/fix/release, finalizar ramo | `gfStart/gfFinish/gfGuide` | `git_branch`, `git_branches`, `git_checkout`, `git_create_branch`, `git_stage`, `git_unstage` + `exec` p/ merge | `shell/gitflow.ts` | F2 |
| 3 | Studio de arquitectura: desenho → validação → scaffold → backlog | `openStudio`, `validateDesign`, `genBacklog` | `arch_validate`, `arch_scaffold_preview`, `arch_scaffold` | `shell/studio.ts` | F5 |
| 4 | Testing (painel): árvore, correr um/todos | `pane-test`, `runTests` | `list_tests`, `run_test`, `run_tests`, `run_all_tests` | `shell/tests.ts` | F3 |
| 5 | Gestor de missões/sessões | `openManager`, `delegate`, `parkAgent` | `agent_task_submit/status/cancel`, `codev_session_list`, `agent_isolated_patch`, `llm_plan` | `shell/manager.ts` | F6 |
| 6 | Tutor / Learning Track: lições, quiz, pistas | `ltStart`, `lessonQuiz/Hint/Check` | `list_courses`, `get_course`, `get_study_guide`, `run_drill`, `submit_step`, `request_hint/plan/fix`, `study_policy` | `shell/learn.ts` | F6 |
| 7 | Definições + sandbox + chaves | `openSettings`, `setTheme`, `setLocale` | `get/save_providers_config`, `save_key`, `get/set_sandbox_engine` | `shell/sandbox.ts` | F1 |
| 8 | Matriz de política Co-Dev (aprovação por modo) | `MODES`, `cycleMode` | `codev_policy` | `shell/policyMatrix.ts` | F6 |

### Tier 2 — profundidade em superfícies existentes (backend real pronto)

| # | Lacuna | Backend REAL | Fase |
|---|--------|--------------|------|
| 9 | i18n pt-AO (ui-next é inglês hard-coded; protótipo e v7 são pt-AO) | client-side; modelo `shell/strings.ts` | F1 |
| 10 | Terminal PTY interactivo (hoje run_shell linha-a-linha) | `pty_spawn`, `pty_spawn_in_session`, `pty_write`, `pty_resize` | F4 |
| 11 | Chat streaming + cancelar + escolher modelo | `assistant_chat_stream`, `assistant_cancel`, `assistant_models` | F4 |
| 12 | LSP referências + rename | `lsp_references`, `lsp_rename`, `lsp_prepare_rename`, `resolve_references` | F7 |
| 13 | Explorer CRUD (novo/renomear/apagar — hoje zero) | `create_path`, `rename_path`, `delete_path`, `workspace_action` | F2 |
| 14 | Vista de diff (SCM → Monaco diff editor) | `git_diff`, `git_show`, `diff_lines` | F2 |
| 15 | Painel inferior: abas Output·Co-Dev / Services | log cliente + `compose_ps` | F3 |
| 16 | Statusbar rica: problemas, testes, blame, ctx, sino, linguagem | `git_log` (blame) + contagens já existentes | F3 |
| 17 | Temas (claro/escuro/grafite) | client-side (CSS vars) | F1 |
| 18 | Diagnostics no editor (squiggles; review só vive no painel) | `get_diagnostics`, `lsp_did_open/change` | F7 |

### Tier 3 — só-protótipo: DECISÃO DO DONO 2026-11-15 = **portar todos**

| # | Superfície | Situação | Decisão |
|---|-----------|----------|---------|
| 19 | Containers (pane runtime: imagens/containers) | `devcontainer_*`/`compose_ps` reais; o resto da pane via CLI do runtime (`exec`) — host tem delonix+docker | **portar → F8** |
| 20 | Infra/K8s (deploy, ambientes e promoção) | kubectl REAL no host via `exec` + manifests do scaffold do Studio | **portar → F11** |
| 21 | Extensions/VSIX | `vsix_manifest` existe (parse real de .vsix); motor de execução NÃO — âmbito mínimo honesto | **portar → F10** |
| 22 | Visualize Execution / Under the Hood | backend completo (`trace_execution`, `compile_pipeline`, `symbol_relations`); ordem expressa do dono dada | **portar → F9** |
| 23 | Conta · Observabilidade · «O que mudou e porquê» | tokens reais já em `ChatResp.inputTokens/outputTokens`; «o que mudou» = git real; Conta = keys/providers reais | **portar → F12** |

Ordem recomendada (prontidão de backend): F8 → F9 → F10 → F11 → F12. Cada fase é
uma sessão própria; zero-demo aplica-se igual — nada se simula, SKIP honesto
quando a ferramenta falta no host.

### Tier 4 — auditoria 2026-11-15 vs protótipo de Downloads (P1): DECISÃO DO DONO = **suprir as 3 grandes**

Fonte: auditoria de lacunas contra o protótipo navegável em
`~/Downloads/dxtutor-ide-desktop/dxtutor-ide` (ui/index.html monólito 1,1 MB +
bridge de 14 comandos). O ui-next ganha em substância (tudo real); perde em
superfície/UX. As P1 entram como fases F13–F15; P2/P3 ficam para ronda futura.

| # | Superfície | Situação | Decisão |
|---|-----------|----------|---------|
| 24 | Dock Co-Dev rico (cartões de sugestão accionáveis, chips `@ficheiro` `/test` `/lint`, histórico persistente, header provider·modelo) | tudo client-side sobre comandos JÁ existentes (`explainFile`/`review_code`/`run_all_tests`/`list_providers`/fsops) | **portar → F13** |
| 25 | Debug Assistant (tab do painel inferior: ANALYSING·HYPOTHESES·NEXT sobre o erro real) | fontes reais prontas: diagnostics da sessão LSP (F7), testes (F3), debugger gdb, `llm_chat` governado | **portar → F14** |
| 26 | Vista Co-Dev agregada (TEAM c/ escopos + BACKLOG contadores + MISSIONS + PROJECT KNOWLEDGE + CHECKPOINTS + ROUTING) | agregação de fontes reais já portadas (team/board/studio/manager/git) + docs reais do workspace | **portar → F15** |
| 27 | Tab «Team & harness» (contexto detectado + 4 templates com ceiling/threshold + Apply → `.dxtutor/harness.toml`) | contexto = ficheiros reais do workspace; ceiling governa o dock (codev_policy já real) | **portar → F15** |

### Rastreabilidade tier → fases

- **Tier 1 fecha com**: F1 (#7) + F2 (#2) + F3 (#4) + F5 (#1, #3) + F6 (#5, #6, #8).
- **Tier 2 fecha com**: F1 (#9, #17) + F2 (#13, #14) + F3 (#15, #16) + F4 (#10, #11) + F7 (#12, #18).
- **Tier 3 fecha com**: F8 (#19) + F9 (#22) + F10 (#21) + F11 (#20) + F12 (#23).
- **Tier 4 fecha com**: F13 (#24) + F14 (#25) + F15 (#26, #27).

---

## Plano da ronda — um prompt pronto-a-colar por fase

Ordem recomendada: F1 → F2 → F3 → F4 → F5 → F6 → F7 (Tiers 1+2, FEITAS) e depois
F8 → F9 → F10 → F11 → F12 (Tier 3, por prontidão de backend). F1 primeiro porque a
localização toca os textos que os gates existentes afirmam (mexer cedo evita
retrabalho); as restantes são independentes entre si, salvo nota.

### ~~F1 — i18n pt-AO + temas + Definições/sandbox (lacunas #9, #17, #7)~~ ✅ FEITA 2026-11-15

Entregue: `src/i18n.ts` (dicionário en/ptAO + t() + applyStatic, pt-AO por omissão),
`src/theme.ts` (3 temas por CSS vars `data-theme`), `src/settings.ts` (idioma/tema/
chaves via save_key + keys_status mascarado/motor sandbox), literais varridos nos 20
módulos, asserts do runSelftest localizados. selftest-next: 25 gates, exit 0.

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Dar ao ui-next i18n pt-AO (pré-AO90) como língua por omissão, temas comutáveis e
um painel Definições real (chaves de provedor + motor sandbox), zero demo.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos i18n.ok=True (UI arranca
  em pt-AO e trocar para en muda textos visíveis), theme.ok=True (comutar tema
  altera CSS vars no DOM) e settings.ok=True (guardar uma chave via save_key é
  relida por keys_status; get/set_sandbox_engine redondo).
- Todos os 20 gates existentes continuam verdes com os textos localizados.

Start here: criar desktop/ui-next/src/i18n.ts à imagem de desktop/src/shell/strings.ts
(dicionário en/ptAO + t()); varrer os literais de src/*.ts; painel Definições novo
src/settings.ts (padrão src/providers.ts) com get_providers_config/save_key/
get_sandbox_engine/set_sandbox_engine; temas = CSS vars em style.css + selector.

Watch out:
- Os gates existentes afirmam strings inglesas (ex.: fileItems.includes("Open
  Folder…") em main.ts runSelftest; palete "View: …"). Localizar e actualizar os
  asserts NA MESMA fase — é a razão de F1 vir primeiro.
- A chave NUNCA aparece em claro no DOM (seguir o padrão mascarado do providers.ts
  e o assert anti-fuga /sk-ant-|AIza/ já usado nos gates providers/team).
- NVM antes de npx; ciclo rápido = tsc --noEmit; selftest completo só no fim.
```

### ~~F2 — GitFlow + diff + Explorer CRUD (lacunas #2, #14, #13)~~ ✅ FEITA 2026-11-15

Entregue: `src/gitflow.ts` (iniciar feature/fix/release/hotfix da base real —
develop se existir, senão main/master — e finalizar com `merge --no-ff` REAL via
exec + apagar ramo; o v7 só imprimia os comandos), diff por ficheiro no SCM
(clicar numa alteração abre `monaco.editor.createDiffEditor` read-only: original
= `git_show HEAD:<rel>`, novo = buffer vivo), CRUD no Explorer (menu de contexto
novo/renomear/apagar sobre create_path/rename_path/delete_path, apagar pede
confirmação). Gates gitflow/diff/fileops; o ramo do seed passou a `feat-seed`
(um ramo `feature` bloqueia o ref `feature/gate`). selftest-next: 28 gates, exit 0.

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar o painel GitFlow do v7 para o ui-next (iniciar feature/fix/release,
finalizar ramo), vista de diff por ficheiro no SCM (Monaco diff editor) e CRUD de
ficheiros no Explorer — tudo contra git/fs reais.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos gitflow.ok=True (iniciar
  feature cria ramo real confirmado por git_branch; finalizar integra e volta ao
  ramo base), diff.ok=True (ficheiro alterado abre diff com lado original de
  git_show e lado novo do buffer) e fileops.ok=True (criar/renomear/apagar via
  create_path/rename_path/delete_path reflectido no disco e na árvore).
- Gates scm/graph/session existentes continuam verdes (partilham o repo seed).

Start here: src/gitflow.ts novo (padrão src/scm.ts; ref. desktop/src/shell/gitflow.ts),
botões no painel SCM; diff = monaco.editor.createDiffEditor em src/editor.ts com
git_show HEAD:<rel> vs buffer; CRUD = menu de contexto em src/explorer.ts chamando
create_path/rename_path/delete_path + re-render da árvore.

Watch out:
- O seed do selftest já tem main+feature+merge — o gate gitflow deve criar um ramo
  próprio (ex. feature/gate) e limpá-lo, sem partir o gate graph (≥2 lanes).
- delete_path é destrutivo: no UI pede confirmação; no gate usa um ficheiro criado
  pelo próprio gate, nunca os do seed.
- Monaco diff: reutilizar a instância monaco de editor.ts, não importar segunda vez.
```

### ~~F3 — Testing + statusbar rica + abas Output/Services (lacunas #4, #16, #15)~~ ✅ FEITA 2026-11-15

Entregue: `src/tests.ts` (painel Testing: list_tests descobre os #[test] reais;
run_test/run_all_tests devolvem o veredicto do runner — o gate prova pass E fail
com dois #[test] semeados no crate do seed), statusbar rica (`sb-problems` igual
ao painel Problems, `sb-tests` segue o último veredicto, `sb-blame` = último autor
real do ficheiro activo via git, `sb-lang` pela extensão), abas novas no painel
inferior: Output·Co-Dev (`src/output.ts`, eventos reais do dock via Codev.onEvent:
mensagens, ferramentas, sessões, corridas de teste) e Services (`src/services.ts`,
compose_ps real ou o erro do backend tal-e-qual — SKIP honesto sem docker/stack).
Seed com .gitignore (target/ do cargo test não entra no git add -A dos gates) e
timeout do xvfb 240→480 s. selftest-next: 31 gates, exit 0.

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Painel Testing real (lista e corre testes do crate aberto), statusbar rica
(problemas/testes/blame/linguagem) e abas Output·Co-Dev e Services no painel
inferior, ligadas a backend real.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos tests.ok=True (list_tests
  encontra os testes do seed; run_test devolve pass/fail real de um teste
  adicionado ao seed), statusbar.ok=True (contagem de problemas igual à do painel
  Problems; blame do ficheiro activo = autor real de git_log) e panels.ok=True
  (Output regista eventos reais do Co-Dev; Services mostra compose_ps ou SKIP
  honesto sem docker).
- Gates terminal/review existentes continuam verdes.

Start here: src/tests.ts novo (padrão src/review.ts; ref. desktop/src/shell/tests.ts)
com list_tests/run_test/run_all_tests; statusbar em main.ts updateStatus() +
git_log max=1 do openTab; abas em index.html .panel-tabs (padrão data-ptab
term/problems já existente) + log client-side para Output.

Watch out:
- O seed do selftest não tem testes — acrescentar #[test] ao src/main.rs do seed
  no próprio selftest-next.sh (secção de seeding), mantendo o crate compilável
  (gate LSP depende dele).
- Services sem docker no host → SKIP explícito (padrão codev/debug), nunca falso ok.
- cargo test no seed compila — conta para o tempo do gate; usar timeout generoso.
```

### ~~F4 — Terminal PTY + chat streaming (lacunas #10, #11)~~ ✅ FEITA 2026-11-15

Entregue: modo PTY no terminal (`src/terminal.ts`: pty_spawn + xterm.js com eventos
`pty://data`/`pty://exit`, botão alterna linha↔PTY, listeners Tauri e ResizeObserver
LIMPOS no fecho — o gate afirma 0 listeners vivos; run_shell fica como modo linha) e
Co-Dev streaming (`src/codev.ts`: assistant_chat_stream com guarda por requestId,
botão Parar via assistant_cancel, selector de modelo renderizado de list_providers
available+streaming; ⚙ alterna para o laço de ferramentas llm_chat governado, que
ficou intacto). Gates pty (`read x` respondido via pty_write — interactividade que
run_shell não tem) e stream (39 tokens parciais antes do done; após cancel a bolha
não cresce — fragmentos tardios ignorados; skip honesto sem provedor).
selftest-next: 33 gates, exit 0.

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Terminal interactivo verdadeiro sobre pty_spawn/pty_write/pty_resize e Co-Dev com
resposta em streaming + cancelar + selector de modelo via assistant_chat_stream/
assistant_cancel/assistant_models.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos pty.ok=True (sessão PTY
  aceita escrita interactiva — ex. `read x` respondido via pty_write — coisa que
  run_shell não faz) e stream.ok=True (resposta chega por eventos parciais antes
  do fim OU skip honesto sem provedor; cancelar interrompe de facto).
- Gates terminal e kill EXISTENTES continuam verdes — o caminho run_shell
  mantém-se para o harness; o PTY é um modo novo, não uma substituição.

Start here: src/terminal.ts — acrescentar modo PTY (pty_spawn + listener de
eventos; ref. uso de pty em desktop/src/shell/terminal.ts) com fallback run_shell;
src/codev.ts — trocar a apresentação para assistant_chat_stream com cancelar,
mantendo o laço de ferramentas llm_chat governado (origin tutor-llm) intacto.

Watch out:
- NÃO partir os gates terminal/kill: eles provam run_shell; o gate pty prova a
  interactividade que run_shell não tem. Dois caminhos, dois gates.
- O laço de ferramentas do gate codev (origin tutor-llm, toolsRun>0) tem de
  continuar a passar — streaming é apresentação, não substitui o laço governado.
- Eventos Tauri: reutilizar listen() de tauri.ts; limpar listeners ao fechar o
  terminal (fugas fazem o xvfb run acumular memória).
```

### ~~F5 — Quadro (Board) + Studio de arquitectura (lacunas #1, #3)~~ ✅ FEITA 2026-11-15

Entregue: `src/board.ts` (kanban de user stories sobre board_load/board_save — SQLite real
do crate tutor-board, um backlog por raiz; NASCE VAZIO, sem seeds do v7; + Story, drag entre
colunas com honestidade portada: entrar em «Teste automático» corre run_all_tests real e o
veredicto decide a coluna; «Concluído» só após validação funcional) e `src/studio.ts`
(desenho orientado a eventos com os 6 Kinds do backend, relação inferida nas arestas +
evento nomeado; validação SEMPRE arch_validate; «Pré-visualizar scaffold» =
arch_scaffold_preview sem tocar no disco; «Gerar scaffold…» real só com confirmação;
«Gerar backlog →» deriva stories do desenho validado e escreve-as no Quadro via ingest).
Vistas a ocupar a área do editor (`.eview`, padrão welcome/diff), abertas pelo menu
Ver/paleta. ARMADILHA paga: openSpecial dispara um refresh não-aguardado — o board_load
atrasado clobberava o estado após addStory/ingest; fix = single-flight (ensureLoaded com
promessa partilhada, loaded só no fim do load). Gates board (nasce-vazio + board_save +
board_load fresco devolve a story) e studio (0 erros reais, preview lista os 13 ficheiros
derivados do desenho, test -e confirma que NADA foi escrito, backlog +2 stories contadas
por board_load). selftest-next: 35 gates, exit 0.

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar o Quadro (kanban/backlog/sprints) sobre board_load/board_save (SQLite real
do crate tutor-board) e o Studio de arquitectura sobre arch_validate/
arch_scaffold_preview/arch_scaffold, com «gerar backlog a partir do desenho».

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos board.ok=True (criar
  issue → board_save; reabrir workspace → board_load devolve-a: persistência real
  SQLite) e studio.ok=True (desenho mínimo validado por arch_validate;
  arch_scaffold_preview lista ficheiros que o scaffold criaria; gerar backlog
  escreve issues reais no board).
- Zero demo: nenhum issue/componente semeado — painéis nascem vazios e tudo o que
  aparece veio de uma acção real do utilizador/gate.

Start here: src/board.ts novo (ref. desktop/src/shell/board.ts e crate
crates/tutor-board p/ o formato) + src/studio.ts (ref. desktop/src/shell/studio.ts);
tipos wire novos em tauri.ts (board_load/board_save/arch_*); vistas a ocupar a
área do editor como tab (padrão welcome em main.ts), não a sidebar.

Watch out:
- Conferir a assinatura real de board_load/board_save em desktop/src-tauri/src/
  (mod board) ANTES de escrever os tipos TS — não adivinhar o shape.
- O protótipo semeia issues/sprints de exemplo — NÃO portar; o v7 board.ts pode
  ter seeds também: portar só a casca+persistência.
- arch_scaffold escreve no disco: no gate usar sempre arch_scaffold_preview; o
  scaffold real só por acção explícita com confirmação.
```

### ~~F6 — Tutor/Learning + Gestor de missões + matriz de política (lacunas #6, #5, #8)~~ ✅ FEITA 2026-11-15

Entregue: `src/learn.ts` (Percurso de aprendizagem `.eview`: catálogo real de list_courses,
árvore de unidades/passos de get_course com bloqueio sequencial, drill por transcrição
transparente + run_drill real, challenge corrigido pelos testes ocultos via submit_step —
gabarito só quando passa, tal-e-qual chega —, guia de estudo get_study_guide e pistas
graduais request_hint que nunca tocam no código do aluno), `src/manager.ts` (Gestor de
missões `.eview`: espelho SÓ-LEITURA de codev_session_list + missões isoladas
agent_task_submit→status→cancel sobre o preview do Studio, diff revisto pelo humano) e
matriz de política no dock Co-Dev (`src/codev.ts` showPolicyMatrix: células `data-pmx`
renderizadas de codev_policy por modo — o tipo `CoDevPolicy` do tauri.ts foi corrigido
para espelhar o struct Rust completo com chains/destructiveAlwaysAsks). Gates learn
(2 cursos reais, 32 unidades/159 passos, pista offline-safe no DOM sem mexer no buffer;
SKIP honesto sem cursos/provedor), manager (snapshots só-leitura dentro do gate session:
a sessão worktree aparece listada aberta e some após o deliver; lista final IGUALA o
backend; missão done com `diff --git`) e policy (12 células, 0 divergências vs
codev_policy). selftest-next: 38 gates, exit 0.

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar o Tutor/Learning Track (cursos, lições, pistas, drills) sobre o backend de
estudo real, o Gestor de missões sobre agent_task_*/codev_session_list e a matriz
de política Co-Dev visível sobre codev_policy.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos learn.ok=True
  (list_courses devolve cursos reais; abrir um devolve get_course; request_hint
  responde via laço governado OU skip honesto sem provedor), manager.ok=True
  (codev_session_list reflecte a sessão worktree criada pelo gate session
  existente, antes e depois do deliver) e policy.ok=True (a matriz mostrada por
  modo IGUALA codev_policy(mode) para manual/assist/auto).
- Gate session existente continua verde (o manager lê, não interfere).

Start here: src/learn.ts (ref. desktop/src/shell/learn.ts) com
list_courses/get_course/get_study_guide/run_drill/submit_step/request_hint;
src/manager.ts (ref. desktop/src/shell/manager.ts) com codev_session_list +
agent_task_status; matriz = secção no dock Co-Dev (src/codev.ts) renderizada de
codev_policy, ref. desktop/src/shell/policyMatrix.ts.

Watch out:
- A matriz é RENDERIZADA do backend (codev_policy), nunca uma tabela hard-coded —
  é exactamente o tipo de demo que o zero-demo proíbe.
- O gate manager corre DEPOIS do gate session (ordem no runSelftest importa);
  ler codev_session_list sem criar/apagar sessões dos outros gates.
- Conteúdo de curso vem do backend; se o host não tiver cursos instalados,
  SKIP honesto (padrão debug/codev).
```

### ~~F7 — LSP referências/rename + diagnostics no editor (lacunas #12, #18)~~ ✅ FEITA 2026-11-15

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Completar a inteligência de linguagem no ui-next: encontrar referências e renomear
símbolo via LSP real, e diagnostics (squiggles) do ficheiro activo no Monaco.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos references.ok=True (as
  referências do binding `x` do seed incluem a declaração e o uso no println),
  rename.ok=True (renomear `x`→`y` altera AMBAS as ocorrências no buffer/disco) e
  diagnostics.ok=True (um erro introduzido no seed produz marcador Monaco na linha
  certa) — cada um com SKIP honesto se rust-analyzer não resolver no host.
- Gate lsp existente (hover/definition) continua verde.

Start here: tauri.ts — tipos para resolve_references/lsp_rename/lsp_prepare_rename/
get_diagnostics; src/editor.ts — registar referenceProvider/renameProvider no
monaco.languages (padrão do definitionProvider já existente em editor.ts:123) +
monaco.editor.setModelMarkers com get_diagnostics.

Watch out:
- rust-analyzer é lento a aquecer (workDoneProgress/cachePriming — armadilha já
  paga na F1 LSP do v7): o gate deve esperar/repetir como o gate lsp existente
  faz, e SKIP se não resolver.
- rename escreve em múltiplos sítios: aplicar via buffers do workspace (setBuffer
  + autosave), não writes directos, para o SCM ver as alterações.
- O gate diagnostics introduz um erro no seed: usar ficheiro próprio do gate e
  repô-lo no fim, senão parte os gates lsp/outline que dependem do crate válido.
```

### ~~F8 — Containers: pane do runtime real (lacuna #19)~~ ✅ FEITA 2026-11-15 (`e7dc677`)

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar a pane Containers do protótipo sobre o runtime REAL do host: listar
imagens e containers do motor configurado (delonix/docker via get_sandbox_engine),
arrancar/parar a stack compose do projecto, e ligar ao devcontainer existente.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gate novo containers.ok=True (a
  lista de containers/imagens vem do CLI real via exec — o container da sessão
  devcontainer do gate remote aparece; parar remove-o da lista) — SKIP honesto
  se o motor não existir no host.
- Gates remote/services existentes continuam verdes (partilham devcontainer_*/
  compose_ps; o gate containers corre DEPOIS e não desliga sessões alheias).

Start here: src/containers.ts novo (padrão services.ts — refresh sobre backend,
erro tal-e-qual); listagens via api.exec(engine, ["ps","--format","json"], root)
com engine de get_sandbox_engine; compose up/stop reutiliza run_shell/compose_ps;
vista na activity bar (showView + data-view, padrão remote).

Watch out:
- ZERO pane Docker simulada do protótipo: socket/hosts remotos ficam FORA até
  haver backend; só o que o CLI local responde.
- delonix e docker têm formatos de `ps` diferentes — detectar o motor primeiro
  e parsear o formato desse motor; nunca assumir docker.
- O gate NÃO pode matar containers que não criou (destrutivo) — usa a sessão
  devcontainer própria (devcontainer_session_up/_down) como alvo observável.
```

### ~~F9 — Visualize Execution + Under the Hood (lacuna #22)~~ ✅ FEITA 2026-11-15

Entregue: `src/theatre.ts` (.eview Teatro de execução, padrão learn/studio): aba
«Visualizar execução» = trace_execution REAL (passos linha/evento/função/locals do
frame; a linha corrente realça no Monaco próprio read-only do snapshot traçado;
stdout por passo quando medido (Python), final com rótulo honesto quando o traçador
não intercepta a meio (Rust põe stdoutLen=0)); aba «Por dentro» = compile_pipeline
(MIR/LLVM-IR/ASM/bytes do binário/desassemblagem reais; fases em falta = «não
produzido» com as notas); relações = symbol_relations ao clicar na função, chip
diz SEMPRE como foi estabelecido (ambíguo/inferido/resolvido). FIX backend: o
`local_binding` do rust_tracer não reconhecia `let x: i32 = 5;` (Pat::Type à volta
do Pat::Ident) → lets tipados nunca entravam no scope e o traço Full vinha sem
variáveis; +2 testes unitários. Gates trace (2 passos, let@L2, x=5 visto, realce
Monaco confirmado nas decorações, chip=ambiguous — os 2 `fn main` do seed) e
pipeline (bin 4,3 MB, llvm/asm/mir/disasm reais com crate-name do backend, DOM ===
backend); o gate fixa o motor sandbox em host (toolchain local) e repõe-o; xvfb
600→720 s. selftest-next: 44 gates, exit 0.

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar o theatre HONESTO sobre o backend completo que já existe: trace de
execução medido (trace_execution), pipeline de compilação real (compile_pipeline)
e relações de símbolos (symbol_relations) — vistas .eview na área do editor.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos trace.ok=True (o trace
  do main.rs do seed tem passos reais com linha/evento; a linha corrente realça
  no Monaco) e pipeline.ok=True (fases do compile_pipeline do código do seed
  renderizadas com artefactos reais, não fixos) — SKIP honesto se o backend
  responder erro no host.
- Gate codemap existente continua verde (symbol_relations partilhado).

Start here: tipos ExecutionTraceDto/PipelineDto em main.rs:231+ (DTOs de
observabilidade honesta) → tauri.ts; src/theatre.ts novo (.eview, padrão
learn/studio; ref. UI antiga desktop/src/debug.ts:370 trace_execution e
desktop/src/main.ts:2269 compile_pipeline).

Watch out:
- O dono abandonou a v7-com-theatre por SIMULAÇÃO — aqui cada número tem de vir
  medido do backend; nada de animações com dados fixos.
- trace_execution("rust", …) compila e corre o código — lento; gate com timeout
  generoso e código do seed minúsculo.
- symbol_relations marca homónimos `ambiguous` e resultados `inferred` — o chip
  tem de dizer qual (regra da skill editor-code-intelligence).
```

### ~~F10 — Extensions/VSIX: âmbito mínimo honesto (lacuna #21)~~ ✅ FEITA 2026-11-15 (`66bd94c`)

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar a vista Extensions com o que o backend REALMENTE dá: abrir um .vsix do
disco, ler o manifesto real (vsix_manifest), listar as extensões instaladas num
registo local, e remover. SEM motor de execução: capacidades que exigiriam
runtime de extensão ficam visivelmente «não suportado».

Done when:
- bash scripts/selftest-next.sh → exit 0 com gate novo vsix.ok=True (um .vsix
  mínimo gerado pelo gate é instalado → o manifesto real (nome/versão/engines)
  aparece na lista; remover apaga do registo e da lista).
- A vista declara honestamente que extensões NÃO executam (sem host de extensão)
  — nenhum botão simula activação.

Start here: vsix_manifest(b64) em src-tauri/src/bridge.rs:150 (parse real do
zip) → tauri.ts; src/extensions.ts novo (vista na activity bar); registo local
em app_local_data_dir via backend existente ou ficheiro JSON do workspace.

Watch out:
- .vsix é um zip: o gate cria um de verdade (zip com extension.vsixmanifest +
  package.json) via exec, não um fixture binário committado.
- NÃO prometer temas/snippets/linguagens sem os aplicar de facto — na dúvida,
  mostrar só o manifesto e marcar o resto «não suportado» (zero-demo).
- Instalar/remover tocam disco → acção explícita do utilizador, nunca automática.
```

### ~~F11 — Infra/K8s: deploy real com kubectl (lacuna #20)~~ ✅ FEITA 2026-11-15 (`9c44091`)

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar a pane Infra sobre kubectl REAL (existe no host): contexto/namespace de
KUBECONFIG, aplicar os manifests k8s que o scaffold do Studio gera, listar o
que ficou no cluster e apagar — o ciclo deploy→observar→remover do protótipo,
sem nada simulado.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gate novo k8s.ok=True (kubectl
  version/contexto real; com cluster acessível: apply dos manifests do preview
  do Studio num namespace próprio do gate → recursos listados → delete do
  namespace limpa tudo) — SKIP honesto sem kubectl OU sem cluster acessível.
- Gate studio existente continua verde (o gate k8s usa arch_scaffold_preview,
  nunca arch_scaffold).

Start here: src/infra.ts novo (vista activity bar); kubectl via api.exec
("kubectl", [...], root) — contexto com `kubectl config current-context`,
apply com `-f -` (stdin? exec não tem stdin → escrever manifests em dir
temporário do gate e `-f <dir>`); manifests de studio.preview().

Watch out:
- `exec` tem stdin:null fixo no wrapper — apply por ficheiro/dir, não por pipe.
- Namespace PRÓPRIO do gate (ex. dxnext-gate) e delete do namespace no fim —
  nunca tocar recursos fora dele (destrutivo).
- Sem cluster no host o gate NÃO falha: `kubectl version --request-timeout=2s`
  decide o SKIP; o CI/portátil não tem cluster garantido.
- Promoção de ambientes (dev→staging→prod) do protótipo fica FORA desta fase —
  é política, não kubectl; anotar como extensão futura.
```

### ~~F12 — Conta · Observabilidade · «O que mudou e porquê» (lacuna #23)~~ ✅ FEITA 2026-11-15

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar as três vistas com dados 100% medidos: Conta = estado real dos provedores
(keys_status/list_providers) + modelo activo; Observabilidade = tokens reais por
turno (ChatResp.inputTokens/outputTokens e eventos de streaming) acumulados na
sessão; «O que mudou e porquê» = linha temporal git real (git_log + git_diff)
com as mensagens de commit como o «porquê».

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos observ.ok=True (após o
  gate codev/stream, os contadores de tokens mostrados IGUALAM os devolvidos
  pelo backend nesse turno; zero quando não houve turno — SKIP honesto sem
  provedor) e changelog.ok=True (a timeline mostra os commits reais do seed com
  autor/data; clicar num commit abre o diff real git_show/git_diff).
- Conta NUNCA renderiza chaves em claro (regra dos gates providers/settings).

Start here: src/account.ts e src/changelog.ts novos (padrão providers.ts/
graph.ts); tokens: Codev já recebe ChatResp/StreamDone — expor um acumulador
(codev.usage()) que a vista lê; timeline sobre api.gitLog + api.gitShow.

Watch out:
- Tokens de streaming: llm://done traz {requestId, model} SEM contagens — a via
  streaming só conta o que o backend reportar de facto; se não reportar, a vista
  diz «não medido» (zero-demo), nunca estima por caracteres.
- «Porquê» = mensagem de commit real; NÃO gerar explicações por LLM nesta fase.
- O acumulador vive em memória da sessão (padrão progresso do learn) — o perfil
  WebKitGTK persiste localStorage entre runs e partiria o determinismo do gate.
```

### ~~F13 — Dock Co-Dev rico: cartões, chips e histórico persistente (lacuna #24)~~ ✅ FEITA 2026-11-15 (gate codevdock)

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Elevar o dock Co-Dev ao nível do protótipo SEM teatro: cartões de sugestão
accionáveis derivados do ESTADO REAL, chips de contexto no composer, histórico
de conversa persistente por raiz de workspace, e header com chip
provider·modelo vivo.

- Cartões (estado vazio da conversa): «Explicar o ficheiro activo» (→ explainFile,
  só se há ficheiro activo), «Rever alterações» (→ review_code sobre o buffer),
  e — SÓ quando os markers do editor têm erro real — «Corrigir <código do erro>
  em <ficheiro>» que pré-preenche o composer com o diagnóstico verbatim. Cartão
  sem fonte real não aparece (zero-demo).
- Chips do composer: chip `@` segue a tab activa (clicar alterna incluir/excluir
  o ficheiro do contexto do turno; sem ficheiro → «@ sem ficheiro»); `/test`
  corre run_all_tests REAL e injecta o veredicto no turno; `/lint` idem com
  review_code.
- Histórico: conversa persistida por raiz num JSON em configDir (padrão
  extensions.json da F10, via read/write_text_file) e reposta ao reabrir o
  dock/app; botão «novo chat» arquiva e limpa.
- Header: chip provider·modelo renderizado de list_providers (available) com
  estado; sem provedor diz «sem provedor», nunca esconde.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gate novo codevdock.ok=True
  (cartões presentes SÓ com fonte real — o do erro aparece com o diag_gate do
  gate diagnostics e pré-preenche o composer com o texto do rustc; chip @
  espelha a tab activa e alterna; /test corre run_all_tests e o veredicto REAL
  entra na conversa; escrever uma mensagem → fechar e reabrir o dock → a
  conversa está lá E no ficheiro em disco; o gate apaga a SUA entrada do
  histórico no fim).
- Gates codev/stream/session existentes continuam verdes (o tool-loop llm_chat
  e o streaming assistant_chat_stream ficam intactos; cartões/chips só
  pré-preenchem ou injectam contexto — não inventam turnos).

Start here: src/codev.ts (addMsg/chat/loadModels já existem); persistência =
wrappers read_text_file/write_text_file do tauri.ts (F10); chave do histórico =
raiz do workspace (padrão board «um backlog por raiz»); markers do editor via
Editor.markers(rel) (F7).

Watch out:
- NUNCA localStorage para o histórico — o perfil WebKitGTK persiste entre runs
  do selftest e parte o determinismo; ficheiro em configDir permite ao gate
  limpar só a sua chave.
- O cartão «Corrigir…» mostra o diagnóstico do COMPILADOR verbatim; não gerar
  resumo por LLM no cartão (isso é o turno, não o cartão).
- /test e /lint correm ferramentas reais — mostrar o resultado tal-e-qual,
  incluindo falha; um /test sem testes no projecto diz isso mesmo.
- Respeitar requestId como única verdade do streaming (armadilha F4) ao
  injectar contexto no turno.
```

### ~~F14 — Debug Assistant: tab ANALYSING·HYPOTHESES·NEXT sobre o erro real (lacuna #25)~~ ✅ FEITA 2026-11-15 (gate dbgassist)

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Portar a 5.ª tab do painel inferior do protótipo — o Debug Assistant pedagógico
— com TODAS as secções alimentadas por dados medidos: o diagnóstico vivo da
sessão LSP, a última corrida de testes/build e a sessão gdb quando activa.

- ANALYSING: com provedor → UM turno llm_chat governado (origin tutor-llm,
  mode project) sobre o diagnóstico real + excerto do buffer, pedindo análise
  pedagógica («porquê» antes do «como»); SEM provedor → mostrar o help/notes
  REAIS do próprio diagnostic (o rustc já traz a sugestão) com rótulo honesto
  «sem provedor — texto do compilador».
- HYPOTHESES: derivadas de dados reais — related information/notes do
  diagnostic; com sessão gdb activa, os frames/locals do stop corrente. Sem
  dados → «Sem hipóteses ainda — arranca a sessão» (como no protótipo).
- NEXT: acções REAIS — «Depurar isto» arma breakpoint na linha do diagnóstico
  (editor glyph margin) e abre a vista Debug; «Correr o teste afectado» quando
  o último run_test falhou. Nenhum botão que simule.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gate novo dbgassist.ok=True (com o
  ficheiro diag_gate do gate diagnostics: a tab mostra o diagnóstico E0308 real;
  HYPOTHESES não-vazias e derivadas do próprio diagnostic — o gate compara com
  os notes do marker; NEXT arma um breakpoint REAL na linha do erro — afirmado
  via Editor.breakpointList; parte ANALYSING-LLM com SKIP honesto sem provedor,
  e com provedor afirma só «resposta não-vazia chegou», nunca o conteúdo).
- Gates diagnostics/debug/tests existentes continuam verdes.

Start here: nova tab data-ptab no index.html + src/debugassist.ts (padrão
output.ts/services.ts); fontes: evento lsp://diagnostics já reencaminhado
(editor.ts bindDiagnostics, F7), Tests.lastRun (F3), debug.ts stop
frames/locals (fase debug); LLM via o MESMO caminho governado do explain.ts.

Watch out:
- get_diagnostics(step_id,…) é de PASSOS DE CURSO, não serve para ficheiros do
  workspace (armadilha F7) — a fonte é a sessão LSP persistente.
- Identidade de revisão (skill editor-code-intelligence): análise calculada
  sobre um buffer NÃO pinta sobre buffer entretanto alterado — guardar
  versão/rel com o resultado e descartar se mudou.
- A narrativa NUNCA é enlatada: sem diagnóstico não há ANALYSING (estado vazio
  honesto), e o fallback sem provedor é texto do compilador, não prosa nossa.
- Um turno LLM por diagnóstico, disparado por ACÇÃO do utilizador (abrir a tab
  /botão), nunca em loop automático a cada keystroke.
```

### F15 — Vista Co-Dev agregada + tab «Team & harness» (lacunas #26, #27)

```
cd /home/walter/workspaces/NgolaCloud/projects/dxtutor        # branch main

Agregar numa vista única da activity bar («Co-Dev») o que hoje está disperso,
e dar-lhe a tab «Team & harness» do protótipo — o contrato do projecto que
governa o dock de verdade.

Vista Co-Dev (sidebar), 6 secções de fontes REAIS:
- TEAM: papéis do roster com o ESCOPO DE PATHS visível, lido do harness.toml
  (sem harness → escopos «não definidos», nunca inventados).
- BACKLOG: contadores reais — stories por coluna de board_load + componentes
  planned do desenho do Studio.
- MISSIONS: espelho só-leitura de codev_session_list + agent_task (reusar a
  fonte do manager.ts, não duplicar estado).
- PROJECT KNOWLEDGE: ficheiros markdown REAIS do workspace (.dxtutor/*.md e
  docs/*.md se existirem); clicar abre como tab normal do editor; vazio diz
  «sem documentos».
- CHECKPOINTS: refs git REAIS — antes de cada deliver de sessão/missão criar
  tag leve dxcp/<slug>-<n>; a secção lista as tags dxcp/* (git real via exec)
  e clicar abre o diff contra HEAD.
- ROUTING: papel→modelo persistido no harness.toml e aplicado pelo router
  real do team.ts (list_providers decide o que está disponível).

Tab «Team & harness» (.eview, padrão studio.ts):
- Contexto detectado MEDIDO do workspace (Cargo.toml/package.json/migrations/
  regras — cada chip só aparece se o ficheiro existe).
- 4 templates (Estudo / Pair programming / Equipa cloud-native / Sistemas
  críticos) com ceiling do modo Co-Dev + threshold; «Aplicar» escreve
  .dxtutor/harness.toml NO WORKSPACE (versionado com o código) após confirm();
  badge «aplicado» = comparação real ficheiro↔template.
- O ceiling GOVERNA o dock: modos acima do ceiling ficam desactivados com a
  explicação («o harness deste projecto limita a Manual/Assistido»). O
  enforcement de ESCOPOS DE PATHS por papel fica FORA (exigiria o backend a
  filtrar o tool-loop) — anotar na UI como extensão futura, sem fingir.

Done when:
- bash scripts/selftest-next.sh → exit 0 com gates novos codevhub.ok=True
  (BACKLOG iguala board_load+studio ao número; knowledge lista um .md semeado
  e abre-o como tab; MISSIONS espelha codev_session_list; CHECKPOINTS: após um
  deliver de sessão do gate existe dxcp/* no git real e a secção mostra-o) e
  harness.ok=True (Aplicar template escreve harness.toml real no seed — cat
  prova; ceiling Manual desactiva Assistido/Auto no dock e o selector mostra a
  explicação; re-aplicar outro template actualiza ficheiro E dock; o gate
  apaga o harness.toml no fim e o dock volta aos 3 modos).
- Gates team/board/studio/session/manager existentes continuam verdes (a vista
  agrega — não muda — as fontes; team.ts continua a única verdade do routing).

Start here: src/codevhub.ts (vista activity bar) + src/harness.ts (tab .eview
+ parser/writer TOML simples ou JSON-em-.toml só com o subset nosso);
checkpoint = `git tag dxcp/<slug>` via api.exec no codev.ts deliver (um ponto
único); escopos/routing lidos por team.ts e codev.ts no arranque e ao mudar.

Watch out:
- harness.toml é do WORKSPACE (versionado), não configDir — é o contrato do
  projecto, viaja com o código (protótipo: .dxtutor/harness.toml).
- Escrever TOML à mão: escapar valores; na dúvida subset mínimo documentado no
  topo do ficheiro. O seed do gate ganha .dxtutor/ no .gitignore? NÃO — o
  harness é para versionar; mas o gate tem de repor o seed limpo no fim.
- Tags dxcp/* no seed do gate: limpar refs de runs abortados ANTES de medir
  (armadilha do gate vsix); nunca criar tags no repo do UTILIZADOR sem acção
  dele — checkpoint dispara só com deliver/missão.
- O ceiling aplica-se no dock (UI) — dizer isso honestamente; a matriz
  codev_policy do backend continua a única verdade do que cada modo pode.
- Secções vazias dizem-se vazias (padrão «sem documentos») — nada de
  placeholders com dados de exemplo.
```

---

## Definição de pronto da ronda

- **Tier 1 completo** = F1, F2, F3, F5, F6 entregues (8/8 superfícies com gate verde). ✅ 2026-11-15
- **Tier 2 completo** = F1, F2, F3, F4, F7 entregues (10/10 profundidades com gate verde). ✅ 2026-11-15
- **Tier 3 completo** = F8, F9, F10, F11, F12 entregues (decisão do dono 2026-11-15: ✅ 2026-11-15 — RONDA COMPLETA, 48 gates
  portar todos; zero-demo mantém-se — SKIP honesto quando a ferramenta falta no host).
- **Tier 4 completo** = F13, F14, F15 entregues (decisão do dono 2026-11-15: suprir as
  3 grandes lacunas P1 da auditoria vs protótipo de Downloads; gates novos codevdock/
  dbgassist/codevhub/harness; cada fase é sessão própria; zero-demo mantém-se).
- No fim de cada fase: `bash scripts/selftest-next.sh` → exit 0 com TODOS os gates
  (antigos + novos) verdes; commit atómico; este ficheiro actualizado (fase riscada).
