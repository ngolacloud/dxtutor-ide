/* ═════════ estado do layout (ADR-0004, U3) ═════════
   Dono do painel lateral activo, do tema e da língua da interface. */
import { bus } from "../bus";
import { ownedGlobal } from "./owned";

const pane = ownedGlobal<string>("PANE", "explorer", (next, prev) => bus.emit("layout:pane", { pane: next, prev }));
const theme = ownedGlobal<string>("THEME", "Grafite laranja", (next, prev) => bus.emit("layout:theme", { theme: next, prev }));
const locale = ownedGlobal<string>("LOCALE", "en", (next, prev) => bus.emit("layout:locale", { locale: next, prev }));

export const layoutStore = {
  get pane(): string {
    return pane.get();
  },
  set pane(v: string) {
    pane.set(v);
  },
  get theme(): string {
    return theme.get();
  },
  set theme(v: string) {
    theme.set(v);
  },
  get locale(): string {
    return locale.get();
  },
  set locale(v: string) {
    locale.set(v);
  },
};
