import { describe, expect, it } from "vitest";
import { addMark, before, expressionOf, pct, stepOf, writeMarks, type Position } from "../src/features/debug/domain/replay";
import { timeTravelWhy, toolbarFor, type HostCaps } from "../src/features/debug/domain/caps";
import type { SessionCaps, VarNode } from "../src/features/debug/domain/dap";
import { makeDebugEngine } from "../src/features/debug/application/debug-engine";
import type { DebugPort } from "../src/features/debug/application/ports";
import type { Session, Stop } from "../src/features/debug/domain/session";
import { exceptionCardHtml, timelineBlock, toolbarHtml } from "../src/features/debug/ui/dbgx-view";
import { tauriDebug } from "../src/features/debug/infrastructure/tauri";

/* r23 F2b (docs/v2/AUDIT-r23.md §4.2): gravar e reproduzir com o rr — a sessão de reprodução (rr + gdb em
 * modo DAP) anda para trás, sabe onde está na gravação (evento n/N), viaja para as marcas da timeline,
 * volta à última escrita de uma variável e encontra todas as mudanças de uma expressão. Sem rr, ou num
 * CPU que o rr não sabe contar, diz porquê. */

const RRCAPS: SessionCaps = { stepBack: true, dataBreakpoints: false, readMemory: true, restartFrame: false, exceptionFilters: [] };
const HOST: HostCaps = { available: true, adapter: "lldb-dap", engine: "lldb", note: "", timeTravel: { available: true, reason: "ok", perfEventParanoid: 1 } };
const P: Position = { event: 220, ticks: 600, startEvent: 20, startTicks: 100, endEvent: 420, endTicks: 1100 };
const v = (name: string, value: string, o: Partial<VarNode> = {}): VarNode => ({ name, value, type: "i32", reference: 0, changed: false, path: name, ...o });

describe("domínio", () => {
  it("a timeline: posição na barra, marcas (uma por ponto; o panic ganha), o passo e a expressão de uma variável", () => {
    /* the bar is by event (global); ticks are per thread */
    expect([pct(P, 20), pct(P, 220), pct(P, 420), pct(P, 5000)]).toEqual([0, 50, 100, 100]);
    expect(stepOf(P)).toEqual({ n: 220, total: 420 });
    let m = addMark([], { event: 300, ticks: 600, kind: "stop", file: "a.rs", line: 3, label: "x" });
    m = addMark(m, { event: 300, ticks: 200, kind: "stop", file: "a.rs", line: 1, label: "y" });
    m = addMark(m, { event: 120, ticks: 90000, kind: "stop", file: "a.rs", line: 1, label: "other thread" });
    m = addMark(m, { event: 300, ticks: 600, kind: "panic", file: "a.rs", line: 3, label: "p" });
    m = addMark(m, { event: 300, ticks: 600, kind: "stop", file: "a.rs", line: 3, label: "again" });
    expect(m.map((x) => `${x.event}/${x.ticks}:${x.kind}`)).toEqual(["120/90000:stop", "300/200:stop", "300/600:panic"]);
    expect(before({ event: 120, ticks: 90000 }, { event: 300, ticks: 200 })).toBe(true);
    expect(writeMarks("total", [{ event: 50, ticks: 300, location: "*(int *) 0x7f", func: "main", file: "/w/t.c", line: 5, values: "total = 1" }])).toEqual([{ event: 50, ticks: 300, kind: "write", file: "/w/t.c", line: 5, label: "total = 1", watch: "*(int *) 0x7f" }]);
    expect(expressionOf("main.Locals.c.map", "main.Locals")).toBe("c.map");
    expect(expressionOf("main.Statics.x", "main.Locals")).toBeNull();
    expect(timeTravelWhy({ ...HOST, timeTravel: { available: false, reason: "rr-cannot-record", perfEventParanoid: 1, error: "Intel CPU type 0xa06a0 unknown" } })).toEqual({ why: "tt-rr-cannot-record", params: { e: "Intel CPU type 0xa06a0 unknown" } });
  });

  it("numa reprodução a barra mostra andar para trás", () => {
    const tb = toolbarFor({ status: "stopped", engine: "dap", caps: RRCAPS }, HOST);
    expect(tb.buttons.map((b) => b.key)).toEqual(["rcont", "back", "cont", "over", "into", "out", "cursor", "restart", "stop"]);
    expect(tb.missing.map((m) => m.key)).toEqual(["rframe"]);
  });
});

