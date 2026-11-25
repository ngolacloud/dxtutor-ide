/* ═══════════ feature `ops` — application ports (A9) ═══════════ */

import type { CloudCli, CloudInventory, IacPlan, KubeState, KubeTarget, Revision } from "../domain/types";

export interface OpsPort {
  iacDirs(root: string): Promise<string[]>;
  iacPlan(root: string, dir: string, refreshOnly: boolean): Promise<IacPlan>;
  kubeState(t: KubeTarget): Promise<KubeState>;
  kubeHistory(t: KubeTarget, deployment: string): Promise<Revision[]>;
  cloudStatus(): Promise<CloudCli[]>;
  cloudInventory(provider: string): Promise<CloudInventory>;
}

export interface OpsWorld {
  /** the open folder (null without one, and in the browser) */
  root(): string | null;
  /** where the Infra pane points kubectl (null when no cluster is connected there) */
  kubeTarget(): KubeTarget | null;
  /** runs a command in a terminal task, from the project root */
  runInTerminal(cmd: string): void;
}

/** O pedido de aprovação: a forma do `app/approval.ts` (a composição liga-os; tipagem estrutural). */
export interface ApprovalRequest { title: string; command: string; scope?: string; destructive?: boolean; reasonRequired?: boolean; confirmText?: string }
export interface ApprovalDecision { approved: boolean; reason: string; decidedAt: number }

export interface HumanPort {
  /** mostra o comando exacto e onde corre; resolve com a decisão (não corre nada) */
  approve(r: ApprovalRequest): Promise<ApprovalDecision>;
  text(placeholder: string, initial?: string): Promise<string | null>;
  toast(message: string): void;
}

export interface CodevPort {
  available(): boolean;
  ask(r: { intent: "explain" | "change"; text: string; context: Array<{ kind: "problem" | "file"; label: string; text: string; path?: string }>; send?: boolean }): void;
}
