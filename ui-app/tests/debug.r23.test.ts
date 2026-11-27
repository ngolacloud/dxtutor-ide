import { describe, expect, it } from "vitest";
import { bpActive, bpGroups, isPlain, type BpMeta, type SessionCaps, type VarNode } from "../src/features/debug/domain/dap";
import { timeTravelWhy, toolbarFor, type HostCaps } from "../src/features/debug/domain/caps";
import { firstUserFrame, isUserFrame, perfTip, stackRows } from "../src/features/debug/domain/frames";
import { isPanicStop, panicText, parsePanic } from "../src/features/debug/domain/exception";
import { hexRows, historyStep, remember, testPicks } from "../src/features/debug/domain/console";
import { makeDebugEngine } from "../src/features/debug/application/debug-engine";
import type { DebugPort, DebugSettings } from "../src/features/debug/application/ports";
import type { Session, Stop } from "../src/features/debug/domain/session";
import { consoleBlock, exceptionCardHtml, toolbarHtml } from "../src/features/debug/ui/dbgx-view";
import { dapStopped } from "../src/features/debug/ui/dap-view";
import { tauriDebug } from "../src/features/debug/infrastructure/tauri";

/* r23 F2 (docs/v2/AUDIT-r23.md §4.2): o depurador real — o que o host e o adaptador sabem fazer (a barra
 * só mostra o que funciona e diz porquê o resto), run to cursor, restart, a consola com histórico, «Debug
 * Test…», excepções, data breakpoints, memória, triggered e grupos, Just My Code, PerfTips e o cartão do
 * pânico. Sem rr: andar para trás diz o que falta. */

const CAPS: SessionCaps = { stepBack: false, dataBreakpoints: true, readMemory: true, restartFrame: false, exceptionFilters: [{ filter: "cpp_throw", label: "C++ Throw", default: false }] };
const HOST: HostCaps = { available: true, adapter: "lldb-dap", engine: "lldb", note: "", timeTravel: { available: false, reason: "no-rr", perfEventParanoid: 4 } };
const v = (name: string, value: string, o: Partial<VarNode> = {}): VarNode => ({ name, value, type: "int", reference: 0, changed: false, path: name, ...o });

