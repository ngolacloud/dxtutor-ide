/* ═══════════ feature `codebase` — application ports (A10) ═══════════ */
import type { DepsReport, OnboardMap } from "../domain/types";

export interface CodebasePort {
  deps(root: string, online: boolean): Promise<DepsReport>;
  map(root: string): Promise<OnboardMap>;
}
export interface WorldPort {
  root(): string | null;
  runInTerminal(cmd: string): void;
  /** open a project file (relative path) */
  open(rel: string): void;
  /** the Testing pane (to run the tests after an update) */
  showTests(): void;
}
export interface HumanPort { confirm(m: string): boolean; toast(m: string): void }
export interface CodevPort {
  available(): boolean;
  ask(r: { intent: "explain" | "change"; text: string; context: Array<{ kind: "file" | "problem"; label: string; text: string; path?: string }>; send?: boolean }): void;
}
