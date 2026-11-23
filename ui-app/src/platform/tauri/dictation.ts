/* ═════════ dxtutor IDE — cliente IPC do ditado local (whisper.cpp) ═════════
   Contrato dos comandos `dictation_*` (src-tauri/src/commands/dictation.rs). A gravação e
   a transcrição correm no backend: o WebKitGTK não tem reconhecimento de voz. */

import { invoke } from "./core";

export interface DictationStatus {
  ready: boolean;
  binary: string | null;
  model: string | null;
  recorder: string | null;
  /** O que falta instalar, em texto para a UI. */
  missing: string[];
  recording: boolean;
}

export const dictationStatus = (): Promise<DictationStatus> => invoke<DictationStatus>("dictation_status");
export const dictationStart = (): Promise<void> => invoke<void>("dictation_start");
/** Pára e transcreve; `lang`: `pt`, `en`, … ou `auto`. */
export const dictationStop = (lang: string): Promise<string> => invoke<string>("dictation_stop", { lang });
export const dictationCancel = (): Promise<void> => invoke<void>("dictation_cancel");
