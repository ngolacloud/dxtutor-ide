# Levantamento do harness do Co-Dev — face ao Claude Code/Desktop, ao Codex e ao Antigravity

Data: 2026-11-27. Base: `develop` com o PR #65 (`/backlog` e `/project`). Três análises: o código do Co-Dev (só
leitura, com ficheiro:linha), o modelo de workspace/projecto/quadro e as superfícies do IDE, e a pesquisa web das
capacidades actuais dos três produtos (documentação oficial e changelogs de 2025–2026; o que não tinha fonte ficou
«não confirmado»).

O objectivo do dono: o dxtutor-ide ser **o IDE escolhido para projectos onde Engenharia de Software, Platform
Engineering, SRE e DevOps são exigidos** — com o Co-Dev ao nível dos três, cada ferramenta do IDE ligada ao
assistente por uma skill, cada projecto a nascer num workspace (um ou vários projectos por workspace), o Co-Dev a
entender as fronteiras de cada projecto, e o quadro por projecto.

---

## 1. Medições

| Medida | Valor | Como |
|---|---|---|
| Conjunto de ferramentas | versão 11 | `TOOLSET_VERSION`, `crates/tutor-agent/src/tools/mod.rs` |
| Ferramentas numa conversa normal | 19 (21 antes da fase 1 de tokens) | `first_request_size_of_this_repository` |
| Primeiro pedido neste repositório | ≈ 7 369 tokens (sistema ≈ 4 677 + ferramentas ≈ 2 692); antes ≈ 17 492 | o mesmo teste — **estimativa por bytes ÷ 3,5**, não um tokenizador |
| Pedidos ao modelo por turno | até 60 | `agent.rs:70` |
| Testes do agente | 136 unitários no `tutor-agent` + 73 de integração (loop, streaming, ferramentas, fluxo, hunks, permissões, e2e guionado); 47 no `codev_agent.rs`; 23 ficheiros `codev.*` na UI | contagem de `#[test]`/vitest |
| Avaliação da qualidade do agente (tarefas reais, taxa de sucesso) | **nenhuma** | não há SWE-bench, Terminal-Bench nem conjunto próprio |
| Comandos IPC | 333 | `arch-check.sh` |
| Superfícies do IDE que o Co-Dev alcança como ferramenta | 3 de ~21 (código, git só leitura, LSP só diagnósticos/outline) + Studio e backlog em sessões próprias | secção 4 |

O que **não** se consegue medir hoje é o que mais conta: a taxa de tarefas resolvidas. Os três fornecedores já
não publicam SWE-bench Verified; usam Terminal-Bench 4.x, FrontierCode e o Coding Agent Index. O Google publicou
que o mesmo modelo (Gemini 4 Neon) faz 39,0 % no SWE-sweep dentro do harness do Antigravity e 12,8 % num harness
mínimo — **o harness vale tanto como o modelo**. Sem uma avaliação nossa, não sabemos onde estamos.

## 2. Quadro comparativo

✅ tem · ◐ parcial · ✗ não tem · ? não confirmado

