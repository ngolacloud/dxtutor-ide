# CLAUDE.md — dxtutor IDE

Desktop IDE (Tauri 2 + Rust) para o protótipo Co-Dev. Este ficheiro é o harness
de arquitectura: o mapa das camadas, a regra de dependências, os invariantes que
não podem regredir, e os comandos para os verificar. Lê isto antes de tocar nas
features em Clean Architecture (`ui-app/src/features/codev/`,
`ui-app/src/features/codereview/`) ou de extrair uma feature nova.

## Comandos (correr da raiz)

> `node`/`npm` são via **nvm** nesta máquina:
> `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` antes de `npm …`.

| Objectivo | Comando |
|---|---|
| **Typecheck + build da UI** | `npm run ui:build` (`tsc --noEmit` + `vite build`) |
| **Testes unitários + golden** | `npm run ui:test` (vitest) |
| **Lint de arquitectura** | `npm run arch:check` (`scripts/arch-check.sh`) |
| App completa (embute a UI em compile-time) | `npm run dev` / `npm run build` |

O Tauri embute `ui-app/dist` em **compile-time** (`beforeBuildCommand` corre
`ui:build`): para ver uma mudança de UI na app, é preciso `ui:build` **e** rebuild
do binário. O binário fica em `<repo>/target/debug/` (não em `src-tauri/target/`).

## Invariantes (verificados por `arch:check`, não podem regredir)

`scripts/arch-check.sh` é a porta de CI leve (estática, sem compilar, sem
dependências — só `bash`/`awk`/`grep`). Verifica:

- **A1–A3** — os 302 comandos Tauri registados em `generate_handler!` batem certo
  com os `#[tauri::command]` por ficheiro e com a matriz `docs/architecture/IPC-MATRIX.md` (1:1).
- **A4–A5** — a cadeia de build aponta para a UI oficial única (`../ui-app/dist`);
  nenhuma config referencia `ui/` ou `ui-next/`. **Nunca** trocar `frontendDist`
  para `ui-next`.
- **A6** — baseline de `@ts-nocheck` (**directiva** `// @ts-nocheck`, não a palavra
  em prosa): **0 ficheiros** desde a U4j5b do ADR-0004 (era 11). Nenhum ficheiro da UI
  pode voltar a ter a directiva: código novo nasce tipado.
- **A9** — só os ficheiros da lista `A9_ALLOW` publicam no `window` (`Object.assign(window, …)`, `window.X = …`,
  uma superfície `publish({ … })` das pontes ou uma escrita por fachada `const G = window as …; G.X = …` — fecho da
  U7 do ADR-0004, medida corrigida na U7p). Código novo não publica: lê por import, pelo store de `app/store`
  ou pelo registo `app/services.ts`. A lista só encolhe — um ficheiro que deixa de publicar sai dela (o A9
  falha até sair). As métricas «globais publicadas» e «shims de estado» do `ui-metrics.sh` também só descem.
- **A7–A8** — fronteiras da Clean Architecture das features extraídas (abaixo).
  A var `FEATURES` do `arch-check.sh` lista quais governam (hoje `codev`, `ext`,
  `codereview`, `scm`, `debug`, `board`, `visualizer`, `infra`, `panel`, `learn`, `arch`, `testing`, `lsp`, `project`, `hood` — o «Under the hood» e o traço reais da A8 — `ops` — o separador Ops da A9 —, `codebase` — Dependencies e Onboarding da A10 —, `comments`, `welcome` — a página de boas-vindas da r23 F6 — `protect` — a protecção de dados da r23 F4a — `vault` — o Vault da r23 F4c — e `deploy` — o deploy guiado da r23 F4c2); cada nova
  extracção acrescenta-se lá. A `arch` (Studio de arquitectura de sistema, separador «Architecture»)
  é uma feature nova e tipada, separada do Studio do catálogo cloud (`features/studio.ts`). Nota: desde a U4i do ADR-0004 nenhuma
  feature tem `@ts-nocheck` (os resíduos `infra.ts`/`visualizer.ts` e o interpretador `vzRun`
  foram tipados), o `boot.ts` também (U4j1) e, por fim, o `app.ts` (U4j5b), que depois se dividiu
  em `app/commands.ts` (CMD/menus) e `app/boot-steps.ts` (boot, boot3–boot6) e deixou de existir (U4j5c).

## Arquitectura da feature Co-Dev (`ui-app/src/features/codev/`)

Piloto de Clean Architecture (ADR-0002). A feature está extraída do monólito
(`app.ts`/`v5.ts`/`v6.ts`) em camadas com fronteiras tipadas e verificadas:

```
features/codev/
  domain/          tipos, policy (approvalFor), composer, project-commands, agent-events,
                   provider-errors, pricing.
                   PURO: sem DOM, sem window, sem Tauri, sem importar de fora.
  application/     casos de uso: ports.ts + live-chat / agent-chat / tool-executor.
                   Deps injectadas por argumento; sem HTML. Cancelamento por AbortSignal.
  ui/              chat-view.ts (dono do DOM/markup) + actions.ts (1 listener
                   delegado no document: data-action + data-on, sem onclick inline).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.* (tipado).
  index.ts         raiz de composição: liga adapters (bridge) ↔ ui ↔ casos de uso.
features/codev.ts  RESÍDUO strangler (fora da subárvore): publica os shims window.*
                   que app.ts/board.ts ainda resolvem por global. Transitório.
```

### A regra de dependências (o centro não conhece a borda)

```
         domain  ←  application  ←  ui
            ↑            ↑           ↑
            └──────── index.ts ──────┘   (composição)
                         ↓
                 infrastructure (window)
```

- **`domain/` não importa `application/`, `ui/` nem `infrastructure/`.**
  Verificado por **A7** (reprova qualquer especificador de import com um segmento
  `application|ui|infrastructure`).
- **Só `infrastructure/legacy-bridge.ts` toca em `window`.** Todo o resto da
  subárvore (`domain/`/`application/`/`ui/`/`index.ts`) lê o mundo por imports do
  bridge ou por deps injectadas. Verificado por **A8** (`window` como código — pós
  strip de comentários — em qualquer outro ficheiro = falha).
- **Propostas de ficheiro inteiro revêem-se no editor** (2026-11-26): quem só tem o ficheiro novo inteiro (o
  `write_file` do chat antigo em Manual/Assistido, o painel Explain / Code review) chama `proposeInEditor`
  (`codev/index.ts`, em `services.proposals`). `domain/proposal.ts` tira do diff os blocos (só as linhas que mudam)
  e `application/local-proposals.ts` dá-os à MESMA revisão de hunks do agente v2 como sessão `local:` — o `review`
  da composição encaminha essas sessões para lá em vez do backend; no fim só os aceites são escritos. O
  `hunk_applied` aceita `before` (o texto de antes, para o Ctrl+Z, quando quem escreve já o tem).
- O resíduo `features/codev.ts` é a excepção explícita: é o monólito a ser
  estrangulado, publica os shims e **não** é governado por A7/A8. Desaparece quando
  os consumidores (app.ts/board.ts) migrarem (passo 6 do ADR: trocar `window.FS`
  por comandos Tauri).

### Tokens do agente v2 (fase 1)

O primeiro pedido de uma conversa neste repositório desceu de ~17k para ~7k tokens
(`cargo test -p dxtutor-ide --lib first_request_size -- --nocapture` mede-o). Regras:
- **Instruções do projecto** (`tutor_agent::context`): cada ficheiro até 12 KB entra inteiro; maior,
  entra o início (~6 KB, cortado no fim de uma linha) e o índice dos títulos com o número da linha,
  e o modelo lê a secção com `read` quando a tarefa lhe toca. O total é 32 KB. Logo, o que o Co-Dev
  tem de saber SEMPRE vai no início deste ficheiro.
- **Resultados**: `read` dá 500 linhas sem `limit` (28 KB no máximo), `grep` 150 linhas com o total,
  `bash` 20k caracteres (sobretudo o fim), a rede do loop 30k; cada corte diz como pedir o resto.
- **Conjunto 9** (`TOOLSET_VERSION`): `finish_issue` só nas sessões de uma issue, `arch_propose` só
  nas de arquitectura (`SessionMeta.scopes`, gravado; uma retoma usa o gravado). Mudar a descrição
  de uma ferramenta muda o prefixo das sessões antigas: vai sempre atrás de uma versão nova.
- **Cache**: o breakpoint do system prompt do Claude vive 1 hora (escrita a 2×, as pausas de revisão
  passam dos 5 min); o custo conta as escritas de 1 h à parte (`cost.rs`, `pricing.ts`). O `ctx` da
  barra de estado mostra a percentagem lida da cache e o título o custo da conversa.
- **Ollama**: o agente usa a API nativa (`/api/chat`) com `num_ctx` por degraus (16k→128k); o
  endpoint OpenAI-compatível ignora o `num_ctx` e o contexto por omissão cortava o prompt.

### Mapa de agentes (`domain/agent-map.ts`, `application/agent-map.ts`, `ui/agent-map-view.ts`)

O chip «● N agentes» do compositor abre um modal com a sessão da conversa (raiz, à esquerda) e os seus agentes
(à direita). O modelo é «sessões e os seus sub-agentes»: a loja ouve o `codev-agent://event` de TODAS as sessões
(a conversa só segue a sua) e pede `codev_agent_live` ao abrir; numa sprint, cada Co-Dev de uma issue é uma
sessão-agente com os sub-agentes por baixo. O progresso de um `task` chega como `{kind: "subagent", call, step}`
(`tutor_agent::tool::SubagentStep`: `started`/`tool_start`/`tool_result`/`usage`), emitido pelo loop porque o
`Task` diz `reports_progress()`; o resultado da chamada continua a ser o relatório. Só no desktop; os goldens
não mostram o compositor. Testes: `tests/codev.agent-map.test.ts`, `cargo test -p tutor-agent --test flow`.

## Segunda feature extraída: Explain · Code review · Under the hood (`ui-app/src/features/codereview/`)

Primeira aplicação do procedimento da skill `extract-feature` a uma segunda
feature (ADR-0002, Fases 0–4 concluídas). Mesmas camadas e mesma regra de
dependências do Co-Dev, em menor escala:

