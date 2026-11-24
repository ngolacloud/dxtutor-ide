/* ═════════ estado do editor (ADR-0004, U3/U4b) ═════════
   Dono do separador activo (`cur`) e da lista de separadores abertos (`TB`). O app.ts
   reatribui a lista no arranque (`TB=[…]`) e mexe-lhe no lugar; ao deixar de a declarar,
   todas essas escritas passam pelo acessor. */
import { bus } from "../bus";
import { ownedGlobal } from "./owned";

const current = ownedGlobal<string | null>("cur", null, (next, prev) => bus.emit("editor:tab", { id: next, prev }));
/* cada avaliação começa no valor inicial (ADR-0004, U4j5a): numa reavaliação (o harness dos testes reavalia os módulos
   a cada teste) o acessor herdaria o valor que ficou no window; era o app.ts que o repunha no arranque. Na app, que
   avalia uma vez, é o valor que já tem — sem efeito. */
current.set(null);

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
