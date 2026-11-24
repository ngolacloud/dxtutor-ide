import { describe, expect, it, vi } from "vitest";
import { bpKind, inlineValues, isPlain, sessionMarkdown, specsFor, type BpMeta, type VarNode } from "../src/features/debug/domain/dap";
import { makeDebugEngine } from "../src/features/debug/application/debug-engine";
import type { DebugPort } from "../src/features/debug/application/ports";
import type { Session, Stop } from "../src/features/debug/domain/session";
import { bpLabel, bpMenu, dapStopped } from "../src/features/debug/ui/dap-view";

/* A7 (docs/v2/UI-AUDIT.md item 4): depuração sobre DAP — breakpoints com condição, contagem e
 * logpoint (enviados por ficheiro, guardados por projecto), variáveis em árvore com o que mudou,
 * threads, frames, watch, step out, pause, valores inline, o snapshot com a issue e o Co-Dev com os
 * frames reais. O caminho gdb fica como estava. */

const v = (name: string, value: string, o: Partial<VarNode> = {}): VarNode => ({ name, value, type: "int", reference: 0, changed: false, path: name, ...o });

describe("domínio", () => {
  it("os specs de um ficheiro levam só os breakpoints activos, com a sua meta", () => {
    const meta: Record<number, BpMeta> = { 9: { condition: " i == 3 ", enabled: true }, 12: { enabled: false }, 20: { logMessage: "x={x}", hitCondition: "2", enabled: true } };
    expect(specsFor([20, 3, 9, 12, 3], (l) => meta[l])).toEqual([{ line: 3 }, { line: 9, condition: "i == 3" }, { line: 20, hitCondition: "2", logMessage: "x={x}" }]);
    expect(bpKind(meta[20])).toBe("log");
    expect(bpKind(meta[9])).toBe("condition");
    expect(isPlain({ enabled: true })).toBe(true);
    expect(isPlain({ enabled: false })).toBe(false);
  });

  it("os valores inline: as variáveis que cada linha acima da paragem menciona", () => {
    const lines = ["fn main() {", "    let total = 0; // total here", '    let s = "total";', "    for i in 0..5 {", "        total += add(total, i);", "    }", "}"];
    const iv = inlineValues(lines, 5, [{ name: "total", value: "6" }, { name: "i", value: "3" }, { name: "self.x", value: "1" }]);
    expect(iv).toEqual({ 2: "total = 6", 4: "i = 3", 5: "total = 6, i = 3" });
    expect(inlineValues(lines, 0, [{ name: "i", value: "1" }])).toEqual({});
  });

  it("a sessão em markdown: onde, pilha, variáveis (o que mudou), watch e a saída", () => {
    const md = sessionMarkdown({
      program: "/p/target/debug/app",
      stop: { stopped: true, reason: "breakpoint", func: "main", file: "/p/src/main.rs", line: 5, exited: false, exitCode: null },
      stack: [{ level: 0, func: "main", file: "/p/src/main.rs", line: 5 }],
      vars: [v("total", "6", { changed: true }), v("i", "3")],
      watches: [{ expr: "total * 2", value: "12" }],
      output: ["adding 0+0\n", "adding 0+1\n"],
    });
    expect(md).toContain("in `main` at `src/main.rs:5`");
    expect(md).toContain("`total` (int) = `6` ← changed");
    expect(md).toContain("`total * 2` = `12`");
    expect(md).toContain("adding 0+1");
  });
});

