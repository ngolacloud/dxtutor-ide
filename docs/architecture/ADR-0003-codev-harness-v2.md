# ADR-0003 — Harness v2 do Co-Dev: loop de agente em Rust com tool use nativo

- **Estado:** aceite (recomendações do §11 aceites); F0 e F1 feitas (F1 sem UI: a ligação é a F4)
- **Data:** 2026-11-23
- **Decisor:** responsável do projecto (angolardevops)
- **Relacionado:** `ADR-0002` (camadas da feature Co-Dev na UI, que a F4 reutiliza);
  `ARCHITECTURE.md` §2 (crate novo `tutor-agent`, ver §3.1) e §6 (políticas do agente
  são autoridade do backend); `IPC-MATRIX.md` (os comandos `codev_agent_*` entram lá
  quando forem registados)

## 1. Objectivo

Fazer do Co-Dev um agente de engenharia ao nível do Claude Code / Claude Desktop:
um loop com **tool use nativo** que lê, edita, corre e verifica o projecto,
com **permissões decididas no backend**, sessões que **sobrevivem a reinícios**, e
um fluxo **plano → tarefas → execução → verificação → entrega** visível na IDE.

## 2. Ponto de partida (o que muda e porquê)

| Hoje | Problema | v2 |
|---|---|---|
| O modelo escreve blocos ` ```dxcode ` / ` ```dxaction ` no texto; o `bridge.ts` faz parse por regex (até 16 rondas) | Trunca ficheiros com fences; executa a meio do stream; resultados voltam como mensagem falsa `[dxcontinue]` | `tool_use` / `tool_result` nativos; loop guiado por `stop_reason` |
| Loop no frontend (webview) | Qualquer XSS conduz o agente; o webview precisa de `exec`/`run_shell` com acesso total | Loop em Rust; a UI só vê eventos e responde a aprovações |
| Continuação por *assistant prefill* (`chat.rs`) | **400 em `claude-opus-5-5`** (o modelo por omissão da UI); só funciona porque o modelo escolhido é ignorado e cai em `claude-haiku-4-5` | `max_tokens` alto em streaming; sem prefill |
| Aprovação por regex no frontend; a política em `tutor_llm::policy` só serve a modebar | Contornável (`rm -fr`, `git reset --hard`, …) | Classificador de comandos + regras por projecto, no backend |
| `CHAT` só em memória, últimas 9 mensagens, resultados de ferramentas descartados | Perde contexto; perde tudo ao reiniciar | Sessões em disco, histórico append-only, compactação |
| Sem retry; erros SSE a meio ignorados; tokens estimados (`len/4`) | Respostas parciais apresentadas como completas; custo invisível | Retry com backoff; erros tipados; `usage` real + custo |

## 3. Arquitectura

```
┌──────────────── ui-app (webview) ────────────────┐
│ features/codev/ui: cartões, diff, aprovações,    │
│   plano, todos, custo                            │
│ features/codev/application: live-chat ◄─eventos┐ │
│   (porta AgentGateway em ports.ts — ADR-0002)  │ │
│ features/codev/infrastructure: invoke tipado   │ │
└──────────────┬─────────────────────────────────┼─┘
 codev_agent_start / _send / _cancel /           │ codev-agent://event
 _approve / _rewind / _sessions                  │ {session, kind, …}
┌──────────────▼─────────────────────────────────┴──┐
│ src-tauri: commands/codev_agent.rs (adaptador fino)│
│   + codev_agent.rs (caso de uso Tauri-free)        │
└──────────────┬─────────────────────────────────────┘
┌──────────────▼──────── crates/tutor-agent (novo, síncrono) ───────┐
│ loop.rs      loop por stop_reason, paralelo/serial, cancelamento   │
│ provider/    trait Provider · anthropic.rs (SSE) · openai.rs        │
│ tools/       read · write · edit · glob · grep · bash · lsp · git · │
│              todo · run_tests · task (sub-agente) · exit_plan       │
│ permissions/ classificador de comandos · regras · modos            │
│ context/     system prompt · AGENTS.md/CLAUDE.md · memória ·        │
│              compactação · cache                                    │
│ session/     JSONL append-only · retoma · checkpoints              │
│ cost.rs      usage → custo                                          │
└──────────────────────────────────────────────────────────────────┘
       usa: tutor-llm (config/chaves), tutor-board (todos), tutor-eval (LSP, git)
```

### 3.1 Crate novo `tutor-agent` (ARCHITECTURE.md §2)

