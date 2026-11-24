/* ═══════════ feature `debug` — delegated event dispatch (ADR-0002, Fase 4) ═══════════
   O ÚNICO listener delegado da feature Run and Debug. O componente (`renderDebugPane`)
   emite markup com `data-action` (o nome da acção) e um `data-on`
   opcional (o seu único payload em string); este módulo liga um só handler ao
   `document` para `click`/`change`/`input`, sobe do alvo do evento até ao
   `[data-action]` mais próximo, e corre a entrada correspondente da tabela. Fim dos
   `onclick`/`onchange` inline a resolver nomes livres no `window`.

   Porquê `data-on` para o payload (e não um `data-*` à medida): o harness golden
   (`tests/harness.ts`, `STRIPPED_ATTRS`) remove EXACTAMENTE `data-action` e `data-on`
   antes de comparar os snapshots — logo a migração para fora dos handlers inline só é
   invisível aos goldens enquanto todo o payload viajar em `data-on`. Um `data-*`
   próprio vazaria para o snapshot.

   O `closest('[data-action]')` substitui o antigo `event.stopPropagation()`: num clique
   no botão «×» dentro de uma `.scm-row` (que também tem acção), o ancestral mais próximo
   é o botão — só a acção dele corre; a da linha não dispara.

   Cablagem pura: nunca toca em `window`, no bridge nem no domínio. A tabela de acções
   (os efeitos) é construída por `features/debug.ts`, o único sítio com à mão tanto as
   funções locais (motor/desenho) como o legacy bridge. Cópia fiel do mecanismo de
   `features/scm/ui/actions.ts`, com uma chave de handler própria para as features
   coexistirem no mesmo `document` sem se sobreporem. */

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

const HANDLER_KEY = "__dbgActionHandler__";
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
