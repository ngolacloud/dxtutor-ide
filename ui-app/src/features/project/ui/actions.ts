/* ═════════ feature `project` — delegated event dispatch (ADR-0002) ═════════
   The ONE delegated listener of the Project views. Markup carries `data-action` (+ an
   optional `data-on` payload); this module binds one handler per event type to the
   document and runs the table entry for the event. Besides click/change/input it serves
   `keydown` (Enter in the inline forms) and the drag events of the board (moving a card
   is a drop on a column). Pure wiring: never touches `window`; the composition root
   builds the table. */

export interface ActionEvent {
  on: string;
  el: HTMLElement;
  value: string;
  checked: boolean;
  ev: Event;
}

export type ActionEventType = "click" | "change" | "input" | "keydown" | "dragstart" | "dragover" | "dragleave" | "drop";
export type ActionTable = Record<string, Partial<Record<ActionEventType, (e: ActionEvent) => void>>>;

const HANDLER_KEY = "__projectActionHandler__";
const EVENTS: ActionEventType[] = ["click", "change", "input", "keydown", "dragstart", "dragover", "dragleave", "drop"];

export function bindActions(table: ActionTable): void {
  const doc = document as Document & { [HANDLER_KEY]?: EventListener };
  const prev = doc[HANDLER_KEY];
  if (prev) for (const type of EVENTS) document.removeEventListener(type, prev);
  const handle: EventListener = (ev) => {
    let el = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]") ?? null;
    // the first ancestor with an entry for this event type (a card is clickable and draggable)
    while (el) {
      const h = table[el.dataset.action ?? ""]?.[ev.type as ActionEventType];
      if (h) {
        const input = el as HTMLInputElement;
        h({ on: el.dataset.on ?? "", el, value: input.value ?? "", checked: !!input.checked, ev });
        return;
      }
      el = el.parentElement?.closest<HTMLElement>("[data-action]") ?? null;
    }
  };
  doc[HANDLER_KEY] = handle;
  for (const type of EVENTS) document.addEventListener(type, handle);
}