Grafo sem ciclos: `tutor-agent` → `serde`, `serde_json`, `ureq` (e, em F2+, `tutor-eval`
para LSP/git e `tutor-board` para os todos). Consumidores: `src-tauri` (por um caso
de uso Tauri-free, como os restantes grupos da Etapa 3), `tutor-tui` e `tutor-cli`.
Não depende de `src-tauri` nem de `tauri`.

**Decisão: crate novo `tutor-agent`, síncrono (ureq + threads)**, como o `tutor-llm`.
A TUI e a CLI reutilizam o mesmo agente; no Tauri cada sessão corre numa thread
(o padrão do `pty.rs`). O cancelamento é um `AtomicBool` verificado entre eventos
SSE, mais um timeout de leitura curto (≈15 s sem bytes), para nunca ficar preso
numa leitura bloqueante.

## 4. Modelo e API (Claude)

- **Modelo por omissão `claude-opus-5-5`.** O modelo escolhido nas Definições passa
  de facto ao pedido (corrige o bug actual).
- **HTTP directo** (Rust não tem SDK oficial), `anthropic-version: 2026-10-21`.
  Não enviamos `temperature`/`top_p`/`top_k`, por isso a mudança desta versão não nos afecta.
- **Thinking adaptativo** (`thinking: {type: "adaptive", display: "summarized"}`):
  no Opus 5.5 não se pode desligar, por isso mostramos o resumo na UI em vez de uma pausa muda.
- **Effort explícito:** `high` no loop do agente e `low` para o router e títulos.
  O Opus 5.5 tem `medium` por omissão.
- **`max_tokens` 64 000** em streaming. Sem prefill: com `stop_reason: max_tokens`
  a meio de um `tool_use`, a ferramenta não corre; o pedido repete-se com mais
  espaço, ou o modelo é avisado.
- **`eager_input_streaming: true`** nas ferramentas com entradas grandes (`write`, `edit`):
  o conteúdo do ficheiro aparece na UI à medida que é gerado. O preço é validar sempre
  o input contra o schema antes de executar (JSON inválido → `tool_result` com
  `is_error` e `INVALID_JSON`).
- **Histórico append-only.** Os blocos `thinking` voltam inalterados em cada pedido.
  É uma exigência do *preserved thinking* do Opus 5.5: editar o histórico invalida-os.
  Nunca se apagam nem reescrevem mensagens; reduzir contexto faz-se por compactação.
- **Recusas:** verifica-se `stop_reason: "refusal"` antes de ler o conteúdo, e nesse
  turno nenhuma ferramenta corre. Proponho ligar os **fallbacks do servidor por omissão**
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), com um selo na UI
  quando outro modelo respondeu. Decisão aceite (§11).
- **Erros e retry:** 429/529/5xx e erros de ligação com backoff exponencial + jitter,
  respeitando `retry-after` e `x-should-retry`, até 4 tentativas, **antes do primeiro byte**.
  Um evento SSE `error` a meio da resposta aparece como erro e não como fim de turno.

## 5. O loop

```
loop:
  resposta = provider.stream(pedido)         # eventos → UI em tempo real
  anexar resposta.content ao histórico (tal como veio)
  match stop_reason:
    end_turn      → fim do turno
    refusal       → mostrar; não correr ferramentas; fim
    max_tokens    → se houver tool_use incompleto: não executar; repetir com mais espaço
    pause_turn    → reenviar
    tool_use      → validar inputs → permissões → executar
                    (read-only em paralelo; mutações em série)
                    → TODOS os tool_result numa só mensagem user (is_error nas falhas)
  limites: nº de iterações (por omissão 60), cancelamento, orçamento opcional (task_budget)
```

**Eventos para a UI** (`codev-agent://event`): `text_delta`, `thinking_delta`, `tool_start`,
`tool_input_delta`, `approval_request`, `tool_result`, `usage`, `todo_update`,
`checkpoint`, `done`, `error`.

## 6. Ferramentas

Todas correm na raiz do projecto e passam pelo `ensure_within` do hotfix (symlinks incluídos).

| Ferramenta | Comportamento | Permissão |
|---|---|---|
| `read` | Linhas numeradas, `offset`/`limit`, até 2000 linhas ou 256 KB, com aviso de truncagem; regista o hash para o `edit` | livre |
| `glob` / `grep` | Respeitam `.gitignore` (crate `ignore`) e devolvem resultados limitados | livre, paralelas |
| `edit` | `old_string` → `new_string` exacto e único; **recusa se o ficheiro mudou desde o último `read`** | por modo |
| `write` | Ficheiros novos, ou sobrescrita de um ficheiro já lido | por modo |
| `bash` | Grupo de processos próprio, timeout, saída limitada (início + fim), sempre na raiz do projecto | classificador (§7) |
| `run_tests` / `lint` | Comandos detectados (`domain/project-commands.ts`, passados na configuração da sessão) | como no passo 2 |
| `lsp_diagnostics` | Diagnósticos do ficheiro ou do projecto (reutiliza o `lsp.rs`) | livre |
| `git_status` / `git_diff` | Só leitura | livre |
| `todo_write` | Lista de tarefas da sessão, sincronizada com o Board (`tutor-board`) | livre |
| `exit_plan` | Sai do plan mode e apresenta o plano para aprovação | — |
| `task` | Sub-agente com contexto próprio, só leitura por omissão (§9) | livre |