function harness(engineKind: "dap" | "gdb" = "dap") {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (n: string) => (...a: unknown[]) => { calls.push([n, a]); };
  let session: Session | null = null;
  const BPS = new Set<string>(["/R/src/main.rs:5", "/R/src/main.rs:9"]);
  const meta = new Map<string, BpMeta>([["/R/src/main.rs:9", { condition: "i == 3", enabled: true }]]);
  const stops: Stop[] = [
    { stopped: true, reason: "breakpoint", func: "main", file: "/root/src/main.rs", line: 9, exited: false, exitCode: null, thread: 1 },
    { stopped: true, reason: "step", func: "main", file: "/root/src/main.rs", line: 10, exited: false, exitCode: null, thread: 1 },
    { stopped: false, reason: "exited", func: "", file: "", line: 0, exited: true, exitCode: 0 },
  ];
  let out: ((id: string, c: string, t: string) => void) | null = null;
  let changed = false;
  const dbg: DebugPort = {
    available: async () => true,
    launch: async (...a) => { rec("launch")(...a); return { engine: engineKind, adapter: engineKind === "dap" ? "lldb-dap" : "gdb" }; },
    breakAt: async (...a) => { rec("breakAt")(...a); return 1; },
    run: async (id) => { rec("run")(id); out?.(id, "stdout", "adding 0+0\n"); return stops.shift()!; },
    cont: async (id) => { rec("cont")(id); return stops.shift()!; },
    step: async (...a) => { rec("step")(...a); changed = true; return stops.shift()!; },
    locals: async () => [{ name: "i", value: "3" }, { name: "total", value: changed ? "6" : "3" }],
    stack: async (...a) => { rec("stack")(...a); return [{ level: 0, func: "main", file: "/root/src/main.rs", line: 9 }, { level: 1, func: "start", file: "", line: 0 }]; },
    stop: async (...a) => { rec("stop")(...a); },
    setBreakpoints: async (...a) => { rec("setBreakpoints")(...a); return []; },
    stopOnPanic: async (...a) => { rec("stopOnPanic")(...a); return true; },
    threads: async () => [{ id: 1, name: "main", current: true }, { id: 2, name: "worker", current: false }],
    /* the adapter renumbers references at every stop (+100 after the step) */
    variables: async (_id, frame, ref) => {
      rec("variables")(frame, ref);
      const o = changed ? 100 : 0;
      if (ref === undefined) return [v("Locals", "", { reference: 10 + o, type: "", path: "main.Locals" })];
      if (ref === 10 + o) return [v("i", "3", { path: "main.Locals.i" }), v("total", changed ? "6" : "3", { changed, path: "main.Locals.total" }), v("p", "{...}", { reference: 11 + o, type: "P", path: "main.Locals.p" })];
      return [v("x", "1", { path: "main.Locals.p.x" }), v("y", "2", { path: "main.Locals.p.y" })];
    },
    evaluate: async (_id, expr) => v(expr, changed ? "12" : "6"),
    pause: async (...a) => { rec("pause")(...a); },
    onOutput: (f) => { out = f; },
  };
  const project = {
    load: vi.fn(async () => [{ file: "src/lib.rs", line: 4, logMessage: "n={n}", enabled: true }, { file: "src/lib.rs", line: 7, enabled: false }]),
    save: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => undefined),
    issues: vi.fn(async () => [{ key: "DXT-4", title: "lexer crash" }]),
  };
  const asked: Array<{ intent: string; context: Array<{ text: string }> }> = [];
  const toasts: string[] = [];
  const picks: Array<string | null> = [];
  const engine = makeDebugEngine({
    store: { session: () => session, setSession: (s) => { session = s; }, breakpoints: () => BPS, hydrate: () => undefined, save: rec("save"), setMessage: rec("message") },
    dbg,
    workspace: { root: () => "/root", fsRoot: () => "/R/", content: (k) => (k === "/R/Cargo.toml" ? '[package]\nname = "app"\n' : k === "/R/src/main.rs" ? "fn main(){}\n" : null), keys: () => ["/R/Cargo.toml", "/R/src/main.rs"], exec: async () => ({ ok: true, out: "" }) },
    editor: { currentTab: () => null, openPath: rec("openPath"), paintEd: rec("paintEd") },
    shell: { goPane: () => undefined, setPanelTab: () => undefined },
    picker: { choose: async () => picks.shift() ?? null, ask: async () => null },
    view: { refresh: () => undefined },
    notifier: { toast: (m) => toasts.push(m) },
    newId: () => "S1",
    project,
    codev: { available: () => true, ask: (r) => asked.push(r) },
    bpMeta: meta,
    say: (k) => k,
  });
  return { engine, calls, session: () => session, BPS, meta, project, asked, toasts, picks };
}

