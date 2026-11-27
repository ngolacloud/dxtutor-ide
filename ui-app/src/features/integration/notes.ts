/* Notas para a documentação oficial — o painel «Rever e integrar» (Multi Co-Dev, fase 4). Português de Angola
   (pré-AO90), para o utilizador final; os identificadores técnicos ficam no «Fluxo» e no `covers`. */
import type { FeatureNotes } from "../../app/notes/types";

export const INTEGRATION_NOTES: FeatureNotes = {
  id: "integration",
  title: "Rever e integrar (a porta de integração do Multi Co-Dev)",
  summary:
    "O trabalho de um Co-Dev só entra no ramo por omissão quando três condições valem ao mesmo tempo, para o código tal como está agora: as verificações obrigatórias do projecto passaram exactamente na árvore que ia entrar, o revisor Co-Dev confirmou cada critério de aceitação com evidência, e o responsável registou a aprovação funcional para os critérios actuais. O painel mostra as três com a sua evidência e só deixa integrar quando todas valem — e quem decide é o backend, outra vez, no momento do clique.",
  code: [
    "ui-app/src/features/integration/",
    "src-tauri/src/codev_review.rs",
    "src-tauri/src/commands/codev_review.rs",
    "crates/tutor-board/src/project/integration.rs",
    "crates/tutor-eval/src/gitwork/integrate.rs",
  ],
  updated: "2026-11-27",
  actions: [
    {
      title: "Abrir o painel «Rever e integrar»",
      where: ["Faixa «Co-Devs» › botão ⇥ de uma issue com ramo", "Project › painel da issue › secção «Integration» › «Review & integrate…»"],
      what:
        "Mostra a porta de integração da issue: o ramo e quantos commits tem que o ramo por omissão não tem, e as três condições — cada uma com um ✓ ou um ✕ e o porquê — e, por baixo, porque é que «Integrate» está desligado.",
      howTo: [
        "Na faixa «Co-Devs», carrega no ⇥ do cartão da issue (ou de uma worktree guardada); ou abre a issue no Project e carrega em «Review & integrate…».",
        "⟳ relê a porta; Esc ou ✕ fecham o painel.",
      ],
      flow: [
        "`codev_review_state` (só leitura) lê a revisão mais recente da issue, as pontas de agora (o ramo que a pasta do projecto tem — o ramo por omissão — e o ramo da issue), as verificações obrigatórias, os critérios e a aprovação funcional, e pergunta a porta (`tutor_board::project::integration::gate`).",
        "Cada condição vem como um código (por exemplo `stale_head`: o ramo da issue andou desde a revisão) que o painel diz por palavras; um código que o painel não conhece nunca aparece como «ok».",
        "O comando de cada botão (pedir a revisão, integrar) vem do backend: o painel mostra-o no diálogo de aprovação tal como vai correr.",
      ],
      tips: ["Alterações por commitar na worktree do Co-Dev não entram em nenhuma revisão: o painel avisa. Faz «Commit» na faixa antes de pedir a revisão."],
      covers: ["codev:codevs-integrate", "pj-integration", "integration:close", "integration:refresh"],
    },
    {
      title: "Pedir revisão",
      where: ["Painel «Rever e integrar» › «Request review»"],
      what:
        "Funde o ramo da issue na ponta actual do ramo por omissão numa worktree temporária, corre lá as verificações obrigatórias e as regras de arquitectura e, se tudo passar, pede ao revisor Co-Dev que confirme os critérios de aceitação um a um, com evidência. Nada muda nos teus ramos.",
      howTo: [
        "Carrega em «Request review»: o diálogo de aprovação mostra os comandos exactos (o merge, a worktree temporária e cada verificação, com a pasta onde corre). Aprova.",
        "Acompanha os passos no painel («A correr tests…», «O revisor Co-Dev está a ler a alteração…»); «Stop» pára a revisão.",
        "No fim vês cada verificação (comando, exit, tempo e o fim da saída, com os segredos mascarados) e a tabela do revisor: critério, cumprido / não cumprido / por esclarecer, e a evidência (ficheiros e linhas, testes, saída).",
        "Sem verificações obrigatórias, o painel oferece o comando de testes detectado na pasta («Use … as the mandatory check»); senão, define-as nas definições do Project.",
      ],
      flow: [
        "`codev_review_request` corre só o plano aprovado (se as pontas ou as verificações mudaram entretanto, recusa e mostra o plano novo) e regista-o no registo de auditoria antes de correr (`review.request`, sem auditoria não corre) e com o resultado.",
        "O candidato é calculado sem tocar em nada (`git merge-tree --write-tree`) e guardado como um commit de merge que nenhum ramo aponta ainda (`git commit-tree`, com `refs/dxtutor/review/<issue>` para não se perder); um conflito diz os ficheiros e acaba aí.",
        "A worktree temporária fica em `<dados da app>/integration/<repositório>/<issue>`, destacada nesse commit, e sai no fim. As verificações correm lá, uma a uma, todas (mesmo depois de uma falhar), com o ambiente da shell de login; o fim da saída é mascarado.",
        "As regras do arquitecto (`.dxtutor/architecture.toml`) correm sobre cada ficheiro que o candidato muda; o secret scan do que ele traz também corre (mostrado agora, exigido ao integrar).",
        "Só com tudo verde corre o revisor: um agente com ferramentas só de leitura (`read`, `glob`, `grep`) na worktree temporária e a ferramenta `review_verdict`; recebe o diff, os critérios, a DoD e os resultados das verificações, não o repositório inteiro. A evidência que dá é verificada contra o candidato (o ficheiro existe e tem essas linhas, o teste existe, a verificação correu); o que não bate volta-lhe para corrigir. Corre com o provedor e o modelo do Co-Dev.",
        "Tudo fica na base do Project (`integration_reviews`, migração 19) com as pontas, o commit e a árvore exactos.",
      ],
      limits: [
        "As verificações correm numa árvore acabada de sair do git: têm de instalar o que precisam (por exemplo `npm ci && npm test`).",
        "Se uma verificação falhar ou uma regra partir, o revisor não corre (não gasta tokens numa alteração que não pode entrar).",
        "O revisor nunca age sozinho: só corre quando pedes a revisão.",
      ],
      covers: ["integration:request", "integration:cancel", "integration:detected"],
    },
    {
      title: "Integrar",
      where: ["Painel «Rever e integrar» › «Integrate»"],
      what:
        "Avança o ramo por omissão para exactamente o commit revisto (fast-forward), só quando as três condições valem para as pontas de agora. Nunca faz push, nunca força.",
      howTo: [
        "Com os três ✓, carrega em «Integrate»: o diálogo de aprovação mostra o comando exacto (`git -C … merge --ff-only <commit>`, e a remoção da worktree do Co-Dev se estiver limpa). Aprova.",
        "Se o secret scan encontrar algo no que a alteração traz, pede um motivo (fica registado) antes de continuar.",
        "No fim, a issue anda no Project pelas regras do método (para Done se a DoD estiver cumprida; senão fica e a actividade diz porquê) e o Co-Dev da issue fecha.",
      ],
      flow: [
        "`codev_review_integrate` pergunta a porta outra vez com os factos lidos nesse momento; com uma condição a falhar, recusa e diz qual. Depois confirma que o comando é o aprovado e regista `review.integrate` no registo de auditoria antes (sem auditoria não corre) e com o resultado.",
        "Tira um undo snapshot (o «Undo» do Commit Graph repõe o ramo), corre o secret scan do que o commit revisto traz e faz `git merge --ff-only` na pasta do projecto: a árvore de trabalho acompanha; alterações por commitar que o git sobreporia param tudo e nada muda.",
        "O Project liga o commit à issue, regista «integrada» e anda com ela passo a passo pelas regras normais (WIP, test-first, DoD), sem excepções; onde uma regra recusa, fica com uma entrada «held».",
        "Pelas regras da fase 3: a sessão Co-Dev aberta da issue fecha (as reservas voltam e a worktree sai se estiver limpa); sem sessão, a worktree sai se estiver limpa (auditado). O ramo fica.",
      ],
      limits: [
        "O ramo por omissão é o que a pasta do projecto tem em uso; se mudares de ramo depois da revisão, a revisão deixa de valer.",
        "Se o ramo da issue, o ramo por omissão, as verificações ou os critérios mudarem depois da revisão, ela deixa de valer: pede outra. Uma aprovação funcional dada para outros critérios também não vale.",
      ],
      covers: ["integration:integrate"],
    },
  ],
};
