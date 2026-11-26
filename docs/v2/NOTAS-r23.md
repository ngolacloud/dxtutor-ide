# Notas das fases r23

Notas de fecho de cada fase da r23, em português: o que mudou, como foi verificado, que decisões ficam para rever e
que limitações ficam. O registo técnico (em inglês, com os ficheiros) está em `docs/v2/AUDIT-r23.md`.

## F4a — protecção de dados (no `develop` em `52bd720`)

**O que mudou**
- **Redacção antes de qualquer pedido a um modelo:** o agente do Co-Dev, o chat, o tutor e o `llm.rs` passam todos
  pelo filtro. O filtro conhece os padrões de segredos e os valores dos `.env` da pasta aberta. A barra de estado
  mostra quantos segredos já saíram dos pedidos, e cada pedido que perdeu algum fica no registo de auditoria.
- **Secret scan no backend antes de cada commit da app:** o pane, o Ctrl+Enter, o quadro, o amend, o merge, o
  Composer, as lanes, as regras de arquitectura e o bash do agente. Usa o gitleaks se estiver instalado; sem ele,
  aplica as regras próprias e recusa ficheiros como `.env`, `.tfstate` e chaves. No diálogo de aprovação os achados
  aparecem mascarados; para avançar é preciso um motivo, e esse motivo fica auditado.
- **Máscara de segredos** na saída do terminal e do depurador.
- **Achados `.tf` no Problems e no editor**, ao gravar.

**Verificação:** auto-teste desktop com 63 passos sem falhas (`password = var.x` dá erro na linha 7; o commit com
`postgres://u:p@h` é bloqueado e passa uma vez com motivo; o terminal mostra `postgres://app:••••@db/app`); os
critérios de aceitação também como testes unitários; 1113 testes da UI, `arch:check` e 31 e2e.

**Decisões para rever:** o crate novo `tutor-protect`; a redacção saiu do `tutor-agent`, que a reexporta pelo mesmo
caminho; o `tutor-eval` passou a depender do `regex`.

**Limitações:**
- Um commit feito à mão no teu terminal não passa pelo scan (não instalo hooks de git no teu repositório). Desde o
  endurecimento: passa, se instalares o hook de pre-commit pela paleta (ver a secção 3, mais abaixo).
- O terminal mascara pedaço a pedaço: um segredo partido entre duas leituras pode passar.
- O cabeçalho «Executing task» das tarefas mostra o comando tal como foi escrito, porque vem da própria UI.

## F4b — pipeline de IaC, plano revisto, drift e estado (no `develop` em `dce9710`)

**O que mudou** — a secção IaC do Ops tem cinco separadores:
- **Pipeline:** init, fmt, validate, regras internas, tflint, checkov, trivy, segredos guardados no estado, plan,
  drift, conftest e infracost, à medida que correm. Uma ferramenta em falta aparece como «not installed» com o
  comando para a instalar, nunca a verde. Uma etapa que falha bloqueia o apply, e a regra está no Rust.
- **Apply:** aplica o ficheiro do plano que leste, não um plano novo. O backend guarda o plano com o hash do ficheiro
  e da configuração e recusa-o se a corrida bloqueou, se o ficheiro é outro, se os `.tf` mudaram depois ou se tem
  mais de um dia. Depois de aprovado, corre num terminal e o código de saída vai para o registo de auditoria. Saiu o
  comando antigo, que fazia `plan -out=tfplan && apply tfplan` e voltava a planear.
- **Plano:** por recurso, o módulo, o motivo e os atributos de um replace, o raio de impacto, os argumentos
  write-only e o custo (quando o infracost existir).
- **Segurança e política:** os achados de todas as etapas. «Aceitar o risco» pede motivo, dura 30 dias, fica na
  base do Project (migração 10) e passa primeiro pelo registo de auditoria, no Rust. «Corrigir no editor» pede a
  correcção ao Co-Dev.