| Capacidade | dxtutor Co-Dev | Claude Code/Desktop | Codex | Antigravity |
|---|---|---|---|---|
| Loop com ferramentas, planeamento aprovado, lista de tarefas | ✅ (`exit_plan`, `todo_write`) | ✅ | ◐ (plano ?) | ✅ |
| Sub-agentes em paralelo | ◐ só leitura, 4 papéis fixos, sem aninhar | ✅ + equipas de agentes | ✅ + agentes próprios em TOML | ✅ `/swarm`, workflows |
| Isolamento por worktree | ✅ (Multi Co-Dev fase 3) | ✅ | ✅ | ✅ |
| Agentes em segundo plano / cloud / agendados | ✗ | ✅ | ✅ | ✅ |
| Modo headless para CI | ✗ (o CLI/TUI não usam o loop) | ✅ `claude -p` | ✅ `codex exec` | ✅ `agy -p` |
| Instruções do projecto | ◐ só na raiz (AGENTS.md/CLAUDE.md), sem aninhados | ✅ aninhadas | ✅ AGENTS.md em camadas | ✅ |
| Memória entre sessões | ◐ `.dxtutor/memory/` sem ferramenta nem utilizador | ✅ | ✅ | ◐ |
| Skills / plugins / marketplace | ◐ skills só do projecto, nenhuma embutida | ✅ | ✅ | ✅ |
| MCP | ◐ stdio, só ferramentas | ✅ | ✅ | ✅ (+ MCP Apps) |
| Hooks que bloqueiam/alteram chamadas | ◐ 3 eventos; `pre_tool` corre depois da aprovação | ✅ | ✅ | ✅ |
| Compactação e rewind | ◐ compactação só no Claude; rewind ✅ (git) | ✅ | ◐ | ✅ |
| Modos de permissão + regras | ✅ Manual/Assistido/Auto, regras por comando, ficheiros protegidos | ✅ (6 modos, classificador) | ✅ (regras Starlark, revisor) | ✅ |
| **Sandbox do sistema com rede desligada por omissão** | **✗** | ✅ Seatbelt/bwrap + proxy | ✅ | ✅ |
| Segredos | ✅ redacção antes de cada pedido, scan antes de cada commit, keychain, Vault | ✅ (máscara no proxy) | ◐ | ◐ |
| Web search / fetch | ✗ | ? | ✅ | ✅ (`read_url`) |
| Browser / pré-visualização / capturas | ✗ | ✅ (Chrome) | ✅ | ✅ (Lighthouse, gravações) |
| Imagens na conversa | ✗ | ✅ | ✅ | ✅ |
| Inteligência de código para o agente | ◐ diagnósticos e outline | ✅ (plugins LSP) | ? | ? |
| Revisão de diffs | ✅ **no próprio editor, bloco a bloco** | ✅ | ✅ | ✅ (artefactos comentáveis) |
| Integração GitHub (PR, revisão, issues) | ◐ só para o humano (`gh` no deploy e revisão de PR) | ✅ | ✅ | ◐ |
| Backlog, sprints e método que o agente segue | ✅ (Project, DoR/DoD, `finish_issue`, `/backlog`, `/project`) | ✗ (só por MCP) | ◐ (Linear) | ◐ (plugins) |
| Regras do arquitecto + ADR que o agente respeita | ✅ | ✗ | ◐ (AGENTS.md) | ✗ |
| IaC, deploy, runbooks, incidentes, SLO no IDE | ✅ **mas só para o humano** | ✗ | ✗ | ✗ |
| Registo de auditoria (ISO 27001) | ✅ | ◐ | ◐ | ? |
| Avaliação publicada do harness | ✗ | ✅ | ✅ | ✅ |

**Leitura:** nas 20 primeiras linhas (as capacidades gerais de um agente de código, que os três já têm quase todas),
o Co-Dev tem 5 completas, 9 parciais e 6 em falta (segundo plano, headless, sandbox com rede, web, browser,
imagens). Em contrapartida, tem
o que nenhum dos três tem: **o processo de engenharia dentro do IDE** — Project com método e portas de qualidade,
regras do arquitecto, IaC com plano revisto, deploy guiado, runbooks, incidentes, SLO, auditoria. A lacuna mais
cara é que **o agente não alcança nada disso**: só o humano, pela UI.

## 3. As lacunas, por prioridade

**P0 — sem isto o Co-Dev não é seguro nem comparável**
1. **Sandbox do sistema** para `bash`, testes, hooks e MCP: escrita só na pasta do projecto, **rede desligada por
   omissão** com lista de domínios, máscara de segredos. Hoje há só o classificador de comandos e a verificação de
   caminhos; uma escrita do `bash` fora do âmbito só se detecta depois de correr.
