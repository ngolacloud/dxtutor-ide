# RF «delonix-ide» (14-11-2026) — estado actual e plano por cima do que existe

> Estado: **plano aprovado; decisões D1–D7 tomadas (2026-11-24); execução por começar (F0)**. Nenhum código foi alterado.
> Fonte: documento «delonix-ide — Requisitos Funcionais» (Nov 14, 2026). Os documentos que ele cita,
> «Requisitos do backend» e «Prompt de implementação», não foram fornecidos (como na Q1 de `QUESTIONS.md`).
> Base auditada (2026-11-24): `develop` @ `84b7a00` mais a árvore de trabalho, que tinha alterações de outra
> sessão em curso (`codev_agent.rs`, `tools/mod.rs` com o toolset v4 e `arch_propose`, `board-engine.ts`, …).
> Ramos por fundir que contam para o estado:
> - **`feat/a2-codev-stream`** (fase A2 da Parte A): `docs/v2/RF-CODEV-STREAM.md`, hunks em streaming no editor;
> - **`feat/ide-real`** (ADR-0006, R1–R6 feitas): Board com o agente real, backlog em SQLite, custo medido,
>   Studio em `.dxtutor/studio.json`.
> As referências `ficheiro:linha` deslocam-se com os commits seguintes.

## 0. Conclusão em quatro linhas

1. **No `develop`**, dos 49 RF: **2 ✅** (P01, P02), **16 🟡** e **31 ❌**.
2. **Com os dois ramos fundidos**: **8 ✅**, **21 🟡** e **20 ❌**. A A2 cobre quase todo o streaming (S03–S07) e a
   âncora (E02); o ADR-0006 tira o runner guionado e liga o Board ao agente real.
3. **O que falta é sobretudo governação**: origem, âmbito por issue, registo de auditoria, template de prompt,
   DoR, verificador de arquitectura, papéis e orçamento. O motor (loop Rust, permissões, checkpoints, hunks)
   já existe e serve de ponto de extensão.
4. Os RF não pedem uma frente nova. Pedem **regras por cima** da A2, do ADR-0006 e da A5 (Project/SQLite).
   O plano abaixo começa por **consolidar os dois ramos** e corrigir 8 bugs que contradizem directamente os RF.

## 0.1 Actualização (2026-11-24, depois da auditoria)

Enquanto a auditoria corria, outras sessões fundiram trabalho. A matriz da §1 mantém-se como foi medida; isto
é o que muda nela:

- **`develop` local @ `d7a370d`** já contém a **A2** (streaming, `feat/a2-codev-stream`), a **A5** (Project:
  store SQLite com migrações em `crates/tutor-board/src/project/`, comandos `project_*`, actividade Project
  em `ui-app/src/features/project/`) e a **A1** (PairCode: separadores privados, chamada na barra lateral).
