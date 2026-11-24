/* ═════════ dxtutor IDE — tab decorations (A1, UI-PAIR-01/02) ═════════
   How another module marks the editor tabs without `tabs.ts` knowing it: PairCode marks each
   tab shared or private and adds the «Shared with …» legend. `drawTabs` calls `decorate` for
   every tab it draws and `after` once the bar is complete. No window: both sides import this. */

export interface TabLike {
  id: string;
  title?: string;
  kind?: string;
  path?: string;
}

let decorate: ((t: TabLike, el: HTMLElement) => void) | null = null;
let after: ((bar: HTMLElement) => void) | null = null;

export const tabMarks = {
  set(d: ((t: TabLike, el: HTMLElement) => void) | null, a: ((bar: HTMLElement) => void) | null): void {
    decorate = d;
    after = a;
  },
  decorate(t: TabLike, el: HTMLElement): void {
    decorate?.(t, el);
  },
  after(bar: HTMLElement): void {
    after?.(bar);
  },
};