2. **Avaliação própria do harness**: um conjunto de tarefas reais (Rust, TS, Python, IaC) corrido em modo headless,
   com taxa de sucesso, tokens e custo por tarefa — a medida de todas as fases seguintes.
3. **Workspace com projectos** (secção 5): sem ele, as skills, o quadro e as fronteiras não têm onde assentar.

**P1 — o que faz o dxtutor diferente**
4. **As ferramentas do IDE ao alcance do Co-Dev**, por skills (secção 4).
5. **Integração GitHub para o agente**: ramo, commit, PR, estado do CI, comentários de revisão (os comandos
   `git_*`/`gh_*` existem; falta a ferramenta).
6. **Inteligência de código**: definição, referências, rename, símbolos da pasta, problemas reais (`problems_scan`).

**P2 — paridade**
7. Web search/fetch (com a mesma lista de domínios da sandbox); browser e capturas para apps web; imagens.
8. Compactação e limpeza de resultados antigos fora do Claude; `/compact`; OpenAI pela Responses API com esforço.
9. Sub-agentes que escrevem (na sua worktree), papéis definidos pelo projecto, modelo mais barato.
10. MCP por HTTP/OAuth, recursos e prompts; hooks antes da aprovação, `session_start`, `prompt_submit`.
11. Modo headless (`dxt agent -p`) e agentes em segundo plano; corrigir o mid-turn (hoje as mensagens esperam).
12. Instruções e skills aninhadas por projecto; memória do utilizador; bloco de ambiente (data, ramo, SO).

## 4. Cada ferramenta do IDE como skill do Co-Dev

**«Painel de tasks»:** no código, o painel `Tasks` (Ctrl+Shift+T) é o do quadro antigo (`features/tasks.ts`, dados
do `tasks.sqlite3`), que a decisão Q3 funde no Project. Este plano lê o pedido como **todas as ferramentas do IDE**
(barra de actividades e separadores do Ops/Platform) — a confirmar (pergunta D1).

**Como entram** (proposta, pergunta D4): skills **embutidas** no binário (como os comandos `/backlog` e `/project`;
um `.dxtutor/skills/<nome>/SKILL.md` com o mesmo nome substitui-as) e **uma só ferramenta `ide`** com `action` e
argumentos, decidida no Rust acção a acção. Uma ferramenta por acção custaria ~60 definições em cada pedido e
mudaria o prefixo da cache; a `ide` única custa uma definição e as skills dizem que acções usar. Cada acção tem o
seu nível: **leitura** (corre), **proposta** (mostra ao humano, como o `arch_propose`), **acção** (diálogo de
aprovação partilhado + auditoria, como hoje na UI), **humana** (nunca o agente: segredos do Vault, rollout de
produção, aprovações).

