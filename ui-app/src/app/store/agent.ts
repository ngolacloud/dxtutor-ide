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

/* colecções (U3c): o app.ts cria-as e publica-as; o acessor adopta o mesmo objecto */
export interface Provider {
  name: string;
  model: string;
  ep?: string;
  on?: boolean;
  local?: boolean;
  col?: string;
}
export interface ChatMessage {
  role: string;
  content: string;
}
export interface RunState {
  active: boolean;
  paused: boolean;
  stop: boolean;
  label: string;
  t0: number;
  [k: string]: unknown;
}
const providers = ownedGlobal<Record<string, Provider>>("PROV", {});
const chat = ownedGlobal<ChatMessage[]>("CHAT", []);
const run = ownedGlobal<RunState>("RUN", { active: false, paused: false, stop: false, label: "", t0: 0 });

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
  /** Os provedores (nome, modelo, endpoint, ligado). Mudar um → `providerChanged(k)`. */
  get providers(): Record<string, Provider> {
    return providers.get();
  },
  /** A configuração do provedor `k` mudou no lugar (modelo, ligado/desligado). */
  providerChanged(k: string): void {
    bus.emit("agent:providers", { provider: k });
  },
  get chat(): ChatMessage[] {
    return chat.get();
  },
  get run(): RunState {
    return run.get();
  },
};
