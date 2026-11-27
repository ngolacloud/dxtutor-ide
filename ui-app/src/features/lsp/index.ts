/* ═════════ dxtutor IDE — feature: o editor ligado ao servidor de linguagem ═════════
   Raiz de composição. Só na app desktop: o cliente (`application/lsp-client`) recebe os
   adaptadores do backend (`infrastructure/tauri`) e do workspace/editor
   (`infrastructure/legacy-bridge`), e é accionado pelos eventos do editor no bus
   (`editor:tab`, `workspace:changed`) e pelos ganchos do editor (`ui/editor-hooks`): hover,
   definição (F12), referências (Shift+F12) e rename (F2); e pelo completion (`ui/completion-hooks`:
   Ctrl+Espaço, depois de `.` ou ao escrever um nome) e pela assinatura da chamada
   (`ui/signature-hooks`: depois de `(`/`,` ou Ctrl+Shift+Espaço); pela formatação (Shift+Alt+F) e
   pelo Go to Symbol (`ui/symbol-hooks`: Ctrl+Shift+O e a paleta) e pelo Go to Symbol in Workspace
   (`ui/workspace-symbol-hooks`: Ctrl+T e a paleta) e pela hierarquia de tipos
   (`ui/type-hierarchy-hooks`: Shift+Alt+T e a paleta). Os mesmos símbolos dão o Outline
   das linguagens que o `file_outline` não cobre (`desktopPorts.outline`, consultada pelo explorador).
   Os diagnósticos já chegam ao Problems e ao gutter pelo painel (`features/panel`); aqui
   só se volta a pintar o ficheiro aberto quando os dele mudam. Quando o servidor da linguagem
   não está instalado, o editor mostra um aviso com o que falta e as maneiras de o instalar que o backend
   constrói a partir das receitas do registo (LSP P3: `lsp_install_plan`; aprovação, auditoria e terminal,
   ou o download conferido `lsp_install_download`); `editor:file-view` repõe-no a cada desenho da vista.
   Os overrides do registo (LSP P2, `application/overrides`): o registo efectivo da pasta (embutido +
   `lsp.json` do utilizador + `.dxtutor/lsp.json` do projecto) entra em uso ao abrir a pasta; quando um
   ficheiro muda (`lsp://config`), o cliente revê o ficheiro aberto; a paleta abre os dois ficheiros e
   mostra a configuração efectiva; um comando que o projecto pede só corre depois do diálogo de aprovação
   partilhado (o backend audita a decisão e guarda-a).
   Os recursos (LSP P6): um separador que fecha (`editor:tab-closed`) ou um ficheiro que desaparece
   (`workspace:changed`) dá `didClose`; abrir outra pasta (`dx:workspace`) pára os servidores da anterior; a
   paleta lista os servidores a correr (`application/servers`, com «Restart»/«Stop» e «Show log», que abre o
   canal «Language servers» do Output pelo `services.panel`); o tecto de servidores por cumprir é avisado.
   No browser/testes não arranca. O que funciona SEM servidor (LSP P5, `fallback.ts`) corre nos dois: o
   completion por palavras dos ficheiros abertos quando o servidor não sugere nada (aqui), o realce pelas
   gramáticas do dxtutor (o editor), o «Format Document» seguro e os comentários de bloco (as extensões). */

