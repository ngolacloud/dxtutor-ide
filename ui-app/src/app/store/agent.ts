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
/* cada avaliação começa no valor inicial (ADR-0004, U4j5a): numa reavaliação (o harness dos testes reavalia os módulos
   a cada teste) o acessor herdaria o valor que ficou no window; era o app.ts que repunha o MODE/ACTIVE/THRESH/CTX_ON no arranque. Na app, que
   avalia uma vez, é o valor que já tem — sem efeito. */
mode.set("assist");
threshold.set(85);
provider.set("claude");
context.set(true);

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
/** Chamadas e tokens por provedor nesta sessão (o painel de custos, o custo por issue). */
export type Usage = Record<string, { calls: number; tok: number }>;
const usage = ownedGlobal<Usage>("USAGE", {
  claude: { calls: 0, tok: 0 },
  gemini: { calls: 0, tok: 0 },
  codex: { calls: 0, tok: 0 },
  ollama: { calls: 0, tok: 0 },
});

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
  get usage(): Usage {
    return usage.get();
  },
  /** Conta uma chamada (e os seus tokens) ao provedor `p`. Era o `use` do app.ts. */
  recordUsage(p: string, tok: number): void {
    const u = usage.get();
    u[p].calls++;
    u[p].tok += tok;
  },
  /** Os provedores ligados. Era o `connected` do app.ts. */
  connectedProviders(): string[] {
    const PROV = providers.get();
    return Object.keys(PROV).filter((k) => PROV[k].on);
  },
};

/* publicação transitória (o monólito e as features chamam use/connected por nome) */
function use(p: string, tok: number): void {
  agentStore.recordUsage(p, tok);
}
function connected(): string[] {
  return agentStore.connectedProviders();
}
Object.assign(window, { use, connected });
