/* ═══════════ feature `vault` — application ports (r23 F4c) ═══════════ */
import type { KvMeta, Lease, Reveal, VaultStatus, VaultTarget } from "../domain/types";

type Where = { addr: string; namespace: string };

export interface VaultPort {
  status(w: Where): Promise<VaultStatus>;
  /** the pasted token goes to the backend once, into the keychain; it never comes back */
  loginToken(w: Where, token: string): Promise<VaultStatus>;
  /** opens the browser and waits for it to come back (up to 3 minutes) */
  loginOidc(w: Where, mount: string, role: string): Promise<VaultStatus>;
  renew(w: Where): Promise<VaultStatus>;
  revoke(w: Where): Promise<VaultStatus>;
  kvMeta(w: Where, mount: string, path: string): Promise<KvMeta>;
  /** audited and refused for staging/production — both in Rust */
  reveal(root: string, w: Where, mount: string, path: string, key: string, reason: string): Promise<Reveal>;
  revealRead(id: string): Promise<string>;
  dynamic(root: string, w: Where, mount: string, role: string, reason: string): Promise<Lease>;
  leaseRevoke(root: string, w: Where, lease: string): Promise<void>;
  /** the backend revoked a terminal's lease when it ended */
  onLeaseRevoked(f: (lease: string, ok: boolean) => void): void;
}

/** O pedido de aprovação: a forma do `app/approval.ts` (tipagem estrutural). */
export interface ApprovalRequest { title: string; command: string; scope?: string; destructive?: boolean; reasonRequired?: boolean; confirmText?: string }
export interface ApprovalDecision { approved: boolean; reason: string; decidedAt: number }

export interface HumanPort {
  approve(r: ApprovalRequest): Promise<ApprovalDecision>;
  /** a hidden field (a token) */
  secret(title: string): Promise<string | null>;
  text(placeholder: string, initial?: string): Promise<string | null>;
  toast(message: string): void;
}

export interface AuditPort {
  record(root: string, e: { action: string; command: string; scope: string; approved: boolean; reason: string; decidedAt: number; outcome?: "sent" | "ok" | "failed" }): Promise<void>;
}

export interface WorldPort {
  root(): string | null;
  /** a task terminal whose environment the backend fills from Vault (`lease`: its credentials too) */
  runInTerminal(cmd: string, vault: { addr: string; namespace: string | null; lease?: string | null }, label: string): Promise<number> | void;
  loadTarget(): Partial<VaultTarget> | null;
  saveTarget(t: VaultTarget): void;
  now(): number;
  after(ms: number, f: () => void): void;
}
