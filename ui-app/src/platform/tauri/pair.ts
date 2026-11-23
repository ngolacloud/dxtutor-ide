/* ═════════ cliente IPC: PairCode — ADR-0004, U2 ═════════
   Contratos de `pair_host/join/send/stop` (src-tauri/src/commands/pair.rs). O pair.ts
   injecta a simulação (`__PAIRSIM__`) como `Invoker` quando corre no browser. */
import { invoke, type Invoker } from "./core";

export const pairClient = (inv: Invoker = invoke) => ({
  /** Abre a sessão como anfitrião; devolve o token a partilhar. */
  host: (name: string): Promise<string> => inv<string>("pair_host", { name }),
  /** Junta-se a uma sessão; devolve o nome do anfitrião. */
  join: (token: string, via: string | null): Promise<string> => inv<string>("pair_join", { token, via }),
  send: (msg: string): Promise<void> => inv<void>("pair_send", { msg }),
  stop: (): Promise<void> => inv<void>("pair_stop"),
});

export type PairClient = ReturnType<typeof pairClient>;