- **Drift:** verificado de 6 em 6 horas com a pasta aberta, e à mão. Reverter corre um pipeline só para esse
  recurso; «escrever no código» vai para o Co-Dev; ignorar pede motivo e dura 30 dias. «Quem mudou» diz «not
  connected» (precisa de uma fonte de auditoria da cloud).
- **Estado:** só endereços e ids, o backend, o serial, o bloqueio e a cópia anterior. O desbloqueio forçado pede
  aprovação e o nome da pasta escrito; `moved` e `import` são rascunhos que o Co-Dev escreve nos `.tf`. O editor
  nunca abre, lê nem grava um `.tfstate`.
- 6 comandos novos: de 262 para 268.

**Verificação:**
- Auto-teste desktop: 64 passos, zero erros. No passo `iac`, com o `tofu` real: os scanners em falta dizem «not
  installed» com a dica; o apply do ficheiro revisto corre num terminal e sai com 0; o estado mostra os dois recursos
  com ids; um segredo no código bloqueia o apply no Rust e, aceite o risco, a corrida seguinte passa e a aceitação
  aparece no registo de auditoria; o `.tfstate` é recusado.
- Testes Rust do `tutor-eval`, `tutor-board`, `tutor-protect` e `dxtutor-ide`, incluindo um pipeline real com o
  `tofu`; `fmt` limpo.
- UI: 1120 testes, 31 e2e, `arch:check` e métricas; nenhum aviso de lint novo. A primeira passagem teve timeouts de
  15 s por carga da máquina (~24, outras sessões); voltou a correr e passou toda.

**Decisões para rever:**
- O e2e `ops.e2e.ts` foi reescrito: fixava o apply que voltava a planear, o defeito que o brief manda corrigir.
  Agora prova o pipeline bloqueado, a aceitação do risco com motivo, o pipeline verde e o apply do ficheiro revisto.
- O formato e o drift também bloqueiam o apply: um ficheiro por formatar falha o `fmt`; um drift por resolver
  bloqueia até ser revertido, escrito no código ou ignorado com motivo.

**Limitações:**
- Só o `tofu` está instalado: tflint, checkov, trivy, conftest e infracost só foram testados como «not installed» na
  app real e pelos seus JSON nos testes unitários.
- O ficheiro do plano contém os valores, segredos incluídos (o `tofu` grava-os assim): fica com 0600 na pasta de
  dados da app e é apagado ao fim de um dia.
- O raio de impacto pára num módulo como um todo; não segue as variáveis lá dentro.
- Terragrunt, Helm e o separador «Golden paths» ficam fora da F4b.

## F4c1 — keychain e Vault

**O que mudou**
- **Crate novo `tutor-platform`** (sem Tauri): o keychain do sistema (crate `keyring`, Secret Service por D-Bus) e o
  cliente do Vault pela API HTTP.
- **Entrar no Vault** pelo browser (OIDC: o browser volta a `127.0.0.1:8250`, como o CLI do Vault) ou colando um token.
  Os dois vão para o keychain e nunca voltam à UI. Renovar e sair (o Vault revoga o token e ele sai do keychain).
- **Segredos KV:** metadados de todos os ambientes (versões, datas, metadados); os nomes das chaves e os valores só
  de `local`. O ambiente vem do caminho (`…/local/…`, `…/staging/…`, `…/production/…`); um caminho que não o diz
  conta como não-local. A recusa está no Rust.
- **Mostrar um valor local** pede aprovação com motivo, fica no registo de auditoria (no Rust, antes de ler) e só se
  lê durante 20 segundos; o valor passa a ser filtrado dos pedidos aos modelos e do terminal.
- **Mudar um valor** é no terminal: `vault kv patch … chave=-` lê-o do stdin, por isso o IDE nunca o vê. O terminal
  recebe o token do Rust (`VAULT_TOKEN`) e mascara-o na saída. Aprovado e auditado, com o código de saída.
- **Credenciais dinâmicas:** a UI só recebe o lease (id, TTL, nomes dos campos); um terminal aberto com ele recebe os
  valores como `VAULT_DYN_*`, e o lease é revogado quando esse terminal acaba (ou à mão).
