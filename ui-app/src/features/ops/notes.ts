/* Notas para a documentação oficial do separador Ops (IaC, Kubernetes, cloud, runbooks, evidências) e da actividade
   Platform (a fila, a revisão de PR de infra, os incidentes) — r23 F4b, F5a, F5b. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const OPS_NOTES: FeatureNotes = {
  id: "ops",
  title: "Ops — infraestrutura, Kubernetes, runbooks e evidências",
  summary:
    "O separador Ops lê as ferramentas reais do projecto: o pipeline de infraestrutura como código (plano revisto, achados, drift, estado), o Kubernetes para onde o pane Infra aponta, as CLIs de cloud, os runbooks do repositório e as fontes de dados. É só de leitura por omissão: tudo o que muda alguma coisa é um comando mostrado por inteiro, aprovado por ti, e fica no registo de auditoria.",
  code: [
    "crates/tutor-eval/src/iac.rs", "crates/tutor-eval/src/ops.rs", "crates/tutor-platform/src/runbook.rs", "crates/tutor-platform/src/policy.rs",
    "crates/tutor-platform/src/sources.rs", "crates/tutor-board/src/project/evidence.rs", "ui-app/src/features/ops/",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Abrir o Ops",
      where: ["paleta: «Ops: IaC Plan, Kubernetes and Cloud»", "pane Infra › «Ops — IaC · Kubernetes · Cloud»"],
      what: "Abre o separador Ops com as secções Infraestrutura como código, Kubernetes, Cloud, Runbooks e Fontes de dados.",
      howTo: ["Abre uma pasta na app desktop.", "Abre o Ops pela paleta ou pelo botão no topo do pane Infra."],
      flow: ["O separador lê as pastas com `.tf`, o cluster do pane Infra, o estado das CLIs de cloud, os runbooks e as fontes, cada um pelo seu comando do backend."],
      limits: ["Só na app desktop, com uma pasta aberta: no browser não há ferramentas reais para ler."],
      covers: ["ops-open", "cmd:Ops: IaC Plan, Kubernetes and Cloud"],
    },
    {
      title: "Pipeline de IaC",
      where: ["Ops › Infraestrutura como código › Pipeline"],
      what: "Corre init, fmt, validate, as regras internas, tflint, checkov, trivy, os segredos guardados no estado, o plano, o drift, conftest e infracost sobre a pasta escolhida. Cada etapa diz ok, falhou, não instalado (com como instalar), não ligado ou saltado — uma ferramenta em falta nunca aparece a verde.",
      howTo: ["Escolhe a pasta de IaC na lista.", "Carrega em «Run the pipeline» e vê as etapas a chegar.", "Clica numa etapa para ver o comando, a dica e a saída."],
      flow: [
        "O backend (`iac_pipeline_run`) corre as ferramentas no ambiente da shell de login e emite `iac://stage` ao começar e acabar cada etapa.",
        "O plano fica guardado na pasta de dados da app com o hash do ficheiro e da configuração (0600, apagado ao fim de um dia).",
        "Uma etapa falhada bloqueia o apply — no Rust, não na interface.",
      ],
      tips: ["Um ficheiro por formatar falha o `fmt`: corre `tofu fmt -recursive` na pasta.", "As ferramentas em falta não bloqueiam o pipeline; instala-as para teres as verificações."],
      limits: ["Terragrunt e Helm ainda não entram no pipeline.", "Cada corrida faz `init`, que pode descarregar providers."],
      covers: ["ops-dir", "ops-tab", "ops-run", "ops-res"],
    },
    {
      title: "Aplicar o plano revisto",
      where: ["Ops › Pipeline › «Apply in a terminal…»"],
      what: "Aplica o ficheiro do plano que leste — nunca um plano novo. O backend recusa se a corrida bloqueou, se o ficheiro não é o revisto, se os `.tf` mudaram depois ou se o plano tem mais de um dia.",
      howTo: ["Corre o pipeline até ficar «All stages passed».", "Carrega em «Apply in a terminal…», lê o comando e aprova (um apply que destrói pede o nome da pasta escrito)."],
      flow: ["`iac_apply_command` verifica as regras e devolve `… apply -input=false <ficheiro revisto>`.", "A aprovação vai ao registo de auditoria, o comando corre num terminal e o código de saída também fica registado."],
      covers: ["ops-apply"],
    },
    {
      title: "Plano: o que muda, o raio de impacto e o custo",
      where: ["Ops › Infraestrutura como código › Plano"],
      what: "Mostra cada recurso a criar, mudar, substituir ou destruir, com o módulo, o motivo de uma substituição, os atributos que a forçam, o que depende dele (raio de impacto), os argumentos write-only e o custo mensal (com o infracost).",
      howTo: ["Corre o pipeline e abre o separador Plano.", "Clica num recurso para ver os atributos antes e depois.", "«✦ Explain this plan» pede ao Co-Dev que o explique; «✦ Propose a change» pede a alteração aos `.tf` como proposta."],
      flow: ["O plano é lido do `show -json`; os valores sensíveis aparecem como «(sensitive)» e nunca saem do backend.", "O raio de impacto vem das referências do `configuration`."],
      limits: ["O raio de impacto pára num módulo como um todo: não segue as variáveis lá dentro."],
      covers: ["ops-ask-plan", "ops-ask-iac"],
    },
    {
      title: "Segurança e política: achados e riscos aceites",
      where: ["Ops › Infraestrutura como código › Segurança e política"],
      what: "Lista os achados de todas as etapas (regras internas, tflint, checkov, trivy, conftest, segredos no estado). Um erro bloqueia o apply até ser corrigido ou aceite com um motivo, por 30 dias.",
      howTo: ["Clica no sítio `ficheiro:linha` para abrir o código.", "«Accept the risk…» pede um motivo; «Revoke» volta a bloquear.", "«✦ Fix in the editor» pede a correcção ao Co-Dev."],
      flow: ["Cada achado tem uma chave estável (fonte, regra, ficheiro e o texto da linha ou o recurso): mover a linha não perde a aceitação.", "A aceitação vai primeiro ao registo de auditoria, no backend; sem auditoria não fica guardada."],
      tips: ["Depois de aceitar ou revogar, corre o pipeline outra vez para o apply o ver."],
      covers: ["ops-accept", "ops-revoke", "ops-fix", "ops-open-finding"],
    },
    {
      title: "Drift",
      where: ["Ops › Infraestrutura como código › Drift"],
      what: "Mostra o que mudou fora do código (um plano só de refresh), verificado à mão e de 6 em 6 horas enquanto a pasta está aberta.",
      howTo: ["«Check drift» verifica agora.", "«Revert…» corre o pipeline só para esse recurso; «✦ Write into the code» pede ao Co-Dev que escreva a mudança nos `.tf`; «Ignore…» pede um motivo e dura 30 dias."],
      flow: ["Um drift por resolver bloqueia o apply do pipeline.", "Ignorar usa o mesmo mecanismo dos riscos aceites."],
      limits: ["Quem fez a mudança fica «não ligado»: precisa de uma fonte de auditoria da cloud (como o CloudTrail)."],
      covers: ["ops-drift", "ops-drift-revert", "ops-drift-code", "ops-drift-ignore"],
    },
    {
      title: "Estado",
      where: ["Ops › Infraestrutura como código › Estado"],
      what: "Lista os recursos do estado (endereços e ids, nunca valores), o backend, o serial, o bloqueio e a cópia anterior (backend local).",
      howTo: ["«Force unlock…» liberta um bloqueio preso (pede aprovação e o nome da pasta).", "«Move…» e «✦ Import…» pedem ao Co-Dev um bloco `moved` ou `import` nos `.tf`."],
      flow: ["O estado lê-se por `state pull` no backend; os segredos ficam lá.", "O editor nunca abre, lê nem grava um `.tfstate`."],
      covers: ["ops-state", "ops-unlock", "ops-move", "ops-import"],
    },
    {
      title: "Kubernetes",
      where: ["Ops › Kubernetes"],
      what: "O namespace para onde o pane Infra aponta: pods (com o problema de cada um), deployments com o histórico, serviços e eventos.",
      howTo: [
        "Liga o cluster no pane Infra (kubeconfig, contexto, namespace).",
        "«Logs» abre logo num terminal; «Shell», «Restart», «Scale…», «Port-forward…», «Roll back to this…» e «Delete» pedem aprovação com o comando exacto.",
        "«✦ Why?» num pod com problemas pede ao Co-Dev a causa provável.",
      ],
      flow: ["O estado lê-se com `kubectl … -o json` e o contexto e o namespace sempre explícitos.", "Cada acção aprovada vai ao registo de auditoria e corre num terminal."],
      covers: ["ops-kube-reload", "ops-logs-pod", "ops-logs-deploy", "ops-exec", "ops-del-pod", "ops-restart", "ops-history", "ops-undo", "ops-scale", "ops-port", "ops-ask-pod"],
    },
    {
      title: "Cloud",
      where: ["Ops › Cloud"],
      what: "O estado das CLIs aws, gcloud e az (instalada, versão, conta) e um inventário só de leitura pela CLI instalada.",
      howTo: ["Carrega em «Inventory» na CLI instalada."],
      flow: ["O inventário corre os comandos de listagem da CLI e mostra-os em «Ran: …»."],
      covers: ["ops-inventory"],
    },
    {
      title: "Runbooks como código",
      where: ["Ops › Runbooks"],
      what: "Corre os runbooks do repositório (`runbooks/*.md`) passo a passo. As verificações correm sem perguntar mas só se forem só de leitura; as acções pedem aprovação e recebem as credenciais do Vault só para esse passo; as decisões registam as tuas palavras. Cada passo fica guardado como evidência.",
      howTo: [
        "Escreve o runbook: passos `## 1. título [check|action|decision]`, um bloco de comando e `expect:` (entre crases ou `/regex/` verifica-se sozinho).",
        "Escolhe o runbook e carrega «Run» em cada passo; «New run» começa outra execução.",
        "Numa expectativa em prosa, diz se o resultado foi o esperado («As expected…»).",
        "«✦ Ask Co-Dev» comenta a saída e sugere o passo seguinte, sem correr nada.",
      ],
      flow: [
        "A regra está no Rust: cada comando de uma verificação tem de ser seguro para o classificador do agente ou um verbo de leitura de uma ferramenta de infra; escrever ficheiros (`>`) ou ler segredos é recusado com `not_read_only`.",
        "Uma acção vai ao registo de auditoria antes de correr; o passo grava o comando, a saída mascarada, o código, o resultado, quem e quando.",
      ],
      tips: ["Um runbook com `schedule: weekly` (ou daily, monthly, quarterly) entra na tua fila quando está em atraso."],
      covers: ["ops-rb", "ops-rb-run", "ops-rb-new", "ops-rb-edit", "ops-rb-ok", "ops-rb-no", "ops-rb-ask", "ops-rb-reload"],
    },
    {
      title: "Fontes de dados",
      where: ["Ops › Fontes de dados"],
      what: "Diz que fontes estão ligadas: o CI/CD pelo `gh` (só leitura) e as métricas pelo Prometheus do projecto, com o orçamento de erro de cada SLO e a capacidade do cluster; custo e inventário da cloud aparecem «não ligada», com como ligar — nunca um número estimado.",
      howTo: [
        "Para o CI/CD, instala o GitHub CLI e corre `gh auth login`.",
        "Para as métricas, cria `.dxtutor/metrics.json` com o URL do Prometheus e a autenticação: `none`, `keychain` (depois «Set token…», que guarda o token no keychain do sistema) ou `vault` (o token lido de um caminho KV no Vault).",
        "Os SLOs ficam em `.dxtutor/slo.json`, revistos em PR como o código: por serviço, o objectivo (p. ex. 99,9), a janela (`30d`) e as consultas PromQL de erros e de total, com `$window` onde vai o intervalo; `deployments` diz que Deployments o SLO cobre.",
        "«Measure again» volta a perguntar ao Prometheus.",
      ],
      flow: [
        "`sources_status` vê se o `gh` tem sessão e se a origin do projecto está no GitHub, e se o Prometheus responde.",
        "`metrics_status` mede cada SLO: orçamento restante = 1 − taxa de erro ÷ (1 − objectivo) na janela, e a taxa de queima da última hora; a capacidade são os pedidos de CPU e memória sobre o alocável (kube-state-metrics).",
        "O token nunca sai do backend: vai para o keychain ou vem do Vault, e entra na redacção.",
      ],
      tips: ["Sem pedidos na janela, o orçamento diz «no requests» em vez de um número."],
      limits: ["Ainda não há ligadores de custo nem de inventário.", "Sem o kube-state-metrics no Prometheus, a capacidade diz que não o encontra."],
      covers: ["sources_status", "ops-metrics-token", "ops-metrics-clear", "ops-metrics-reload"],
    },
    {
      title: "Exportar evidências (ISO 27001)",
      where: ["Ops › «Export evidence (ISO 27001)»"],
      what: "Escreve `docs/audit/evidence-AAAA-MM.md` dentro do projecto, a partir das linhas reais do registo de auditoria, dos deploys e das execuções de runbooks, arrumadas por controlo ISO/IEC 27001:2022, e abre-o para revisão.",
      howTo: ["Carrega no botão; o ficheiro abre no editor.", "Revê-o antes de o enviar ao auditor."],
      flow: ["`audit_export_evidence` lê o mês corrente e agrupa por A.8.32, A.8.9, A.5.17/A.8.12, A.8.13, A.5.24–A.5.27, mais as operações não mapeadas; a exportação fica no registo."],
      tips: ["O mapeamento é um ponto de partida: quem decide o que conta como evidência é o dono do sistema de gestão."],
      covers: ["ops-evidence"],
    },
  ],
};

export const PLATFORM_NOTES: FeatureNotes = {
  id: "ops-platform",
  title: "Platform — a minha fila, revisão de PR de infra e incidentes",
  summary:
    "A actividade Platform mostra só o que é teu, com a acção e a prova de que funcionou: a fila calculada do estado real, a revisão de pull requests de infraestrutura com cada verificação e a sua fonte, e os incidentes locais com a cronologia e a confiança.",
  code: ["crates/tutor-platform/src/queue.rs", "crates/tutor-platform/src/review.rs", "crates/tutor-board/src/project/incidents.rs", "ui-app/src/features/ops/application/platform-service.ts", "ui-app/src/features/ops/ui/platform-view.ts"],
  updated: "2026-11-26",
  actions: [
    {
      title: "A minha fila",
      where: ["paleta: «Platform: My Queue»"],
      what: "Lista o que está à tua espera, calculado do estado real: PRs que pedem a tua revisão (com a regra do CODEOWNERS), achados de IaC bloqueantes em `.tf` que mudaste, runbooks recorrentes em atraso, incidentes que comandas e o teu último deploy falhado. Cada item diz porque é teu e tem uma acção.",
      howTo: [
        "Abre a fila pela paleta.",
        "Usa a acção do item (rever o PR, abrir o ficheiro, correr o runbook, abrir o incidente ou o deploy).",
        "Carrega «Verify»: só fica feito se o estado o provar, e a prova fica guardada.",
        "«Hand over…» passa o item a outra pessoa, com um motivo; aparece na vista da equipa.",
      ],
      flow: ["`queue_items` lê o `gh`, o `git log`, os runbooks, os incidentes e os deploys; `queue_verify` volta a verificar contra o estado e grava o feito.", "«Medido neste workspace» são só contagens locais."],
      limits: ["O on-call e os alertas ficam «não ligados»: não há fonte de pager.", "Sem sessão no `gh`, as revisões pedidas não entram (a fila diz porquê)."],
      covers: ["pf:tab", "pf:reload", "pf:act", "pf:verify", "pf:handover", "cmd:Platform: My Queue"],
    },
    {
      title: "Revisão de PR de infra",
      where: ["paleta: «Platform: Review an Infrastructure PR…»", "a fila › «Review the PR»"],
      what: "Mostra o diff de um PR e «Antes do merge»: o CI, o plano, a política e o custo (o pipeline de IaC sobre a cabeça do PR), a janela de mudança, o rollback e incidentes semelhantes; a capacidade do cluster e o orçamento de erro de cada SLO (pelo Prometheus; sem ele, «não ligados»); o on-call aparece «não ligado». Cada verificação diz de onde vem.",
      howTo: ["Dá o número do PR.", "Lê as verificações e o diff; «✦ Review with Co-Dev» pede-lhe um comentário.", "«Approve…», «Request changes…» ou «Comment…» publicam a revisão depois de aprovares o comando `gh` exacto."],
      flow: [
        "O backend busca a cabeça do PR para uma worktree temporária, corre o pipeline nas pastas de IaC que ele toca e remove-a.",
        "Aprovar com uma verificação a falhar exige um motivo (no Rust), que vai para o PR; um PR que mudou depois da revisão é recusado. Fica no registo antes e com o resultado.",
      ],
      limits: ["Os comentários do Co-Dev vêm no chat, não ancorados às linhas do diff."],
      covers: ["pf:ask-pr", "pf:submit", "pf:ask-codev-pr", "cmd:Platform: Review an Infrastructure PR…"],
    },
    {
      title: "Incidentes",
      where: ["paleta: «Platform: Incidents»"],
      what: "Incidentes locais, abertos por uma pessoa: a cronologia (evidência, verificações feitas e não feitas, notas), o estado, a confiança e a pergunta «a causa principal estava certa?».",
      howTo: [
        "«Open an incident…» pede o que está a acontecer e a gravidade (SEV-1 a SEV-4).",
        "Junta evidência e verificações; uma verificação não feita pede o porquê.",
        "«Mitigated…» e «Resolve…» (com o resumo do que aconteceu); depois de mitigado, responde se a causa principal estava certa.",
        "«✦ Likely causes» pede ao Co-Dev as causas pela evidência; «✦ Draft the postmortem» escreve o rascunho em `docs/postmortems/INC-n.md` como proposta.",
      ],
      flow: [
        "Os incidentes vivem na base do Project; abrir e mudar de estado vão ao registo de auditoria.",
        "A confiança nunca passa de «baixa» sem uma fonte de métricas.",
        "«Check metrics» pergunta ao Prometheus a taxa de erro de cada SLO na hora antes da abertura e desde 15 minutos antes dela, e regista cada linha na cronologia como uma verificação feita.",
      ],
      limits: ["Não há fonte de incidentes (PagerDuty, Opsgenie…): cada incidente é aberto à mão."],
      covers: ["pf:new-incident", "pf:reload-incidents", "pf:incident", "pf:add", "pf:status", "pf:feedback", "pf:postmortem", "pf:ask-cause", "pf:metrics", "cmd:Platform: Incidents"],
    },
  ],
};
