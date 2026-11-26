/* Textos do deploy guiado (r23 F4c2). Texto NOVO, sem par no motor de tradução (ADR-0004, U6b). */
import type { Messages } from "../../../app/i18n";

export const DEPLOY_MESSAGES = {
  en: {
    tab: "Deploy", title: "Deploy", needDesktop: "Deploying needs the desktop app with a folder open.",
    sub: "Every check runs before anything changes. Secrets never travel with the manifests: the cluster reads them from Vault.",
    choose: "Choose where to deploy:", toStaging: "Deploy to Staging", toProduction: "Deploy to Production", replan: "Check again", planning: "Checking…",
    target: "1 · Target", identity: "2 · Identity", secrets: "3 · Secrets", preflight: "4 · Preflight", strategy: "5 · Strategy", approve: "6 · Approve", rollout: "7 · Rollout", record: "8 · Record",
    env: "Environment", cluster: "Cluster", version: "Version", issue: "Issue", manifests: "Manifests", workloads: "Workloads",
    gitUser: "git", clusterUser: "cluster", vaultUser: "Vault", notConnected: "not connected",
    fromVault: "Not applied — the cluster reads them from Vault (Vault Secrets Operator): {l}", noSecretObjects: "The manifests declare no Secret.",
    stOk: "ok", stFailed: "failed", stNotInstalled: "not installed", stNotConnected: "not connected", stSkipped: "skipped", stWarning: "warning",
    blocks: "blocks", waived: "waived: {r}", waive: "Waive…", unwaive: "Undo", waivePh: "Why deploy without «{gate}»? (kept in the audit log)", waiveNeedsReason: "A waiver needs a reason.",
    rolling: "Rolling update", canary: "Canary — later", blueGreen: "Blue-green — later",
    commands: "The exact commands", blockedBy: "Blocked by: {l}", ready: "Ready to deploy", deploy: "Deploy…", deploying: "Deploying…",
    prodNeeds: "Production asks for a reason and «production» typed, and a second approver: {who}.", noApprover: "nobody yet",
    approveWhat: "Deploy {v} to {env}", scope: "context {ctx} · namespace {ns}", waivedList: "waived: {l}",
    deployedOk: "Deployed to {env}.", deployedFailed: "The deploy to {env} failed at {step}.",
    recOk: "Deployed", recFailed: "Failed at {step}", recBy: "by {who}", recApprover: "approved by {who}", history: "Recent deploys", noHistory: "No deploys yet.",
  },
  ptAO: {
    tab: "Deploy", title: "Deploy", needDesktop: "Fazer deploy precisa da app desktop com uma pasta aberta.",
    sub: "Todas as verificações correm antes de qualquer mudança. Os segredos nunca vão com os manifestos: o cluster lê-os do Vault.",
    choose: "Escolhe para onde:", toStaging: "Deploy para Staging", toProduction: "Deploy para Produção", replan: "Verificar outra vez", planning: "A verificar…",
    target: "1 · Destino", identity: "2 · Identidade", secrets: "3 · Segredos", preflight: "4 · Verificações", strategy: "5 · Estratégia", approve: "6 · Aprovar", rollout: "7 · Rollout", record: "8 · Registo",
    env: "Ambiente", cluster: "Cluster", version: "Versão", issue: "Issue", manifests: "Manifestos", workloads: "Workloads",
    gitUser: "git", clusterUser: "cluster", vaultUser: "Vault", notConnected: "não ligado",
    fromVault: "Não aplicados — o cluster lê-os do Vault (Vault Secrets Operator): {l}", noSecretObjects: "Os manifestos não declaram nenhum Secret.",
    stOk: "ok", stFailed: "falhou", stNotInstalled: "não instalado", stNotConnected: "não ligado", stSkipped: "saltado", stWarning: "aviso",
    blocks: "bloqueia", waived: "excepção: {r}", waive: "Excepção…", unwaive: "Desfazer", waivePh: "Porque fazer deploy sem «{gate}»? (fica no registo de auditoria)", waiveNeedsReason: "Uma excepção precisa de um motivo.",
    rolling: "Rolling update", canary: "Canary — mais tarde", blueGreen: "Blue-green — mais tarde",
    commands: "Os comandos exactos", blockedBy: "Bloqueado por: {l}", ready: "Pronto para o deploy", deploy: "Fazer deploy…", deploying: "A fazer deploy…",
    prodNeeds: "A produção pede um motivo, «production» escrito, e um segundo aprovador: {who}.", noApprover: "ninguém ainda",
    approveWhat: "Deploy de {v} para {env}", scope: "contexto {ctx} · namespace {ns}", waivedList: "excepções: {l}",
    deployedOk: "Deploy feito em {env}.", deployedFailed: "O deploy em {env} falhou em {step}.",
    recOk: "Feito", recFailed: "Falhou em {step}", recBy: "por {who}", recApprover: "aprovado por {who}", history: "Deploys recentes", noHistory: "Ainda não há deploys.",
  },
} satisfies Messages<string>;
export type DeployKey = keyof typeof DEPLOY_MESSAGES.en;
