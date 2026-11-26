/* Notas para a documentação oficial do deploy guiado (r23 F4c2). Ver `app/notes/types.ts`. */
import type { FeatureNotes } from "../../app/notes/types";

export const DEPLOY_NOTES: FeatureNotes = {
  id: "deploy",
  title: "Deploy guiado — staging e produção",
  summary:
    "Staging e produção mudam-se só pelo deploy guiado: oito passos (destino, identidade, segredos, verificações, estratégia, aprovar, rollout, registo), cada verificação com o seu estado, e o bloqueio decidido no backend. Os segredos não viajam com os manifestos: o cluster lê-os do Vault.",
  code: ["crates/tutor-platform/src/deploy.rs", "src-tauri/src/commands/deploy.rs", "crates/tutor-board/src/project/deploys.rs", "ui-app/src/features/deploy/"],
  updated: "2026-11-26",
  actions: [
    {
      title: "Planear um deploy",
      where: ["paleta: «Deploy: Guided Deploy to Staging or Production»", "pane Infra / Environments › «Promote…» e «Redeploy»"],
      what: "Verifica tudo antes de mudar o que quer que seja: a versão (o commit em HEAD, sem alterações por commitar), SBOM, assinatura, vulnerabilidades, segredos, drift do IaC, a política de admissão do cluster, SLO, janela de mudança, migrações e, em produção, a saúde de staging e um segundo aprovador.",
      howTo: [
        "Escolhe o cluster de cada ambiente em Environments.",
        "Abre o deploy e escolhe Staging ou Production; «Check again» repete as verificações.",
        "Clica numa verificação para ver o detalhe e como instalar o que falta.",
      ],
      flow: [
        "`deploy_plan` lê os manifestos de `deploy/k8s` (os `Secret` ficam de fora: o cluster lê-os do Vault), corre cada verificação e devolve os comandos exactos.",
        "O segredo vê-se só pelo nome no namespace e pelos metadados no Vault.",
        "Configuração opcional em `.dxtutor/deploy.json`: manifestos, pasta de IaC e caminho do Vault de cada ambiente, política do cosign, janelas de mudança.",
      ],
      limits: ["Só rolling update; canary e blue-green ainda não.", "O `dx-secret-check` aparece «não disponível» até a imagem existir."],
      covers: ["deploy:plan", "deploy:toggle", "cmd:Deploy: Guided Deploy to Staging or Production"],
    },
    {
      title: "Excepções com motivo",
      where: ["Deploy › Verificações › «Waive…»"],
      what: "Em produção, uma verificação «não instalada» ou «não ligada» bloqueia, a não ser que lhe dês uma excepção com motivo. Uma verificação falhada nunca tem excepção, nem o segundo aprovador ou a saúde de staging.",
      howTo: ["Carrega «Waive…» na verificação e escreve porquê; «Undo» tira a excepção."],
      flow: ["As excepções vão com o deploy para o registo de auditoria; o backend volta a verificá-las no rollout."],
      covers: ["deploy:waive", "deploy:unwaive"],
    },
    {
      title: "Fazer o deploy",
      where: ["Deploy › Aprovar › «Deploy…»"],
      what: "Aplica os manifestos (sem os `Secret`), anota a versão e espera pelo rollout de cada Deployment, com as linhas à vista; no fim fica o registo do deploy.",
      howTo: ["Quando nada bloqueia, carrega «Deploy…» e aprova os comandos.", "Em produção escreve um motivo e a palavra «production».", "O segundo aprovador é um PR fundido com este commit, aprovado por outra pessoa no GitHub."],
      flow: [
        "O backend verifica outra vez: excepções, HEAD, manifestos e um plano com menos de 30 minutos.",
        "Vai ao registo de auditoria antes e com o resultado; o registo do deploy alimenta a coluna «environments» do ciclo de vida do commit e o histórico em Environments.",
      ],
      covers: ["deploy:rollout"],
    },
  ],
};
