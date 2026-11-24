/* ═════════ estado do layout (ADR-0004, U3) ═════════
   Dono do painel lateral activo, do tema e da língua da interface. */
import { bus } from "../bus";
import { ownedGlobal, ownedValue } from "./owned";

const pane = ownedGlobal<string>("PANE", "explorer", (next, prev) => bus.emit("layout:pane", { pane: next, prev }));
/* cada avaliação começa no valor inicial (ADR-0004, U4j5a): numa reavaliação (o harness dos testes reavalia os módulos
   a cada teste) o acessor herdaria o valor que ficou no window; era o app.ts que o repunha no arranque. Na app, que
   avalia uma vez, é o valor que já tem — sem efeito. */
pane.set("explorer");
const theme = ownedValue<string>("Grafite laranja", (next, prev) => bus.emit("layout:theme", { theme: next, prev }));
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