describe("o motor com DAP", () => {
  it("lança, envia os breakpoints de cada ficheiro com a meta, pára e carrega threads, variáveis e watch", async () => {
    const h = harness();
    await h.engine.addWatch("total * 2");
    await h.engine.startDebug();
    expect(h.calls.find(([n]) => n === "setBreakpoints")?.[1]).toEqual(["S1", "src/main.rs", [{ line: 5 }, { line: 9, condition: "i == 3" }]]);
    expect(h.calls.some(([n]) => n === "breakAt")).toBe(false);
    const s = h.session()!;
    expect(s.engine).toBe("dap");
    expect(s.adapter).toBe("lldb-dap");
    expect(s.threads).toHaveLength(2);
    expect(s.children?.[10]?.map((x) => x.name)).toEqual(["i", "total", "p"]);
    expect(h.engine.extra().watches[0].value).toBe("6");
    expect(h.engine.extra().output.join("")).toContain("adding 0+0");
  });

  it("expande uma variável, um passo marca o que mudou, step out e pause vão ao adaptador", async () => {
    const h = harness();
    await h.engine.addWatch("total * 2");
    await h.engine.startDebug();
    await h.engine.toggleVar(11);
    expect(h.session()!.children?.[11]?.map((x) => x.name)).toEqual(["x", "y"]);
    await h.engine.dbgStep();
    const total = h.session()!.children?.[110]?.find((x) => x.name === "total");
    expect(total).toMatchObject({ value: "6", changed: true });
    expect(h.engine.extra().watches[0]).toMatchObject({ value: "12", changed: true });
    // p stays open across the stop, under its new reference
    expect(h.session()!.children?.[111]?.map((x) => x.name)).toEqual(["x", "y"]);
    expect(h.engine.extra().expanded.has(111)).toBe(true);
    await h.engine.dbgStepOut();
    expect(h.calls.filter(([n]) => n === "step").at(-1)?.[1]).toEqual(["S1", false, "out"]);
  });

  it("editar um breakpoint numa sessão viva reenvia o ficheiro e guarda-o no projecto", async () => {
    const h = harness();
    await h.engine.startDebug();
    await h.engine.editBreakpoint("/R/src/main.rs:5", { logMessage: "i={i}", enabled: true });
    expect(h.calls.filter(([n]) => n === "setBreakpoints").at(-1)?.[1]).toEqual(["S1", "src/main.rs", [{ line: 5, logMessage: "i={i}" }, { line: 9, condition: "i == 3" }]]);
    expect(h.project.save).toHaveBeenLastCalledWith("/root", "src/main.rs", [
      { file: "src/main.rs", line: 5, condition: undefined, hitCondition: undefined, logMessage: "i={i}", enabled: true },
      { file: "src/main.rs", line: 9, condition: "i == 3", hitCondition: undefined, logMessage: undefined, enabled: true },
    ]);
    await h.engine.editBreakpoint("/R/src/main.rs:9", { condition: "i == 3", enabled: false });
    expect(h.BPS.has("/R/src/main.rs:9")).toBe(false);
    expect(h.calls.filter(([n]) => n === "setBreakpoints").at(-1)?.[1]).toEqual(["S1", "src/main.rs", [{ line: 5, logMessage: "i={i}" }]]);
    await h.engine.removeBreakpoint("/R/src/main.rs:9");
    expect(h.meta.has("/R/src/main.rs:9")).toBe(false);
  });

  it("os breakpoints guardados voltam ao gutter (os desactivados só na meta)", async () => {
    const h = harness();
    await h.engine.loadKept();
    expect(h.BPS.has("/R/src/lib.rs:4")).toBe(true);
    expect(h.BPS.has("/R/src/lib.rs:7")).toBe(false);
    expect(h.meta.get("/R/src/lib.rs:4")?.logMessage).toBe("n={n}");
    expect(h.meta.get("/R/src/lib.rs:7")?.enabled).toBe(false);
  });

  it("o Co-Dev recebe os frames reais; o snapshot vai para a issue escolhida", async () => {
    const h = harness();
    await h.engine.startDebug();
    h.engine.askCodev("explain");
    h.engine.askCodev("test");
    expect(h.asked.map((a) => a.intent)).toEqual(["explain", "change"]);
    expect(h.asked[0].context[0].text).toContain("in `main`");
    h.picks.push("DXT-4 — lexer crash");
    await h.engine.snapshot();
    expect(h.project.snapshot).toHaveBeenCalledWith("/root", "S1", "DXT-4", "Debug: main at main.rs:9", expect.stringContaining("**Call stack:**"));
  });

  it("parar em panic é enviado numa sessão viva", async () => {
    const h = harness();
    await h.engine.startDebug();
    await h.engine.setStopOnPanic(true);
    expect(h.calls.filter(([n]) => n === "stopOnPanic").at(-1)?.[1]).toEqual(["S1", true]);
  });
});

