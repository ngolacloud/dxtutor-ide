/* ═════════ estado do editor (ADR-0004, U3/U4b) ═════════
   Dono do separador activo (`cur`) e da lista de separadores abertos (`TB`). O app.ts
   reatribui a lista no arranque (`TB=[…]`) e mexe-lhe no lugar; ao deixar de a declarar,
   todas essas escritas passam pelo acessor. */
import { bus } from "../bus";
import { ownedGlobal } from "./owned";

const current = ownedGlobal<string | null>("cur", null, (next, prev) => bus.emit("editor:tab", { id: next, prev }));

/** Um separador do editor (ficheiro, diff, vista). `kind` escolhe o renderer em `VIEW`. */
export interface Tab {
  id: string;
  title: string;
  kind: string;
  path?: string;
  [k: string]: unknown;
}
const tabs = ownedGlobal<Tab[]>("TB", []);

export const editorStore = {
  get currentTabId(): string | null {
    return current.get();
  },
  set currentTabId(v: string | null) {
    current.set(v);
  },
  /** Os separadores abertos, pela ordem da barra. */
  get tabs(): Tab[] {
    return tabs.get();
  },
  set tabs(v: Tab[]) {
    tabs.set(v);
  },
};
