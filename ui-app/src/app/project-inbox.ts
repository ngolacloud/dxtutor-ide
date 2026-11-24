/* ═════════ dxtutor IDE — the Project inbox, for other features (A5, PROJ-01) ═════════
   Other features (the Studio's «Generate backlog», later the Learning Track or a retro)
   never write issues into the Project: they send proposals to its inbox, and a human accepts
   or dismisses each one there. The Project feature registers the implementation; without
   it (or outside the desktop app) nothing is sent. No window global. */

export interface Proposal {
  title: string;
  kind: "story" | "bug" | "task" | "spike";
  points: number | null;
  source: string;
  detail: string;
}

let impl: ((items: Proposal[]) => Promise<number>) | null = null;

export const projectInbox = {
  register(f: (items: Proposal[]) => Promise<number>): void {
    impl = f;
  },
  /** Sends the proposals; resolves to how many reached the inbox (0 without a project). */
  propose(items: Proposal[]): Promise<number> {
    return impl && items.length ? impl(items) : Promise.resolve(0);
  },
};
