/* Notas para a documentação oficial da feature Project. Por agora o plano paralelo da sprint (Multi Co-Dev,
   fase 1) e os relatórios com os insights para o gestor (Board A); o resto do Project entra aqui quando for
   documentado. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const PROJECT_NOTES: FeatureNotes = {
  id: "project",
  title: "Project",
  summary:
    "O Project guarda o trabalho da pasta aberta (issues, sprints, releases, relatórios) na base SQLite da app desktop. Na vista «Planning», cada sprint diz quantos Co-Devs a trabalham ao mesmo tempo e mostra o plano paralelo: que issue cada Co-Dev faz, por que ordem, e porque é que nenhum par mexe nos mesmos ficheiros ao mesmo tempo. Guarda também os dados da porta de integração: as verificações obrigatórias do projecto e a aprovação funcional de cada issue. Na vista «Reports», os gráficos da sprint lêem o âmbito e as estimativas como eram em cada dia, e o painel «Insights» diz ao gestor o que o histórico mostra: se a sprint acaba, o que mudou desde o início, quanto do compromisso se cumpre, o que está parado ou bloqueado, quanto custa e quanto se refaz.",
  code: [
    "crates/tutor-board/src/project/plan.rs",
    "src-tauri/src/board.rs (project_sprint_plan, project_reports)",
    "crates/tutor-board/src/project/reports.rs",
    "crates/tutor-board/src/project/insights.rs",
    "ui-app/src/features/project/domain/plan.ts",
    "ui-app/src/features/project/ui/plan-view.ts",
    "ui-app/src/features/project/ui/reports-view.ts",
    "ui-app/src/features/project/domain/gate.ts",
    "src-tauri/src/roles.rs (functional_check)",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Co-Devs da sprint",
      where: ["Project › Planning › cartão da sprint, campo «Co-Devs»"],
      what: "Diz quantos Co-Devs (agentes de código) trabalham a sprint ao mesmo tempo, de 1 a 8. Fica gravado na sprint, na base do Project; vazio quer dizer um.",
      howTo: ["Abre o Project e a vista «Planning».", "No cartão da sprint, escreve o número no campo «Co-Devs» e sai do campo."],
      flow: [
        "O campo manda a operação `set_sprint_codevs` ao `project_apply`; o store recusa um número fora de 1–8 (o campo também o diz antes).",
        "A coluna `sprints.codevs` nasceu na migração 14 da base do Project.",
        "Se o plano paralelo dessa sprint estiver aberto, é recalculado com o número novo.",
      ],
      limits: ["Nesta fase o número só desenha o plano: nada corre em paralelo ainda."],
      covers: ["pj-sprint-codevs"],
    },
    {
      title: "Plano paralelo",
      where: ["Project › Planning › cartão da sprint, botão «Parallel plan»"],
      what:
        "Mostra como as issues Ready da sprint se repartiriam pelos Co-Devs: uma coluna por Co-Dev com as issues por ordem, as ondas (uma issue só começa quando as das ondas anteriores acabaram), as issues que ficaram de fora com o motivo, e as sobreposições (que ficheiros e que entradas do âmbito se cruzam). Só leitura: nada corre e nada muda.",
      howTo: [
        "Dá a cada issue da sprint um âmbito de ficheiros (`src/cart/**`, `Cargo.toml`) e as dependências, e aprova-a como Ready.",
        "Carrega em «Parallel plan» no cartão da sprint; «Recompute» volta a calcular e o ✕ fecha.",
        "Clica num cartão ou numa linha para abrir a issue.",
      ],
      flow: [
        "O comando `project_sprint_plan` (só leitura) junta as issues da sprint, os ficheiros da pasta (com o `.gitignore` respeitado), os ficheiros dos change sets do Co-Dev, dos commits ligados e do ramo de cada issue, e prevê com `git merge-tree` se o ramo tem conflitos com o HEAD.",
        "O planeador (`tutor_board::project::plan`) põe de fora o que não está Ready (as dependências à parte), o que já está no fluxo, o que espera por uma dependência que não está em Done nem no plano, os ciclos, e o que se sobrepõe a uma issue já no fluxo.",
        "Duas issues sobrepõem-se quando um ficheiro pode ser mudado pelas duas: um ficheiro da pasta (ou conhecido) apanhado por uma entrada do âmbito de cada uma, ou conhecido de ambas. Uma entrada literal conta como ficheiro mesmo antes de existir.",
        "Por ondas: em cada onda entram, por prioridade e rank, as issues com as dependências feitas que não se sobrepõem a nenhuma já escolhida; a mais pesada vai para o Co-Dev com menos pontos.",
        "Qualquer mudança no Project com o plano aberto volta a calculá-lo.",
      ],
      tips: [
        "Âmbitos estreitos dão mais paralelismo: `src/cart/**` e `src/pay/**` correm lado a lado, `src/**` fica sozinho.",
        "Uma issue «serialised after» outra pode mexer nos mesmos ficheiros: vai na onda seguinte.",
      ],
      limits: [
        "Dois globs que só se cruzariam em ficheiros que ainda não existem (`src/*.rs` e `src/a*`) não são detectados.",
        "As ondas são barreiras: uma onda começa quando a anterior acabou toda (o tempo de cada issue não entra).",
        "Fases seguintes: uma sessão por Co-Dev, uma worktree e ficheiros reservados por Co-Dev, o revisor que integra num worktree temporário só com os testes a passar, e a autonomia delegada com PRs.",
      ],
      covers: ["pj-sprint-plan", "pj-plan-close"],
    },
    {
      title: "Burndown, burnup e velocidade",
      where: ["Project › Reports (Scrum, XP e Scrum + XP)"],
      what:
        "O burndown mostra, dia a dia, os pontos que faltavam nesse dia, com o âmbito e as estimativas desse dia, contra a linha ideal que parte do que a sprint comprometeu ao começar. O burnup mostra os pontos feitos contra a linha do âmbito (sobe quando entra trabalho ou uma estimativa cresce, desce quando sai) e o compromisso a tracejado. A velocidade mostra, por sprint fechada, o comprometido ao lado do feito.",
      howTo: [
        "Planeia a sprint e carrega em «Start»: o que está nela nesse momento fica registado como o compromisso.",
        "Abre a vista «Reports». Passa o rato por uma barra da velocidade para ver o comprometido, o feito, o acrescentado, o retirado e o que transitou.",
      ],
      flow: [
        "Desde a migração 16 da base do Project, cada operação que mexe numa sprint grava o histórico: a issue que entra ou sai (criada já na sprint, planeada, retirada, transitada no fecho ou apagada), com a estimativa desse momento (`sprint_scope`); cada mudança de estimativa com o valor antigo e o novo (`estimate_changes`); e o que a sprint tinha ao começar e ao fechar (`sprint_snapshots`, `start` e `close`).",
        "O `project_reports` (`tutor_board::project::reports`) reconstrói cada dia a partir desse histórico: quem estava na sprint, com que estimativa e em que estado. Uma issue que já estava em Done quando a sprint começou não conta.",
        "A velocidade lê as fotografias do início e do fecho: o «comprometido vs feito» sobrevive à transição das issues por acabar para outra sprint.",
      ],
      tips: [
        "Uma issue sem estimativa não aparece nos gráficos: o burndown lista-a por baixo, para a estimares.",
        "Reestimar a meio da sprint é legítimo, mas aparece no burnup como mudança de âmbito.",
      ],
      limits: [
        "Uma sprint que começou antes da migração 16 aparece como parcial: o compromisso não se conhece e, antes de o registo começar, o âmbito e as estimativas são os de hoje. Nada é inventado para trás.",
        "Os dias contam-se em UTC e por calendário (fins-de-semana incluídos).",
      ],
      covers: ["project_reports"],
    },
    {
      title: "Insights para o gestor",
      where: ["Project › Reports, painel «Insights» (no topo, em todos os métodos)"],
      what:
        "Frases curtas para o gestor do projecto, cada uma com a gravidade (risco, atenção, info), os números por trás e as issues envolvidas: previsão do fim da sprint, mudança de âmbito desde o início, issues da sprint sem estimativa, fiabilidade do compromisso nas últimas sprints (com a velocidade recente como tamanho realista para a próxima), cartões envelhecidos, issues bloqueadas e o tempo bloqueado, custo do Co-Dev por ponto e issues que já gastaram demais, e a taxa de retrabalho (testes que falham depois do trabalho do Co-Dev).",
      howTo: [
        "Abre a vista «Reports»: os insights mais graves vêm primeiro.",
        "Clica numa chave de issue para a abrir no painel da issue.",
        "Abre «Not enough data yet» para ver o que ainda falta ao histórico para cada insight.",
      ],
      flow: [
        "O módulo puro `tutor_board::project::insights` recebe o que os relatórios reconstruíram e devolve, para cada insight, um código, a gravidade, os parâmetros e as chaves; a interface tem a frase de cada código em inglês e em português (`ui/reports-messages.ts`).",
        "Previsão: o ritmo é a média dos pontos terminados nos últimos dias da sprint (até 5); com ele diz se o que falta cabe nos dias que restam, quantos pontos ficariam feitos e quantos dias a mais seriam precisos.",
        "Âmbito: compara o compromisso do início com o que está na sprint agora (entradas, saídas e reestimativas).",
        "Fiabilidade: soma o comprometido e o feito do compromisso nas últimas 5 sprints fechadas com o compromisso registado.",
        "Envelhecidos: compara a idade de cada cartão no fluxo (desde que entrou em curso) com o percentil 85 do tempo de ciclo das issues terminadas.",
        "Bloqueios: lêem-se do registo de actividade (incluindo o bloqueio automático depois de duas falhas dos testes). Custo: os turnos do Co-Dev com preço no registo de auditoria. Retrabalho: as corridas de testes depois do Co-Dev.",
      ],
      tips: ["Um insight sem dados suficientes não é adivinhado: aparece na lista do que falta, com quanto falta."],
      limits: [
        "A previsão precisa de 2 dias de sprint; a fiabilidade de 2 sprints fechadas com compromisso registado; os envelhecidos de 5 issues terminadas; o custo por ponto de 3 issues terminadas, estimadas e com custo; o retrabalho de 3 corridas de testes.",
        "Quem mudou uma estimativa fica no histórico, mas o insight não o mostra.",
      ],
      covers: ["pj-open"],
    },
    {
      title: "Verificações obrigatórias",
      where: ["Project › Settings › «Mandatory checks»"],
      what:
        "A lista das verificações que cada mudança tem de passar antes de ser integrada (o nome e o comando exacto, uma por linha: `tests: cargo test --workspace`). Sem nenhuma definida, vale o comando de testes detectado na pasta, e a página di-lo.",
      howTo: ["Abre o Project e a vista «Settings».", "Escreve uma verificação por linha, `nome: comando`, e carrega em «Save»; deixa vazio para voltar ao comando detectado."],
      flow: [
        "O «Save» manda a operação `settings` com `checks` ao `project_apply`; o store guarda-as na coluna `projects.checks` (migração 15), aparadas, sem nomes repetidos, até 12.",
        "O comando `project_checks` lê-as para as fases seguintes (a porta de integração corre-as no commit actual).",
      ],
      limits: ["Nesta fase a lista só se guarda: quem a corre é a porta de integração (fase 4)."],
      covers: ["pj-submit"],
    },
    {
      title: "Aprovação funcional",
      where: ["Project › painel da issue › secção «Functional approval»"],
      what:
        "O responsável pela issue regista que ela faz o que os critérios de aceitação pedem. Fica na issue quem aprovou, quando e a nota, e vai para o registo de auditoria. É a terceira condição da porta de integração: uma mudança só é integrada quando todas as verificações obrigatórias passam no commit actual, o revisor Co-Dev confirma os critérios e o responsável registou a aprovação funcional.",
      howTo: [
        "Abre a issue (precisa de critérios de aceitação: sem eles o botão fica desligado).",
        "Carrega em «Record functional approval» e escreve, se quiseres, como verificaste.",
        "«Withdraw» retira-a, com um motivo.",
      ],
      flow: [
        "As operações `approve_functional` e `revoke_functional` vão ao `project_apply`; o backend decide quem e quando (como em todas as operações), recusa sem critérios ou uma segunda aprovação, e grava a actividade e uma linha no registo de auditoria (origem `ide`, `functional.approve`/`functional.revoke`) na mesma transacção.",
        "Quem pode: o responsável da issue (o campo «Assignee», pelo `user.name`/`user.email` do git) ou, com pessoas no `.dxtutor/team.json`, um Product Owner ou um Tech Lead (os mesmos que levam uma issue a Done). Sem equipa definida e sem responsável, quem está ao teclado.",
        "Se os critérios de aceitação mudarem depois, a aprovação cai (fica na actividade): foi dada contra os critérios antigos.",
      ],
      limits: ["O código pode mudar depois da aprovação: confirmar que ela ainda vale no commit a integrar é da porta de integração (fase 4)."],
      covers: ["pj-functional-approve", "pj-functional-revoke"],
    },
  ],
};
