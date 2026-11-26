/* Notas para a documentação oficial da feature lsp (o editor ligado ao servidor de linguagem). Por agora
   só o aviso de servidor em falta; as outras acções (hover, F12, rename, completion…) entram aqui quando
   forem documentadas. Ver `app/notes/types.ts`. */

import type { FeatureNotes } from "../../app/notes/types";

export const LSP_NOTES: FeatureNotes = {
  id: "lsp",
  title: "Servidor de linguagem (LSP)",
  summary:
    "Na app desktop, o editor fala com o servidor de linguagem de cada ficheiro (rust-analyzer, typescript-language-server, pyright, gopls, jdtls…) para os diagnósticos ao vivo, o hover, o «ir para a definição», o rename e o completion. Que linguagem é cada ficheiro (pela extensão, sem distinguir maiúsculas, pelo nome inteiro como `Dockerfile` e `Makefile`, ou pelo shebang) e que servidor a serve diz um só ficheiro de dados, `languages/registry.json`, lido pelo editor e pelo backend. Quando o servidor não está instalado, o editor diz qual falta e ajuda a instalá-lo.",
  code: [
    "languages/registry.json",
    "crates/tutor-eval/src/langreg.rs",
    "ui-app/src/features/lsp/domain/registry.ts",
    "ui-app/src/features/lsp/application/lsp-client.ts",
    "ui-app/src/features/lsp/domain/server-status.ts",
    "src-tauri/src/lsp.rs",
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
  ],
};
