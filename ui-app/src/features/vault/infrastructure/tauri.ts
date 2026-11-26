/* ═════════ feature `vault` — adaptador Tauri (r23 F4c) ═════════
   `vault_*` (commands/vault.rs) e o evento `vault://lease-revoked`. Nenhum comando devolve o token.
   Não toca em `window`. */
import { invoke, isDesktop, listen, type Invoker } from "../../../platform/tauri/core";
import type { VaultPort } from "../application/ports";
import type { KvMeta, Lease, Reveal, VaultStatus } from "../domain/types";

type Listen = (event: string, f: (payload: unknown) => void) => unknown;
const ns = (n: string): string | null => n.trim() || null;

export const tauriVault = (inv: Invoker = invoke, on: Listen = (e, f) => (isDesktop() ? listen(e, f) : null)): VaultPort => ({
  status: (w) => inv<VaultStatus>("vault_status", { addr: w.addr, namespace: ns(w.namespace) }),
  loginToken: (w, token) => inv<VaultStatus>("vault_login_token", { addr: w.addr, namespace: ns(w.namespace), token }),
  loginOidc: (w, mount, role) => inv<VaultStatus>("vault_login_oidc", { addr: w.addr, namespace: ns(w.namespace), mount, role }),
  renew: (w) => inv<VaultStatus>("vault_renew", { addr: w.addr, namespace: ns(w.namespace) }),
  revoke: (w) => inv<VaultStatus>("vault_revoke", { addr: w.addr, namespace: ns(w.namespace) }),
  kvMeta: (w, mount, path) => inv<KvMeta>("vault_kv_meta", { addr: w.addr, namespace: ns(w.namespace), mount, path }),
  reveal: (root, w, mount, path, key, reason) => inv<Reveal>("vault_reveal_local", { root, addr: w.addr, namespace: ns(w.namespace), mount, path, key, reason }),
  revealRead: (id) => inv<string>("vault_reveal_read", { id }),
  dynamic: (root, w, mount, role, reason) => inv<Lease>("vault_dynamic", { root, addr: w.addr, namespace: ns(w.namespace), mount, role, reason }),
  leaseRevoke: (root, w, lease) => inv<void>("vault_lease_revoke", { root, addr: w.addr, namespace: ns(w.namespace), lease }),
  onLeaseRevoked: (f) => {
    void on("vault://lease-revoked", (p) => {
      const e = p as { lease?: string; ok?: boolean };
      if (e && typeof e.lease === "string") f(e.lease, !!e.ok);
    });
  },
});
