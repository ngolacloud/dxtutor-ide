/* ═══════════ Co-Dev — use case: whole-file proposals reviewed in the editor, hunk by hunk ═══════════
   For the writers that only have the whole new file (the legacy live chat, the desktop sampler,
   the Explain / Code review panel). `propose` turns it into line-level hunks (`domain/proposal`)
   and feeds them to the SAME live review as the agent v2 (`hunk-review.ts`) as a local session:
   the editor opens the file, types each block in place (old lines struck out) and shows Accept /
   Reject per block. When every block is decided, `review` (which the composition routes here for
   local sessions instead of the backend) writes ONLY the accepted blocks, saves, settles the
   hunks and resolves the proposal with what was accepted. No DOM, no window. */

import type { AgentEvent } from "../domain/agent-events";
import { applyAccepted, proposalHunks, type ProposalHunk } from "../domain/proposal";

export const LOCAL_PREFIX = "local:";

export interface ProposalResult {
  /** blocks accepted and written / rejected / that no longer fitted the file */
  applied: number;
  rejected: number;
  stale: number;
  total: number;
  /** the file before (for «Revert») and after */
  before: string;
  after: string;
}

export interface LocalProposalDeps {
  /** the live review's event sink (`hunkReview.sink.event`) */
  emit(session: string, e: AgentEvent): void;
  /** the file as the editor has it (`null`: it does not exist) */
  read(rel: string): string | null;
  write(rel: string, content: string): void;
  /** saves the editor to disk and waits (so the reload after «applied» reads the new text) */
  flush(): Promise<void>;
}

interface Pending {
  rel: string;
  call: string;
  ids: string[];
  hunks: ProposalHunk[];
  create: boolean;
  resolve: (r: ProposalResult) => void;
}

export function makeLocalProposals(deps: LocalProposalDeps) {
  let seq = 0;
  const pending = new Map<string, Pending>();

  /** Shows `content` as a proposal for `rel` in the editor; resolves when every block is decided.
   *  Nothing to change → resolves at once with `total: 0`. */
  function propose(rel: string, content: string, reason: string): Promise<ProposalResult> {
    const base = deps.read(rel);
    const create = base === null;
    const hunks = create
      ? [{ start: 1, old: "", text: content.endsWith("\n") ? content : content + "\n", added: content.split("\n").length, removed: 0 }]
      : proposalHunks(base, content);
    if (!hunks.length) return Promise.resolve({ applied: 0, rejected: 0, stale: 0, total: 0, before: base ?? "", after: base ?? "" });
    const n = ++seq;
    const session = `${LOCAL_PREFIX}${n}`, call = `local-call-${n}`;
    const ids = hunks.map((_, i) => `local-${n}-${i}`);
    return new Promise((resolve) => {
      pending.set(session, { rel, call, ids, hunks, create, resolve });
      hunks.forEach((h, i) => {
        deps.emit(session, { kind: "hunk_start", hunk: ids[i], call, path: rel, op: create ? "create" : h.removed === 0 ? "insert" : h.added === 0 ? "delete" : "replace", range: { start: h.start, end: h.start + Math.max(0, h.removed - 1) }, base: null, old: h.old } as AgentEvent);
        deps.emit(session, { kind: "hunk_chunk", hunk: ids[i], text: h.text } as AgentEvent);
        deps.emit(session, { kind: "hunk_end", hunk: ids[i], text: h.text, lines: { added: h.added, removed: h.removed } } as AgentEvent);
      });
      deps.emit(session, { kind: "hunk_review", call, hunks: ids, reason } as AgentEvent);
    });
  }

  /** The human decided every block of a local proposal (routed here instead of the backend). */
  async function review(session: string, call: string, decisions: { hunk: string; accept: boolean }[]): Promise<void> {
    const p = pending.get(session);
    if (!p || p.call !== call) throw new Error("this proposal is gone");
    pending.delete(session);
    const accepted = p.ids.map((id) => decisions.find((d) => d.hunk === id)?.accept === true);
    const before = deps.read(p.rel) ?? "";
    let after = before;
    let stale: number[] = [];
    if (accepted.some(Boolean)) {
      if (p.create) after = p.hunks[0].text;
      else ({ text: after, stale } = applyAccepted(before, p.hunks, accepted));
      deps.write(p.rel, after);
      await deps.flush();
    }
    let recorded = false; // Ctrl+Z goes back to the file before the proposal, once
    p.ids.forEach((id, i) => {
      if (stale.includes(i)) deps.emit(session, { kind: "hunk_stale", hunk: id, path: p.rel } as AgentEvent);
      else if (accepted[i]) { deps.emit(session, { kind: "hunk_applied", hunk: id, provisional: false, fingerprint: "", before: recorded ? null : before } as AgentEvent); recorded = true; }
      else deps.emit(session, { kind: "hunk_rejected", hunk: id, by: "human", reason: "rejeitado no editor" } as AgentEvent);
    });
    const applied = accepted.filter((a, i) => a && !stale.includes(i)).length;
    p.resolve({ applied, rejected: accepted.filter((a) => !a).length, stale: stale.length, total: p.ids.length, before, after });
  }

  return {
    propose,
    review,
    isLocal: (session: string): boolean => session.startsWith(LOCAL_PREFIX),
    /** proposals still waiting for a decision */
    open: (): number => pending.size,
  };
}

export type LocalProposals = ReturnType<typeof makeLocalProposals>;