- **Chaves de API dos modelos no keychain:** uma chave que ainda esteja no `keys.json` passa para o keychain na
  primeira leitura e sai do ficheiro. Sem keychain, fica no `keys.json` como antes.
- O separador «Vault» (paleta: «Vault: …») e o estado do token na barra de estado (`#st-vault`).
- 10 comandos novos: de 268 para 278.

**Verificação**
- `cargo test -p tutor-platform`: o keychain real desta sessão (com um serviço só do teste) e um Vault 2.2.2 real em
  modo dev (token, metadados, recusa de staging e produção, mostrar local durante 20 s, renovar, sair); OIDC e
  credenciais dinâmicas contra um Vault falso.
- O passo `vault` do auto-teste, contra um Vault dev que o runner arranca, com um serviço de keychain próprio (o HOME
  temporário não isola o keychain da sessão).

**Decisões para rever**
- A F4c foi partida em duas: F4c1 (isto) e F4c2 (deploy guiado, registos de deploy, `dx-secret-check`).
- O ambiente de um segredo vem de um segmento do caminho; sem segmento, os valores não se mostram.

**Limitações**
- O OIDC e as credenciais dinâmicas só foram testados contra um Vault falso: aqui não há fornecedor de identidade nem
  motor de base de dados no Vault dev.
- O antigo `~/.config/dxtutor/providers.json` (UI pré-v7) continua com chaves em texto e só é lido, não movido.

## F4c2 — deploy guiado

**Decisões tuas (início da F4c2):** os segredos de staging e produção vêm só do Vault; o segundo aprovador da produção é
um PR fundido e aprovado por outra pessoa no GitHub; uma verificação falhada bloqueia sempre, e em produção «não
instalado»/«não ligado» também bloqueiam, salvo excepção com motivo. O segundo aprovador e a saúde de staging nunca
admitem excepção (o auto-teste apanhou a primeira versão a deixar fazê-lo quando o `gh` não estava ligado).

**O que mudou**
- **O assistente de deploy** (paleta «Deploy: …», e o «Promote»/«Redeploy» do Infra abrem-no), em oito passos: destino,
  identidade, segredos, verificações, estratégia, aprovar, rollout e registo.
- **Verificações:** versão (HEAD sem alterações por commitar), SBOM, assinatura (cosign), vulnerabilidades, segredos,
  `dx-secret-check` («não disponível» até a imagem existir), drift do IaC do ambiente, política de admissão do cluster
  (dry-run no servidor), orçamento de SLO, janela de mudança, migrações e, em produção, a saúde e a versão de staging e o
  segundo aprovador. Uma ferramenta em falta aparece «não instalado» com a dica, nunca a verde.
- **Segredos:** o deploy não aplica os `Secret` dos manifestos — o cluster lê-os do Vault. A verificação vê só nomes no
  namespace e metadados no Vault. O ecrã Environments deixou de aceitar valores de staging e produção (diz «Vault»).
- **O bloqueio está no Rust** e é verificado outra vez no rollout (excepções com motivo, HEAD, manifestos, plano com
  menos de 30 minutos). Produção: motivo e «production» escrito, também verificados no Rust.
- **Rollout** rolling: namespace, `kubectl apply` sem os Secrets, anotação da versão, `rollout status`, com as linhas à
  vista. Auditado antes e com o resultado, e registado na base do Project.
- **Ciclo de vida do commit:** a coluna «environments» mostra os deploys de cada ambiente (antes, «não ligado»).
- 3 comandos novos: de 278 para 281.

**Verificação**
- `cargo test -p tutor-platform`: um staging e uma produção completos com `kubectl` e `gh` falsos sobre um repositório
  git real (o que é aplicado não leva o Secret nem o valor; a produção só passa com todas as excepções com motivo); a
  árvore suja, o HEAD movido e a política de admissão a recusar bloqueiam.
- O passo `deploy` do auto-teste, na app real, contra um kubeconfig temporário vazio: plano, produção recusada sem
  «production» escrito, rollout de staging que falha no cluster inexistente, registado e auditado.