describe("domínio", () => {
  it("a barra: só o que funciona, e porquê o resto", () => {
    const dap = toolbarFor({ status: "stopped", engine: "dap", caps: CAPS }, HOST);
    expect(dap.buttons.map((b) => b.key)).toEqual(["cont", "over", "into", "out", "cursor", "restart", "stop"]);
    expect(dap.buttons.every((b) => b.enabled)).toBe(true);
    expect(dap.missing).toEqual([{ key: "back", why: "tt-no-rr" }, { key: "rframe", why: "rframe-adapter" }]);
    const running = toolbarFor({ status: "running", engine: "dap", caps: CAPS }, HOST);
    expect(running.buttons.filter((b) => b.enabled).map((b) => b.key)).toEqual(["restart", "stop"]);
    const gdb = toolbarFor({ status: "stopped", engine: "gdb" }, null);
    expect(gdb.buttons.map((b) => b.key)).toEqual(["cont", "over", "into", "restart", "stop"]);
    expect(gdb.missing.map((m) => m.why)).toEqual(["tt-unknown", "needs-dap", "needs-dap", "needs-dap"]);
    const rr = toolbarFor({ status: "stopped", engine: "dap", caps: { ...CAPS, stepBack: true, restartFrame: true } }, HOST);
    expect(rr.buttons.map((b) => b.key)).toEqual(["rcont", "back", "cont", "over", "into", "out", "cursor", "rframe", "restart", "stop"]);
    expect(timeTravelWhy({ ...HOST, timeTravel: { available: false, reason: "perf-paranoid", perfEventParanoid: 4 } })).toEqual({ why: "tt-perf-paranoid", params: { n: 4 } });
    expect(timeTravelWhy({ ...HOST, timeTravel: { available: true, reason: "ok", perfEventParanoid: 1 } }).why).toBe("tt-live");
  });

  it("Just My Code: os frames da pasta; as bibliotecas recolhidas numa linha", () => {
    const files = ["/rustc/abc/library/std/src/panicking.rs", "/home/u/.cargo/registry/x/lib.rs", "/w/src/lru.rs", "/w/src/lru.rs", "", "/w/target/debug/build/x.rs"];
    expect(files.map((f) => isUserFrame(f, "/w"))).toEqual([false, false, true, true, false, false]);
    expect(firstUserFrame(files, "/w/")).toBe(2);
    expect(stackRows(files, "/w", true, new Set())).toEqual([{ kind: "lib", from: 0, count: 2 }, { kind: "frame", index: 2 }, { kind: "frame", index: 3 }, { kind: "lib", from: 4, count: 2 }]);
    expect(stackRows(files, "/w", true, new Set([0])).slice(0, 3)).toEqual([{ kind: "frame", index: 0 }, { kind: "frame", index: 1 }, { kind: "frame", index: 2 }]);
    expect(stackRows(files, "/w", true, new Set(), 1)[1]).toEqual({ kind: "frame", index: 1 });
    expect(stackRows(files, "/w", false, new Set())).toHaveLength(6);
    expect([0.4, 12.4, 1520, 75_000].map(perfTip)).toEqual(["≤ 1 ms", "12 ms", "1.52 s", "1 min 15 s"]);
  });

  it("o pânico lê-se da saída (formato novo e antigo), com left/right", () => {
    const out = "running 1 test\n\nthread 'tests::evicts_least_recently_used' panicked at src/lru.rs:56:9:\nassertion `left == right` failed\n  left: None\n right: Some(1)\nnote: run with `RUST_BACKTRACE=1`\n";
    const p = parsePanic(out)!;
    expect(p).toEqual({ thread: "tests::evicts_least_recently_used", file: "src/lru.rs", line: 56, column: 9, message: "assertion `left == right` failed", left: "None", right: "Some(1)" });
    expect(panicText(p)).toContain("  left: None\n right: Some(1)");
    expect(parsePanic("thread 'main' panicked at 'index out of bounds', src/main.rs:3:5\n")).toMatchObject({ thread: "main", file: "src/main.rs", line: 3, message: "index out of bounds" });
    expect(parsePanic("all good\n")).toBeNull();
    /* what lldb-dap really sends (a pseudo-terminal, newer Rust with the thread id) */
    const real = "running 1 test\r\n\r\nthread 'tests::evicts_least_recently_used' (1025884) panicked at src/lib.rs:46:9:\r\nassertion `left == right` failed\r\n  left: None\r\n right: Some(1)\r\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\r\n";
    expect(parsePanic(real)).toEqual({ thread: "tests::evicts_least_recently_used", file: "src/lib.rs", line: 46, column: 9, message: "assertion `left == right` failed", left: "None", right: "Some(1)" });
    expect(isPanicStop(["rust_panic", "std::panicking::begin_panic_handler"])).toBe(true);
    expect(isPanicStop(["main", "start"])).toBe(false);
  });

  it("consola, memória, testes e breakpoints com trigger/grupo", () => {
    let h = remember([], "a"); h = remember(h, "a"); h = remember(h, " b ");
    expect(h).toEqual(["a", "b"]);
    expect(historyStep(h, 2, -1)).toEqual({ idx: 1, text: "b" });
    expect(historyStep(h, 0, -1)).toEqual({ idx: 0, text: "a" });
    expect(historyStep(h, 1, 1)).toEqual({ idx: 2, text: "" });
    expect(hexRows("0x10", [0x41, 0, 0xff])).toEqual([{ address: "0x000000000010", hex: "41 00 ff", ascii: "A··" }]);
    const bins = [{ target: "store", kind: "lib", executable: "/t/store-1", cwd: "/w", tests: ["a", "b"] }];
    expect(testPicks(bins).map((p) => p.label)).toEqual(["a", "b"]);
    expect(testPicks([...bins, { ...bins[0], target: "api", kind: "test", tests: ["c"] }])[2].label).toBe("c — api (test)");
    const m: BpMeta = { enabled: true, trigger: "/R/a.rs:3", group: "lru" };
    expect(isPlain(m)).toBe(false);
    expect(bpActive(m, new Set(), new Set())).toBe(false);
    expect(bpActive(m, new Set(), new Set(["/R/a.rs:3"]))).toBe(true);
    expect(bpActive(m, new Set(["lru"]), new Set(["/R/a.rs:3"]))).toBe(false);
    expect(bpActive({ enabled: false }, new Set(), new Set())).toBe(false);
    expect(bpGroups([m, { enabled: true, group: " io " }, { enabled: true }])).toEqual(["io", "lru"]);
  });
});

