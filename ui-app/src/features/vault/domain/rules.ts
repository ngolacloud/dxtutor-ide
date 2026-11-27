/* ═══════════ feature `vault` — domain: the pure rules of the Vault screen (r23 F4c) ═══════════
   The rules that matter (the token in the keychain, no staging/production value out of Vault, the
   20-second reveal) live in Rust; these only word the state and build the commands shown in full.
   PURE: no DOM, no window. */
import type { VaultStatus, VaultTarget } from "./types";

export const DEFAULT_TARGET: VaultTarget = { addr: "", namespace: "", kvMount: "secret", oidcMount: "oidc", role: "", dynMount: "database", dynRole: "" };

/** POSIX single-quoting (only when needed). */
export const q = (s: string): string => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

/** A TTL in words: `2h 5m`, `45s`; 0 = a token that never expires. */
export function ttlText(sec: number | null): string {
  if (sec === null) return "";
  if (sec === 0) return "∞";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m` : `${s}s`;
}

/** The state the status bar shows. */
export type StatusKind = "none" | "unreachable" | "sealed" | "signedOut" | "expiring" | "signedIn";
export function statusKind(target: VaultTarget, s: VaultStatus | null): StatusKind {
  if (!target.addr) return "none";
  if (!s || !s.reachable) return "unreachable";
  if (s.sealed) return "sealed";
  if (!s.signedIn) return "signedOut";
  return s.ttl !== null && s.ttl > 0 && s.ttl < 600 ? "expiring" : "signedIn";
}

/** Patching a value in a terminal: `vault kv patch` reads it from stdin (`key=-`), so the IDE never sees it. */
export const patchCommand = (mount: string, path: string, key: string): string => `vault kv patch -mount=${q(mount)} ${q(path)} ${q(key)}=-`;

/** A shell that holds a lease's credentials until it ends (then the backend revokes the lease). */
export const LEASE_SHELL = 'exec "${SHELL:-/bin/sh}" -i';

/** A KV path under the current one (`apps/` + `shop/` → `apps/shop`), and the one above. */
export const childPath = (path: string, child: string): string => [path.replace(/\/+$/, ""), child.replace(/\/+$/, "")].filter(Boolean).join("/");
export const parentPath = (path: string): string => path.replace(/\/+$/, "").split("/").slice(0, -1).join("/");

/** A key name as KV takes it. */
export const isKey = (k: string): boolean => /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(k.trim());
