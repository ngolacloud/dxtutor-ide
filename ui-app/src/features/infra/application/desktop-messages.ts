/* Textos do motor da Infra que nasceram sem par no motor de tradução (cluster/deploy no desktop) — com chave
   (ADR-0004, U6b): en + ptAO, os valores ptAO iguais aos textos de antes. Ficam fora de `./messages` porque
   esse catálogo é de texto MIGRADO (cada entrada é um par do motor, verificado em tests/i18n.catalogs). A
   porta `copy` do motor aceita as chaves dos dois; a composição junta os dois tradutores. */
import type { Messages } from "../../../app/i18n";

export const INFRA_DESKTOP_ENGINE_MESSAGES = {
  en: {
    k8sNeedsDesktop: "Connecting the cluster needs the desktop app (the real kubectl with your KUBECONFIG)",
    deployReady: "{n} deployment(s) in deploy/k8s, ready to apply to {target}.",
    deployNeedsDesktop: "The deploy needs the desktop app with the folder open (real docker/podman and kubectl).",
    readFail: "{env}: could not read {target} — {error}",
    deployFailed: "{env}: the deploy failed — see the terminal", workloadsFailing: "{env}: {n} workload(s) failing", envAt: "{env} is at {ver}",
    notStarting: "{env}: {name} does not start — {error}",
  },
  ptAO: {
    k8sNeedsDesktop: "Ligar o cluster precisa da app desktop (o kubectl real com o teu KUBECONFIG)",
    deployReady: "{n} deployment(s) em deploy/k8s, prontos a aplicar em {target}.",
    deployNeedsDesktop: "O deploy precisa da app desktop com a pasta aberta (docker/podman e kubectl reais).",
    readFail: "{env}: não consegui ler {target} — {error}",
    deployFailed: "{env}: o deploy falhou — vê o terminal", workloadsFailing: "{env}: {n} workload(s) a falhar", envAt: "{env} está em {ver}",
    notStarting: "{env}: {name} não arranca — {error}",
  },
} satisfies Messages<string>;

export type InfraDesktopKey = keyof typeof INFRA_DESKTOP_ENGINE_MESSAGES.en;
