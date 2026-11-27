/* ═════════ feature `integration` — raiz de composição (Multi Co-Dev, fase 4) ═════════
   O painel «Rever e integrar» de uma issue, só na app desktop: a faixa «Co-Devs» e o painel da issue no Project
   abrem-no por `services.integration.open(key)` (no acto: esta feature avalia depois delas). O caso de uso recebe o
   backend (`infrastructure/tauri.ts`), o diálogo de aprovação partilhado, o registo de auditoria das recusas, o
   secret scan que pede um motivo (`services.protect.guard`), o Co-Dev (`services.codevReview`: o provedor e o
   modelo do revisor, fechar a sessão da issue) e o Project (gravar as verificações obrigatórias, reler). As regras
   (as três condições, o comando exacto, a auditoria) vivem no Rust. Sem `window` aqui.
   Fase 5: a secção «Autonomia e pull request» do mesmo painel (`application/autonomy-service.ts`): o interruptor
   geral, as delegações, o registo da autonomia e o pull request; os passos da autonomia chegam por evento (avisam
   mesmo com o painel fechado). */
import { registerActions } from "../../app/actions";
import { requestApproval } from "../../app/approval";
import { currentLocale, translator } from "../../app/i18n";
import { services } from "../../app/services";
import { auditClient } from "../../platform/tauri/audit";
import { isDesktop } from "../../platform/tauri/core";
import { projectClient } from "../../platform/tauri/project";
import { makeReviewService } from "./application/review-service";
import { makeAutonomyService } from "./application/autonomy-service";
import { INTEGRATION_MESSAGES, type IntegrationKey } from "./application/messages";
import { AUTONOMY_MESSAGES, type AutonomyKey } from "./application/autonomy-messages";
import { autonomyGateway, reviewGateway } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { renderPanel, showPanel, PANEL_ID } from "./ui/panel-view";
import { readGrantForm, renderAutonomy } from "./ui/autonomy-view";

const t = translator(INTEGRATION_MESSAGES);
const ta = translator(AUTONOMY_MESSAGES);

export const reviews = makeReviewService({
  gateway: reviewGateway,
  root: () => B.root(),
  approve: (r) => requestApproval(r),
  audit: (root, entry) => auditClient().record(root, entry),
  guard: (f) => (services.protect ? services.protect.guard(f) : f()),
  reviewer: () => ({ ...(services.codevReview?.reviewer() ?? {}), language: currentLocale() }),
  detectedTest: () => B.detectedTest(),
  setChecks: async (checks) => {
    const root = B.root();
    if (!root) throw new Error("no folder");
    await projectClient().apply(root, { op: "settings", checks });
    services.project?.refresh();
  },
  closeSession: (session) => services.codevReview?.closeSession(session) ?? false,
  projectChanged: () => services.project?.refresh(),
  notify: (m) => B.notify(m),
  copy: (k: IntegrationKey, p) => t(k, p),
});

export const autonomy = makeAutonomyService({
  gateway: autonomyGateway,
  root: () => B.root(),
  approve: (r) => requestApproval(r),
  audit: (root, entry) => auditClient().record(root, entry),
  guard: (f) => (services.protect ? services.protect.guard(f) : f()),
  reviewer: () => ({ ...(services.codevReview?.reviewer() ?? {}), language: currentLocale() }),
  reviewChanged: (key) => {
    if (reviews.opened() === key) void reviews.refresh(key);
  },
  closeSession: (session) => services.codevReview?.closeSession(session) ?? false,
  projectChanged: () => services.project?.refresh(),
  notify: (m) => B.notify(m),
  copy: (k: AutonomyKey, p) => ta(k, p),
});

function paint(): void {
  const key = reviews.opened();
  if (!key) return showPanel(null);
  const extra = renderAutonomy(ta, {
    key,
    overview: autonomy.overview(key),
    pr: autonomy.pr(key),
    error: autonomy.error(key),
    busy: autonomy.busy(key),
    audit: (id) => autonomy.audit(id),
    eventText: (code) => autonomy.eventText(code),
  });
  showPanel(renderPanel(t, { key, state: reviews.state(key), error: reviews.error(key), stage: reviews.stage(key), busy: reviews.busy(key), detected: reviews.detected(), extra }));
}
reviews.onChange(paint);
autonomy.onChange(paint);

/** `issue|id` do `data-on` das acções de uma linha. */
const pair = (on: string): [string, number] => {
  const i = on.lastIndexOf("|");
  return [on.slice(0, i), Number(on.slice(i + 1))];
};

registerActions({
  "integration:close": { click: () => reviews.close() },
  "integration:refresh": {
    click: (c) => {
      void reviews.refresh(c.on);
      void autonomy.refresh(c.on);
    },
  },
  "integration:request": { click: (c) => void reviews.request(c.on) },
  "integration:cancel": { click: (c) => void reviews.cancel(c.on) },
  "integration:integrate": { click: (c) => void reviews.integrate(c.on) },
  "integration:detected": { click: (c) => void reviews.useDetected(c.on) },
  // Multi Co-Dev, fase 5
  "integration:pr-open": { click: (c) => void autonomy.openPr(c.on) },
  "integration:pause": { click: (c) => void autonomy.pause(c.on) },
  "integration:resume": { click: (c) => void autonomy.resume(c.on) },
  "integration:revoke": {
    click: (c) => {
      const [key, id] = pair(c.on);
      if (Number.isFinite(id)) void autonomy.revoke(key, id);
    },
  },
  "integration:delegate": {
    click: (c) => {
      const f = readGrantForm(document.getElementById(PANEL_ID) ?? document, c.on);
      void autonomy.grant(c.on, f.scope, f.actions, f.hours);
    },
  },
  "integration:audit": {
    click: (c) => {
      const [key, id] = pair(c.on);
      if (Number.isFinite(id)) void autonomy.toggleAudit(key, id);
    },
  },
});

// Esc fecha o painel (o diálogo de aprovação, por cima, apanha o seu Esc primeiro)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reviews.opened() && !document.getElementById("approval")) reviews.close();
});

/** Abre o painel de revisão e integração da issue. */
export function openIntegration(key: string): void {
  void reviews.open(key);
  void autonomy.refresh(key);
}

if (isDesktop()) {
  services.integration = { open: openIntegration };
  // the autonomy's steps are told even with the panel closed
  autonomy.listen();
}
