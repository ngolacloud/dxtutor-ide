/* ═══════════ feature `testing` — application: o serviço do pane (ADR-0006, R2a) ═══════════
   Estado e casos de uso do pane «Testing», sobre os comandos reais do backend: descobrir os
   testes da pasta aberta (`list_tests`), correr um (`run_test`) ou a suíte inteira
   (`run_all_tests`). Sem DOM nem `window`: quem desenha subscreve e lê `state()`.

   Regras: uma corrida de cada vez (o backend corre o cargo/go/python, que não gostam de
   corridas sobrepostas na mesma pasta); trocar de pasta descarta resultados e corridas em
   voo (o resultado de uma pasta antiga nunca pinta a nova); um erro de IPC fica no estado
   em vez de rebentar. */

import { statesAfterSuite, testKey } from "../domain/results";
import type { TestItem, TestRun, TestState } from "../domain/types";
import type { TestsPort, WorkspacePort } from "./ports";

export interface TestingState {
  /** A pasta a que os testes pertencem (null = ainda nada carregado). */
  root: string | null;
  items: TestItem[];
  /** A descoberta já correu para `root`. */
  loaded: boolean;
  loading: boolean;
  /** Há uma corrida (um teste ou a suíte) em curso. */
  running: boolean;
  states: Record<string, TestState>;
  /** A última corrida de «Run all» (veredicto + saída combinada). */
  suite: TestRun | null;
  error: string | null;
}

export interface Testing {
  state(): TestingState;
  /** Garante a descoberta para a pasta aberta (no-op se já carregada para ela). */
  ensure(): void;
  refresh(): Promise<void>;
  runOne(key: string): Promise<void>;
  runAll(): Promise<void>;
  subscribe(fn: () => void): () => void;
}

const fresh = (root: string | null): TestingState => ({ root, items: [], loaded: false, loading: false, running: false, states: {}, suite: null, error: null });

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeTesting(deps: { tests: TestsPort; workspace: WorkspacePort }): Testing {
  const { tests, workspace } = deps;
  let st = fresh(null);
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  /** Muda para a pasta aberta se mudou: descarta tudo o que era da anterior. */
  function sync(): string | null {
    const root = workspace.root();
    if (root !== st.root) st = fresh(root);
    return root;
  }

  async function refresh(): Promise<void> {
    const root = sync();
    if (!root || st.loading || st.running) return;
    st.loading = true; st.error = null; emit();
    try {
      await workspace.save?.();
      const items = await tests.list(root);
      if (st.root !== root) return; // a pasta mudou entretanto
      st.items = items;
      const keep: Record<string, TestState> = {};
      for (const t of items) { const k = testKey(t), prev = st.states[k]; if (prev) keep[k] = prev; }
      st.states = keep;
    } catch (e) {
      if (st.root !== root) return;
      st.error = msg(e);
    } finally {
      if (st.root === root) { st.loading = false; st.loaded = true; emit(); }
    }
  }

  function ensure(): void {
    sync();
    if (st.root && !st.loaded && !st.loading) void refresh();
  }

  async function runOne(key: string): Promise<void> {
    const root = sync();
    const t = st.items.find((x) => testKey(x) === key);
    if (!root || !t || st.running) return;
    st.running = true; st.error = null; st.states[key] = { status: "running" }; emit();
    try {
      await workspace.save?.();
      const r = await tests.run(root, t.path, t.lang);
      if (st.root !== root) return;
      st.states[key] = { status: r.ran ? (r.passed ? "passed" : "failed") : "failed", output: r.output };
    } catch (e) {
      if (st.root !== root) return;
      st.states[key] = { status: "failed", output: msg(e) };
    } finally {
      if (st.root === root) { st.running = false; emit(); }
    }
  }

  async function runAll(): Promise<void> {
    const root = sync();
    if (!root || st.running) return;
    st.running = true; st.error = null;
    for (const t of st.items) st.states[testKey(t)] = { status: "running" };
    emit();
    try {
      await workspace.save?.();
      const r = await tests.runAll(root);
      if (st.root !== root) return;
      st.suite = r;
      st.states = statesAfterSuite(st.items, r);
    } catch (e) {
      if (st.root !== root) return;
      st.error = msg(e);
      st.states = {};
    } finally {
      if (st.root === root) { st.running = false; emit(); }
    }
  }

  return {
    state: () => st,
    ensure,
    refresh,
    runOne,
    runAll,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
