/* ═══════════ feature `arch` — despacho delegado de eventos (ADR-0002) ═══════════
   O ÚNICO listener delegado do Studio de arquitectura. O markup emite `data-action` (o
   nome da acção) e um `data-on` opcional (o único payload, em string); este módulo liga um
   só handler ao `document`, sobe do alvo até ao `[data-action]` mais próximo e corre a
   entrada da tabela. Mesmo mecanismo das outras features, com chave de handler própria.
   Cablagem pura: nunca toca em `window`; a tabela é construída pela raiz de composição. */

export interface ActionEvent {
  on: string;
  el: HTMLElement;
  /** `value` do input/select (vazio nos outros elementos). */
  value: string;
  /** `checked` de uma checkbox. */
  checked: boolean;
}

export interface ActionSpec {
  on: "click" | "change" | "input";
  run: (e: ActionEvent) => void;
}

export type ActionTable = Record<string, ActionSpec>;

const HANDLER_KEY = "__archActionHandler__";
const EVENTS = ["click", "change", "input"] as const;

/** Instala o único listener delegado. Idempotente: uma segunda chamada troca a tabela e
 *  larga o handler anterior. */
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
    const input = el as HTMLInputElement;
    spec.run({ on: el.dataset.on ?? "", el, value: input.value ?? "", checked: input.checked === true });
  };

  doc[HANDLER_KEY] = handle;
  for (const type of EVENTS) document.addEventListener(type, handle);
}