| Skill | O Co-Dev passa a | Acções `ide` (comandos que já existem) | Nível |
|---|---|---|---|
| `workspace-projects` | ver os projectos do workspace e as fronteiras, escolher onde trabalha | `detect_projects` (hoje 1 nível) | leitura |
| `project-board` | ler o quadro, criar/mover/planear issues, iniciar sprint, plano paralelo | `project_load`, `project_issue`, `project_apply`, `project_sprint_plan` | leitura / acção (regras do Rust) |
| `source-control` | ramo, commit, merge, sync, PR, CI | `git_*`, `git_sync_plan`, `gh_prs`, `gh_runs_for` | leitura / acção |
| `testing` | descobrir, correr um teste, histórico | `list_tests`, `run_test`, `test_history` | leitura |
| `debugging` | breakpoints, lançar, passo, variáveis, pilha, reproduzir com rr | `debug_*` | acção |
| `code-intel` | definição, referências, rename, problemas | `lsp_*`, `problems_scan`, `codeintel` | leitura / proposta |
| `code-review` | correr os analisadores numa mudança | `review_code`, `verify_review_fix` | leitura |
| `dependencies` | dependências desactualizadas/vulneráveis, mapa de onboarding | `deps_report`, `onboard_map` | leitura |
| `architecture` | conformidade, ADR, desenho | `arch_conformance`, `arch_validate`, `adr_list` + `arch_propose` | leitura / proposta |
| `iac-pipeline` | correr o pipeline, ler plano, achados, drift, estado | `iac_pipeline_run`, `ops_iac_plan`, `iac_state` | leitura (o apply fica humano) |
| `kubernetes-ops` | estado do cluster, histórico de rollouts; propor scale/restart/undo | `ops_kube_state`, `ops_kube_history`, `ops_cloud_status` | leitura / acção |
| `runbooks` | escolher um runbook, correr os passos `check` | `runbook_list`, `runbook_parse`, `runbook_step` (check) | leitura (`action` fica humana) |
| `incidents` | abrir, juntar evidência, ver métricas, ordenar causas, postmortem | `incident_*`, `incident_metrics_check` | acção |
| `slo-metrics` | SLO e orçamento de erros | `metrics_status`, `sources_status` | leitura |
| `platform-queue` | a fila, verificar um item, rever um PR de infra | `queue_items`, `queue_verify`, `pr_infra_review` | leitura (submeter fica humano) |
| `guided-deploy` | planear um deploy e explicar o que bloqueia | `deploy_plan` | leitura (rollout fica humano) |
| `environments` | devcontainer, serviços do compose, ambientes | `devcontainer_*`, `compose_ps` | leitura / acção |
| `secrets-protect` | explicar um bloqueio do scan e corrigi-lo | `secret_scan` | leitura (Vault: nunca) |
| `under-the-hood` | código máquina por linha, traço de execução | `hood_*`, `trace_execution` | leitura |

## 5. Workspace com projectos

**Hoje:** «workspace» e «projecto» são a mesma coisa — a pasta aberta (`DXR.root`). O Project é uma linha por raiz
(`projects.root`), sem selector. A detecção de subprojectos existe em quatro sítios com regras diferentes
(`detect_projects` a 1 nível, `detectCommands` só na raiz, `deriveScopes`, `cargoTargets`); só o LSP trata pastas
aninhadas bem. O Co-Dev nunca recebe a lista de projectos: instruções, skills, `run_tests` e âmbito seguem a raiz.

**Proposta:**
- **Workspace** = a pasta aberta. Os **projectos** detectam-se por manifesto em qualquer profundidade (as regras do
  LSP, `rootMarkers`, numa só função no Rust) e o `.dxtutor/workspace.json` manda quando existe (nomes, inclusões,
  exclusões, projectos sem manifesto). Abrir uma pasta vazia cria o workspace com um projecto na raiz.
- **Project por projecto:** a chave do store passa a ser a pasta do projecto (o `root` já é uma string; nenhuma
  migração de esquema). O quadro tem um selector de projecto e uma vista «todos» do workspace. O Project actual de
  cada pasta passa a ser o do projecto da raiz (migração de dados, pergunta D3).
- **Co-Dev com fronteiras:** cada conversa pertence a um projecto (ou ao workspace, só de leitura fora dos
  projectos que o pedido nomeia). As instruções (AGENTS.md/CLAUDE.md), as skills, os comandos de teste/lint, as
  regras do arquitecto e o âmbito de escrita (`Origin.scope`) são os do projecto; uma escrita noutro projecto pede
  aprovação sempre. O system prompt leva a lista dos projectos (nome, pasta, linguagem, comandos).
- `/backlog` e `/project` passam a ser por projecto (`.dxtutor/backlog.json` na pasta do projecto).

## 6. Plano por fases

Uma fase por PR na `develop`; cada uma mede-se na avaliação da H0.

