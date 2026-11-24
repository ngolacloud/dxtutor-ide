/* ═════════ dxtutor IDE — cliente IPC das extensões VS Code (ADR-0005, Fase 4) ═════════
   Contratos de `vsix_fetch_open_vsx` e `vsix_search_open_vsx` (src-tauri/src/bridge.rs): o backend
   pesquisa no Open VSX (R6b do ADR-0006) e descarrega do
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

/** Um resultado da pesquisa do Open VSX (`vsix::OvsxHit`, camelCase) — ADR-0006, R6b. */
export interface OvsxHit {
  id: string;
  name: string;
  publisher: string;
  description: string;
  version: string;
  downloads: number;
  verified: boolean;
}

/** Pesquisa extensões no Open VSX (o backend só fala com open-vsx.org). */
export const searchOpenVsx = (query: string, size?: number): Promise<OvsxHit[]> =>
  invoke<OvsxHit[]>("vsix_search_open_vsx", { query, size: size ?? null });
