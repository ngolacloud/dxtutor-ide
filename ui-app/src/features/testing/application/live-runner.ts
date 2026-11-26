/* ═════════ feature `testing` — caso de uso: o runner ao vivo do painel «Tests» ═════════
   Corre a suite do projecto com a saída a chegar linha a linha (`proc.run`), alimenta o domínio
   (`domain/live.ts`) e pede à vista para redesenhar. Uma corrida de cada vez: pedir outra enquanto
   uma corre pára a anterior. Quem pede (o «Accept & test» do Code review, a paleta, o Testing)
   recebe no fim `{ ran, passed, output }` — a mesma forma do `run_tests` do backend.
   Sem DOM, sem `window`: o processo, a pasta e a vista chegam por portas. */

import { newRun, feed, finish, liveCommand, type LiveRun } from "../domain/live";

export interface LiveProcPort {
  /** corre a linha na pasta aberta; `line` recebe cada linha; resolve com o código de saída */
  run(command: string, o: { line: (l: string) => void; onId: (id: string) => void }): Promise<number>;
  kill(id: string): Promise<boolean>;
}

export interface LiveDeps {
  proc: LiveProcPort;
  /** a pasta aberta e o comando de testes detectado (`null` sem pasta / sem comando) */
  root(): string | null;
  testCommand(): string | null;
  /** grava o editor no disco e espera pela fila de escrita */
  save(): Promise<void>;
  /** mostra o separador «Tests» do painel */
  reveal(): void;
  render(run: LiveRun | null): void;
  /** o relógio (os testes passam um fixo) */
  now?: () => number;
}

export interface LiveResult { ran: boolean; passed: boolean; output: string }

export function makeLiveRunner(deps: LiveDeps) {
  const now = deps.now ?? (() => Date.now());
  let run: LiveRun | null = null;
  let procId: string | null = null;
  let seq = 0;
  let lastOpts: { source: string; command?: string } = { source: "" };

  async function start(o: { source: string; command?: string }): Promise<LiveResult> {
    lastOpts = o;
    const base = o.command ?? deps.testCommand();
    if (!deps.root() || !base) {
      const why = !deps.root() ? "no-folder" : "no-command";
      run = newRun(base ?? "", o.source, now());
      run.phase = "error";
      run.error = why;
      deps.reveal();
      deps.render(run);
      return { ran: false, passed: false, output: why };
    }
    await stop();
    const my = ++seq;
    const command = liveCommand(base);
    const r = newRun(command, o.source, now());
    run = r;
    deps.reveal();
    deps.render(r);
    await deps.save();
    let code = -1;
    try {
      code = await deps.proc.run(command, {
        line: (l) => { if (seq !== my) return; feed(r, l); deps.render(r); },
        onId: (id) => { if (seq === my) procId = id; },
      });
    } catch (e) {
      if (seq !== my) return { ran: false, passed: false, output: "" };
      r.phase = "error";
      r.endedAt = now();
      r.error = e instanceof Error ? e.message : String(e);
      deps.render(r);
      return { ran: false, passed: false, output: r.error };
    }
    if (seq !== my) { finish(r, code, now()); return { ran: false, passed: false, output: "" }; } // parada ou trocada por outra
    procId = null;
    finish(r, code, now());
    deps.render(r);
    return { ran: r.phase !== "stopped", passed: r.phase === "passed", output: `$ ${command}\n${r.log.join("\n")}` };
  }

  /** Pára a corrida em curso (o grupo de processos inteiro). */
  async function stop(): Promise<void> {
    const id = procId;
    if (run && (run.phase === "starting" || run.phase === "building" || run.phase === "running")) {
      run.phase = "stopped";
      run.now = "";
      run.endedAt = now();
      deps.render(run);
    }
    procId = null;
    seq++;
    if (id) { try { await deps.proc.kill(id); } catch { /* já acabou */ } }
  }

  return {
    start,
    stop,
    /** corre outra vez o mesmo pedido */
    rerun: (): Promise<LiveResult> => start(lastOpts.source ? lastOpts : { source: "Tests" }),
    state: (): LiveRun | null => run,
    running: (): boolean => !!run && (run.phase === "starting" || run.phase === "building" || run.phase === "running"),
  };
}

export type LiveRunner = ReturnType<typeof makeLiveRunner>;
