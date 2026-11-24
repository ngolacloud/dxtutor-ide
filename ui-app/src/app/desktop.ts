/* ═════════ dxtutor IDE — portas desktop injectadas nos donos (ADR-0004, U4h) ═════════
   Na app Tauri, a parte desktop de cada feature (platform/desktop/<área>) instala aqui a
   sua porta; o dono consulta-a no acto (`desktopPorts.scm?.commit(…)`) em vez de o desktop
   reatribuir funções no `window`. No browser e nos testes fica vazio e os donos usam só a
   versão simulada. Cada interface é definida pela feature dona (application/ports.ts). */

import type { ScmDesktop } from "../features/scm/application/ports";

export interface DesktopPorts {
  /** git real no repositório aberto (platform/desktop/git.ts) — U4h2 */
  scm?: ScmDesktop;
}

export const desktopPorts: DesktopPorts = {};