function harness(o: { stops?: Stop[]; caps?: SessionCaps | null; settings?: DebugSettings | null; runOut?: string } = {}) {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (n: string) => (...a: unknown[]) => { calls.push([n, a]); };
  let session: Session | null = null;
  const BPS = new Set<string>(["/R/src/main.rs:5"]);
  const meta = new Map<string, BpMeta>();
  const stops: Stop[] = o.stops ?? [
    { stopped: true, reason: "breakpoint", func: "main", file: "/root/src/main.rs", line: 5, exited: false, exitCode: null, thread: 1 },
    { stopped: true, reason: "breakpoint", func: "main", file: "/root/src/main.rs", line: 9, exited: false, exitCode: null, thread: 1 },
    { stopped: false, reason: "exited", func: "", file: "", line: 0, exited: true, exitCode: 0 },
  ];
  let out: ((id: string, c: string, t: string) => void) | null = null;
  let stack = [{ level: 0, func: "main", file: "/root/src/main.rs", line: 5 }];
  let now = 1000;
  const saved: DebugSettings[] = [];
  const dbg: DebugPort = {
    available: async () => true,
    capabilities: async () => HOST,
    launch: async (...a) => { rec("launch")(...a); return { engine: "dap", adapter: "lldb-dap", caps: o.caps === undefined ? CAPS : o.caps }; },
    breakAt: async () => 1,
    run: async (id) => { rec("run")(id); now += 42; if (o.runOut) out?.(id, "stderr", o.runOut); return stops.shift()!; },
    cont: async (id) => { rec("cont")(id); now += 7; return stops.shift()!; },
    step: async (...a) => { rec("step")(...a); return stops.shift()!; },
    locals: async () => [{ name: "total", value: "3" }],
    stack: async () => stack,
    stop: async (...a) => { rec("stop")(...a); },
    setBreakpoints: async (...a) => { rec("setBreakpoints")(...a); return []; },
    stopOnPanic: async (...a) => { rec("stopOnPanic")(...a); return true; },
    threads: async () => [],
    variables: async (_id, _f, ref) => (ref === undefined ? [v("Locals", "", { reference: 10, path: "main.Locals" })] : [v("total", "3", { path: "main.Locals.total", memoryReference: "0x7ff0" }), v("p", "{..}", { reference: 11, path: "main.Locals.p" })]),
    evaluate: async (_id, expr, _f, ctx) => { rec("evaluate")(expr, ctx); if (expr === "boom") throw new Error("no such name"); return v(expr, "(int) $0 = 6"); },
    runTo: async (...a) => { rec("runTo")(...a); return stops.shift()!; },
    restartFrame: async (...a) => { rec("restartFrame")(...a); return stops.shift()!; },
    dataBreakpoints: async (...a) => { rec("dataBreakpoints")(...a); return a[2] ? [] : [{ dataId: "0x7ff0/4", description: "total", accessType: "write", verified: true, message: null }]; },
    readMemory: async (...a) => { rec("readMemory")(...a); return { address: "0x7ff0", bytes: [3, 0, 0, 0], unreadable: 0 }; },
    exceptionFilters: async (...a) => { rec("exceptionFilters")(...a); return a[1]; },
    testTargets: async (...a) => { rec("testTargets")(...a); return [{ target: "store", kind: "lib", executable: "/root/target/debug/deps/store-1", cwd: "/root/crates/store", tests: ["lru::tests::evicts_least_recently_used", "lru::tests::get_missing"] }]; },
    onOutput: (f) => { out = f; },
  };
  const asked: Array<{ intent: string; context: Array<{ kind: string; text: string }> }> = [];
  const toasts: string[] = [];
  const picks: Array<string | null> = [];
  const copied: string[] = [];
  const engine = makeDebugEngine({
    store: { session: () => session, setSession: (s) => { session = s; }, breakpoints: () => BPS, hydrate: () => undefined, save: () => undefined, setMessage: rec("message") },
    dbg,
    workspace: { root: () => "/root", fsRoot: () => "/R/", content: (k) => (k === "/R/Cargo.toml" ? '[package]\nname = "app"\n' : k.startsWith("/R/src/") ? "fn main(){}\n" : null), keys: () => ["/R/Cargo.toml", "/R/src/main.rs"], exec: async () => ({ ok: true, out: "" }) },
    editor: { currentTab: () => null, openPath: rec("openPath"), paintEd: () => undefined },
    shell: { goPane: () => undefined, setPanelTab: () => undefined },
    picker: { choose: async () => picks.shift() ?? null, ask: async () => null },
    view: { refresh: () => undefined },
    notifier: { toast: (m) => toasts.push(m) },
    newId: () => "S1",
    codev: { available: () => true, ask: (r) => asked.push(r) },
    bpMeta: meta,
    say: (k, p) => (p ? `${k}:${Object.values(p).join(",")}` : k),
    clock: () => now,
    settings: { load: () => o.settings ?? null, save: (_r, s) => saved.push(JSON.parse(JSON.stringify(s))) },
    clipboard: (t) => copied.push(t),
  });
  return {
    engine, calls, session: () => session, BPS, meta, asked, toasts, picks, copied, saved,
    setStack: (s: typeof stack) => { stack = s; },
    print: (t: string) => out?.("S1", "stderr", t),
  };
}
const named = (calls: Array<[string, unknown[]]>, n: string) => calls.filter((c) => c[0] === n).map((c) => c[1]);