```
features/codereview/
  domain/          types.ts, review.ts (reviewFindings), scoring.ts (severidade/score). PURO.
  application/     ports.ts + review-engine.ts (orquestração Explain/Code-Review/Hood, deps injectadas).
  ui/              actions.ts (1 listener delegado no document: data-action + data-on).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/codereview.ts  RESÍDUO strangler + raiz de composição: compõe o motor com os
                   adaptadores do bridge, é dono do DOM/markup (renderCreviewView/renderHoodView)
                   e re-publica os shims window.* (v6.ts/debug.ts ainda resolvem por global).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). No desktop com pasta, a tab de Code
review junta às regras locais os analisadores reais do projecto (`review_code`, âmbito
`file`, pelo adaptador `infrastructure/tauri.ts`; ADR-0006 R2e2).

**Painel de documento ao lado do código (2026-11-26).** O Explain e o Code review já NÃO respondem no chat
do Co-Dev: abrem o `<aside id="cr-side">` dentro da `.ebody` (irmão do `#ebody`, sobrevive à troca de
separadores; a classe `.cr-split` e a var `--cr-w` encolhem o editor e o minimapa; arrastável). O caso de
uso é `application/doc-session.ts` (portas `ai`/`files`/`tests`/`view`; um pedido novo nunca deixa o antigo
pintar), o markdown é analisado no domínio (`domain/markdown.ts`, sem lookbehind — WebKitGTK) e desenhado
em `ui/doc-view.ts` com o `hlLine` do editor; os pedidos ao modelo estão em `domain/prompts.ts` (secções
fixas, linhas `L12` clicáveis). Sem modelo, o Explain mostra o resumo local. A revisão pede o ficheiro inteiro
num bloco ```<lang> improved: o painel mostra-o com realce ou diferenças, «Apply», «Apply & test» (a suite
pelo `run_tests`, o mesmo do agente) e «Revert»; a falhar, «Fix the failing tests» manda a saída ao modelo.
A revisão interactiva (filtros por severidade, excerto do código por achado, «Fix with AI», «Dismiss») é a
mesma no painel e na tab `creview` (o «Open as tab»); as acções da revisão levam `caminho|valor` no `data-on`.
Os 3 goldens da tab de Code review foram regenerados de propósito nesta mudança (ecrã novo pedido pelo
dono); os do «Under the hood» não mudaram. Testes: `tests/codereview.doc.test.ts`.

Nota: ao contrário do Co-Dev,
o markup (`renderCreviewView`/`renderHoodView`) vive no resíduo de composição
`features/codereview.ts`, não num `ui/*-view.ts` — por isso `ui/` só tem
`actions.ts`. A tabela de acções fica no resíduo (único sítio com o bridge à mão).

## Terceira feature extraída: Source Control + motor git (`ui-app/src/features/scm/`)

Terceira aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4
concluídas). Mesmas camadas e regra de dependências:

```
features/scm/
  domain/          types.ts, graph.ts (computeGraphLayout — lanes do DAG),
                   status.ts (statusOf/listChanges), gitflow.ts (isFlow/slug),
                   author.ts (resolveAuthor). PURO.
  application/     ports.ts + scm-engine.ts (makeScmEngine: gitInit/commit[v4]/
                   commitV2/checkout/gitMerge/gfStart/gfFinish/stage/discard, deps
                   injectadas; Date.now/Math.random como clock/ids; `store.repo()` e a
                   porta `flow` — ver abaixo).
  ui/              actions.ts (1 listener delegado: data-action + data-on).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/scm.ts    RESÍDUO strangler + raiz de composição: DONO do estado (GIT/LANE/
                   STAGED/BRANCH/COMMIT_MSG/COMMITS/AUTHOR/GSEL) e do DOM
                   (renderScmPane/gfGuide/gfPrompt/pickBranch/drawTimeline/openGraph);
                   compõe o motor com os adaptadores do bridge e re-publica os shims
                   window.* (app.ts/v5/v6/bridge/pair + VIEW.graph/XC.git/checkpoint
                   ainda resolvem o motor por global).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o codereview, o markup vive
no resíduo de composição `features/scm.ts` e `ui/` só tem `actions.ts`. **Sem git simulado
(ADR-0006, R1d):** `gitInit` dá um modelo VAZIO (sem ramo nem commits); só há repositório
quando `store.repo()` — no desktop `DXR.git` (a pasta aberta é um repo), no browser nunca.
Sem repo, commit/checkout/merge/gitflow recusam com aviso e o pane diz-o (com `git init` no
desktop com pasta); com repo, o motor é o espelho optimista e o git real vem da porta
`desktopPorts.scm` (platform/desktop/git.ts; o `syncGit` reconstrói o DAG do `git log`).
GOTCHA-commit: o botão «Commit» usa o commit v2 (`window.commit`); o Ctrl+Enter e os
auto-commits (board, terminal, agentes) usam o v4 git-aware (`window.commitGit`); no desktop
OS DOIS passam pela porta (commit real), tal como checkout/gitMerge/gfStart/gfFinish. As
acções do pane (commit, ramos, Ctrl+Enter, prompt e fim do gitflow) chamam as versões
PUBLICADAS (A0.5, docs/v2/UI-AUDIT.md: o bug aberto desde f07dbc1 está fechado), e o gitflow do motor (`gfStart`/`gfFinish`)
encadeia checkout/merge pela porta `flow`, ligada às mesmas — nunca às locais. Rede
de segurança em `tests/scm.golden.test.ts` (goldens do pane + caracterização do motor sobre
o histórico da fixture `tests/fixtures/sample-history.ts`, que o harness aplica com
`REPO=true`), `tests/scm.norepo.test.ts` (sem repositório + ligação do gitflow),
`tests/scm.desktop-port.test.ts` (cada entrada do pane consulta a porta desktop) e
`tests/scm.domain.test.ts` (domínio puro).

### Git real da r23 F3 (`features/scm/`, `tutor_eval::gitwork`)

O Commit Graph saiu de `features/graph.ts` para `features/scm/` (`domain/refs.ts`, `search.ts`, `activity.ts`,
`conflicts.ts`; `application/graph-screen.ts`, `hunks.ts`, `undo.ts`, `merge3.ts`; `ui/graph-view.ts`,
`hunks-view.ts`, `merge3-view.ts`; composição em `graph-screen.ts` e `extras.ts`). O backend é o módulo
`crates/tutor-eval/src/gitwork.rs` (refs, hunks, undo, previsão de conflitos, merge): git CLI e saída de máquina,
com testes contra repositórios reais. Regras:
- Tudo o que muda o repositório fora do editor passa por `approved(…)` (diálogo partilhado + `audit_record`
  antes e com o resultado); o commit, o checkout e o merge locais não pedem aprovação porque o undo os repõe.
- Antes de cada operação, `undo.snapshot(rótulo)` (refs em `refs/dxtutor/undo/<n>`).
- O commit do desktop respeita o índice (hunks em stage); a UI de hunks e o undo só aparecem no desktop com
  repositório, por isso os goldens do pane não mudam.
- F3b: sync (`git_sync_plan`/`git_sync`, nunca `--force`, o backend só corre o comando aprovado), o módulo
  `tutor_eval::gh` (só leitura; sem `gh` diz «not installed») com o Launchpad, o ciclo de vida do commit (tabela
  `test_results` na base do Project, migração 8, gravada pelo Testing), o Commit Composer (`git_commit_paths`) e as
  lanes (`git_lane_commit`, sem checkout) atrás de «Git: Lanes (experimental) on/off», desligadas por omissão.

## Quarta feature extraída: Run and Debug (`ui-app/src/features/debug/`)

Quarta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Mesmas camadas e regra de dependências:

```
features/debug/
  domain/          breakpoints.ts (bpKey/bpLine/bpPath). PURO.
  application/     ports.ts + debug-engine.ts (makeDebugEngine: startDebug/dbgStep/dbgStop/
                   toggleBp, deps injectadas; store/editor/shell/view/notifier).
  ui/              actions.ts (1 listener delegado: data-action + data-on; chave própria).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/debug.ts  RESÍDUO strangler + raiz de composição: DONO do estado (BPS, window-
                   backed) e do DOM (drawDbg/refreshDbg/renderDebugPane); compõe o motor
                   com os adaptadores do bridge, tem a tabela ACTIONS, e re-publica os shims
                   window.* (keydown/menus de v6 + a fachada dbgBreaks que o editor lê).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o scm, o markup vive no
resíduo `features/debug.ts` e `ui/` só tem `actions.ts`. **Depuração real (ADR-0006, R4;
as sessões simuladas saíram na R1c2):** o motor é o gdb do backend (`debug_*`, adaptador
`infrastructure/tauri.ts`). F5 escolhe o programa (num projecto/workspace Cargo, `cargo
build` e o binário em `target/debug/` — `domain/session.ts::cargoTargets`; noutro, o
caminho do executável), lança o gdb, põe os breakpoints do gutter e corre; parado, o pane
mostra onde, as variáveis locais e a pilha, o editor pinta a linha (`dbgCurrent`), e
Continue/Step over (F10)/Step into (F11)/Stop (Shift+F5) seguem para o gdb. Sem gdb, di-lo
(com o que instalar). Os containers `#pane-debug`/`#pc-dbg` nascem no `boot6` (no `app/boot-steps.ts`
desde a U4j5c; o arranque não corre no harness) e são reproduzidos como fixtures no golden.
Rede de segurança em `tests/debug.golden.test.ts` (goldens do pane/assistente sem sessão e
com breakpoints, a sessão real com IPC falso — construir, lançar, breakpoints, parar,
variáveis, passo, fim —, sem gdb, sem binários, erro do gdb, e o dispatch dos breakpoints)
e `tests/debug.domain.test.ts` (domínio puro).

### Depurador real da r23 F2a (`features/debug/`, `tutor_eval::dapc`)

O que o adaptador sabe fazer vem do `initialize` (`dapc::SessionCaps` no `LaunchInfo.caps`) e o que o host
sabe fazer do `debug_capabilities` (adaptador; `timeTravel` com o motivo: Linux, rr, gdb, `perf_event_paranoid`
≤ 1), perguntado uma vez ao abrir a pasta. A barra flutuante (`ui/toolbar.ts`, `#dbg-tb`, arrastável) mostra só
os controlos que funcionam (`domain/caps.ts::toolbarFor`) e lista os outros com o motivo; o lldb-dap não tem
`restartFrame` nem `stepBack`, por isso «Restart frame» e andar para trás ficam escondidos até ao rr (F2b).
Regras:
- Comandos novos: `debug_run_to` (breakpoint temporário + continue), `debug_restart_frame`, `debug_data_breakpoints`
  (`dataBreakpointInfo` + `setDataBreakpoints`; o lldb-dap pára com `reason: "breakpoint"` e `description: "watchpoint N"`),
  `debug_read_memory`, `debug_exception_filters` (só os que o adaptador oferece; o panic do Rust continua a ser o
  breakpoint de função `rust_panic`) e `debug_test_targets` (`tutor_eval::testbins`: `cargo test --no-run
  --message-format=json` + `--list --format terse`; lança com `--exact <teste> --nocapture`). `debug_launch` ganhou `args`
  e `debug_evaluate` o `context` (`repl` na consola: o lldb responde `(int) $0 = 3`).
- A consola diz «may run code»: o DAP não garante avaliação sem efeitos (decisão Q5 do AUDIT-r23). As definições
  de excepção são o panic e os filtros do adaptador; «`Err` por `?`» não existe.
- Triggered e grupos: o DAP não os tem; o cliente só envia um breakpoint com `trigger` depois de o programa parar
  no trigger (`armed`, por sessão) e não envia os de um grupo desligado (`bpActive`). Guardam-se na base do
  Project (migração 9: `breakpoints.trigger_on`, `grp`); o resto das definições (watches, grupos desligados, Just My
  Code, filtros, histórico da consola) no LS por pasta (`dbgcfg:<root>`).
- Parado numa biblioteca (um panic pára no `rust_panic`), o Just My Code selecciona o primeiro frame do projecto; o
  `dbgCurrent` e as inline values seguem o frame seleccionado. O pânico lê-se da saída do programa
  (`domain/exception.ts`) e o cartão `#dbg-exc` vive na `.ed-wrap` por baixo da linha. O Co-Dev recebe os
  contextos `frame` e `panic` (decisão Q3).
- GOTCHA-ordem: o `dx:workspace` do debug pergunta as capacidades num `setTimeout(0)` — o quadro carrega primeiro
  (`board.persist.test`) — e a sessão gdb não faz chamadas novas (`debug.golden.test` fixa a sequência).
- Testes: `cargo test -p tutor-eval dapc testbins dap::` (sessões reais com o lldb-dap e um projecto Cargo real),
  `tests/debug.r23.test.ts` e o passo `debugR23` do auto-teste (o teste da cache LRU do brief falha no depurador, a
  correcção `pop_front`, run to cursor, e passa).

### Gravar e reproduzir da r23 F2b (`tutor_eval::rr`, `dapc::DapSession::replay`)

O rr grava (`rr record --bind-to-cpu=<primeiro núcleo P>`: num Intel híbrido o contador de saltos que o rr usa só
existe na PMU `cpu_core`; o rr < 5.9 não conhece o Meteor Lake) e serve a gravação (`rr replay -s 0`); o gdb em
modo DAP (`gdb -i dap -x <rr gdbinit>`, `attach {program, target}`) conduz a reprodução pelo mesmo `dapc`. O
`debug_capabilities` faz uma gravação de teste uma vez por execução (`rr::probe`): sem ela, `rr-cannot-record`
com as palavras do rr. Medido no spike e nos testes reais (`dapc::tests::real_replay_with_rr`):
- O gdb 15 em DAP NÃO tem `stepBack`/`reverseContinue`: andar para trás é a consola (`reverse-next`, `-step`,
  `-finish`, `-continue`); a posição é o `when`/`when-ticks` do rr; o `seek-ticks` do rr precisa de
  `extended-remote` (o `attach` do DAP liga com `target remote`), por isso viajar é um breakpoint temporário no
  sítio da paragem (frame 0) — ou, para uma escrita, o watchpoint no endereço (`*(0x… as *mut usize)`), porque um
  watchpoint pára a meio da linha — até o momento bater.
- GOTCHA-ticks: os ticks do rr são POR THREAD (medido: recuar até antes da thread do teste salta de 1179 para
  118907). Um momento é `(evento, ticks)`: o evento é global e, dentro dele, só corre uma thread.
- GOTCHA-SIGPIPE: o `rr replay` escreve a saída do programa reproduzido no SEU stdout; fechar esse pipe mata o rr
  no primeiro `printf` («Remote connection closed»). O `ReplayServer` drena-o sempre e manda as linhas à consola.
- O panic: o gdb só resolve `__rustc::rust_panic` (o lldb `rust_panic`); o «parar em panic» envia os dois.
- Um watchpoint (`watch -l`) vigia o ENDEREÇO: antes da função começar e depois de sair, outro código usa-o; as
  consultas contam uma escrita enquanto o frame dono da variável está na pilha (a escrita pode estar num método
  chamado: `c.order` muda dentro de `VecDeque::push_back` via `&mut self`) e param quando ele sai; nunca dão
  `continue` no fim da gravação (fecha a ligação do rr). Só pára quando o valor MUDA. O valor lê-se por `print *$N` (o `&expr` guardado), porque onde se escreve o nome
  pode não existir (`self` em vez de `c`). Para trás, a paragem mostra o valor de antes: as mudanças registam-se
  no caminho para a frente.
- A reprodução começa, para o humano, em `main` (um breakpoint-guarda); no fim, `continue` fica no fim.
- Um erro numa consulta ou viagem não fecha a reprodução (`guarded(…, keep)`).
- Testes: `cargo test -p tutor-eval -- rr:: dapc::`, `tests/debug.rr.test.ts` e o passo `debugRR` do auto-teste.

## Quinta feature extraída: backlog, sprints e kanban (`ui-app/src/features/board/`)

Quinta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Mesmas camadas e regra de dependências:

```
features/board/
  domain/          slug.ts (slug), issue.ts (STAGES + fábrica makeIssue),
                   kanban.ts (selectores inView/points/nodeStatus/autoSprint/
                   sprintCounts), types.ts. PURO.
  application/     ports.ts + board-engine.ts (makeBoardEngine: mkIssue/setStage/
                   autoTest/runIssue/delegate/runSprint/approveIssue/rejectIssue/
                   dropIssue/newIssue/openBoard/genBacklog/genBacklogIssues; deps
                   injectadas por 15 portas; handles opacos → toolResult/cardAppend/
                   cardSet — o motor NÃO toca window nem DOM).
  ui/              actions.ts (1 listener delegado: data-action + data-on; chave
                   própria __boardActionHandler__).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/board.ts  RESÍDUO strangler + raiz de composição: DONO do estado (BL/STAGES,
                   window-backed) e do DOM (renderBoardView); compõe o motor com os
                   adaptadores do bridge, tem a tabela ACTIONS, e re-publica os shims
                   window.* (onclick/VIEW.board de v5/v6 + o catálogo/geradores do
                   monólito que FICAM: composeYaml/appFiles/k8s*/cloudMap + TECH/KIND/
                   CLOUD/isApp/sl/appDir — decisão do dono; desde a U7c/U7d do ADR-0004 os
                   geradores são exports de features/generators.ts e o CLOUD/validateDesign/usd/
                   codeGuard/TASKP chegam à ponte por import, não pelo window).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como o scm/debug, o markup vive no
