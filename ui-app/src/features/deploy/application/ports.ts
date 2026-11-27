/* ═══════════ feature `deploy` — application ports (r23 F4c2) ═══════════ */
import type { DeployPlan, DeployRecord, TargetArg } from "../domain/types";

export interface DeployPort {
  plan(root: string, target: TargetArg): Promise<DeployPlan>;
  /** production: `confirm` = "production" and a reason — checked in Rust */
  rollout(root: string, planId: string, confirm: string | null, reason: string | null, waivers: Array<{ gate: string; reason: string }>): Promise<DeployRecord>;
  records(root: string, shas: string[] | null): Promise<DeployRecord[]>;
  onOutput(f: (planId: string, line: string) => void): void;
}

export interface ApprovalRequest { title: string; command: string; scope?: string; destructive?: boolean; reasonRequired?: boolean; confirmText?: string }
export interface ApprovalDecision { approved: boolean; reason: string; decidedAt: number }
export interface HumanPort {
  approve(r: ApprovalRequest): Promise<ApprovalDecision>;
  text(placeholder: string, initial?: string): Promise<string | null>;
  toast(message: string): void;
}

export interface WorldPort {
  root(): string | null;
  /** the environment's cluster (Environments), staging's for production, and the Vault the IDE points at */
  target(env: string): TargetArg;
  openTab(): void;
}
