/* ═════════ feature `lsp` — adaptador Tauri ═════════
   Implementa a `LspPort` sobre o cliente IPC tipado (`platform/tauri/core`): os comandos
   `lsp_start` / `lsp_did_open` / `lsp_did_change` / `lsp_hover` / `lsp_definition` /
   `lsp_references` / `lsp_prepare_rename` / `lsp_rename` / `lsp_server_status` e o evento
   `lsp://diagnostics`. Não toca em `window` (o cliente tipado é que o faz, fora da subárvore). */

import { invoke, listen } from "../../../platform/tauri/core";
import type { LspPort } from "../application/ports";
import type { ServerStatus } from "../domain/server-status";

export const tauriLsp: LspPort = {
  start: (root) => invoke<void>("lsp_start", { root }),
  didOpen: (path, text, languageId) => invoke<void>("lsp_did_open", { path, text, languageId }),
  didChange: (path, text, version) => invoke<void>("lsp_did_change", { path, text, version }),
  hover: (path, line, character) => invoke<unknown>("lsp_hover", { path, line, character }),
  definition: (path, line, character) => invoke<unknown>("lsp_definition", { path, line, character }),
  references: (path, line, character) => invoke<unknown>("lsp_references", { path, line, character }),
  prepareRename: (path, line, character) => invoke<unknown>("lsp_prepare_rename", { path, line, character }),
  rename: (path, line, character, newName) => invoke<unknown>("lsp_rename", { path, line, character, newName }),
  serverStatus: (path) => invoke<ServerStatus | null>("lsp_server_status", { path }),
  onDiagnostics: (cb) => {
    void listen("lsp://diagnostics", (p) => {
      const e = p as { uri?: unknown };
      if (e && typeof e.uri === "string") cb(e.uri);
    });
  },
};
