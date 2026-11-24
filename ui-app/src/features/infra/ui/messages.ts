/* Textos de Infra (runtime, Kubernetes, ambientes) (ADR-0004, U6c). Os valores são os que o motor de tradução produzia para o texto que estava
   no markup; dados puros, sem DOM. */
import type { Messages } from "../../../app/i18n";

export const INFRA_MESSAGES = {
  en: {
    deployToKubernetes: "Deploy to Kubernetes",
    detach: "Detach",
    attachThisProjectTo: "Attach this project to a container built from its own context: languages, ports, the runtime socket and your kubeconfig.",
    attachProjectToA: "Attach project to a container",
    containers: "Containers",
    connectTheSocketTo: "Connect the socket to list containers.",
    stopTheStack: "■ Stop the stack",
    runTheStack: "▶ RUN the stack",
    redeploy: "⎈ Redeploy",
    deleteFromCluster: "Delete from cluster",
    remoteHosts: "Remote hosts",
    remove: "Remove",
    clear: "Clear",
  },
  ptAO: {
    deployToKubernetes: "Deploy em Kubernetes",
    detach: "Desanexar",
    attachThisProjectTo: "Liga este projecto a um contentor construído a partir do seu próprio contexto: linguagens, portas, o socket do runtime e o teu kubeconfig.",
    attachProjectToA: "Ligar este projecto a um contentor",
    containers: "Contentores",
    connectTheSocketTo: "Liga o socket para listar os contentores.",
    stopTheStack: "■ Parar a stack",
    runTheStack: "▶ RUN — correr a stack",
    redeploy: "⎈ Voltar a fazer deploy",
    deleteFromCluster: "Apagar do cluster",
    remoteHosts: "Hosts remotos",
    remove: "Remover",
    clear: "Limpar",
  },
} satisfies Messages<string>;