resíduo e `ui/` só tem `actions.ts`. GOTCHA-decoração: `runIssue`/`delegate`/`runSprint`/
`approveIssue` publicam-se já COMPOSTAS com as políticas que antes eram decorações do
app.ts/v5/v6 (Studio, revisão/explicação, `codeGuard`, dono humano, custo — ADR-0004 U4g3) — as arestas internas e os handlers data-action
resolvem a versão do `window` no acto (`decorated*` do bridge), nunca a função local base.
O `VIEW.board` composto regista-se no board.ts; `renderBoardView` é o corpo base (goldens). O ARRASTAR dos cartões
(`board:card`/`board:col`) vai pelo despachante partilhado desde a U5d do ADR-0004 — os goldens do
quadro foram regenerados nessa altura (decisão do dono; o diff foi só a remoção dos 44 atributos
`ondrag*`/`ondrop`). Rede de segurança em
`tests/board.golden.test.ts` (goldens do pane vazio/povoado, caracterização de
genBacklogIssues/mkIssue, testes de dispatch delegado — o «Delegar» com agente falso) e
`tests/board.domain.test.ts` (domínio puro). **Sem runner guionado (ADR-0006, R3a):** correr
uma issue (Delegar, Sprint, ⚡ Agente) é ramo gitflow → o agente real implementa-a (porta
`agent`, `codevAgentStory`, modo plano) → commit do que mudou → os testes do projecto
(`projectTests`) → «Validação funcional» ou volta a desenvolvimento; a porta `scm.settle()`
espera pela fila git/disco do desktop entre os passos. Sem agente, di-lo. Saíram os
produtores `gen`/`fix` (templates dos geradores), os testes-predicado, o router e as pausas
encenadas — e com eles o bug do `sleep(380)` global. O «Gerar backlog» do Studio cria issues
só com o enunciado e o contexto do desenho na nota. **Backlog por pasta (R3b):** no desktop com pasta, o
quadro carrega-se do backend ao abrir a pasta (`board_load`) e grava-se quando muda
(`board_save`, por detecção de mudança com debounce — `board/domain/persist.ts` mapeia
Issue ↔ Story, o que não tem coluna vai em `meta`); no browser fica em memória. **Equipa do
projecto (R3c):** os escopos dos assistentes (onde escrevem, que comandos correm) derivam-se
da estrutura da pasta aberta (`features/team-scopes.ts`, pura) e o `.dxtutor/team.json` do
projecto manda; gravar a equipa escreve-o lá (sem pasta, no LS). O custo das issues vem do uso
real do agente (porta `onUsage` do agente v2 → contador de uso e `ctx`).

## Multi Co-Dev — o plano paralelo da sprint (Project, fase 1)

Assenta no Project (`board.sqlite3`, `crates/tutor-board/src/project/`), não no quadro Tasks. A sprint guarda
quantos Co-Devs a trabalham (`sprints.codevs`, migração 14, `Op::SetSprintCodevs`, 1–8). O planeador puro
`tutor_board::project::plan::plan_sprint` reparte as issues Ready da sprint por N lanes (uma por Co-Dev) em ondas:
uma issue só começa depois das dependências (onda anterior ou Done) e duas issues que se SOBREPÕEM nunca partilham
uma onda — a segunda fica em série. Sobrepõem-se quando um ficheiro pode ser mudado pelas duas: um ficheiro da pasta
(ou conhecido: change sets, commits ligados, ramo da issue, conflitos do `merge-tree`) apanhado por um glob do âmbito
de cada uma (as regras do `scope_matches` das permissões do Co-Dev, reimplementadas sem regex), ou conhecido das duas;
uma entrada literal conta como ficheiro antes de existir. Dentro da onda, a issue mais pesada vai para a lane com menos
pontos; determinístico (prioridade, rank, chave). Fica de fora, com motivo: não Ready (as dependências à parte), já no
fluxo, dependência que não está em Done nem no plano, ciclo, sobreposição com uma issue no fluxo. O comando
`project_sprint_plan` (SÓ LEITURA) junta a pasta (`tutor_agent::issue_prompt::project_files`, com o `.gitignore`) e o git
(`gitwork::branch_files`/`commit_files`/`predict_conflicts`); a UI desenha-o no Planning (`ui/plan-view.ts`, «Parallel
plan»). Testes: `cargo test -p tutor-board plan`, `board::tests::the_sprint_plan_…` e `tests/project.plan.test.ts`.
Fases seguintes: (2) uma sessão de Co-Dev por lane na UI; (3) uma worktree e ficheiros reservados por Co-Dev; (4) o
«Co-Dev reviewer» assistido, que revê cada merge request e integra num worktree temporário só com os testes a passar e
sem partir o ramo por omissão (sem conflitos, regras do arquitecto); (5) autonomia delegada pelo humano e PRs.

## Sexta feature extraída: Visualize execution (`ui-app/src/features/visualizer/`)

Sexta aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas).
Um pipeline de compilador de um subconjunto de Rust + um overlay de execução
passo-a-passo. Mesmas camadas e regra de dependências:

```
features/visualizer/
  domain/          lexer.ts (vzLex+vzErr), parser.ts (vzParse→AST {fns}), hints.ts
                   (vzHints), narrate.ts (vzTell+VZSEEN, importa esc do core),
                   samples.ts (VZS), constants.ts (VZSZ/VZR/hex), types.ts. PURO.
                   interpreter.ts (vzRun + modelo de memória) — tipado desde a U4i3 do
                   ADR-0004 (o escalar `v` do valor fica `VzScalar = any`, o único any
                   deliberado). PURO (A7/A8 verdes).
  application/     ports.ts (VisualizePorts {run,narrate,resetSeen}) + visualize.ts
                   (buildVisualization: resetSeen→run→constrói notas; deps injectadas).
  ui/              actions.ts (bindActions: 1 listener delegado; guard no document, não
                   window; chave própria __vizActionHandler__).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/visualizer.ts  RESÍDUO strangler (tipado desde a U4i2 do ADR-0004; FORA da subárvore) + raiz de
                   composição: DONO do overlay (vizOpen/vzRender/vzArrows/vzGo/vzPlay/…)
                   e do boot7 (decora VIEW.lt/VIEW.hood, EACT/MENUS/CMD); importa o motor
                   do domínio e o caso de uso, constrói a TABELA de acções (data-action)
                   e re-publica os shims window.* (boot7/VZ/VZS/viz*/vz* — startup.ts,
                   i18n e onclick inline resolvem por global).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Como scm/debug/board, o overlay/markup
vive no resíduo e `ui/` só tem `actions.ts`. Particularidades: (1) o motor é PURO e
auto-suficiente → `application/` não tem porta de infraestrutura (só injecta funções do
domínio); (2) o overlay injecta o seu próprio `#viz` no `document.body` e decora
`VIEW.lt`/`VIEW.hood` (shims do app.ts/registo do codereview) só em `boot7` (não corre no harness) — por
isso o golden caracteriza o overlay via `vizOpen` com fonte explícita, sem fixtures;
(3) `interpreter.ts` usa os bytes de controlo `U+0000`/`U+0001` como sentinelas no `fmt`
(não mexer). Rede de segurança em `tests/visualizer.golden.test.ts`: 14 snapshots (motor
puro vzLex/vzParse/vzHints/vzRun/vzTell + overlay `#viz`) + 6 testes de dispatch delegado
(o golden strippa data-action → não prova o wiring).

## Sétima feature extraída: Infra (`ui-app/src/features/infra/`)

Sétima aplicação do procedimento `extract-feature` (ADR-0002, Fases 0–4 concluídas) e
o ÚLTIMO resíduo @ts-nocheck de feature. Dois motores num só pane: runtime de
contentores / dev-container / Kubernetes + environments / drift / observabilidade.
Decisão do dono: a subárvore nasce INTEIRAMENTE TIPADA (nenhum `@ts-nocheck` novo; A6
fica 8). Mesmas camadas e regra de dependências:

