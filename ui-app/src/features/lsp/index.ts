/* ═════════ dxtutor IDE — feature: o editor ligado ao servidor de linguagem ═════════
   Raiz de composição. Só na app desktop: o cliente (`application/lsp-client`) recebe os
   adaptadores do backend (`infrastructure/tauri`) e do workspace/editor
   (`infrastructure/legacy-bridge`), e é accionado pelos eventos do editor no bus
   (`editor:tab`, `workspace:changed`) e pelos ganchos do editor (`ui/editor-hooks`): hover,
   definição (F12), referências (Shift+F12) e rename (F2); e pelo completion (`ui/completion-hooks`:
   Ctrl+Espaço, depois de `.` ou ao escrever um nome) e pela assinatura da chamada
   (`ui/signature-hooks`: depois de `(`/`,` ou Ctrl+Shift+Espaço); pela formatação (Shift+Alt+F) e
   pelo Go to Symbol (`ui/symbol-hooks`: Ctrl+Shift+O e a paleta). Os mesmos símbolos dão o Outline
   das linguagens que o `file_outline` não cobre (`desktopPorts.outline`, consultada pelo explorador).
   Os diagnósticos já chegam ao Problems e ao gutter pelo painel (`features/panel`); aqui
   só se volta a pintar o ficheiro aberto quando os dele mudam. Quando o servidor da linguagem
   não está instalado, o editor mostra um aviso com o que falta e como o instalar
   (`editor:file-view` repõe-no a cada desenho da vista).
   No browser/testes não arranca: o editor continua exactamente como antes. */

import { isDesktop } from "../../platform/tauri/core";
import { bus } from "../../app/bus";
import { desktopPorts } from "../../app/desktop";
import { languageIdFor } from "./domain/languages";
import { makeLspClient } from "./application/lsp-client";
import { tauriLsp } from "./infrastructure/tauri";
import { workspace, editor, addPaletteCommand } from "./infrastructure/legacy-bridge";
import { bindEditorHooks } from "./ui/editor-hooks";
import { bindCompletionHooks } from "./ui/completion-hooks";
import { bindSignatureHooks } from "./ui/signature-hooks";
import { bindFormatHooks } from "./ui/format-hooks";
import { bindSymbolHooks } from "./ui/symbol-hooks";

if (isDesktop()) {
  const client = makeLspClient({ lsp: tauriLsp, workspace, editor, defer: (f) => setTimeout(f, 0) });
  tauriLsp.onDiagnostics((uri) => client.onDiagnostics(uri));
  /* um comando de code action executado no servidor devolve as edições por workspace/applyEdit */
  tauriLsp.onApplyEdit((edit) => void client.onApplyEdit(edit));
  bus.on("editor:tab", ({ id }) => void client.onTab(id));
  /* a vista do ficheiro foi refeita: repõe o aviso de servidor em falta, se for o caso */
  bus.on("editor:file-view", ({ path }) => void client.onFileView(path));
  bus.on("workspace:changed", ({ fromEditor }) => {
    if (fromEditor) void client.onEdit();
  });
  bindEditorHooks({
    hoverAt: client.hoverAt,
    definitionAt: client.definitionAt,
    referencesAt: client.referencesAt,
    prepareRenameAt: client.prepareRenameAt,
    renameAt: client.renameAt,
    codeActionsAt: client.codeActionsAt,
    applyCodeAction: client.applyCodeAction,
    openReference: (r) => {
      if (r.key) editor.open(r.key, r.line, r.character);
    },
    enabled: () => !!workspace.diskRoot(),
  });
  bindCompletionHooks({ completionAt: client.completionAt, enabled: () => !!workspace.diskRoot() });
  bindSignatureHooks({ signatureHelpAt: client.signatureHelpAt, enabled: () => !!workspace.diskRoot() });
  /* Shift+Alt+F: formata pelo servidor; sem ele, o «Format Document» do dxtutor */
  bindFormatHooks({ formatAt: client.formatAt, builtinFormat: editor.builtinFormat, enabled: () => !!workspace.diskRoot() });
  /* Ctrl+Shift+O (e a paleta): os símbolos do ficheiro, com filtro */
  const goToSymbol = bindSymbolHooks({
    currentFileKey: workspace.currentFileKey,
    symbolsFor: client.symbolsFor,
    open: editor.open,
    notify: editor.notify,
    enabled: () => !!workspace.diskRoot(),
  });
  addPaletteCommand("Go to Symbol in Editor…", "Ctrl+Shift+O", goToSymbol);
  /* o Outline das linguagens que o file_outline não cobre: os símbolos do servidor */
  desktopPorts.outline = {
    covers: (p) => !!workspace.diskRoot() && !!languageIdFor(p),
    symbols: async (p) => (await client.symbolsFor(p))?.map((s) => ({ k: s.label, n: s.name, line: s.line, d: s.depth })) ?? null,
  };
}
