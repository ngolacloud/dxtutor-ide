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
  /** Who drives, for the audit log (`null` outside a session). */
  driver(): string | null {
    return pairState.view()?.driver ?? null;
  },
};

/** The message when the navigator tries to drive Co-Dev. */
export const NAVIGATOR_MESSAGE = "Na sessão PairCode só quem conduz executa issues com o Co-Dev e aprova as propostas dele: pede o controlo.";
