/* ═════════ feature `panel` — Problems (caso de uso) ═════════
   Corre os checkers do workspace (via porta) quando o workspace abre e depois de cada
   gravação — com debounce e em voo único: um pedido durante um scan marca «de novo» e
   corre um só scan a seguir. Junta os diagnósticos ao vivo de um language server, e
   relata cada checker no canal «Problems» do Output. */

import type { Problem, ScanResult } from "../domain/types";
import { fromLsp, mergeLive } from "../domain/problems";
import { duration } from "../domain/naming";
import type { Clock, ProblemsPort, WorkspacePort } from "./ports";
import type { OutputLog } from "./output";

export const PROBLEMS_CHANNEL = "Problems";
const DEBOUNCE = 1500;

export interface ProblemsState {
  scan: ScanResult | null;
  running: boolean;
  /** Raiz do último scan (um scan de outra pasta é descartado). */
  root: string | null;
  finishedAt: number | null;
  error: string | null;
}

export interface ProblemsService {
  state(): Readonly<ProblemsState>;
  all(): Problem[];
  request(reason: string, immediate?: boolean): void;
  reset(): void;
  subscribe(f: () => void): () => void;
}

export function makeProblems(deps: { port: ProblemsPort; workspace: WorkspacePort; output: OutputLog; clock: Clock }): ProblemsService {
  const { port, workspace, output, clock } = deps;
  const st: ProblemsState = { scan: null, running: false, root: null, finishedAt: null, error: null };
  const live = new Map<string, Problem[]>();
  const subs = new Set<() => void>();
  const emit = () => subs.forEach((f) => f());
  let again = false;
  let cancelTimer: (() => void) | null = null;
  const log = (t: string, level: "info" | "warn" | "error" = "info") => output.append(PROBLEMS_CHANNEL, t, level);

  void port.onCheck((e) => {
    if (e.phase === "start") log(`▶ ${e.command}${e.cwd ? `   (in ${e.cwd})` : ""}`);
    else {
      const r = e.report;
      const head = `${r.error ? "✖" : "✓"} ${r.source}: ${r.count} problem${r.count === 1 ? "" : "s"} · exit ${r.exitCode ?? "—"} · ${duration(r.millis)}`;
      log(head, r.error ? "error" : "info");
      if (r.error) log(r.error.split("\n").map((l) => "    " + l).join("\n"), "error");
    }
  });
  void port.onLsp((p) => {
    const root = workspace.root();
    if (!root) return;
    const items = p.diagnostics.map((d) => fromLsp(p.uri, d, root)).filter((x): x is Problem => !!x);
    const file = fromLsp(p.uri, {}, root)?.file;
    if (!file) return;
    if (items.length) live.set(file, items);
    else live.delete(file);
    emit();
  });

  async function scan(): Promise<void> {
    const root = workspace.root();
    if (!root) return;
    if (st.running) {
      again = true;
      return;
    }
    st.running = true;
    st.error = null;
    emit();
    const t0 = clock.now();
    log(`── scan ${new Date(t0).toLocaleTimeString()} · ${root}`);
    try {
      const r = await port.scan(root);
      if (workspace.root() === root) {
        st.scan = r;
        st.root = root;
        for (const s of r.skipped) log(`… ${s}`, "warn");
        if (!r.checks.length && !r.skipped.length) log("No checker applies to this folder (no Cargo.toml, tsconfig.json, go.mod, Python project or ESLint config).");
        log(`── ${r.problems.length} problem(s) in ${duration(clock.now() - t0)}`);
      }
    } catch (e) {
      st.error = String(e);
      log(`✖ ${st.error}`, "error");
    } finally {
      st.running = false;
      st.finishedAt = clock.now();
      emit();
    }
    if (again) {
      again = false;
      void scan();
    }
  }

  return {
    state: () => st,
    all: () => (st.scan && st.root === workspace.root() ? mergeLive(st.scan.problems, live) : []),
    request(reason, immediate = false) {
      if (!workspace.root()) return;
      cancelTimer?.();
      if (immediate) {
        cancelTimer = null;
        log(`(${reason})`);
        void scan();
        return;
      }
      cancelTimer = clock.after(DEBOUNCE, () => {
        cancelTimer = null;
        log(`(${reason})`);
        void scan();
      });
    },
    reset() {
      cancelTimer?.();
      st.scan = null;
      st.root = null;
      st.error = null;
      live.clear();
      emit();
    },
    subscribe(f) {
      subs.add(f);
      return () => subs.delete(f);
    },
  };
}
