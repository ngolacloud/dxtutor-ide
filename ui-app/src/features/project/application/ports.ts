/* ═════════ feature `project` — ports (what the use case needs from the world) ═════════ */

import type { Issue, Project } from "../domain/types";
import type { ProjectCopy } from "./messages";

/** The project store (Tauri commands `project_*`); payloads are narrowed by the domain. */
export interface ProjectGateway {
  /** Desktop with the store available. */
  available(): boolean;
  load(root: string): Promise<unknown>;
  apply(root: string, op: Record<string, unknown>): Promise<unknown>;
  issue(root: string, key: string): Promise<unknown>;
  reports(root: string): Promise<unknown>;
}

export interface Workspace {
  /** The folder open in the desktop app, or `null`. */
  root(): string | null;
  /** Who "mine" means (the project's git user). */
  me(): string;
}

export interface Commit {
  hash: string;
  subject: string;
  at: number;
}

export interface Git {
  /** The folder is a git repository. */
  available(): boolean;
  /** Creates and checks out a branch (the exact `git checkout -b <name>`). */
  branch(name: string): Promise<void>;
  /** Recent commits of the repository (any branch). */
  log(): Promise<Commit[]>;
}

/** Co-Dev works on an issue (an agent turn that knows the issue key). */
export interface CodevPort {
  available(): boolean;
  work(issue: Issue, project: Project): void;
}

export interface Dialog {
  prompt(message: string, initial?: string): string | null;
  confirm(message: string): boolean;
}

export interface Notifier {
  toast(message: string): void;
}

export interface ProjectDeps {
  /** Os textos para o humano na língua da interface (`./messages`); sem ela, os de antes (português). */
  copy?: ProjectCopy;
  gateway: ProjectGateway;
  workspace: Workspace;
  git: Git;
  codev: CodevPort;
  dialog: Dialog;
  notify: Notifier;
  now(): number;
}
