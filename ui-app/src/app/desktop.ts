/* ═════════ dxtutor IDE — portas desktop injectadas nos donos (ADR-0004, U4h) ═════════
   Na app Tauri, a parte desktop de cada feature (platform/desktop/<área>) instala aqui a
   sua porta; o dono consulta-a no acto (`desktopPorts.scm?.commit(…)`) em vez de o desktop
   reatribuir funções no `window`. No browser e nos testes fica vazio e os donos usam só a
   versão simulada. Cada interface é definida pela feature dona (application/ports.ts). */

import type { ScmDesktop } from "../features/scm/application/ports";
import type { TerminalDesktop } from "../features/terminal";
import type { StackDesktop } from "../features/stack";
import type { InfraDesktop } from "../features/infra/application/ports";
import type { CodevDesktop } from "../features/codev/application/ports";
import type { BoardDesktop } from "../features/board/application/ports";
import type { ExplorerDesktop } from "../features/explorer";
import type { WelcomeDesktop } from "../features/welcome";
import type { ChangelogDesktop } from "../features/changelog";
import type { ExtDesktop } from "../features/ext/application/ports";

export interface DesktopPorts {
  /** git real no repositório aberto (platform/desktop/git.ts) — U4h2 */
  scm?: ScmDesktop;
  /** shell e prompt reais na pasta aberta (platform/desktop/terminal.ts) — U4h3 */
  terminal?: TerminalDesktop;
  /** docker compose real (platform/desktop/infra.ts) — U4h4 */
  stack?: StackDesktop;
  /** runtime, cluster, deploy e logs reais (platform/desktop/infra.ts) — U4h4 */
  infra?: InfraDesktop;
  /** modelos reais (nota do agente, Test connection, provedores, Settings) e a guarda das missões — U4h5 */
  codev?: CodevDesktop;
  /** a guarda das corridas de sprint — U4h5 */
  board?: BoardDesktop;
  /** o nome da pasta aberta na raiz do explorador — U4h5b */
  explorer?: ExplorerDesktop;
  /** «Open Folder…» e as pastas recentes na página de boas-vindas — U4h5b */
  welcome?: WelcomeDesktop;
  /** o git log/show reais do changelog — U4h5b */
  changelog?: ChangelogDesktop;
  /** o JSZip embutido na app — U4h5b */
  ext?: ExtDesktop;
}

export const desktopPorts: DesktopPorts = {};
