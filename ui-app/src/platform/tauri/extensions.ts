/* ═════════ dxtutor IDE — cliente IPC das extensões VS Code (ADR-0004, Fase 4) ═════════
   Contrato de `vsix_fetch_open_vsx` (src-tauri/src/bridge.rs): o backend descarrega do
   Open VSX o VSIX mais recente de `publisher.name`, valida-o e devolve-o em base64. */

import { invoke } from "./core";

/** Os bytes do VSIX mais recente de `id` no Open VSX. */
export async function fetchOpenVsx(id: string): Promise<Uint8Array<ArrayBuffer>> {
  const b64 = await invoke<string>("vsix_fetch_open_vsx", { id });
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
