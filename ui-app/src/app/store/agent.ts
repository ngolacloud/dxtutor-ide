/* ═════════ estado do agente Co-Dev (ADR-0004, U3) ═════════
   Dono do modo de autonomia, do limiar, do provedor activo, do contexto do editor e do
   assistente da conversa. Antes: primitivos soltos no window, escritos pelo app.ts, pelo
   legacy-bridge do Co-Dev e por onclick inline. */
import { bus } from "../bus";
import { ownedGlobal } from "./owned";

const mode = ownedGlobal<string>("MODE", "assist", (next, prev) => bus.emit("agent:mode", { mode: next, prev }));
const threshold = ownedGlobal<number>("THRESH", 85, (next, prev) => bus.emit("agent:threshold", { value: next, prev }));
const provider = ownedGlobal<string>("ACTIVE", "claude", (next, prev) => bus.emit("agent:provider", { provider: next, prev }));
const context = ownedGlobal<boolean>("CTX_ON", true, (next) => bus.emit("agent:context", { enabled: next }));
const persona = ownedGlobal<string>("AGENT", "lead", (next, prev) => bus.emit("agent:persona", { persona: next, prev }));

export const agentStore = {
  get mode(): string {
    return mode.get();
  },
  set mode(v: string) {
    mode.set(v);
  },
  get threshold(): number {
    return threshold.get();
  },
  set threshold(v: number) {
    threshold.set(v);
  },
  get provider(): string {
    return provider.get();
  },
  set provider(v: string) {
    provider.set(v);
  },
  get contextEnabled(): boolean {
    return context.get();
  },
  set contextEnabled(v: boolean) {
    context.set(v);
  },
  get persona(): string {
    return persona.get();
  },
  set persona(v: string) {
    persona.set(v);
  },
};
