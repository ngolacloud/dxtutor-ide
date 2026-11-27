/* ═══════════ feature `ops` — application ports (A9) ═══════════ */

import type { DataSource, EvidenceFile, Runbook, StepRun } from "../domain/types";
import type { MetricsOverview } from "../domain/metrics";
import type { AcceptedRisk, ApplyInfo, CloudCli, CloudInventory, IacPlan, IacState, KubeState, KubeTarget, PipelineRun, Revision, Stage } from "../domain/types";

export interface OpsPort {
  iacDirs(root: string): Promise<string[]>;
  /** a plan or (refreshOnly) the drift — read only, nothing kept */
  iacPlan(root: string, dir: string, refreshOnly: boolean): Promise<IacPlan>;
  /* r23 F4b */
  pipeline(root: string, dir: string, target: string | null): Promise<PipelineRun>;
  /** the stages as they start and end (`iac://stage`) */
  onStage(f: (e: { root: string; dir: string; stage: Stage }) => void): void;
  /** the command that applies the reviewed plan; rejects (in Rust) a blocked or changed one */
  applyCommand(root: string, dir: string, planId: string): Promise<ApplyInfo>;
  iacState(root: string, dir: string): Promise<IacState>;
  risks(root: string): Promise<AcceptedRisk[]>;
  /** kept for 30 days and audited by the backend */
  acceptRisk(root: string, r: { key: string; kind: "finding" | "drift"; label: string; reason: string }): Promise<AcceptedRisk>;
  revokeRisk(root: string, id: number): Promise<boolean>;
  /* r23 F5a */
  runbooks(root: string): Promise<Runbook[]>;
  /** a check runs only when read-only, an action only with an approval (audited in Rust) — the backend's rule */
  runStep(root: string, path: string, n: number, runId: string, approval: { reason: string } | null, vault: { addr: string; namespace: string | null } | null): Promise<StepRun>;
  decide(root: string, path: string, n: number, runId: string, note: string): Promise<StepRun>;
  judge(root: string, id: number, matched: boolean, note: string): Promise<boolean>;
  runs(root: string, path: string | null): Promise<StepRun[]>;
  sources(root: string): Promise<DataSource[]>;
  /** the metrics source: the budgets and the capacity, as measured now */
  metrics(root: string): Promise<MetricsOverview>;
  /** the Prometheus read token into the keychain (audited by the backend, never returned) */
  metricsTokenSet(root: string, url: string, token: string): Promise<void>;
  metricsTokenClear(root: string, url: string): Promise<void>;
  /** writes docs/audit/evidence-YYYY-MM.md inside the project (this month so far) */
  exportEvidence(root: string): Promise<EvidenceFile>;
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
  /** runs a command in a terminal task, from the project root; resolves with its exit code */
  runInTerminal(cmd: string): Promise<number> | void;
  /** opens a project file (relative) at a line */
  openFile(rel: string, line: number): void;
  now(): number;
  /** r23 F5a: the file the evidence export wrote, into the editor (relative path) */
  showFile(rel: string, content: string): void;
  /** the Vault the IDE is signed in to (an action's step gets its environment), null otherwise */
  vault(): { addr: string; namespace: string | null } | null;
  /** calls `f` every `ms` (the scheduled drift check); returns how to stop */
  every(ms: number, f: () => void): () => void;
}

/** O pedido de aprovação: a forma do `app/approval.ts` (a composição liga-os; tipagem estrutural). */
export interface ApprovalRequest { title: string; command: string; scope?: string; destructive?: boolean; reasonRequired?: boolean; confirmText?: string }
export interface ApprovalDecision { approved: boolean; reason: string; decidedAt: number }

export interface HumanPort {
  /** mostra o comando exacto e onde corre; resolve com a decisão (não corre nada) */
  approve(r: ApprovalRequest): Promise<ApprovalDecision>;
  text(placeholder: string, initial?: string): Promise<string | null>;
  /** a hidden field for a pasted secret (the token): resolved once, not kept */
  secret(title: string): Promise<string | null>;
  toast(message: string): void;
}

/** O registo de auditoria (r23 F1, RF-BK-L01): cada operação aprovada ou recusada, com o comando. */
export interface AuditPort {
  record(e: { action: string; command: string; scope: string; approved: boolean; reason: string; decidedAt: number; outcome?: "sent" | "ok" | "failed" }): Promise<void>;
}

export interface CodevPort {
  available(): boolean;
  ask(r: { intent: "explain" | "change"; text: string; context: Array<{ kind: "problem" | "file"; label: string; text: string; path?: string }>; send?: boolean }): void;
}
