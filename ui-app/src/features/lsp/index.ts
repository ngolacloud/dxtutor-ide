/* ═════════ dxtutor IDE — feature: o editor ligado ao servidor de linguagem ═════════
   Raiz de composição. Só na app desktop: o cliente (`application/lsp-client`) recebe os
   adaptadores do backend (`infrastructure/tauri`) e do workspace/editor
   (`infrastructure/legacy-bridge`), e é accionado pelos eventos do editor no bus
   (`editor:tab`, `workspace:changed`) e pelos ganchos do editor (`ui/editor-hooks`): hover,
   definição (F12), referências (Shift+F12) e rename (F2); e pelo completion (`ui/completion-hooks`:
   Ctrl+Espaço, depois de `.` ou ao escrever um nome).
   Os diagnósticos já chegam ao Problems e ao gutter pelo painel (`features/panel`); aqui
   só se volta a pintar o ficheiro aberto quando os dele mudam.
   No browser/testes não arranca: o editor continua exactamente como antes. */

import { isDesktop } from "../../platform/tauri/core";
import { bus } from "../../app/bus";
import { makeLspClient } from "./application/lsp-client";
import { tauriLsp } from "./infrastructure/tauri";
import { workspace, editor } from "./infrastructure/legacy-bridge";
import { bindEditorHooks } from "./ui/editor-hooks";
import { bindCompletionHooks } from "./ui/completion-hooks";

if (isDesktop()) {
  const client = makeLspClient({ lsp: tauriLsp, workspace, editor, defer: (f) => setTimeout(f, 0) });
  tauriLsp.onDiagnostics((uri) => client.onDiagnostics(uri));
  bus.on("editor:tab", ({ id }) => void client.onTab(id));
  bus.on("workspace:changed", ({ fromEditor }) => {
    if (fromEditor) void client.onEdit();
  });
  bindEditorHooks({
    hoverAt: client.hoverAt,
    definitionAt: client.definitionAt,
    referencesAt: client.referencesAt,
    prepareRenameAt: client.prepareRenameAt,
    renameAt: client.renameAt,
    openReference: (r) => {
      if (r.key) editor.open(r.key, r.line, r.character);
    },
    enabled: () => !!workspace.diskRoot(),
  });
  bindCompletionHooks({ completionAt: client.completionAt, enabled: () => !!workspace.diskRoot() });
}