| Fase | O quê | Aceite quando |
|---|---|---|
| **H0** Medir | avaliação headless do harness (≥ 30 tarefas reais com teste de aceitação), tokens reais pela API de contagem | relatório por fase: % resolvidas, tokens, custo, tempo |
| **H1** Sandbox | bubblewrap no Linux para `bash`/testes/hooks/MCP: escrita só no projecto, rede desligada com lista de domínios, `~/.ssh`/`~/.kube`/credenciais escondidos; fora da sandbox só com aprovação | um teste que escreve fora ou abre a rede falha; os testes do projecto passam dentro |
| **H2** Workspace e projectos | detecção única, `workspace.json`, Project e quadro por projecto, Co-Dev com fronteiras, `/backlog` por projecto | um monorepo com 3 projectos: quadros separados; o Co-Dev não escreve no projecto ao lado sem aprovação |
| **H3** Skills e ferramenta `ide` | skills embutidas e acções de leitura: board, testing, code-intel, git/gh, dependências, arquitectura, SLO | o Co-Dev responde «o que bloqueia a sprint?» e «porque falha o teste X?» só com ferramentas |
| **H4** Platform/SRE/DevOps | IaC, Kubernetes, runbooks, incidentes, fila, deploy (leitura e propostas; acções com aprovação e auditoria) | um incidente do fixture: o Co-Dev abre, junta métricas, corre os `check` e propõe o postmortem |
| **H5** Paridade | web search/fetch e browser com capturas na sandbox; imagens; compactação para todos os fornecedores; sub-agentes que escrevem em worktree; MCP HTTP; hooks completos | itens da secção 3 (P2) com testes |
| **H6** Segundo plano e CI | `dxt agent -p`, agentes agendados, revisão de PR no GitHub com as regras do projecto | o CI do próprio dxtutor corre uma revisão do Co-Dev |

## 7. Decisões pedidas ao dono

- **D1 — «painel de tasks»:** são todas as ferramentas do IDE (como está no plano) ou o painel `Tasks` do quadro antigo?
- **D2 — o que define um projecto:** detecção por manifesto + `.dxtutor/workspace.json` a mandar (recomendado), só o ficheiro, ou só a detecção?
- **D3 — o Project que já existe** numa pasta: passa para o projecto da raiz (recomendado) ou começa-se do zero?
- **D4 — como o Co-Dev alcança as ferramentas:** uma só ferramenta `ide` com acções decididas no Rust (recomendado: barata em tokens e estável na cache) ou uma ferramenta por acção?
- **D5 — sandbox:** rede desligada por omissão com lista de domínios por projecto (recomendado), mesmo que isso faça falhar `npm install`/`cargo build` até se permitir o registo?
- **D6 — ordem:** H0 → H1 → H2 → H3 → H4 → H5 → H6 (recomendado), ou o workspace (H2) e as skills (H3) primeiro?

## Fontes externas (lidas a 2026-11-27)

- Claude Code: changelog <https://code.claude.com/docs/en/changelog>, visão geral <https://code.claude.com/docs/en/overview>, permissões <https://code.claude.com/docs/en/permission-modes.md>, sandbox <https://code.claude.com/docs/en/sandboxing.md>.
- Codex: changelog <https://learn.chatgpt.com/docs/changelog>, documentação <https://learn.chatgpt.com/docs/llms-full.txt>, app <https://openai.com/index/introducing-the-codex-app/>, integrações GitHub/Linear em <https://developers.openai.com/codex/>.
- Antigravity: changelog <https://antigravity.google/changelog.md>, 2.0 <https://antigravity.google/blog/introducing-google-antigravity-2>, funcionalidades <https://antigravity.google/docs/features.md>, permissões <https://antigravity.google/docs/permissions.md>.
- Benchmarks: Opus 5.5 <https://anthropic.com/news/claude-opus-5-5>; Gemini 4 Neon <https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-gemini-4-neon/>; GPT-6.2 Sol <https://www.vals.ai/models/openai_gpt-6.2-sol>. As versões dos benchmarks diferem entre fornecedores: os números são indicativos.