import { isDesktop } from "../../platform/tauri/core";
import { bus } from "../../app/bus";
import { desktopPorts } from "../../app/desktop";
import { languageIdFor } from "./domain/languages";
import { makeLspClient } from "./application/lsp-client";
import { makeOverrides } from "./application/overrides";
import { LSP_OVERRIDE_MESSAGES } from "./application/override-messages";
import { LSP_INSTALL_MESSAGES } from "./application/install-messages";
import { tauriLsp, tauriLspConfig, tauriLspInstall, tauriLspServers } from "./infrastructure/tauri";
import { makeServers } from "./application/servers";
import { LSP_SERVERS_MESSAGES } from "./application/servers-messages";
import { serversScreen } from "./ui/servers-view";
import { services } from "../../app/services";
import { overridesView } from "./ui/config-view";
import { translator } from "../../app/i18n";
import { workspace, editor, addPaletteCommand, runTerminalTask, onFolderOpened } from "./infrastructure/legacy-bridge";
import { copyText } from "../../app/clipboard";
import { requestApproval } from "../../app/approval";
import { auditClient } from "../../platform/tauri/audit";
import { bindEditorHooks } from "./ui/editor-hooks";
import { bindCompletionHooks } from "./ui/completion-hooks";
import { bindSignatureHooks } from "./ui/signature-hooks";
import { bindFormatHooks } from "./ui/format-hooks";
import { bindSymbolHooks } from "./ui/symbol-hooks";
import { bindWorkspaceSymbolHooks } from "./ui/workspace-symbol-hooks";
import { bindTypeHierarchyHooks } from "./ui/type-hierarchy-hooks";
import { wordCompletion, fallbackCopy } from "./fallback";

/** LSP P5: as palavras dos ficheiros abertos, quando o servidor não sugere nada. */
const words = { words: wordCompletion.at, wordsNote: () => fallbackCopy("wordsNote") };

