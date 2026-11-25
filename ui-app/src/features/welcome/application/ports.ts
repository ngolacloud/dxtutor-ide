/* ═══════════ feature `welcome` — application ports (r23 F6) ═══════════ */

export interface ClonePlan { url: string; parent: string; name: string; target: string; exists: boolean; command: string }

export interface WorkspacePort {
  /** the desktop app (folders on disk, git) */
  desktop(): boolean;
  home(): string | null;
  /** the real history of opened folders, newest first (`dx-recent`) */
  recent(): string[];
  /** opens `path`, or asks for a folder with the system dialog */
  open(path?: string): Promise<void>;
}

export interface GitPort {
  /** the exact command and the folder, built by the backend (`git_clone_plan`) */
  clonePlan(url: string, parent: string): Promise<ClonePlan>;
  /** runs it (`git_clone`) and returns the new folder */
  clone(url: string, parent: string): Promise<string>;
}

/** The request of `app/approval.ts` (structural type; the composition links them). */
export interface ApprovalRequest { title: string; command: string; scope?: string; destructive?: boolean; reasonRequired?: boolean; confirmText?: string }
export interface ApprovalDecision { approved: boolean; reason: string; decidedAt: number }

export interface HumanPort {
  approve(r: ApprovalRequest): Promise<ApprovalDecision>;
  text(placeholder: string, initial?: string): Promise<string | null>;
  toast(message: string): void;
}

/** The audit log (r23 F1, RF-BK-L01), keyed by the folder the operation is about. */
export interface AuditPort {
  record(root: string, e: { action: string; command: string; scope: string; approved: boolean; reason: string; decidedAt: number; outcome?: "sent" | "ok" | "failed" }): Promise<void>;
}

/** The per-viewer progress (local storage). */
export interface StatePort { load(): unknown; save(v: unknown): void }