```
features/infra/
  domain/          types.ts, constants.ts (RTN/KCTX/ENVL/DSTY + defaultEnvs/Envx),
                   kubernetes.ts (projectContext/devcontainerJson/appEnv/k8sInfra/k8sDocs),
                   secrets.ts (urlHosts/designApps/dbSlugs/localSecrets/deriveSecrets/
                   secretCheck), environments.ts (envDeps/envStateOf/envHealthOf/
                   driftReport/commitsBetween), observability.ts (seeded/spark/obsLine/
                   buildObs — relógio injectado). PURO e TIPADO; recebe o mundo por arg.
  application/     ports.ts (State/CatalogPort/Workspace/Scm/Persist/Terminal/Nav/
                   Notifier/View/Clock) + infra-engine.ts (makeInfraEngine: orquestração
                   rtConnect/k8sConnect/dcAttach/dxDeploy/k8sScale/k8sDown/promote/
                   redeployEnv/initSecrets/envState/driftReport/… + wrappers dos
                   geradores; deps injectadas; hidratação de LS preguiçosa em closure).
  ui/              actions.ts (1 listener delegado: data-action + data-on; chave própria
                   __infraActionHandler__).
  infrastructure/  legacy-bridge.ts — ÚNICO ficheiro que toca window.*.
features/infra.ts  RESÍDUO strangler (tipado desde a U4i1 do ADR-0004; FORA da subárvore) + raiz de composição:
                   DONO do estado (ENVS/ENVX/K8S/DEVC/OBS window-backed) e do DOM
                   (renderInfraPane base v5+decoração v6 dobradas, renderEnvsView,
                   renderObserveView, drawRemote/infraDraw, cache OBS/polling); compõe o
                   motor com os adaptadores do bridge, tem a tabela ACTIONS, e re-publica
                   os shims window.* (envPrime/envDrift/envDriftStyle; rtConnect/k8sConnect/
                   dxDeploy publicados consultam a porta desktopPorts.infra (U4h4), e dcAttach/dcDetach/
                   k8sScale/k8sDown também (ADR-0006 R5b: sessão devcontainer_session_* e kubectl
                   reais; no browser não fingem); os ambientes staging/production lêem-se e
                   promovem-se pela porta EnvCluster (desktopPorts.infra.cluster, R5c1: kubectl
                   get/apply -f - com os segredos do ambiente) e a observabilidade pela porta
                   ObsSource (desktopPorts.infra.obs, R5c2: stats/compose logs, kubectl top/logs;
                   sem séries semeadas) — ACTIONS chama window.X).
```

Governada pelas mesmas A7/A8 (está em `FEATURES`). Particularidades: (1) o domínio é
TODO tipado — interfaces locais (Design/TechSpec/KindSpec/K8sState/Secrets/…) no centro,
os `any`/casts das formas opacas do monólito confinam-se ao bridge; (2) o `#pane-infra` nasce no `boot5`
(no `app/boot-steps.ts` desde a U4j5c), que não corre no harness → `infra.golden.test.ts` reproduz esta
fixture (e o antigo shim `RP.infra`) em `provideFixtures()`; (3) o estado window-backed PERSISTE entre testes no
jsdom mas a reavaliação de `infra.ts` reassigna `window.ENVS/ENVX/K8S/…` por `bootApp`;
LS é inoperante em headless (persistência é porta de infra, não se caracteriza). Rede de
segurança em `tests/infra.golden.test.ts` (3 goldens de #pane-infra + caracterização do
motor runtime/K8s/secrets/drift/obs + 6 testes de dispatch delegado) e
`tests/infra.domain.test.ts` (domínio puro, fixture sintética de design+catálogo).

## Oitava feature: painel inferior real (`ui-app/src/features/panel/`)

Não é uma extracção do monólito: é a feature NOVA que, **só na app desktop**, substitui a
demo do painel inferior por dados reais do workspace (sessão `develop-painel-inferior`).
Nasceu tipada e em camadas (governada por A7/A8):

```
features/panel/
  domain/          types.ts, shell-integration.ts (OSC 633/OSC 7), links.ts (ficheiro:linha,
                   URLs), problems.ts (agrupar/filtrar/juntar LSP), naming.ts. PURO.
  application/     ports.ts + terminals.ts (instâncias, grupos de divisão, tarefas com código
                   de saída real, histórico de comandos), problems-service.ts (scan em voo
                   único + debounce), output.ts (canais).
  ui/              terminal-view.ts (xterm.js), problems/output/services/assistant-view.ts,
                   actions.ts (chave __panelActionHandler__).
  infrastructure/  tauri.ts (pty_*, problems_scan, ports_list, eventos) + legacy-bridge.ts
                   (ÚNICO com window: DXR/FS/openPath; publica DXR.term, termOwnsKey,
                   diagnostics/drawProblems/drawStack reais).
  index.ts         raiz de composição; só arranca com `isDesktop()`.
```

Backend: `pty.rs` (várias sessões por id, UTF-8 inteiro entre leituras, código de saída),
`shell_integration.rs` (bash `--init-file` com marcador `PS0`; zsh `ZDOTDIR`), `shellenv.rs`
(ambiente da shell de login, para os checkers verem o node do nvm/cargo do rustup),
`problems.rs` (cargo check/tsc/go vet/ruff/eslint → Problem; eslint segue o script `lint`
do `package.json`), `ports.rs` (`/proc/net/tcp`), `commands/panel.rs`.
Particularidades: (1) não entra no harness de goldens — o caminho do browser/testes continua
a demo e os goldens ficam intactos; a rede é `tests/panel.{domain,application}.test.ts` +
o passo `panel` do auto-teste desktop (`platform/desktop/selftest.ts`: PTY real, /dev/pts,
integração de shell, scan); (2) `runInTerm` (`platform/desktop/terminal.ts`) delega em `DXR.term.runTask` (tarefas num PTY); o terminal de
linha `#term` fica para o terminal partilhado do PairCode; (3) `features/shortcuts.ts` chama
`termOwnsKey(e)` nos atalhos globais — com o foco no xterm, as teclas são da shell excepto
a lista curta de `isAppKey` (estilo `commandsToSkipShell` do VS Code).

## A camada desktop (`ui-app/src/platform/desktop/`, ADR-0004 U4h)

O que só existe na app Tauri (pastas no disco, autosave, terminal e git reais, modelos reais,
docker/kubectl) vive em `platform/desktop/`: `context.ts` (os clientes IPC, o objecto `R` =
`window.DXR`, processos `sh`/`git`/`stream`, a fila `enqueue`/`idle`, e os serviços tardios
`ctx.flushSave`/`ctx.syncGit`/`ctx.envFor`/`ctx.runInTerm`/… que cada módulo preenche) e um
módulo por área com um `install<Área>(ctx)` (terminal, workspace, git, llm, agent-tasks,
infra, remote, ext; o `demos` saiu na R3a do ADR-0006) + `selftest.ts`. O `bridge.ts` é só a composição: sai no browser, cria o
contexto, instala os módulos pela ordem das antigas secções (a ordem dos efeitos no eval
importa) e corre o arranque. Regra ao mexer: um módulo usa os serviços de outro SEMPRE por
`ctx.x(...)` no acto (nunca capturado no install), e nada de nomes soltos que resolvam para
um global por acaso. A U4h1 só mudou o código de sítio; a partir da U4h2 cada decoração
`window.X = …` passa a uma PORTA definida pela feature dona (`application/ports.ts`) e
registada em `app/desktop.ts` (`desktopPorts.<feature>`): o dono consulta-a no acto, nas
versões que publica, e a porta recebe a versão simulada como último argumento. Já migrado:
`scm` (commit/checkout/gitMerge/gfFinish — U4h2), `terminal` (run/termExec/promptHTML — U4h3), `stack` (dxRun/dxStop/drawStack) e `infra`
(rtConnect/k8sConnect/dxDeploy/VIEW.observe) — U4h4, `codev` (updateAgentUI/testProv/provState/
VIEW.settings/runMission) e `board` (runSprint) — U4h5a. O `SAMPLE`/`LIVE_OK` são estado que o
desktop configura (não decorações). `explorer` (syncTree), `welcome` (VIEW.welcome), `changelog`
(clLog/clShow) e `ext` (loadJSZip) — U4h5b. Ficam como CONTRIBUIÇÕES do desktop (não portas):
os itens do menu File, as entradas da paleta e o Ctrl+O — dissolvem-se quando as features
registarem os seus comandos (U7).

## Acções delegadas partilhadas (`ui-app/src/app/actions.ts`, ADR-0004 U5)

Os módulos sem despachante próprio emitem `data-action="dono:nome"` (+ `data-on`, o único payload —
os goldens tiram exactamente `data-action`/`data-on`) e registam a tabela com `registerActions`. O
despachante é o PRIMEIRO listener do document (primeiro import do `main.ts`) e imita o handler
inline: corre os antepassados com acção pela ordem da borbulha, `c.stop()` = `event.stopPropagation()`,
cede a um `el.onclick = f` posterior e a controlos desactivados. As acções chamam as funções
publicadas no acto (`callGlobal`) — não troques por ligações locais sem ver se alguém decora a
publicada. Handlers inline novos não: a métrica U5 do `ui-metrics.sh` está em 0, e desde a U5e o
CSP da app (`script-src 'self'`, sem `'unsafe-inline'`) bloqueava-os de qualquer forma. O passo `csp`
do auto-teste desktop prova-o na app real.

## CSS por feature (`ui-app/src/app/styles.ts`, ADR-0004 U6a)

Não há `public/styles.css` (partiu-se na U6a). Os tokens estão em `app/styles/theme.css`, a base partilhada
(reset, controlos, `.mini`/`.btn`/`.inp`/`.tag`/`.pcard`/`.tbl`/`.scm-row`, diálogo) em `app/styles/base.css`,
a moldura (barra de título, menus, actividade, painel lateral e inferior, barra de estado) em
`features/shell.css`, e cada feature no seu ficheiro (`features/<f>/styles.css` ou `features/<f>.css`).
Uma regra nova vai para o ficheiro do dono. O `src/app/styles.ts` lista-os pela ORDEM DA CASCATA: só conta
quando duas regras com a mesma especificidade em ficheiros diferentes disputam a mesma propriedade do mesmo
elemento. Um ramo que ainda edite o `public/styles.css` dá conflito modificado/apagado ao juntar-se:
mantém-se o apagado e as regras novas vão para o ficheiro do dono.

## Textos por chave (`ui-app/src/app/i18n.ts`, ADR-0004 U6b)

Texto novo da interface nasce com chave: um catálogo tipado por feature (`en` + `ptAO`, dados puros — p.ex.
`features/scm/ui/messages.ts`) e `const t = translator(CATÁLOGO)` no módulo que desenha. Nada de pares novos no
motor (`features/i18n.ts`, `PAIRS`): a métrica U6 do `ui-metrics.sh` só desce. Mudar de língua recarrega a interface
(U6c lote 3), por isso um par que só sirva texto migrado sai do motor (vai para `tests/fixtures/i18n-pruned-pairs.json`,
que continua a provar o catálogo). Ao migrar texto existente, os
valores do catálogo são os que o motor produzia (gera-os com `trText`); `tests/i18n.catalogs.test.ts` confirma-os
e os goldens provam o inglês. Parâmetros entram tal e qual — escapa-os (`esc`) se forem para HTML.
Texto emitido por `domain/`/`application/` não importa o `translator` (lê o `window`): o motor recebe uma porta
`copy(chave)` declarada no seu `ports.ts`, com o catálogo em `application/messages.ts`, e a composição injecta
`translator(CATÁLOGO)` (é assim no quadro e na infra). Catálogos de texto NOVO (sem par no motor) ficam num
ficheiro à parte (p.ex. `git-messages.ts`): o teste verifica-lhes só a estrutura.

## Globais e o registo de serviços (`ui-app/src/app/services.ts`, ADR-0004 U7)

