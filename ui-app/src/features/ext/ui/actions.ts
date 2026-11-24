/* ═══════════ feature `ext` — delegated event dispatch (ADR-0002) ═══════════
   O ÚNICO listener delegado das extensões. O markup emite `data-action` (o nome da acção) e
   um `data-on` opcional (o único payload, em string); este módulo liga um só handler ao
   `document`, sobe do alvo do evento até ao `[data-action]` mais próximo e corre a entrada
   da tabela. Payload sempre em `data-on` (o harness golden strippa exactamente
   `data-action`/`data-on`).

   Cablagem pura: nunca toca em `window`, no bridge nem no domínio. A tabela de acções é
   construída pelo resíduo `features/ext.ts`. Mesmo mecanismo de
   `features/learn/ui/actions.ts`, com chave de handler própria. Hoje só a página de
   contribuições de um VSIX e a linha do Open VSX o usam; o resto do markup das extensões
   ainda tem `onclick` inline (passa para aqui na migração U5). */

/** Uma acção disparada: o payload `data-on` descodificado, o próprio elemento
 *  `[data-action]` e o `value` do elemento quando é input/select. */
export interface ActionEvent {
  on: string;
  el: HTMLElement;
  value: string;
}

/** Uma entrada da tabela: a que evento DOM responde e o que faz. */
export interface ActionSpec {
  on: "click" | "change" | "input";
  run: (e: ActionEvent) => void;
}

export type ActionTable = Record<string, ActionSpec>;

/* O handler guarda-se no `document` para que uma reavaliação da feature (o harness
   reimporta toda a cadeia por teste) substitua a ligação anterior em vez de empilhar uma
   segunda. A chave é própria da feature `ext`, por isso coexiste com os listeners das
   outras features e cada um ignora as acções do outro (lookup = undefined). */
const HANDLER_KEY = "__extActionHandler__";
const EVENTS = ["click", "change", "input"] as const;

/** Instala o único listener delegado. Idempotente: uma segunda chamada troca a tabela e
 *  larga o handler anterior, para que re-arranques nunca dupliquem disparos. */
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
