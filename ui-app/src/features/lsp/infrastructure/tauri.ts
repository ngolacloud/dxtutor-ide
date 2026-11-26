/* ═════════ feature `lsp` — adaptador Tauri ═════════
   Implementa a `LspPort` sobre o cliente IPC tipado (`platform/tauri/core`): os comandos
   `lsp_start` / `lsp_did_open` / `lsp_did_change` / `lsp_hover` / `lsp_definition` /
   `lsp_references` / `lsp_prepare_rename` / `lsp_rename` / `lsp_completion` /
   `lsp_signature_help` / `lsp_server_status` / `lsp_code_action` / `lsp_execute_command` / `lsp_format` /
   `lsp_document_symbols` / `lsp_workspace_symbols` / `lsp_prepare_type_hierarchy` / `lsp_type_hierarchy` e
   os eventos `lsp://diagnostics` e `lsp://apply-edit`; e a `LspConfigPort` dos overrides (LSP P2):
   `lsp_config` / `lsp_config_file` / `lsp_user_config_save` / `lsp_approve_server` e o evento `lsp://config`.
   Não toca em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, listen } from "../../../platform/tauri/core";
import type { LspConfigPort, LspPort } from "../application/ports";
import type { ServerStatus } from "../domain/server-status";
import type { FileReport, LspConfigView } from "../domain/overrides";

export const tauriLspConfig: LspConfigPort = {
  config: (root) => invoke<LspConfigView>("lsp_config", { root }),
  configFile: (kind, root) => invoke<{ path: string; exists: boolean; text: string }>("lsp_config_file", { kind, root }),
  saveUserConfig: (text) => invoke<FileReport>("lsp_user_config_save", { text }),
  approveServer: (root, server, hash, approved, reason, decidedAt) => invoke<void>("lsp_approve_server", { root, server, hash, approved, reason, decidedAt }),
  onConfig: (cb) => {
    void listen("lsp://config", () => cb());
  },
};

export const tauriLsp: LspPort = {
  start: (root) => invoke<void>("lsp_start", { root }),
  didOpen: (path, text, languageId) => invoke<void>("lsp_did_open", { path, text, languageId }),
  didChange: (path, text, version) => invoke<void>("lsp_did_change", { path, text, version }),
  hover: (path, line, character) => invoke<unknown>("lsp_hover", { path, line, character }),
  definition: (path, line, character) => invoke<unknown>("lsp_definition", { path, line, character }),
  references: (path, line, character) => invoke<unknown>("lsp_references", { path, line, character }),
  prepareRename: (path, line, character) => invoke<unknown>("lsp_prepare_rename", { path, line, character }),
  rename: (path, line, character, newName) => invoke<unknown>("lsp_rename", { path, line, character, newName }),
  completion: (path, line, character, triggerCharacter) => invoke<unknown>("lsp_completion", { path, line, character, triggerCharacter }),
  signatureHelp: (path, line, character, triggerCharacter, isRetrigger) =>
    invoke<unknown>("lsp_signature_help", { path, line, character, triggerCharacter, isRetrigger }),
  serverStatus: (path) => invoke<ServerStatus | null>("lsp_server_status", { path }),
  codeAction: (path, startLine, startCharacter, endLine, endCharacter) =>
    invoke<unknown>("lsp_code_action", { path, startLine, startCharacter, endLine, endCharacter }),
  documentSymbols: (path) => invoke<unknown>("lsp_document_symbols", { path }),
  workspaceSymbols: (root, query) => invoke<unknown>("lsp_workspace_symbols", { root, query }),
  prepareTypeHierarchy: (path, line, character) => invoke<unknown>("lsp_prepare_type_hierarchy", { path, line, character }),
  typeHierarchy: (path, item, direction) => invoke<unknown>("lsp_type_hierarchy", { path, item, direction }),
  executeCommand: (path, command, args) => invoke<unknown>("lsp_execute_command", { path, command, arguments: args }),
  format: (path, tabSize, insertSpaces, range) =>
    invoke<unknown>("lsp_format", {
      path,
      tabSize,
      insertSpaces,
      startLine: range?.start.line ?? null,
      startCharacter: range?.start.character ?? null,
      endLine: range?.end.line ?? null,
      endCharacter: range?.end.character ?? null,
    }),
  onApplyEdit: (cb) => {
    void listen("lsp://apply-edit", (p) => {
      const e = p as { edit?: unknown };
      if (e && typeof e.edit === "object" && e.edit) cb(e.edit);
    });
  },
  onDiagnostics: (cb) => {
    void listen("lsp://diagnostics", (p) => {
      const e = p as { uri?: unknown };
      if (e && typeof e.uri === "string") cb(e.uri);
    });
  },
};
