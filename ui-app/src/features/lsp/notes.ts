/* Notas para a documentação oficial da feature lsp (o editor ligado ao servidor de linguagem). Por agora
   o aviso de servidor em falta e os overrides do registo (LSP P2); as outras acções (hover, F12, rename,
   completion…) entram aqui quando forem documentadas. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const LSP_NOTES: FeatureNotes = {
  id: "lsp",
  title: "Servidor de linguagem (LSP)",
  summary:
    "Na app desktop, o editor fala com o servidor de linguagem de cada ficheiro (rust-analyzer, typescript-language-server, pyright, gopls, jdtls…) para os diagnósticos ao vivo, o hover, o «ir para a definição», o rename e o completion. Que linguagem é cada ficheiro (pela extensão, sem distinguir maiúsculas, pelo nome inteiro como `Dockerfile` e `Makefile`, ou pelo shebang) e que servidor a serve diz um só ficheiro de dados, `languages/registry.json`, lido pelo editor e pelo backend. O teu `lsp.json` e o `.dxtutor/lsp.json` de cada projecto acrescentam linguagens e servidores e mudam o comando, os argumentos e as definições de cada servidor; o comando que um projecto pede só corre depois de o aprovares. Quando o servidor não está instalado, o editor diz qual falta e instala-o depois de aprovares o comando exacto, para a pasta do próprio dxtutor.",
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
    "crates/tutor-eval/src/lspinstall.rs",
    "src-tauri/src/commands/lsp_install.rs",
    "src-tauri/src/lsp.rs",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Servidor de linguagem em falta: maneiras de instalar, Copiar, Instalar e Verificar outra vez",
      where: ["faixa amarela no topo do ficheiro «No … language server»"],
      what: "Mostra o servidor que falta e as maneiras de o instalar nesta máquina (npm, pip, pipx, go, cargo, dotnet, gem, rustup, uma release do GitHub, ou apt/brew), cada uma com o comando EXACTO. «Install» corre a maneira escolhida depois de aprovares: num terminal, para a pasta do próprio dxtutor, ou — para uma release — o dxtutor descarrega-a e confere o SHA-256. Quando acaba bem, a faixa sai e o servidor arranca, sem reiniciar a app.",
      howTo: [
        "Abre um ficheiro da linguagem; se faltar o servidor, aparece a faixa com a maneira proposta e o seu comando.",
        "Com mais de uma maneira, escolhe outra na lista (as que não servem nesta máquina aparecem desactivadas, com o motivo: o gestor que falta, ou nenhuma versão da release para ela).",
        "«Install»: confirma o comando exacto no diálogo de aprovação; a instalação corre no painel Terminal (ou, numa release, o dxtutor descarrega e confere-a).",
        "apt e Homebrew são gestores do sistema (o apt pede sudo): o dxtutor só mostra o comando. «Copy», corre-o no teu terminal e depois «Check again».",
        "«Check again» volta a procurar o servidor (depois de o instalares à mão). «Dismiss» esconde a faixa nesta sessão.",
      ],
      flow: [
        "O backend diz se o servidor existe (`lsp_server_status`, que agora diz também onde o encontrou: `foundAt`, `managed`): procura-o primeiro na variável de ambiente do registo, depois na pasta do dxtutor (`<dados da app>/lsp-servers/<servidor>`), depois como o registo manda (PATH da shell de login e da app, pastas conhecidas; o rust-analyzer nunca como o proxy do rustup).",
        "As maneiras vêm de `lsp_install_plan`: o backend lê as receitas (`recipes`) do registo de confiança — o embutido mais o teu `lsp.json`, nunca o `.dxtutor/lsp.json` de um projecto —, procura cada gestor no PATH da shell de login e constrói o comando exacto (`tutor_eval::lspinstall`). A UI nunca compõe um comando.",
        "Gestores do utilizador instalam na pasta do dxtutor: npm `--global --prefix`, pip num venv, pipx/go/gem/dotnet/cargo com as suas opções de pasta; o rustup acrescenta o componente à toolchain.",
        "Aprovação partilhada (`app/approval.ts`) com o comando e onde fica → registo de auditoria (`audit_record`, acção `lsp.install`; sem auditoria não corre) → terminal de tarefa (`sh -c`, com o PATH da shell de login do plano) ou `lsp_install_download` (o id da maneira, nunca um URL) → auditoria do resultado.",
        "Release: o backend descarrega o ficheiro fixado no registo (URL do GitHub e SHA-256), confere o SHA-256 ANTES de desempacotar e, se não confere, não instala nada e deixa o que lá estava.",
        "Sucesso: esquece o estado em cache, volta a perguntar ao backend e arranca o servidor no ficheiro aberto.",
      ],
      tips: [
        "Uma instalação pela faixa não mexe no teu sistema: fica toda em `<dados da app>/lsp-servers`. Para a desfazer, apaga a pasta do servidor.",
        "Uma variável como `DXTUTOR_RUST_ANALYZER` continua a ganhar à pasta do dxtutor.",
      ],
      limits: [
        "Só na app desktop com uma pasta aberta. Sem auditoria possível, não instala.",
        "Um servidor que o projecto acrescenta, ou cujo programa muda, não se instala daqui. Se o teu `lsp.json` troca o programa, dá-lhe as suas `recipes`.",
        "O dxtutor nunca corre `sudo`, nem o apt ou o Homebrew.",
      ],
      covers: ["lsp:notice-copy", "lsp:notice-install", "lsp:notice-way", "lsp:notice-recheck"],
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
  ],
};
