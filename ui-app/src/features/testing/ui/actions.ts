/* ═══════════ feature `testing` — delegated event dispatch (ADR-0005, R2a) ═══════════
   O ÚNICO listener delegado da feature Testing: o pane emite markup com `data-action`
   (o nome da acção) e um `data-on` opcional (o payload em string); um só handler no
   `document` sobe do alvo até ao `[data-action]` mais próximo e corre a entrada da tabela
   (o `closest` faz o «▶» de uma linha não disparar também a acção da linha). Cópia do
   mecanismo de `features/debug/ui/actions.ts`, com chave própria para as features
   coexistirem no mesmo `document`. Cablagem pura: não toca em `window` nem no domínio. */

/** Uma acção disparada: o payload `data-on` descodificado, o próprio elemento
 *  `[data-action]` e o `value` do elemento quando é input/select. */
export interface ActionEvent {
  on: string;
  el: HTMLElement;
  value: string;
}

/** Uma entrada da tabela: a que evento DOM responde e o que faz. Manter o tipo de
 *  evento na entrada é o que permite a um só listener físico servir botões `click`,
 *  `change` e `input` sem um disparar o handler do outro. */
export interface ActionSpec {
  on: "click" | "change" | "input";
  run: (e: ActionEvent) => void;
}

export type ActionTable = Record<string, ActionSpec>;

const HANDLER_KEY = "__testingActionHandler__";
const EVENTS = ["click", "change", "input"] as const;

/** Instala o único listener delegado. Idempotente: uma segunda chamada troca a tabela
 *  e larga o handler anterior, para que re-arranques nunca dupliquem disparos. */
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
