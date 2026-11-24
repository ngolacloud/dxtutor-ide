// U4f (ADR-0004): workspace (writeFile/resetWorkspace — sem semente, ADR-0006 R1a), LS, save/loadCfg e use/connected.
import { beforeEach, expect, it } from "vitest";
import { bootApp } from "./harness";

let w: Window & Record<string, any>;
let WSM: any; // eslint-disable-line @typescript-eslint/no-explicit-any — o módulo da cadeia do bootApp (U7f)
beforeEach(async () => {
  w = (await bootApp()) as Window & Record<string, any>;
  WSM = await import("../src/features/workspace");
  localStorage.clear();
});

it("resetWorkspace esvazia o workspace e o stage: a app não traz ficheiros de demonstração", () => {
  w.writeFile(w.ROOT + "extra.md", "x");
  w.STAGED.add(w.ROOT + "extra.md");
  WSM.resetWorkspace();
  expect(Object.keys(w.FS)).toEqual([]);
  expect(w.STAGED.size).toBe(0);
  expect(w.SEED).toBeUndefined();
  expect(w.loadSeed).toBeUndefined();
});

it("writeFile cria o ficheiro, abre as pastas até ele e emite workspace:changed", async () => {
  const { bus } = await import("../src/app/bus");
  let n = 0;
  bus.on("workspace:changed", () => n++);
  w.writeFile(w.ROOT + "novo/dir/a.rs", "fn a() {}");
  expect(w.FS[w.ROOT + "novo/dir/a.rs"]).toEqual({ content: "fn a() {}", orig: null });
  expect(w.OPEN.has(w.ROOT + "novo/dir")).toBe(true);
  expect(w.OPEN.has(w.ROOT + "novo")).toBe(true);
  w.writeFile(w.ROOT + "novo/dir/a.rs", "fn b() {}");
  expect(w.FS[w.ROOT + "novo/dir/a.rs"].content).toBe("fn b() {}");
  expect(n).toBe(2);
});

it("LS: prefixo dx2., JSON, omissão quando falta ou está corrompido", () => {
  w.LS.set("k", { a: 1 });
  expect(localStorage.getItem("dx2.k")).toBe('{"a":1}');
  expect(w.LS.get("k", null)).toEqual({ a: 1 });
  expect(w.LS.get("nada", 7)).toBe(7);
  localStorage.setItem("dx2.mau", "{nao-json");
  expect(w.LS.get("mau", "omissão")).toBe("omissão");
});

it("save/loadCfg: ida e volta do modo, provedor, limiar e modelo — pelos donos (eventos)", async () => {
  const { bus } = await import("../src/app/bus");
  w.MODE = "manual";
  w.ACTIVE = "gemini";
  w.THRESH = 70;
  w.PROV.gemini.model = "gemini-2.5-pro";
  w.save();
  w.MODE = "assist";
  w.ACTIVE = "claude";
  w.THRESH = 85;
  w.PROV.gemini.model = "outro";
  const seen: string[] = [];
  bus.on("agent:mode", (p) => seen.push(p.mode));
  (await import("../src/app/store/config")).loadCfg();
  expect([w.MODE, w.ACTIVE, w.THRESH, w.PROV.gemini.model]).toEqual(["manual", "gemini", 70, "gemini-2.5-pro"]);
  expect(seen).toEqual(["manual"]);
  // nada guardado → não mexe
  localStorage.clear();
  w.MODE = "auto";
  (await import("../src/app/store/config")).loadCfg();
  expect(w.MODE).toBe("auto");
});

it("use conta chamadas/tokens; connected lista os provedores ligados", async () => {
  const { agentStore } = await import("../src/app/store/agent");
  const before = { ...w.USAGE.claude };
  w.use("claude", 120);
  expect(w.USAGE.claude).toEqual({ calls: before.calls + 1, tok: before.tok + 120 });
  expect(agentStore.usage).toBe(w.USAGE);
  w.PROV.codex.on = false;
  expect(w.connected()).not.toContain("codex");
  w.PROV.codex.on = true;
  expect(w.connected()).toContain("codex");
});
