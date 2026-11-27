/* ═════════ feature `integration` — a ponte legada (Multi Co-Dev, fase 4) ═════════
   O ÚNICO ficheiro da subárvore que toca em `window` (A8): a pasta aberta no disco e o comando de testes
   detectado nela (`DXR.root`/`DXR.projectCmd`, do desktop). Lido NO ACTO. */
import { toast } from "../../../core";

interface Globals {
  DXR?: { root?: string | null; projectCmd?: (kind: "test" | "lint") => { cmd: string } | null };
}
const G = window as unknown as Globals;

export const root = (): string | null => G.DXR?.root ?? null;
export const detectedTest = (): string | null => G.DXR?.projectCmd?.("test")?.cmd ?? null;
export const notify = (m: string): void => toast(m);
