/* ═══════════ feature `hood` — application: the real «under the hood» and the execution trace (A8) ═══════════
   State and use cases over the backend (ports.ts):
   - «Under the hood (real)» for the file on screen: the machine code each line becomes (Rust, debug
     or release) or its bytecode (Python), the compiler's stages (LLVM IR, assembly, MIR, disassembly),
     a measured run (time, CPU, peak memory, the memory curve) and the measured growth with N.
   - «Execution trace»: the real execution step by step (Python via settrace, Rust by instrumentation),
     with the line, the stack, the locals that changed and the output so far.
   - Co-Dev with what the view shows as context.
   No DOM, no window. A newer request for a view wins over an older answer still on its way. */

import { isProgram, langOf, parseSizes } from "../domain/rules";
import type { Bytecode, Growth, Lang, LineAsm, Measured, Pipeline, Trace } from "../domain/types";
import type { CodevPort, HoodPort, NotifierPort, SourcePort, TabsPort } from "./ports";

export type Say = (key: string, params?: Record<string, string | number>) => string;
export type Stage = "machine" | "llvm" | "asm" | "mir" | "disasm";

export interface HoodState {
  path: string;
  lang: Lang;
  text: string;
  release: boolean;
  selected: number | null;
  stage: Stage;
  lineAsm: LineAsm | null;
  bytecode: Bytecode | null;
  pipeline: Pipeline | null;
  measured: Measured | null;
  growth: Growth | null;
  sizes: string;
  busy: { code: boolean; pipeline: boolean; measured: boolean; growth: boolean };
  error: string;
}

