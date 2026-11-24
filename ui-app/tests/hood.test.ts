import { describe, expect, it, vi } from "vitest";
import { changedAt, fmtMs, heatByLine, isProgram, langOf, parseSizes, sparkPoints, stackAt, stdoutAt } from "../src/features/hood/domain/rules";
import { makeHood } from "../src/features/hood/application/hood-service";
import type { HoodPort } from "../src/features/hood/application/ports";
import type { TraceStep } from "../src/features/hood/domain/types";
import { renderHood } from "../src/features/hood/ui/hood-view";
import { renderTrace } from "../src/features/hood/ui/trace-view";

/* A8 (docs/v2/UI-AUDIT.md item 7): o «Under the hood» real (código máquina por linha, bytecode Python,
 * estágios do compilador, execução medida, crescimento com N) e o traço de execução real, passo a passo. */

const step = (line: number, func: string, depth: number, locals: Array<[string, string]>, event = "line", stdoutLen = 0): TraceStep =>
  ({ line, event, func, depth, locals: locals.map(([name, value]) => ({ name, value, ty: "int" })), stdoutLen });

describe("domínio", () => {
  it("linguagem, programa completo, calor por linha, tamanhos e formatação", () => {
    expect([langOf("src/a.rs"), langOf("x.py"), langOf("a.ts")]).toEqual(["rust", "python", null]);
    expect(isProgram("rust", "pub fn x() {}")).toBe(false);
    expect(isProgram("rust", "fn main() {}")).toBe(true);
    expect(isProgram("python", "x = 1")).toBe(true);
    const heat = heatByLine([{ line: 2, funcs: [], instructions: ["a", "b", "c", "d"] }, { line: 5, funcs: [], instructions: ["a"] }]);
    expect([heat.get(2), heat.get(5)]).toEqual([1, 0.25]);
    expect(parseSizes("1000, 2k  4000;8000 0 x 2000")).toEqual([1000, 2000, 4000, 8000]);
    expect([fmtMs(0.5), fmtMs(12.34), fmtMs(1500)]).toEqual(["500 µs", "12.3 ms", "1.50 s"]);
    expect(sparkPoints([{ tMs: 0, rssKb: 100 }, { tMs: 10, rssKb: 200 }], 100, 10)).toBe("0.0,5.0 100.0,0.0");
  });

  it("a pilha, o que mudou e a saída num passo do traço", () => {
    const steps = [step(1, "<module>", 0, []), step(5, "<module>", 0, [["n", "3"]]), step(2, "add", 1, [["a", "1"]], "call"), step(3, "add", 1, [["a", "1"], ["s", "4"]]), step(6, "<module>", 0, [["n", "3"], ["r", "4"]], "line", 2)];
    expect(stackAt(steps, 3)).toEqual(["<module>", "add"]);
    expect(stackAt(steps, 4)).toEqual(["<module>"]);
    expect([...changedAt(steps, 3)]).toEqual(["s"]);
    expect([...changedAt(steps, 4)]).toEqual(["r"]);
    expect(stdoutAt("4\nbye", steps, 4)).toBe("4\n");
  });
});

function fakes() {
  const calls: Array<[string, unknown[]]> = [];
  const asked: Array<{ text: string; context: Array<{ text: string }> }> = [];
  const toasts: string[] = [];
  let file: { path: string; text: string } | null = { path: "/R/src/main.rs", text: "fn add(a: u64, b: u64) -> u64 {\n    a ^ b\n}\nfn main() {\n    println!(\"{}\", add(1, 2));\n}\n" };
  const port: HoodPort = {
    lineAsm: async (...a) => { calls.push(["lineAsm", a]); return { ok: true, profile: a[1] ? "release" : "debug", total: a[1] ? 3 : 9, lines: [{ line: 2, funcs: ["main::add"], instructions: a[1] ? ["xor %rsi,%rax"] : ["mov %rdi,%rax", "xor %rsi,%rax", "ret"] }], notes: "" }; },
    pipeline: async (...a) => { calls.push(["pipeline", a]); return { mir: "", llvmIr: "define i64 @add", asm: "add:\n xor", binaryBytes: 4000, disasm: "", notes: "MIR não disponível" }; },
    bytecode: async () => ({ ok: true, version: "3.12.3", lines: [{ line: 2, scope: "add", ops: ["LOAD_FAST a", "BINARY_OP +"] }], notes: "" }),
    measured: async () => ({ run: { ok: true, stdout: "3\n", stderr: "" }, telemetry: { wallMs: 2.5, cpuUserMs: 1, cpuSysMs: 0.5, peakRssKb: 2048, ioReadBlocks: 0, ioWriteBlocks: 0, exitCode: 0, samples: [{ tMs: 0, rssKb: 1000 }, { tMs: 2, rssKb: 2048 }] } }),
    growth: async (_c, sizes) => { calls.push(["growth", [sizes]]); return { ok: true, samples: sizes.map((n) => ({ n, ms: (n * n) / 1e6 })), bigO: "O(n²)", rSquared: 0.99, confidence: "high", ranking: [], baselineMs: 1.2, notes: "" }; },
    trace: async (lang) => ({ supported: true, notes: "", stdout: "3\n", steps: [step(4, "main", 0, [], "call"), step(5, "main", 0, [["x", "3"]], "line", 2)].map((s) => ({ ...s, func: lang === "rust" ? s.func : s.func })) }),
  };
  let tick: (() => void) | null = null;
  const h = makeHood({
    hood: port,
    source: { current: () => file, open: vi.fn() },
    codev: { available: () => true, ask: (r) => asked.push(r) },
    tabs: { open: vi.fn() },
    notifier: { toast: (m) => toasts.push(m) },
    say: (k) => k,
    timer: { every: (_ms, f) => { tick = f; return () => { tick = null; }; } },
  });
  return { h, calls, asked, toasts, setFile: (f: typeof file) => { file = f; }, tick: () => tick?.() };
}

