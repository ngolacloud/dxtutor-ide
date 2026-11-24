/* ═════════ feature `comments` — ganchos: rato, teclado e acções ═════════
   O botão segue a linha sob o ponteiro enquanto ele está no editor (margem ou texto); clicar
   abre a caixa. Na caixa: Ctrl+Enter junta ao chat, Esc fecha. Uma vista nova do ficheiro ou
   outro separador fecham o que estava aberto (os nós foram refeitos). */

import { registerActions } from "../../../app/actions";
import { bus } from "../../../app/bus";
import { lineAtY, lineCount } from "../domain/comment";
import type { LineComments } from "../application/line-comments";
import type { CommentKey } from "./messages";
import { boxOpen, boxText, closeBox, hideButton, lineHeight, openBox, showButton, syncAddButton } from "./view";

type T = (k: CommentKey, p?: Record<string, string | number>) => string;
const KEY = "__commentsHooks__";

export interface HookDeps {
  comments: LineComments;
  t: T;
  toast(msg: string): void;
}

/** A linha do editor sob o ponto (clientY), ou null fora do texto. */
function lineUnder(clientY: number): number | null {
  const ta = document.getElementById("ed-ta") as HTMLTextAreaElement | null;
  const w = ta?.parentElement;
  if (!ta || !w) return null;
  return lineAtY(clientY - w.getBoundingClientRect().top, lineHeight(), lineCount(ta.value));
}

export function bindCommentHooks(d: HookDeps): () => void {
  const doc = document as unknown as Record<string, (() => void) | undefined>;
  doc[KEY]?.();

  const close = (): void => {
    d.comments.discard();
    closeBox();
  };
  const add = async (): Promise<void> => {
    if (await d.comments.add(boxText())) {
      closeBox();
      d.toast(d.t("added"));
    }
  };

  registerActions({
    "comments:open": {
      click: (c) => {
        c.stop();
        const line = parseInt(c.on, 10);
        const open = Number.isFinite(line) ? d.comments.openAt(line) : null;
        if (!open) return;
        const input = openBox(open, d.t);
        input?.addEventListener("input", syncAddButton);
        input?.addEventListener("keydown", (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            close();
            (document.getElementById("ed-ta") as HTMLTextAreaElement | null)?.focus({ preventScroll: true });
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            void add();
          }
        });
      },
    },
    "comments:add": { click: (c) => { c.stop(); void add(); } },
    "comments:discard": { click: (c) => { c.stop(); close(); } },
  });

  const onMove = (e: MouseEvent): void => {
    if (boxOpen()) return;
    const t = e.target as HTMLElement | null;
    if (!t || !t.closest?.(".ed")) {
      hideButton();
      return;
    }
    if (t.closest(".cmt-gutter")) return;
    const line = d.comments.canComment() ? lineUnder(e.clientY) : null;
    if (line === null) hideButton();
    else showButton(line, d.t);
  };
  const onLeave = (e: MouseEvent): void => {
    const to = e.relatedTarget as HTMLElement | null;
    if (!boxOpen() && !(to && to.closest?.(".ed"))) hideButton();
  };
  const reset = (): void => {
    d.comments.discard();
    closeBox();
    hideButton();
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseout", onLeave);
  const offView = bus.on("editor:file-view", reset);
  const offTab = bus.on("editor:tab", reset);
  doc[KEY] = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseout", onLeave);
    offView();
    offTab();
    doc[KEY] = undefined;
  };
  return doc[KEY]!;
}
