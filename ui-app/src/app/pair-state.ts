/* ═════════ dxtutor IDE — who drives a PairCode session (docs/v2/RF-DELONIX-PLANO.md F6.2/F6.3) ═════════
   RF-P03: during a session only the driver runs an issue with Co-Dev or approves its proposals;
   RF-P04: the audit log says who was driving when a change was accepted. `pair.ts` registers how
   to read its state here; Co-Dev and the Project import this module (no window global).
   Outside a session everything is allowed, as before. */

export interface PairView {
  /** A PairCode session is connected. */
  inSession: boolean;
  /** Who drives now (`host` or `guest`). */
  driver: "host" | "guest";
  /** This machine's role. */
  me: "host" | "guest";
}

let read: (() => PairView | null) | null = null;
/* RF-S09: Co-Dev's live hunks go to the guest, who draws them in its editor */
let codevSend: ((e: unknown) => void) | null = null;
let codevReceive: ((e: unknown) => void) | null = null;

/** The hunk events the guest mirrors (the overlay's events; nothing else of the agent). */
export const MIRRORED_KINDS = ["hunk_start", "hunk_chunk", "hunk_end", "hunk_review", "hunk_applied", "hunk_rejected", "hunk_stale", "validation", "done"];

export const pairState = {
  /** `pair.ts`: how to read the session. */
  register(f: () => PairView | null): void {
    read = f;
  },
  view(): PairView | null {
    const v = read?.() ?? null;
    return v && v.inSession ? v : null;
  },
  /** May this machine drive Co-Dev (run an issue, approve a proposal)? */
  canDrive(): boolean {
    const v = pairState.view();
    return !v || v.driver === v.me;
  },
  /** `pair.ts`: how to send a Co-Dev event to the guest (only while hosting a live session). */
  registerCodevSend(f: (e: unknown) => void): void {
    codevSend = f;
  },
  /** Co-Dev (on the guest): what to do with an event from the host's Co-Dev. */
  onCodev(f: (e: unknown) => void): void {
    codevReceive = f;
  },
  /** Co-Dev (on the host): a live hunk event, mirrored to the guest when there is one. */
  codevOut(e: { kind: string }): void {
    if (MIRRORED_KINDS.includes(e.kind)) codevSend?.(e);
  },
  /** `pair.ts` (on the guest): an event from the host's Co-Dev. */
  codevIn(e: unknown): void {
    codevReceive?.(e);
  },
  /** Who drives, for the audit log (`null` outside a session). */
  driver(): string | null {
    return pairState.view()?.driver ?? null;
  },
};

/** The message when the navigator tries to drive Co-Dev. */
export const NAVIGATOR_MESSAGE = "Na sessão PairCode só quem conduz executa issues com o Co-Dev e aprova as propostas dele: pede o controlo.";
