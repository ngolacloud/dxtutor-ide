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

export interface HumanPort {
  confirm(message: string): boolean;
  text(placeholder: string, initial?: string): Promise<string | null>;
  toast(message: string): void;
}

export interface CodevPort {
  available(): boolean;
  ask(r: { intent: "explain" | "change"; text: string; context: Array<{ kind: "problem" | "file"; label: string; text: string; path?: string }>; send?: boolean }): void;
}
