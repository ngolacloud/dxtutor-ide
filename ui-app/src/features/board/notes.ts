/* Notas para a documentação oficial do quadro (backlog, sprints e kanban). Dados puros (ver
   `app/notes/types.ts`); `npm run docs:notes` escreve-as em `docs/notes/NOTAS.md`. Por agora só
   as acções que criam issues (backlog fase 1: nenhuma issue fica fora de um projecto); as outras
   acções do quadro ganham nota quando mudarem. */

import type { FeatureNotes } from "../../app/notes/types";

export const BOARD_NOTES: FeatureNotes = {
  id: "board",
  title: "Quadro (backlog, sprints e kanban)",
  summary:
    "O backlog da actividade Tasks e o quadro kanban: as issues de cada sprint, que o agente implementa quando as delegas. **Cada issue pertence a um projecto**: o quadro vive com a pasta aberta (gravado por pasta, na app desktop) e, sem pasta, não se criam issues.",
  code: [
    "ui-app/src/features/board.ts",
    "ui-app/src/features/board/application/board-engine.ts",
    "ui-app/src/features/board/domain/persist.ts",
    "src-tauri/src/board.rs",
  ],
  updated: "2026-11-26",
  actions: [
    {
      title: "Nova issue",
      where: ["botão «+ Issue» do quadro", "«+» e «New issue…» do painel Tasks", "paleta: «Projecto: Nova issue…»"],
      what: "Cria uma issue no backlog do projecto aberto a partir de um título (o prefixo «fix:» faz dela uma correcção).",
      howTo: [
        "Abre a pasta do projecto (File → Open Folder…, na app desktop).",
        "Carrega em «+ Issue» (ou usa a paleta) e escreve o título.",
        "A issue entra em «A fazer» no sprint que estás a ver.",
      ],
      flow: [
        "O motor (`board-engine.ts`, `newIssue`) confirma que há uma pasta de projecto aberta (porta `store.project()`).",
        "Sem pasta, mostra o aviso e não cria nada — nenhuma issue fica fora de um projecto.",
        "Com pasta, abre a paleta, cria a issue (`mkIssue`) e o quadro grava-se por pasta (`board_save`).",
      ],
      limits: [
        "No browser não há pastas: o quadro mostra-se, mas não cria issues.",
        "O backend recusa ler ou gravar um backlog sem pasta (já não há um backlog «default»).",
      ],
      covers: ["board:new-issue", "tasks:newIssue", "cmd:Projecto: Nova issue…"],
    },
    {
      title: "Gerar backlog a partir do Studio",
      where: ["botão «Generate backlog & delegate →» do Studio", "botão do quadro vazio", "menu Projecto", "paleta: «Projecto: Gerar backlog a partir do Studio»"],
      what: "Cria as issues dos componentes planeados no Studio (o ADR, um serviço, aplicação web ou esquema por componente, os artefactos de execução e o teste de fumo) e envia-as como propostas para a caixa de entrada do Project.",
      howTo: [
        "Abre a pasta do projecto.",
        "No Studio, acrescenta componentes planeados (contorno tracejado) e corrige os erros do desenho.",
        "Carrega em «Generate backlog & delegate →».",
      ],
      flow: [
        "O motor (`genBacklog`) recusa sem pasta de projecto aberta, com o aviso.",
        "Recusa também um desenho com erros ou sem componentes planeados novos.",
        "Cria as issues (`genBacklogIssues`), marca os componentes como em curso e manda as propostas à caixa de entrada do Project (`projectInbox.propose`).",
      ],
      tips: ["O contexto de cada componente vai na nota da issue, que segue para o agente."],
      covers: ["board:gen-backlog", "studio:genBacklog", "cmd:Projecto: Gerar backlog a partir do Studio"],
    },
  ],
};
