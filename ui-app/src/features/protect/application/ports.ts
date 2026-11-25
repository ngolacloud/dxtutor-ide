/* ═══════════ feature `protect` — application ports (r23 F4a) ═══════════
   The protection service depends only on these. The composition (`../index.ts`) gives the Tauri
   adapter, the shared approval dialog and the audit log. */
import type { ScanReport } from "../domain/report";

export interface ProtectPort {
  /** the folder's `.env` secrets join what every LLM request is filtered for */
  learn(root: string): Promise<number>;
  scan(root: string, scope?: "staged" | "tracked" | "working" | "paths", paths?: string[]): Promise<ScanReport>;
  /** the next commit in `root` goes ahead despite the scan (one, two minutes) */
  allow(root: string, reason: string): Promise<void>;
}

/** The shared approval dialog (`app/approval.ts`), by shape. */
export interface ApprovePort {
  approve(r: { title: string; command: string; scope?: string; destructive?: boolean; reasonRequired?: boolean }): Promise<{ approved: boolean; reason: string; decidedAt: number }>;
}

/** The audit log (`audit_record`), by shape. */
export interface AuditPort {
  record(root: string, e: { feature: string; action: string; command: string; scope?: string; approved: boolean; reason?: string; outcome?: "sent" | "ok" | "failed"; decidedAt?: number }): Promise<void>;
}

export type ProtectKey = "blockedTitle" | "blockedScope" | "refused" | "redactedTitle" | "redacted";
export type Copy = (k: ProtectKey, p?: Record<string, string | number>) => string;

export interface ProtectDeps {
  protect: ProtectPort;
  approval: ApprovePort;
  audit: AuditPort;
  root(): string | null;
  toast(m: string): void;
  copy: Copy;
}
