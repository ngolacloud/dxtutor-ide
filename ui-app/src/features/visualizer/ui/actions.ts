/* ═══════════ feature `visualizer` — delegated event dispatch (ADR-0002, Fase 4) ═══════════
   O ÚNICO listener delegado do overlay «Visualize execution». `vzRender` (e as decorações
   de `VIEW.lt`/`VIEW.hood` em `boot7`) emitem markup com `data-action` (o nome da acção) e
   um `data-on` opcional (o seu único payload em string); este módulo liga um só handler ao
   `document` para `click`/`change`/`input`, sobe do alvo do evento até ao `[data-action]`
   mais próximo, e corre a entrada correspondente da tabela. Fim dos `onclick`/`onchange`/
   `oninput` inline a resolver nomes livres no `window` (passo para endurecer o CSP, §6).

   Porquê `data-on` para o payload (e não um `data-*` à medida): o harness golden
   (`tests/harness.ts`, `STRIPPED_ATTRS`) remove EXACTAMENTE `onclick`/`onchange`/`oninput`/
   `data-action`/`data-on` antes de comparar — logo a migração só é invisível aos goldens
   enquanto todo o payload viajar em `data-on`. Um `data-*` próprio vazaria para o snapshot.

   Cablagem pura: nunca toca em `window` (o guard vive no `document`, A8-compliant), nem no
   bridge nem no domínio. A tabela de acções (os efeitos) é construída por
   `features/visualizer.ts`, o único sítio com à mão tanto os controlos do overlay (VZ/LS/
   vizOpen/vzGo/…) como o estado window-backed. Cópia fiel do mecanismo de `board`/`scm`,
   com uma chave de handler própria para as features coexistirem no mesmo `document`. */

/** Uma acção disparada: o payload `data-on` descodificado, o próprio elemento
 *  `[data-action]`, o `value` do elemento (input/select) e o evento cru (para o
 *  checkbox `.checked` e o seek `clientX`/`getBoundingClientRect`). */
export interface ActionEvent {
  on: string;
  el: HTMLElement;
  value: string;
  e: Event;
}

/** Uma entrada da tabela: a que evento DOM responde e o que faz. */
export interface ActionSpec {
  on: "click" | "change" | "input";
  run: (e: ActionEvent) => void;
}

export type ActionTable = Record<string, ActionSpec>;

/* O handler guarda-se no `document` (não no `window`: A8) para que uma reavaliação da
   feature (o harness reimporta toda a cadeia por teste) substitua a ligação anterior em
   vez de empilhar uma segunda. A chave é própria da `visualizer` — distinta das do
   codev/board/scm/debug — por isso os listeners coexistem e cada um ignora as acções do
   outro (lookup = undefined). */
const HANDLER_KEY = "__vizActionHandler__";
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
      e: ev,
    });
  };

  doc[HANDLER_KEY] = handle;
  for (const type of EVENTS) document.addEventListener(type, handle);
}