**Limitações**
- Não houve deploy num cluster real aqui.
- Canary e blue-green, e credenciais dinâmicas durante o rollout (usa a identidade do kubeconfig), ficam para depois.
- O antigo histórico de promoções do Infra (`ENVX.hist`) já não é escrito; o ecrã Environments mostra os registos de
  deploy.

## F5a — runbooks, fontes de dados e evidências

**Decisões tuas (início da F5):** incidentes são registos locais (on-call e alertas «não ligados» até haver fonte);
catálogo/scorecards, GitOps, custo e inventário ficam para depois; a F5 em duas partes.

**O que mudou**
- **Runbooks como código** em `runbooks/*.md`, na secção Runbooks do Ops: passos `[check|action|decision]` com o comando
  e o esperado. Editar o ficheiro muda os passos.
- **A regra, no Rust:** uma verificação só corre se cada comando for só de leitura (o classificador do agente mais os
  verbos de leitura de kubectl, aws, tofu, gh, vault…; nada que escreva ficheiros nem que leia segredos) — senão é
  recusada com `not_read_only`. Uma acção pede aprovação com o comando e um motivo, fica no registo antes de correr, e
  recebe as credenciais do Vault só para esse passo. Uma decisão regista as tuas palavras.
- **Cada passo fica guardado** (saída mascarada, código, resultado contra o esperado, quem e quando). Uma expectativa em
  prosa julga-a a pessoa. «✦ Perguntar ao Co-Dev» comenta a saída e sugere o passo seguinte, sem correr nada.
- **Fontes de dados:** CI/CD pelo `gh` (só leitura); custo, métricas/logs e inventário dizem «não ligada» e como ligar.
- **Evidências ISO 27001:** o botão «Export evidence» escreve `docs/audit/evidence-AAAA-MM.md` dentro do projecto, a
  partir das linhas reais do registo de auditoria, dos deploys e das execuções de runbooks, por controlo, e abre-o.
- 8 comandos novos: de 281 para 289.

**Limitações**
- O classificador do agente chama «perigoso» a `kubectl get deploy` (vê a palavra «deploy»); a política dos runbooks
  decide comando a comando e não mexe no classificador do Co-Dev.
- Não há ligadores para custo, métricas/logs e inventário: ficam «não ligados».

## F5b — a fila, a revisão de PR de infra e os incidentes

**O que mudou** — uma vista nova, «Platform» (paleta «Platform: …»), com três separadores:
- **A minha fila:** só o que é teu, calculado do estado real — PRs que pedem a tua revisão (com a regra do CODEOWNERS),
  achados de IaC bloqueantes em `.tf` que mudaste, runbooks recorrentes em atraso, incidentes que comandas, o teu último
  deploy falhado. Cada item diz porque é teu e tem uma acção. «Verificar» só o marca feito quando o estado o prova, e
  guarda a prova; «Passar» pede a quem e porquê, e aparece na vista da equipa. «Medido neste workspace» são só contagens
  locais; o on-call diz «não ligado».
- **Revisão de PR de infra:** o diff e «Antes do merge» — o CI do PR, o plano, a política e o custo (o pipeline de IaC
  corre sobre a cabeça do PR numa worktree temporária), a janela de mudança, o rollback (migrações), incidentes
  semelhantes; capacidade, orçamento de erro e on-call «não ligados». Cada verificação diz de onde vem. Publicar a revisão
  mostra o comando `gh` exacto; aprovar com uma verificação a falhar pede um motivo (no Rust), que vai para o PR.
- **Incidentes locais** (decisão tua): abrir, evidência, verificações feitas e não feitas (com porquê), mitigar, resolver
  com um resumo, «a causa principal estava certa?» (mede a precisão do Co-Dev). A confiança nunca passa de «baixa» sem
  uma fonte de métricas. O Co-Dev ordena as causas prováveis e escreve o rascunho do postmortem (propostas).
- 11 comandos novos: de 289 para 300.

