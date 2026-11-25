/* Textos do separador Ops (A9, docs/v2/UI-AUDIT.md item 10) — nascem com chave (ADR-0004, U6b): en + ptAO. */
import type { Messages } from "../../../app/i18n";

export const OPS_MESSAGES = {
  en: {
    tab: "Ops", title: "Ops", sub: "Read-only by default. Anything that changes infrastructure is a command shown in full, approved by you, and run in a terminal.",
    iac: "Infrastructure as code", noIac: "No .tf files in this project.", noTool: "Install OpenTofu (tofu) or Terraform to plan.", plan: "Plan", drift: "Drift", planning: "Planning…",
    summary: "+{a} to add · ~{c} to change · −{d} to destroy", noChanges: "No changes.", knownAfter: "(known after apply)", sensitive: "(sensitive)", driftTitle: "Changed outside the code",
    apply: "Apply in a terminal…", applyWhat: "Apply {n} change(s) in {dir}", askPlan: "✦ Explain this plan", askIac: "✦ Propose a change",
    kube: "Kubernetes", noKube: "Connect a cluster in the Infra pane (kubeconfig, context, namespace) — this tab reads the same one.", loading: "Reading…", reload: "Reload",
    pods: "Pods", deployments: "Deployments", services: "Services", events: "Events", none: "None.", restarts: "{n} restart(s)",
    logs: "Logs", exec: "Shell", del: "Delete", history: "History", scale: "Scale…", restart: "Restart", portForward: "Port-forward…", rollback: "Roll back to this…", why: "✦ Why?",
    current: "current", execWhat: "Open a shell in pod {pod}", restartWhat: "Restart the pods of {d}", deletePodWhat: "Delete pod {pod} (its controller starts another)",
    undoWhat: "Roll {d} back to revision {r}", scaleWhat: "Scale {d} to {n} replica(s)", scalePh: "Replicas for {d}", badReplicas: "Give a whole number of replicas (0–500).",
    portWhat: "Forward localhost:{l} to service {s}", portPh: "Local port for {s} (service port {p})", badPort: "Give a port between 1 and 65535.",
    cloud: "Cloud", installed: "installed", notInstalled: "not installed", inventory: "Inventory", noAccount: "no profile/account configured", ranCommands: "Ran: {c}",
    ran: "Sent to the terminal: {c}",
    scopeKube: "context {c} · namespace {n}", scopeIac: "folder {dir} · {tool}",
    askPod: "This pod is in trouble. Explain the likely cause from its state and events, and how to fix it.",
    askPlanText: "Explain this plan: what each change does, what could go wrong, and whether anything is destroyed or replaced.",
    askIacText: "Propose the IaC change this plan needs (as hunks in the .tf files), and say why.",
    needDesktop: "Ops reads the real tools: it needs the desktop app with a folder open.",
  },
  ptAO: {
    tab: "Ops", title: "Ops", sub: "Só leitura por omissão. Tudo o que muda infraestrutura é um comando mostrado por inteiro, aprovado por ti, e corrido num terminal.",
    iac: "Infraestrutura como código", noIac: "Não há ficheiros .tf neste projecto.", noTool: "Instala o OpenTofu (tofu) ou o Terraform para planear.", plan: "Planear", drift: "Drift", planning: "A planear…",
    summary: "+{a} a criar · ~{c} a mudar · −{d} a destruir", noChanges: "Sem alterações.", knownAfter: "(conhecido depois do apply)", sensitive: "(sensível)", driftTitle: "Mudou fora do código",
    apply: "Aplicar num terminal…", applyWhat: "Aplicar {n} alteração(ões) em {dir}", askPlan: "✦ Explicar este plano", askIac: "✦ Propor uma alteração",
    kube: "Kubernetes", noKube: "Liga um cluster no pane Infra (kubeconfig, contexto, namespace) — este separador lê o mesmo.", loading: "A ler…", reload: "Recarregar",
    pods: "Pods", deployments: "Deployments", services: "Serviços", events: "Eventos", none: "Nenhum.", restarts: "{n} reinício(s)",
    logs: "Logs", exec: "Shell", del: "Apagar", history: "Histórico", scale: "Escalar…", restart: "Reiniciar", portForward: "Port-forward…", rollback: "Voltar a esta…", why: "✦ Porquê?",
    current: "actual", execWhat: "Abrir uma shell no pod {pod}", restartWhat: "Reiniciar os pods de {d}", deletePodWhat: "Apagar o pod {pod} (o controlador arranca outro)",
    undoWhat: "Voltar {d} à revisão {r}", scaleWhat: "Escalar {d} para {n} réplica(s)", scalePh: "Réplicas para {d}", badReplicas: "Dá um número inteiro de réplicas (0–500).",
    portWhat: "Encaminhar localhost:{l} para o serviço {s}", portPh: "Porta local para {s} (porta do serviço {p})", badPort: "Dá uma porta entre 1 e 65535.",
    cloud: "Cloud", installed: "instalada", notInstalled: "não instalada", inventory: "Inventário", noAccount: "sem perfil/conta configurados", ranCommands: "Correu: {c}",
    ran: "Enviado para o terminal: {c}",
    scopeKube: "contexto {c} · namespace {n}", scopeIac: "pasta {dir} · {tool}",
    askPod: "Este pod tem um problema. Explica a causa provável a partir do estado e dos eventos, e como o resolver.",
    askPlanText: "Explica este plano: o que faz cada alteração, o que pode correr mal, e se alguma coisa é destruída ou substituída.",
    askIacText: "Propõe a alteração de IaC de que este plano precisa (como hunks nos ficheiros .tf), e diz porquê.",
    needDesktop: "O Ops lê as ferramentas reais: precisa da app desktop com uma pasta aberta.",
  },
} satisfies Messages<string>;
export type OpsKey = keyof typeof OPS_MESSAGES.en;
