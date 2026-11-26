/* ═════════ feature `deploy` — raiz de composição (r23 F4c2, docs/v2/AUDIT-r23.md §4.4 — D01–D04) ═════════
   O separador «Deploy» (o assistente de 8 passos), só na app desktop. O alvo vem dos ambientes do Infra (o cluster de
   cada um: `ENVX`, por import — a infra avalia antes) e do Vault para onde o IDE aponta (features/vault). Regista
   `services.deploy` (a infra abre-o no «Promote» e no «Redeploy», no acto). Sem `window` aqui. */
import { VIEW } from "../../app/store/registry";
import { translator } from "../../app/i18n";
import { requestApproval } from "../../app/approval";
import { services } from "../../app/services";
import { isDesktop } from "../../platform/tauri/core";
import { ENVX } from "../infra";
import { vault } from "../vault/index";
import { makeDeploy } from "./application/deploy-service";
import { tauriDeploy } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { DEPLOY_MESSAGES, type DeployKey } from "./ui/messages";
import { renderDeploy } from "./ui/view";
import { bindActions } from "./ui/actions";

const t = translator(DEPLOY_MESSAGES);

export const deploy = makeDeploy({
  deploy: tauriDeploy(),
  world: {
    root: () => B.root(),
    target: (env) => {
      const v = vault.state().target, signed = !!vault.state().status?.signedIn;
      return {
        env, context: ENVX.ctx?.[env] ?? "", namespace: ENVX.ns?.[env] ?? "", kubeconfig: B.kubeconfig(),
        stagingContext: env === "production" ? ENVX.ctx?.staging ?? null : null, stagingNamespace: env === "production" ? ENVX.ns?.staging ?? null : null,
        vaultAddr: signed ? v.addr : null, vaultNamespace: signed ? v.namespace || null : null, kvMount: v.kvMount || null,
      };
    },
    openTab: () => B.openTab("deploy", t("tab")),
  },
  human: { approve: (r) => requestApproval(r), text: (ph, i) => B.textPrompt(ph, i), toast: (m) => B.notify(m) },
  say: (k, p) => t(k as DeployKey, p),
});

let host: HTMLElement | null = null;
const paint = (): void => { if (host && host.isConnected) host.innerHTML = renderDeploy(t, deploy.state(), isDesktop() && !!B.root()); };
VIEW.deploy = (_t, h) => { host = h; paint(); if (isDesktop()) void deploy.loadRecent(); };
deploy.subscribe(paint);
bindActions(deploy);

/** Abre o assistente de deploy (num ambiente, ou para escolher). */
export function openDeploy(env?: string): void {
  if (env) deploy.open(env);
  else B.openTab("deploy", t("tab"));
}

if (isDesktop()) {
  services.deploy = { open: (env) => deploy.open(env), recent: () => deploy.recent() };
  document.addEventListener("dx:workspace", () => { void deploy.loadRecent(); });
}
