/* ═══════════ Co-Dev — adaptador: a verificação de âmbito entre Co-Devs (Multi Co-Dev, fase 2) ═══════════
   `project_scope_overlap` pelo cliente tipado do Project; a resposta estreita-se no domínio
   (`domain/scope-overlap.ts`). Não toca no `window` (regra A8). */

import { projectClient } from "../../../platform/tauri/project";
import { parseScopeCheck, type ScopeClash } from "../domain/scope-overlap";

const client = projectClient();

/** Os choques de `key` com as issues em curso (`[]`: pode começar). Lança se o backend falhar. */
export async function scopeOverlap(root: string, key: string, running: string[]): Promise<ScopeClash[]> {
  const r = parseScopeCheck(await client.scopeOverlap(root, key, running), key);
  if (!r) throw new Error("resposta inválida da verificação de âmbito");
  return r;
}
