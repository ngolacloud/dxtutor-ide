/* ═════════ feature `lsp` — adaptador: os ficheiros abertos, para o completion por palavras ═════════
   O ficheiro na textarea do editor (`#ed-ta`, com a chave em `data-path`) e os outros separadores de
   ficheiro abertos, com o texto do workspace — pelos stores (`app/store`), sem `window`. */

import { editorStore } from "../../../app/store/editor";
import { workspaceStore } from "../../../app/store/workspace";
import type { OpenFilesPort } from "../application/word-completion";

export const openFiles: OpenFilesPort = {
  currentKey: () => (document.getElementById("ed-ta") as HTMLTextAreaElement | null)?.dataset.path ?? null,
  others: () =>
    editorStore.tabs.flatMap((t) => {
      if (t.kind !== "file" || typeof t.path !== "string") return [];
      const text = workspaceStore.files[t.path]?.content;
      return typeof text === "string" ? [{ key: t.path, text }] : [];
    }),
};
