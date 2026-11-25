/* ═════════ feature `project`: legacy bridge (ADR-0002) ═════════
   The ONLY file of `features/project/` allowed to touch `window` (A8): the folder open in
   the desktop app (`DXR`), the monolith's tabs, toasts and dialogs, git (the published
   `checkout`, which keeps Source Control in sync, and `git log` for the commits that cite
   issue keys) and Co-Dev (the agent works on an issue). Publishes nothing on `window`. */

import { shellClient } from "../../../platform/tauri/shell";
import { translator } from "../../../app/i18n";
import { PROJECT_ENGINE_MESSAGES } from "../application/messages";
import { isDesktop } from "../../../platform/tauri/core";
import type { CodevPort, Commit, Dialog, Git, IssuePrompt, Notifier, Workspace } from "../application/ports";
import { codevIssue } from "../../../app/codev-issue";
import type { Issue, Project } from "../domain/types";

const G = window as unknown as {
  DXR?: { root?: string | null; git?: boolean; reloadDisk?: () => Promise<unknown>; flush?: () => void; idle?: () => Promise<unknown> };
  openTab?: (t: { id: string; title: string; kind: string }) => void;
  ROOT?: string;
  openDiff?: (p: string) => void;
  openPath?: (p: string, line?: number) => void;
  toast?: (m: string) => void;
  checkout?: (branch: string, create?: boolean) => unknown;
  codevAgentStory?: (s: { id: string; title: string; type: string; pts: number; note?: string }) => Promise<void> | null;
  codevAgentAvailable?: () => boolean;
};

const shell = shellClient();
let me = "";

export const workspace: Workspace = {
  root: () => G.DXR?.root ?? null,
  me: () => me,
};

/** Who "mine" means: the project's `git config user.name` (read once per folder). */
export async function loadMe(root: string): Promise<void> {
  if (!isDesktop()) return;
  try {
    const r = await shell.exec({ program: "git", args: ["config", "user.name"], cwd: root });
    me = r.code === 0 ? r.stdout.trim() : "";
  } catch {
    me = "";
  }
}

export const git: Git = {
  available: () => !!G.DXR?.git,
  async branch(name) {
    if (typeof G.checkout !== "function") throw new Error(translator(PROJECT_ENGINE_MESSAGES)("noScm"));
    await G.checkout(name, true);
  },
  async log(): Promise<Commit[]> {
    const root = G.DXR?.root;
    if (!root) return [];
    const r = await shell.exec({ program: "git", args: ["log", "--all", "-n", "1000", "--format=%H%x1f%s%x1f%ct"], cwd: root });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "git log falhou");
    return r.stdout
      .split("\n")
      .filter(Boolean)
      .map((l) => l.split("\x1f"))
      .filter((p) => p.length >= 3)
      .map(([hash, subject, ct]) => ({ hash, subject, at: Number(ct) * 1000 }));
  },
};

export const codev: CodevPort = {
  available: () => typeof G.codevAgentAvailable === "function" && G.codevAgentAvailable(),
  work(i: Issue, p: Project) {
    const note = [i.description, ...i.acceptance.map((c) => `- [${c.done ? "x" : " "}] ${c.text}`), p.dod.length ? `Definition of Done: ${p.dod.join("; ")}` : ""]
      .filter(Boolean)
      .join("\n");
    void G.codevAgentStory?.({ id: i.key, title: i.title, type: i.kind === "bug" ? "fix" : "feature", pts: i.points ?? 0, note });
  },
  workWith(i: Issue, prompt: IssuePrompt) {
    void codevIssue.run({ key: i.key, text: prompt.text, scope: i.scope, template: prompt.version });
  },
};

export const dialog: Dialog = {
  prompt: (m, initial) => window.prompt(m, initial),
  confirm: (m) => window.confirm(m),
};

export const notify: Notifier = { toast: (m) => (G.toast ? G.toast(m) : undefined) };

export const openTab = (t: { id: string; title: string; kind: string }): void => G.openTab?.(t);

/** RF-B04: opens a file of the open folder in the editor (after the disk is read again, so a file
 *  just written is there). */
export async function openProjectFile(rel: string): Promise<void> {
  await G.DXR?.reloadDisk?.();
  G.openPath?.((G.ROOT ?? "") + rel);
}

/** Writes what the editor has to disk and waits for the write queue (before a commit). */
export async function saveEditor(): Promise<void> {
  G.DXR?.flush?.();
  await G.DXR?.idle?.();
}

/** RF-B08: the diff of a file of the open folder (path relative to it), as Source Control opens it. */
export const openDiff = (rel: string): void => G.openDiff?.((G.ROOT ?? "") + rel);
