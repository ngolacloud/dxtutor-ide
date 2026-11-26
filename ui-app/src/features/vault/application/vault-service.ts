/* ═══════════ feature `vault` — application: the Vault screen (r23 F4c, docs/v2/AUDIT-r23.md §4.4 — K01–K05) ═══════════
   - Sign in through the browser (OIDC) or with a pasted token: the token goes to the OS keychain in the
     backend and never comes back; renew; sign out (Vault revokes it).
   - Browse KV: metadata of every environment (versions, times, custom metadata); key names and values
     for `local` only — a value is shown after approval (with a reason, audited in Rust) for 20 seconds,
     then wiped. Staging/production values never leave Vault (refused in Rust).
   - Patch a value in a terminal (`vault kv patch … key=-` reads stdin): approved and audited; the IDE
     never sees the value; the terminal gets the token from the backend.
   - Dynamic credentials: issued after approval (audited in Rust); the UI holds the lease, a terminal
     started with it gets the credentials, and the lease is revoked when that terminal ends (or now).
   No DOM, no window. */

import { DEFAULT_TARGET, LEASE_SHELL, childPath, isKey, parentPath, patchCommand } from "../domain/rules";
import type { KvMeta, Lease, VaultStatus, VaultTarget } from "../domain/types";
import type { AuditPort, HumanPort, VaultPort, WorldPort } from "./ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;

export interface VaultState {
  target: VaultTarget;
  status: VaultStatus | null;
  busy: string | null;
  path: string;
  meta: KvMeta | null;
  /** a revealed local value, until it is wiped */
  shown: { path: string; key: string; value: string; until: number } | null;
  leases: Lease[];
  error: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

export function makeVault(deps: { vault: VaultPort; world: WorldPort; human: HumanPort; audit: AuditPort; say: Say }) {
  const { vault, world, human, audit, say } = deps;
  const st: VaultState = { target: { ...DEFAULT_TARGET, ...(world.loadTarget() ?? {}) }, status: null, busy: null, path: "", meta: null, shown: null, leases: [], error: null };
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };
  const where = () => ({ addr: st.target.addr, namespace: st.target.namespace });
  const scope = (): string => say("scope", { addr: st.target.addr, ns: st.target.namespace || "—" });

  async function busy<T>(what: string, f: () => Promise<T>): Promise<T | null> {
    if (st.busy) return null;
    st.busy = what; st.error = null; emit();
    try { return await f(); }
    catch (e) { st.error = msg(e); return null; }
    finally { st.busy = null; emit(); }
  }
  const take = (s: VaultStatus | null): void => { if (s) st.status = s; };