describe("o motor (r23 F2)", () => {
  it("a sessão guarda o que o adaptador sabe fazer, o PerfTip e as paragens; run to cursor e restart", async () => {
    const h = harness();
    await h.engine.startDebug();
    let s = h.session()!;
    expect(s.caps).toEqual(CAPS);
    expect(s.perfMs).toBe(42);
    expect(s.stops).toBe(1);
    await h.engine.runToCursor("/R/src/main.rs", 9);
    expect(named(h.calls, "runTo")).toEqual([["S1", "src/main.rs", 9]]);
    s = h.session()!;
    expect(s.stop!.line).toBe(9);
    expect(s.stops).toBe(2);
    await h.engine.restartFrame();
    expect(h.toasts.pop()).toBe("rframe-adapter:lldb-dap");
    await h.engine.restart();
    expect(named(h.calls, "stop")).toHaveLength(2); /* o restart pára a sessão; o fim do programa fecha a nova */
    expect(named(h.calls, "launch")).toHaveLength(2);
    expect(named(h.calls, "launch")[1]).toEqual(["S1", "/root/target/debug/app", "/root"]);
  });

  it("andar para trás sem rr diz o que falta (o host, não o adaptador)", async () => {
    const h = harness();
    await h.engine.stepBack();
    await h.engine.reverseContinue();
    expect(h.toasts).toEqual(["tt-no-rr", "tt-no-rr"]);
  });

  it("a consola avalia no frame (repl), guarda o histórico e mostra o erro", async () => {
    const h = harness();
    await h.engine.consoleEval("total * 2");
    expect(h.engine.extra().console).toEqual([{ kind: "in", text: "total * 2" }, { kind: "err", text: "needsStop" }]);
    await h.engine.startDebug();
    await h.engine.consoleEval("total * 2");
    await h.engine.consoleEval("boom");
    expect(named(h.calls, "evaluate").filter((c) => c[1] === "repl")).toEqual([["total * 2", "repl"], ["boom", "repl"]]);
    expect(h.engine.extra().console.slice(-3)).toEqual([{ kind: "out", text: "(int) $0 = 6" }, { kind: "in", text: "boom" }, { kind: "err", text: "no such name" }]);
    expect(h.engine.consoleHistory(-1)).toBe("boom");
    expect(h.engine.consoleHistory(-1)).toBe("total * 2");
    expect(h.engine.consoleHistory(1)).toBe("boom");
    expect(h.saved.at(-1)!.history).toEqual(["total * 2", "boom"]);
    h.engine.consoleClear();
    expect(h.engine.extra().console).toEqual([]);
  });

  it("Debug Test: constrói, escolhe o teste e depura-o com --exact e parar em panic", async () => {
    const h = harness();
    h.picks.push("lru::tests::evicts_least_recently_used");
    await h.engine.debugTest();
    expect(named(h.calls, "testTargets")).toEqual([["/root"]]);
    expect(named(h.calls, "launch")[0]).toEqual(["S1", "/root/target/debug/deps/store-1", "/root/crates/store", ["--exact", "lru::tests::evicts_least_recently_used", "--nocapture"]]);
    expect(named(h.calls, "stopOnPanic")).toEqual([["S1", true]]);
    expect(h.engine.extra().stopOnPanic).toBe(true); /* em vigor nesta sessão… */
    expect(h.saved.some((k) => k.stopOnPanic)).toBe(false); /* …sem mudar a escolha guardada do humano */
    await h.engine.restart();
    expect(named(h.calls, "stopOnPanic")).toEqual([["S1", true], ["S1", true]]); /* o restart repete-a */
    await h.engine.dbgStop();
    expect(h.engine.extra().stopOnPanic).toBe(false);
  });

  it("parado num pânico: lê a mensagem, selecciona o primeiro frame do projecto e o Co-Dev recebe panic + frame", async () => {
    const h = harness({
      stops: [{ stopped: true, reason: "function breakpoint", func: "rust_panic", file: "/rustc/x/library/std/src/panicking.rs", line: 862, exited: false, exitCode: null, thread: 1 }],
      runOut: "thread 'lru::tests::evicts_least_recently_used' panicked at src/lru.rs:56:9:\nassertion `left == right` failed\n  left: None\n right: Some(1)\n",
    });
    h.setStack([
      { level: 0, func: "rust_panic", file: "/rustc/x/library/std/src/panicking.rs", line: 862 },
      { level: 1, func: "core::panicking::assert_failed", file: "/rustc/x/library/core/src/panicking.rs", line: 380 },
      { level: 2, func: "store::lru::tests::evicts_least_recently_used", file: "/root/src/lru.rs", line: 56 },
    ]);
    await h.engine.startDebug();
    const s = h.session()!;
    expect(s.panic).toMatchObject({ line: 56, left: "None", right: "Some(1)" });
    expect(s.frame).toBe(2);
    expect(named(h.calls, "openPath").at(-1)).toEqual(["/R/src/lru.rs", 56]);
    h.engine.askPanic();
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0].context.map((c) => c.kind)).toEqual(["panic", "frame"]);
    h.engine.copyPanic();
    expect(h.copied[0]).toContain(" right: Some(1)");
  });

  it("a mensagem do pânico que chega depois da paragem ainda vai para o cartão", async () => {
    const h = harness({ stops: [{ stopped: true, reason: "function breakpoint", func: "rust_panic", file: "/rustc/x/library/std/src/panicking.rs", line: 862, exited: false, exitCode: null, thread: 1 }] });
    h.setStack([{ level: 0, func: "rust_panic", file: "/rustc/x/library/std/src/panicking.rs", line: 862 }, { level: 1, func: "t", file: "/root/src/lru.rs", line: 56 }]);
    await h.engine.startDebug();
    expect(h.session()!.panic).toBeNull();
    h.print("thread 't' panicked at src/lru.rs:56:9:\nassertion `left == right` failed\n  left: None\n right: Some(1)\n");
    expect(h.session()!.panic).toMatchObject({ left: "None", right: "Some(1)" });
  });

  it("excepções só as oferecidas; data breakpoint no contentor da variável; a memória pela referência", async () => {
    const h = harness({ settings: { watches: ["total"], groupsOff: [], jmc: true, stopOnPanic: false, exceptionFilters: ["cpp_throw", "objc_throw"], history: [] } });
    await h.engine.startDebug();
    expect(named(h.calls, "exceptionFilters")).toEqual([["S1", ["cpp_throw"]]]);
    expect(h.engine.extra().watches.map((w) => w.expr)).toEqual(["total"]);
    await h.engine.setExceptionFilter("cpp_throw", false);
    expect(named(h.calls, "exceptionFilters").at(-1)).toEqual(["S1", []]);
    await h.engine.addDataBreakpoint(0, "total");
    expect(named(h.calls, "dataBreakpoints")[0]).toEqual(["S1", { frame: 0, reference: 10, name: "total" }, null]);
    expect(h.session()!.dataBps!.map((d) => d.description)).toEqual(["total"]);
    await h.engine.removeDataBreakpoint("0x7ff0/4");
    expect(h.session()!.dataBps).toEqual([]);
    await h.engine.viewMemory("main.Locals.total");
    expect(named(h.calls, "readMemory")).toEqual([["S1", "0x7ff0", 0, 128]]);
    expect(h.session()!.memory).toEqual({ name: "total", address: "0x7ff0", bytes: [3, 0, 0, 0], unreadable: 0 });
    h.engine.closeMemory();
    expect(h.session()!.memory).toBeNull();
  });

  it("um breakpoint com trigger só vai para o adaptador depois de o trigger parar; um grupo desligado não vai", async () => {
    const h = harness();
    await h.engine.setTrigger("/R/src/main.rs:9", "/R/src/main.rs:5");
    expect(h.meta.get("/R/src/main.rs:9")).toEqual({ enabled: true, trigger: "/R/src/main.rs:5" });
    await h.engine.startDebug(); /* pára na linha 5: arma a 9 */
    const sent = named(h.calls, "setBreakpoints").map((c) => (c[2] as Array<{ line: number }>).map((b) => b.line));
    expect(sent[0]).toEqual([5]);
    expect(sent.at(-1)).toEqual([5, 9]);
    await h.engine.setGroup("/R/src/main.rs:5", "scenario");
    await h.engine.toggleGroup("scenario");
    const last = named(h.calls, "setBreakpoints").at(-1)![2] as Array<{ line: number }>;
    expect(last.map((b) => b.line)).toEqual([9]);
    expect(h.saved.at(-1)!.groupsOff).toEqual(["scenario"]);
  });
});