**Limitações**
- Os comentários do Co-Dev a um PR vêm no chat, não ancorados às linhas do diff.
- O drift «onde estás de on-call» não entra na fila (não há fonte de on-call).
- A revisão de PR foi testada com um `gh` falso e, na app real, sem sessão no `gh` (diz porquê); nenhum PR real foi
  revisto aqui.

## O que ficou adiado e porquê (revisão de 2026-11-26)

A r23 (F1–F6) está toda no `develop`. Esta revisão junta o que ficou de fora em cada fase, arrumado pelo **motivo** —
porque o motivo diz o que o desbloqueia. Nada disto foi esquecido: cada item está registado na fase em que surgiu
(`docs/v2/AUDIT-r23.md`).

### 1. Falta uma fonte de dados real (não há de onde ler, e a regra é nunca inventar números)

| Item | Fase | Porquê | O que desbloqueia |
|---|---|---|---|
| On-call, alertas e o drift «onde estás de on-call» na fila | F5b | Não há fonte de pager (PagerDuty, Opsgenie, Grafana OnCall); tu decidiste incidentes locais (Q9) | Escolher e ligar uma fonte de pager |
| Capacidade, orçamento de erro (SLO) na revisão de PR e no deploy; confiança dos incidentes acima de «baixa» | F4c2, F5b | Não há fonte de métricas | Ligar Prometheus/Loki (ou a da cloud), só de leitura, com credenciais do Vault |
| Custo da cloud e inventário (e a cobertura de IaC / «codify») | F5a | Não há ligadores; credenciais de leitura teriam de vir do Vault | Um ligador por fornecedor (AWS Cost Explorer, inventário com `aws/creds/…-readonly`) |
| Quem mudou um recurso com drift | F4b | Precisa do registo de auditoria da cloud | Ligar o CloudTrail (ou equivalente) |
| `dx-secret-check` (validar os segredos montados dentro do cluster) | F4c2 | A imagem do Job ainda não existe | Construir e publicar a imagem; o passo já está previsto e diz «não disponível» |
| Catálogo/scorecards e GitOps (Argo CD) | F5 | Não têm ID UI-PLAT, precisam do `argocd` e de um catálogo de serviços; tu decidiste adiar (Q10) | Uma decisão tua sobre o catálogo e o `argocd` instalado |

### 2. Decisão tua (adiado de propósito)

| Item | Fase | Porquê |
|---|---|---|
| Ecrãs de catálogo, GitOps, custo e inventário | F5 | Q10: fora dos UI-PLAT-09…14 e sem fontes |
| «New Project from a Template» nas boas-vindas | F6 | Q11: não há templates reais (o `delonix new` não existe) |
| Lanes do git ligadas por omissão | F3b | Q6: experimentais, desligadas até provarem que não confundem a árvore de trabalho |
| Incidentes sem fonte externa | F5b | Q9: registos locais abertos por uma pessoa |

### 3. Limite técnico medido (a ferramenta não o permite hoje)

| Item | Fase | Porquê | Caminho possível |
|---|---|---|---|
| Andar para trás com botões (`stepBack`/`reverseContinue` do DAP) | F2b | O gdb 15 em modo DAP não os tem; andar para trás é pela consola do rr | Uma versão do gdb que os implemente, ou um adaptador próprio sobre o gdb/MI |
| «Restart frame» com o lldb-dap | F2a | O lldb-dap não anuncia `supportsRestartFrame` | Fica disponível no modo rr (gdb) |
| codelldb | F2a | O `dapc` não o consegue conduzir (Q15b) | Só se houver motivo para trocar de adaptador |
| Um segredo partido entre duas leituras do terminal pode passar | F4a | O eco interactivo não pode esperar pela linha inteira | **Feito para as tarefas** (`feat/r23-hardening`): retêm o possível início de um segredo até à leitura seguinte. Numa shell interactiva continua a poder passar |
| Um commit feito à mão no teu próprio terminal não passa pelo secret scan | F4a | Não se instalam hooks de git no repositório sem o dono pedir | **Feito** (`feat/r23-hardening`): «Protect: Install the Pre-commit Hook…» instala, com aprovação e auditado, um hook que corre `dxt secret-scan --staged` (as mesmas regras). Precisa do `dxt` no PATH (`cargo install --path crates/tutor-cli`); sem ele, bloqueia e diz porquê. Um hook alheio nunca é substituído; `--no-verify` salta-o |
| O ficheiro do plano guarda os valores (segredos incluídos) | F4b | É assim que o tofu/terraform gravam o plano | Já mitigado: 0600, pasta de dados da app, apagado ao fim de um dia |
| O raio de impacto pára num módulo | F4b | Seguir as variáveis dentro de um módulo exige avaliar as expressões | Avaliar `module_calls` com os valores do plano |
| O undo do git não cobre ficheiros não seguidos | F3a | O `git stash create` só cobre ficheiros seguidos | Guardar também os não seguidos (com cuidado com o tamanho) |
| O classificador do agente chama «perigoso» a `kubectl get deploy` | F5a | Vê a palavra «deploy»; o Co-Dev está fora do âmbito | Corrigir no classificador do Co-Dev numa sessão própria (os runbooks já decidem comando a comando) |

