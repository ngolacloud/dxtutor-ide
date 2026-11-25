// O streaming no chat (F3.2/F3.3 dos RF restantes, RF-S01/S08): onde cada bloco está a ser escrito
// e onde cai no plano aprovado; o bloco de código longo que fica fora do chat traz um botão que
// pede a alteração no editor. Domínio puro, e a vista do chat no harness real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootApp } from "./harness";
import { planFiles, placeInPlan, rangeLabel } from "../src/features/codev/domain/plan-order";
import { CODE_IN_EDITOR, proseOnly } from "../src/features/codev/domain/prose";
import type { PlanStep } from "../src/features/codev/domain/run-state";

const steps: PlanStep[] = [
  { text: "tokens", files: [{ path: "src/lexer.rs", start: 1, end: 20 }, { path: "./src/token.rs" }] },
  { text: "árvore", files: [{ path: "src/parser.rs" }, { path: "src/lexer.rs" }] },
  { text: "sem ficheiros", files: [] },
];

describe("domínio", () => {
  it("os ficheiros do plano pela ordem dos passos, cada um uma vez", () => {
    expect(planFiles(steps)).toEqual(["src/lexer.rs", "src/token.rs", "src/parser.rs"]);
    expect(planFiles([])).toEqual([]);
  });

  it("um bloco pela ordem, à frente do plano, fora dele, ou sem plano", () => {
    expect(placeInPlan(steps, [], "src/lexer.rs")).toEqual({ kind: "in-order", step: 1 });
    expect(placeInPlan(steps, [], "src/parser.rs")).toEqual({ kind: "ahead", step: 2, pending: ["src/lexer.rs", "src/token.rs"] });
    expect(placeInPlan(steps, ["./src/lexer.rs", "src/token.rs"], "src/parser.rs")).toEqual({ kind: "in-order", step: 2 });
    expect(placeInPlan(steps, [], "README.md")).toEqual({ kind: "outside" });
    expect(placeInPlan([], [], "src/lexer.rs")).toEqual({ kind: "none" });
    expect(placeInPlan([{ text: "x", files: [] }], [], "a")).toEqual({ kind: "none" });
  });

  it("o intervalo: a–b, ou uma linha (inserção)", () => {
    expect(rangeLabel(40, 52)).toBe("40–52");
    expect(rangeLabel(7, 7)).toBe("7");
    expect(rangeLabel(7, 6)).toBe("7");
  });
});

let w: any; // eslint-disable-line @typescript-eslint/no-explicit-any — a janela do harness
beforeEach(async () => { w = await bootApp(); });
afterEach(() => { document.getElementById("ag-msgs")?.replaceChildren(); });

describe("a vista do chat", () => {
  it("«Writing path a–b»: o caminho é texto e um link que abre o ficheiro; a etiqueta do plano", async () => {
    const { presenter } = await import("../src/features/codev/ui/chat-view");
    const card = presenter.thinking("co-dev");
    const opened: string[] = [];
    presenter.hunkWriting!(card, { path: "src/<x>.rs", start: 40, end: 52, place: { kind: "ahead", step: 2, pending: ["src/lexer.rs"] } }, () => opened.push("x"));
    presenter.hunkWriting!(card, { path: "src/lexer.rs", start: 3, end: 3, place: { kind: "in-order", step: 1 } }, () => opened.push("y"));
    presenter.hunkWriting!(card, { path: "README.md", start: 1, end: 2, place: { kind: "outside" } }, () => undefined);
    presenter.hunkWriting!(card, { path: "a.rs", start: 1, end: 2, place: { kind: "none" } }, () => undefined);
    const rows = [...document.querySelectorAll(".cd-writing")];
    expect(rows.map((r) => r.textContent)).toEqual([
      "Writing src/<x>.rs 40–52 ahead of the plan: step 2, before src/lexer.rs",
      "Writing src/lexer.rs 3 step 1 of the plan",
      "Writing README.md 1–2 not in the plan",
      "Writing a.rs 1–2",
    ]);
    expect(rows[0].querySelector(".cd-writing-path")!.innerHTML).toBe("src/&lt;x&gt;.rs"); // text, never HTML
    expect(rows[0].querySelector(".cd-plan.warn")).not.toBeNull();
    expect(rows[1].querySelector(".cd-plan.warn")).toBeNull();
    (rows[0].querySelector(".cd-writing-path") as HTMLElement).click();
    expect(opened).toEqual(["x"]);
  });

  it("o bloco de código longo fica fora do chat, com um botão que pede a alteração no editor", async () => {
    const { presenter } = await import("../src/features/codev/ui/chat-view");
    const { codevAsk } = await import("../src/app/codev-ask");
    const asked: unknown[] = [];
    codevAsk.register(async (r) => { asked.push(r); }, () => undefined);
    const card = presenter.thinking("co-dev");
    const text = proseOnly("Aqui está:\n```rust\nfn a() {}\nfn b() {}\nfn c() {}\nfn d() {}\n```\nE pronto.");
    expect(text).toContain(CODE_IN_EDITOR);
    presenter.assistantText(card, text);
    const btn = document.querySelector<HTMLButtonElement>(".cd-apply")!;
    expect(btn.textContent).toBe("Ask Co-Dev to make the change");
    expect(document.querySelector(".cd-code-ed")!.textContent).toBe(CODE_IN_EDITOR);
    btn.click();
    expect(asked).toEqual([{ intent: "chat", text: expect.stringContaining("edit_lines"), context: [], send: true }]);
    expect(btn.disabled).toBe(true); // once
    // short code (≤ 3 lines) stays in the chat, with no button
    const other = presenter.thinking("co-dev");
    presenter.assistantText(other, proseOnly("```\nx\n```"));
    expect(other.el.querySelector(".cd-apply")).toBeNull();
    vi.restoreAllMocks();
  });
});