describe("o serviço", () => {
  it("o código máquina por linha, debug e release, e os estágios do compilador", async () => {
    const f = fakes();
    await f.h.openHood();
    expect(f.h.hood()!.lineAsm?.total).toBe(9);
    f.h.selectLine(2);
    await f.h.setRelease(true);
    expect(f.calls.filter(([c]) => c === "lineAsm").map(([, a]) => a[1])).toEqual([false, true]);
    expect(f.h.hood()!.lineAsm?.total).toBe(3);
    await f.h.setStage("llvm");
    expect(f.h.hood()!.pipeline?.llvmIr).toContain("@add");
    await f.h.setStage("asm");
    expect(f.calls.filter(([c]) => c === "pipeline")).toHaveLength(1);
    f.h.askLine();
    expect(f.asked[0].context[0].text).toContain("xor %rsi,%rax");
  });

  it("recusa ficheiros que não são programas; Python dá bytecode", async () => {
    const f = fakes();
    f.setFile({ path: "/R/src/lib.rs", text: "pub fn x() {}" });
    await f.h.openHood();
    expect(f.toasts).toEqual(["needMain"]);
    f.setFile({ path: "/R/a.txt", text: "x" });
    await f.h.openTrace();
    expect(f.toasts.at(-1)).toBe("needFile");
    f.setFile({ path: "/R/a.py", text: "def add(a, b):\n    return a + b\n" });
    await f.h.openHood();
    expect(f.h.hood()!.bytecode?.lines[0].ops).toContain("BINARY_OP +");
    expect(f.calls.some(([c]) => c === "lineAsm")).toBe(false);
  });

  it("a execução medida e o crescimento com N (pelo menos quatro tamanhos)", async () => {
    const f = fakes();
    await f.h.openHood();
    await f.h.runMeasured();
    expect(f.h.hood()!.measured?.telemetry.peakRssKb).toBe(2048);
    await f.h.measureGrowth("1000, 2000");
    expect(f.toasts.at(-1)).toBe("needSizes");
    await f.h.measureGrowth("1k 2k 4k 8k");
    expect(f.calls.find(([c]) => c === "growth")?.[1]).toEqual([[1000, 2000, 4000, 8000]]);
    expect(f.h.hood()!.growth?.bigO).toBe("O(n²)");
    f.h.askGrowth();
    expect(f.asked[0].context[0].text).toContain("fit: O(n²)");
  });

  it("o traço: passos, reproduzir até ao fim, e o Co-Dev com o passo", async () => {
    const f = fakes();
    await f.h.openTrace();
    expect(f.h.trace()!.trace?.steps).toHaveLength(2);
    f.h.togglePlay();
    expect(f.h.trace()!.playing).toBe(true);
    f.tick();
    expect(f.h.trace()!.i).toBe(1);
    f.tick();
    expect(f.h.trace()!.playing).toBe(false);
    f.h.askStep();
    expect(f.asked[0].context[0].text).toContain("x: int = 3");
  });
});

describe("as vistas", () => {
  it("o hood real desenha a fonte com calor, a linha seleccionada e os cartões; o traço desenha o passo", async () => {
    const f = fakes();
    const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
    await f.h.openHood();
    f.h.selectLine(2);
    await f.h.runMeasured();
    await f.h.measureGrowth("1k 2k 4k 8k");
    const host = document.createElement("div");
    host.innerHTML = renderHood(t as never, f.h.hood(), true);
    expect(host.querySelector('.hd-l.sel[data-on="2"]')).not.toBeNull();
    expect(host.querySelector(".hd-l.has")?.getAttribute("style")).toContain("--hd-heat:1.00");
    expect(host.querySelector(".hd-code")?.textContent).toContain("xor %rsi,%rax");
    expect(host.querySelectorAll(".hd-bar")).toHaveLength(4);
    expect(host.querySelector(".hd-spark polyline")).not.toBeNull();
    await f.h.openTrace();
    f.h.goStep(1);
    host.innerHTML = renderTrace(t as never, f.h.trace(), true);
    expect(host.querySelector(".hd-l.sel")?.getAttribute("data-on")).toBe("5");
    expect(host.querySelector(".hd-var.chg")?.textContent).toContain("x");
  });
});
