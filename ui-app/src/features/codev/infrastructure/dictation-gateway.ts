/* ═══════════ Co-Dev — adaptador: ditado local (whisper.cpp) sobre o IPC ═══════════
   Implementa a porta `DictationPort` com o cliente tipado `platform/tauri/dictation`. Fora
   do desktop não há backend: `available()` é falso e o compositor usa o reconhecimento de
   voz do motor web, se existir. */

import * as ipc from "../../../platform/tauri/dictation";
import { isDesktop } from "../../../platform/tauri/core";
import type { DictationPort } from "../application/ports";

export const dictationGateway: DictationPort = {
  available: () => isDesktop(),
  status: () => ipc.dictationStatus(),
  start: () => ipc.dictationStart(),
  stop: (lang) => ipc.dictationStop(lang),
  cancel: () => ipc.dictationCancel(),
};
