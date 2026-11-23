/* ═════════ estado do editor (ADR-0004, U3) ═════════
   Dono do separador activo. (A lista de separadores, `TABS`, passa para aqui quando o
   app.ts/boot.ts forem absorvidos — U4; até lá continua no window.) */
import { bus } from "../bus";
import { ownedGlobal } from "./owned";

const current = ownedGlobal<string | null>("cur", null, (next, prev) => bus.emit("editor:tab", { id: next, prev }));

export const editorStore = {
  get currentTabId(): string | null {
    return current.get();
  },
  set currentTabId(v: string | null) {
    current.set(v);
  },
};