- **`origin/develop`** contém o **ADR-0006** (`feat/ide-real`, PR #6, `4b1da2f`).
- **Os dois divergiram:** o local tem 31 commits que o `origin/develop` não tem; o `origin/develop` tem 53 que o
  local não tem.

Efeito na matriz (coluna «+ramos»):

| RF | Passa a | Porquê (A5) |
|---|---|---|
| G02 | 🟡+ | Caixa de entrada: as propostas do Studio esperam pela decisão humana (teste `proposals_wait_in_the_inbox_until_a_human_decides`). Falta a ferramenta `suggest` do agente e o MCP em Auto |
| G06 | 🟡 | `issues.blocked` existe e uma issue bloqueada não avança (`a_blocked_issue_does_not_move_forward`). Falta o `ask_human` que a preenche com a dúvida |
| B01 | 🟡 | `assignee` e `acceptance[{text, done}]` existem. Faltam GWT estruturado, âmbito, dependências e a validação do formulário |
| B02 | 🟡 | DoR/DoD por projecto e «Scrum precisa de Ready para começar» (`scrum_needs_ready_to_start_and_done_needs_the_dod`). Falta ligar a DoR ao botão «Executar com Co-Dev» com os critérios do RF (âmbito, dependências em Done, aprovação) |
| B08 | 🟡+ | O painel da issue tem Development real: ramo, commits que citam a chave, *change sets*. Faltam prompt/versão do template, modelo e custo |
| E08 | 🟡+ | `change_sets` ligados à issue (`change_sets_are_linked_to_their_issue`). Falta o agrupamento no SCM com aceitar/rejeitar por conjunto |

**Reauditoria da A3 (2026-11-24):** G08 🟡+ (`exit_plan` com `steps` com ficheiros e linhas, no separador «Co-Dev run»; continua opcional e sem confronto com a execução); T01 ❌→🟡 (relatório por turno, feito dos eventos e guardado com a issue; sem registo por acção — feito na F1.2); G07 🟡+ («Rewind to here» repõe ficheiros e conversa); G05 com regras do projecto editáveis na UI; A06 continua ❌ (os papéis da A3 são de sub-agentes, não de pessoas).

Por isso a F4 encolhe: constrói-se sobre `crates/tutor-board/src/project/` (A5) e já não sobre o
`tutor-board::Story` antigo.

## 1. Matriz de estado

Legenda: **dev** = `develop` hoje; **+ramos** = depois de fundir `feat/a2-codev-stream` e `feat/ide-real`.

### 1.1 Governação (RF-G)

| RF | dev | +ramos | Evidência | Falta |
|---|---|---|---|---|
| G01 origem obrigatória | ❌ | ❌ | `codev_agent_send` (`commands/codev_agent.rs:61`) e `PendingCall` (`tutor-agent/src/agent.rs:69-78`) não têm origem; `Policy::decide` (`permissions/mod.rs:213`) não a verifica | `Origin {issue\|chat\|editor, by}` por turno; recusar chamadas sem origem com «bloqueada: sem pedido»; registo |
| G02 AI não cria issues nem move cartões | 🟡 | 🟡 | O agente não tem ferramentas de board e o Done só é humano (`board-engine.ts:77-87`). Violações: `genBacklog` cria issues sem Aceitar (`:96-117`); sub-issues automáticas fora do âmbito (`:48-49`); `runSprint` move backlog→todo (`:70`); ferramentas MCP (ex. `create_issue`) correm sem perguntar em Auto (`permissions/mod.rs:278-281`) | Caixa de sugestões (inbox) com Aceitar/Rejeitar; MCP que muda estado pergunta em Auto. O ADR-0006 tira as sub-issues |
| G03 âmbito de ficheiros da issue | ❌ | ❌ | Só há confinamento à raiz (`sandbox.rs`) e ficheiros protegidos; o âmbito por *assistente* (`team.ts:40-56`) só existe no caminho legado e lança erro em vez de pedir | `Scope` no `ToolCtx`; escrita fora do âmbito → `Ask` mesmo em Auto (como o piso dos protegidos) |
| G04 modos Manual/Assistido/Auto | 🟡 | 🟡 | Manual pergunta tudo ✅; o modo aparece no chip, na modebar e em `#st-mode` ✅. A A2 põe o Assistido a rever hunks (D1 do `RF-CODEV-STREAM.md`: só no IDE). Falta: o Auto **não pára no fim da issue** (só `max_iterations=60`); a mudança de modo só fica como mensagem `system` no JSONL | Fim de issue explícito (ferramenta `finish_issue`, ver B06) e mudança de modo no registo de auditoria |
| G05 irreversíveis pedem sempre | 🟡 | 🟡 | Piso `Risk::Dangerous` em todos os modos: `git push`, `rm -rf`, `kubectl delete`, `terraform apply`, publish… (`permissions/shell.rs`). **Ficam `Unknown` (correm em Auto):** `git merge`, `gh pr merge`, `kubectl apply`, `helm install/upgrade`, `docker compose up`, `* deploy`, migrações (prisma/alembic/rails/sqlx/diesel/`psql -f`), `rm f` sem flags, `git rm`, `--force` genérico | Alargar o classificador; merge para `main`/`develop` = Dangerous; ferramentas MCP que mudam estado perguntam |
| G06 dúvida → parar e «Bloqueada: dúvida» | ❌ | ❌ | Só a frase «Pergunta quando o pedido for ambíguo» no prompt (`context.rs:36`); não há estado bloqueado no board | Ferramenta `ask_human` que termina o turno; issue com `blocked: {reason:"dúvida", question}` |
| G07 Stop / Esc | 🟡 | 🟡 | O cancelamento não deixa escritas novas ✅ e há checkpoint por turno (`/reverter`). **Bug:** o Esc não pára o agente v2 (`agCtl` não trata `'esc'`, `chat-view.ts:174-188`). A A2 rejeita os hunks pendentes no cancel ✅; Esc fora de campos de texto | Corrigir o Esc no chat; depois do Stop, o *change set* do turno (aplicados provisórios incluídos) fica para aceitar/descartar |
| G08 plano antes de executar | 🟡 | 🟡 | `exit_plan` pede aprovação ✅, mas é opcional e em markdown livre. A A2 traz o evento `plan` com `files[{path,start,end}]` | Plano estruturado obrigatório em Manual/Assistido antes da primeira ferramenta que muda ficheiros; hunk fora do plano assinalado |

### 1.2 Backlog e template (RF-B)

| RF | dev | +ramos | Evidência | Falta |
|---|---|---|---|---|
| B01 user story completa | ❌ | ❌ | `Issue` (`board/domain/types.ts:39-68`) só tem título/tipo/pts; o «formulário» é a paleta com o título. O `tutor-board::Story` já tem `role/want/soThat/acceptance` (`crates/tutor-board/src/lib.rs:32-61`); o ADR-0006 R3b liga-o à UI com `meta` | GWT estruturado, âmbito, dependências, responsável; formulário com validação |
| B02 Definition of Ready | ❌ | ❌ | Os botões Delegar/Agente/Sprint aparecem sempre (`features/board.ts:103-104`) | Avaliador puro `readiness()` e botão «Executar com Co-Dev» desactivado com a lista do que falta |
| B03 prompt montado pelo template + «Ver prompt» | ❌ | ❌ | Hoje há 3 prompts diferentes (`runIssue` guionado; `delegate` com uma frase; `storyPrompt` em `agent-events.ts:293-300`). O system prompt é `context.rs:24-44` + `AGENTS.md`/`CLAUDE.md`/`.dxtutor/regras.md` | Renderizador do template (no backend) e «Ver prompt» com o texto exacto e os tokens |
| B04 template versionado, idioma | ❌ | ❌ | Não há `.delonix/` nem `.dxtutor/prompts/`; o núcleo do prompt está fixo em PT (`context.rs:26-27`), sem a regra de código/commits em inglês | `issue.pt.md`/`issue.en.md`, versão gravada na issue, commit próprio |
| B05 uma issue de cada vez, sem «aproveitar» | 🟡 | 🟡 | `runSprint` trabalha uma de cada vez pela ordem de inserção (`board-engine.ts:69-75`) | Ordem do sprint explícita (rank); ferramenta `suggest` para alterações fora dos critérios → inbox |
| B06 tabela critério→prova; Done humano | 🟡 | 🟡 | O Done é só humano ✅ | `finish_issue {criteria:[{id, met, evidence}]}`; só passa a Review com a tabela preenchida |
| B07 testes automáticos, 2 tentativas | ❌ | 🟡 | **Bug no dev:** `autoTest` chama `sleep` global nunca publicado (`board-engine.ts:34`). O ADR-0006 R3a corrige-o e corre os testes do projecto | Erro anexado ao prompt seguinte; limite de 2 tentativas → `ask_human` |
| B08 issue ↔ ramo/commits/prompt/modelo/custo | 🟡 | 🟡 | Ramo e merge ✅; o «modelo» guardado é o provedor; custo estimado | Commits (`git log --grep <key>`), sessão + versão do template, id real do modelo, custo real; abrir o diff |

### 1.3 Edição cirúrgica (RF-E)

| RF | dev | +ramos | Evidência | Falta |
|---|---|---|---|---|
| E01 `edit_lines` | 🟡 | 🟡 | O `edit` é str_replace e já dá diff mínimo. A A2 transforma `edit` e `write` em hunks de linhas inteiras (`hunks.rs`, teste `diff_touches_only_changed_lines`) | A ferramenta `edit_lines(path,start,end,new_text,anchor)` (ver decisão D3) |
| E02 âncora; recusa se mudou | 🟡 | ✅ | A2: `base` + texto `old`; `stale` quando o humano mexe nas mesmas linhas; `relocate` quando mexe noutras (testes `a_human_edit_*`) | — |
| E03 contexto numerado e por trechos | 🟡 | 🟡 | O `read` numera e tem offset/limit (`fs.rs:93`); a IDE não envia contexto ao agente v2; não há orçamento | Construtor de contexto para a issue (símbolo ±N, números de linha, orçamento de tokens) |
| E04 localização por símbolo | ❌ | ❌ | `codeintel::outline`/`symbol_ranges` existem (`codeintel.rs:80-88`, `tutor-eval/src/codemap.rs:179-215`) mas o agente e a UI não os usam | Ferramenta `outline`/`symbol` para o agente; plano com «`src/lib.rs: 40–52 (fn parse)`» |
| E05 reescrita só >60%, com aprovação | ❌ | 🟡 | A2: o `write` sobre um ficheiro existente vira hunks (I2) | Percentagem e justificação na revisão quando passa de 60%; lista de ficheiros gerados |
| E06 indentação/EOL/codificação | 🟡 | 🟡 | A2 mantém CRLF no `edit` (teste `edit_change_keeps_crlf_line_endings`). Falta: o `read` usa `lines()` (o modelo não vê `\r`); `from_utf8_lossy` corrompe ficheiros não-UTF-8; **o textarea do editor normaliza CRLF→LF e o autosave grava LF** (inferido, por testar) | Recusar ficheiros não-UTF-8; o editor lembra o EOL de cada ficheiro e repõe-no ao gravar |
| E07 Ctrl+Z desfaz o bloco da AI | ❌ | ❌ | Não há pilha de undo; o `reloadDisk` recria o textarea e perde o undo nativo | Pilha de undo própria por ficheiro no editor (passo = hunk aplicado) |
| E08 conjunto por issue no SCM | ❌ | 🟡 | A2: aceitar tudo / por bloco / rejeitar por bloco, por chamada; o *change set* em SQLite com `issue_key` fica para a A5 (§9) | Agrupar por issue e mostrar no SCM |

### 1.4 Streaming no editor (RF-S)

| RF | dev | +ramos | Evidência (A2) | Falta |
|---|---|---|---|---|
| S01 código no editor, não no chat | ❌ | 🟡 | Eventos `hunk_start/chunk/end`; o system prompt proíbe código na resposta (§7) | Confirmar a rede de segurança da UI (blocos com mais de 3 linhas fora do chat) e a linha «A escrever `src/lib.rs` 40–52» com link |
| S02 velocidade regulável | ❌ | 🟡 | `pace: () => 40` fixo (`codev/index.ts`), «Mais rápido» | Lento / Normal / Rápido / Instantâneo nas Definições; teste dos 400 car = 10 s ±10% |
| S03 realce e cursor «Co-Dev» | ❌ | ✅ | `hk-writing`, rótulo «Co-Dev», linhas antigas riscadas | Captura a 1440×900 (bug de base: `paintEd` vs `paintEdFull`, `editor.ts:59-65`) |
| S04 Seguir / «Voltar ao Co-Dev» | ❌ | ✅ | `stopFollowing`, «Voltar ao Co-Dev» | — |
| S05 Pausar/Acelerar/Parar | ❌ | ✅ | Espaço/Esc fora de campos de texto; o buffer continua a receber | — |
| S06 barra Aceitar/Rejeitar/Explicar por bloco | ❌ | ✅ | Barra por hunk; o «Explicar» vai pelo `codev.ask` (A2.4) | — |
| S07 o humano escreve → a AI cede | ❌ | ✅ | O intervalo do hunk fica só de leitura; `stale`/relocate; flush antes de cada turno e decisão. **No dev há perda silenciosa:** o autosave sobrescreve escritas da AI | Confirmar que a perda deixou de existir com a A2 (teste) |
| S08 abre separadores, um ficheiro de cada vez pela ordem do plano | ❌ | 🟡 | Abre o ficheiro do hunk activo | Ordem do plano (hoje é a do modelo) |
| S09 PairCode vê o stream | ❌ | ❌ | O PairCode sincroniza ficheiros inteiros, vista e cursor (`pair.ts:416-502`) | Novo tipo de mensagem com os eventos do overlay |

### 1.5 Arquitectura (RF-A)

| RF | dev | +ramos | Evidência | Falta |
|---|---|---|---|---|
| A01 ficheiro de regras editado no Studio | ❌ | ❌ | O Studio arch tem componentes, ligações, grupos (`layer`/`boundary`) e vistas (`features/arch/domain/types.ts`), guardados em localStorage. No repo só por exportação explícita (`docs/architecture/*.arch.json`). A validação é estrutural (`tutor-eval/src/arch.rs:320-620`) | `architecture.yaml` (camadas, dependências, bibliotecas, nomes); o Studio edita-o e grava; commit humano |
| A02 regras no prompt | 🟡 | 🟡 | Entram indirectamente se estiverem em `regras.md`/`AGENTS.md` | Bloco «Restrições do arquitecto» no template, gerado do YAML |
| A03 verificador de patch | ❌ | ❌ | Não existe (o code review é por regex; `problems.rs` só corre linters). Inspiração: A7 do `scripts/arch-check.sh` | Verificador por hunk (imports, camadas, bibliotecas) → vermelho e aceitação bloqueada |
| A04 desvios só com ADR | ❌ | ❌ | Só no protótipo (`team.ts:73`) | ADR como ficheiro com estado; override pede o número; a AI não aprova |
| A05 drift inclui as regras | ❌ | ❌ | O drift actual é desenho cloud vs ambiente (`infra/domain/environments.ts:43-58`, simulado) | Varredura de conformidade do repo; painel por ficheiro e por issue |
| A06 papéis | ❌ | ❌ | Não há utilizador nem papéis; só `owner:"you"` e direitos do protótipo | Papéis por pessoa e matriz de aprovação (ver decisão D5) |

### 1.6 Rastreabilidade e custo (RF-T)

| RF | dev | +ramos | Evidência | Falta |
|---|---|---|---|---|
| T01 registo de auditoria | ❌ | ❌ | O JSONL da sessão (`session.rs:25-66`) guarda meta + mensagens; sem timestamps, origem, modo por acção, quem aprovou, tokens nem custo | Registo de auditoria por acção + exportação JSON por issue |
| T02 trailers, autor humano | 🟡 | 🟡 | O desktop faz commit com a identidade do utilizador e `Assisted-by: <agente> (dxtutor Co-Dev)` (`platform/desktop/git.ts:84-102`). **Bug:** `tutor-eval::git::commit` força `user.name=dxtutor` (`crates/tutor-eval/src/git.rs:452-467`), autor não humano. O agente pode fazer `git commit` via `bash` sem trailers | `Assisted-by: <modelo>`, `Issue: <id>`; o agente não faz commits (é a IDE que os faz depois da aceitação) |
| T03 orçamento | ❌ | ❌ | Não há (o ADR-0003 fala de `task_budget`, por implementar) | Orçamento por issue e por sprint; aviso aos 80%, paragem aos 100% |
| T04 custo real | 🟡 | 🟡 | O agente v2 tem `usage` real (`provider.rs:133-138`); o board injecta 2600 tokens fixos (`board-engine.ts:60`). O ADR-0006 R3c envia o uso real (`onUsage`) | Custo persistido por issue (no backend) |
| T05 segredos mascarados | ❌ | ❌ | Não há máscara; o `read` de `.env` é permitido e o JSONL fica em claro (0600) | Módulo de redacção antes de gravar e antes de enviar |

### 1.7 PairCode (RF-P)

| RF | dev | +ramos | Evidência | Falta |
|---|---|---|---|---|
| P01 janela não cobre o chat | ✅ | ✅ | `pair.ts:896-942` | Teste automático (opcional) |
| P02 controlo por pedido e aceitação | ✅ | ✅ | `pair.ts:328-334, 507-565`; self-test `pair.ts:1053-1140`; `pairtest.sh` | — |
| P03 só o driver executa e aprova | ❌ | ❌ | Board e aprovações não consultam o PairCode | Guarda `amDriver` por porta (não por `window.PAIR`) |
| P04 «driver: guest» no registo | ❌ | ❌ | Não há registo | Campo `driver` em cada aceitação (depende de T01) |
| P05 token de uso único + 30 min | 🟡 | 🟡 | O token expira no End ✅; um convidado de cada vez ✅. **Bug:** quando o convidado sai, o anfitrião volta a «waiting» **com a mesma chave** (`src-tauri/src/pair.rs:196`); qualquer pessoa com o token pode reentrar, apesar de a UI dizer «It works once per session» (`pair.ts:843`) | Uso único real; expiração após 30 min sem ligação |

## 2. Bugs encontrados que contradizem os RF (corrigir na F0)

| # | Bug | RF | Onde |
|---|---|---|---|
| 1 | O Esc não pára o agente v2 | G07 | `features/codev/ui/chat-view.ts:174-188` (`agCtl` sem `'esc'`), `boot.ts:186` |
| 2 | Token do PairCode reutilizável depois de o convidado sair | P05 | `src-tauri/src/pair.rs:161-198` |
| 3 | `git_commit` do backend força o autor `dxtutor` | T02 | `crates/tutor-eval/src/git.rs:452-467` |
| 4 | O autosave sobrescreve em silêncio uma escrita da AI feita durante o turno | S07 | `platform/desktop/workspace.ts:85-108` (verificar se a A2 o resolve) |
| 5 | O editor converte CRLF→LF à primeira tecla (inferido) | E06 | `features/editor.ts:32` |
| 6 | `autoTest` rebenta (`sleep` não publicado) | B07 | `board-engine.ts:34` (corrigido no ADR-0006 R3a) |
| 7 | Ferramentas MCP que mudam estado correm sem perguntar em Auto | G02/G05 | `permissions/mod.rs:278-281` |
| 8 | As decorações do editor desaparecem ao escrever (`paintEd` base vs `paintEdFull`) | S03 | `features/editor.ts:59-65` |

## 3. Decisões do dono (bloqueiam partes do plano)

| # | Pergunta | Recomendação | Bloqueia |
|---|---|---|---|
| D1 | ~~**Nome:** `delonix-ide` ou `dxtutor IDE` (= Q8)?~~ **Respondida (2026-11-24): o nome é `dxtutor-ide`.** Onde o RF diz `delonix`, lê-se `dxtutor`: pasta `.dxtutor/` (que o agente já lê: `regras.md`, `permissions.json`, `hooks.json`, `mcp.json`, `team.json`, `studio.json`), `.dxtutor/prompts/issue.{pt,en}.md`, `.dxtutor/architecture.yaml` e o trailer `Assisted-by: <modelo> (dxtutor Co-Dev)` | — | — |
D2–D7 decididas pelo dono a 2026-11-24 («segue as tuas recomendações»):

| # | Decisão |
|---|---|
| D2 | **Primeiro o ADR-0006, depois a A2.** Na prática (§0.1) os dois já entraram, mas em `develop`s diferentes. A F0.1 passa a ser **reconciliar o `develop` local com o `origin/develop`**: o ADR-0006 retira o runner guionado, as missões e as sub-issues, por isso, nos conflitos com a A2/A5, ganha a versão sem demo. Faz-se num worktree, com a skill `consolidado`, combinado com as sessões que trabalham no checkout principal |
| D3 | **`edit_lines` é uma segunda ferramenta**, no mesmo pipeline de hunks da A2 (âncora = texto actual das linhas; se não coincidir, recusa e releitura). O `edit` str_replace fica |
| D4 | **Registo de auditoria em SQLite local da app**, ao lado do store do Project (A5), com exportação JSON por issue. O JSONL da sessão continua a ser a conversa |
| D5 | **Papéis:** identidade = `git config user.email`; papéis em `.dxtutor/team.json` (secção `people`); a IDE aplica a matriz de aprovação. Num desktop local isto é **aconselhado**, e a documentação di-lo; a imposição real faz-se com CODEOWNERS e protecção de ramos no servidor git para `.dxtutor/architecture.yaml` e `.dxtutor/prompts/` |
| D6 | **Velocidade em caracteres/s:** Lento 20 / Normal 40 (omissão) / Rápido 120 / Instantâneo |
| D7 | **Não há outros documentos:** este plano e o `RF-CODEV-STREAM.md` fazem o papel dos «Requisitos do backend» e do «Prompt de implementação» |

## 4. Plano

Princípios: cada passo deixa a app corrível; `ui:build` + `ui:test` + `arch:check` + `cargo test` verdes em cada
commit, mais `selftest.sh`/`pairtest.sh` no fim de cada fase; comandos novos em `generate_handler!` e na
`IPC-MATRIX.md`; código novo tipado e dentro de A7/A8; **a autoridade das regras é o backend** (ADR-0003 §6;
I3 da A2), e a UI só mostra e envia decisões. Os goldens afectados (sobretudo `board` e `codev`) listam-se em cada
passo e só se regeneram com o «sim» do dono (Q4).

**Coordenação:** há outra sessão a mexer em `codev_agent.rs` e `tools/mod.rs` (toolset v4, `arch_propose`).
Cada ferramenta nova sobe o `TOOLSET_VERSION`. Combinar a ordem antes da F1.

### F0 — Consolidar e corrigir (S/M) · pré-requisito

| Passo | O quê | Prova |
|---|---|---|
| F0.1 | ✅ **Feita (2026-11-24): `origin/develop` @ `ad42c85`.** Reconciliado o `develop` local (A2, A5, A1 e, já durante a consolidação, a A3) com o `origin/develop` (ADR-0006), num worktree (merges `5fe0f4b` e `ad42c85`). O quadro Tasks ficou com o `board_load`/`board_save` num SQLite próprio (`tasks.sqlite3`) ao lado do Project (Q3 por decidir). Verificado: ui:test 744, cargo test 587/0, arch:check (173 comandos), e2e 14/14, selftest `errors []` em 45 passos, pairtest sem erros. **Falta:** reauditar na §1 o que a A3 trouxe (papéis, permissões, passos do plano, relatórios de turno → G08, A06, T01) | Testes todos verdes; selftest desktop com `errors []`; reaudit rápida das linhas da §1 que mudaram |
| F0.2 | Bugs 1, 2, 3, 7 da §2 (o 6 vem com o ADR-0006) | Teste por bug (vitest para o Esc; `cargo test` para pair/git/permissions) |
| F0.3 | Bugs 4, 5, 8: confirmar com teste se a A2 os resolve; se não, corrigir | Teste de integração «o humano edita durante o turno» e «ficheiro CRLF sobrevive a uma tecla» |
| F0.4 | Base medida: `cargo test`, `selftest.sh`, `pairtest.sh` | Registo dos números na secção de estado deste documento |

### F1 — Governação e registo (RF-G01–G08, T01, T05) (L)

| Passo | O quê | Onde |
|---|---|---|
| F1.1 | ✅ **Feito** (ramo `feat/f1-governanca`): `permissions::Origin` (`chat`/`editor`/`issue`, `scope`), `Policy::require_origin` (só no IDE; a TUI/CLI não), `codev_agent_send` com `origin`, quem pediu = `board::actor` (git), «tentar de novo» herda. A UI envia `chat`, ou `issue` numa conversa aberta do quadro. **Origem**: `Origin {kind: issue\|chat\|editor, issue?, by}` em `StartSpec`/`send`, herdada por cada `PendingCall`. Ferramenta que muda estado num turno sem origem → `Verdict::Deny("bloqueada: sem pedido")` | `src-tauri/src/codev_agent.rs:41-68, 509`; `tutor-agent/src/agent.rs:69-78, 469`; `permissions/mod.rs:213` |
| F1.2 | ✅ **Feito** (e «Export audit log» no painel da issue do Project): migração 3 do store do Project (`audit`), uma linha por decisão sobre uma chamada (veredicto, resultado `allowed/denied/blocked/partial`, `policy`/`human:<nome>`/`cancel`, quando), por mudança de modo e por turno (modelo, tokens); comando `project_audit {root, issue?}` (JSON). **Falta:** custo em moeda (F4.9) e `driver` (F6.3). **Registo de auditoria** (D4): uma linha por acção com data, origem, modo, ferramenta, ficheiro+linhas, comando, veredicto, quem/quando aprovou, modelo, tokens, custo e driver (reservado para P04). Comando `audit_export {issue}` → JSON | Novo módulo Rust (store SQLite da app); a aprovação passa a registar quem e quando (`codev_agent.rs:604-630`) |
| F1.3 | ✅ **Feito** no que se grava: `tutor_agent::redact` (chaves conhecidas, Bearer, URL com senha, `chave=valor` secreto, valores secretos dos `.env`) no JSONL da sessão e no registo. Conservador: palavras comuns ficam (o JSONL volta ao modelo numa retoma). O que se **envia** ao modelo não é mascarado (o RF pede o registo). **Redacção (T05)**: mascarar chaves conhecidas, tokens e valores dos `.env` do projecto antes de gravar (JSONL e auditoria) e antes de enviar ao modelo | `SessionLog::sync` (`session.rs:210-221`), `Agent::request` (`agent.rs:255-268`) |
| F1.4 | ✅ **Feito** (mecanismo): `Origin.scope` com globs (`src/**`, `*.md`, `crates/*/src/**`); fora do âmbito → `Ask` com `dangerous` (sem «permitir sempre»), em todos os modos. **Falta:** a story ter âmbito (F4.1) e o comando `bash` (não se sabe o que escreve). **Âmbito (G03)**: `Scope {globs}` no `ToolCtx`; mudança fora do âmbito → `Ask{reason:"fora do âmbito"}` em qualquer modo | `tool.rs:13-18`, `Policy::decide` |
| F1.5 | ✅ **Feito**: deploys (`deploy`, `vercel --prod`, `pulumi up`), `helm` e `kubectl` que alteram o cluster, `gh pr merge`/`release`, migrações (prisma, rails, django, alembic, sqlx, diesel, flyway, liquibase, goose, `psql -f`), `rm`/`unlink`/`git rm`, `--force*` e merge/pull com um ramo partilhado em checkout → Dangerous; MCP pergunta também em Auto (salvo regra «permitir sempre»). **Classificador (G05)**: merge para `main`/`develop`, `gh pr merge`/`release`, `kubectl apply`, `helm`, `compose up`, `*deploy`, migrações, `rm`/`git rm` sem flags e `--force` genérico → Dangerous; MCP que muda estado → Ask | `permissions/shell.rs:483-755` + testes por comando |
| F1.6 | ✅ **Feito**: a mudança de modo fica no registo de auditoria e o Auto pára no fim da issue (o `finish_issue` da F4.5 fecha-a; depois disso nada muda). *(Estado corrigido no bloco 1 dos RF restantes: estava 🟡 por lapso.)* | `codev_agent.rs` (`settle_flow`), `app/store/agent.ts` |
| F1.7 | ✅ **Feito** (conjunto de ferramentas 6): `ask_human {question, options?}`; depois dela a política recusa qualquer mudança até à resposta; no fim do turno o anfitrião envia o evento `question` (o chat mostra-o), marca a issue do turno `blocked: "dúvida: …"` no Project e regista-o na auditoria. **Dúvida (G06)**: ferramenta `ask_human {question}` que termina o turno e emite o evento `question`; o Board marca `blocked:{reason:"dúvida"}` (golden do board: estado novo) | `tutor-agent/src/tools/flow.rs`; `board/domain/types.ts` |
| F1.8 | ✅ **Feito** (conjunto 6; decisão do dono: só antes de alterar ficheiros): em Manual e Assistido, alterar um ficheiro sem plano aprovado neste pedido é recusado com instrução para usar `exit_plan` (com ficheiros e linhas); comandos e perguntas não precisam. `exit_plan` passa a funcionar fora do modo plano. **Falta:** confrontar os hunks com os intervalos do plano (aviso). **Plano (G08)**: `exit_plan` estruturado `{steps:[{path,start,end,symbol?,why}], commands:[]}` (o evento `plan` da A2 já tem `files`); em Manual/Assistido a primeira mutação sem plano aprovado é recusada; hunk fora do plano → aviso no cartão | `tools/flow.rs:100-136`, `permissions/mod.rs:222-235` |
| F1.9 | ✅ **Feito** (no essencial): o Esc pára o Co-Dev (bug 1 da §2); depois do Stop nada mais é escrito (já era) e, se o turno já alterou ficheiros, o chat diz que ficaram e como os descartar (checkpoint do turno: «Rewind to here» / `/reverter`). **Falta (UI):** uma barra «aceitar/descartar» no próprio chat. **Stop (G07)**: depois do Stop, o *change set* do turno (incluindo os aplicados provisórios no Auto) aparece para aceitar ou descartar (descartar = checkpoint do turno) | `codev_agent.rs:671-687, 769-777`; UI codev |
| F1.10 | ✅ **Feito** (conjunto 6): `suggest {title, why}` → caixa de entrada do Project (`op: propose`, origem «Co-Dev»), aviso no chat e linha na auditoria; o humano aceita ou rejeita (A5). O `genBacklog` do Studio já escrevia na caixa de entrada (A5.4). **Sugestões (G02)**: ferramenta `suggest {title, why}` → inbox do Board com Aceitar/Rejeitar; o `genBacklog` do Studio passa a escrever na inbox | Board (com a A5 PROJ-01) |

### F2 — Edição cirúrgica, o que falta depois da A2 (RF-E) (M)

| Passo | O quê | Onde |
|---|---|---|
| F2.1 | ✅ **Feito** (conjunto 8): `edit_lines {path, start, end, new_text, anchor}` — substitui ou insere (start = end + 1); âncora = texto actual das linhas, se não coincidir é recusado com o que lá está; mantém LF/CRLF e a linha final; recusa ficheiros não-UTF-8; no IDE vira hunk revisto, na TUI/CLI escreve directamente. Critério RF-E01 testado (3 linhas em 400 → diff de 3). `edit_lines(path,start,end,new_text,anchor)` (D3) no pipeline de hunks; inserção quando `start > end` | `tutor-agent/src/tools/fs.rs`, `hunks.rs`; `TOOLSET_VERSION` +1 |
| F2.2 | ✅ **Feito** (conjunto 8): ferramenta do anfitrião `outline {path, symbol?}` → símbolos com o intervalo de linhas (servidor de linguagem; reserva: mapa sintáctico), via `codeintel`, sem trazer o `tutor-eval` para o `tutor-agent`. Ferramentas `outline(path)` e `symbol(path,name)` para o agente (E04), via `codemap::symbol_ranges` (dependência `tutor-agent → tutor-eval`, ou ferramenta do anfitrião) | `tools/mod.rs`, `crates/tutor-eval/src/codemap.rs:179-215` |
| F2.3 | ✅ **Feito**: o contexto do código do prompt da issue (`tutor_agent::issue_prompt`, ≈ 4 000 tokens) passa a ir por símbolo — um ficheiro curto do âmbito vai inteiro; um longo (ou que já não cabe no orçamento) vai pelos símbolos que a issue menciona (em `` ` ``, chamados com `(`, ou nomes que só um identificador tem: `parse_header`, `listOrders`), cada um com ±5 linhas e números de linha reais, um cabeçalho «`src/lexer.rs: 121–130 (fn parse_header)`» e onde estão os outros símbolos; sem menção, o início do ficheiro e onde está o resto; uma pasta ou glob dá a lista e os trechos dos símbolos mencionados nos seus ficheiros. Os símbolos vêm do mapa sintáctico da IDE (`codemap::outline`, injectado em `render_with`: o `tutor-agent` não analisa línguas). Testes: `a_long_file_goes_as_the_mentioned_symbols_with_n_lines_around_and_where_the_rest_is`, `mentions_are_backticks_calls_or_identifier_like_names`, `the_symbol_context_stays_inside_the_budget`, `the_issue_prompt_shows_the_mentioned_symbols_of_a_long_file_with_the_real_syntax_map` | `crates/tutor-agent/src/issue_prompt.rs`, `src-tauri/src/board.rs` (`syntax_outline`) |
| F2.4 | ✅ **Feito**: um `write` sobre um ficheiro existente que substitui mais de 60% das linhas pede sempre aprovação (também em Auto) com a percentagem; abaixo disso a percentagem vai no motivo de uma aprovação que já se pedia; ficheiros novos não contam. E05: na revisão de um `write` sobre um ficheiro existente, mostrar a % de linhas alteradas; acima de 60% exige o campo `reason`; lista de ficheiros gerados (`@generated`, globs) | `hunks.rs` (finalize do write), cartão de revisão |
| F2.5 | ✅ **Feito**: `edit_lines` mantém CRLF e recusa não-UTF-8; o autosave do desktop repõe o fim de linha do disco (o textarea dá LF) e não grava diferenças que são só de fim de linha (`platform/desktop/eol.ts`). E06: o `read` assinala CRLF; recusar ficheiros não-UTF-8 em vez de `from_utf8_lossy`; o editor guarda o EOL de cada ficheiro e repõe-no ao gravar | `fs.rs:66-93, 174`; `features/editor.ts`, `platform/desktop/workspace.ts` |
| F2.6 | ✅ **Feito**: quando um bloco do Co-Dev é aplicado guarda-se o texto anterior do ficheiro (`app/codev-undo.ts`); Ctrl+Z no editor, sem nada escrito desde então, repõe-no exactamente (e o autosave leva-o ao disco); escrever no ficheiro devolve o Ctrl+Z ao undo do próprio editor. e2e `codev-hunks` (RF-E07). E07: pilha de undo por ficheiro no editor; cada hunk aplicado é um passo; Ctrl+Z repõe o conteúdo anterior exacto | `features/editor.ts` (sem Monaco) |
| F2.7 | ✅ **Feito**: o Source Control tem a secção «Co-Dev change sets» — os blocos aceites depois do último commit do `HEAD` (comando `project_change_sets`) que ainda estão na árvore de trabalho, um conjunto por issue (e um «Sem issue» para o chat e o editor), com os intervalos de linhas de cada ficheiro, **Stage** (prepara os ficheiros do conjunto e, com a caixa vazia, sugere a mensagem «título (CHAVE)», que dá o trailer `Issue:` da F4.8) e **Discard** (confirma com a lista de ficheiros; um ficheiro também tocado por outro conjunto vem marcado); cada ficheiro abre o diff. O conjunto é por ficheiro, não por hunk: Stage/Discard levam o ficheiro inteiro, o que a confirmação diz. Testes: `the_source_control_groups_the_change_sets_since_the_last_commit_by_issue`, `the_last_commit_time_bounds_the_change_sets_and_is_zero_without_one`, `ui-app/tests/scm.changesets.test.ts` | `tutor-board` (`change_sets_since`), `board.rs`, `features/scm/domain/changesets.ts`, `features/scm/application/git-extras.ts` |

### F3 — Streaming, o que falta depois da A2 (RF-S01/S02/S08) (S)

| Passo | O quê |
|---|---|
| F3.1 | ✅ **Feito**: «Velocidade de escrita no editor…» no menu «/» (Lento 20 / Normal 40 / Rápido 120 / Instantâneo), guardada entre execuções; critério RF-S02 testado (400 caracteres a Normal = 10 s). Opções de velocidade (D6) nas Definições; teste do ritmo (400 car em Normal = 10 s ±10%) sobre o `revealStep` puro |
| F3.2 | Confirmar a rede de segurança dos blocos de código no chat (§7 da A2) e a linha «A escrever `path` a–b» com link |
| F3.3 | Ordem do plano: hunks de um ficheiro fora da ordem do plano ficam à espera (ou o backend serializa pela ordem do `plan`) |
| F3.4 | Capturas Playwright a 1440×900: linha activa, bloco escrito, marca na margem que desaparece ao aceitar |

### F4 — Issues e template (RF-B01–B08, T02, T04) (L) · por cima do ADR-0006 R3 e da A5

| Passo | O quê | Onde |
|---|---|---|
| F4.1 | ✅ **Feito** (migração 4 do store do Project): «Como/Quero/Para», âmbito (globs), dependências, quem aprovou a DoR, tentativas, tabela de critérios e versão do template na issue; editáveis no painel da issue. Modelo da story: GWT estruturado (`acceptance[{id,given,when,then}]`), `scope[]`, `deps[]`, `estimate`, `owner`, `readyApprovedBy`, `templateVersion`, `sessionIds[]`, `commits[]`, `cost{tokens,usd}`, `blocked?` — com migrações versionadas no `tutor-board` (A5) | `crates/tutor-board`, `board/domain/types.ts`, `board/domain/persist.ts` (R3b) |
| F4.2 | ✅ **Feito**: `readiness()` no store (critérios em Dado/Quando/Então, story, âmbito, dependências em Done, sem bloqueio, aprovação humana) → `missing` em cada issue; «Ready» é recusado sem o resto; «Work on it with Co-Dev» fica desactivado com a lista; o anfitrião recusa a origem de uma issue que não esteja Ready. Decisão: a criação rápida de issues continua (rascunho); o que não grava sem critérios e âmbito é o «Ready». Formulário da story com validação (não grava sem critérios nem âmbito) e `readiness()` puro → botão «Executar com Co-Dev» desactivado com a lista do que falta (goldens do board) | `features/board/domain/`, `features/board.ts` |
| F4.3 | ✅ **Feito**: `tutor_agent::issue_prompt` com os blocos do RF por ordem (PT/EN embutidos, ou `.dxtutor/prompts/issue.{pt,en}.md` do projecto); idioma pelo texto da issue; regra «código, comentários e commits em inglês»; código do âmbito com números de linha dentro de um orçamento; regras do arquitecto de `.dxtutor/architecture.yaml` ou `regras.md`. **Template (B03/B04)**: `.dxtutor/prompts/issue.{pt,en}.md` com os blocos fixos do RF; renderizador no backend (partilhado com a TUI/CLI); escolha PT/EN pelo texto do developer; regra «code, comments and commits in English» no núcleo do prompt; template de origem embutido quando o projecto não tem ficheiro | `tutor-agent/src/context.rs` (novo `issue_prompt`) |
| F4.4 | ✅ **Feito**: comando `project_issue_prompt` (texto exacto, idioma, origem do template, versão, tokens ≈); «View prompt» no painel; «Work on it with Co-Dev» envia esse texto com `origin {issue, scope, template}`; a issue guarda a versão usada. `.dxtutor/` já está protegido do agente. **Editar na IDE (bloco 4 dos RF restantes):** «Edit template» no prompt da issue cria o `.dxtutor/prompts/issue.<lang>.md` a partir do embutido (com confirmação; o `Rendered` traz o texto do template) ou abre o do projecto no editor; «View prompt» mostra a versão nova (testes `the_project_template_wins_and_its_version_changes_with_it`, `RF-B04: «Edit template»…` em `project.test.ts`). **Falta:** o commit próprio feito pela IDE — alargar o `arch_rules_commit` do bloco 3 (PR #36) a `.dxtutor/prompts/` (Arquitecto ou Tech Lead) e um botão «Commit template»; até lá o ficheiro aparece no Source Control e commita-se de lá. «Ver prompt»: comando `codev_issue_prompt {issue}` devolve o texto exacto e os tokens (contagem do provedor quando existir; senão estimativa marcada como tal); a issue guarda `templateVersion` (hash do blob git); gravar o template = commit próprio feito pela IDE | `commands/codev_agent.rs`; UI board |
| F4.5 | ✅ **Feito** (conjunto 7): `finish_issue {criteria:[{index, met, evidence}]}` exige resposta a todos os critérios; a tabela vai para a issue, que passa a Review; depois disso nada muda (o Auto pára no fim da issue — F1.6); o Done continua humano. `finish_issue {criteria:[{id, met, evidence}]}`: sem tabela completa não há passagem a Review; o Auto pára aqui (G04); o Done continua humano | `tools/flow.rs`; `board-engine.ts` |
| F4.6 | ✅ **Feito**: depois do `finish_issue` correm os comandos de teste do projecto; falha → «Em curso» com o erro no próximo prompt; 2.ª falha → bloqueada «precisa de ajuda». Ciclo de testes (B07): depois da execução, os testes do projecto (R3a); a falha volta a «Em curso» com o erro no prompt seguinte; 2 falhas → `ask_human` | `board-engine.ts`, template |
| F4.7 | ✅ **Feito**: ramo, commits, *change sets*, relatórios, versão do template e tabela de critérios já estavam na issue (A5/A3/F4); agora o painel soma o que o Co-Dev usou — turnos, sessões, ids reais dos modelos, tokens de entrada e saída e custo real (os turnos sem preço contam à parte) — a partir das linhas `turn` do registo de auditoria (`IssueDetail.usage`), e cada *change set* abre o diff do ficheiro. Testes: `the_issue_panel_sums_the_turns_of_its_issue`, `RF-B08: the issue panel sums…` em `project.test.ts` | `tutor-board` (`ProjectStore::usage`), `features/project/ui/view.ts` |
| F4.8 | ✅ **Feito** (inclui o bug 3 da §2): o `git_commit`/merge do backend usa a identidade git do humano e recusa sem ela (já não assina como `dxtutor`); o commit da IDE leva `Assisted-by: <modelo> (dxtutor Co-Dev)` e `Issue: <chave>`; um `git commit` do agente pede sempre aprovação. Commits (T02): o agente não faz `git commit` (Ask/Deny na política); a IDE faz o commit depois da aceitação com o autor = utilizador git e os trailers `Assisted-by: <modelo> (dxtutor Co-Dev)` + `Issue: <id>`; remover a identidade fixa do bug 3 | `platform/desktop/git.ts:84-102`, `permissions/shell.rs` |
| F4.9 | ✅ **Feito**: `tutor_agent::cost` (a mesma tabela da UI); cada turno guarda `cost_usd` dos tokens reais no registo. O valor fixo de 2600 já tinha saído; no bloco 4 saem também os dólares que o quadro Tasks antigo calculava com uma taxa fixa por provedor (`RATE`, «example values»): o quadro mede tokens, tempo e correcções, e diz que o custo real dos turnos do Co-Dev, ao preço do modelo, está no painel da issue do Project (F4.7). Teste `F4.9: com custo medido, o quadro antigo mostra tokens e não dólares de uma taxa fixa` em `team.r3c.test.ts`. Custo (T04): somar o `usage` real por sessão no backend (o `cost.rs` previsto no ADR-0003) e por issue; tirar o valor fixo de 2600 | `tutor-agent`, `board` |

### F5 — Arquitectura (RF-A01–A06) (L)

| Passo | O quê | Onde |
|---|---|---|
| F5.1 | ✅ **Feito** (backend): `.dxtutor/architecture.toml` — TOML como o `harness.toml`, para não acrescentar uma dependência de YAML (o RF dá o YAML como exemplo): `[[layers]]` (nome, caminhos, `may_use`, `imports`), `[libraries]` (proibidas/aprovadas), `[[naming]]`, `[[exceptions]]` com o ADR. `.dxtutor/` é protegido do agente: só um humano as muda. As regras entram no prompt das issues (A02). Esquema `.dxtutor/architecture.yaml`: `layers[{name, paths}]`, `allow[{from,to}]`, `libraries{approved,forbidden}`, `naming[{glob, pattern}]`; tipos no domínio da feature `arch` e validação em Rust | `features/arch/domain/`, `tutor-eval/src/arch.rs` |
| F5.2 | ✅ **Feito**: o Studio («Architecture» → **§ Rules**) edita o `.dxtutor/architecture.toml` como formulário — camadas (nome, caminhos, de quem podem depender ou «qualquer uma»), bibliotecas proibidas/aprovadas, regras de nomes e excepções com ADR. **Layers from the drawing** faz uma camada de cada grupo «Layer» (caminhos `src/<nome>/**`, a acertar) e cada seta entre componentes de duas camadas diz que a primeira pode depender da segunda (junta, nunca tira). Grava pelo backend (`arch_rules_save`: `conformance::validate` recusa com cada problema; só o Arquitecto quando o `team.json` nomeia pessoas; quem não o é vê as regras só para ler e porquê) e propõe o commit do arquitecto só com os ficheiros que mudaram (`arch_rules_commit`, `git commit --only`, identidade git humana). Testes: `the_architect_saves_the_rules_validated_and_a_developer_cannot`, `the_architects_commit_takes_only_the_rules_and_the_adrs`, `the_rules_the_studio_writes_are_validated_and_read_back_the_same`, `ui-app/tests/arch.rules.test.ts`; passo «archRules» do auto-teste desktop | `src-tauri/src/arch_rules.rs`, `tutor_agent::conformance`, `features/arch/{domain,application}/rules.ts`, `features/arch/ui/view.ts` |
| F5.3 | ✅ **Feito**: `tutor_agent::conformance` (imports de Rust, TS/JS, Python, Go, Java/Kotlin, C#, Swift, C/C++) e um portão em cada alteração do agente: biblioteca proibida/não aprovada, dependência entre camadas não permitida ou nome fora da convenção → recusada em qualquer modo, com o motivo. Só se verificam as linhas que a alteração acrescenta. Verificador de conformidade (A03): extracção de imports por linguagem (rs/ts/js/py/go/java/kt/cs/swift/cpp; regex primeiro, como o A7 do `arch-check.sh`), ficheiro→camada, dependências permitidas, biblioteca vs manifesto; corre em cada `hunk_end` → o hunk leva `violations` | Rust (`tutor-eval` ou módulo novo); `hunks.rs` |
| F5.4 | ✅ **Feito** (mecanismo): um desvio só passa com `[[exceptions]] adr = "ADR-…"` e esse ADR **aceite** em `docs/adr|architecture|decisions/` (linha `Status: accepted` / `Estado: aceite`); o agente pode redigir o ADR (proposto) mas não o aprova — mudar o estado é editar um ficheiro, coisa do humano. **Falta:** o override na UI e o papel Arquitecto (F5.7). Revisão: hunk com violação a vermelho e «Aceitar» bloqueado; o override exige o papel Arquitecto e o número de um ADR aceite (A04) | `codev_agent_review`; UI do overlay |
| F5.5 | ✅ **Feito**: um ADR (`docs/adr/`, `docs/decisions/` e — agora também — os `ADR*` de `docs/architecture/`, `roles::is_adr`) é caminho protegido: a alteração do agente pede sempre aprovação e só a aprova o Arquitecto (`role_gate`, F5.7). No painel «Rules» do Studio, a lista de ADRs com o estado e **Accept** (`adr_accept`, só o Arquitecto): o estado passa a `accepted` (`aceite` quando está escrito «Estado»), por baixo fica «Approved by: nome <email> (data)» na mesma forma (lista a negrito, linha simples ou chave YAML do front matter), e a excepção da F5.4 que o nomeia passa a valer; o commit do arquitecto leva-o. Testes: `accepting_an_adr_keeps_its_form_and_says_who_approved_it`, `the_adrs_are_listed_and_only_the_architect_accepts_one`, `roles_by_git_identity_and_what_each_approves` | `src-tauri/src/arch_rules.rs`, `src-tauri/src/roles.rs`, `tutor_agent::conformance` |
| F5.6 | ✅ **Feito** (por ficheiro): o scan do painel Problems junta o `arch_conformance` aos compiladores/linters — cada violação das regras aparece como erro com a fonte «arquitectura», agrupada por ficheiro, e volta a ser calculada a cada gravação (uma violação nova aparece na mesma sessão). **Falta:** a vista por issue. Drift de regras (A05): varredura de conformidade do repo e painel «Architecture» por ficheiro e por issue (via *change sets*), actualizado ao gravar | painel/Problems; `features/arch` |
| F5.7 | ✅ **Feito** (`4693df8`): `people[{email, roles}]` no `.dxtutor/team.json` (`src-tauri/src/roles.rs`); o Ready e o Done só com Product Owner ou Tech Lead (`project_apply`); as regras e os ADR só com o Arquitecto e os templates com o Arquitecto ou o Tech Lead (`role_gate` em `codev_agent.rs`, que também os faz perguntar sempre). Teste `rules_and_adrs_need_the_architect_and_never_pass_alone`. *(Estado corrigido no bloco 1 dos RF restantes: estava ❌ por lapso.)* | `src-tauri/src/roles.rs`, `codev_agent.rs`, `board.rs` |

### F6 — Custo e colaboração (RF-T03, P03–P05, S09) (M)

| Passo | O quê | Onde |
|---|---|---|
| F6.1 | ✅ **Feito**: orçamento em dólares por issue e por sprint (migração 5), gasto = custo real dos turnos no registo; ao trabalhar numa issue vale o mais apertado dos dois; aos 80% o chat avisa; quando o próximo pedido (tão caro como o último) passaria o limite, o Co-Dev pára antes e regista-o; com o orçamento esgotado o pedido nem começa. Orçamento e gasto no painel da issue e no planeamento do sprint. Orçamento (T03): `budget{tokens,usd}` na issue e no sprint; verificado depois de cada `Usage`; aviso aos 80%; aos 100% o turno pára e pede autorização (como uma aprovação) | `AgentConfig` (`agent.rs:39-50`), `codev_agent.rs` |
| F6.2 | ✅ **Feito**: registo `app/pair-state.ts` (sem global no window); numa sessão PairCode, quem não conduz não executa issues com o Co-Dev (botão desactivado e recusa no serviço) e os pedidos de aprovação/hunks que lhe cheguem são recusados com aviso (recusar é sempre seguro; parar continua possível). P03: porta `PairState.amDriver()` (sem `window`); Board, composer e aprovações desactivados para o navigator | `pair.ts:240`; `features/board.ts`, `agent-chat.ts:101` |
| F6.3 | ✅ **Feito**: cada decisão leva ao backend quem conduzia (`driver: host|guest`), que fica em todas as linhas do registo de auditoria a partir dela. P04: `driver: host\|guest` em cada aceitação no registo | F1.2 |
| F6.4 | ✅ **Feito** (inclui o bug 2 da §2): o token do anfitrião é de uso único — quando o convidado sai, a sessão acaba e o mesmo token não reabre nada (teste de loopback); sem convidado em 30 min (`DXTUTOR_PAIR_IDLE_SECS`) o token expira; a UI do anfitrião avisa e termina. P05: uso único real (o token caduca quando o primeiro convidado entra ou sai) e expiração após 30 min sem ligação; corrigir o texto da UI | `src-tauri/src/pair.rs:161-198` + testes |
| F6.5 | ✅ **Feito** (sem verificação manual a duas máquinas): o anfitrião envia pelo canal cifrado do PairCode os eventos dos hunks do Co-Dev (`hunk_*`, `validation`, `done`); o editor do convidado desenha-os no seu overlay (linha activa, bloco escrito), só de leitura — decidir é do lado de quem corre o agente. S09: mensagem PairCode `t:"codev"` com os eventos do overlay; o convidado desenha o mesmo realce | `pair.ts:305+`, overlay da A2 |

### F7 — Aceitação ponta a ponta

**Feita (2026-11-24): `ui-app/e2e/acceptance.e2e.ts`** — a app real contra um backend com guião (store do Project e agente do Co-Dev), e as regras provadas nos testes do Rust. A lista do RF, item a item:

| Item da lista do RF | Prova |
|---|---|
| A story não grava (não fica Ready) sem critérios e âmbito | e2e passo 1–2; `tutor-board` `scrum_needs_ready…`, `readiness_lists_what_is_missing…` |
| O prompt montado pelo template, com as regras do arquitecto; modo Assistido | e2e passo 3–4 (texto exacto, origem `issue` + âmbito + versão do template); `tutor-agent` `issue_prompt::*` |
| Plano (ficheiro + linhas) e escrita no editor a ~40 car/s com a linha activa realçada; o chat sem código | e2e passo 5; `codev.composer` RF-S02 (400 car = 10 s); `toolset_6_gates_plan_first…` |
| O diff só com as linhas necessárias; reescrever o ficheiro pede aprovação | `hunks::edit_lines_changes_only_its_lines…` (3 em 400); `a_write_that_rewrites_most_of_a_file…` |
| Um import proibido bloqueia a aceitação | `conformance::forbidden_libraries…`; `a_change_that_breaks_the_architects_rules…` |
| Os testes correm sozinhos; a tabela de critérios; Done humano | `the_criteria_table_sends_the_issue_to_review…`; `codev_answers_the_criteria_then_tests…`; e2e passo 6 |
| Commit com autor humano e trailers; o registo com custo e aprovações | `git::stage_commit_roundtrip` (autor humano, recusa sem identidade); `scm.domain` trailers; `the_ide_requires_a_request_and_logs_turns…`; `budgets_per_issue_and_sprint…` |
| Os testes existentes continuam a passar (`cargo test`, `selftest.sh`, `pairtest.sh`) | `cargo test --workspace` 628/0, selftest desktop `errors []` em 45 passos, pairtest de duas instâncias sem erros |

O e2e encontrou um bug da F4, corrigido: num projecto Kanban sem lista de DoR a secção «Definition of Ready» não aparecia, por isso nem o «Ready» nem o que faltava — e o «Work on it with Co-Dev» ficava desactivado para sempre. A secção aparece agora em todos os métodos.

**Não coberto ponta a ponta:** uma corrida com o modelo real (não há modelo nesta máquina) e duas máquinas reais no PairCode; cada peça está provada à parte.

Teste Playwright (`ui-app/e2e/`) mais o passo correspondente do selftest desktop, que reproduz a lista de verificação do RF:
story sem critérios não grava → prompt visto com as regras → Assistido com plano (ficheiro+linhas) → escrita a
40 car/s com realce e chat sem código → diff mínimo; `write` inteiro pede aprovação → import proibido bloqueia →
testes automáticos e tabela de critérios → Done humano → commit com autor humano e trailers → registo com
custo e aprovações. Mais `cargo test`, `selftest.sh` e `pairtest.sh` verdes.

## 5. Relação com as fases já planeadas (UI-AUDIT §6)

| Fase existente | Estes RF entram em |
|---|---|
| A0.5 (feita) | — |
| A2 Co-Dev no editor (ramo) | F2/F3 completam-na; F0.1 funde-a |
| ADR-0006 R1–R6 (ramo) | F0.1 funde-o; F4 constrói sobre o R3 (Board real, `board_load/save`, `onUsage`) |
| A5 Project/SQLite | F4.1 (modelo + migrações), F1.10 (inbox), F2.7 (*change sets*) |
| A3 Harness | F1.8 (plano), F1.2 (artefactos e registo), HARNESS-05 (painel de permissões) |
| A1 PairCode | F6.2–F6.5 |

Ordem recomendada: **F0 → F1 → F4 → F2 → F3 → F5 → F6 → F7.** É a ordem do RF com a F4 adiantada, porque a
origem `issue`, o âmbito e o fim de issue (F1.1, F1.4, F1.6) só ficam completos quando a issue tem âmbito
e `finish_issue`. A F1 entrega o mecanismo com o âmbito passado pelo chamador; a F4 liga-o à story.
