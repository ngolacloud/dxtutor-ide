/* ═════════ dxtutor IDE — desktop: as demos guionadas ficam no exemplo (ADR-0004, U4h1) ═════════
   As missões e as corridas de sprint são demos guionadas: com uma pasta real aberta, avisam
   e não correm. Era a secção «scripted demo flows» do bridge.ts, verbatim. */

import type { DesktopContext } from "./context";

export function installDemos(ctx: DesktopContext): void {
const { R } = ctx;
/* ───── scripted demo flows stay on the sample workspace ───── */
const _runMission = runMission, _runSprint = runSprint;
const sampleOnly = (what: string) => { toast(`${what} are scripted demos — they run on the sample workspace (File → Close Folder)`); };
runMission = function (S: any, text?: any) { if (R.root) { sampleOnly("Missions"); return; } return _runMission(S, text); };
runSprint = function (s: any) { if (R.root) { sampleOnly("Sprint runs"); return; } return _runSprint(s); };
}
