/* Notas para a documentação oficial da feature Project: o plano paralelo da sprint (Multi Co-Dev, fase 1) e as
   regras de cada método (Board B); o resto do Project entra aqui quando for documentado. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const PROJECT_NOTES: FeatureNotes = {
  id: "project",
  title: "Project",
  summary:
    "O Project guarda o trabalho da pasta aberta (issues, sprints, releases, relatórios) na base SQLite da app desktop. O método do quadro (Kanban, Scrum, XP, Scrum + XP) muda as regras, e o Co-Dev segue-as. Na vista «Planning», cada sprint diz quantos Co-Devs a trabalham ao mesmo tempo e mostra o plano paralelo: que issue cada Co-Dev faz, por que ordem, e porque é que nenhum par mexe nos mesmos ficheiros ao mesmo tempo. Guarda também os dados da porta de integração: as verificações obrigatórias do projecto e a aprovação funcional de cada issue.",
  code: [
    "crates/tutor-board/src/project/methods.rs",
    "crates/tutor-board/src/project/mod.rs (move_check, capacity_rule, tdd_gap)",
    "crates/tutor-agent/src/issue_prompt.rs (methodology_block)",
    "src-tauri/src/codev_agent.rs (start_work, tdd_observe)",
    "crates/tutor-board/src/project/plan.rs",
    "src-tauri/src/board.rs (project_sprint_plan, project_method_preview)",
    "ui-app/src/features/project/domain/plan.ts",
    "ui-app/src/features/project/ui/plan-view.ts",
    "ui-app/src/features/project/domain/gate.ts",
    "src-tauri/src/roles.rs (functional_check)",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Escolher o método",
      where: ["Project › Settings › cartões «Method»"],
      what:
        "Escolhe Kanban, Scrum, XP ou Scrum + XP. Cada cartão diz as regras do método; ao escolher um, o Project mostra antes o que muda nas definições (duração da iteração, limites de WIP, Definition of Ready e of Done) e o que fica porque foste tu que o definiste. Só muda com «Apply».",
      howTo: [
        "Abre o Project e a vista «Settings».",
        "Carrega no cartão do método: aparece a caixa «Switch to …» com o que muda e o que fica.",
        "Carrega em «Apply» para mudar, ou em «Cancel» para deixar como está.",
      ],
      flow: [
        "O comando `project_method_preview` (só leitura) calcula a mudança no Rust (`tutor_board::project::methods::change`): uma definição é tua quando difere do valor do método anterior (uma DoR/DoD vazia nunca é tua); essas ficam, as outras passam aos valores do método novo.",
        "«Apply» manda `settings` com `method` (e a língua das sugestões) ao `project_apply`, que aplica a mesma mudança.",
        "Regras por método: os limites de WIP valem em todos; a Definition of Ready para sair de To Do, a capacidade da sprint e o teste primeiro do XP valem nos métodos com iterações; o expedite que passa o WIP só no Kanban.",
      ],
      tips: ["Uma definição que mudares à mão depois de escolher o método fica tua: uma mudança de método seguinte já não lhe mexe."],
      limits: ["As sugestões de DoR/DoD ficam na língua da interface no momento em que escolhes o método."],
      covers: ["pj-method", "pj-method-apply", "pj-method-cancel"],
    },
    {
      title: "Definition of Ready do projecto, por issue",
      where: ["Project › painel da issue › secção «Definition of Ready»"],
      what:
        "Os itens da Definition of Ready que o projecto escreveu nas definições aparecem em cada issue com uma caixa a marcar, como os da Definition of Done. Fazem parte do «Ready»: sem eles marcados a issue não fica Ready nem sai de To Do (Scrum e XP), e o Co-Dev não trabalha nela.",
      howTo: ["Abre a issue.", "Marca cada item da Definition of Ready que a issue já cumpre.", "Marca «Ready to start» quando a lista de «Missing for Ready» ficar vazia."],
      flow: [
        "A caixa manda `update_issue` com `dor_done` (uma marca por item, coluna `issues.dor_done`, migração 16).",
        "A prontidão (`readiness`) junta às verificações fixas um «DoR: «item»» por cada item por marcar; o «Ready» só se aprova sem nada em falta.",
        "Um item acrescentado depois de a issue estar Ready faz a saída de To Do pedir um motivo (Scrum e XP).",
      ],
      limits: ["As marcas são por posição: reordenar a lista nas definições muda a que item cada marca corresponde (o mesmo que na DoD)."],
      covers: ["pj-dor"],
    },
    {
      title: "Capacidade da sprint",
      where: ["Project › Planning › «Add to …» e o cartão da sprint", "Project › Backlog › a selecção da sprint"],
      what:
        "Em Scrum, XP e Scrum + XP a capacidade da sprint é uma regra: planear uma issue, criar uma directamente na sprint ou aumentar uma estimativa que a passasse é recusado. Com um motivo, avança e o motivo fica na actividade da issue como excepção.",
      howTo: [
        "Dá à sprint uma capacidade em pontos ao criá-la.",
        "Planeia as issues; o cartão da sprint diz quantos pontos faltam.",
        "Se o Project recusar, escreve o motivo para avançar mesmo assim, ou cancela.",
      ],
      flow: [
        "O `project_apply` verifica `capacity_rule` em `plan_issue`, `create_issue` com sprint e `update_issue` com pontos: soma os pontos da sprint e recusa (`capacity`, ultrapassável) só quando a mudança acrescenta pontos e passa a capacidade.",
        "Com `reason`, a mudança faz-se e fica uma entrada `override` com «excepção (capacity): motivo» na actividade.",
      ],
      limits: [
        "Uma issue sem estimativa não conta pontos.",
        "Fechar uma sprint e passar o trabalho por terminar para a seguinte não é recusado; o cartão da sprint mostra se ficou acima da capacidade.",
        "O Kanban não tem capacidade.",
      ],
      covers: ["pj-plan-to", "pj-plan"],
    },
    {
      title: "Mover uma issue (regras do método)",
      where: ["Project › Board (arrastar o cartão)", "Project › painel da issue › botões de estado"],
      what:
        "Cada mudança de coluna passa pelas regras do método: um passo de cada vez, limites de WIP, bloqueios, Definition of Ready para sair de To Do (Scrum e XP), Definition of Done para Done e, em XP e Scrum + XP, a prova de teste primeiro para o trabalho do Co-Dev chegar a Review. No Kanban um cartão «expedite» pode passar o limite de WIP de uma coluna por um, e os cartões ordenam-se por classe de serviço.",
      howTo: ["Arrasta o cartão para a coluna seguinte, ou usa os botões do painel da issue.", "Se uma regra recusar, escreve o motivo para avançar mesmo assim."],
      flow: [
        "O `move` do `project_apply` corre `move_check` no Rust; a primeira regra partida volta com o seu código (`step`, `wip`, `blocked`, `dor`, `dod`, `tdd`) e com motivo a mudança faz-se como `override`.",
        "Expedite (Kanban): entra numa coluna cheia se ela estiver exactamente no limite; a actividade diz «expedite acima do limite de WIP».",
        "Teste primeiro (XP, Scrum + XP): para uma issue com alterações do Co-Dev, de Em curso para Review exige uma linha `tdd`/`red` do registo de auditoria — um `run_tests` que falhou quando só os testes tinham mudado — cujos ficheiros de teste estejam nas alterações aceites.",
      ],
      limits: ["O trabalho feito à mão, sem alterações do Co-Dev, não tem como provar o teste primeiro: não é verificado."],
      covers: ["pj-col", "pj-move"],
    },
    {
      title: "Trabalhar com o Co-Dev no método",
      where: ["Project › painel da issue › «Work on it with Co-Dev»"],
      what:
        "Quando a sessão do Co-Dev começa, a issue passa a Em curso pelas regras normais (WIP, prontidão); se a coluna Em curso já estiver no limite, o Project pergunta antes o motivo e sem ele o Co-Dev não começa. O prompt leva um bloco curto do método: método, sprint e dias que faltam, DoD, WIP de Em curso e Review, par, classe de serviço e, em XP, a regra de TDD. No fim, o `finish_issue` responde também a cada item da DoD e a issue só passa a Review pelas regras.",
      howTo: [
        "Prepara a issue até ficar Ready e carrega em «Work on it with Co-Dev».",
        "Se a coluna Em curso estiver cheia, escreve o motivo ou espera.",
        "No fim, vê na actividade se a issue passou a Review ou ficou em Em curso, e porquê.",
      ],
      flow: [
        "O anfitrião (`codev_agent::send`) faz o `move` para `progress` quando a sessão manda o primeiro pedido da issue em To Do e bloqueia o pedido se o Project recusar; uma sessão que espera pelos ficheiros de outra só move a issue quando começa.",
        "Antes, se o limite de WIP de Em curso já a recusaria (`startWipRefusal`), a UI pede o motivo e manda o `move` com ele (fica como `override`).",
        "O prompt (`project_issue_prompt`) ganhou o bloco «Método» (`methodology_block`), que um template do projecto sem o marcador `{{metodologia}}` recebe por cima do código.",
        "Conjunto de ferramentas 10: o `finish_issue` exige uma resposta com prova por item da DoD; o `codev_finished` usa a mudança normal para Review e, se uma regra a recusar (WIP, um passo, DoD por responder, teste primeiro), deixa a issue onde está com uma entrada `held` na actividade.",
        "XP: o anfitrião regista no registo de auditoria (`tdd`, `red`) o primeiro `run_tests` que falhou quando a sessão só tinha mudado testes (ficheiros de teste, ou texto com `#[test]`, `def test_`, `@Test`…).",
      ],
      limits: [
        "Sessões antigas (conjunto 9) retomam sem as respostas da DoD: o Project não as exige a esses relatórios.",
        "Ficheiros escritos pelo `bash` não entram no rasto do teste primeiro.",
      ],
      covers: ["pj-work"],
    },
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
