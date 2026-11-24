/* ═════════ feature `comments` — adaptador: o ficheiro aberto no editor ═════════
   Lê a `textarea` da vista `file` (`#ed-ta`, com a chave do ficheiro em `data-path`) e a raiz do
   workspace no store (sem window). Uma proposta do Co-Dev desenhada por cima do ficheiro marca as
   linhas novas com `.hk-new`: aí os números de linha não são os do ficheiro. */

import { workspaceStore } from "../../../app/store/workspace";
import type { EditorPort } from "../application/ports";

const ta = (): HTMLTextAreaElement | null => document.getElementById("ed-ta") as HTMLTextAreaElement | null;

export const domEditor: EditorPort = {
  path() {
    const key = ta()?.dataset.path;
    if (!key) return null;
    const root = workspaceStore.root;
    return root && key.startsWith(root) ? key.slice(root.length) : key;
  },
  text: () => ta()?.value ?? "",
  selection() {
    const t = ta();
    return t ? { start: t.selectionStart, end: t.selectionEnd } : { start: 0, end: 0 };
  },
  showingProposal: () => !!document.querySelector("#ed-hl .hk-new, #ed-hl .hk-del"),
};