### 4. Mais trabalho, sem bloqueio externo (candidatos a uma próxima fase)

| Item | Fase | Notas |
|---|---|---|
| As chaves antigas em `~/.config/dxtutor/providers.json` continuam em texto | F4c1 | **Feito** (`feat/r23-hardening`): passam para o keychain na primeira leitura (o ficheiro é do assistente e do TUI, não só da UI antiga) |
| Canary e blue-green no deploy | F4c2 | O rollout é rolling; o plano já tem o passo «Estratégia» |
| Credenciais dinâmicas do Vault durante o rollout | F4c2 | O rollout usa a identidade do kubeconfig |
| Terragrunt e Helm no pipeline de IaC | F4b | O pipeline cobre tofu/terraform |
| Separador «Golden paths» | F4b | Precisa de definir o que é um golden path no projecto |
| Comentários do Co-Dev ancorados às linhas do diff de um PR | F5b | Hoje vêm no chat; exige um tipo de contexto novo no Co-Dev (fora do âmbito, Q3) |
| Depurador: watches fixos no código, «condition insights», Parallel Stacks, vistas de deque, layout de memória, heap | F2a/F2b | Listados no brief; nenhum bloqueio |
| Depurador: valores previstos e linhas esbatidas, cadeia de causas automática, «reconstruir e reproduzir até ao passo n» | F2b | Precisam de mais trabalho sobre o rr; o cartão oferece «última escrita a…» |
| O histórico antigo de promoções do Infra (`ENVX.hist`) | F4c2 | Já não é escrito; o ecrã mostra os registos de deploy — pode sair |

### 5. Feito, mas só testado com falsos (falta prová-lo num ambiente real)

| Item | Fase | O que falta |
|---|---|---|
| OIDC do Vault | F4c1 | Um fornecedor de identidade real |
| Credenciais dinâmicas | F4c1 | Um motor de base de dados no Vault |
| Deploy para um cluster real | F4c2 | **Provado** num kind local (ver «Ferramentas reais», abaixo). Falta um cluster de staging partilhado |
| Revisão de um PR real | F5b | `gh` com sessão e um PR de infra |
| tflint, checkov, trivy, conftest, infracost, gitleaks | F4a/F4b | **Instalados e provados** (ver «Ferramentas reais», abaixo). O infracost precisa de uma chave (`infracost auth login`) |

### Recomendação de ordem

1. ~~**Segurança, pequeno:** mover as chaves do `providers.json` para o keychain; o hook `pre-commit` opcional (com o teu
   OK); a retenção do `Masker` nas tarefas do terminal.~~ **Feito** em `feat/r23-hardening`.
2. ~~**Provar o que só foi testado com falsos:** instalar tflint/checkov/trivy/conftest/infracost/gitleaks, e fazer um
   deploy num cluster de staging (kind serve) — sem código novo, só verificação.~~ **Feito**; a prova encontrou dois
   defeitos, corrigidos (ver «Ferramentas reais»).
