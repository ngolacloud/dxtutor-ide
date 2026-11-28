/* Notas para a documentação oficial do Co-Dev. Por agora a escrita no editor (as hunks); o resto do
   Co-Dev entra aqui quando for documentado. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const CODEV_NOTES: FeatureNotes = {
  id: "codev",
  title: "Co-Dev: o assistente escreve no editor e mostra quem está a trabalhar",
  summary:
    "Quando o Co-Dev cria ou edita código, escreve-o no próprio editor: abre o ficheiro, escreve só as linhas que mudam, no sítio delas (as antigas riscadas, as novas a aparecer), e no fim aceitas ou rejeitas cada bloco com as diferenças à vista. Nada fica no ficheiro sem o teu «Aceitar».",
  code: ["ui-app/src/features/codev/application/codev-sessions.ts", "ui-app/src/features/codev/ui/session-view.ts", "ui-app/src/features/codev/ui/codevs-view.ts", "ui-app/src/features/codev/domain/scope-overlap.ts", "ui-app/src/features/codev/domain/agent-map.ts", "ui-app/src/features/codev/application/agent-map.ts", "ui-app/src/features/codev/ui/agent-map-view.ts", "ui-app/src/features/codev/application/hunk-review.ts", "ui-app/src/features/codev/application/local-proposals.ts", "ui-app/src/features/codev/domain/proposal.ts", "crates/tutor-agent/src/hunks.rs", "ui-app/src/features/codev/domain/backlog.ts", "ui-app/src/features/codev/ui/backlog-view.ts", "src-tauri/src/backlog.rs", "crates/tutor-board/src/project/backlog.rs", "ui-app/src/platform/desktop/gateway.ts", "crates/tutor-llm/src/gateway.rs"],
  updated: "2026-11-28",
  actions: [
    {
      title: "Gerar o backlog e criar o Project (/backlog e /project)",
      where: ["chat do Co-Dev › «/backlog …» e «/project …» (ou o menu «/» › Gerar o backlog do projecto)", "Studio › «Generate backlog & delegate →»"],
      what:
        "O «/backlog» pede ao Co-Dev o backlog da pasta aberta: ele lê o código, o README e o desenho do Studio, e propõe épicos e issues, cada uma com a história, critérios em Dado/Quando/Então, os ficheiros onde mexe (ou que cria) e as dependências. O backlog fica em .dxtutor/backlog.json e aparece no chat. O «/project» transforma-o no Project da pasta: método, duração das iterações e sprints (as dependências primeiro); só é criado quando carregas em «Criar o Project» e confirmas.",
      howTo: [
        "Abre a pasta do projecto (pode estar vazia) e escreve no chat «/backlog» seguido do contexto, p.ex. «/backlog uma loja com encomendas e pagamentos». No Studio, «Generate backlog & delegate →» faz o mesmo com os componentes do desenho.",
        "Revê o backlog no cartão (ou em .dxtutor/backlog.json, que podes editar).",
        "Escreve «/project» com o método e a capacidade, p.ex. «/project scrum, sprints de 2 semanas, 20 pontos», e revê o plano.",
        "Carrega em «Criar o Project» (ou «Criar e aprovar Ready») e confirma no diálogo. As issues prontas ficam com «Trabalhar … com o Co-Dev», que implementa cada uma nos ficheiros do seu âmbito.",
      ],
      flow: [
        "O «/backlog» abre uma sessão de backlog do agente v2 (conjunto de ferramentas 11): só estas sessões têm `backlog_propose` e `project_propose`; o pedido é a skill embutida `backlog` (um `.dxtutor/commands/backlog.md` substitui-a).",
        "`backlog_propose` valida o backlog com as regras do Project (no Rust): o que falta volta ao modelo, que corrige; o bom grava-se em `.dxtutor/backlog.json` e chega ao chat pelo evento `backlog://proposal`.",
        "`project_propose` só lê o ficheiro e valida o plano; criar é o comando `project_create_from_backlog`, que confere que o ficheiro não mudou, regista no registo de auditoria e cria tudo numa só transacção.",
      ],
      tips: [
        "Uma issue cujo título o Project já tem não é criada outra vez: podes correr o «/project» de novo depois de acrescentar issues ao backlog.",
        "Um ficheiro do âmbito que ainda não existe vai no pedido da issue como «ainda não existe: cria-o».",
      ],
      limits: [
        "Só na app desktop, com uma pasta aberta e um provedor com agente.",
        "«Criar e aprovar Ready» é do Product Owner ou do Tech Lead (quando a equipa está definida) e só aprova as issues a que não falta mais nada; as que esperam por uma dependência ficam por aprovar.",
      ],
      covers: ["codev-backlog:open", "codev-backlog:next", "codev-backlog:create", "codev-backlog:create-ready", "codev-backlog:project", "codev-backlog:work"],
    },
    {
      title: "Rever as mudanças no editor, bloco a bloco",
      where: ["editor › barra de cada bloco (✓ Aceitar / ✗ Rejeitar / Explicar)", "chat do Co-Dev › Aceitar tudo / Rejeitar tudo"],
      what: "Cada mudança que o Co-Dev propõe aparece no ficheiro como um bloco: as linhas que saem riscadas e as que entram escritas a seguir, a um ritmo legível. Aceitas ou rejeitas cada bloco; o que aceitas fica escrito, o resto não.",
      howTo: [
        "Pede uma mudança ao Co-Dev (ou usa «Rever no editor» no painel Explain / Code review).",
        "O ficheiro abre e o Co-Dev escreve cada bloco no sítio; podes acelerar, pausar ou continuar a editar o resto do ficheiro.",
        "Em cada bloco: ✓ aceita, ✗ rejeita, «Explicar» pergunta porquê. Ctrl+Z desfaz o que aceitaste.",
      ],
      flow: [
        "O agente v2 (desktop) manda as edições já por linhas (`edit`, `edit_lines`) e o backend emite as hunks (`hunk_start`/`chunk`/`end`/`review`).",
        "Quem só tem o ficheiro inteiro — o chat ao vivo antigo em Manual/Assistido, o desktop sem ferramentas, o painel Explain / Code review — passa pelas propostas locais: o diff dá os blocos (só as linhas que mudam) e a mesma revisão de hunks mostra-os; no fim só os aceites são escritos e gravados.",
        "Uma decisão sobre um bloco cujo sítio já mudou não se aplica (fica «desactualizado»).",
      ],
      tips: ["Rejeitar um bloco não perde os outros: aceitas o que serve e pedes de novo o resto."],
      limits: ["Em modo Automático o agente v2 aplica sem esperar (e valida com os testes no fim do turno)."],
      covers: ["codev:hunk-accept", "codev:hunk-reject", "codev:local-proposal"],
    },
    {
      title: "Mapa de agentes",
      where: ["chat do Co-Dev › barra do compositor › chip «● N agentes»"],
      what: "O chip conta os agentes que estão a trabalhar agora; clicá-lo abre o mapa: a conversa num cartão à esquerda, ligada aos seus agentes à direita, cada um com o estado (verde a correr, cinzento concluído, vermelho falhou), o tempo e os tokens. Clicar num agente mostra o que lhe pediram, as ferramentas que correu, o relatório ou a última resposta, os tokens (entrada, saída, cache) e o custo quando o preço do modelo é conhecido.",
      howTo: [
        "Pede ao Co-Dev uma investigação maior; ele lança sub-agentes (só leitura) e o chip passa a «● 2 agentes».",
        "Clica no chip: o mapa abre com a sessão da conversa e os agentes dela.",
        "Clica num agente para o detalhe; «Ver no chat» volta à conversa e «Abrir o Co-Dev run» mostra o turno passo a passo.",
        "Fecha com ✕, Esc ou um clique fora do mapa.",
      ],
      flow: [
        "O agente v2 (desktop) emite o progresso de cada sub-agente no mesmo evento do turno (`codev-agent://event`, `{kind: \"subagent\", call, step}`: arranque com o papel, cada ferramenta, os tokens acumulados); o relatório chega no resultado da chamada `task`.",
        "O mapa ouve os eventos de TODAS as sessões (a conversa só segue a sua) e, ao abrir, pede as sessões abertas (`codev_agent_live`): numa sprint, cada Co-Dev de uma issue aparece como um agente, com os sub-agentes dele por baixo.",
        "Os agentes que acabaram ficam no mapa até ao turno seguinte da sessão; o tempo dos que correm anda sozinho enquanto o mapa está aberto.",
      ],
      tips: ["O custo usa a tabela de preços do Co-Dev; com um modelo fora dela o mapa mostra só os tokens."],
      limits: [
        "Só na app desktop (o agente v2): no browser o chip fica a zero e o mapa mostra só a conversa.",
        "O texto que um sub-agente vai escrevendo não aparece em tempo real: só as ferramentas, os tokens e, no fim, o relatório.",
      ],
      covers: ["codev:agmap-open", "codev:agmap-pick", "codev:agmap-close", "codev:agmap-chat", "codev:agmap-run"],
    },
    {
      title: "Vários Co-Devs ao mesmo tempo (a faixa «Co-Devs»)",
      where: ["Project › painel da issue › «Work on it with Co-Dev»", "chat do Co-Dev › faixa «Co-Devs» por cima da conversa", "mapa de agentes › detalhe de uma sessão › «Ver no chat»"],
      what:
        "Cada issue que mandas ao Co-Dev tem a sua sessão: começar outra issue já não fecha a que está a correr. A faixa «Co-Devs» aparece quando há mais de uma sessão, com um cartão por Co-Dev («Co-Dev · DX-12», a trabalhar / parado / precisa da tua decisão, o tempo e os tokens); clicar num cartão mostra a conversa dele. Os hunks de um Co-Dev em segundo plano só se pintam no editor quando abres a conversa dele, e as tuas decisões vão sempre para a sessão que as propôs.",
      howTo: [
        "No Project, abre uma issue Ready e carrega em «Work on it with Co-Dev»; depois faz o mesmo com outra issue.",
        "A segunda abre noutra sessão e a faixa «Co-Devs» aparece; a primeira continua a trabalhar.",
        "Numa pasta sem git, as duas trabalham na mesma árvore: se os âmbitos se cruzarem, a app diz em que ficheiros e pergunta se a issue espera — com «OK» ela fica na faixa («espera por DX-12») e começa sozinha quando esse Co-Dev fechar; com «Cancelar» não começa.",
        "Clica num cartão para ver a conversa desse Co-Dev (e os hunks dele no editor); o ✕ fecha o Co-Dev (a sessão acaba) e o ✕ de uma issue à espera desiste de esperar.",
      ],
      flow: [
        "A conversa é uma por sessão (`makeAgentChat`): a à vista escreve no chat e na barra de execução como sempre; as outras escrevem num transcript fora do ecrã e guardam a sua execução (o tempo, o «parar», a decisão pendente) até as abrires.",
        "Num repositório git, cada Co-Dev a mais trabalha numa worktree própria (nota «Uma worktree por Co-Dev»); sem git, o comando `project_scope_overlap` (só leitura) compara o âmbito da issue nova com o de cada issue que tem uma sessão aberta, com a regra do plano paralelo — e, como todas trabalham na mesma árvore, a issue que choca (ou cuja verificação falha) não começa.",
        "Fechar um Co-Dev liberta o âmbito dele: as issues à espera voltam a ser verificadas e as que já não chocam começam em segundo plano.",
      ],
      tips: ["Com um só Co-Dev nada muda: não há faixa e a conversa é a de sempre.", "«Nova conversa» recomeça só a conversa à vista; os outros Co-Devs continuam."],
      limits: [
        "Uma issue segura o âmbito enquanto a sessão dela estiver aberta, mesmo parada: fecha-a (✕) quando acabares.",
        "O separador «Co-Dev run» e o `ctx` da barra de estado seguem a conversa à vista.",
        "O quadro Tasks antigo («Delegar») continua a usar a conversa à vista.",
        "Fase seguinte: o revisor e a porta de integração (fase 4).",
      ],
      covers: ["codev:codevs-pick", "codev:codevs-close", "codev:codevs-unqueue"],
    },
    {
      title: "Uma worktree por Co-Dev e os ficheiros reservados",
      where: ["Project › painel da issue › «Work on it with Co-Dev» (com outro Co-Dev aberto)", "chat do Co-Dev › faixa «Co-Devs» › ☰ «Ficheiros», ✓ «Commit», ⌫ «Limpar»", "chat do Co-Dev › barra da revisão de hunks (o ramo, «Ver no editor»)"],
      what:
        "Quando já há um Co-Dev aberto, a issue seguinte trabalha numa worktree git própria, no ramo dela (`feature/dx-12-…`), numa pasta fora do projecto: os ficheiros dos dois nunca se misturam e a tua árvore de trabalho não muda. Cada Co-Dev reserva os ficheiros que escreve; se outro tentar escrever num ficheiro reservado, é recusado e sabe por quem. Por isso a sobreposição de âmbitos já não impede ninguém de começar: as reservas decidem.",
      howTo: [
        "Com um Co-Dev a trabalhar, manda outra issue ao Co-Dev: aparece o diálogo de aprovação com o comando exacto (`git -C … worktree add -b <ramo> -- <pasta> <commit>`); aprova para ele começar (recusar fica registado e a issue não começa).",
        "Na faixa «Co-Devs», o cartão dele mostra o ramo (⎇) e quantos ficheiros reservou (passa o rato para ver quais).",
        "☰ «Ficheiros» lista o que ele mudou na worktree; escolher um abre-o só de leitura, ao lado de como estava quando o ramo saiu.",
        "Os hunks dele não se pintam no editor (são de outra árvore): revê-os na conversa — «Aceitar todas»/«Rejeitar todas» — e «Ver no editor» mostra a proposta só de leitura.",
        "✓ «Commit» pede a mensagem e commita tudo o que a worktree tem, no ramo da issue (o secret scan corre antes; nada é integrado no ramo principal).",
        "Ao fechar o Co-Dev (✕), a worktree sai se não tiver alterações por commitar (o ramo fica); senão fica na faixa como «guardada». Começar a mesma issue outra vez volta a ela.",
        "Ao abrir a pasta, as worktrees deixadas por uma execução anterior aparecem na faixa; ⌫ «Limpar» remove uma limpa, com aprovação.",
      ],
      flow: [
        "`codev_worktree_plan` (só leitura) diz o que vai correr: nada (a worktree existe, ou a pasta não tem git — então vale a regra da fase 2) ou os comandos exactos; o ramo é o registado na issue ou o nome do Project para ela, que fica registado.",
        "`codev_worktree_create` só corre o comando aprovado e regista-o no registo de auditoria antes e com o resultado (sem auditoria, não corre). A pasta é `<dados da app>/worktrees/<repositório>/<issue>`: fora do projecto, nunca no `git status` nem nas ferramentas dele.",
        "A sessão abre com a worktree (`codev_agent_start` com `worktree`, que o backend encontra — nunca um caminho vindo da interface): ler, escrever, editar, procurar, `bash` e `run_tests` ficam lá dentro; o Project, a auditoria, os papéis e as permissões continuam os da pasta.",
        "Antes de cada escrita, o backend reserva o ficheiro para a sessão (tabela `file_claims`, migração 18); se outra sessão aberta o reservou, a escrita é recusada com a issue e a sessão dona. O que um `bash` mudou também é reservado (e um ficheiro de outro vai para a conversa e para o registo). As reservas voltam quando a sessão fecha; as de uma sessão que já não existe são retomadas.",
        "Fechar uma sessão remove a worktree com `git worktree remove` (nunca forçado) e regista-o; `codev_worktree_remove` faz o mesmo a uma que ficou, com aprovação. `codev_worktree_commit` commita na worktree depois do secret scan.",
      ],
      tips: ["Com um só Co-Dev nada muda: trabalha na tua árvore, como sempre.", "Uma issue com worktree volta sempre a ela, mesmo sozinha: assim nada do que lá ficou se perde."],
      limits: [
        "Um ramo só pode estar numa worktree de cada vez: se o ramo da issue estiver na tua árvore principal, muda-a de ramo primeiro.",
        "As reservas valem enquanto a sessão estiver aberta: fecha os Co-Devs que acabaram.",
        "Integrar o ramo no principal é a fase 4 (o revisor e a porta de integração).",
      ],
      covers: ["codev:codevs-files", "codev:codevs-commit", "codev:codevs-cleanup"],
    },
    {
      title: "Usar o gateway de IA da organização",
      where: ["Definições › «Gateway de IA da organização» e o cartão «Gateway» dos modelos e provedores", "chat do Co-Dev › lista de modelos (com o Gateway activo, as rotas)"],
      what:
        "As chamadas aos modelos podem passar pelo gateway da organização, que trata da identidade, do orçamento, da máscara de dados, dos guardrails e da auditoria. O Co-Dev fala com ele como com um fornecedor: um URL, uma chave do gateway e uma rota no lugar do modelo. Quando a organização ou o projecto exige o gateway, os outros fornecedores ficam bloqueados (o Ollama desta máquina continua, salvo se a política o proibir) e as Definições dizem quem o exige.",
      howTo: [
        "Se a organização já definiu o gateway (/etc/dxtutor/llm.json), o URL aparece fechado; senão escreve o URL e a API (Anthropic ou OpenAI) e carrega em «Guardar».",
        "No cartão «Gateway» cola a chave do gateway (fica no keychain).",
        "Carrega em «Carregar rotas» e escolhe a rota; no chat do Co-Dev, com o Gateway activo, a lista de modelos mostra as mesmas rotas.",
        "Um .dxtutor/llm.json do projecto que traz outro gateway só conta depois de confiares nele em «/comandos».",
      ],
      flow: [
        "A política é do Rust (`tutor_llm::gateway`): o ficheiro da organização manda, o do projecto só aperta, e cada chamada a um modelo é verificada no backend (Co-Dev, revisor, chat, assistente e estudo); uma chamada recusada nunca sai da máquina.",
        "As Definições lêem-na com `llm_policy_status` e as rotas com `llm_gateway_routes` (o `GET /v1/models` do gateway, feito no backend: a chave nunca chega à página).",
      ],
      tips: ["Um gateway que não responde ou uma chave recusada aparecem por baixo de «Carregar rotas», com a mensagem do gateway."],
      limits: ["Só na app desktop.", "O URL tem de ser https (http só para um gateway nesta máquina)."],
      covers: ["desktop:gateway-settings", "desktop:gateway-routes", "codev:gateway-route"],
    },
    {
      title: "Servidores MCP remotos: entrar com OAuth e rever ferramentas que mudaram",
      where: ["separador «Co-Dev run» › «MCP and hooks» (as linhas de cada servidor remoto ou com ferramentas à espera)", "chat do Co-Dev › «/comandos» (diz quais precisam de atenção)"],
      what:
        "Um servidor MCP pode estar noutra máquina («url» no mcp.json, transporte Streamable HTTP). Se pede uma conta, «Entrar» abre o browser na página dele e os tokens ficam no keychain do sistema. E o Co-Dev só usa as ferramentas de um servidor tal como as viu da primeira vez: se uma descrição ou um esquema mudar (ou aparecer uma ferramenta nova), essa ferramenta fica de fora até a reveres e aprovares.",
      howTo: [
        "Acrescenta o servidor ao ~/.config/dxtutor/mcp.json (ou ao .dxtutor/mcp.json do projecto, que tens de confiar em «/comandos»): {\"mcpServers\": {\"docs\": {\"url\": \"https://mcp.example.com/mcp\"}}}.",
        "Abre uma conversa: se o servidor responder que precisa de entrar, o separador «Co-Dev run» mostra «precisa de entrar» e o botão «Entrar». Carrega, confirma no browser e volta: a próxima conversa já tem as ferramentas dele.",
        "Quando uma ferramenta muda, a linha do servidor mostra-a com «Rever alterações»: o diálogo mostra a descrição antiga e a nova, se o esquema mudou e a definição completa. Aprovar fixa essa definição; a ferramenta volta na próxima conversa.",
        "«Sair» apaga os tokens do keychain.",
      ],
      flow: [
        "O cliente é do Rust (`tutor_agent::mcp`): cada mensagem é um POST ao url (JSON ou SSE), com o `Mcp-Session-Id` e o `MCP-Protocol-Version`; um DELETE fecha a sessão. Só https, ou http para esta máquina; nunca credenciais no URL.",
        "Entrar (`codev_mcp_sign_in`, `tutor_agent::mcp::oauth`): o 401 do servidor → os metadados do recurso (RFC 9728) → os do servidor de autorização (RFC 8414, ou a descoberta OIDC) → o registo dinâmico do cliente (RFC 7591) quando não há `oauth.clientId` → o código de autorização com PKCE S256, o `state` verificado, o `resource` (RFC 8707) e o regresso a http://127.0.0.1:<porta>/callback. Fica no registo de auditoria antes e com o resultado.",
        "Os tokens ficam no keychain (conta `mcp:<url>`) e nenhum comando os devolve à interface; renovam-se antes de expirar e num 401. Se a renovação falhar, o servidor passa a «precisa de entrar» — o browser nunca abre sozinho a meio de um turno.",
        "As definições fixam-se por SHA-256 do nome, da descrição e do esquema (`tutor_agent::mcp::pins`), em ~/.config/dxtutor/mcp-pins.json — nunca no projecto. Aprovar (`codev_mcp_approve_tool`) só aceita a definição que viste (o hash) e fica no registo de auditoria.",
      ],
      tips: ["Uma descrição de ferramenta é uma instrução para o modelo: lê-a antes de aprovar. Uma que manda ler ficheiros ou enviar dados para fora não é para aprovar.", "Um servidor com o seu próprio cabeçalho Authorization (com ${env:NOME}) não usa OAuth."],
      limits: ["Só na app desktop.", "Uma ferramenta que desaparece do servidor simplesmente sai; a aprovação vale para as conversas novas (uma conversa retomada continua sem a ferramenta retida)."],
      covers: ["codev:hx-mcp-signin", "codev:hx-mcp-signout", "codev:hx-mcp-review"],
    },
  ],
};
