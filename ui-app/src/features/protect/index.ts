/* ═════════ feature `protect` — a raiz de composição (r23 F4a, docs/v2/AUDIT-r23.md §4.4) ═════════
   Só na app desktop: aprende os segredos dos `.env` da pasta aberta (para os pedidos aos modelos), mostra
   na barra de estado quantos segredos saíram dos pedidos (e audita cada pedido que perdeu algum), e serve
   `services.protect.guard` aos caminhos de commit da UI (o commit do desktop, o Composer e as lanes): um
   commit bloqueado pelo secret scan pergunta, com o motivo, no diálogo partilhado. */
import { isDesktop } from "../../platform/tauri/core";
import { requestApproval } from "../../app/approval";
import { translator } from "../../app/i18n";
import { auditClient } from "../../platform/tauri/audit";
import { services } from "../../app/services";
import { toast } from "../../core";
import { makeProtect } from "./application/protect-service";
import { onRedacted, tauriProtect } from "./infrastructure/tauri";
import { root } from "./infrastructure/legacy-bridge";
import { drawStatus } from "./ui/status";
import { PROTECT_MESSAGES, type ProtectMessageKey } from "./ui/messages";

const t = translator(PROTECT_MESSAGES);

export const protect = makeProtect({
  protect: tauriProtect(),
  approval: { approve: (r) => requestApproval(r) },
  audit: auditClient(),
  root,
  toast: (m) => toast(m),
  copy: (k, p) => t(k as ProtectMessageKey, p),
});

if (isDesktop()) {
  protect.subscribe(() => drawStatus(protect.total(), t("redacted", { n: protect.total() }), t("redactedTitle", { n: protect.total() })));
  onRedacted((origin, count, total) => protect.redacted(origin, count, total));
  document.addEventListener("dx:workspace", () => { const r = root(); if (r) void protect.workspaceOpened(r); });
  services.protect = { guard: protect.guard };
}