## 7. Permissões (backend)

- **Modos:** Manual (pergunta tudo), Assistido (leituras livres, edições e comandos
  seguros automáticos, o resto pergunta), Auto (só os perigosos perguntam).
  Liga o `tutor_llm::policy` (via `crate::codev::policy_for_mode`), que hoje só a
  modebar consulta.
- **Classificador de comandos** (substitui a regex):
  - divide os comandos com um parser de shell nos separadores `&&`, `;`, `|` e subshells,
    e classifica cada parte;
  - **perigoso:** qualquer variante de `rm -r`/`-f`, `git push`, `git reset --hard`,
    `git clean -f`, `git checkout -- .`, `sudo`, `dd`, `mkfs`, `chmod -R`, `find -delete`,
    `curl|wget … | sh`, e redirecções para fora da raiz do projecto;
  - **seguro:** a lista dos comandos de verificação e só-leitura (`ls`, `cat`, `git status/log/diff`, …);
  - **desconhecido:** pergunta no modo Assistido.
- **Regras persistentes:** `.dxtutor/permissions.json` (por projecto) e um ficheiro
  por utilizador, com `allow`/`deny` por prefixo de comando ou ferramenta. O cartão de
  aprovação tem a opção «permitir sempre `cargo build*` neste projecto».
- **Aprovação:** o backend emite `approval_request` e espera num canal; a UI responde
  com `codev_agent_approve(session, toolUseId, decisão, lembrar?)`.
- **Fecho de superfície:** quando o loop estiver em Rust, `exec`/`run_shell`/`write_text_file`
  deixam de aceitar caminhos e programas arbitrários vindos do webview (pendente desde o hotfix).

## 8. Contexto, sessão e custo

- **System prompt estável e cacheado:** núcleo do Co-Dev → instruções do projecto
  (`AGENTS.md`, `CLAUDE.md`, `.dxtutor/regras.md`, da raiz para a pasta actual) → memória.
  Ordem das ferramentas determinística.
  - Breakpoint explícito no fim do system prompt, mais cache automática no fim da conversa.
  - Nada volátil (hora, ficheiro activo) entra no system prompt. O que muda a meio
    (modo, ficheiro activo) entra como mensagem `system` a meio da conversa, que o
    Opus 5.5 suporta sem invalidar a cache.
  - Medida de sucesso: `cache_read_input_tokens > 0` a partir do 2.º turno.
- **Sessões em disco:** JSONL append-only por workspace, com os blocos completos.
  A UI lista as sessões e retoma-as.
- **Compactação:** a do servidor para o Claude (beta `compact-2026-01-12`, guardando os
  blocos `compaction`); um resumo feito pelo cliente para os outros provedores.
- **Memória:** `.dxtutor/memory/` por projecto, lida no arranque da sessão e escrita por
  uma ferramenta própria (fase 6).
- **Custo:** `usage` real (entrada, saída, leituras e escritas de cache) × tabela de
  preços por modelo, por turno e por sessão, na barra do Co-Dev.

## 9. Do plano à entrega

1. **Plan mode:** só ferramentas de leitura. O modelo termina com `exit_plan(plan)`.
   O plano aparece num cartão para aprovar ou editar, e ao ser aprovado passa a
   `todo_write` e a stories no Board.
2. **Execução com checkpoints:** antes de cada `edit`/`write`/`bash` mutante, faz-se um
   snapshot por um ref git sombra (`refs/dxtutor/cp/<sessão>/<n>`), ou por cópia dos
   ficheiros quando não há git. O botão «Voltar aqui» rebobina os ficheiros (a conversa
   continua append-only, com uma mensagem a explicar o rewind).
3. **Verificação:** `run_tests`/`lint`/`lsp_diagnostics` reais. O system prompt pede
   verificação antes de declarar a tarefa feita, e a UI mostra o resultado no cartão final.
4. **Revisão:** no modo Assistido, opção «rever cada diff antes de aplicar».
   O `delegate_task` (worktree isolada) passa a ser o modo «propor como patch».
