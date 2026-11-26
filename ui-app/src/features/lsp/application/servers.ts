/* ═════════ feature `lsp` — os servidores de linguagem vivos (caso de uso, LSP P6) ═════════
   «LSP: Show Running Language Servers» abre a lista (pid, pasta, ficheiros abertos, tempo inactivo, memória)
   e mantém-na em dia enquanto está aberta (de `REFRESH_MS` em `REFRESH_MS`, e logo que o backend diz que a
   lista mudou); «Stop» e «Restart» vão ao backend, que pára o servidor como o protocolo pede. Quando o tecto
   de servidores não se cumpre (todos têm ficheiros abertos), o editor di-lo. Sem DOM e sem `window`. */

import type { LspServersKey } from "./servers-messages";
import type { ServersPort, ServersScreen } from "./ports";
import type { LimitNotice, ServersView } from "../domain/servers";

export type ServersCopy = (key: LspServersKey, params?: Record<string, string | number>) => string;

export interface ServersDeps {
  port: ServersPort;
  screen: ServersScreen;
  copy: ServersCopy;
  notify(message: string): void;
  /** abre o canal «Language servers» do Output */
  showLog(): void;
  /** de quanto em quanto tempo repetir (os testes passam uma que não repete) */
  every(ms: number, f: () => void): () => void;
}

/** Enquanto a lista está aberta, relê-a de tanto em tanto (o tempo inactivo e a memória mudam). */
export const REFRESH_MS = 2000;

export interface Servers {
  /** abre a lista */
  show(): Promise<void>;
  /** o backend avisou que o tecto não se cumpriu */
  onLimit(l: LimitNotice): void;
}

export function makeServers(d: ServersDeps): Servers {
  let stopTimer: (() => void) | null = null;
  let last: ServersView | null = null;

  const labelOf = (key: string): string => last?.servers.find((s) => s.key === key)?.label ?? key.split("\u0000")[0];

  async function refresh(): Promise<void> {
    if (!d.screen.isOpen()) return halt();
    try {
      last = await d.port.list();
    } catch {
      return;
    }
    if (d.screen.isOpen()) d.screen.show(last, acts);
    else halt();
  }

  function halt(): void {
    stopTimer?.();
    stopTimer = null;
  }

  async function act(key: string, what: "stop" | "restart"): Promise<void> {
    const label = labelOf(key);
    try {
      await (what === "stop" ? d.port.stop(key) : d.port.restart(key));
      d.notify(d.copy(what === "stop" ? "stopped" : "restarted", { label }));
    } catch (e) {
      d.notify(d.copy("failed", { label, error: e instanceof Error ? e.message : String(e) }));
    }
    await refresh();
  }

  const acts = {
    stop: (key: string) => void act(key, "stop"),
    restart: (key: string) => void act(key, "restart"),
    showLog: () => d.showLog(),
  };

  d.port.onChanged(() => {
    if (d.screen.isOpen()) void refresh();
  });

  return {
    async show() {
      try {
        last = await d.port.list();
      } catch (e) {
        d.notify(d.copy("failed", { label: "LSP", error: e instanceof Error ? e.message : String(e) }));
        return;
      }
      d.screen.show(last, acts);
      if (!stopTimer) stopTimer = d.every(REFRESH_MS, () => void refresh());
    },
    onLimit(l) {
      d.notify(d.copy("limit", { running: l.running, max: l.max }));
    },
  };
}