Função ou estado de outro módulo lê-se por **import**, não pelo `window`; nada de `Object.assign(window, …)` novo
(a métrica U7 do `ui-metrics.sh` só desce e o A9 do `arch-check` reprova um ficheiro novo que publique). O que
ainda fica no `window`, e que sessão o desbloqueia, está no ADR-0004 («U7 — fecho»). A ordem de avaliação do `main.ts` conta: um import puxa a avaliação do
dono para mais cedo e troca a ordem dos efeitos. Se o dono avalia DEPOIS do leitor, o dono regista a sua API em
`services` (tipada por `import type`, que não muda a ordem) e o leitor chama-a no acto (`services.team!.isHuman(…)`),
nunca ao avaliar. Nos testes, o módulo vem fresco da cadeia do `bootApp` (`M = await import(…)` depois dele), não do
`window`. Antes de despublicar um nome, procura também os acessos dinâmicos (`callGlobal("x")`, `globalCalls`,
`window[nome]`) e os testes de outras sessões que o troquem.

## Learning Track + plugins de curso (`ui-app/src/features/learn/`, `crates/tutor-plugins/`)

ADR-0005. Os cursos de linguagem são **plugins** (dados, não código): um repo GitHub com
`dxtutor-plugin.json` + cursos no formato `tutor_core::Course` (TOML/JSON), com
`Course.overview` e `Unit.concepts` (o texto de leitura de cada tópico). Os oficiais vivem em
`github.com/ngolacloud/dxtutor-course-<id>`. O catálogo oficial tem no máximo 10 linguagens
(`learn/domain/catalog.ts`): rust, go, python, typescript, java, kotlin, swift, csharp,
cpp, sql.

- **Fonte única dos cursos Rust/Go: `courses/<id>/`** (plugin oficial completo, publicado em
  `ngolacloud/dxtutor-course-<id>` com `scripts/publish-course.sh`). O `tutor-core` embute o TOML. O JSON
  da UI (`ui-app/src/content/courses/*.json`) é **gerado**: editar só o TOML e correr
  `python3 scripts/sync-ui-courses.py`. O teste `crates/tutor-core/tests/ui_json.rs` falha se
  divergirem.
- A avaliação procura o passo por **(linguagem, id)** (`submit_step` com `language`), porque Rust e
  Go repetem ids de passo. Um plugin com o mesmo id de curso de um embutido substitui-o.