3. **Uma fonte de métricas** (Prometheus): desbloqueia de uma vez o SLO, a capacidade e a confiança dos incidentes.
4. **Funcionalidades sem bloqueio:** canary, credenciais dinâmicas no rollout, Terragrunt/Helm.
5. O resto (catálogo, GitOps, custo, inventário, pager) espera pelas tuas decisões sobre as fontes.

## Ferramentas reais (ponto 2, 2026-11-26)

Instaladas em `~/.local/bin` a partir das releases oficiais, com o SHA-256 verificado contra o ficheiro de checksums de
cada release, e só versões com pelo menos duas semanas: tflint 0.66.0, trivy 0.76.2, conftest 0.71.1, gitleaks 8.30.1,
infracost 0.10.49 (diz `v0.10.48`; a linha 0.10 é a antiga, o projecto passou para `infracost/cli` 2.x), kind 0.33.0 e
checkov 3.4.4 (num venv próprio, `~/.local/share/checkov-venv`).

**Pipeline de IaC** (sonda com um `.tf` AWS com problemas conhecidos e uma política Rego): os quatro scanners correm e os
parsers lêem a saída real — tflint (`terraform_required_version`), checkov (14 achados, p. ex. `CKV_AWS_24` SSH aberto),
trivy (8 erros + 3 avisos, p. ex. `AWS-0086`), conftest (a regra `deny` da política); as regras próprias apanham as
credenciais literais do provider; o plano (+3) e o drift correm com o provider AWS real, sem credenciais; o apply fica
bloqueado por `rules`, `checkov`, `trivy` e `conftest`. O infracost sem chave fica «not connected».

**Deploy** num cluster kind (`dxtutor-staging`, Kubernetes 1.37, kubeconfig próprio — o `~/.kube/config` não foi tocado):
o syft e o trivy correm sobre a imagem real; sem o Secret no namespace, o deploy é bloqueado por `secrets`; com ele, o
rollout aplica os manifestos SEM o Secret (o do cluster fica intacto), anota a versão e espera pelas réplicas (2/2).

**Defeitos encontrados e corrigidos** (`feat/r23-hardening`):
- Com o gitleaks instalado, o secret scan usava SÓ o gitleaks, que não tem regra para `postgres://u:p@h`: instalar a
  ferramenta piorava a detecção. Agora as regras próprias correm sempre e o gitleaks junta as dele (`gitleaks + built-in`;
  uma linha apontada pelos dois aparece uma vez). Teste: `scan::tests::gitleaks_adds_to_our_rules`.
- O rollout anotava a versão com `annotate deploy --all`: num namespace partilhado, os Deployments de outras aplicações
  ficavam com a versão deste deploy (medido no kind). Agora só os Deployments dos manifestos — também no deploy do pane
  Infra e na promoção de ambientes (`platform/desktop/infra.ts`).
- A dica do infracost sem chave dizia para o instalar; agora diz para fazer `infracost auth login`.
- No auto-teste (HOME temporário, sem chave) o infracost 2.21 abriu um login no browser do utilizador e ficou à espera
  até ser morto (o `breakdown` passou a correr o `scan`, que pede login). Agora, sem credenciais, a etapa é «not
  connected» sem correr o infracost; com elas, corre sem stdin nem ecrã, é parado num pedido de login e tem um prazo.
  Testes: `iac::tests::infracost_*` (com um infracost falso pela fábrica de comandos).
- O protect do auto-teste deixou passar o commit com `postgres://u:p@h` (`blockedCode: 0`): o binário era de um ramo
  sem a correcção acima (o gitleaks a substituir as regras próprias). Teste de regressão sem depender do gitleaks
  instalado: `scan::tests::the_self_test_commit_is_blocked_with_or_without_gitleaks` (gitleaks falso pela fábrica). O
  relatório do gitleaks passou a ser um ficheiro por corrida (dois scans ao mesmo tempo partilhavam um nome por processo).

## A seguir

A r23 está completa. O que vem a seguir depende das tuas escolhas na secção anterior.