function harness(host: HostCaps = HOST) {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (n: string) => (...a: unknown[]) => { calls.push([n, a]); };
  let session: Session | null = null;
  const BPS = new Set<string>(["/R/src/lru.rs:44"]);
  let ticks = 500;
  const at = (line: number, reason = "breakpoint", func = "evicts"): Stop => ({ stopped: true, reason, func, file: "/root/src/lru.rs", line, exited: false, exitCode: null, thread: 2 });
  let out: ((id: string, c: string, t: string) => void) | null = null;
  const dbg: DebugPort = {
    available: async () => true,
    capabilities: async () => host,
    launch: async (...a) => { rec("launch")(...a); return { engine: "dap", adapter: "lldb-dap", caps: { ...RRCAPS, stepBack: false } }; },
    breakAt: async () => 1,
    run: async (id) => { rec("run")(id); return at(44); },
    cont: async (id) => { rec("cont")(id); ticks += 100; return at(46); },
    step: async (...a) => { rec("step")(...a); ticks += 10; return at(45, "step"); },
    locals: async () => [],
    stack: async () => [{ level: 0, func: "evicts", file: "/root/src/lru.rs", line: 44 }],
    stop: async (...a) => { rec("stop")(...a); },
    setBreakpoints: async () => [],
    stopOnPanic: async (...a) => { rec("stopOnPanic")(...a); return true; },
    threads: async () => [],
    variables: async (_id, _f, ref) => (ref === undefined ? [v("Locals", "", { reference: 10, path: "evicts.Locals" })] : [v("c", "Lru", { reference: 11, path: "evicts.Locals.c" })]),
    evaluate: async (_id, e) => v(e, "1"),
    testTargets: async () => [{ target: "store", kind: "lib", executable: "/root/target/debug/deps/store-1", cwd: "/root", tests: ["tests::evicts"] }],
    record: async (...a) => { rec("record")(...a); return { trace: "/tmp/dxtutor-rr/S1", program: String(a[1]), exitCode: 101, output: "" }; },
    replay: async (...a) => { rec("replay")(...a); return { engine: "dap", adapter: "rr · gdb", caps: RRCAPS }; },
    reverse: async (...a) => { rec("reverse")(...a); ticks -= 50; return at(43, "step"); },
    position: async () => ({ ...P, ticks, event: Math.round(ticks / 5) }),
    travel: async (...a) => { rec("travel")(...a); ticks = Number(a[2]); return at(Number(a[4]) || 1); },
    lastWrite: async (...a) => { rec("lastWrite")(...a); if (a[2] === "nope") throw new Error("No symbol \"nope\" in current context."); ticks = 300; return { ...at(33), description: "c.map = {\"a\": 1}" }; },
    writes: async (...a) => { rec("writes")(...a); if (a[2] === "nope") throw new Error("No symbol \"nope\" in current context."); return [{ event: 50, ticks: 250, location: "*(0x10 as *mut usize)", func: "evicts", file: "/root/src/lru.rs", line: 33, values: "c.order = [\"a\"]" }, { event: 64, ticks: 320, location: "*(0x10 as *mut usize)", func: "evicts", file: "/root/src/lru.rs", line: 33, values: "c.order = [\"a\", \"b\"]" }]; },
    onOutput: (f) => { out = f; },
  };
  const toasts: string[] = [];
  const picks: Array<string | null> = [];
  const engine = makeDebugEngine({
    store: { session: () => session, setSession: (s) => { session = s; }, breakpoints: () => BPS, hydrate: () => undefined, save: () => undefined, setMessage: rec("message") },
    dbg,
    workspace: { root: () => "/root", fsRoot: () => "/R/", content: (k) => (k.startsWith("/R/src/") ? "x\n" : k === "/R/Cargo.toml" ? '[package]\nname = "app"\n' : null), keys: () => ["/R/Cargo.toml"], exec: async () => ({ ok: true, out: "" }) },
    editor: { currentTab: () => null, openPath: rec("openPath"), paintEd: () => undefined },
    shell: { goPane: () => undefined, setPanelTab: () => undefined },
    picker: { choose: async () => picks.shift() ?? null, ask: async () => null },
    view: { refresh: () => undefined },
    notifier: { toast: (m) => toasts.push(m) },
    newId: () => "S1",
    bpMeta: new Map(),
    say: (k, p) => (p ? `${k}:${Object.values(p).join(",")}` : k),
    clock: () => 0,
  });
  void out;
  return { engine, calls, session: () => session, toasts, picks };
}
const named = (calls: Array<[string, unknown[]]>, n: string) => calls.filter((c) => c[0] === n).map((c) => c[1]);

