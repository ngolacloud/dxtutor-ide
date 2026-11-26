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
- Um commit feito à mão no teu terminal não passa pelo scan (não instalo hooks de git no teu repositório).
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

## A seguir

F4c — Vault (login OIDC e token colado, ambos no keychain do SO e nunca devolvidos à UI; metadados KV, revelar só
em `local`, credenciais dinâmicas), o deploy guiado, e as chaves de API dos modelos a passar do `keys.json` para o
keychain.
