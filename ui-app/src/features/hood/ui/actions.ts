/* ═══════════ feature `hood` — delegated event dispatch (A8) ═══════════
   O ÚNICO listener delegado da feature: o markup emite `data-action` + `data-on`; um só handler no
   `document` (chave própria) corre a entrada da tabela pelo tipo de evento. Cablagem pura. */

export interface ActionEvent { on: string; el: HTMLElement; value: string }
export interface ActionSpec { on: "click" | "change" | "input"; run: (e: ActionEvent) => void }
export type ActionTable = Record<string, ActionSpec>;

const HANDLER_KEY = "__hoodActionHandler__";
const EVENTS = ["click", "change", "input"] as const;

export function bindActions(table: ActionTable): void {
  const doc = document as Document & { [HANDLER_KEY]?: EventListener };
  const prev = doc[HANDLER_KEY];
  if (prev) for (const type of EVENTS) document.removeEventListener(type, prev);
  const handle: EventListener = (ev) => {
    const el = (ev.target as HTMLElement | null)?.closest<HTMLElement>("[data-action]");
    if (!el) return;
    const spec = table[el.dataset.action ?? ""];
    if (!spec || spec.on !== ev.type) return;
    spec.run({ on: el.dataset.on ?? "", el, value: (el as HTMLInputElement).value ?? "" });
  };
  doc[HANDLER_KEY] = handle;
  for (const type of EVENTS) document.addEventListener(type, handle);
}
