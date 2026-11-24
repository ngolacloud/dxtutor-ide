# RF-CODEV-STREAM — o Co-Dev escreve no editor, ao vivo

> Estado: **aprovado pelo dono em 2026-11-24** ("segue para a A2"), com as decisões abertas da §10
> resolvidas pelas opções por omissão aí registadas. O dono pediu que este contrato fosse escrito aqui,
> porque o `RF-backend.md` citado pelo prompt não existe.
> Substitui a referência "RF-BK-S03" do prompt da Parte A.
> Âmbito: fase A2 (UI-CODEV-01/02) e base dos artefactos do harness (A3) e dos change sets do Project (A5).

## 1. Objectivo e invariantes

O código que o Co-Dev escreve aparece **no editor, enquanto é gerado**, só nas linhas que muda, com a
linha em escrita realçada e o bloco escrito marcado até o humano decidir. Nunca no chat.

Invariantes (testáveis):

- **I1** — o disco só muda quando um hunk é **aceite** (Manual/Assistido) ou **aplicado provisoriamente**
  (Auto, ver §5). Um hunk pendente vive só na memória do backend e no overlay do editor.
- **I2** — nunca se reescreve um ficheiro existente inteiro. `write` sobre um ficheiro existente é
  convertido em hunks pelo diff de linhas; linhas iguais não são tocadas.
- **I3** — todas as decisões são tomadas no **backend** (como hoje as permissões, ADR-0003). A UI mostra e
  envia decisões; não decide.
- **I4** — a ordem dos eventos é a ordem em que acontecem: um só canal Tauri por sessão (os eventos de
  canais Tauri diferentes não têm ordem garantida entre si).
- **I5** — um hunk refere sempre a impressão digital (`base`) do ficheiro em que foi calculado. Se o
  ficheiro mudar antes da decisão, o hunk fica `stale` e não é aplicado.
- **I6** — a resposta em prosa do modelo chega ao chat; blocos de código longos não (§7).

## 2. O que já existe e é reaproveitado

| Peça | Onde | Papel neste contrato |
|---|---|---|
| Loop do agente, eventos `AgentEvent` | `crates/tutor-agent/src/agent.rs` | ganha variantes novas (§3) |
| Input de ferramentas em streaming | `StreamEvent::ToolInputDelta`; `edit`/`write` têm `eager_input() = true` | fonte do texto do hunk enquanto o modelo escreve |
| Ferramentas `edit` (old→new exacto) e `write` | `crates/tutor-agent/src/tools/fs.rs` | passam a produzir hunks em vez de escrever logo |
| Frescura dos ficheiros (`check_fresh`, `FileState`) | `tools/fs.rs` | origem do `base` e do estado `stale` |
| Permissões no backend (`Policy::decide`, modos) | `crates/tutor-agent/src/permissions/mod.rs`, `tutor_llm::policy` | ganha a regra dos hunks (§5) |
| Checkpoint por turno (refs git) | `crates/tutor-agent/src/checkpoint.rs` | rollback do modo Auto (§5) |
| Canal `codev-agent://event` `{session, event}` | `src-tauri/src/commands/codev_agent.rs` | transporte único (I4) |
| Pedido de aprovação `codev-agent://approval` | idem | continua para comandos/MCP; as edições passam a usar `hunk_review` |

## 3. Eventos

Transporte: o canal existente **`codev-agent://event`**, payload `{ session: string, event: AgentEvent }`,
com `event.kind` em snake_case. Os nomes lógicos do prompt mapeiam assim:

| Nome do prompt | `event.kind` | Emitido por |
|---|---|---|
| `codev-plan` | `plan` | `exit_plan` e `todo_write` (já existem; passam a evento próprio) |
| `codev-text` | `text` | deltas de texto do modelo (hoje dentro de `stream`) |
| `codev-hunk-start` | `hunk_start` | quando `path` e `old_string` do `edit` estão completos no input em streaming |
| `codev-hunk-chunk` | `hunk_chunk` | cada delta de `new_string` (ou de `content` num ficheiro novo) |
| `codev-hunk-end` | `hunk_end` | fim do bloco `tool_use` |
| — | `hunk_review` | o hunk espera decisão (Manual/Assistido) |
| — | `hunk_applied` / `hunk_rejected` / `hunk_stale` | resultado da decisão |
| — | `validation` | resultado da validação (Auto, e opcional nos outros modos) |
| `codev-done` | `done` | fim do turno (já existe) |

