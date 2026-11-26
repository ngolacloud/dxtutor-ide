import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { fromBacklogDto, toBacklogDto, type BacklogDto } from "../src/features/board/domain/persist";
import type { Backlog } from "../src/features/board/domain/types";

/* ADR-0006, R3b: o backlog por pasta (`board_load`/`board_save`). */

describe("persist (domínio puro): quadro da UI ↔ tutor_board::Backlog", () => {
  const bl: Backlog = {
    seq: 14, mig: 3, adr: 4, view: -1,
    issues: [
      { id: "DX-12", title: "Lista de encomendas", type: "feature", pts: 5, stage: "func", attempts: 1, res: [{ n: "cargo test", ok: true }], note: "", model: null, branch: "feature/dx-12-lista", agent: "be", sprint: 0, reviewed: true },
      { id: "DX-13", title: "Corrige o total", type: "fix", pts: 2, stage: "todo", attempts: 0, res: null, note: "rejeitada: falta o IVA", model: null, branch: null, agent: "lead", sprint: 1, owner: "you" },
    ],
  };

  it("título → want, tipo → kind; o que não tem coluna vai em meta", () => {
    const d = toBacklogDto(bl);
    expect(d.seq).toBe(14);
    expect(d.sprints).toEqual([{ index: 0, goal: "" }, { index: 1, goal: "" }]);
    expect(d.stories[0]).toMatchObject({ id: "DX-12", want: "Lista de encomendas", kind: "feature", points: 5, stage: "func", branch: "feature/dx-12-lista", sprint: 0 });
    expect(d.stories[0].meta).toEqual({ agent: "be", reviewed: true, attempts: 1, res: [{ n: "cargo test", ok: true }] });
    expect(d.stories[1].meta).toEqual({ agent: "lead", owner: "you" });
    expect(d.stories[1].note).toBe("rejeitada: falta o IVA");
  });

  it("ida e volta preserva as issues", () => {
    const back = fromBacklogDto(toBacklogDto(bl));
    expect(back.seq).toBe(14);
    expect(back.issues).toEqual(bl.issues);
  });

  it("um backlog vindo de fora (sem meta, seq atrasado) fica coerente", () => {
    const d: BacklogDto = { problem: "", seq: 2, sprints: [], stories: [{ id: "DX-40", sprint: 0, role: "comprador", want: "pagar com cartão", soThat: "", acceptance: [], points: 3, stage: "backlog", kind: "feature", prompt: "", note: "", branch: null }] };
    const got = fromBacklogDto(d);
    expect(got.seq).toBe(41);
    expect(got.issues[0]).toMatchObject({ id: "DX-40", title: "pagar com cartão", agent: "lead", attempts: 0, res: null });
  });

  it("a story, os critérios e o prompt que vêm do backend voltam ao gravar (não se perdem)", () => {
    const d: BacklogDto = { problem: "", seq: 41, sprints: [{ index: 0, goal: "" }], stories: [{ id: "DX-40", sprint: 0, role: "comprador", want: "pagar com cartão", soThat: "não ter de ir ao banco", acceptance: ["Dado um cartão válido, quando pago, então a encomenda fica paga"], points: 3, stage: "todo", kind: "feature", prompt: "usa o gateway de testes", note: "", branch: null, meta: { agent: "be" } }] };
    const got = fromBacklogDto(d);
    expect(got.issues[0]).toMatchObject({ role: "comprador", soThat: "não ter de ir ao banco", acceptance: ["Dado um cartão válido, quando pago, então a encomenda fica paga"], prompt: "usa o gateway de testes" });
    expect(toBacklogDto({ seq: got.seq, mig: 3, adr: 4, view: -1, issues: got.issues })).toEqual(d);
    /* uma issue sem story nem critérios não ganha campos novos (fica igual à de antes) */
    expect(fromBacklogDto(toBacklogDto(bl)).issues.every((i) => !("role" in i) && !("acceptance" in i))).toBe(true);
  });
});

describe("o quadro na cadeia real, com IPC falso", () => {
  let w: any;
  let calls: Array<[string, any]>;
  let stored: Record<string, BacklogDto | null>;
  const openFolder = (root: string) => { w.DXR = { root }; document.dispatchEvent(new window.CustomEvent("dx:workspace", { detail: { root } })); };

  beforeEach(async () => {
    vi.useFakeTimers();
    w = await bootApp();
    calls = []; stored = {};
    w.__TAURI__ = { core: { invoke: async (cmd: string, a: any) => {
      calls.push([cmd, a]);
      if (cmd === "board_load") return stored[a.root] ?? null;
      if (cmd === "board_save") { stored[a.root] = JSON.parse(JSON.stringify(a.backlog)); return null; }
      throw new Error("inesperado " + cmd);
    } } };
  });
  afterEach(() => { delete w.__TAURI__; delete w.DXR; vi.useRealTimers(); });

  it("no browser não fala com o backend", async () => {
    w.mkIssue({ title: "x", agent: "be" });
    document.body.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls).toEqual([]);
  });

  it("ao abrir a pasta carrega o backlog dela", async () => {
    stored["/proj"] = { problem: "", seq: 8, sprints: [], stories: [{ id: "DX-7", sprint: 0, role: "", want: "Login", soThat: "", acceptance: [], points: 3, stage: "todo", kind: "feature", prompt: "", note: "", branch: null, meta: { agent: "be" } }] };
    openFolder("/proj");
    await vi.advanceTimersByTimeAsync(0);
    expect(calls[0]).toEqual(["board_load", { root: "/proj" }]);
    expect(w.BL.issues.map((i: any) => [i.id, i.title, i.agent])).toEqual([["DX-7", "Login", "be"]]);
    expect(w.BL.seq).toBe(8);
  });

  it("grava depois de uma mudança (e só se mudou); nunca antes de carregar", async () => {
    w.DXR = { root: "/proj" };
    w.mkIssue({ title: "antes de carregar", agent: "be" });
    document.body.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.filter((c) => c[0] === "board_save")).toEqual([]); // a pasta ainda não foi carregada
    openFolder("/proj");
    await vi.advanceTimersByTimeAsync(0);
    expect(w.BL.issues).toEqual([]); // o quadro é o da pasta (vazio), não o da sessão
    w.mkIssue({ title: "Nova", agent: "fe", stage: "todo" });
    document.body.click();
    await vi.advanceTimersByTimeAsync(500);
    const saves = calls.filter((c) => c[0] === "board_save");
    expect(saves).toHaveLength(1);
    expect(saves[0][1].root).toBe("/proj");
    expect(saves[0][1].backlog.stories.map((s: any) => s.want)).toEqual(["Nova"]);
    document.body.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(calls.filter((c) => c[0] === "board_save")).toHaveLength(1); // nada mudou
  });

  it("trocar de pasta não grava o quadro de uma sobre a outra", async () => {
    openFolder("/a");
    await vi.advanceTimersByTimeAsync(0);
    w.mkIssue({ title: "de A", agent: "be" });
    document.body.click();
    await vi.advanceTimersByTimeAsync(500);
    openFolder("/b");
    await vi.advanceTimersByTimeAsync(0);
    document.body.click();
    await vi.advanceTimersByTimeAsync(500);
    expect(stored["/a"]!.stories.map((s) => s.want)).toEqual(["de A"]);
    expect(stored["/b"]).toBeUndefined();
    expect(w.BL.issues).toEqual([]);
  });
});