export interface TraceState {
  path: string;
  lang: Lang;
  text: string;
  trace: Trace | null;
  i: number;
  loading: boolean;
  playing: boolean;
  error: string;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function makeHood(deps: { hood: HoodPort; source: SourcePort; codev: CodevPort; tabs: TabsPort; notifier: NotifierPort; say: Say; timer?: { every(ms: number, f: () => void): () => void } }) {
  const { hood, source, codev, tabs, notifier, say } = deps;
  const timer = deps.timer ?? { every: (ms: number, f: () => void) => { const t = setInterval(f, ms); return () => clearInterval(t); } };
  let H: HoodState | null = null;
  let T: TraceState | null = null;
  let stopPlay: (() => void) | null = null;
  const subs = new Set<() => void>();
  const emit = (): void => { subs.forEach((f) => f()); };

  /** The file on screen, if it is a Rust program or a Python file. */
  function pick(): { path: string; text: string; lang: Lang } | null {
    const c = source.current();
    const lang = c ? langOf(c.path) : null;
    if (!c || !lang) { notifier.toast(say("needFile")); return null; }
    if (!isProgram(lang, c.text)) { notifier.toast(say("needMain")); return null; }
    return { ...c, lang };
  }

  async function loadCode(h: HoodState): Promise<void> {
    h.busy.code = true; emit();
    try {
      if (h.lang === "rust") { const r = await hood.lineAsm(h.text, h.release); if (H === h) h.lineAsm = r; }
      else { const r = await hood.bytecode(h.text); if (H === h) h.bytecode = r; }
    } catch (e) { if (H === h) h.error = msg(e); }
    if (H === h) { h.busy.code = false; emit(); }
  }

  async function openHood(): Promise<void> {
    const c = pick();
    if (!c) return;
    const h: HoodState = { ...c, release: false, selected: null, stage: "machine", lineAsm: null, bytecode: null, pipeline: null, measured: null, growth: null, sizes: "1000, 2000, 4000, 8000, 16000", busy: { code: false, pipeline: false, measured: false, growth: false }, error: "" };
    H = h;
    tabs.open("hood-real", say("hoodTab", { f: c.path.split("/").pop() ?? c.path }), "hood-real");
    emit();
    await loadCode(h);
  }

  async function setRelease(release: boolean): Promise<void> {
    if (!H || H.lang !== "rust" || H.release === release) return;
    H.release = release; H.lineAsm = null;
    await loadCode(H);
  }

  async function setStage(stage: Stage): Promise<void> {
    const h = H;
    if (!h) return;
    h.stage = stage; emit();
    if (stage !== "machine" && h.lang === "rust" && !h.pipeline && !h.busy.pipeline) {
      h.busy.pipeline = true; emit();
      try { const p = await hood.pipeline(h.text); if (H === h) h.pipeline = p; } catch (e) { if (H === h) h.error = msg(e); }
      if (H === h) { h.busy.pipeline = false; emit(); }
    }
  }

  async function runMeasured(): Promise<void> {
    const h = H;
    if (!h || h.lang !== "rust" || h.busy.measured) return;
    h.busy.measured = true; emit();
    try { const r = await hood.measured(h.text); if (H === h) h.measured = r; } catch (e) { if (H === h) h.error = msg(e); }
    if (H === h) { h.busy.measured = false; emit(); }
  }

  async function measureGrowth(sizesText?: string): Promise<void> {
    const h = H;
    if (!h || h.lang !== "rust" || h.busy.growth) return;
    if (sizesText !== undefined) h.sizes = sizesText;
    const sizes = parseSizes(h.sizes);
    if (sizes.length < 4) { notifier.toast(say("needSizes")); return; }
    h.busy.growth = true; emit();
    try { const g = await hood.growth(h.text, sizes); if (H === h) h.growth = g; } catch (e) { if (H === h) h.error = msg(e); }
    if (H === h) { h.busy.growth = false; emit(); }
  }

  /* ── the execution trace ── */
  async function openTrace(): Promise<void> {
    const c = pick();
    if (!c) return;
    stopPlay?.(); stopPlay = null;
    const t: TraceState = { ...c, trace: null, i: 0, loading: true, playing: false, error: "" };
    T = t;
    tabs.open("exec-trace", say("traceTab", { f: c.path.split("/").pop() ?? c.path }), "exec-trace");
    emit();
    try { const r = await hood.trace(c.lang, c.text); if (T === t) t.trace = r; } catch (e) { if (T === t) t.error = msg(e); }
    if (T === t) { t.loading = false; emit(); }
  }
  function goStep(i: number): void {
    const t = T;
    if (!t || !t.trace || !t.trace.steps.length) return;
    t.i = Math.max(0, Math.min(t.trace.steps.length - 1, i));
    emit();
  }
  function togglePlay(): void {
    const t = T;
    if (!t || !t.trace) return;
    if (t.playing) { stopPlay?.(); stopPlay = null; t.playing = false; emit(); return; }
    if (t.i >= t.trace.steps.length - 1) t.i = 0;
    t.playing = true;
    stopPlay = timer.every(350, () => {
      if (!T || !T.trace || T.i >= T.trace.steps.length - 1) { stopPlay?.(); stopPlay = null; if (T) T.playing = false; emit(); return; }
      T.i++; emit();
    });
    emit();
  }

  /* ── Co-Dev with what the view shows ── */
  function askLine(): void {
    const h = H;
    if (!h || h.selected === null || !codev.available()) return;
    const src = h.text.split("\n")[h.selected - 1] ?? "";
    const code = h.lang === "rust"
      ? (h.lineAsm?.lines.find((l) => l.line === h.selected)?.instructions ?? []).join("\n")
      : (h.bytecode?.lines.filter((l) => l.line === h.selected).map((l) => `# ${l.scope}\n${l.ops.join("\n")}`) ?? []).join("\n");
    const what = h.lang === "rust" ? `${h.release ? "release" : "debug"} x86-64` : `CPython ${h.bytecode?.version ?? ""} bytecode`;
    codev.ask({ intent: "explain", text: say("askLineText"), context: [{ kind: "selection", label: `${h.path.split("/").pop()}:${h.selected}`, text: `${src.trim()}\n\n${what}:\n${code || "(no code for this line)"}`, path: h.path }], send: true });
  }
  function askGrowth(): void {
    const h = H;
    if (!h || !h.growth || !codev.available()) return;
    const g = h.growth;
    const rows = g.samples.map((s) => `n=${s.n}: ${s.ms.toFixed(2)} ms`).join("\n");
    codev.ask({ intent: "explain", text: say("askGrowthText", { o: g.bigO ?? "?" }), context: [{ kind: "file", label: h.path.split("/").pop() ?? h.path, text: `${h.text.slice(0, 8000)}\n\n---\nmeasured (baseline ${g.baselineMs.toFixed(2)} ms taken off):\n${rows}\nfit: ${g.bigO} (R² ${g.rSquared?.toFixed(3)}, ${g.confidence})`, path: h.path }], send: true });
  }
  function askStep(): void {
    const t = T;
    const st = t?.trace?.steps[t.i];
    if (!t || !st || !codev.available()) return;
    const src = t.text.split("\n")[st.line - 1] ?? "";
    codev.ask({ intent: "explain", text: say("askStepText"), context: [{ kind: "selection", label: `${t.path.split("/").pop()}:${st.line} · step ${t.i + 1}`, text: `${src.trim()}\n\nevent: ${st.event} in ${st.func} (depth ${st.depth})\nlocals:\n${st.locals.map((v) => `  ${v.name}: ${v.ty} = ${v.value}`).join("\n") || "  (none)"}`, path: t.path }], send: true });
  }

  return {
    hood: (): HoodState | null => H,
    trace: (): TraceState | null => T,
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
    openHood, setRelease, setStage, runMeasured, measureGrowth,
    selectLine: (n: number) => { if (H) { H.selected = H.selected === n ? null : n; emit(); } },
    setSizes: (s: string) => { if (H) H.sizes = s; },
    openTrace, goStep, togglePlay,
    askLine, askGrowth, askStep,
    openSource: (line: number) => { const p = H?.path ?? T?.path; if (p) source.open(p, line); },
  };
}

export type Hood = ReturnType<typeof makeHood>;
