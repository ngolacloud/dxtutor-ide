/* Notas para a documentação oficial da feature lsp (o editor ligado ao servidor de linguagem). Por agora
   o aviso de servidor em falta, os overrides do registo (LSP P2) e os recursos dos servidores (LSP P6); as outras acções (hover, F12, rename,
   completion…) entram aqui quando forem documentadas. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const LSP_NOTES: FeatureNotes = {
  id: "lsp",
  title: "Servidor de linguagem (LSP)",
  summary:
    "Na app desktop, o editor fala com o servidor de linguagem de cada ficheiro (rust-analyzer, typescript-language-server, pyright, gopls, jdtls…) para os diagnósticos ao vivo, o hover, o «ir para a definição», o rename e o completion. Que linguagem é cada ficheiro (pela extensão, sem distinguir maiúsculas, pelo nome inteiro como `Dockerfile` e `Makefile`, ou pelo shebang) e que servidor a serve diz um só ficheiro de dados, `languages/registry.json`, lido pelo editor e pelo backend. O teu `lsp.json` e o `.dxtutor/lsp.json` de cada projecto acrescentam linguagens e servidores e mudam o comando, os argumentos e as definições de cada servidor; o comando que um projecto pede só corre depois de o aprovares. Quando o servidor não está instalado, o editor diz qual falta e ajuda a instalá-lo. Os servidores não ficam a gastar a máquina: um servidor sem ficheiros abertos pára sozinho ao fim de algum tempo, há um limite de servidores ao mesmo tempo, e a paleta mostra os que estão a correr, com o registo de cada um.",
  code: [
    "languages/registry.json",
    "crates/tutor-eval/src/langreg.rs",
    "crates/tutor-eval/src/lspconf.rs",
    "ui-app/src/features/lsp/application/overrides.ts",
    "ui-app/src/features/lsp/ui/config-view.ts",
    "docs/lsp/overrides.md",
    "ui-app/src/features/lsp/domain/registry.ts",
    "ui-app/src/features/lsp/application/lsp-client.ts",
    "ui-app/src/features/lsp/domain/server-status.ts",
    "src-tauri/src/lsp.rs",
    "src-tauri/src/lsp/lifecycle.rs",
    "ui-app/src/features/lsp/application/servers.ts",
    "ui-app/src/features/lsp/ui/servers-view.ts",
    "ui-app/src/features/panel/domain/lsp-log.ts",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Servidor de linguagem em falta: Copiar e Instalar",
      where: ["faixa amarela no topo do ficheiro «No … language server»"],
      what: "Mostra o servidor que falta e o comando para o instalar. «Copy» copia o comando; «Install» corre-o num terminal com a tua shell de login (o node do nvm, o go, o dotnet, o rustup), depois de aprovares, e liga o servidor quando acaba.",
      howTo: [
        "Abre um ficheiro da linguagem; se faltar o servidor, aparece a faixa com o comando.",
        "«Install»: confirma o comando exacto no diálogo de aprovação; a instalação corre no painel Terminal.",
        "Quando termina bem, a faixa sai e o editor passa a ter diagnósticos, hover e definição.",
        "Prefere instalar à mão? «Copy» e cola no teu terminal. «Dismiss» esconde a faixa nesta sessão.",
      ],
      flow: [
        "O backend diz se o servidor existe (`lsp_server_status`): procura-o como o registo de linguagens manda (variável de ambiente, PATH da shell de login e da app, pastas conhecidas; o rust-analyzer só de uma toolchain do rustup ou um binário verdadeiro, nunca o proxy do rustup). A regra do aviso está em `domain/server-status.ts`; o nome da linguagem e a instrução de instalação vêm do registo.",
        "«Install» só existe quando a instalação é um comando (npm, go install, dotnet tool, rustup) e esse comando é, letra a letra, um dos permitidos no código (`RUNNABLE`); para jdtls, clangd, sourcekit-lsp e kotlin-language-server é uma instrução para seguir.",
        "Aprovação partilhada (`app/approval.ts`) com o comando e onde corre → registo de auditoria (`audit_record`, acção `lsp.install`) → terminal de tarefa (PTY com a shell de login, na pasta aberta) → código de saída.",
        "Saída 0: esquece o estado em cache, volta a perguntar ao backend e arranca o servidor no ficheiro aberto.",
      ],
      tips: [
        "Um erro de permissões no `npm install -g` costuma querer dizer que o node não é o do nvm: `nvm use --lts` (ou `npm config set prefix ~/.npm-global`) e volta a carregar em «Install».",
        "Se instalou numa pasta nova do PATH e o dxtutor não o encontra, reinicia a app para ela ler o PATH novo.",
      ],
      limits: ["Só na app desktop com uma pasta aberta. Sem auditoria possível, não instala."],
      covers: ["lsp:notice-copy", "lsp:notice-install"],
    },
      {
      title: "As tuas definições de servidores de linguagem (lsp.json)",
      where: ["paleta: «LSP: Open User Language Server Settings (lsp.json)»", "faixa de servidor em falta: «Configure…»"],
      what: "Abre o teu `lsp.json` (na pasta de configuração do dxtutor, vale para todas as pastas) num editor próprio. Lá acrescentas uma linguagem e o seu servidor, ou mudas o comando, os argumentos ou as definições de um servidor embutido. Gravar aplica logo: os servidores afectados reiniciam, sem reiniciar a app.",
      howTo: [
        "Paleta (Ctrl+Shift+P) → «LSP: Open User Language Server Settings». Se o ficheiro ainda não existe, abre com um modelo comentado.",
        "Escreve só o que mudas: `{ \"servers\": [ { \"id\": \"rust\", \"settings\": { \"rust-analyzer\": { \"check\": { \"command\": \"clippy\" } } } } ] }`.",
        "«Save» (ou Ctrl+S). Se o ficheiro tiver um erro, fica gravado mas ignorado, e o editor diz qual é e onde.",
      ],
      flow: [
        "`lsp_config_file(\"user\")` dá o texto (ou o modelo `lspconf::USER_TEMPLATE`); `lsp_user_config_save` grava SÓ esse ficheiro (o caminho decide-o o backend: `<config da app>/lsp.json`) e relê o registo.",
        "A junção é do Rust (`tutor_eval::langreg::apply_overlay`): uma entrada com um id conhecido muda só os campos que dá (`settings` e `initOptions` juntam-se chave a chave; `null` repõe o valor por omissão); um id novo é uma entrada inteira. O resultado passa pelas mesmas regras do registo embutido; se falhar, o ficheiro inteiro é ignorado.",
        "Os servidores a correr cujo arranque mudou reiniciam e recebem os ficheiros abertos; os que só mudaram de definições recebem `workspace/didChangeConfiguration`. O editor ouve `lsp://config` e revê o ficheiro aberto.",
        "O teu ficheiro é de confiança: os comandos dele correm sem pedir aprovação.",
      ],
      tips: ["Aceita comentários (`//`, `/* */`) e vírgulas no fim. A referência dos campos está em `docs/lsp/overrides.md`."],
      limits: ["Só na app desktop. O cliente de um pedido só (o outline do agente) continua com o registo embutido."],
      covers: ["lsp:cmd-user-config", "lsp:notice-configure"],
    },
    {
      title: "As definições do projecto (.dxtutor/lsp.json)",
      where: ["paleta: «LSP: Open Project Language Server Settings (.dxtutor/lsp.json)»"],
      what: "Abre o `.dxtutor/lsp.json` da pasta aberta num separador (criado com um modelo comentado, se não existe). Vai com o repositório: serve para a equipa partilhar as definições dos servidores do projecto.",
      howTo: [
        "Paleta → «LSP: Open Project Language Server Settings». Escreve no mesmo formato do teu `lsp.json`.",
        "O autosave grava-o; em 2 segundos o dxtutor relê-o e aplica-o.",
        "Um servidor novo, ou um que o projecto põe a correr com outro comando, espera pela tua aprovação. As definições (`settings`) e as `initOptions` do projecto também: até as aprovares, o servidor corre com as tuas.",
      ],
      flow: [
        "Ordem: o registo embutido → o teu `lsp.json` → o `.dxtutor/lsp.json` do projecto (`tutor_eval::lspconf::Effective::load`). Cada ficheiro junta-se e valida-se sozinho: um inválido é ignorado inteiro e os de baixo ficam como estavam.",
        "O backend vê as mudanças pela data e o tamanho dos ficheiros (de 2 em 2 segundos) e reinicia só os servidores afectados.",
      ],
      limits: ["Um ficheiro com mais de 512 KiB é recusado."],
      covers: ["lsp:cmd-project-config"],
    },
    {
      title: "Aprovar o comando e as definições que um projecto pede",
      where: ["faixa no topo do ficheiro «… is waiting for your approval» → «Review…»", "a configuração efectiva → «Review…»"],
      what: "Um projecto clonado pode trazer um `.dxtutor/lsp.json` que acrescenta um servidor, muda o programa, os argumentos, o resolvedor, as pastas de procura ou a variável de ambiente de um servidor, ou lhe dá `settings`/`initOptions` (que podem pôr o servidor a correr comandos, como o `check.overrideCommand` do rust-analyzer). Com outro arranque, o servidor não arranca até aprovares o comando EXACTO; só com definições, arranca com as tuas e as do projecto só se aplicam depois de as aprovares.",
      howTo: [
        "Abre um ficheiro da linguagem: a faixa diz o servidor e o que espera (o comando, ou as definições).",
        "«Review…» abre o diálogo de aprovação com o programa (caminho completo), os argumentos, a pasta onde corre, as definições/initOptions do projecto e o que substituem, o ficheiro que o pediu e o que mudou. Se o programa estiver dentro da pasta do projecto, o diálogo di-lo.",
        "Aprova para o servidor arrancar (ou receber as definições do projecto); recusa e nada do que o projecto pediu corre (podes rever outra vez mais tarde).",
      ],
      flow: [
        "A regra vive no Rust: `lspconf::approval_request` decide se um servidor precisa de aprovação; `lsp.rs::gate` não o lança (arranque mudado) ou lança-o com as definições de confiança (`Effective::trusted_config`), e `lsp_server_status` devolve o pedido (`blocksStart`, `config`).",
        "`lsp_approve_server` confere o hash mostrado (se o comando mudou entretanto, recusa), grava a decisão no registo de auditoria ANTES de tudo (`audit_record`, acção `lsp.server.approve`; sem auditoria não aprova) e guarda a aprovação em `<config da app>/lsp-trusted.json` (0600), nunca no projecto.",
        "A aprovação fica presa ao projecto, ao servidor, ao programa encontrado, aos campos de arranque, às definições e initOptions e, para um programa dentro do projecto, ao conteúdo dele: se algum mudar, volta a pedir. Aprovadas as definições, o servidor a correr recebe-as (`didChangeConfiguration`; initOptions novas reiniciam-no).",
      ],
      tips: ["Os marcadores de raiz, o nome e as extensões não correm nada: não pedem aprovação. O teu `lsp.json` é de confiança."],
      covers: ["lsp:notice-review", "lsp:effective-review"],
    },
    {
      title: "Ver a configuração efectiva",
      where: ["paleta: «LSP: Show Effective Language Server Configuration»"],
      what: "Mostra, para cada servidor, a entrada que o dxtutor usa depois de juntar tudo: de onde veio (embutido, utilizador, projecto), as linguagens que serve, as definições, e se espera por aprovação. Diz também o estado dos dois ficheiros de overrides.",
      howTo: [
        "Paleta → «LSP: Show Effective Language Server Configuration». Abre no servidor do ficheiro aberto.",
        "Escolhe outro servidor na lista (os marcados com * foram mudados por um override).",
      ],
      flow: ["`lsp_config(root)` relê os ficheiros que mudaram e devolve o registo efectivo, os relatórios dos ficheiros e as aprovações em falta."],
      covers: ["lsp:cmd-effective"],
    },
    {
      title: "Aviso de definições ignoradas",
      where: ["cartão vermelho no canto «Language server settings ignored»"],
      what: "Quando o teu `lsp.json` ou o `.dxtutor/lsp.json` têm um erro, o dxtutor ignora esse ficheiro (os de baixo continuam a valer) e diz qual é e o que está errado, com o sítio (`servers[2] (rust): unknown field comand`, `line 4 column 3`).",
      howTo: ["«Open» abre o ficheiro para o corrigires; ao gravar, o cartão sai sozinho.", "«Dismiss» esconde-o até o erro mudar."],
      flow: ["Os erros vêm de `lsp_config` (`userFile`/`projectFile.errors`); o aviso só se repete quando os erros mudam."],
      covers: ["lsp:config-errors-open"],
    },
    {
      title: "Ver os servidores de linguagem a correr",
      where: ["paleta: «LSP: Show Running Language Servers»"],
      what: "Lista os servidores de linguagem que estão a correr: o nome, a pasta, o PID, o estado (a arrancar, a indexar, pronto), os ficheiros abertos em cada um ou há quanto tempo está inactivo e quando vai parar, e a memória que gasta. «Restart» reinicia um servidor, «Stop» pára-o e «Show log» abre o registo dos servidores no painel Output.",
      howTo: [
        "Paleta (Ctrl+Shift+P) → «LSP: Show Running Language Servers». A lista actualiza-se sozinha enquanto está aberta.",
        "Um servidor encravado ou a gastar memória a mais: «Restart» pára-o e arranca-o de novo, com os ficheiros que tens abertos.",
        "Não precisas de um servidor agora: «Stop» pára-o já. Ele volta a arrancar sozinho quando um ficheiro da linguagem dele precisar.",
        "«Show log» abre o canal «Language servers» do Output: o que cada servidor escreveu (erros, avisos) e quando arrancou, parou e porquê.",
      ],
      flow: [
        "`lsp_servers` devolve a lista (`src-tauri/src/lsp/lifecycle.rs::list`); a memória é a do servidor e dos processos que ele arrancou, lida do `/proc` (só em Linux). O ecrã (`ui/servers-view.ts`) relê-a de 2 em 2 s e logo que o backend avisa que mudou (`lsp://servers`).",
        "«Stop» (`lsp_server_stop`) e «Restart» (`lsp_server_restart`) param o servidor como o protocolo pede: `shutdown`, depois `exit`, e o processo é recolhido; se não sair a tempo (2 s + 1 s), é morto com o que arrancou (o grupo de processos dele).",
        "O registo de cada servidor (stderr e as mensagens `logMessage` de erro, aviso e informação) fica no backend num anel limitado (500 linhas, 256 KiB), mascarado pelas regras de protecção de dados antes de sair; chega ao Output pelo evento `lsp://log` e lê-se de novo com `lsp_server_log` (por exemplo, depois de mudares de língua).",
      ],
      tips: ["Um servidor que morre sozinho também aparece no registo, com o código de saída, e arranca de novo no pedido seguinte."],
      limits: ["A memória só se mostra em Linux.", "Parar um servidor não o desliga: o próximo pedido de um ficheiro da linguagem dele arranca-o outra vez. Para o desligar de vez, usa `\"server\": null` na linguagem, no teu `lsp.json`."],
      covers: ["lsp:cmd-servers", "lsp:servers-restart", "lsp:servers-stop", "lsp:servers-log"],
    },
    {
      title: "Servidores inactivos e o limite de servidores",
      where: ["automático", "o teu `lsp.json`: «resources»"],
      what: "Fechar um ficheiro avisa o servidor (`didClose`). Um servidor sem ficheiros abertos e sem uso durante 10 minutos pára sozinho, e correm no máximo 6 ao mesmo tempo: quando arranca um a mais, pára o usado há mais tempo que não tenha ficheiros abertos. Um servidor com ficheiros abertos nunca é parado por isto: se todos os que restam têm ficheiros abertos, o editor diz-to. Fechar a pasta (ou abrir outra) e sair do dxtutor param os servidores dela.",
      howTo: [
        "Não tens de fazer nada: fecha os separadores de que não precisas e o servidor dessa linguagem acaba por parar; volta a arrancar quando abrires um ficheiro dela.",
        "Para mudar os tempos, no teu `lsp.json` (paleta → «LSP: Open User Language Server Settings»): `\"resources\": { \"idleMinutes\": 10, \"maxServers\": 6 }`. `idleMinutes` 0 deixa os servidores inactivos a correr até fechares a pasta; `maxServers` vai de 1 a 32.",
      ],
      flow: [
        "Fechar um separador (bus `editor:tab-closed`), apagar ou renomear um ficheiro aberto (`workspace:changed`) → `lsp_did_close` → `didClose` aos servidores que o têm aberto, e o backend esquece-o.",
        "De 30 em 30 s o backend procura servidores sem ficheiros abertos e sem uso há `idleMinutes`; ao arrancar um servidor, aplica o limite (`lifecycle::select_stops`). A decisão e a entrega de um servidor a um pedido acontecem com o mesmo lock, por isso um servidor parado nunca recebe um pedido: o pedido seguinte arranca outro, que só é usado depois do `initialize`.",
        "Abrir outra pasta (`dx:workspace`) → `lsp_folder_closed` com a anterior; sair da app → todos param e são recolhidos antes de ela fechar.",
        "Os `resources` só se lêem do TEU `lsp.json` (o de um projecto não os pode mudar: é um erro e o ficheiro é ignorado).",
      ],
      limits: ["O limite não pára um servidor com ficheiros abertos: com muitas linguagens abertas ao mesmo tempo, pode haver mais servidores do que o limite (o editor avisa)."],
      covers: ["lsp:resources"],
    },
  ],
};