5. **Sub-agentes (`task`):** um loop filho com contexto próprio, só leitura por omissão,
   que devolve um resumo. Modelo configurável (§11, aceite).

## 10. Fases e critérios de aceitação

Cada fase é um PR independente, com testes, e o CI tem de passar.

| Fase | Entrega | Aceitação |
|---|---|---|
| **F0 Fundações** | Crate `tutor-agent`; tipos canónicos; provider Anthropic com parser SSE completo (texto, thinking, `input_json_delta`, usage, erros); retry; modelo e versão correctos; sem prefill | Parser testado com fixtures SSE gravadas (sem rede); retry testado com servidor falso; zero chamadas reais nos testes |
| **F1 Loop** | Loop por `stop_reason`, ferramentas em paralelo/série, cancelamento, eventos; comandos Tauri `codev_agent_*` (+ IPC-MATRIX) | Testes com provider falso guionado: tool_use → result → end_turn; recusa; max_tokens a meio de tool_use; tool_results agrupados; cancelamento |
| **F2 Ferramentas** | read/glob/grep/edit/write/bash/run_tests/lsp/git | Testes em tempdir: staleness do edit, unicidade do old_string, symlinks, truncagem, timeout com kill do grupo |
| **F3 Permissões** | Classificador, regras, modos, aprovação ida-e-volta; `policy.rs` ligado | Tabela de ≥60 comandos (incluindo os contornos da regex actual) com a classificação esperada |
| **F4 UI v2** | O caso de uso `live-chat` (ADR-0002) passa a cliente fino do agente Rust através de uma porta `AgentGateway`; cartões de ferramenta, aprovação, thinking e custo; **remove o protocolo de fences e o prefill** | Fluxo real com uma pasta aberta, validado à mão por ti; typecheck/lint/testes |
| **F5 Contexto e sessão** | System prompt cacheado, AGENTS.md/CLAUDE.md, sessões JSONL e retoma, compactação, custo | Cache hit a partir do 2.º turno (medido); retoma após reinício |
| **F6 Plano → entrega** | Plan mode, todos↔Board, checkpoints e rewind, revisão de diffs, sub-agentes | Cenário guiado ponta-a-ponta num repositório de teste |
| **F7 Ecossistema** | Cliente MCP (stdio/http), hooks (antes/depois de ferramenta, fim de turno), slash commands e skills em `.dxtutor/` | Servidor MCP de exemplo ligado; hook que bloqueia uma ferramenta |
| **F8 Outros provedores** | Adaptador OpenAI-compatível (Codex, Gemini, Ollama) com tool calls; o protocolo de fences fica só como fallback para modelos sem tools | Testes com fixtures por provedor; matriz de funcionalidades na UI |

**F0 a F4 são o núcleo** e já substituem o harness actual. F5 a F8 levam-no à paridade.

## 11. Decisões (aceites a 2026-11-23)

1. **Âmbito dos provedores na primeira entrega.** ✅ *Aceite:* Claude primeiro (F0–F7) e
   o adaptador OpenAI-compatível em F8. Até lá, Codex, Gemini e Ollama continuam no harness actual.
2. **Fallbacks do servidor em caso de recusa** ligados por omissão. ✅ *Aceite*, com um selo na UI.
3. **Modelo dos sub-agentes.** ✅ *Aceite:* o mesmo do agente principal por omissão, configurável.
   Um modelo mais barato (ex.: `claude-haiku-5-5`) poupa custo, mas a escolha é tua.
4. **Effort do loop:** ✅ *Aceite:* `high` por omissão, com selector na UI (low…max).

## 12. Testes e custo de desenvolvimento

- **Sem rede no CI:** fixtures SSE gravadas e provider falso guionado para o loop.
- **Testes com a API real** só manuais e com a tua autorização: gastam dinheiro.
  Proponho um script `scripts/agent-smoke.sh` com 3 cenários curtos.
- Mais tarde, um conjunto de avaliação com tarefas reais da IDE, para comparar mudanças
  de prompt e effort com números.

## 13. Riscos

| Risco | Mitigação |
|---|---|
| Editar o histórico invalida o thinking preservado (erro ou perda de raciocínio) | Histórico append-only por construção (tipo sem métodos de remoção); só compactação do servidor |
| Cancelamento com I/O bloqueante | Timeout de leitura curto + flag verificada por evento |
| Custo descontrolado num loop longo | Limite de iterações, `task_budget` opcional, custo visível em tempo real |
| Regressão na UI durante a migração | F4 mantém o harness antigo atrás de uma flag até a v2 ser validada |
| Funcionalidades em beta (compactação, fallbacks) mudarem | Isoladas no provider, ligadas por configuração |
