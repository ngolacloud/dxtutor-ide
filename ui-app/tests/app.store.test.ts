// Bus de eventos e proprietários de estado (ADR-0004, U3). Sem DOM além do window.
import { test, expect, vi, beforeEach } from "vitest";
import { createBus } from "../src/app/bus";
import { ownedGlobal } from "../src/app/store/owned";

const W = window as unknown as Record<string, unknown>;

beforeEach(() => {
  for (const k of ["__T1__", "__T2__", "__T3__"]) delete W[k];
});

test("bus: entrega por ordem, desliga, once, e um handler que lança não pára os outros", () => {
  const errors: string[] = [];
  const bus = createBus((e) => errors.push(e));
  const seen: string[] = [];
  const off = bus.on("agent:mode", (p) => seen.push(`a:${p.mode}`));
  bus.on("agent:mode", () => {
    throw new Error("x");
  });
  bus.on("agent:mode", (p) => seen.push(`c:${p.prev}`));
  bus.once("agent:mode", (p) => seen.push(`once:${p.mode}`));
  expect(bus.count("agent:mode")).toBe(4);
  bus.emit("agent:mode", { mode: "auto", prev: "assist" });
  expect(seen).toEqual(["a:auto", "c:assist", "once:auto"]);
  expect(errors).toEqual(["agent:mode"]);
  expect(bus.count("agent:mode")).toBe(3); // o once saiu
  off();
  bus.emit("agent:mode", { mode: "manual", prev: "auto" });
  expect(seen).toEqual(["a:auto", "c:assist", "once:auto", "c:auto"]);
  expect(bus.count("layout:pane")).toBe(0);
});

test("ownedGlobal: as escritas antigas pelo window passam pelo dono e emitem só quando mudam", () => {
  const changed = vi.fn();
  const o = ownedGlobal<string>("__T1__", "assist", changed);
  expect(W.__T1__).toBe("assist");
  W.__T1__ = "auto"; // como o monólito: window.MODE = 'auto'
  expect(o.get()).toBe("auto");
  expect(changed).toHaveBeenCalledWith("auto", "assist");
  W.__T1__ = "auto"; // igual: sem evento
  expect(changed).toHaveBeenCalledTimes(1);
  o.set("manual");
  expect(W.__T1__).toBe("manual");
  expect(changed).toHaveBeenLastCalledWith("manual", "auto");
});

test("ownedGlobal: herda o valor que já estava no window (reavaliação do módulo)", () => {
  W.__T2__ = 42;
  const o = ownedGlobal<number>("__T2__", 85);
  expect(o.get()).toBe(42);
  // reinstalar (como o harness entre testes) mantém o valor e continua a funcionar
  const again = ownedGlobal<number>("__T2__", 85);
  expect(again.get()).toBe(42);
  W.__T2__ = 7;
  expect(again.get()).toBe(7);
  // nulo/indefinido no window → o valor inicial
  W.__T3__ = undefined;
  expect(ownedGlobal<string>("__T3__", "en").get()).toBe("en");
});

test("stores reais: MODE/ACTIVE/cur/PANE pelo window emitem no bus; o S do core delega", async () => {
  vi.resetModules();
  const { bus, agentStore, editorStore, layoutStore } = await import("../src/app/store");
  const { S } = await import("../src/core");
  const events: string[] = [];
  bus.on("agent:mode", (p) => events.push(`mode ${p.prev}→${p.mode}`));
  bus.on("agent:provider", (p) => events.push(`provider ${p.prev}→${p.provider}`));
  bus.on("editor:tab", (p) => events.push(`tab ${p.prev}→${p.id}`));
  bus.on("layout:pane", (p) => events.push(`pane ${p.prev}→${p.pane}`));
  agentStore.mode = "assist";
  agentStore.provider = "claude";
  editorStore.currentTabId = null;
  layoutStore.pane = "explorer";
  events.length = 0;
  W.MODE = "auto"; // escrita do monólito
  W.ACTIVE = "gemini";
  S.cur = "t1"; // fachada do core usada pelos legacy-bridges
  W.PANE = "scm";
  expect(events).toEqual(["mode assist→auto", "provider claude→gemini", "tab null→t1", "pane explorer→scm"]);
  expect(agentStore.mode).toBe("auto");
  expect(S.MODE).toBe("auto");
  expect(editorStore.currentTabId).toBe("t1");
});