describe("a vista (r23 F2)", () => {
  const tx = (k: string, p?: Record<string, string | number>) => (p ? `${k}:${Object.values(p).join(",")}` : k);
  it("a barra: botões, o LIVE, as paragens e o «i» com o que falta", () => {
    const tb = toolbarFor({ status: "stopped", engine: "dap", caps: CAPS }, HOST);
    const el = document.createElement("div");
    el.innerHTML = toolbarHtml(tx as never, tb, 3, (m) => m.why);
    expect([...el.querySelectorAll("button")].map((b) => b.getAttribute("data-on"))).toEqual(["cont", "over", "into", "out", "cursor", "restart", "stop"]);
    expect(el.querySelector('[data-on="cursor"]')!.getAttribute("title")).toBe("tb-cursor (Ctrl+F10)");
    expect(el.querySelector(".pos")!.textContent).toBe("tb-stops:3");
    expect(el.querySelector(".dbg-tb-miss")!.getAttribute("title")).toBe("tb-missing\n• tb-back: tt-no-rr\n• tb-rframe: rframe-adapter");
  });

  it("o cartão do pânico, a consola e a vista parada com a pilha recolhida", () => {
    const p = parsePanic("thread 't' panicked at src/lru.rs:56:9:\nassertion `left == right` failed\n  left: None\n right: Some(1)\n")!;
    const card = document.createElement("div");
    card.innerHTML = exceptionCardHtml(tx as never, p, [{ level: 2, func: "evicts", file: "/w/src/lru.rs", line: 56 }], true);
    expect(card.querySelector(".lr")!.textContent).toBe("panicLeftNonepanicRightSome(1)");
    expect(card.querySelector('.chain [data-action="frame"]')!.getAttribute("data-on")).toBe("2");
    expect(card.querySelector('[data-action="dbg-ask-panic"]')).not.toBeNull();
    const con = document.createElement("div");
    con.innerHTML = consoleBlock(tx as never, ["hi\n"], [{ kind: "in", text: "x" }, { kind: "err", text: "no x" }], true);
    expect(con.querySelector(".dbg-runs")!.textContent).toBe("consoleRuns");
    expect([...con.querySelectorAll(".dbg-cl")].map((l) => l.className)).toEqual(["dbg-cl in", "dbg-cl err"]);
    const s: Session = {
      id: "S1", program: "app", status: "stopped", stop: { stopped: true, reason: "x", func: "rust_panic", file: "/rustc/p.rs", line: 1, exited: false, exitCode: null }, locals: [],
      stack: [{ level: 0, func: "rust_panic", file: "/rustc/p.rs", line: 1 }, { level: 1, func: "assert_failed", file: "/rustc/c.rs", line: 2 }, { level: 2, func: "evicts", file: "/w/src/lru.rs", line: 56 }],
      engine: "dap", caps: CAPS, frame: 2, scopes: [v("Locals", "", { reference: 10 })], children: { 10: [v("total", "6", { memoryReference: "0x1", path: "evicts.Locals.total" })] },
    };
    const el = document.createElement("div");
    el.innerHTML = dapStopped(tx as never, s, { watches: [], output: [], stopOnPanic: true, expanded: new Set([10]) }, true, false, { tx: tx as never, root: "/w", jmc: true, libOpen: new Set(), console: [] });
    expect(el.querySelector(".dbg-lib")!.textContent).toBe("▸ libFrames:2");
    expect(el.querySelector('.dv.top[data-action="frame"]')!.getAttribute("data-on")).toBe("2");
    expect(el.querySelector('[data-action="dbg-data"]')!.getAttribute("data-on")).toBe("0|total");
    expect(el.querySelector('[data-action="dbg-mem"]')!.getAttribute("data-on")).toBe("evicts.Locals.total");
    expect(el.querySelector("#dbg-con-in")).not.toBeNull();
  });
});

