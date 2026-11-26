/* ═══════════ feature `vault` — domain: the shapes of `tutor_platform::vault` (r23 F4c, K01–K05) ═══════════
   serde camelCase. The token is never in any of them. PURE. */

/** Where the IDE points: the Vault, its namespace, the KV mount, the OIDC sign-in, and a dynamic engine. */
export interface VaultTarget { addr: string; namespace: string; kvMount: string; oidcMount: string; role: string; dynMount: string; dynRole: string }

export interface VaultStatus {
  addr: string; namespace: string | null; reachable: boolean; initialized: boolean; sealed: boolean; version: string | null;
  signedIn: boolean; displayName: string | null; policies: string[]; ttl: number | null; renewable: boolean; notes: string;
  /** the `vault` CLI (patching a value happens there) */
  cli: boolean;
  keychain: boolean; keychainNote: string | null;
}

export type VaultEnv = "local" | "staging" | "production";
export interface KvVersion { version: number; created: string; deleted: boolean; destroyed: boolean }
export interface KvMeta {
  mount: string; path: string; env: VaultEnv | null; exists: boolean; currentVersion: number | null; versions: KvVersion[];
  created: string | null; updated: string | null; customMetadata: Record<string, string>;
  /** the key names — only for a `local` path */
  keys: string[] | null;
  children: string[];
}
export interface Reveal { id: string; path: string; key: string; ttlMs: number }
export interface Lease { leaseId: string; ttl: number; renewable: boolean; fields: string[]; env: string[] }
