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
  /** The exact prompt the issue goes to Co-Dev with (RF-B03): `{text, lang, source, version, tokens}`. */
  issuePrompt?(root: string, key: string): Promise<unknown>;
  /** The Co-Dev audit log (RF-T01) of one issue, or of the folder with `null`. */
  audit?(root: string, issue: string | null): Promise<unknown>;
  /** RF-A05: the repository against the architect's rules (`arch_conformance`). */
  conformance?(root: string): Promise<unknown>;
  /** Multi Co-Dev (phase 1): the parallel plan of a sprint (`project_sprint_plan`, read-only). */
  sprintPlan?(root: string, sprint: string | null, codevs: number | null): Promise<unknown>;
  /** Board B: what choosing a method changes in the settings (`project_method_preview`, read-only). */
  methodPreview?(root: string, method: string, lang: string): Promise<unknown>;
  /** `/project`: creates the Project from `.dxtutor/backlog.json` and the plan Co-Dev proposed
   *  (`project_create_from_backlog`; the file must still be the one the plan was made from — `hash`). */
  createFromBacklog?(root: string, hash: string, plan: unknown, ready: boolean, lang: string, draftRoot?: string | null): Promise<unknown>;
}

export interface Workspace {
  /** The Project's folder (H2: the current project of the workspace), or `null`. */
  root(): string | null;
  /** H2: the workspace's folder (where the backlog draft lives), when different from the project's. */
  workspaceRoot?(): string | null;
  /** Who "mine" means (the project's git user). */
  me(): string;
  /** The folder's detected test command (`cargo test`, `npm test`…): the default mandatory check. */
  testCommand?(): string | null;
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
  /** The template's own text (before filling), for «Edit template». */
  template: string;
}

/** The project's prompt template files (RF-B04, F4): written inside the open folder and opened in
 *  the editor. Changes to `.dxtutor/prompts/` are the architect's or the tech lead's (F5.7). */
export interface TemplateFiles {
  write(root: string, rel: string, content: string): Promise<void>;
  open(rel: string): Promise<void>;
  /** The template's own commit (`arch_rules_commit`: only that file; the architect or the tech
   *  lead), after the editor is written to disk. Returns the short hash. */
  commit(root: string, rel: string, message: string): Promise<string>;
}

export interface Dialog {
  prompt(message: string, initial?: string): string | null;
  confirm(message: string): boolean;
}

export interface Notifier {
  toast(message: string): void;
}

/** The shared approval dialog (`app/approval.ts`), by its shape: the human confirms the exact action. */
export interface HumanPort {
  approve(req: { title: string; command: string; scope?: string }): Promise<{ approved: boolean }>;
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
  /** RF-P03: may this side run an issue with Co-Dev (PairCode: only the driver)? */
  canDrive?(): boolean;
  navigatorMessage?: string;
  /** Hands the human a file to save (the audit log export). */
  download?(name: string, text: string): void;
  /** «Edit template» (desktop only). */
  templates?: TemplateFiles;
  /** RF-A05: show only these files in the Problems panel (`app/problems-scope`). */
  showInProblems?(label: string, files: string[]): void;
  /** Opens a file of the open folder at a line. */
  openAt?(rel: string, line: number): void;
  /** The language of the method's DoR/DoD suggestions (`pt` or `en`); without it, `pt`. */
  lang?(): "pt" | "en";
  /** Confirms an action that changes the Project from outside its views (`/project`). */
  human?: HumanPort;
}
