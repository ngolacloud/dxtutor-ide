/* ═════════ dxtutor IDE — adaptador IPC tipado (Etapa 2) ═════════
   Cliente de invocação Tauri TIPADO. Primeiro tijolo da fronteira `platform/tauri/`
   prevista no mapa de migração (UI `invoke`/casts dispersos → cliente tipado + contratos):
   em vez de cada chamada fazer `__TAURI__.core.invoke("cmd", {...}) as any` à solta em
   `bridge.ts`, cada comando ganha um módulo tipado em `platform/tauri/` com o seu contrato.

   Esta fatia liga `load_workspace`; os restantes 27 comandos consumidos migram comando-a-comando
   em etapas seguintes, sem quebrar os que já estão ligados. O tipo global `__TAURI__` é o
   declarado por `pair.ts` (visível em todo o projecto). */

export {};

/** Verdadeiro dentro da casca desktop (Tauri presente); falso no browser/simulação. */
export function isDesktop(): boolean {
  return !!(window.__TAURI__ && window.__TAURI__.core);
}

/** Quem invoca comandos: o `invoke` real, ou um substituto (a simulação do PairCode, testes).
 *  Os clientes de `platform/tauri/` recebem-no por argumento — injecção, não globais. */
export type Invoker = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

/**
 * Invoca um comando Tauri com um tipo de retorno explícito. É o único ponto onde o cast do
 * valor cru de `invoke` acontece — concentrado e tipado, em vez de espalhado por `bridge.ts`.
 * Só deve ser chamado em contexto desktop (ver {@link isDesktop}); fora dele lança, para o
 * erro ser óbvio em vez de um `undefined` silencioso.
 */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.core) {
    return Promise.reject(new Error(`IPC indisponível: comando "${cmd}" chamado fora do desktop`));
  }
  return tauri.core.invoke(cmd, args || {}) as Promise<T>;
}

/**
 * Subscreve um evento Tauri. Devolve a função que cancela a subscrição. O `payload` chega
 * como `unknown`: quem subscreve valida/estreita-o para o contrato do evento.
 */
export async function listen(event: string, handler: (payload: unknown) => void): Promise<() => void> {
  const tauri = window.__TAURI__;
  if (!tauri || !tauri.event) throw new Error(`IPC indisponível: evento "${event}" fora do desktop`);
  const off = await tauri.event.listen(event, (e) => handler(e.payload));
  return typeof off === "function" ? (off as () => void) : () => {};
}