Os eventos actuais (`stream`, `tool_start`, `tool_result`, `usage`, `checkpoint`, `notice`, `retrying`,
`served_by`, `done`) **mantêm-se** com o mesmo formato. Para `edit`/`write`, `stream` com
`ToolInputDelta` continua a existir, mas a UI nova usa os eventos `hunk_*`.

### 3.1 Payloads

Todos os inteiros de linha são 1-based. `range` é sempre no ficheiro **tal como está em `base`**.

```jsonc
// plan
{ "kind": "plan", "steps": [ { "id": "s1", "text": "Fix the moved iterator",
    "files": [ { "path": "crates/lexer/src/lib.rs", "start": 5, "end": 5 } ],
    "state": "pending" } ] }        // state: pending | in_progress | done

// text — prosa do assistente (já sem blocos de código longos, §7)
{ "kind": "text", "text": "The loop moves `chars`; borrowing it fixes E0382." }

// hunk_start
{ "kind": "hunk_start",
  "hunk": "h-7f3a",                 // id estável do hunk
  "call": "toolu_01…",             // id do tool_use (um edit = um hunk; um write pode dar vários)
  "path": "crates/lexer/src/lib.rs",
  "op": "replace",                  // replace | insert | delete | create
  "range": { "start": 5, "end": 5 },// linhas substituídas (insert: start = end + 1, linhas antes de start)
  "base": "sha256:…",              // impressão digital do ficheiro usada para o cálculo (I5)
  "old": "    for c in chars {\n" } // texto substituído (vazio em insert/create)

// hunk_chunk — texto novo a acrescentar ao hunk, por ordem
{ "kind": "hunk_chunk", "hunk": "h-7f3a", "text": "    while let Some(c) = cha" }

// hunk_end — o texto final é a concatenação dos chunks; vem repetido para verificação
{ "kind": "hunk_end", "hunk": "h-7f3a", "text": "    while let Some(c) = chars.next() {\n",
  "lines": { "added": 1, "removed": 1 } }

// hunk_review — o backend espera decisão sobre estes hunks (todos do mesmo `call`)
{ "kind": "hunk_review", "call": "toolu_01…", "hunks": ["h-7f3a"],
  "reason": "Assisted mode: you accept every change", "why": "E0382: `for` moves `chars`" }

// hunk_applied — escrito em disco (Manual/Assistido) ou aplicado provisoriamente (Auto)
{ "kind": "hunk_applied", "hunk": "h-7f3a", "provisional": false, "fingerprint": "sha256:…" }

// hunk_rejected
{ "kind": "hunk_rejected", "hunk": "h-7f3a", "by": "human", "reason": "Not this approach" }
//   by: human | validation | cancel

// hunk_stale — o ficheiro mudou antes da decisão; não foi aplicado
{ "kind": "hunk_stale", "hunk": "h-7f3a", "path": "crates/lexer/src/lib.rs" }

// validation
{ "kind": "validation", "status": "passed",           // running | passed | failed | skipped
  "checks": [ { "command": "cargo test -p lexer", "ok": true, "summary": "4 passed" } ],
  "baseline": [ { "command": "cargo test -p lexer", "ok": false } ] }
```

### 3.2 Como o backend obtém o intervalo antes de o texto novo chegar

O `ToolInputDelta` traz JSON parcial. Um parser incremental (módulo novo `tutor-agent/src/hunks.rs`)
acompanha os campos do `edit`:

1. Quando `path` e `old_string` ficam **completos** (o modelo emite as chaves por ordem do schema; se a ordem
   vier trocada, o `hunk_start` espera pelo `old_string`), o backend lê o ficheiro, aplica as mesmas regras
   do `edit` (existe uma só vez, salvo `replace_all`; ficheiro lido e fresco) e calcula `range` e `base`.
   Se as regras falharem, **não** emite `hunk_start`: a ferramenta vai falhar com o erro de hoje e o
   modelo corrige.
2. Cada pedaço de `new_string` descodificado (escapes JSON tratados, incluindo pares substitutos) sai como
   `hunk_chunk`.
