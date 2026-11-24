/* ═════════ acções delegadas partilhadas (ADR-0004, U5) ═════════
   O listener delegado ÚNICO dos módulos que não têm o seu (`features/<f>/ui/actions.ts`): o markup
   emite `data-action="dono:nome"` e um `data-on` opcional com o payload em string; o dono regista
   a tabela com `registerActions`. Substitui os handlers inline `on*="…"` (que obrigam o CSP a
   aceitar `'unsafe-inline'` no `script-src`).

   Porquê `data-on` para o payload: o harness dos goldens (`tests/harness.ts`) remove exactamente
   `data-action`/`data-on` (e os `on*` inline) antes de comparar — um `data-*` à medida vazaria
   para os snapshots.

   O que mantém o comportamento dos handlers inline:
   - **Primeiro no document.** Este módulo avalia antes de todos os outros (é o primeiro import do
     `main.ts`), por isso o seu listener corre antes dos outros listeners do document (o
     `closeMenus` do boot.ts, o fecho das notificações, o PairCode, os despachantes das features)
     — como um handler inline, que corria no elemento, antes de o evento chegar ao document.
   - **Borbulha como o inline.** Corre, por ordem, cada antepassado do alvo com uma acção registada
     para este tipo de evento (o caminho fixa-se no início, como o do browser: um handler que
     redesenhe não o corta). `stop()` faz o papel do `event.stopPropagation()` do inline: pára os
     antepassados seguintes e, porque este listener é o primeiro, também os outros listeners do
     document (`stopImmediatePropagation`).
   - **Substituição por propriedade.** Um handler inline era a propriedade `onclick` do elemento: o
     código que fazia `el.onclick = f` trocava-o. Por isso, se o elemento tiver a propriedade
     `on<tipo>` definida, a acção registada não corre (só a `f`, que o browser chama no elemento).
   - Os nomes têm dono (`dono:nome`), para não colidirem com as tabelas das features. Os
     despachantes das features ignoram estes nomes (não estão nas suas tabelas). */

export const ACTION_EVENTS = ["click", "change", "input", "dragstart", "dragover", "dragleave", "drop"] as const;
export type ActionEventType = (typeof ACTION_EVENTS)[number];

/** O que um handler recebe: o elemento `[data-action]` (o `this` do inline), o evento (o `event`),
 *  o payload `data-on` já descodificado pelo browser, o `value` do elemento quando é um campo, e o
 *  `stop()` (o `event.stopPropagation()`). */
export interface ActionCtx {
  el: HTMLElement;
  ev: Event;
  on: string;
  value: string;
  stop: () => void;
}
export type ActionHandler = (c: ActionCtx) => void;
export type ActionSpec = Partial<Record<ActionEventType, ActionHandler>>;

const REG = new Map<string, ActionSpec>();

/** Regista as acções de um dono. Cada nome tem a forma `dono:nome` e só pode ser registado uma vez
 *  (o harness dos testes reavalia este módulo antes dos donos, logo começa sempre vazio). */
export function registerActions(table: Record<string, ActionSpec>): void {
  for (const [name, spec] of Object.entries(table)) {
    if (!/^[a-z][\w-]*:[\w.-]+$/.test(name)) throw new Error(`acção sem dono: ${name}`);
    if (REG.has(name)) throw new Error(`acção registada duas vezes: ${name}`);
    REG.set(name, spec);
  }
}

/** Chama a função publicada `name` NO ACTO, como o handler inline (que resolvia o nome no window
 *  ao clicar — a versão publicada, eventualmente decorada ou trocada pelo desktop). */
export const callGlobal = (name: string, ...a: unknown[]): unknown =>
  (window as unknown as Record<string, (...x: unknown[]) => unknown>)[name](...a);

/** Acções `dono:f` que só chamam a função publicada `f` sem argumentos (o `onclick="f()"`). */
export const globalCalls = (owner: string, names: string[]): Record<string, ActionSpec> =>
  Object.fromEntries(names.map((f) => [`${owner}:${f}`, { click: () => void callGlobal(f) }]));

/** O payload de várias partes: o markup escreve `data-on="${esc(JSON.stringify([a, b]))}"`. */
export const args = <T extends unknown[]>(c: ActionCtx): T => JSON.parse(c.on) as T;

const HANDLER_KEY = "__sharedActionHandler__";

const handle = (ev: Event): void => {
  const t = ev.target as Node | null;
  const start = t && t.nodeType === 1 ? (t as Element) : (t?.parentElement ?? null);
  const type = ev.type as ActionEventType;
  const path: HTMLElement[] = [];
  for (let el = start?.closest<HTMLElement>("[data-action]") ?? null; el; el = el.parentElement?.closest<HTMLElement>("[data-action]") ?? null) path.push(el);
  let stopped = false;
  for (const el of path) {
    const run = REG.get(el.dataset.action ?? "")?.[type];
    if (!run) continue;
    if ((el as unknown as Record<string, unknown>)["on" + type]) continue; // trocada por `el.on<tipo> = f`
    run({
      el,
      ev,
      on: el.dataset.on ?? "",
      value: (el as HTMLInputElement).value ?? "",
      stop: () => { stopped = true; ev.stopImmediatePropagation(); },
    });
    if (stopped) break;
  }
};

{
  const doc = document as Document & { [HANDLER_KEY]?: EventListener };
  const prev = doc[HANDLER_KEY];
  if (prev) for (const type of ACTION_EVENTS) document.removeEventListener(type, prev);
  doc[HANDLER_KEY] = handle;
  for (const type of ACTION_EVENTS) document.addEventListener(type, handle);
}
