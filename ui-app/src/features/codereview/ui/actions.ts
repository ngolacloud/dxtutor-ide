/* ═══════════ codereview — delegated event dispatch (ADR-0002, Fase 4) ═══════════
   O ÚNICO listener delegado da feature Explain · Code review · Under the hood. Os
   componentes (`renderCreviewView`) emitem markup com `data-action` (o nome da
   acção) e um `data-on` opcional (o seu único payload em string); este módulo liga
   um só handler ao `document` para `click`/`change`/`input`, sobe do alvo do evento
   até ao `[data-action]` mais próximo, e corre a entrada correspondente da tabela.
   Fim dos atributos de handler inline a resolver nomes livres no `window`.

   Porquê `data-on` para o payload (e não um `data-*` à medida): o harness golden
   (`tests/harness.ts`, `STRIPPED_ATTRS`) remove EXACTAMENTE `data-action` e
   `data-on` antes de comparar os snapshots — logo a migração para fora dos handlers
   inline só é invisível aos goldens enquanto todo o payload viajar em `data-on`. Um
   `data-*` próprio vazaria para o snapshot.

   Este ficheiro é cablagem pura: nunca toca em `window`, no bridge nem no domínio. A
   tabela de acções (os efeitos) é construída por `features/codereview.ts`, o único
   sítio que tem à mão tanto as funções locais como o legacy bridge. Cópia fiel do
   mecanismo de `features/codev/ui/actions.ts`, com uma chave de handler própria para
   as duas features coexistirem no mesmo `document` sem se sobreporem. */

/** Uma acção disparada: o payload `data-on` descodificado, o próprio elemento
 *  `[data-action]` (para os handlers que precisam de `this`) e o `value` do
 *  elemento quando é input/select. O browser já descodificou as entidades HTML em
 *  `data-on`, por isso `on` é a string simples que o componente escapou à saída. */
export interface ActionEvent {
  on: string;
  el: HTMLElement;
  value: string;
}

/** Uma entrada da tabela: a que evento DOM responde e o que faz. Manter o tipo de
 *  evento na entrada é o que permite a um só listener físico servir botões `click`,
 *  `change` em selects/inputs e `input` em sliders sem um disparar o handler do
 *  outro. */
export interface ActionSpec {
  on: "click" | "change" | "input";
  run: (e: ActionEvent) => void;
}

export type ActionTable = Record<string, ActionSpec>;

/* O handler guarda-se no `document` para que uma reavaliação da feature (o harness
   de teste reimporta toda a cadeia de módulos por teste) substitua a ligação anterior
   em vez de empilhar uma segunda. A chave é própria da feature `codereview` — distinta
   da do Co-Dev — por isso ambos os listeners coexistem e cada um ignora as acções do
   outro (a procura na tabela devolve `undefined`). */
const HANDLER_KEY = "__codereviewActionHandler__";
const EVENTS = ["click", "change", "input"] as const;

/** Instala o único listener delegado. Idempotente: uma segunda chamada troca a
 *  tabela e larga o handler anterior, para que re-arranques nunca dupliquem disparos. */
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
