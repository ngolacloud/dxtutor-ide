/* ═══════════ feature `scm` — domain: the Commit Graph's refs (r23 F3, UI-SCM-08) ═══════════
   The shape of `git_refs` (tutor_eval::gitwork::Refs) and what the graph derives from it: the labels on a
   commit row (current branch, local branches, remote branches, tags) and a commit's files from `git show`.
   Short hashes differ in length between git outputs, so commits are matched on their first 7 characters.
   PURE: no DOM, no window. */

export interface RefBranch { name: string; sha: string; upstream: string | null; ahead: number; behind: number; gone: boolean; current: boolean }
export interface RefRemoteBranch { remote: string; name: string; sha: string }
export interface RefTag { name: string; sha: string; annotated: boolean }
export interface RefStash { index: number; message: string; time: number }
export interface RefWorktree { path: string; branch: string | null; head: string; current: boolean; detached?: boolean; locked?: boolean; prunable?: boolean }
export interface RefContributor { name: string; email: string; commits: number }
export interface RefsSnapshot {
  head: string | null;
  headSha: string | null;
  branches: RefBranch[];
  remotes: string[];
  remoteBranches: RefRemoteBranch[];
  tags: RefTag[];
  stashes: RefStash[];
  worktrees: RefWorktree[];
  contributors: RefContributor[];
}

export type RefKind = "head" | "branch" | "remote" | "tag";
export interface RefLabel { kind: RefKind; name: string }

export const short7 = (sha: string): string => sha.slice(0, 7);

/** The labels on one commit, in reading order: HEAD's branch, the other local branches, remote branches, tags. */
export function refLabelsAt(r: RefsSnapshot, sha: string): RefLabel[] {
  const h = short7(sha), out: RefLabel[] = [];
  for (const b of r.branches) if (short7(b.sha) === h) out.push({ kind: b.current ? "head" : "branch", name: b.name });
  out.sort((a, b) => (a.kind === "head" ? -1 : b.kind === "head" ? 1 : 0));
  for (const b of r.remoteBranches) if (short7(b.sha) === h) out.push({ kind: "remote", name: `${b.remote}/${b.name}` });
  for (const t of r.tags) if (short7(t.sha) === h) out.push({ kind: "tag", name: t.name });
  return out;
}

/** Remote branches grouped by remote, in the order `git remote` lists them. */
export function remoteGroups(r: RefsSnapshot): Array<{ remote: string; branches: RefRemoteBranch[] }> {
  return r.remotes.map((remote) => ({ remote, branches: r.remoteBranches.filter((b) => b.remote === remote) }));
}

/** The files a commit touched, from `git show --stat --patch` (the `diff --git a/… b/…` headers). */
export function filesOfShow(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)) if (!out.includes(m[2])) out.push(m[2]);
  return out;
}

/** «ahead 2 · behind 1» parts of a branch, or nothing when in sync / no upstream. */
export function trackOf(b: RefBranch): { ahead: number; behind: number; gone: boolean } | null {
  if (b.gone) return { ahead: 0, behind: 0, gone: true };
  if (!b.upstream || (!b.ahead && !b.behind)) return null;
  return { ahead: b.ahead, behind: b.behind, gone: false };
}
