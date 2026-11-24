/* ═════════ feature `lsp` — Show Type Hierarchy (Shift+Alt+T) ═════════
   No editor, Shift+Alt+T pede ao servidor o tipo no cursor e abre junto dele a hierarquia
   (`ui/popups.ts`, `#lsp-types`): os subtipos (ou, com Tab, os supertipos), carregados a pedido.
   Sem tipo no cursor, ou se o servidor não tem hierarquia de tipos (o kotlin-language-server),
   diz-o. O cartão fica dentro da área visível do editor (não tapa o painel do Co-Dev nem o painel
   inferior). A paleta chama a acção devolvida (o bridge regista a entrada). A tecla é apanhada na
   fase de CAPTURA do `document`. Não toca em `window`. */

import type { TypeEntry, TypeHierarchyStart } from "../application/lsp-client";
import type { TypeDirection } from "../domain/type-hierarchy";
import { pointOfOffset } from "../domain/positions";
import { metricsOf } from "./editor-hooks";
import { closePopup, showTypeHierarchy } from "./popups";

export interface TypeHierarchyHooksDeps {
  typeHierarchyAt(offset: number): Promise<TypeHierarchyStart | null>;
  typeHierarchyChildren(t: TypeEntry, direction: TypeDirection): Promise<TypeEntry[]>;
  openType(t: TypeEntry): void;
  notify(message: string): void;
  enabled(): boolean;
}

const KEY = "__lspTypeHierarchyHooks__";

const isEditor = (t: EventTarget | null): t is HTMLTextAreaElement =>
  t instanceof HTMLTextAreaElement && t.id === "ed-ta";

/** Instala o atalho (idempotente) e devolve a acção para a paleta. */
export function bindTypeHierarchyHooks(d: TypeHierarchyHooksDeps): () => void {
  const doc = document as Document & { [KEY]?: () => void };
  doc[KEY]?.();
  let seq = 0;

  const show = (): void => {
    const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
    if (!ta || !d.enabled()) {
      d.notify("Type hierarchy: open a file of the folder first");
      return;
    }
    const caret = ta.selectionStart, mine = ++seq;
    void d.typeHierarchyAt(caret).then((r) => {
      if (mine !== seq) return;
      if (!r) return d.notify("Type hierarchy: no language server for this file");
      if (r.status === "unsupported") return d.notify(`Type hierarchy: the ${r.language} language server does not support it`);
      if (r.status === "none") return d.notify("Type hierarchy: no type at the cursor");
      const box = ta.getBoundingClientRect(), m = metricsOf(ta), p = pointOfOffset(ta.value, caret, m);
      // a área visível do editor (o contentor que rola o `.ed`): o cartão não sai dela
      const area = (ta.closest(".ed")?.parentElement ?? ta).getBoundingClientRect();
      const bounds = { left: area.left, top: area.top, right: area.right, bottom: area.bottom };
      showTypeHierarchy(r.root, box.left + p.x, box.top + p.y + m.lineHeight + 4, d.typeHierarchyChildren, d.openType, () => ta.focus({ preventScroll: true }), "subtypes", bounds);
    });
  };

  const onKey = (e: KeyboardEvent): void => {
    if (!isEditor(e.target) || !d.enabled()) return;
    if (!(e.shiftKey && e.altKey && !e.ctrlKey && !e.metaKey && (e.key.toLowerCase() === "t" || e.code === "KeyT"))) return;
    e.preventDefault();
    e.stopPropagation();
    show();
  };
  document.addEventListener("keydown", onKey, true);
  doc[KEY] = () => {
    document.removeEventListener("keydown", onKey, true);
    closePopup("lsp-types");
  };
  return show;
}
