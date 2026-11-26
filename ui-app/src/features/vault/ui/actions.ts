/* ═══════════ feature `vault` — as acções `vault:*` no despachante partilhado (ADR-0004 U5) ═══════════
   Cablagem pura: cada acção chama o serviço. */
import { registerActions } from "../../../app/actions";
import type { Vault } from "../application/vault-service";

export function bindActions(v: Vault, openTab: () => void): void {
  registerActions({
    "vault:open-tab": { click: () => openTab() },
    "vault:field": { change: (c) => v.setTarget({ [c.on]: c.value }) },
    "vault:path": { change: (c) => { void v.browse(c.value); } },
    "vault:browse": { click: (c) => { const el = c.el.parentElement?.querySelector<HTMLInputElement>(".vt-path"); void v.browse(el?.value ?? v.state().path); } },
    "vault:open": { click: (c) => { void v.open(c.on); } },
    "vault:up": { click: () => { void v.up(); } },
    "vault:oidc": { click: () => { void v.loginOidc(); } },
    "vault:token": { click: () => { void v.loginToken(); } },
    "vault:renew": { click: () => { void v.renew(); } },
    "vault:signout": { click: () => { void v.signOut(); } },
    "vault:reveal": { click: (c) => { void v.reveal(c.on); } },
    "vault:hide": { click: () => v.hide() },
    "vault:patch": { click: (c) => { void v.patch(c.on || undefined); } },
    "vault:dynamic": { click: () => { void v.dynamic(); } },
    "vault:use-lease": { click: (c) => v.useLease(c.on) },
    "vault:revoke-lease": { click: (c) => { void v.revokeLease(c.on); } },
  });
}
