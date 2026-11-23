/* ═════════ dxtutor IDE — desktop: as demos guionadas ficam no exemplo (ADR-0004, U4h1) ═════════
   As missões e as corridas de sprint são demos guionadas: com uma pasta real aberta, avisam
   e não correm. Era a secção «scripted demo flows» do bridge.ts, verbatim; as guardas são as portas `desktopPorts.codev.runMission`/`desktopPorts.board.runSprint` (U4h5). */

import type { DesktopContext } from "./context";
import { desktopPorts } from "../../app/desktop";

export function installDemos(ctx: DesktopContext): void {
const { R } = ctx;
/* ───── scripted demo flows stay on the sample workspace ───── */
const sampleOnly = (what: string) => { toast(`${what} are scripted demos — they run on the sample workspace (File → Close Folder)`); };
/* as guardas entram pelas portas do Co-Dev e do board (ADR-0004, U4h5): o board.ts consulta-a
   no runSprint que publica (as missões guionadas saíram — ADR-0005, R1b) — antes eram reatribuídos no `window`. */
(desktopPorts.board ??= {}).runSprint = function (s, _runSprint) { if (R.root) { sampleOnly("Sprint runs"); return; } return _runSprint(s); };
}