if (isDesktop()) {
  const audit = auditClient();
  const copy = translator(LSP_OVERRIDE_MESSAGES);
  /* os overrides: o diálogo de aprovação partilhado decide; o backend audita e guarda */
  const overrides = makeOverrides({
    config: tauriLspConfig, workspace, editor, human: { approve: (r) => requestApproval(r) }, view: overridesView, copy,
    onChanged: () => client.onConfigChanged(), // resolvido no acto (o cliente nasce a seguir)
  });
  const client = makeLspClient({
    lsp: tauriLsp, workspace, editor, defer: (f) => setTimeout(f, 0),
    overrides, copy, configure: () => void overrides.openUserFile(),
    installCopy: translator(LSP_INSTALL_MESSAGES),
    /* o aviso de servidor em falta (LSP P3): o backend dá as maneiras com o comando exacto; instalar pede
       aprovação, fica auditado e corre num terminal (ou é o download conferido pelo backend) */
    installer: {
      plan: (path) => tauriLspInstall.plan(path),
      download: (path, option) => tauriLspInstall.download(path, option),
      copy: (text) => copyText(text),
      approve: (r) => requestApproval(r),
      audit: (root, e) => audit.record(root, { feature: "lsp", ...e }),
      run: (command, cwd, env, label) => runTerminalTask(command, cwd, env, label),
    },
  });
  tauriLsp.onDiagnostics((uri) => client.onDiagnostics(uri));
  /* um comando de code action executado no servidor devolve as edições por workspace/applyEdit */
  tauriLsp.onApplyEdit((edit) => void client.onApplyEdit(edit));
  bus.on("editor:tab", ({ id }) => void client.onTab(id));
  /* um ficheiro de overrides mudou: o backend já reiniciou os servidores afectados; o registo novo entra
     em uso e o ficheiro aberto é revisto (faixa de aprovação, ou o servidor novo) */
  tauriLspConfig.onConfig(() => void overrides.reload().then(() => client.onConfigChanged()));
  addPaletteCommand(copy("cmdUser"), "", () => void overrides.openUserFile());
  addPaletteCommand(copy("cmdProject"), "", () => void overrides.openProjectFile());
  addPaletteCommand(copy("cmdShow"), "", () => void overrides.showEffective());
  /* a vista do ficheiro foi refeita: repõe o aviso de servidor em falta, se for o caso */
  bus.on("editor:file-view", ({ path }) => void client.onFileView(path));
  bus.on("workspace:changed", ({ fromEditor }) => {
    if (fromEditor) void client.onEdit();
    void client.onWorkspaceChanged(); // um ficheiro aberto que desapareceu (apagado, renomeado): didClose
  });
  /* LSP P6: o separador fechou → didClose; outra pasta → os servidores da anterior param */
  bus.on("editor:tab-closed", ({ path }) => void client.onTabClosed(path));
  onFolderOpened((root) => void client.onFolder(root));
  /* os servidores a correr: a lista com «Restart»/«Stop», e o aviso do tecto por cumprir */
  const serversCopy = translator(LSP_SERVERS_MESSAGES);
  const runningServers = makeServers({
    port: tauriLspServers,
    screen: serversScreen(() => workspace.diskRoot()),
    copy: serversCopy,
    notify: editor.notify,
    showLog: () => services.panel?.showLspLog?.(),
    every: (ms, f) => {
      const t = setInterval(f, ms);
      return () => clearInterval(t);
    },
  });
  tauriLspServers.onLimit((l) => runningServers.onLimit(l));
  addPaletteCommand(serversCopy("cmdServers"), "", () => void runningServers.show());
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
  /* com uma pasta, pergunta ao servidor; sem sugestões dele (ou sem pasta), as palavras */
  bindCompletionHooks({ completionAt: (o, t) => (workspace.diskRoot() ? client.completionAt(o, t) : Promise.resolve(null)), enabled: () => true, ...words });
  bindSignatureHooks({ signatureHelpAt: client.signatureHelpAt, enabled: () => !!workspace.diskRoot() });
  /* Shift+Alt+F: formata pelo servidor; sem ele, o «Format Document» do dxtutor */
  bindFormatHooks({ formatAt: client.formatAt, builtinFormat: editor.builtinFormat, enabled: () => !!workspace.diskRoot() });
  /* LSP P5: com a tecla ligada aqui, o atalho global não formata antes (sem servidor, o formatAt cai no do dxtutor) */
  services.lspFormat = { handles: () => !!workspace.diskRoot() };
  /* Ctrl+Shift+O (e a paleta): os símbolos do ficheiro, com filtro */
  const goToSymbol = bindSymbolHooks({
    currentFileKey: workspace.currentFileKey,
    symbolsFor: client.symbolsFor,
    open: editor.open,
    notify: editor.notify,
    enabled: () => !!workspace.diskRoot(),
  });
  addPaletteCommand("Go to Symbol in Editor…", "Ctrl+Shift+O", goToSymbol);
  /* Ctrl+T (e a paleta): os símbolos da pasta, de cada servidor que já corre nela */
  const goToWorkspaceSymbol = bindWorkspaceSymbolHooks({
    workspaceSymbolsFor: client.workspaceSymbolsFor,
    openWorkspaceSymbol: client.openWorkspaceSymbol,
    enabled: () => !!workspace.diskRoot(),
  });
  addPaletteCommand("Go to Symbol in Workspace…", "Ctrl+T", goToWorkspaceSymbol);
  /* Shift+Alt+T (e a paleta): a hierarquia de tipos do tipo no cursor */
  const showTypes = bindTypeHierarchyHooks({
    typeHierarchyAt: client.typeHierarchyAt,
    typeHierarchyChildren: client.typeHierarchyChildren,
    openType: client.openType,
    notify: editor.notify,
    enabled: () => !!workspace.diskRoot(),
  });
  addPaletteCommand("Show Type Hierarchy", "Shift+Alt+T", showTypes);
  /* o Outline das linguagens que o file_outline não cobre: os símbolos do servidor */
  desktopPorts.outline = {
    covers: (p) => !!workspace.diskRoot() && !!languageIdFor(p, workspace.text(p)),
    symbols: async (p) => (await client.symbolsFor(p))?.map((s) => ({ k: s.label, n: s.name, line: s.line, d: s.depth })) ?? null,
  };
} else {
  /* no browser não há servidor: o completion é só o das palavras */
  bindCompletionHooks({ completionAt: () => Promise.resolve(null), enabled: () => true, ...words });
}
