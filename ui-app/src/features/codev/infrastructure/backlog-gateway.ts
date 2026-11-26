/* ═══════════ Co-Dev — adaptador: as propostas do `/backlog` e do `/project` (conjunto 11) ═══════════
   O evento `backlog://proposal` (src-tauri/src/backlog.rs) estreitado pelo domínio. Só no desktop. */

import { onBacklogProposal } from "../../../platform/tauri/project";
import { isDesktop } from "../../../platform/tauri/core";
import { parseBacklogProposal, type BacklogProposal } from "../domain/backlog";

export function subscribeBacklogProposals(h: (p: BacklogProposal) => void): void {
  if (!isDesktop()) return;
  void onBacklogProposal((raw) => {
    const p = parseBacklogProposal(raw);
    if (p) h(p);
  });
}