  async function refresh(): Promise<void> {
    if (!st.target.addr) { st.status = null; emit(); return; }
    take(await busy("status", () => vault.status(where())));
  }
  function setTarget(p: Partial<VaultTarget>): void {
    const before = `${st.target.addr}#${st.target.namespace}`;
    st.target = { ...st.target, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v ?? "").trim()])) };
    world.saveTarget(st.target);
    if (`${st.target.addr}#${st.target.namespace}` !== before) { st.meta = null; st.path = ""; st.status = null; void refresh(); }
    else emit();
  }

  async function loginOidc(): Promise<void> {
    if (!st.target.role) { human.toast(say("needRole")); return; }
    take(await busy("oidc", () => vault.loginOidc(where(), st.target.oidcMount || "oidc", st.target.role)));
    if (st.status?.signedIn) human.toast(say("signedIn", { who: st.status.displayName ?? "" }));
  }
  async function loginToken(): Promise<void> {
    const tok = await human.secret(say("pasteToken", { addr: st.target.addr }));
    if (!tok || !tok.trim()) return;
    take(await busy("token", () => vault.loginToken(where(), tok.trim())));
  }
  async function renew(): Promise<void> { take(await busy("renew", () => vault.renew(where()))); }
  async function signOut(): Promise<void> {
    take(await busy("revoke", () => vault.revoke(where())));
    st.meta = null; st.shown = null; emit();
  }

  async function browse(path: string): Promise<void> {
    const p = path.trim().replace(/^\/+|\/+$/g, "");
    if (!p) { st.path = ""; st.meta = null; emit(); return; }
    st.path = p; st.shown = null;
    const m = await busy("kv", () => vault.kvMeta(where(), st.target.kvMount || "secret", p));
    if (m) st.meta = m;
    emit();
  }
  const open = (child: string): Promise<void> => browse(childPath(st.path, child));
  const up = (): Promise<void> => browse(parentPath(st.path));

  /** Shows one key of a `local` secret for 20 seconds (approved with a reason; audited and checked in Rust). */
  async function reveal(key: string): Promise<void> {
    const root = world.root(), m = st.meta;
    if (!root || !m || m.env !== "local") return;
    const d = await human.approve({ title: say("revealWhat", { key, path: m.path }), command: say("revealCmd", { mount: m.mount, path: m.path, key }), scope: scope(), reasonRequired: true });
    if (!d.approved) return;
    const r = await busy("reveal", () => vault.reveal(root, where(), m.mount, m.path, key, d.reason));
    if (!r) return;
    const value = await vault.revealRead(r.id).catch((e) => { st.error = msg(e); return null; });
    if (value === null) { emit(); return; }
    st.shown = { path: m.path, key, value, until: world.now() + r.ttlMs };
    emit();
    world.after(r.ttlMs, () => { if (st.shown && st.shown.key === key && st.shown.path === m.path) { st.shown = null; emit(); } });
  }
  function hide(): void { st.shown = null; emit(); }

  /** Patches a value in a terminal: `vault kv patch … key=-` (the value is typed there, never seen here). */
  async function patch(key?: string): Promise<void> {
    const root = world.root(), m = st.meta;
    if (!root || !m) return;
    const k = key ?? (await human.text(say("patchKeyPh", { path: m.path })));
    if (!k) return;
    if (!isKey(k)) { human.toast(say("badKey")); return; }
    const cmd = patchCommand(m.mount, m.path, k.trim());
    const d = await human.approve({ title: say("patchWhat", { key: k.trim(), path: m.path, env: m.env ?? "?" }), command: cmd, scope: scope(), destructive: m.env === "production", confirmText: m.env === "production" ? k.trim() : undefined });
    const row = { action: "vault.patch", command: cmd, scope: scope(), approved: d.approved, reason: d.reason, decidedAt: d.decidedAt };
    if (!d.approved) { void audit.record(root, row).catch(() => undefined); return; }
    try { await audit.record(root, { ...row, outcome: "sent" }); } catch (e) { human.toast(say("notAudited", { e: msg(e) })); return; }
    human.toast(say("patchHow"));
    const code = await world.runInTerminal(cmd, { addr: st.target.addr, namespace: st.target.namespace || null }, `vault kv patch ${k.trim()}`);
    if (typeof code === "number") {
      void audit.record(root, { ...row, outcome: code === 0 ? "ok" : "failed" }).catch(() => undefined);
      if (code === 0) void browse(m.path);
    }
  }

  /** Issues dynamic credentials (approved with a reason; audited in Rust): the lease only. */
  async function dynamic(): Promise<void> {
    const root = world.root(), { dynMount, dynRole } = st.target;
    if (!root) return;
    if (!dynMount || !dynRole) { human.toast(say("needDynRole")); return; }
    const d = await human.approve({ title: say("dynWhat", { role: dynRole, mount: dynMount }), command: `vault read ${dynMount}/creds/${dynRole}`, scope: scope(), reasonRequired: true });
    if (!d.approved) return;
    const l = await busy("dynamic", () => vault.dynamic(root, where(), dynMount, dynRole, d.reason));
    if (l) { st.leases = [...st.leases, l]; emit(); }
  }
  /** A shell with the lease's credentials; the backend revokes the lease when it ends. */
  function useLease(leaseId: string): void {
    if (!st.leases.some((l) => l.leaseId === leaseId)) return;
    void world.runInTerminal(LEASE_SHELL, { addr: st.target.addr, namespace: st.target.namespace || null, lease: leaseId }, say("leaseShell"));
  }
  async function revokeLease(leaseId: string): Promise<void> {
    const root = world.root();
    if (!root) return;
    const ok = await busy("lease", () => vault.leaseRevoke(root, where(), leaseId).then(() => true));
    if (ok) { st.leases = st.leases.filter((l) => l.leaseId !== leaseId); emit(); }
  }
  vault.onLeaseRevoked((lease, ok) => {
    if (!st.leases.some((l) => l.leaseId === lease)) return;
    st.leases = st.leases.filter((l) => l.leaseId !== lease);
    human.toast(say(ok ? "leaseRevoked" : "leaseNotRevoked", { lease }));
    emit();
  });

  return {
    state: (): VaultState => st,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    refresh, setTarget, loginOidc, loginToken, renew, signOut,
    browse, open, up, reveal, hide, patch, dynamic, useLease, revokeLease,
  };
}

export type Vault = ReturnType<typeof makeVault>;