describe("o motor (r23 F2b)", () => {
  it("Record and Replay Test: grava o teste com o rr, reproduz a gravação e pára; a posição e a marca", async () => {
    const h = harness();
    await h.engine.host();
    h.picks.push("tests::evicts");
    await h.engine.recordTest();
    expect(named(h.calls, "record")).toEqual([["S1", "/root/target/debug/deps/store-1", ["--exact", "tests::evicts", "--nocapture"], "/root"]]);
    expect(named(h.calls, "replay")).toEqual([["S1", "/tmp/dxtutor-rr/S1", "/root/target/debug/deps/store-1", "/root"]]);
    expect(named(h.calls, "launch")).toEqual([]);
    expect(named(h.calls, "stopOnPanic")).toEqual([["S1", true]]);
    const s = h.session()!;
    expect(s.replay!.position).toMatchObject({ event: 100, ticks: 500, endEvent: 420 });
    expect(s.replay!.marks).toEqual([{ event: 100, ticks: 500, kind: "stop", file: "/root/src/lru.rs", line: 44, label: "evicts · lru.rs:44" }]);
  });

  it("andar para trás vai ao rr; viajar para uma marca e para o início; Restart é o início", async () => {
    const h = harness();
    await h.engine.host();
    h.picks.push("tests::evicts");
    await h.engine.recordTest();
    await h.engine.stepBack();
    await h.engine.reverseContinue();
    expect(named(h.calls, "reverse")).toEqual([["S1", "next"], ["S1", "continue"]]);
    expect(h.session()!.replay!.marks.map((m) => m.ticks)).toEqual([400, 450, 500]);
    await h.engine.travelTo(2);
    expect(named(h.calls, "travel").at(-1)).toEqual(["S1", 100, 500, "/root/src/lru.rs", 44, undefined]);
    await h.engine.restart();
    expect(named(h.calls, "travel").at(-1)).toEqual(["S1", 20, 100, "", 0]);
    expect(named(h.calls, "stop")).toEqual([]); /* o restart de uma reprodução não a fecha */
  });

  it("de onde veio: a última escrita de uma variável (pelo caminho na árvore) é uma marca «write»; todas as mudanças", async () => {
    const h = harness();
    await h.engine.host();
    h.picks.push("tests::evicts");
    await h.engine.recordTest();
    await h.engine.originOf("evicts.Locals.c", true);
    expect(named(h.calls, "lastWrite")).toEqual([["S1", 0, "c"]]);
    expect(h.session()!.replay!.marks.find((m) => m.ticks === 300)).toMatchObject({ kind: "write", label: "c.map = {\"a\": 1}" });
    await h.engine.changesOf("c.order");
    expect(named(h.calls, "writes")).toEqual([["S1", 0, "c.order", 50]]);
    const r = h.session()!.replay!;
    expect(r.query!.hits).toHaveLength(2);
    expect(r.marks.filter((m) => m.kind === "write").map((m) => m.ticks)).toEqual([250, 320]); /* a consulta substitui as escritas anteriores */
    /* to a write: by its watched location (a watchpoint stops mid-line) */
    await h.engine.travelTo(r.marks.findIndex((m) => m.ticks === 320));
    expect(named(h.calls, "travel").at(-1)).toEqual(["S1", 64, 320, "/root/src/lru.rs", 33, "*(0x10 as *mut usize)"]);
  });

  it("uma consulta que falha (a expressão não existe neste frame) não fecha a reprodução", async () => {
    const h = harness();
    await h.engine.host();
    h.picks.push("tests::evicts");
    await h.engine.recordTest();
    h.calls.length = 0;
    await h.engine.originOf("nope", false);
    await h.engine.changesOf("nope");
    expect(h.session()).not.toBeNull();
    expect(h.session()!.status).toBe("stopped");
  });

  it("sem gravação: andar para trás e as consultas dizem o que falta; «replay this run» grava a sessão ao vivo", async () => {
    const h = harness({ ...HOST, timeTravel: { available: false, reason: "no-rr", perfEventParanoid: 1 } });
    await h.engine.stepBack();
    expect(h.toasts).toEqual(["tt-no-rr"]);
    await h.engine.recordTest();
    expect(h.toasts.at(-1)).toBe("tt-no-rr");
    expect(named(h.calls, "record")).toEqual([]);
    const live = harness();
    await live.engine.host();
    live.picks.push("tests::evicts");
    await live.engine.debugTest();
    await live.engine.originOf("c", false);
    expect(live.toasts).toEqual(["needsReplay"]);
    await live.engine.replayThisRun();
    expect(named(live.calls, "stop")).toHaveLength(1);
    expect(named(live.calls, "record")[0]).toEqual(["S1", "/root/target/debug/deps/store-1", ["--exact", "tests::evicts", "--nocapture"], "/root"]);
    expect(live.session()!.replay).toBeTruthy();
  });
});