describe("o adaptador Tauri (r23 F2)", () => {
  it("os comandos novos e os argumentos que mudaram", async () => {
    const seen: Array<[string, unknown]> = [];
    const port = tauriDebug(async (cmd: string, args?: unknown) => { seen.push([cmd, args]); return null as never; }, () => true);
    await port.capabilities!();
    await port.launch("S", "/p", "/w", ["--exact", "t", "--nocapture"]);
    await port.launch("S", "/p", "/w");
    await port.evaluate!("S", "x", 0, "repl");
    await port.runTo!("S", "src/a.rs", 3);
    await port.restartFrame!("S", 1);
    await port.dataBreakpoints!("S", { frame: 0, reference: 10, name: "x" }, null);
    await port.readMemory!("S", "0x1", 0, 64);
    await port.exceptionFilters!("S", ["cpp_throw"]);
    await port.testTargets!("/w");
    expect(seen).toEqual([
      ["debug_capabilities", undefined],
      ["debug_launch", { id: "S", program: "/p", cwd: "/w", args: ["--exact", "t", "--nocapture"] }],
      ["debug_launch", { id: "S", program: "/p", cwd: "/w" }],
      ["debug_evaluate", { id: "S", expression: "x", frame: 0, context: "repl" }],
      ["debug_run_to", { id: "S", file: "src/a.rs", line: 3 }],
      ["debug_restart_frame", { id: "S", frame: 1 }],
      ["debug_data_breakpoints", { id: "S", add: { frame: 0, reference: 10, name: "x" }, remove: null }],
      ["debug_read_memory", { id: "S", memoryReference: "0x1", offset: 0, count: 64 }],
      ["debug_exception_filters", { id: "S", filters: ["cpp_throw"] }],
      ["debug_test_targets", { root: "/w" }],
    ]);
  });
});