3. No fecho do bloco sai `hunk_end` com o texto completo.

`replace_all` com várias ocorrências produz um hunk por ocorrência, com o mesmo `call`.

`write` de **ficheiro novo**: `op: "create"`, `range {start:1,end:0}`, chunks de `content` ao vivo.
`write` de **ficheiro existente**: o conteúdo é acumulado; no fim, diff de linhas contra `base` e um
`hunk_start`/`hunk_end` por bloco diferente (sem chunks intermédios, porque o intervalo só se conhece no
fim). Linhas iguais não são tocadas (I2). Biblioteca de diff: ver §10, D3.

## 4. Comandos (UI → backend)

| Comando | Argumentos | Efeito |
|---|---|---|
| `codev_agent_review` *(novo)* | `{ session, call, decisions: [{ hunk, accept: bool, reason?: string }] }` | Decide os hunks de um `hunk_review`. A ferramenta aplica **só** os aceites (re-verificando `base`) e devolve ao modelo um resultado que diz quais entraram e quais não, com o motivo. Hunks sem decisão = rejeitados. |
| `codev_agent_approve` *(existente)* | sem alterações | continua a decidir comandos, MCP e o resto |
| `codev_agent_cancel` *(existente)* | — | Stop: hunks pendentes → `hunk_rejected {by:"cancel"}` |

A pausa e o ritmo (40 caracteres/s por omissão, configurável) são **da UI**: o overlay acumula os chunks e
desenha-os ao ritmo escolhido; o backend não abranda o modelo. "Mais rápido" mostra o buffer de uma vez.
"Explain" não é comando do contrato: a UI chama `codev.ask` (UI-CODEV-03) com o hunk como contexto.

O comando entra em `generate_handler!` e em `docs/architecture/IPC-MATRIX.md` (A1–A3).

## 5. Modos

| Modo | Edições (hunks) | Comandos | Mudança face a hoje |
|---|---|---|---|
| **Manual** | `hunk_review` para cada chamada; o humano decide cada hunk | aprova cada um | igual em espírito (hoje pergunta por chamada) |
| **Assistido** | `hunk_review` para cada chamada; o humano decide | como hoje (Unknown/MCP perguntam) | **muda**: hoje o Assistido aplica edições sem perguntar. O prompt exige aceitação humana. Afecta `tutor_llm::policy` (partilhado com a TUI/CLI) |
| **Auto** | aplicado em disco com `provisional: true`; no fim do turno o backend corre a validação; se passar → `validation passed`, os hunks ficam definitivos; se falhar ou piorar a base → **rollback ao checkpoint do turno**, `hunk_rejected {by:"validation"}` e aviso | como hoje | **muda**: hoje o Auto aplica sem validação final |

Regras comuns:

- As regras "permitir sempre" para `edit` **não** dispensam a revisão de hunks em Manual/Assistido
  (continuam a valer para comandos).
- O piso de segurança mantém-se: ficheiros protegidos (`.git/`, `.dxtutor/`, `.env`, `.ssh/`,
  `.github/workflows/`) pedem sempre revisão, mesmo em Auto.
- **Validação** = comandos de teste e lint detectados para o projecto (`project_test_command`, já existe)
  corridos antes da primeira edição do turno (base) e depois. "Nada partiu" = nenhum check que passava na
  base passa a falhar. Sem comandos detectados → `validation skipped` e, no Auto, os hunks **não** ficam
  definitivos sem o humano (degrada para Assistido nesse turno, com aviso).

## 6. Ciclo de vida de um hunk

```
streaming ──hunk_end──► proposed ──(Manual/Assist)──► review ──accept──► applied
    │                       │                           │ └─reject───► rejected
    │                       └──(Auto)──► applied(prov) ─┴─validation ok──► applied
    │                                                     └─validation fail─► rejected (rollback)
    └──cancel──► rejected                   qualquer estado antes de applied ──base mudou──► stale
```

## 7. O chat fica só com prosa

- O system prompt do agente passa a dizer: "Never put code you want applied in your reply; change files
  with `edit`/`write`. Short inline references in backticks are fine."