describe("a vista (r23 F2b)", () => {
  const tx = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
  it("REPLAY e o evento n/N na barra; a timeline com as marcas, o agora e a consulta", () => {
    const el = document.createElement("div");
    el.innerHTML = toolbarHtml(tx as never, toolbarFor({ status: "stopped", engine: "dap", caps: RRCAPS }, HOST), 3, (m) => m.why, { n: 220, total: 420 });
    expect(el.querySelector(".badge.replay")!.textContent).toBe("tb-replay");
    expect(el.querySelector(".pos")!.textContent).toBe("tb-pos:220,420");
    const tl = document.createElement("div");
    tl.innerHTML = timelineBlock(tx as never, {
      trace: "/t", position: P,
      marks: [{ event: 120, ticks: 350, kind: "write", file: "/w/a.rs", line: 3, label: "x = 1" }, { event: 220, ticks: 600, kind: "panic", file: "/w/a.rs", line: 9, label: "p" }],
      query: { expression: "x", hits: [{ event: 120, ticks: 350, location: "*(int *) 0x7f", func: "f", file: "/w/a.rs", line: 3, values: "x = 1" }] },
    });
    expect([...tl.querySelectorAll(".mk")].map((m) => [m.className, (m as HTMLElement).style.left, m.getAttribute("data-on")])).toEqual([["mk write", "25%", "0"], ["mk panic", "50%", "1"]]);
    expect((tl.querySelector(".now") as HTMLElement).style.left).toBe("50%");
    expect(tl.querySelector('.dv[data-action="dbg-travel"]')!.getAttribute("data-on")).toBe("0");
    expect(tl.querySelector('[data-action="dbg-writes"]')).not.toBeNull();
  });

  it("o cartão do panic: «reproduzir para trás» ao vivo (com rr), «última escrita em…» numa reprodução", () => {
    const p = { thread: "t", file: "src/a.rs", line: 3, column: 1, message: "boom" };
    const card = (rr: { canReplay: boolean; inReplay: boolean }) => { const d = document.createElement("div"); d.innerHTML = exceptionCardHtml(tx as never, p, [], false, rr); return [...d.querySelectorAll(".acts [data-action]")].map((b) => b.getAttribute("data-action")); };
    expect(card({ canReplay: true, inReplay: false })).toEqual(["dbg-replay-run", "dbg-copy-panic"]);
    expect(card({ canReplay: true, inReplay: true })).toEqual(["dbg-origin-ask", "dbg-copy-panic"]);
    expect(card({ canReplay: false, inReplay: false })).toEqual(["dbg-copy-panic"]);
  });
});

describe("o adaptador Tauri (r23 F2b)", () => {
  it("os comandos do rr", async () => {
    const seen: Array<[string, unknown]> = [];
    const port = tauriDebug(async (cmd: string, args?: unknown) => { seen.push([cmd, args]); return null as never; }, () => true);
    await port.record!("S", "/p", ["--exact", "t"], "/w");
    await port.replay!("S", "/tr", "/p", "/w");
    await port.reverse!("S", "out");
    await port.position!("S");
    await port.travel!("S", 7, 10, "a.rs", 3);
    await port.travel!("S", 7, 10, "a.rs", 3, "*(0x1 as *mut i32)");
    await port.lastWrite!("S", 1, "c.map");
    await port.writes!("S", 0, "x");
    expect(seen).toEqual([
      ["debug_record", { id: "S", program: "/p", args: ["--exact", "t"], cwd: "/w" }],
      ["debug_replay", { id: "S", trace: "/tr", program: "/p", cwd: "/w" }],
      ["debug_reverse", { id: "S", kind: "out" }],
      ["debug_position", { id: "S" }],
      ["debug_travel", { id: "S", event: 7, ticks: 10, file: "a.rs", line: 3 }],
      ["debug_travel", { id: "S", event: 7, ticks: 10, file: "a.rs", line: 3, watch: "*(0x1 as *mut i32)" }],
      ["debug_last_write", { id: "S", frame: 1, expression: "c.map" }],
      ["debug_writes", { id: "S", frame: 0, expression: "x" }],
    ]);
  });
});
