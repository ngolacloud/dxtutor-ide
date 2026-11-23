/* ═════════ dxtutor IDE — cliente IPC do assistente (provedores locais) ═════════
   Contrato de `assistant_models` (src-tauri/src/commands/assistant.rs). */

import { invoke } from "./core";

/** Os modelos instalados no Ollama local (vazio se o servidor não responder). */
export const ollamaModels = (): Promise<string[]> => invoke<string[]>("assistant_models");
