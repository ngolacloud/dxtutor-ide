/* ═══════════ Co-Dev — delegated event dispatch (ADR-0002, Phase 4) ═══════════
   The ONE delegated listener for the whole Co-Dev feature. Components render
   markup carrying `data-action` (the action name) and an optional `data-on`
   (its single string payload); this module binds a single handler to the
   document for `click`, `change` and `input`, walks up from the event target to
   the nearest `[data-action]`, and runs the matching entry from the action
   table. No more inline handler attributes resolving free names on `window`.

   Why `data-on` for the payload (and not `data-mode`/`data-ckpt`/…): the golden
   harness (`tests/harness.ts`, `STRIPPED_ATTRS`) removes exactly `data-action`
   and `data-on` before comparing snapshots — so the whole migration off inline
   handlers is invisible to the goldens only while every payload travels in
   `data-on`. A bespoke `data-*` per action would leak into the snapshot.

   This file is pure wiring: it never touches `window`, the bridge or the
   domain. The action table (the effects) is built by `features/codev.ts`, the
   one place that has both the Co-Dev-local functions and the legacy bridge. */

/** A fired action: the decoded `data-on` payload, the `[data-action]` element
 *  itself (for the handlers that need `this`, e.g. `testProv(k, btn)` or the
 *  threshold slider reading its sibling), and the element's `value` when it is
 *  an input/select. The browser has already decoded HTML entities in `data-on`,
 *  so `on` is the plain string the component escaped on the way out. */
export interface ActionEvent {
  on: string;
  el: HTMLElement;
  value: string;
}

/** One table entry: which DOM event it answers to, and what it does. Keeping
 *  the event type on the entry is what lets a single physical listener serve
 *  click buttons, `change` on selects/inputs and `input` on the range slider
 *  without one firing another's handler (e.g. an `input` on a text field must
 *  NOT run a `change`-only handler on every keystroke). */
export interface ActionSpec {
  on: "click" | "change" | "input";
  run: (e: ActionEvent) => void;
}

export type ActionTable = Record<string, ActionSpec>;

/* The handler is stored on the document so a re-evaluation of the feature (the
   test harness reimports the whole module chain per test) replaces the previous
   binding instead of stacking a second one. */
const HANDLER_KEY = "__codevActionHandler__";
const EVENTS = ["click", "change", "input"] as const;

/** Install the single delegated listener. Idempotent: a second call swaps the
 *  table in and drops the previous handler, so repeated boots never double-fire. */
export function bindActions(table: ActionTable): void {
  const doc = document as Document & { [HANDLER_KEY]?: EventListener };
  const prev = doc[HANDLER_KEY];
  if (prev) for (const type of EVENTS) document.removeEventListener(type, prev);

  const handle: EventListener = (ev) => {
    const target = ev.target as HTMLElement | null;
    const el = target?.closest<HTMLElement>("[data-action]");
    if (!el) return;
    const spec = table[el.dataset.action ?? ""];
    if (!spec || spec.on !== ev.type) return;
    spec.run({
      on: el.dataset.on ?? "",
      el,
      value: (el as HTMLInputElement).value ?? "",
    });
  };

  doc[HANDLER_KEY] = handle;
  for (const type of EVENTS) document.addEventListener(type, handle);
}