- As 8 linguagens novas (**Python**, **C++**, **TypeScript**, **SQL**, **Java**, **Kotlin**, **C#** e **Swift**, em `courses/<id>/`) estão embutidas só no backend: o browser não traz o JSON. São avaliados
  pelos descritores embutidos em `crates/tutor-eval/src/plugin.rs` (Python com `unittest`; C++ com um mini-framework `TEST`/`CHECK`; TypeScript no Node com `dxt.test`; SQL no SQLite do Python com `query`/`script`; Java no source launcher do JDK 21 com `test(...)`; Kotlin com `kotlinc` e coroutines; C# com o Roslyn do SDK do .NET 8; Swift com `swiftc` em modo Swift 6). As linguagens novas
  seguem a mesma receita: um descritor ou runner, um curso, e `dxt plugin test courses/<id>`
  com 0 falhas antes de commitar.
- `crates/tutor-plugins` — manifesto, validação, origem, instalação e registo. É partilhado
  pelos comandos Tauri `plugin_*` (`commands/plugins.rs`) e pelo `dxt plugin …` (tutor-cli).
- `src-tauri/src/study.rs::all_courses()` — fonte única de cursos (embutidos + plugins, em
  cache pelo mtime do registo). Nunca chamar `tutor_core::builtin_courses()` directamente no
  backend.
- `features/learn/` (governada por A7/A8, tipada): `domain/` (catalog, course-adapter), `application/`
  (CourseGateway + catalog-service), `ui/actions.ts`, `infrastructure/legacy-bridge.ts`. O
  resíduo `features/learn.ts` é dono do DOM e do motor. Rust/Go embutidos continuam com
  avaliação simulada no browser; os cursos do backend usam `submit_step` real.
- Testes: `cargo test -p tutor-plugins`, `ui-app/tests/learn.domain.test.ts`,
  `learn.onboarding.test.ts`. Guia de autoria: `docs/plugins/README.md`.

## Extensões VS Code — contribuições declarativas (ADR-0005, Fase 4)

Não há extension host: o JavaScript de uma extensão nunca corre. O que um VSIX contribui de
forma declarativa é aplicado por código tipado em `features/ext/`, governado por A7/A8.

- **`domain/`:** `jsonc.ts`, `theme.ts` (tema → CSS confinado a `.ed`), `snippets.ts`,
  `textmate.ts` (tokenizador TextMate «lite», sem Oniguruma: traduz as regex para JS e
  ignora as que não compilam) e `contributions.ts` (ficheiros a ler, linguagens, toggle de
  comentário, `KNOWN_LANGUAGE_SERVERS`).
- **`application/contributions-engine.ts`:** lê o VSIX, guarda (LS `vsx-contrib`) e serve ao
  editor. O resíduo `ext.ts` publica `vsxHighlight` (usado pelo `paintEd`), `vsxSnippet`
  (Tab), `vsxToggleComment` (Ctrl+/), `vsxApplyTheme` e `vsxInstallOpenVsx`.
- **`ui/actions.ts`:** listener delegado da `ext` (chave `__extActionHandler__`). Os botões da
  Fase 4 (`vsx-theme`, `vsx-open-vsx`) e, desde a R6b do ADR-0006, as linhas, o detalhe e o «+»
  usam `data-action`.
- **Sem catálogo fixo (ADR-0006, R6b):** instaladas = VSIX reais; recomendadas = ids reais do Open
  VSX pela pilha (`domain/recommend.ts`); a pesquisa vai ao Open VSX (`vsix_search_open_vsx`,
  desktop); instalar descarrega o VSIX. Error Lens/YAML/Prettier eram código do dxtutor: são as
  funcionalidades «Built into dxtutor» (`window.builtinOn(key)`, lido pelo editor e pelos
  diagnósticos); Shift+Alt+F formata sempre.
- **Backend:** `vsix_fetch_open_vsx` e `vsix_search_open_vsx` (só open-vsx.org) e os servidores LSP das linguagens novas
  em `lsp.rs`.
- **Testes:** `ext.contributions.test.ts`, `ext.contrib-engine.test.ts` e
  `ext.phase4-harness.test.ts`. A página de detalhe só muda para itens VSIX, por isso os
  goldens do catálogo ficam intactos.

## Nona feature: Testing real (`ui-app/src/features/testing/`)

Feature NOVA (ADR-0006, R2a) que substitui `features/test.ts`: o pane «Testing» e o
`#st-tests` sobre os comandos reais do backend. Nasceu tipada e em camadas (governada por A7/A8):

```
features/testing/
  domain/          types.ts (TestItem/TestRun/TestState), results.ts (testKey/groupByFile;
                   parseSuiteOutput — estado de cada teste na saída de «Run all»: cargo
                   `test x ... ok|FAILED|ignored`, go `--- PASS|FAIL|SKIP`, unittest -v;
                   statesAfterSuite/countStates/statusBarText). PURO.
  application/     ports.ts (TestsPort/WorkspacePort) + testing-service.ts (descoberta, uma
                   corrida de cada vez, trocar de pasta descarta resultados em voo).
  ui/              testing-view.ts (markup) + actions.ts (chave __testingActionHandler__).
  infrastructure/  tauri.ts (list_tests/run_test/run_all_tests) + legacy-bridge.ts (ÚNICO com
                   window: DXR.root/projectCmd, openPath, runTask, PANE; publica renderTestPane).
  index.ts         raiz de composição; dona do `#st-tests` (o panel/diagnostics já não o limpam).
```

**Separador «Tests» do painel (2026-11-26):** `domain/live.ts` lê a saída da suite linha a linha (cargo, go -v,
pytest -v, unittest -v, vitest, jest), `application/live-runner.ts` corre-a pelo `DXR.streamCmd` (o `run_shell`
→ `proc-line`, sem Rust novo) e `ui/live-view.ts` desenha-a; o separador nasce na primeira corrida (só desktop,
fora dos goldens). `runLive` está em `services.tests`: o «Accept & test» do Code review e o `run_tests` do Co-Dev
(desktop) correm lá. O parser das falhas (`domain/test-report.ts`) é desta feature.

A descoberta do backend cobre Rust/Go/Python; para o resto (p.ex. `npm test`) o pane mostra o
comando de testes detectado e corre-o num terminal de tarefa. Sem pasta (browser), o pane diz
como abrir uma e nada chama o backend. Rede: `tests/testing.{domain,application,wiring}.test.ts`
(o wiring arranca a cadeia real com um `__TAURI__` falso) + o passo `testing` do selftest
desktop (teste Python real: list_tests → run_all_tests → run_test).

## O editor ligado ao servidor de linguagem (`ui-app/src/features/lsp/`)

Feature nova e tipada, só na app desktop (governada por A7/A8). Até aqui a UI oficial nunca
chamava os comandos `lsp_*` (quem os usava era a `ui-next`, apagada em `e2a89b3`).

- **`domain/`:** `languages.ts` (extensão → `languageId`, alinhado com `LANGS` do `lsp.rs`),
  `positions.ts` (offset ↔ `{line, character}` e ponto do rato → offset, com tabs),
  `results.ts` (hover e definição normalizados; `plainMarkdown` limpa o markdown do servidor),
  `paths.ts` (chave do `FS` ↔ caminho absoluto). PURO.
- **`application/lsp-client.ts`:** `lsp_start` uma vez por pasta, `didOpen` uma vez por
  ficheiro (bus `editor:tab`), `didChange` com versões (bus `workspace:changed`), hover,
  definição, e repinta o editor quando chegam diagnósticos do ficheiro aberto.
- **`ui/editor-hooks.ts`:** rato parado → cartão `#lsp-hover`; F12 ou Ctrl+clique → definição;
  Shift+F12 → lista de referências; F2 → caixa de rename (`ui/popups.ts`: `#lsp-refs`,
  `#lsp-rename`). Listeners delegados no `document`, sem mexer no `editor.ts`; não publica globais.
- **Completion** (`domain/completion.ts`, `ui/completion-hooks.ts` + `ui/completion-view.ts`, comando
  `lsp_completion`): Ctrl+Espaço, depois de `.` ou com 2+ letras de um nome; ↑/↓, Enter/Tab, Esc
  apanhados na fase de captura (antes do Tab do editor). Aceitar expande o snippet e aplica os
  `additionalTextEdits`. Filtro: prefixo, depois início de palavra (camelCase), sem repetidos.
- **Assinatura** (`domain/signature.ts`, `ui/signature-hooks.ts`, comando `lsp_signature_help`):
  depois de `(`/`,` ou Ctrl+Shift+Espaço, um cartão por cima do cursor com o parâmetro activo a
  negrito; acompanha a escrita e fecha quando o servidor deixa de responder (cursor fora da
  chamada), com Esc ou ao sair. O jdtls traz o signatureHelp DESLIGADO por omissão: o `lsp.rs`
  liga-o nas `initializationOptions` (`init_options`).
- **Code actions** (`domain/code-actions.ts`, menu em `ui/popups.ts`, comandos `lsp_code_action` +
  `lsp_execute_command`): Ctrl+. na selecção ou no cursor; correcções primeiro (a preferida à frente).
  Uma acção com `edit` aplica-se como o rename; um comando executa-se no servidor, que devolve as
  edições por `workspace/applyEdit` (o backend emite-as como `lsp://apply-edit`, a UI aplica-as);
  `java.apply.workspaceEdit` aplica-se localmente. O backend junta ao contexto os diagnósticos das
  LINHAS pedidas e, logo após uma edição, espera (até 2 s) pelos diagnósticos do texto novo.
- **Formatação** (`domain/formatting.ts`, `ui/format-hooks.ts`, comando `lsp_format`): Shift+Alt+F
  no editor formata o documento (ou só a selecção, por `rangeFormatting`) pelo servidor, com o
  cursor entre os mesmos caracteres visíveis. A tecla é apanhada na fase de captura, antes do
  atalho global do «Format Document» do dxtutor (`features/shortcuts.ts`), que continua a correr
  quando não há servidor ou ele não formata o documento. O kotlin-language-server (ktfmt) não
  formata selecções: a UI avisa e não mexe no texto.
- **Símbolos do ficheiro** (`domain/symbols.ts`, `ui/symbol-hooks.ts` + `showSymbolPicker` em
  `ui/popups.ts`, comando `lsp_document_symbols`): Ctrl+Shift+O no editor, ou «Go to Symbol in Editor…»
  na paleta (o menu Go sai no `boot5`, por isso não há item de menu), abre `#lsp-symbols` com um campo de filtro;
  ↑/↓ e Enter levam ao nome do símbolo. A árvore `DocumentSymbol` (ou a lista `SymbolInformation`)
  é achatada com a profundidade. Os mesmos símbolos dão o **Outline** das linguagens que o
  `file_outline` não cobre (Java, Kotlin, C#, C++, Swift, SQL…): porta `desktopPorts.outline`
  (`OutlineDesktop`, definida no `features/explorer.ts`, registada pelo `lsp/index.ts`), com a cache
  por conteúdo do explorador; sem resposta do servidor fica a extracção local `symbols()`.
  GOTCHA-arranque: o Outline foi o primeiro a pedir em PARALELO com a abertura do ficheiro, e
  apanhou uma corrida antiga — o pedido saía antes do `initialize` do servidor e do `didOpen`, e o
  jdtls respondia vazio ao completion/signatureHelp a sessão inteira (o kotlin-language-server
  perdia as referências). Agora o backend só usa uma sessão do mapa depois de `initialized`
  (`Session::initialized`, `wait_initialized`) e o cliente espera pelo `lsp_start`/`didOpen` em curso.
- **Símbolos da pasta** (`domain/workspace-symbols.ts`, `ui/workspace-symbol-hooks.ts` +
  `showWorkspaceSymbolPicker`, comando `lsp_workspace_symbols(root, query)`): Ctrl+T (no editor, ou
  fora de campos de texto e do terminal) ou «Go to Symbol in Workspace…» na paleta abre `#lsp-wsymbols`;
  cada tecla (pausa de 150 ms) pergunta o `workspace/symbol` a CADA servidor que já corre na pasta
  (em paralelo, até 5 s cada; não arranca servidores — sem nenhum, o cartão diz para abrir um
  ficheiro). GOTCHAs medidos: o jdtls só devolve TIPOS sem `java.symbols.includeSourceMethodDeclarations`
  (ligado no `init_options`) e nada a uma consulta vazia; o kotlin-language-server manda só o URI
  (sem linha) e `containerName: "null"` — abrir um desses abre o ficheiro e procura a posição pelo
  `documentSymbol` (`locateInFile`).
- **Hierarquia de tipos** (`domain/type-hierarchy.ts`, `ui/type-hierarchy-hooks.ts` + `showTypeHierarchy`,
  comandos `lsp_prepare_type_hierarchy` + `lsp_type_hierarchy`): Shift+Alt+T no editor (ou «Show Type
  Hierarchy» na paleta) abre `#lsp-types` junto ao cursor: o tipo no topo e os subtipos por baixo (Tab troca
  para os supertipos), carregados a pedido ao abrir cada nó; ←/→ fecham/abrem, Enter abre o tipo. Cada
  `TypeHierarchyItem` volta ao servidor TAL COMO VEIO (o jdtls põe lá um `data`). A sessão guarda as
  capacidades que o servidor anunciou (`Session::server_caps`, `server_supports`): o kotlin-language-server
  não anuncia `typeHierarchyProvider` (e responde com erro) → `supported: false` e o editor diz que o
  servidor não a tem. Os tipos fora da pasta (ex. `jdt://` do JDK) mostram-se mas não se abrem.
- **Pedidos do servidor ao cliente:** o `id` pode ser número ou TEXTO (o jdtls usa texto); o
  `dispatch` responde a ambos. Sem resposta ao `workspace/configuration`, o jdtls bloqueava.
- **Sincronização:** antes de QUALQUER pedido o cliente envia o texto actual (`didChange`), se mudou
  — o `didChange` normal só sai 180 ms depois da última tecla. Um rename que volta `null` (o jdtls
  logo após uma edição) é perguntado mais duas vezes.
- **Rename:** o cliente aplica a `WorkspaceEdit` (`changes` ou `documentChanges`; `domain/edits.ts`)
  aos ficheiros da pasta pelo `writeFile` (o autosave leva-as ao disco), envia `didChange` dos que o
  servidor tem abertos e conta o que salta (fora da pasta, operações de ficheiro).
- **Servidor em falta:** sem servidor instalado o backend não abre sessão nem dá erro; o cliente
  pergunta `lsp_server_status` (uma vez por linguagem) e o editor mostra uma faixa
  (`#lsp-missing`, `domain/server-status.ts`) com o servidor que falta e como o instalar, reposta
  a cada desenho da vista pelo evento `editor:file-view` do bus; «Dismiss» fecha-a para essa
  linguagem na sessão.
- Os diagnósticos já chegavam ao Problems e ao gutter pelo `features/panel`. O backend usa a pasta
  aberta como raiz de reserva de um ficheiro sem marcador de projecto (o SQL não tem nenhum).
- **Testes:** `lsp.domain.test.ts`, `lsp.client.test.ts`, `lsp.editor-hooks.test.ts`, `lsp.symbols.test.ts`, `lsp.workspace-symbols.test.ts`, `lsp.type-hierarchy.test.ts`, e o passo
  `lsp-java`/`lsp-kotlin` do auto-teste desktop (`DXTUTOR_SELFTEST`, Xvfb), que conduz o editor real.
  GOTCHA: o backend procura o `jdtls` no PATH e em `$HOME/.local/share/jdtls/bin`; sem servidor não
  abre sessão (sem erro). Correndo o auto-teste com um HOME temporário, põe essa pasta no PATH
  (`PATH="$HOME/.local/share/jdtls/bin:$PATH" HOME=/tmp/… DXTUTOR_SELFTEST=…`) — senão o passo
  `lsp-java` diz que o servidor não foi encontrado (e verifica que o editor mostra o aviso).
## Studio de arquitectura de sistema (`ui-app/src/features/arch/`, ADR-0007)

Feature NOVA e tipada (governada por A7/A8), separada do Studio do catálogo cloud
(`features/studio.ts`, que continua a alimentar os geradores e o «Generate backlog»).
Desenha diagramas de arquitectura interna: painéis comparativos (até 2), grupos
tracejados aninhados com pílula, cartões com ícone (Tabler, `ui/icons.ts`, gerado) e
mini-bloco de código, setas por estilo (controlo/dados/opcional) com protocolo e rótulo.

```
features/arch/
  domain/          types, design (ops, toArchitecture, parseDesign retrocompatível),
                   geometry (cartões, grupos que crescem, painéis, pílulas), routing
                   (setas que nunca atravessam cartões, rótulos livres), autolayout
                   (camadas, recursivo por grupo), files (.arch.json, Mermaid de um .md). PURO.
  application/     ports.ts + studio.ts (caso de uso: edição, largadas, validação,
                   scaffold, exportar/importar, propostas do agente).
  ui/              view.ts (DOM/SVG), export.ts (SVG autónomo, PNG), table.ts (acções),
                   actions.ts (listener delegado, chave __archActionHandler__), icons.ts.
  infrastructure/  tauri.ts (comandos + evento) e legacy-bridge.ts (ÚNICO com window).
  index.ts         raiz de composição; quem abre o separador importa `openArch`.
```

- **O modelo e as regras são do Rust:** `crates/tutor-eval/src/arch.rs` (Kind de eventos e
  de sistema, `groups`, `views`, `source`; regras com testes) e `arch/mermaid.rs` (ida e
  volta exacta via linhas `%% dxt:`). Nunca validar nem fazer parse de Mermaid no cliente.
- **Comandos:** `arch_validate`, `arch_scaffold(_preview)`, `arch_export_mermaid`,
  `arch_import_mermaid`, `arch_save_export` (escreve SÓ dentro da pasta do projecto, só
  svg/png/mmd/md/json) — em `commands/agent.rs`. Evento `arch://proposal`.
- **Harness:** a ferramenta do agente `arch_propose` (só leitura, `src-tauri/src/agent.rs`)
  valida e mostra a proposta por cima do desenho actual; só muda com «Accept». Entra no
  conjunto de ferramentas versão 4 (`StartSpec.host_tools_v4`): sessões antigas retomam
  sem ela. Desde o conjunto 9, só nas sessões de arquitectura (`StartSpec.architecture`: o
  Studio aberto ou o primeiro pedido fala de arquitectura — `codev/domain/session-kind.ts`).
- **Sem dados de demonstração:** o desenho nasce vazio; a referência «Docker vs Kubernetes»
  vive só em `ui-app/tests/fixtures/arch-reference.ts` (testes e e2e).
- **Testes:** `cargo test -p tutor-eval` (regras, Mermaid, fixtures do Delonix),
  `ui-app/tests/arch.*.test.ts` e os e2e `ui-app/e2e/arch*.e2e.ts` (o `arch-recreate` recria
  a referência só pela UI e verifica que nenhuma seta atravessa um cartão). GOTCHA-e2e:
  várias sessões partilham `ui-app/dist` e a porta 4179 — para verificar, construir para
  uma pasta própria e servir noutra porta (ou `CI=1`).

## Comentários de linha para o Co-Dev (`ui-app/src/features/comments/`)

Feature nova e tipada (governada por A7/A8), ao estilo do «Start discussion» do Antigravity: com o
ponteiro no editor, um botão na margem da linha abre uma caixa por baixo dela; «Add Comment to Chat»
(ou Ctrl+Enter) põe o comentário no compositor do Co-Dev como um chip com o código dessas linhas,
pelo `codev.ask` partilhado (`intent: "chat"`, `send: false`, contexto `kind: "comment"`) — juntam-se
vários e o humano escreve o pedido. Uma selecção que contém a linha alarga o comentário a ela toda.

```
features/comments/
  domain/comment.ts          linhas (offset/ponteiro → linha), intervalo pela selecção, rótulo e o
                             contexto para o agente. PURO.
  application/               ports.ts (EditorPort, AskPort) + line-comments.ts (abrir/descartar/juntar).
  ui/                        view.ts (botão e caixa DENTRO da .ed-wrap, fora do #ed-gut/#ed-hl que o
                             paintEd redesenha — e longe dos cliques de breakpoint da margem),
                             hooks.ts (rato, teclado, acções `comments:*` no despachante partilhado),
                             messages.ts (en/ptAO: o `.ed` está no TR_SKIP do motor de tradução).
  infrastructure/editor.ts   a textarea `#ed-ta` e a raiz do workspaceStore (sem window).
  index.ts                   raiz de composição (corre no browser e na app).
```

Não comenta por cima de uma proposta do Co-Dev (os números de linha não seriam os do ficheiro).
Testes: `tests/comments.domain.test.ts` (domínio + caso de uso) e `tests/comments.editor.test.ts`
(no editor real do harness: posição do botão, caixa, Ctrl+Enter/Esc/lixo, o pedido ao `codev.ask`).

## Aprovação e auditoria partilhadas (r23 F1, `docs/v2/AUDIT-r23.md`)

Tudo o que muda algo fora do editor (push, reset, apply, deploy, sync, exec, delete) pede aprovação com
o comando EXACTO e vai para o registo de auditoria.

- **`app/approval.ts`** — o único diálogo para isso (`requestApproval(pedido)` → decisão; não corre nada).
  Título, comando, onde corre, motivo obrigatório e palavra a escrever opcionais. Uma feature declara na
  sua porta um `approve(pedido)` com a mesma forma (tipagem estrutural, sem importar `app/` na aplicação)
  e a composição liga-o. Nada de `window.confirm` novo; o Ops já migrou, os outros migram nas suas fases.
- **`audit_record`** (`board.rs`, cliente `platform/tauri/audit.ts`) — a mesma tabela do registo do
  Co-Dev, origem `ide` (`tool` = feature, `call` = acção, `path` = onde). Quem e quando decide-os o
  backend; os segredos mascaram-se no Rust. A aprovação que não se consegue auditar não corre.

## Protecção de dados (r23 F4a, `crates/tutor-protect`, `ui-app/src/features/protect/`)

Nenhum segredo sai da máquina, e a regra vive no Rust:
- **Redacção antes de QUALQUER pedido a um modelo** (X02): `tutor_protect::redact::guard_json`/`guard_body` no último passo
  do `tutor-llm` (chat, tutor), do agente (`tutor-agent`, Anthropic e OpenAI, uma vez antes das tentativas) e do
  `llm.rs`. A redacção saiu do `tutor-agent` (que a reexporta como `redact`). Junta às regras os valores secretos dos
  `.env` da pasta aberta (`protect_learn`, ao abrir a pasta). Cada pedido que perdeu segredos chega à UI pelo evento
  `protect://redacted` (contagem na barra de estado, `#st-protect`, e uma linha no registo de auditoria).
- **Secret scan antes de CADA commit da app** (X03): `tutor_protect::scan::guard_commit` corre no backend, em cada sítio
  que comita: o `exec` quando é `git commit` (o pane, Ctrl+Enter, o quadro, o amend), o merge/Composer/lanes do
  `gitwork`, `git::commit`, as regras de arquitectura e o bash do agente (âmbito = todas as mudanças; o agente não tem
  excepção). As regras próprias correm SEMPRE; o gitleaks, se estiver instalado, junta as dele no índice (`tool:
  gitleaks + built-in` — medido: o gitleaks 8.30 não apanha `postgres://u:p@h`, por isso nunca as substitui); ficheiros
  proibidos (`.env`, `.tfstate`, chaves). Bloqueado, devolve `SECRET_SCAN_BLOCKED:{relatório}` (pré-visualizações MASCARADAS). Na UI,
  `services.protect.guard(f)` (o commit do desktop, o Composer e as lanes) mostra os achados no diálogo partilhado; passar
  exige motivo, auditado ANTES de `secret_scan_allow` (um commit, 2 min) e com o resultado. Um commit que o humano
  faz no seu terminal só passa por aqui com o hook de pre-commit: «Protect: Install the Pre-commit Hook…» (paleta,
  `services.protect.installHook`) mostra o ficheiro e o texto exactos no diálogo partilhado; `protect_hook_install`
  audita no Rust antes de escrever e nunca substitui um hook alheio (`tutor_protect::hook`, pasta pelo
  `git rev-parse --git-path hooks`). O hook corre `dxt secret-scan --staged` (`crates/tutor-cli`, o mesmo `scan`);
  sem o `dxt` no PATH bloqueia e diz porquê. Teste ponta a ponta: `cargo test -p tutor-cli --test secret_scan`.
- **Máscara** (X04): o PTY (`tutor_protect::stream::Masker`) e a saída do depurador. Uma shell interactiva mascara
  pedaço a pedaço (o eco não pode esperar: um segredo partido entre duas leituras pode passar); uma TAREFA (`pty_spawn`
  com `command`) retém o fim de uma linha que pode ser o início de um segredo até à leitura seguinte e despeja o resto
  no fim — uma linha que acaba em `:` (um pedido, `Password:`) mostra-se logo.
- **IaC no editor** (P03/C03): `tutor_eval::iacfind` (regras próprias sobre `.tf`: um argumento com nome de segredo a
  partir de `var.`/literal é erro — fica no state e no plano —; variável secreta sem `sensitive`) entra no scan do
  Problems (`dxtutor-iac`). O tflint/checkov/trivy entram na pipeline da F4b.
- Testes: `cargo test -p tutor-protect` (os critérios de aceitação: pedido redigido, commit com `postgres://u:p@h`
  bloqueado), `cargo test -p tutor-eval iacfind` (`password = var.x` é erro), `tests/protect.test.ts` e o passo `protect` do
  auto-teste.

## Pipeline de IaC, plano revisto, drift e estado (r23 F4b, `tutor_eval::iac`, `features/ops`)

O separador IaC do Ops tem Pipeline · Plano · Segurança e política · Drift · Estado. As regras vivem no Rust
(`crates/tutor-eval/src/iac.rs`, ferramentas pela fábrica `shellenv::command` que o `commands/iac.rs` injecta):
- **Etapas:** init → fmt → validate → regras internas (`iacfind`) → tflint → checkov → trivy → segredos guardados no
  estado (`state pull`, só os nomes) → plan → drift → conftest (se houver `policy/`) → infracost. Cada uma `ok`/`failed`/
  `not_installed` (com a dica; NUNCA verde)/`not_connected` (infracost sem chave)/`skipped`; evento `iac://stage`.
- **Uma etapa falhada bloqueia o apply, no Rust:** o plano fica em `app_local_data_dir/iac-plans/<sha256>.bin` (0600, um
  dia) com o hash da configuração; `iac_apply_command` só devolve `… apply -input=false <esse ficheiro>` se a corrida não
  bloqueou, o ficheiro é o revisto e a configuração não mudou. A UI aprova, audita, corre num terminal e audita o código
  de saída. O antigo `iacApply` (que re-planeava: `plan -out=tfplan && apply tfplan`) saiu.
- **Achados com chave estável** (fonte, regra, ficheiro e o texto da linha ou o recurso): aceitar o risco pede motivo,
  dura 30 dias (migração 10 do Project, `iac_accepted`) e vai primeiro para o registo de auditoria (`iac_risk_accept`, no
  Rust); revogar expira-o. O drift ignorado usa o mesmo mecanismo (`drift:<dir>:<endereço>`).
- **Drift:** verificado de 6 em 6 horas enquanto a pasta está aberta (e à mão); reverter = pipeline dirigido
  (`-target`); escrever no código = Co-Dev; quem o mudou = «not connected» (precisa de uma fonte como o CloudTrail).
- **Estado:** endereços, ids, backend, serial, lock e cópia (só no backend local); force-unlock aprovado; `moved` e
  `import` são rascunhos que o Co-Dev escreve nos `.tf`. O editor nunca abre um `.tfstate` (o carregador do workspace
  salta-o, `read_text_file`/`write_text_file`/`write_file` recusam-no, o `openPath` avisa).
- O plano ganhou módulo, motivo do replace, atributos que o forçam, raio de impacto (do `configuration` do `show -json`;
  um módulo conta como um todo), argumentos write-only e custo (infracost).
- GOTCHA: o ficheiro do plano guarda os valores (segredos incluídos) — por isso 0600 e apagado ao fim de um dia; o JSON
  do plano para conftest/infracost vive numa pasta temporária apagada no fim da corrida.
- Testes: `cargo test -p tutor-eval iac::` (parsers dos scanners, raio de impacto, e um pipeline real com o `tofu`:
  apply do ficheiro revisto, bloqueio, aceitação, segredo no estado), `cargo test -p tutor-board accepted_risks`,
  `tests/ops.test.ts` e o passo `iac` do auto-teste.

## Keychain e Vault (r23 F4c1, `crates/tutor-platform`, `ui-app/src/features/vault/`)

O token do Vault e as chaves de API dos modelos vivem no keychain do sistema (`tutor_protect::keychain`, reexportado
como `tutor_platform::keychain`; está no `tutor-protect` porque o `tutor-llm` também o usa; crate
`keyring` 3 com o Secret Service sobre D-Bus — precisa de `libdbus-1-dev` para compilar e de um GNOME Keyring/KWallet a
correr). Nenhum comando os devolve à UI. Regras (no Rust, com testes):
- **Entrar:** OIDC (`auth_url` → o Rust abre o browser → volta a `127.0.0.1:8250/oidc/callback`, o mesmo do CLI do
  Vault; o papel tem de o ter em `allowed_redirect_uris`) ou um token colado (verificado com `lookup-self`). Os dois vão
  para o keychain (conta `vault:<addr>#<namespace>`). Sair revoga e apaga.
- **Ambientes pelo caminho:** um segmento `local`/`dev`, `staging`/`qa`, `production`/`prod` diz o ambiente. Os
  metadados KV saem para todos (versões, datas, custom metadata); os NOMES das chaves só para `local`; os VALORES só
  para `local` (`vault_reveal_local`, auditado no Rust antes de ler, legível 20 s por `vault_reveal_read`, depois
  esquecido; o valor entra na redacção). Um caminho sem ambiente é tratado como não-local.
- **Mudar um valor** é no terminal: `vault kv patch -mount=… caminho chave=-` lê o stdin. O `pty_spawn` ganhou
  `vault: {addr, namespace?, lease?}`: o Rust põe `VAULT_ADDR`/`VAULT_NAMESPACE`/`VAULT_TOKEN` no ambiente (o token
  nunca atravessa o IPC) e aprende-o para a máscara do terminal.
- **Credenciais dinâmicas** (`<mount>/creds/<role>`): a UI recebe o lease (id, TTL, nomes dos campos); os valores
  ficam no backend até um terminal aberto com o lease os receber como `VAULT_DYN_*`; o lease é revogado quando esse
  terminal acaba (evento `vault://lease-revoked`) ou à mão.
- **Chaves dos modelos:** `keys.rs` guarda em `llm:<provider>`; uma chave ainda no `keys.json` passa para o keychain na
  primeira leitura (e sai do ficheiro). Sem keychain, fica no `keys.json` (0600), como antes. O mesmo para o
  `~/.config/dxtutor/providers.json` do assistente e do TUI (`tutor_llm::chat::load_config`/`save_config`, mesmas contas
  `llm:claude`/`llm:codex`/`llm:gemini`): uma chave no ficheiro passa para o keychain sem substituir uma que lá esteja,
  gravar põe-nas no keychain (uma apagada sai dele) e o ficheiro fica sem chaves.
- GOTCHA-keychain: o serviço é `dxtutor`, ou `DXTUTOR_KEYCHAIN_SERVICE` — o auto-teste usa um seu (o HOME temporário
  não isola o keychain, que é da sessão D-Bus). GOTCHA-dev: `vault server -dev` escreve `~/.vault-token`; os testes
  correm-no com um HOME temporário.
- Testes: `cargo test -p tutor-platform` (keychain real com serviço próprio; Vault real em modo dev: token, metadados,
  recusa de produção/staging, revelar local, renovar, sair; OIDC e credenciais dinâmicas com um servidor falso),
  `cargo test -p dxtutor-ide keys`, `tests/vault.test.ts` e o passo `vault` do auto-teste.

## Deploy guiado (r23 F4c2, `tutor_platform::deploy`, `ui-app/src/features/deploy/`)

Staging e produção só se mudam pelo deploy guiado: o «Promote» e o «Redeploy» do Infra abrem-no (`services.deploy`).
Oito passos — Destino, Identidade, Segredos, Verificações, Estratégia, Aprovar, Rollout, Registo. Regras (no Rust):
- **Segredos só pelo Vault** (decisão do dono, 2026-11-26): os `Secret` do `deploy/k8s` NÃO são aplicados — o cluster
  lê-os do Vault (Vault Secrets Operator). O Infra já não aceita valores de staging/produção (as colunas dizem
  «Vault»); a verificação vê só nomes (`kubectl get secret … -o name`) e metadados do Vault.
- **O que bloqueia** (`deploy::blockers`): uma verificação falhada sempre; em produção, «not installed»/«not
  connected» também, salvo excepção com motivo — nunca para o segundo aprovador nem para staging (`NOT_WAIVABLE`: sem
  `gh` ou sem PR aprovado, a produção fica fechada). O rollout verifica outra vez (excepções, HEAD, manifestos, plano com
  ≤ 30 min). Produção: motivo e `production` escrito (verificados no Rust) e um **segundo aprovador** = PR fundido com
  o commit aprovado por outra pessoa (`gh`).
- Verificações: version (HEAD limpo), sbom (syft), signature (cosign + política em `.dxtutor/deploy.json`), vulns
  (trivy/grype), secrets, secret-check (`dx-secret-check`: «not available» até a imagem existir), drift (IaC do
  ambiente: `iac::drift`), admission (`apply --dry-run=server`), slo («not connected»), window (janelas UTC), migrations,
  staging (produção: saudável e com esta versão) e approver.
- Rollout (rolling; canary/blue-green depois): namespace, `apply -f -` sem os Secrets, anotação `dxtutor.io/version`,
  `rollout status`; linhas pelo `deploy://output`. Auditado antes e com o resultado; registo na base do Project
  (migração 11, `deploys`), que alimenta a coluna «environments» do ciclo de vida do commit (F3).
- Testes: `cargo test -p tutor-platform deploy` (kubectl e gh falsos por scripts, repositório git real),
  `cargo test -p tutor-board deploy_records`, `tests/deploy.test.ts`, `tests/infra.r5c1.test.ts` e o passo `deploy` do
  auto-teste (kubeconfig temporário vazio: nunca os clusters do utilizador).

## Runbooks, fontes de dados e evidências (r23 F5a, `tutor_platform::runbook`/`policy`/`sources`, `features/ops`)

- **Runbooks como código** em `runbooks/*.md`: `## n. título [check|action|decision]`, um bloco de comando, `expect:`
  (entre crases ou `/regex/` verifica-se contra a saída; prosa julga-a a pessoa, com nota). Editar o ficheiro muda os
  passos. O separador Ops tem a secção Runbooks (correr passo a passo, uma execução por «New run»).
- **A regra (no Rust, `runbook::may_run`):** um `check` só corre se cada comando for só de leitura
  (`policy::read_only`: o classificador do agente `tutor_agent::permissions::assess` comando a comando, mais os verbos de
  leitura de kubectl/aws/gcloud/az/tofu/gh/helm/docker/vault/argocd/curl GET/psql SELECT; nada de `>` para ficheiros nem
  de verbos que leiam segredos — `kubectl get secret -o yaml`, `vault kv get`, `get-secret-value`…) — senão
  `not_read_only`; uma `action` só com aprovação e motivo (auditada no Rust antes) e com o ambiente do Vault só para esse
  passo; uma `decision` regista palavras. GOTCHA: o classificador do agente vê «deploy» em `kubectl get deploy` e chama-lhe
  perigoso — por isso a decisão é comando a comando, com os verbos de leitura de infra primeiro.
- Cada passo fica na base do Project (migração 12, `runbook_runs`): comando, saída mascarada, código, resultado contra a
  expectativa, quem e quando. «✦ Ask Co-Dev» comenta a saída e sugere o passo seguinte (não corre nada).
- **Fontes de dados** (`sources_status`): CI/CD pelo `gh` (só leitura); custo, métricas/logs e inventário «not connected»
  com como ligar — nunca um número estimado.
- **Evidências ISO/IEC 27001:2022** (`audit_export_evidence`, botão «Export evidence» do Ops): escreve
  `docs/audit/evidence-AAAA-MM.md` DENTRO do projecto a partir das linhas reais do registo (origem `ide`), dos deploys e
  das execuções de runbooks, por controlo (A.8.32, A.8.9, A.5.17/A.8.12, A.8.13, A.5.24–A.5.27) e as «não mapeadas»;
  gerador puro em `tutor_board::project::evidence`. A exportação vai ao registo.
- Decisões do dono (2026-11-26): incidentes são registos locais (on-call e alertas «not connected» até haver fonte);
  catálogo/scorecards, GitOps, custo e inventário adiados; F5 em duas partes (F5b: fila, revisão de PR, incidentes).
- Testes: `cargo test -p tutor-platform runbook sources`, `cargo test -p tutor-board runbook_runs`, `tests/ops.test.ts` e
  o passo `runbook` do auto-teste.

## A actividade Platform: a fila, a revisão de PR e os incidentes (r23 F5b, `tutor_platform::queue`/`review`, `features/ops`)

Vista «Platform» da feature `ops` (`VIEW.platform`, paleta «Platform: …»; serviço `application/platform-service.ts`,
vista `ui/platform-view.ts`, acções `pf:*` no despachante partilhado):
- **A minha fila** (`queue_items`): itens calculados do estado real — revisões pedidas pelo `gh`
  (`review-requested:@me`) com a regra do CODEOWNERS, achados de IaC bloqueantes em `.tf` que a pessoa mudou nos últimos
  90 dias (`git log --author` + `iacfind`, menos os riscos aceites), runbooks com `schedule:` sem execução completa no
  prazo, incidentes que comanda, o seu último deploy falhado num ambiente. Cada item diz porque é seu e tem UMA acção. Só
  passa a «feito» quando `queue_verify` o prova contra o estado (gravado com a prova); «passar» exige destinatário e
  motivo (vista Team, auditado). «Medido neste workspace» = só contagens locais. O on-call fica «not connected».
- **Revisão de PR de infra** (`pr_infra_review`): o diff (mascarado) e «Before you merge» — ci (`statusCheckRollup`),
  plan/policy/cost (o pipeline de IaC numa worktree temporária da cabeça do PR, `git fetch origin pull/N/head`, removida
  no fim), window, rollback (migrações), incidentes locais semelhantes, capacity/error budget/on-call «not connected»;
  cada uma com a fonte. `pr_review_submit`: o PR tem de ser o revisto (mesma cabeça); aprovar com uma verificação a
  falhar exige motivo (no Rust), que vai para o PR; auditado antes e com o resultado.
- **Incidentes locais** (migração 13: `incidents`, `incident_events`, `queue_events`; decisão §5 Q9): abrir (INC-n),
  evidência, verificações feitas e NÃO feitas (com porquê), mitigar, resolver (com resumo), «a causa principal estava
  certa?» (uma vez; precisão do Co-Dev). A confiança nunca passa de «low» sem uma fonte de métricas. O Co-Dev ordena
  causas (proposta) e escreve o rascunho do postmortem em `docs/postmortems/INC-n.md` (proposta no editor).
- GOTCHA: as leituras (fila, lista, um incidente, a revisão) não se bloqueiam umas às outras — abrir um incidente
  enquanto a lista carrega era ignorado; só as acções que mudam algo vão uma de cada vez.
- Testes: `cargo test -p tutor-platform queue review`, `cargo test -p tutor-board incidents`, `tests/platform.test.ts` e
  o passo `platform` do auto-teste.

## Boas-vindas e walkthroughs (`ui-app/src/features/welcome/`, r23 F6)

Feature tipada e em camadas (governada por A7/A8), no lugar do antigo `features/welcome.ts`: Start (New File,
Open File, Open Folder, **Clone Git Repository…**, Connect to, PairCode) · Recent (o `dx-recent` real; no browser,
nenhuma pasta) · Walkthroughs (Get started, Build — os antigos cartões —, Co-Dev, Project, PairCode, Quality,
Learning Track; sem Cloud) e «Show welcome page on startup» (lido pelo `boot`, `domain/progress.ts`).

- Cada passo de um walkthrough nomeia uma ACÇÃO (`domain/walkthroughs.ts`); a tabela `STEP` do `index.ts` liga-a
  ao ponto de entrada da feature dona. Nada de código em texto (o `WEL.run` do protótipo fazia eval).
- O Clone: o backend constrói o comando (`git_clone_plan` → `git -C <pasta> clone -- <url> <nome>`, a mesma
  validação do `git_clone`: sem URL com ar de opção, sem `ext::`), o diálogo partilhado aprova-o, o
  `audit_record` regista-o antes de correr (sem auditoria não corre) e com o resultado, e a pasta nova abre-se.
- O Project avalia depois desta feature: lê-se por `services.project`. Os comandos «Help: Welcome» e
  «Help: Walkthroughs» estão no `app/commands.ts`.
- Testes: `tests/welcome.test.ts`, `tests/welcome.wiring.test.ts`, `e2e/welcome.e2e.ts` (a aceitação: uma pasta
  recente abre esse workspace) e o passo `clone` do auto-teste desktop (clone real por `file://`).

## Notas para a documentação oficial (`docs/notes/NOTAS.md`)

A base da documentação oficial do dxtutor-ide, acção a acção: o que faz, onde está, como usar, o fluxo por
dentro, dicas e limites. **É gerada, não se edita à mão.** Cada feature descreve as suas acções em
`features/<f>/notes.ts` (tipos em `app/notes/types.ts`, registo em `app/notes/registry.ts`, gerador
`app/notes/render.ts`); `npm run docs:notes` regenera o ficheiro.

- Ao acrescentar ou mudar uma acção (botão, atalho, comando da paleta, `data-action`), actualiza a nota da
  feature no MESMO commit e corre `npm run docs:notes`. O `tests/notes.docs.test.ts` (corre no `ui:test`)
  reprova: o ficheiro desactualizado, uma acção da tabela do codereview sem nota, uma acção nova da barra do
  editor sem nota, e um comando `cmd:` citado que já não existe.
- Uma feature que passa a ter notas entra no `NOTES` do registo (e o teste passa a cobrir a sua tabela de
  acções). O `PENDING` (acções da barra ainda sem nota) só encolhe.
- As notas escrevem-se em português de Angola (pré-AO90), para o utilizador final; os identificadores
  técnicos ficam no `covers` e no «Fluxo».

### O golden é a rede de segurança — nunca o actualizes para passar

`ui-app/tests/codev.golden.test.ts`, `codereview.golden.test.ts`,
`scm.golden.test.ts`, `debug.golden.test.ts`, `board.golden.test.ts`,
`visualizer.golden.test.ts` e `infra.golden.test.ts` comparam o markup renderizado contra snapshots (`__snapshots__/`). O harness (`ui-app/tests/harness.ts`) **strippa exactamente**
`onclick`/`onchange`/`oninput`/`data-action`/`data-on` antes de comparar — logo
todo o payload de uma acção viaja em `data-on` (um `data-*` à medida vazaria para o
snapshot e partia-o). Desde a U6b do ADR-0004 o `golden()` também passa o markup pelo motor de
tradução para inglês (`trNode`, `LOCALE='en'`, respeitando o `TR_SKIP`): os goldens mostram o que o
utilizador vê em inglês, e um texto que passa a `t("chave")` deixa-os iguais. Um diff de golden = **o código mudou de comportamento visual**:
corrige o código, não o snapshot. Só se regenera um golden com decisão deliberada e
registada (mudança de UI aprovada), nunca para «fazer passar».

## Regras ao mexer aqui

1. **UI e comportamento congelados** em todo o trabalho de refactor: zero diff de
   golden, zero mudança de markup, não mover lógica para Rust (fica para sessão
   própria), não renomear comandos públicos, não actualizar dependências.
2. **Cada commit deixa a app corrível.** Sem big-bang; estrangula a feature por fases.
3. Bugs encontrados **reportam-se**, não se corrigem dentro do refactor.
4. Antes de commitar refactor não-trivial: `ui:build` + `ui:test` + `arch:check`
   verdes. Ver as skills `extract-feature`, `add-port-adapter`, `ui-golden-check`.

## Referências

- `docs/architecture/ADR-0002-codev-clean-architecture.md` — a decisão e as 6 fases.
- `docs/architecture/ADR-0005-learning-track-plugins.md` — plugins de curso, 10 linguagens, VS Code.
- `docs/architecture/ADR-0006-ide-real.md` — o fim dos dados de demonstração e cada feature no backend real (R0–R6).
- `docs/architecture/ADR-0007-studio-arquitectura-sistema.md` — o Studio de arquitectura de sistema (painéis, grupos, setas, Mermaid, o agente propõe).
- `docs/plugins/README.md` — guia para quem escreve cursos (em inglês, para contribuidores).
- `docs/architecture/ARCHITECTURE.md` — visão geral; §6 (CSP) liga a migração dos
  `onclick` inline ao endurecimento de `script-src 'unsafe-inline'`.
- `docs/architecture/IPC-MATRIX.md` / `MIGRATION.md` — backend (comandos Tauri).
- Contratos de sessão em `.claude/sessions/` (ver protocolo de sessão).
