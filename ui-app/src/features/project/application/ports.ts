/* ═════════ feature `project` — ports (what the use case needs from the world) ═════════ */

import type { Issue, Project } from "../domain/types";

/** The project store (Tauri commands `project_*`); payloads are narrowed by the domain. */
export interface ProjectGateway {
  /** Desktop with the store available. */
  available(): boolean;
  load(root: string): Promise<unknown>;
  apply(root: string, op: Record<string, unknown>): Promise<unknown>;
  issue(root: string, key: string): Promise<unknown>;
  reports(root: string): Promise<unknown>;
  /** The exact prompt the issue goes to Co-Dev with (RF-B03): `{text, lang, source, version, tokens}`. */
  issuePrompt?(root: string, key: string): Promise<unknown>;
  /** The Co-Dev audit log (RF-T01) of one issue, or of the folder with `null`. */
  audit?(root: string, issue: string | null): Promise<unknown>;
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
  /** F4: sends the issue with its exact prompt (template rendered by the backend). */
  workWith?(issue: Issue, prompt: IssuePrompt): void;
}

/** The prompt an issue goes to Co-Dev with (`project_issue_prompt`, RF-B03/B04). */
export interface IssuePrompt {
  text: string;
  lang: string;
  source: string;
  version: string;
  tokens: number;
}

export interface Dialog {
  prompt(message: string, initial?: string): string | null;
  confirm(message: string): boolean;
}

export interface Notifier {
  toast(message: string): void;
}

export interface ProjectDeps {
  gateway: ProjectGateway;
  workspace: Workspace;
  git: Git;
  codev: CodevPort;
  dialog: Dialog;
  notify: Notifier;
  now(): number;
  /** Hands the human a file to save (the audit log export). */
  download?(name: string, text: string): void;
}
