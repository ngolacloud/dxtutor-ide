/* ═══════════ feature `board` — delegated event dispatch (ADR-0002, Fase 4) ═══════════
   O ÚNICO listener delegado da feature backlog/sprints/kanban. `renderBoardView` emite
   markup com `data-action` (o nome da acção) e um `data-on` opcional (o seu único payload
   em string); este módulo liga um só handler ao `document` para `click`, sobe do alvo do
   evento até ao `[data-action]` mais próximo, e corre a entrada correspondente da tabela.
   Fim dos `onclick` inline (dos botões) a resolver nomes livres no `window`.

   Porquê `data-on` para o payload (e não um `data-*` à medida): o harness golden
   (`tests/harness.ts`, `STRIPPED_ATTRS`) remove EXACTAMENTE `onclick`/`onchange`/`oninput`/
   `data-action`/`data-on` antes de comparar os snapshots — logo a migração para fora dos
   handlers inline só é invisível aos goldens enquanto todo o payload viajar em `data-on`.
   Um `data-*` próprio vazaria para o snapshot. (Os handlers de arrastar — ondragstart/
   ondragover/ondragleave/ondrop — NÃO estão em STRIPPED_ATTRS, por isso ficam inline: são
   drag-and-drop puro de DOM e migrá-los mudaria o snapshot.)

   Este ficheiro é cablagem pura: nunca toca em `window`, no bridge nem no domínio. A tabela
   de acções (os efeitos) é construída por `features/board.ts`, o único sítio com à mão
   tanto as funções do motor como o bridge. Cópia fiel do mecanismo de
   `features/scm/ui/actions.ts`, com uma chave de handler própria para as features
   coexistirem no mesmo `document` sem se sobreporem. */

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
   segunda. A chave é própria da feature `board` — distinta das do codev/scm/debug — por
   isso os listeners coexistem e cada um ignora as acções do outro (lookup = undefined). */
const HANDLER_KEY = "__boardActionHandler__";
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
