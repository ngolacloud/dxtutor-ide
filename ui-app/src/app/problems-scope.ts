/* ═════════ dxtutor IDE — «show these files in Problems» (RF-A05, docs/v2/RF-DELONIX-PLANO.md F5.6) ═════════
   The Project's issue panel asks the Problems panel to show only the files of one issue (the ones
   Co-Dev changed for it, from its change sets); the panel listens, filters and opens the tab. A
   registry, so neither feature imports the other. No window global. */

export interface ProblemsScope {
  /** What the filter is called in the toolbar (the issue key). */
  label: string;
  /** Paths relative to the open folder. */
  files: string[];
}

const listeners = new Set<(s: ProblemsScope) => void>();

export const problemsScope = {
  /** The Project: show only these files in Problems. */
  show(s: ProblemsScope): void {
    listeners.forEach((f) => f(s));
  },
  /** The Problems panel: apply a scope when asked; returns the unsubscribe. */
  subscribe(f: (s: ProblemsScope) => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
