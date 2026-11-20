/* ═══════════ feature `debug` — domain: lançadores (ADR-0002, Fase 2) ═══════════
   O gerador PURO da lista «Launch»: o lançador fixo do lexer mais um por cada
   dependência em crash de cada ambiente dado. Sem DOM, sem `window` — os estados dos
   ambientes entram por argumento. (Antes vivia em `features/debug.ts` como
   `debugConfigs`, lendo o global `ENVX.st`.) */

import type { LaunchConfig, LaunchEnv } from "./types";

/** Constrói os lançadores: `lexer` + `crash:<env>:<serviço>` por cada dep em crash. */
export function buildLaunchConfigs(envs: LaunchEnv[]): LaunchConfig[] {
  const c: LaunchConfig[] = [{ id: "lexer", l: "lexer · test tokenize_emits_eof", d: "cargo test -p lexer, under lldb" }];
  envs.forEach(({ env, state }) => { if (state) state.deps.filter((d) => d.status === "crash").forEach((d) => c.push({ id: `crash:${env}:${d.n}`, l: `Attach: ${d.n} (${env})`, d: "CrashLoopBackOff — investigate" })); });
  return c;
}
