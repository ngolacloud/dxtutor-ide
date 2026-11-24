/* ═══════════ feature `testing` — application: as corridas dos runners reais (A6, docs/v2/UI-AUDIT.md item 3) ═══════════
   Estado e casos de uso da parte A6 do pane: os runners que o projecto tem de facto
   (`test_runners`), as corridas com resultado por teste (`test_run`: todos, um teste, os
   afectados pelos ficheiros alterados), «Watch» (os afectados a cada gravação), o histórico
   guardado em SQLite (`test_history`) e os pedidos ao Co-Dev (explicar/corrigir uma falha,
   escrever o teste em falta, causa provável de um teste instável). Sem DOM nem `window`.

   Regras (as do serviço da descoberta): uma corrida de cada vez — também contra as corridas
   da descoberta (`busy`); trocar de pasta descarta tudo e o resultado de uma pasta antiga
   nunca pinta a nova; um erro de IPC fica no estado do runner em vez de rebentar. As
   gravações que chegam durante uma corrida esperam por ela. */

import { caseFilter, failureContext, flakyContext } from "../domain/runs";
import type { CaseResult, Runner, TestHistory, TestRunReport, TestScope } from "../domain/types";
import type { CodevPort, RunnersPort, WorkspacePort } from "./ports";

export interface RunsState {
  root: string | null;
  runners: Runner[];
  loaded: boolean;
  loading: boolean;
  /** a última corrida de cada runner (correr um teste actualiza só esse resultado nela) */
  reports: Record<string, TestRunReport>;
  /** o runner a correr e o quê («all», «changed» ou o nome do teste); null = nada */
  running: { runner: string; what: string } | null;
  errors: Record<string, string>;
  history: TestHistory | null;
  /** o resultado aberto: `<runner id>|<case id>` */
  selected: string | null;
  watch: boolean;
}

export interface Runs {
  state(): RunsState;
  /** Carrega os runners e o histórico da pasta aberta (no-op se já carregados para ela). */
  ensure(): void;
  reload(): Promise<void>;
  /** Há runners disponíveis (o «Run all» do cabeçalho passa a corrê-los). */
  hasRunners(): boolean;
  runAll(): Promise<void>;
  run(runner: string, scope: TestScope): Promise<void>;
  /** Corre só o teste `<runner id>|<case id>`, com o nome que o runner precisa. */
  runCase(key: string): Promise<void>;
  select(key: string): void;
  setWatch(on: boolean): void;
  /** O editor gravou estes ficheiros (relativos à pasta). */
  saved(files: string[]): void;
  askFailure(intent: "explain" | "fix", key: string): void;
  askFlaky(caseId: string): void;
  writeMissingTest(): void;
  busy(): boolean;
  subscribe(fn: () => void): () => void;
}

const fresh = (root: string | null): RunsState => ({ root, runners: [], loaded: false, loading: false, reports: {}, running: null, errors: {}, history: null, selected: null, watch: false });
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const split = (s: string): [string, string] => { const i = s.indexOf("|"); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; };