- Rede de segurança na UI: blocos de código delimitados com mais de 3 linhas no texto do assistente não
  são desenhados; aparecem como uma linha "Code is applied in the editor — ask Co-Dev to make the change"
  com um botão que pede a alteração via `edit`.
- Excepção explícita: respostas a pedidos de explicação ("explain", Learning Track, Tutor) podem mostrar
  código no chat, porque não são propostas de alteração. A excepção vem no pedido (`intent: "explain"`).

## 8. Editor (UI)

- Overlay sobre o Monaco: decoração forte na linha em escrita com o rótulo "Co-Dev"; decoração suave e
  marca no gutter em todo o bloco até à decisão; barra inline por hunk com Accept / Reject / Explain.
- Pausa com Espaço, Stop com Esc, "Faster"; o scroll segue o assistente até o humano fazer scroll (aí
  aparece "Back to Co-Dev").
- Durante um hunk pendente, **o intervalo** do hunk fica só de leitura no editor; o resto do ficheiro
  continua editável. Uma edição humana fora do intervalo muda a impressão digital → o backend recalcula o
  intervalo se o texto `old` ainda existir uma só vez; se não, `hunk_stale`.
- Antes de cada turno a UI força o autosave (`ctx.flushSave`) para o backend ler o mesmo que o humano vê.
- Ficheiro do hunk não aberto: abre-se num separador; com vários ficheiros, a UI segue o hunk activo.

## 9. Persistência

- O transcript JSONL da sessão (`~/.config/dxtutor/sessions/…`) regista os eventos `hunk_*` e as
  decisões (é o histórico de verdade da conversa; permite o "Rewind to here" do HARNESS-03).
- Os hunks aplicados formam um **change set** por turno. Na A5 ficam em SQLite
  (`change_sets(session, turn, call, path, start, end, added, removed, decided_by, decided_at, issue_key)`)
  para o Project os contar por issue. Até à A5 não se cria esta tabela.

## 10. Decisões (resolvidas por omissão em 2026-11-24; reversíveis)

- **D1 → só o IDE.** A revisão obrigatória de hunks no Assistido é uma opção do anfitrião
  (`review_edits`), ligada pelo IDE (`src-tauri`). `tutor_llm::policy` e a TUI/CLI não mudam.
- **D2 → degradar.** Auto sem comandos de validação detectados comporta-se como Assistido nesse turno,
  com aviso.
- **D3 → `similar`.**
- **D4 → depois.** O caminho legado `liveChat` sai quando a A2 estiver a funcionar e o dono confirmar.

Texto original das decisões:

- **D1** — a mudança do modo Assistido (§5) é de produto: confirmar que a TUI/CLI (que partilha
  `tutor_llm::policy`) também passa a pedir revisão no Assistido, ou só o IDE.
- **D2** — Auto sem comandos de validação detectados: degradar para Assistido (proposta) ou aplicar sem
  validação com aviso.
- **D3** — diff de linhas para `write` de ficheiros existentes: acrescentar a crate `similar` (Apache-2.0,
  madura) ao `tutor-agent`, ou implementar um Myers próprio. Proposta: `similar`.
- **D4** — o caminho legado `liveChat` (`assistant_chat_stream`, protocolo dxcode/dxaction, `write_file`
  inteiro) e as missões guionadas não cumprem I1/I2. Proposta: retirá-los quando a A2 entrar (Q3).

## 11. Testes que provam o contrato

- **Rust (`tutor-agent`)**: parser incremental (chaves por ordem e fora de ordem, escapes, pares
  substitutos, input truncado); cálculo de `range` (início/fim de ficheiro, CRLF, `replace_all`);
  aplicação parcial (aceitar 1 de 3 hunks); `stale` por mudança externa; política por modo (Assistido pede,
  Auto aplica provisório); rollback do Auto quando a validação falha; ficheiros protegidos.
- **Rust (`src-tauri`)**: `codev_agent_review` com decisões incompletas, hunk inexistente, sessão errada.
- **UI (vitest)**: redutor do overlay (sequência de eventos → estado dos hunks) puro no `domain/`; ritmo e
  pausa; bloco de código longo fora do chat.
- **E2E (Playwright, `ui-app/e2e/`)**: "fix this" desenha o hunk no editor com realce, o chat só tem prosa,
  Accept escreve em disco, Reject repõe; capturas a 1440×900.