describe("o caminho gdb fica como estava", () => {
  it("sem adaptador DAP, os breakpoints vão um a um e não há variáveis em árvore", async () => {
    const h = harness("gdb");
    await h.engine.startDebug();
    expect(h.calls.filter(([n]) => n === "breakAt").map(([, a]) => a.slice(1))).toEqual([["src/main.rs", 5], ["src/main.rs", 9]]);
    expect(h.calls.some(([n]) => n === "setBreakpoints" || n === "variables")).toBe(false);
    expect(h.session()!.engine).toBe("gdb");
    await h.engine.dbgStepOut();
    expect(h.toasts.at(-1)).toBe("needsDap");
  });
});

describe("a vista DAP", () => {
  it("a árvore de variáveis marca o que mudou; o menu do gutter e as etiquetas dos breakpoints", () => {
    const t = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
    const s: Session = {
      id: "S1", program: "app", status: "stopped", stop: { stopped: true, reason: "breakpoint", func: "main", file: "/r/m.rs", line: 3, exited: false, exitCode: null }, locals: [], stack: [{ level: 0, func: "main", file: "/r/m.rs", line: 3 }],
      engine: "dap", frame: 0, scopes: [v("Locals", "", { reference: 10 })], children: { 10: [v("total", "6", { changed: true }), v("p", "{..}", { reference: 11 })] },
    };
    const host = document.createElement("div");
    host.innerHTML = dapStopped(t as never, s, { watches: [{ expr: "a+b", error: "no a" }], output: ["hi\n"], stopOnPanic: false, expanded: new Set([10]) }, true, true);
    expect(host.querySelector(".dv.chg .k")?.textContent).toBe("total");
    expect(host.querySelector('[data-action="var-toggle"][data-on="11"]')).not.toBeNull();
    expect(host.querySelector(".dbg-out")?.textContent).toBe("hi\n");
    expect(host.querySelector('[data-action="snapshot"]')).not.toBeNull();
    const menu = document.createElement("div");
    menu.innerHTML = bpMenu(t as never, "/r/m.rs:3", true, { condition: "x", enabled: false });
    expect([...menu.querySelectorAll(".mi")].map((m) => m.getAttribute("data-on")?.split("|")[0])).toEqual(["condition", "hit", "log", "enable", "remove"]);
    expect(bpLabel(t as never, { condition: "i == 3", enabled: true })).toContain("when:i == 3");
  });
});
