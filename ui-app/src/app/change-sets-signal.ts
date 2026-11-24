/* ═════════ dxtutor IDE — «the Co-Dev change sets changed» (RF-E08, docs/v2/RF-DELONIX-PLANO.md F2.7) ═════════
   Co-Dev tells it when a block was applied or Auto's validation ended (that is when the backend
   records the accepted hunks in the project store); the Source Control pane listens and asks for
   its «Co-Dev change sets» again. Several signals in a row are one refresh. No window global. */

const listeners = new Set<() => void>();
let queued = false;

export const changeSetsSignal = {
  /** Co-Dev: the recorded change sets may have changed. */
  notify(): void {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      listeners.forEach((f) => f());
    });
  },
  /** Source Control: call `f` after each (coalesced) signal; returns the unsubscribe. */
  subscribe(f: () => void): () => void {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