export function makeRuns(deps: {
  runners: RunnersPort;
  workspace: WorkspacePort;
  codev: CodevPort;
  /** outra corrida em curso (a descoberta: `run_test`/`run_all_tests`) */
  busy?: () => boolean;
  /** cada corrida terminada (para acender a lista descoberta) */
  onReport?: (rep: TestRunReport) => void;
  /** o atraso do «Watch» (juntar as gravações seguidas); injectável nos testes */
  debounce?: (f: () => void, ms: number) => () => void;
}): Runs {
  const { runners: port, workspace, codev } = deps;
  const debounce = deps.debounce ?? ((f, ms) => { const t = setTimeout(f, ms); return () => clearTimeout(t); });
  let st = fresh(null);
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };
  let pending = new Set<string>();
  let cancelWatch: (() => void) | null = null;

  function sync(): string | null {
    const root = workspace.root();
    if (root !== st.root) { st = fresh(root); pending = new Set(); cancelWatch?.(); cancelWatch = null; }
    return root;
  }

  async function loadHistory(root: string): Promise<void> {
    try {
      const h = await port.history(root);
      if (st.root === root) { st.history = h; emit(); }
    } catch {
      if (st.root === root && !st.history) { st.history = { runs: [], cases: [] }; emit(); }
    }
  }

  async function reload(): Promise<void> {
    const root = sync();
    if (!root || st.loading) return;
    st.loading = true; emit();
    try {
      const rs = await port.runners(root);
      if (st.root !== root) return;
      st.runners = rs;
    } catch {
      if (st.root !== root) return;
      st.runners = []; // sem o comando (backend antigo) ou sem runners: o pane fica como antes
    } finally {
      if (st.root === root) { st.loading = false; st.loaded = true; emit(); }
    }
    if (st.root === root && st.runners.length) await loadHistory(root);
  }

  const busy = (): boolean => !!st.running || !!deps.busy?.();

  async function run(id: string, scope: TestScope): Promise<void> {
    const root = sync();
    const r = st.runners.find((x) => x.id === id);
    if (!root || !r || !r.available || busy()) return;
    st.running = { runner: id, what: scope.kind === "case" ? scope.name : scope.kind };
    delete st.errors[id];
    emit();
    try {
      await workspace.save?.();
      const rep = await port.run(root, id, scope);
      if (st.root !== root) return;
      const prev = st.reports[id];
      if (scope.kind === "case" && prev && rep.ran) {
        const byId = new Map(rep.results.map((c) => [c.id, c]));
        const results = prev.results.map((c) => byId.get(c.id) ?? c).concat(rep.results.filter((c) => !prev.results.some((p) => p.id === c.id)));
        st.reports[id] = { ...prev, results };
      } else st.reports[id] = rep;
      deps.onReport?.(rep);
    } catch (e) {
      if (st.root !== root) return;
      st.errors[id] = msg(e);
    } finally {
      if (st.root === root) { st.running = null; emit(); }
    }
    if (st.root !== root) return;
    await loadHistory(root);
    if (pending.size && st.watch) flushWatch();
  }

  async function runAll(): Promise<void> {
    for (const r of st.runners.filter((x) => x.available)) await run(r.id, { kind: "all" });
  }

  function flushWatch(): void {
    if (busy()) return; // a corrida em curso volta a chamar no fim
    const files = [...pending]; pending = new Set();
    if (!files.length) return;
    const hit = st.runners.filter((r) => r.available && (r.dir === "." || files.some((f) => f.startsWith(r.dir + "/"))));
    void (async () => { for (const r of hit) await run(r.id, { kind: "changed", files }); })();
  }

  function find(key: string): { rep: TestRunReport; c: CaseResult; r: Runner } | null {
    const [rid, cid] = split(key);
    const rep = st.reports[rid], r = st.runners.find((x) => x.id === rid), c = rep?.results.find((x) => x.id === cid);
    return rep && r && c ? { rep, c, r } : null;
  }

  return {
    state: () => st,
    ensure: () => { sync(); if (st.root && !st.loaded && !st.loading) void reload(); },
    reload,
    hasRunners: () => st.runners.some((r) => r.available),
    runAll,
    run,
    runCase: async (key) => {
      const f = find(key);
      const name = f ? caseFilter(f.r.kind, f.c) : null;
      if (!f || !name) return;
      st.selected = key;
      await run(f.r.id, { kind: "case", name });
    },
    select: (key) => { st.selected = st.selected === key ? null : key; emit(); },
    setWatch: (on) => { st.watch = on; if (!on) { pending = new Set(); cancelWatch?.(); cancelWatch = null; } emit(); },
    saved: (files) => {
      sync();
      if (!st.watch || !st.root) return;
      files.forEach((f) => pending.add(f));
      cancelWatch?.();
      cancelWatch = debounce(() => { cancelWatch = null; flushWatch(); }, 400);
    },
    askFailure: (intent, key) => {
      const f = find(key);
      if (!f || !codev.available()) return;
      const ctx = failureContext(f.rep, f.c);
      if (intent === "explain") codev.ask({ intent: "explain", text: "Explica porque é que este teste falha.", context: [ctx], send: true });
      else codev.ask({ intent: "fix", text: `Corrige o código para o teste «${f.c.name}» passar (não alteres o teste, a não ser que esteja errado). Depois corre \`${f.rep.command}\`.`, context: [ctx], send: true });
    },
    askFlaky: (caseId) => {
      const s = st.history?.cases.find((c) => c.caseId === caseId);
      if (!s || !codev.available()) return;
      codev.ask({ intent: "explain", text: "Este teste passa e falha sem o código mudar. Qual é a causa provável e como o tornar determinista?", context: [flakyContext(s)], send: true });
    },
    writeMissingTest: () => {
      if (!codev.available()) return;
      const f = workspace.currentFile?.() ?? null;
      const r = st.runners.find((x) => x.available);
      const how = r ? ` com ${r.kind} (o projecto corre \`${r.command}\`)` : "";
      codev.ask({
        intent: "change",
        text: f ? `Escreve o teste em falta para ${f.path}${how}: cobre o comportamento que os testes actuais não verificam.` : `Escreve o teste em falta${how}.`,
        context: f ? [{ kind: "file", label: f.path, text: f.text.slice(0, 12000), path: f.path }] : [],
      });
    },
    busy,
    subscribe: (fn) => { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
