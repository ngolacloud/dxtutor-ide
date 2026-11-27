/* ═════════ feature `integration` — raiz de composição (Multi Co-Dev, fase 4) ═════════
   O painel «Rever e integrar» de uma issue, só na app desktop: a faixa «Co-Devs» e o painel da issue no Project
   abrem-no por `services.integration.open(key)` (no acto: esta feature avalia depois delas). O caso de uso recebe o
   backend (`infrastructure/tauri.ts`), o diálogo de aprovação partilhado, o registo de auditoria das recusas, o
   secret scan que pede um motivo (`services.protect.guard`), o Co-Dev (`services.codevReview`: o provedor e o
   modelo do revisor, fechar a sessão da issue) e o Project (gravar as verificações obrigatórias, reler). As regras
   (as três condições, o comando exacto, a auditoria) vivem no Rust. Sem `window` aqui. */
import { registerActions } from "../../app/actions";
import { requestApproval } from "../../app/approval";
import { currentLocale, translator } from "../../app/i18n";
import { services } from "../../app/services";
import { auditClient } from "../../platform/tauri/audit";
import { isDesktop } from "../../platform/tauri/core";
import { projectClient } from "../../platform/tauri/project";
import { makeReviewService } from "./application/review-service";
import { INTEGRATION_MESSAGES, type IntegrationKey } from "./application/messages";
import { reviewGateway } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { renderPanel, showPanel } from "./ui/panel-view";

const t = translator(INTEGRATION_MESSAGES);

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

function paint(): void {
  const key = reviews.opened();
  if (!key) return showPanel(null);
  showPanel(renderPanel(t, { key, state: reviews.state(key), error: reviews.error(key), stage: reviews.stage(key), busy: reviews.busy(key), detected: reviews.detected() }));
}
reviews.onChange(paint);

registerActions({
  "integration:close": { click: () => reviews.close() },
  "integration:refresh": { click: (c) => void reviews.refresh(c.on) },
  "integration:request": { click: (c) => void reviews.request(c.on) },
  "integration:cancel": { click: (c) => void reviews.cancel(c.on) },
  "integration:integrate": { click: (c) => void reviews.integrate(c.on) },
  "integration:detected": { click: (c) => void reviews.useDetected(c.on) },
});

// Esc fecha o painel (o diálogo de aprovação, por cima, apanha o seu Esc primeiro)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && reviews.opened() && !document.getElementById("approval")) reviews.close();
});

/** Abre o painel de revisão e integração da issue. */
export function openIntegration(key: string): void {
  void reviews.open(key);
}

if (isDesktop()) services.integration = { open: openIntegration };
