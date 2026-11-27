/* ═════════ feature `vault` — raiz de composição (r23 F4c, docs/v2/AUDIT-r23.md §4.4 — K01–K05) ═════════
   O separador «Vault» e o estado do token na barra de estado (`#st-vault`), só na app desktop: liga o serviço
   (application/vault-service.ts) ao backend (infrastructure/tauri.ts), ao diálogo partilhado de aprovação, ao
   registo de auditoria, ao terminal e ao LS (infrastructure/legacy-bridge.ts). Sem `window` aqui. */
import { VIEW } from "../../app/store/registry";
import { translator } from "../../app/i18n";
import { requestApproval } from "../../app/approval";
import { auditClient } from "../../platform/tauri/audit";
import { isDesktop } from "../../platform/tauri/core";
import { services } from "../../app/services";
import { makeVault } from "./application/vault-service";
import { statusKind, ttlText } from "./domain/rules";
import { tauriVault } from "./infrastructure/tauri";
import * as B from "./infrastructure/legacy-bridge";
import { VAULT_MESSAGES, type VaultKey } from "./ui/messages";
import { renderVault } from "./ui/view";
import { drawStatus } from "./ui/status";
import { askSecret } from "./ui/secret-prompt";
import { bindActions } from "./ui/actions";

const t = translator(VAULT_MESSAGES);

export const vault = makeVault({
  vault: tauriVault(),
  world: {
    root: () => B.root(), runInTerminal: (c, v, label) => B.runInTerminal(c, v, label),
    loadTarget: () => B.loadTarget(), saveTarget: (x) => B.saveTarget(x),
    now: () => Date.now(), after: (ms, f) => { setTimeout(f, ms); },
  },
  human: { approve: (r) => requestApproval(r), secret: (title) => askSecret(title, "OK", "Cancel"), text: (ph, i) => B.textPrompt(ph, i), toast: (m) => B.notify(m) },
  audit: { record: (root, e) => auditClient().record(root, { feature: "vault", ...e, scope: e.scope || undefined, reason: e.reason || undefined, outcome: e.approved ? e.outcome ?? "sent" : undefined }) },
  say: (k, p) => t(k as VaultKey, p),
});

let host: HTMLElement | null = null;
const paint = (): void => {
  if (host && host.isConnected) host.innerHTML = renderVault(t, vault.state(), isDesktop());
  const s = vault.state(), kind = statusKind(s.target, s.status);
  const text = kind === "none" ? "" : kind === "signedIn" || kind === "expiring" ? t("stSignedIn", { who: s.status?.displayName ?? "?", t: s.status?.ttl === 0 ? "∞" : ttlText(s.status?.ttl ?? null) }) : t(kind === "unreachable" ? "stUnreachable" : kind === "sealed" ? "stSealed" : "stSignedOut");
  if (isDesktop()) drawStatus(text, kind);
};
VIEW.vault = (_t, h) => { host = h; paint(); if (isDesktop()) void vault.refresh(); };
vault.subscribe(paint);

/** Abre o separador Vault. */
export function openVault(): void {
  B.openTab("vault", t("tab"));
}

bindActions(vault, openVault);
services.vault = { signedIn: () => { const s = vault.state(); return s.status?.signedIn && s.target.addr ? { addr: s.target.addr, namespace: s.target.namespace || null } : null; } };
if (isDesktop()) {
  /* o estado do token na barra, ao arrancar e de minuto a minuto (o TTL desce) */
  document.addEventListener("dx:workspace", () => { void vault.refresh(); });
  setInterval(() => { if (vault.state().target.addr) void vault.refresh(); }, 60_000);
}
